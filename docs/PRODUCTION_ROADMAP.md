# Production Roadmap (Post-POC)

> Placeholder — preserved location for post-POC production scope.

This document collects everything deliberately **deferred** during the POC so
future sessions can pick it up without re-deriving decisions. The POC track is
governed by `AGENTS.md`; this file must never be used to expand POC scope.

## Deferred to production phase

- Azure deployment option (Azure was the original full-platform target before
  the GCP POC pivot; revisit cloud strategy after POC)
- Real Entra ID / MSAL authentication, RBAC, Conditional Access
- Admin portal and advanced dashboards
- Unattended access and device inventory
- Remote PowerShell / script execution
- Advanced and resumable file transfer
- Session transfer, pause/resume, reboot-and-rejoin
- Production multi-monitor support
- Session recording and playback
- Analytics and sophisticated audit viewer
- AI copilot, RAG, knowledge-base suggestions, ticket drafting, ITSM automation
- Kubernetes / microservices / message buses
- Production HA/DR, multi-region failover, ~500 concurrent session scale-out
- Auto-update infrastructure for the Windows agent

This list intentionally mirrors `docs/POC_SCOPE.md`. Keep both in sync when
scope decisions change.
