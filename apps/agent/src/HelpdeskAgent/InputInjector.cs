using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace HelpdeskAgent;

/// <summary>
/// Injects mouse/keyboard input via the Windows SendInput API.
/// Coordinates arrive normalized (0.0–1.0) from the technician and are mapped
/// to the primary screen. Set HA_INPUT=0 to disable injection entirely.
/// </summary>
public sealed class InputInjector
{
    private readonly ILogger _log;
    public bool Enabled { get; } = Environment.GetEnvironmentVariable("HA_INPUT") != "0";
    public long InjectedCount { get; private set; }

    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public nint dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public nint dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUT
    {
        [FieldOffset(0)]
        public uint type;

        [FieldOffset(8)]
        public MOUSEINPUT mi;

        [FieldOffset(8)]
        public KEYBDINPUT ki;
    }

    private static class Native
    {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    public InputInjector(ILogger log)
    {
        _log = log;
    }

    // ---- Mouse ----

    public void MouseMove(double x, double y)
    {
        if (!Enabled) return;
        var screenW = Native.GetSystemMetrics(0);
        var screenH = Native.GetSystemMetrics(1);
        // Clamp to bounds.
        var nx = Math.Clamp(x, 0.0, 1.0);
        var ny = Math.Clamp(y, 0.0, 1.0);
        // Absolute coordinates are 0..65535 across the screen.
        var dx = (int)Math.Round(nx * 65535.0);
        var dy = (int)Math.Round(ny * 65535.0);
        Send(new INPUT
        {
            type = INPUT_MOUSE,
            mi = new MOUSEINPUT
            {
                dx = dx,
                dy = dy,
                dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
            },
        });
    }

