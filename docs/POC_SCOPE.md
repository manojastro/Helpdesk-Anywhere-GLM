# POC Scope Statement

## Current track

This repository is currently executing the **narrow GCP POC** defined in `AGENTS.md` and `docs/POC_PLAN.md`.

The POC proves the core remote-support engine only:

- browser technician console (React + native WebRTC)
- NestJS control plane (sessions, tokens, signalling, audit) — **never** carries screen/video payloads
- .NET 8 Windows endpoint agent (DXGI capture, SendInput, WebRTC, DataChannels)
- direct WebRTC transport with coturn TURN/TCP/TLS 443 fallback
- UAC / Secure Desktop feasibility spike (documented separately)

## Do not pull production scope forward

The following remain **out of scope** for this track. They belong to
`docs/PRODUCTION_ROADMAP.md` and must not be implemented unless the user
explicitly requests it:

- admin portal, advanced dashboards
- unattended access, device inventory
- full RBAC, SSO/Entra ID hardening, Conditional Access
- remote PowerShell
- advanced/resumable file transfer
- session transfer, reboot-and-auto-rejoin
- production multi-monitor support
- session recording, analytics, sophisticated audit viewer
- AI copilot / RAG / ticketing / ITSM automation
- Kubernetes, microservices, message buses, Kafka
- production HA/DR, multi-region, 500-user scale-out
- Azure deployment (GCP is the POC target; Azure is a production-phase concern)

If a request appears to conflict with this list, stop and confirm with the
user before expanding scope.
