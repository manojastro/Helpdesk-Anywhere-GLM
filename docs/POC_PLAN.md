# Helpdesk Anywhere — POC Execution Plan
## GCP • Narrow Scope • ZCode + GLM-5.3

## 1. Purpose

This document supports `AGENTS.md`.

`AGENTS.md` is authoritative if any conflict appears.

This plan records:

- what is already reusable
- what remains to be built
- the execution order
- the verification expected after each increment

The current target is the narrow GCP POC, not the full production platform.

---

# 2. Current State

The repository contains useful cloud-agnostic implementation already.

### Reusable

- NestJS backend modules for sessions/auth/audit.
- socket.io signalling gateway.
- browser-to-browser WebRTC proof.
- shared TypeScript signalling contracts.
- development-mode lightweight auth path.

### Not yet complete

- real .NET 8 Windows endpoint agent.
- browser↔.NET WebRTC validation.
- Windows DXGI screen capture pipeline.
- remote mouse/keyboard integration.
- GCP coturn deployment and forced TURN test.
- UAC / Secure Desktop feasibility spike.
- final end-to-end POC integration.

The Windows endpoint agent is the largest remaining technical risk.

---

# 3. Scope Reconciliation

For the current POC:

- GCP is the target cloud.
- lightweight POC technician auth is acceptable.
- existing cloud-agnostic backend/signalling code should be reused.
- production-only features remain deferred.

Do not pull forward:

- admin portal
- PowerShell
- advanced file transfer
- session transfer
- reboot/rejoin
- production multi-monitor
- advanced RBAC
- enterprise SSO
- AI features
- production HA/DR
- hundreds-of-sessions scale architecture

---

# 4. Immediate Repository Documentation Work

Before feature work, ensure the repository contains:

```text
AGENTS.md
docs/POC_PLAN.md
docs/POC_SCOPE.md
docs/PRODUCTION_ROADMAP.md
docs/signalling-protocol.md
```

`AGENTS.md` is the ZCode runtime instruction source.

`docs/PRODUCTION_ROADMAP.md` preserves future production scope.

`docs/POC_SCOPE.md` should state that the current track is the narrow GCP POC and that production scope must not be pulled forward.

---

# 5. Reuse vs Rework

| Area | Action |
|---|---|
| `apps/backend` NestJS modules | Reuse |
| Session REST API | Reuse |
| Join-token/session auth | Reuse |
| Audit/session events | Reuse |
| socket.io signalling gateway | Reuse |
| Browser WebRTC reference | Reuse |
| `packages/shared` protocol names | Keep existing names |
| Real technician session flow | Finish/integrate |
| `.NET` endpoint agent | Build |
| DXGI capture | Build and validate |
| `SendInput` remote input | Build and validate |
| coturn | Build/deploy/validate |
| GCP infra | Build minimal POC infrastructure |
| UAC Secure Desktop | Separate feasibility spike |

Do not churn working protocol event names just to make them look like another document.

---

# 6. Recommended Forward Build Order

## Increment A — Documentation sanity

- install final `AGENTS.md`
- place this file at `docs/POC_PLAN.md`
- preserve production roadmap
- verify phase status is consistent

Verification:

- Phase 0 and Phase 1 show DONE.
- Phase 2 shows CURRENT/NEXT.
- No document claims the .NET Windows agent is already finished.

## Increment B — Minimal GCP scaffold

Create:

- backend Dockerfile suitable for Cloud Run
- minimal Cloud SQL configuration
- Secret Manager integration/config placeholders
- coturn Compute Engine startup/config
- minimal Terraform or documented `gcloud` approach

Verification:

- local Docker build succeeds
- infrastructure configuration validates/plans where environment permits
- no production-scale resources are introduced

## Increment C — Real technician session flow

Move beyond the ad-hoc browser loop test.

Wire:

- session creation through existing REST API
- join code/token
- signalling join with valid session credentials
- waiting state
- real peer lifecycle
- remote video renderer
- disconnect
- minimal DataChannel chat

Verification:

- two browser tabs can still complete the flow through the real session API
- no regression from the original browser-to-browser proof

## Increment D — Phase 2: .NET network contract

Scaffold/complete `apps/agent` as a .NET 8 Windows endpoint.

First deliverable:

- signalling client
- WebRTC peer
- DataChannel

Validate SIPSorcery using the smallest experiment.

Verification:

- browser↔.NET connection established
- DataChannel opens
- test messages work both ways
- connection remains stable

Do not add DXGI until this passes.

## Increment E — Phase 3: Windows screen streaming

Implement:

```text
DXGI Desktop Duplication
    ↓
frame conversion / encoding
    ↓
WebRTC video track
    ↓
browser renderer
```

Verification:

- live Windows desktop appears in browser
- stream remains stable
- resource consumption is acceptable for a POC
- clean start/stop works

