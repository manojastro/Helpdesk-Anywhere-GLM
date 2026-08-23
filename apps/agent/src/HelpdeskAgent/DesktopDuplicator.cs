using System.Drawing;
using Microsoft.Extensions.Logging;
using SharpGen.Runtime;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace HelpdeskAgent;

/// <summary>
/// DXGI Desktop Duplication capture for the primary output.
/// Produces BGRA frames via <see cref="OnFrame"/> at a bounded frame rate.
/// </summary>
public sealed class DesktopDuplicator : IDisposable
{
    private readonly ILogger _log;
    private readonly int _fps;
    private Thread? _thread;
    private CancellationTokenSource? _cts;

    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private IDXGIOutputDuplication? _duplication;
    private ID3D11Texture2D? _staging;

    /// <summary>BGRA frame: (width, height, stride, pixels).</summary>
    public event Action<int, int, int, byte[]>? OnFrame;

    public int Width { get; private set; }
    public int Height { get; private set; }

    public DesktopDuplicator(ILogger log, int fps = 10)
    {
        _log = log;
        _fps = fps;
    }

    /// <summary>Initialises D3D11 + output duplication. Throws on failure.</summary>
    public void Initialise()
    {
        var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();

        // Pick the output that contains the primary screen's origin — with
        // multiple adapters/outputs, output 0 may be a secondary or blank one.
        var primaryOrigin = new Point(
            System.Windows.Forms.Screen.PrimaryScreen.Bounds.X + 10,
            System.Windows.Forms.Screen.PrimaryScreen.Bounds.Y + 10);

        IDXGIAdapter1 adapter = null!;
        IDXGIOutput output = null!;
        var adapterIndex = 0u;
        while (adapter is null || output is null)
        {
            if (factory.EnumAdapters1(adapterIndex, out var ad) != Result.Ok)
            {
                break;
            }
            var outputIndex = 0u;
            while (adapter is null || output is null)
            {
                if (ad.EnumOutputs(outputIndex, out var op) != Result.Ok)
                {
                    break;
                }
                var r = op.Description.DesktopCoordinates;
                _log.LogInformation("DXGI output a{A}/o{O}: {L},{T} {W}x{H}",
                    adapterIndex, outputIndex, r.Left, r.Top,
                    r.Right - r.Left, r.Bottom - r.Top);
                if (primaryOrigin.X >= r.Left && primaryOrigin.X < r.Right
                    && primaryOrigin.Y >= r.Top && primaryOrigin.Y < r.Bottom)
                {
                    adapter = ad;
                    output = op;
                    _selectedAdapter = adapterIndex;
                    _selectedOutput = outputIndex;
                    break;
                }
                op.Dispose();
                outputIndex++;
            }
            if (adapter is null)
            {
                ad.Dispose();
            }
            adapterIndex++;
        }
        if (output is null)
        {
            // Fallback: first output of first adapter.
            factory.EnumAdapters1(0, out var ad0);
            ad0.EnumOutputs(0, out var op0);
            adapter = ad0;
            output = op0!;
            _log.LogWarning("primary output not matched — falling back to adapter0/output0");
        }

        var output1 = output.QueryInterface<IDXGIOutput1>();

        var flags = DeviceCreationFlags.BgraSupport;
        D3D11.D3D11CreateDevice(adapter, DriverType.Unknown, flags, null, out _device).CheckError();
        _context = _device.ImmediateContext;

        _duplication = output1.DuplicateOutput(_device);

        var desktopBounds = output.Description.DesktopCoordinates;
        Width = desktopBounds.Right - desktopBounds.Left;
        Height = desktopBounds.Bottom - desktopBounds.Top;

        _staging = _device.CreateTexture2D(new Texture2DDescription
        {
            Usage = ResourceUsage.Staging,
            Format = Format.B8G8R8A8_UNorm,
            Width = (uint)Width,
            Height = (uint)Height,
            MipLevels = 1,
            ArraySize = 1,
            SampleDescription = new SampleDescription(1, 0),
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.Read,
            MiscFlags = ResourceOptionFlags.None,
        });

        _log.LogInformation("DXGI duplication ready: {W}x{H} @ {Fps}fps", Width, Height, _fps);
        output1.Dispose();
        output.Dispose();
        adapter.Dispose();
        factory.Dispose();
    }

    public void Start()
    {
        if (_thread is not null) return;
        _cts = new CancellationTokenSource();
        _thread = new Thread(CaptureLoop) { IsBackground = true, Name = "dxgi-capture" };
        _thread.Start();
    }

    public void Stop()
    {
        _cts?.Cancel();
        _thread?.Join(2000);
        _thread = null;
    }

