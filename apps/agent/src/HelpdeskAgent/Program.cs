using System.Text.Json;
using HelpdeskAgent;
using Microsoft.Extensions.Logging;

if (args.Length == 1 && args[0] == "--dump-api")
{
    ApiDump.Run();
    return 0;
}

if (args.Contains("--input-test"))
{
    var tlog = new ConsoleLogger();
    tlog.LogInformation("=== SendInput self-test (non-destructive) ===");
    var injector = new InputInjector(tlog);
    var ok = injector.SelfTest();
    tlog.LogInformation("SELF-TEST {Result}", ok ? "PASSED" : "FAILED");
    return ok ? 0 : 1;
}

// ---- Minimal console logger (no extra packages for the POC agent) ----
var log = new ConsoleLogger();

// ---- Args ----
string server = "http://localhost:4000";
string code = "";
string token = "";
var autoTest = false;

for (var i = 0; i < args.Length - 1; i++)
{
    switch (args[i])
    {
        case "--server": server = args[i + 1]; break;
        case "--code": code = args[i + 1]; break;
        case "--token": token = args[i + 1]; break;
    }
}
if (args.Contains("--auto-test")) autoTest = true;

if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(token))
{
    Console.Error.WriteLine("""
        Helpdesk Anywhere — Windows Endpoint Agent (POC)

        Usage:
          HelpdeskAgent --server http://localhost:4000 --code ABC123 --token <joinToken> [--auto-test]

        Get <joinToken> from the technician's session create response (join link).
        """);
    return 2;
}

log.LogInformation("=== Helpdesk Anywhere endpoint agent ===");
log.LogInformation("server={Server} code={Code}", server, code);

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

// ---- REST join ----
var api = new ApiClient(server, log);
var join = await api.JoinSessionAsync(code, token, cts.Token);

// ---- Signalling + WebRTC ----
var signalling = new SignallingClient(server, join.Session.Id, join.SignallingToken, log);
var session = new AgentSession(signalling, log);

var chatLog = new List<string>();
session.OnChatReceived += text =>
{
    chatLog.Add($"technician: {text}");
    if (autoTest)
    {
        // Phase 2 criterion: endpoint → browser echo test.
        session.SendChat($"echo: {text}");
    }
};

await session.StartAsync(cts.Token);
log.LogInformation("agent running — waiting for technician WebRTC offer…");

// ---- Interactive loop: type to chat, q to quit ----
if (!autoTest)
{
    while (!cts.IsCancellationRequested
           && session.State != SIPSorcery.Net.RTCPeerConnectionState.closed)
    {
        var line = await Task.Run(() => Console.ReadLine(), cts.Token);
        if (line is null) break;
        if (line is "q" or "quit" or "exit") break;
        if (!session.SendChat(line))
        {
            log.LogWarning("DataChannel not open yet — message not sent");
        }
    }
}
else
{
    // Headless mode: keep alive; periodic status line for automated verification.
    var started = DateTimeOffset.UtcNow;
    while (!cts.IsCancellationRequested
           && session.State != SIPSorcery.Net.RTCPeerConnectionState.closed
           && DateTimeOffset.UtcNow - started < TimeSpan.FromMinutes(10))
    {
        await Task.Delay(2000, cts.Token);
        log.LogInformation("status: state={State} dcOpen={DcOpen} chatRx={ChatRx} frames={Frames} encoded={Enc} lastSz={Sz} inputs={In}",
            session.State, session.DataChannelOpen, chatLog.Count, session.FramesCaptured, session.EncodedCount, session.LastEncodedSize, session.InjectedInputs);
    }
}

log.LogInformation("chat transcript ({N} messages): {Chat}", chatLog.Count, JsonSerializer.Serialize(chatLog));
session.Close("main loop exit");
await session.DisposeAsync();
log.LogInformation("agent exited cleanly");
return 0;

/// <summary>Minimal formatted console logger for the POC agent.</summary>
internal sealed class ConsoleLogger : Microsoft.Extensions.Logging.ILogger
{
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

    public void Log<TState>(
        Microsoft.Extensions.Logging.LogLevel logLevel,
        Microsoft.Extensions.Logging.EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        var level = logLevel switch
        {
            Microsoft.Extensions.Logging.LogLevel.Trace => "TRC",
            Microsoft.Extensions.Logging.LogLevel.Debug => "DBG",
            Microsoft.Extensions.Logging.LogLevel.Information => "INF",
            Microsoft.Extensions.Logging.LogLevel.Warning => "WRN",
            Microsoft.Extensions.Logging.LogLevel.Error => "ERR",
            _ => "???",
        };
        Console.WriteLine($"{DateTimeOffset.UtcNow:HH:mm:ss.fff} [{level}] {formatter(state, exception)}");
        if (exception is not null)
        {
            Console.WriteLine($"    {exception.GetType().Name}: {exception.Message}");
        }
    }
}
