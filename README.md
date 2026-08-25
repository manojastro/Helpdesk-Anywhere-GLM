# Helpdesk Anywhere — POC

Browser-based remote IT support proof of concept. See `AGENTS.md` (authoritative)
and `docs/POC_PLAN.md`.

## Layout

```
apps/backend    NestJS control plane: sessions, tokens, signalling relay, audit
apps/web        React + Vite technician console (native WebRTC)
apps/agent      .NET 8 Windows endpoint agent (SIPSorcery, DXGI, SendInput)
packages/shared TypeScript protocol contracts shared by backend + web
infra/gcp       Cloud Run / Cloud SQL / coturn / Terraform (POC-minimal)
docs            Plans, protocol docs, spike findings
```

## Local development

```bash
npm install
npm run build
npm run dev:backend   # NestJS on :4000 (SQLite by default; PG via DATABASE_URL)
npm run dev:web       # Vite on :5173
```

The Vite dev server proxies `/api` and `/socket.io` to `localhost:4000`, so no
configuration is needed for local work. See `.env.example` for every environment
variable the backend, console and agent read, and their defaults.

### Windows endpoint agent

Requires **Windows** and the **.NET 8 SDK** — the agent targets
`net8.0-windows` and uses WinForms, DXGI Desktop Duplication and `SendInput`,
so it does not build or run on Linux or macOS.

**This is the only endpoint that can actually control a machine.** The browser
`#/join` page cannot inject input into Windows — see "Remote control" below.

Build it once, then start it from the join link the console shows:

```bash
dotnet publish src/HelpdeskAgent -c Release -r win-x64 --self-contained false -o publish
```

```powershell
.un-agent.ps1 -JoinLink "http://localhost:5173/#/join?code=ABC123&token=..."
```

`run-agent.ps1` pulls `code` and `token` out of the link and points the agent at
the backend (port 4000 when the link came from the Vite dev server on 5173).
Useful switches while testing: `-NoInput` joins without accepting remote
mouse/keyboard, `-NoVideo` joins without sharing the screen, and `-Gdi` forces
the GDI capture path when DXGI returns black frames (e.g. over RDP).

While the agent runs it streams that desktop and lets the technician control the
machine. Ctrl+C stops it.

The raw invocation, if you prefer it — `--code` and `--token` are mandatory and
without them the agent prints usage and exits with code 2:

```bash
dotnet run --project src/HelpdeskAgent -- --server http://localhost:4000 --code ABC123 --token <joinToken>
```

Self-test of the input path only (non-destructive, no session needed):

```bash
dotnet run --project src/HelpdeskAgent -- --input-test
```

## Remote control

The technician console captures mouse and keyboard and sends them over the
WebRTC DataChannel as normalized 0..1 coordinates (`packages/shared/src/control.ts`).

**Only the .NET Windows agent can actually control a machine.** The browser
`#/join` page is a stand-in for proving the WebRTC path: a web page cannot
inject input into Windows, so it *visualises* the technician's mouse and
keyboard instead of acting on them. If you test with two browser tabs, screen
sharing works and control appears to do nothing — that is expected. Use the
agent for real control.

Supported from the console: pointer move, left/middle/right press and release,
drag, wheel, and full keyboard including modifiers, with `Ctrl+Alt+Del`, `Win`,
`Alt+Tab` and `Esc` toolbar buttons. A **Remote control** toggle switches the
session to view-only.

Notes and limits:

- Keyboard is captured at the window, so it keeps working regardless of which
  element has focus — except while you are typing in the chat box.
- Browser-reserved shortcuts (`Ctrl+W`, `Ctrl+T`, `F5`, `F12`, …) are swallowed
  and forwarded to the remote machine instead.
- Keys and buttons held down are released automatically if the console loses
  focus, so nothing sticks down on the endpoint.
- `Ctrl+Alt+Del` is sent, but Windows reserves the Secure Attention Sequence:
  an ordinary unelevated agent **cannot** trigger it, and the key sequence will
  be ignored. The same applies during a UAC prompt — see
  `docs/uac-spike-findings.md`.
- Wheel delta uses the Windows convention (positive = scroll up), which is the
  opposite sign to the browser's `WheelEvent.deltaY`.

## Deploying the web console

The console is a static Vite bundle (`npm run build -w apps/web` → `apps/web/dist`).
`VITE_API_BASE` decides where it looks for the backend; it is baked in at build
time, so it must be set before `vite build`.

**Same-origin behind a reverse proxy (default — no env needed).** Serve
`apps/web/dist` and route `/api` and `/socket.io` on the same origin to the
backend. `VITE_API_BASE` defaults to `/api`, and socket.io uses the page's own
origin. Nothing else to configure.

**Separate backend host.** Build with the backend's origin:

```bash
VITE_API_BASE=https://backend.example.com npm run build -w apps/web
```

REST and socket.io then both target that origin, which is a cross-origin
request — so the backend must also allow the console's origin:

```bash
CORS_ORIGIN=https://console.example.com
```

Leaving `CORS_ORIGIN` unset reflects any origin in development, but allows
same-origin only when `NODE_ENV=production`.

## Rules

- The backend is control-plane only. Screen/video never transits NestJS.
- Transport: direct WebRTC, falling back to coturn TURN (TCP/TLS 443).
- See `docs/POC_SCOPE.md` for what is explicitly out of scope.
