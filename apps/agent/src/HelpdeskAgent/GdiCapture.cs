using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace HelpdeskAgent;

/// <summary>
/// GDI (BitBlt) screen capture fallback. DXGI Desktop Duplication returns
/// black frames in some remote sessions (e.g. RDP); BitBlt keeps working
/// there, so the agent falls back to this path when DXGI is uniformly black.
/// Slower than DXGI but adequate for a POC.
/// </summary>
public sealed class GdiCapture : IDisposable
{
    private readonly ILogger _log;
    private readonly int _fps;
    private Thread? _thread;
    private CancellationTokenSource? _cts;

    public event Action<int, int, int, byte[]>? OnFrame;

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    private static class Native
    {
        [DllImport("user32.dll")]
        public static extern IntPtr GetDesktopWindow();

        [DllImport("user32.dll")]
        public static extern IntPtr GetWindowDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

        [DllImport("gdi32.dll")]
        public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight,
            IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

        [DllImport("gdi32.dll")]
        public static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint uStartScan, uint cScanLines,
            byte[] lpvBits, ref BITMAPINFOHEADER lpbi, uint uUsage);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteDC(IntPtr hdc);
    }

    public GdiCapture(ILogger log, int fps = 8)
    {
        _log = log;
        _fps = fps;
    }

    public int Width { get; private set; }
    public int Height { get; private set; }

    public void Initialise()
    {
        Width = Native.GetSystemMetrics(0);
        Height = Native.GetSystemMetrics(1);
        _log.LogInformation("GDI capture ready: {W}x{H} @ {Fps}fps", Width, Height, _fps);
    }

    public void Start()
    {
        if (_thread is not null) return;
        _cts = new CancellationTokenSource();
        _thread = new Thread(CaptureLoop) { IsBackground = true, Name = "gdi-capture" };
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
        var interval = TimeSpan.FromSeconds(1.0 / _fps);
        var header = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = Width,
            biHeight = -Height, // top-down
            biPlanes = 1,
            biBitCount = 32,
            biCompression = 0, // BI_RGB
        };
        var buffer = new byte[Width * Height * 4];

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var desktop = Native.GetDesktopWindow();
                var screenDc = Native.GetWindowDC(desktop);
                var memDc = Native.CreateCompatibleDC(screenDc);
                var bmp = Native.CreateCompatibleBitmap(screenDc, Width, Height);
                var old = Native.SelectObject(memDc, bmp);

                if (Native.BitBlt(memDc, 0, 0, Width, Height, screenDc, 0, 0, 0x00CC0020 | 0x40000000)) // SRCCOPY | CAPTUREBLT
                {
                    var got = Native.GetDIBits(memDc, bmp, 0, (uint)Height, buffer, ref header, 0);
                    if (got != 0)
                    {
                        OnFrame?.Invoke(Width, Height, Width * 4, buffer);
                    }
                }

                Native.SelectObject(memDc, old);
                Native.DeleteObject(bmp);
                Native.DeleteDC(memDc);
                Native.ReleaseDC(desktop, screenDc);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "GDI capture error");
            }

            Thread.Sleep(interval);
        }
    }

    public void Dispose()
    {
        Stop();
    }
}
