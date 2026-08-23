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

Windows agent (from `apps/agent`):

```bash
dotnet run --project src/HelpdeskAgent
```

## Rules

- The backend is control-plane only. Screen/video never transits NestJS.
- Transport: direct WebRTC, falling back to coturn TURN (TCP/TLS 443).
- See `docs/POC_SCOPE.md` for what is explicitly out of scope.