    private void CaptureLoop()
    {
        var ct = _cts!.Token;
        var frameInterval = TimeSpan.FromSeconds(1.0 / _fps);
        long frames = 0;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var duplication = _duplication;
                if (duplication is null)
                {
                    // Reinitialise() is running (or failed); retry shortly.
                    Thread.Sleep(500);
                    continue;
                }
                var result = duplication.AcquireNextFrame(
                    (uint)(frameInterval.TotalMilliseconds * 2), out var info, out var desktopResource);
                if (result.Success)
                {
                    try
                    {
                        if (_forceNextFrame || info.LastPresentTime != 0 || frames == 0 || info.AccumulatedFrames > 0)
                        {
                            using var frameTex = desktopResource.QueryInterface<ID3D11Texture2D>();
                            EnsureStaging(frameTex);
                            _context!.CopyResource(_staging!, frameTex);
                            var mapped = _context.Map(_staging!, 0, MapMode.Read);
                            try
                            {
                                var rowPitch = mapped.RowPitch;
                                var size = (int)rowPitch * Height;
                                var pixels = new byte[size];
                                unsafe
                                {
                                    System.Runtime.InteropServices.Marshal.Copy(
                                        (nint)mapped.DataPointer, pixels, 0, size);
                                }
                                OnFrame?.Invoke(Width, Height, (int)rowPitch, pixels);
                                frames++;
                                _forceNextFrame = false;
                            }
                            finally
                            {
                                _context.Unmap(_staging!, 0);
                            }
                        }
                    }
                    finally
                    {
                        // Always release, even if frame processing threw — otherwise
                        // the next AcquireNextFrame fails with DXGI_ERROR_INVALID_CALL.
                        try { duplication.ReleaseFrame(); }
                        catch { /* duplication replaced mid-frame */ }
                    }
                }
                else if (result == Result.WaitTimeout)
                {
                    // No screen update within timeout — idle desktop, loop again.
                }
                else if (result.Code == unchecked((int)0x887A0026)) // DXGI_ERROR_ACCESS_LOST
                {
                    _log.LogWarning("DXGI access lost (secure desktop / mode change) — re-initialising");
                    Reinitialise();
                }
                else
                {
                    result.CheckError();
                }
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "capture loop error");
                Thread.Sleep(500);
            }

            Thread.Sleep(frameInterval);
        }
    }

    /// <summary>
    /// Creates the staging texture from the ACTUAL frame texture dimensions —
    /// output.Description uses DPI-virtualized coordinates and can mismatch.
    /// </summary>
    private void EnsureStaging(ID3D11Texture2D frameTex)
    {
        var desc = frameTex.Description;
        if (_staging is not null
            && _staging.Description.Width == desc.Width
            && _staging.Description.Height == desc.Height)
        {
            return;
        }
        _staging?.Dispose();
        Width = (int)desc.Width;
        Height = (int)desc.Height;
        _staging = _device!.CreateTexture2D(new Texture2DDescription
        {
            Usage = ResourceUsage.Staging,
            Format = Format.B8G8R8A8_UNorm,
            Width = desc.Width,
            Height = desc.Height,
            MipLevels = 1,
            ArraySize = 1,
            SampleDescription = new SampleDescription(1, 0),
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.Read,
            MiscFlags = ResourceOptionFlags.None,
        });
        _log.LogInformation("capture surface: {W}x{H}", Width, Height);
    }

    private void Reinitialise()
    {
        var attempt = 0;
        while (_cts?.IsCancellationRequested == false)
        {
            attempt++;
            IDXGIOutputDuplication? replacement = null;
            try
            {
                var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
                factory.EnumAdapters1(_selectedAdapter, out var adapter);
                adapter.EnumOutputs(_selectedOutput, out var output);
                var output1 = output.QueryInterface<IDXGIOutput1>();
                replacement = output1.DuplicateOutput(_device!);
                output1.Dispose();
                output.Dispose();
                adapter.Dispose();
                factory.Dispose();

                if (replacement is not null)
                {
                    var old = _duplication;
                    _duplication = replacement;
                    try { old?.Dispose(); } catch { /* replaced */ }
                    _forceNextFrame = true;
                    _log.LogInformation("DXGI duplication recovered (attempt {N})", attempt);
                    return;
                }
            }
            catch (Exception ex)
            {
                replacement?.Dispose();
                if (attempt == 1 || attempt % 10 == 0)
                {
                    _log.LogWarning("DXGI re-init attempt {N} failed: {Msg}", attempt, ex.Message);
                }
            }
            Thread.Sleep(1000);
        }
    }

    private uint _selectedAdapter;
    private uint _selectedOutput;
    private volatile bool _forceNextFrame = true;

    public void Dispose()
    {
        Stop();
        _staging?.Dispose();
        _duplication?.Dispose();
        _context?.Dispose();
        _device?.Dispose();
    }
}
