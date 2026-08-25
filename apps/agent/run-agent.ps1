<#
.SYNOPSIS
  Starts the Helpdesk Anywhere Windows endpoint agent from a technician join link.

.DESCRIPTION
  The agent needs --code and --token separately, but the console shows a single
  join link. This pulls both out of the link so you can paste it verbatim.

  WARNING: while the agent runs it streams this desktop to the technician and
  lets them move the mouse and type on this machine. Use -NoInput or -NoVideo
  to hold one of those back, and Ctrl+C to stop.

.EXAMPLE
  .\run-agent.ps1 -JoinLink "http://localhost:5173/#/join?code=ABC123&token=xyz"

.EXAMPLE
  .\run-agent.ps1 -Code ABC123 -Token xyz -Server http://localhost:4000
#>
[CmdletBinding(DefaultParameterSetName = 'Link')]
param(
    [Parameter(ParameterSetName = 'Link', Mandatory, Position = 0)]
    [string]$JoinLink,

    [Parameter(ParameterSetName = 'Parts', Mandatory)]
    [string]$Code,

    [Parameter(ParameterSetName = 'Parts', Mandatory)]
    [string]$Token,

    [string]$Server = 'http://localhost:4000',

    # Join without publishing a screen track (signalling + chat only).
    [switch]$NoVideo,

    # Join without accepting remote mouse/keyboard input.
    [switch]$NoInput,

    # Force the GDI capture path instead of DXGI auto-detection.
    [switch]$Gdi
)

$ErrorActionPreference = 'Stop'
$agentDir = $PSScriptRoot

if ($PSCmdlet.ParameterSetName -eq 'Link') {
    # code/token live in the URL fragment: .../#/join?code=ABC123&token=...
    $query = ($JoinLink -split '\?', 2)[1]
    if (-not $query) { throw "No query string in join link. Expected .../#/join?code=...&token=..." }
    $pairs = @{}
    foreach ($kv in $query -split '&') {
        $parts = $kv -split '=', 2
        if ($parts.Count -eq 2) { $pairs[$parts[0]] = [uri]::UnescapeDataString($parts[1]) }
    }
    $Code = $pairs['code']
    $Token = $pairs['token']
    if (-not $Code -or -not $Token) { throw "Join link is missing code or token." }

    # A link like http://host:5173/#/join... points at the console; the agent
    # needs the backend. Only override the default if the caller did not.
    if (-not $PSBoundParameters.ContainsKey('Server')) {
        $consoleUri = [uri](($JoinLink -split '#', 2)[0])
        if ($consoleUri.Port -eq 5173) {
            $Server = "$($consoleUri.Scheme)://$($consoleUri.Host):4000"
        } else {
            $Server = "$($consoleUri.Scheme)://$($consoleUri.Authority)"
        }
    }
}

if ($NoVideo) { $env:HA_NO_VIDEO = '1' }
if ($NoInput) { $env:HA_INPUT = '0' }
if ($Gdi)     { $env:HA_CAPTURE = 'gdi' }

$exe = Join-Path $agentDir 'publish\HelpdeskAgent.exe'

Write-Host "Helpdesk Anywhere agent" -ForegroundColor Cyan
Write-Host "  server : $Server"
Write-Host "  code   : $Code"
Write-Host "  video  : $(if ($NoVideo) { 'disabled' } else { 'sharing this desktop' })"
Write-Host "  input  : $(if ($NoInput) { 'disabled' } else { 'technician can control this machine' })"
Write-Host ""

if (Test-Path $exe) {
    & $exe --server $Server --code $Code --token $Token
} else {
    Write-Host "publish\HelpdeskAgent.exe not found - building from source." -ForegroundColor Yellow
    Write-Host "Run this first for a faster start:" -ForegroundColor Yellow
    Write-Host "  dotnet publish src/HelpdeskAgent -c Release -r win-x64 --self-contained false -o publish`n"
    & dotnet run --project (Join-Path $agentDir 'src\HelpdeskAgent') -- `
        --server $Server --code $Code --token $Token
}

exit $LASTEXITCODE
