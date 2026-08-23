using System.Net.Http.Json;
using Microsoft.Extensions.Logging;

namespace HelpdeskAgent;

/// <summary>Minimal REST client for the control plane (session join only).</summary>
public sealed class ApiClient
{
    private readonly HttpClient _http;
    private readonly ILogger _log;

    public ApiClient(string baseUrl, ILogger log)
    {
        _http = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
        _log = log;
    }

    public async Task<JoinSessionResponse> JoinSessionAsync(
        string code, string joinToken, CancellationToken ct)
    {
        var body = new JoinSessionRequest(joinToken, "endpoint");
        var res = await _http.PostAsJsonAsync($"sessions/{code}/join", body, cancellationToken: ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            _log.LogError("join failed: {Status} {Body}", res.StatusCode, json);
            throw new HttpRequestException($"join failed: {(int)res.StatusCode}");
        }
        var parsed = System.Text.Json.JsonSerializer.Deserialize<JoinSessionResponse>(json);
        if (parsed is null) throw new InvalidOperationException("empty join response");
        _log.LogInformation("joined session {Code} ({Status})", parsed.Session.Code, parsed.Session.Status);
        return parsed;
    }

    public async Task<Dictionary<string, object>?> FetchIceConfigAsync(CancellationToken ct)
    {
        try
        {
            return await _http.GetFromJsonAsync<Dictionary<string, object>>("config/ice", ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning("ice config fetch failed: {Msg}", ex.Message);
            return null;
        }
    }
}