## Increment F — Phase 4: Remote input

Implement DataChannel control protocol.

Add:

- mouse movement
- click down/up
- right click
- keyboard down/up
- normalized coordinates
- DPI/resolution mapping
- `SendInput`

Verification:

Technician can:

- open Start menu
- launch app
- type in text field
- click UI
- move a window

## Increment G — Phase 5: Chat

Implement minimal bidirectional DataChannel chat.

Verification:

- both directions work
- timestamps render
- disconnect cleanup is correct

## Increment H — Phase 6: TURN

Deploy/configure coturn.

Configure both browser and endpoint ICE servers.

Force direct P2P failure.

Verification:

Through TURN:

- WebRTC connects
- screen works
- mouse works
- keyboard works
- chat works

Do not declare networking complete without a forced-relay test.

## Increment I — Phase 7: UAC / Secure Desktop spike

Prototype separately.

Test:

- normal desktop control
- UAC transition
- capture behavior
- input behavior
- return to normal desktop

Record findings in:

`docs/uac-spike-findings.md`

Do not claim full support unless actually proven.

## Increment J — Phase 8: Final integration

Run the complete POC acceptance path.

Verification:

```text
Create session
→ endpoint joins
→ WebRTC
→ live screen
→ mouse
→ keyboard
→ chat
→ forced TURN
→ clean disconnect
→ metadata/audit present
```

UAC result must also be documented.

---

# 7. SIPSorcery Decision Gate

SIPSorcery is a candidate, not an unquestioned permanent decision.

Before committing to it, verify:

- browser↔.NET peer connection
- DataChannel
- video track
- TURN
- TURN TCP/TLS 443 where supported
- reconnection characteristics
- sustained DataChannel traffic

If one requirement fails:

1. capture the exact issue
2. produce a minimal reproduction
3. determine whether it is configuration, implementation, or library limitation
4. report the blocker
5. preserve the last known-good state

Do not silently substitute another stack.

---

# 8. Verification Discipline

After every increment:

```text
BUILD
→ RUN
→ TEST
→ INSPECT LOGS
→ FIX
→ RETEST
→ VERIFY
→ COMMIT
```

A generated implementation is not a completed implementation.

A compiling implementation is not necessarily a working implementation.

---

# 9. Recommended Git Milestones

Use meaningful commits/checkpoints such as:

```text
docs-zcode-poc-baseline
poc-dotnet-webrtc-working
poc-screen-stream-working
poc-remote-input-working
poc-chat-working
poc-turn-working
poc-uac-spike-documented
poc-end-to-end-working
```

Do not begin a high-risk change without a known-good checkpoint.

---

# 10. Final Acceptance Checklist

The POC is successful when all applicable items pass:

- [ ] Technician can open the web app.
- [ ] Technician can create a support session.
- [ ] Session code/token is generated.
- [ ] Windows endpoint can join using the session details.
- [ ] Browser↔Windows WebRTC connection succeeds.
- [ ] Windows desktop is visible live.
- [ ] Mouse movement works.
- [ ] Mouse clicking works.
- [ ] Keyboard input works.
- [ ] Chat works both directions.
- [ ] Direct WebRTC path works when available.
- [ ] Forced TURN fallback works.
- [ ] Screen works through TURN.
- [ ] Mouse works through TURN.
- [ ] Keyboard works through TURN.
- [ ] Chat works through TURN.
- [ ] Either side can disconnect cleanly.
- [ ] Basic session metadata is stored.
- [ ] Basic audit/session events are recorded.
- [ ] UAC / Secure Desktop feasibility test is completed.
- [ ] UAC findings are documented accurately.
- [ ] Repository is left in a known-good committed state.

---

# 11. Recommended First ZCode Task

Use the following as the first instruction after placing `AGENTS.md` and this document in the repository:

```text
Read AGENTS.md and docs/POC_PLAN.md fully.

Inspect the repository, Git status, recent commits, apps/backend,
apps/web, apps/agent, packages/shared, infra, and docs.

Do not assume the written status is correct without checking the repo.

Determine the earliest incomplete POC phase.

The expected next phase is Phase 2 — browser-to-.NET Windows Agent
WebRTC — unless repository evidence shows otherwise.

Before implementing broad Windows functionality, create the smallest
possible SIPSorcery validation proving:

1. browser↔.NET WebRTC establishment,
2. bidirectional DataChannel messages,
3. a browser-consumable video-track path,
4. TURN compatibility requirements relevant to this POC.

Follow the mandatory cycle:

INSPECT → IMPLEMENT → BUILD → RUN → TEST → INSPECT LOGS
→ FIX → RETEST → VERIFY → COMMIT.

Do not work on optional or production features.
Do not mark a phase complete merely because code was generated.
Preserve all previously working functionality.
```
