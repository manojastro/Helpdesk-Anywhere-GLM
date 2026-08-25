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
configuration is needed for local work.

Windows agent (from `apps/agent`):

```bash
dotnet run --project src/HelpdeskAgent
```

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