    public void MouseClick(string button, bool down)
    {
        if (!Enabled) return;
        var (dn, up) = button switch
        {
            "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        };
        Send(new INPUT
        {
            type = INPUT_MOUSE,
            mi = new MOUSEINPUT { dwFlags = down ? dn : up },
        });
    }

    public void MouseWheel(double delta)
    {
        if (!Enabled) return;
        Send(new INPUT
        {
            type = INPUT_MOUSE,
            mi = new MOUSEINPUT
            {
                mouseData = unchecked((uint)(int)delta),
                dwFlags = MOUSEEVENTF_WHEEL,
            },
        });
    }

    // ---- Keyboard ----

    public void Key(string browserCode, bool down)
    {
        if (!Enabled) return;
        var (vk, extended) = MapKey(browserCode);
        if (vk == 0)
        {
            _log.LogWarning("unmapped key code: {Code}", browserCode);
            return;
        }
        Send(new INPUT
        {
            type = INPUT_KEYBOARD,
            ki = new KEYBDINPUT
            {
                wVk = vk,
                dwFlags = (down ? 0 : KEYEVENTF_KEYUP) | (extended ? KEYEVENTF_EXTENDEDKEY : 0),
            },
        });
    }

    /// <summary>Browser KeyboardEvent.code → (virtual-key, extended-flag).</summary>
    private static (ushort vk, bool extended) MapKey(string code) => code switch
    {
        "Backspace" => ((ushort)0x08, false),
        "Tab" => ((ushort)0x09, false),
        "Enter" => ((ushort)0x0D, false),
        "ShiftLeft" or "ShiftRight" => ((ushort)0x10, false),
        "ControlLeft" or "ControlRight" => ((ushort)0x11, code == "ControlRight"),
        "AltLeft" or "AltRight" => ((ushort)0x12, code == "AltRight"),
        "CapsLock" => ((ushort)0x14, false),
        "Escape" => ((ushort)0x1B, false),
        "Space" => ((ushort)0x20, false),
        "PageUp" => ((ushort)0x21, true),
        "PageDown" => ((ushort)0x22, true),
        "End" => ((ushort)0x23, true),
        "Home" => ((ushort)0x24, true),
        "ArrowLeft" => ((ushort)0x25, true),
        "ArrowUp" => ((ushort)0x26, true),
        "ArrowRight" => ((ushort)0x27, true),
        "ArrowDown" => ((ushort)0x28, true),
        "PrintScreen" => ((ushort)0x2C, true),
        "Insert" => ((ushort)0x2D, true),
        "Delete" => ((ushort)0x2E, true),
        "MetaLeft" => ((ushort)0x5B, true),
        "MetaRight" => ((ushort)0x5C, true),
        "ContextMenu" => ((ushort)0x5D, false),
        "NumLock" => ((ushort)0x90, false),
        "ScrollLock" => ((ushort)0x91, false),
        "Pause" => ((ushort)0x13, false),
        "F1" => ((ushort)0x70, false),
        "F2" => ((ushort)0x71, false),
        "F3" => ((ushort)0x72, false),
        "F4" => ((ushort)0x73, false),
        "F5" => ((ushort)0x74, false),
        "F6" => ((ushort)0x75, false),
        "F7" => ((ushort)0x76, false),
        "F8" => ((ushort)0x77, false),
        "F9" => ((ushort)0x78, false),
        "F10" => ((ushort)0x79, false),
        "F11" => ((ushort)0x7A, false),
        "F12" => ((ushort)0x7B, false),
        "Semicolon" => ((ushort)0xBA, false),
        "Equal" => ((ushort)0xBB, false),
        "Comma" => ((ushort)0xBC, false),
        "Minus" => ((ushort)0xBD, false),
        "Period" => ((ushort)0xBE, false),
        "Slash" => ((ushort)0xBF, false),
        "Backquote" => ((ushort)0xC0, false),
        "BracketLeft" => ((ushort)0xDB, false),
        "Backslash" => ((ushort)0xDC, false),
        "BracketRight" => ((ushort)0xDD, false),
        "Quote" => ((ushort)0xDE, false),
        _ => MapLetterOrDigit(code),
    };

    private static (ushort vk, bool extended) MapLetterOrDigit(string code)
    {
        // "KeyA".."KeyZ" -> 0x41..0x5A ; "Digit0".."Digit9" -> 0x30..0x39
        if (code.Length == 4 && code.StartsWith("Key") && code[3] is >= 'A' and <= 'Z')
        {
            return ((ushort)(0x41 + (code[3] - 'A')), false);
        }
        if (code.Length == 6 && code.StartsWith("Digit") && char.IsDigit(code[5]))
        {
            return ((ushort)(0x30 + (code[5] - '0')), false);
        }
        // Numpad0..9 -> VK_NUMPAD0..9 (0x60..0x69)
        if (code.Length == 7 && code.StartsWith("Numpad") && char.IsDigit(code[6]))
        {
            return ((ushort)(0x60 + (code[6] - '0')), false);
        }
        return (0, false);
    }

    private void Send(INPUT input)
    {
        var sent = Native.SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
        if (sent != 1)
        {
            _log.LogWarning("SendInput failed: {Err}", Marshal.GetLastWin32Error());
            return;
        }
        InjectedCount++;
    }

    // ---- Verification helpers (self-test / diagnostics) ----

    public (int x, int y) GetCursorPos()
    {
        Native.GetCursorPos(out var p);
        return (p.X, p.Y);
    }

    public bool IsKeyDown(int vk) => (Native.GetAsyncKeyState(vk) & 0x8000) != 0;

    /// <summary>
    /// Non-destructive self-test: moves the cursor to 3 normalized positions and
    /// verifies GetCursorPos; presses/releases Shift and verifies async key state.
    /// </summary>
    public bool SelfTest()
    {
        var (w, h) = (Native.GetSystemMetrics(0), Native.GetSystemMetrics(1));
        _log.LogInformation("input self-test on screen {W}x{H}", w, h);

        foreach (var (nx, ny) in new[] { (0.25, 0.25), (0.75, 0.5), (0.5, 0.5) })
        {
            MouseMove(nx, ny);
            Thread.Sleep(120);
            var (x, y) = GetCursorPos();
            var expectX = (int)Math.Round(nx * (w - 1));
            var expectY = (int)Math.Round(ny * (h - 1));
            var okX = Math.Abs(x - expectX) <= 3;
            var okY = Math.Abs(y - expectY) <= 3;
            _log.LogInformation("mouse_move({NX},{NY}) -> cursor ({X},{Y}) expected ({EX},{EY}) {Ok}",
                nx, ny, x, y, expectX, expectY, okX && okY ? "OK" : "FAIL");
            if (!okX || !okY) return false;
        }

        Key("ShiftLeft", down: true);
        Thread.Sleep(60);
        var downOk = IsKeyDown(0x10);
        Key("ShiftLeft", down: false);
        Thread.Sleep(60);
        var upOk = !IsKeyDown(0x10);
        _log.LogInformation("key ShiftLeft down={Down} up={Up}", downOk ? "OK" : "FAIL", upOk ? "OK" : "FAIL");
        return downOk && upOk;
    }
}
