# AGENTS.md — Helpdesk Anywhere POC
## ZCode + GLM-5.3 Master Build Guide

> Google Cloud primary architecture • Browser technician console • Windows endpoint agent • WebRTC remote control

## 0. Purpose and Authority

This file is the **single authoritative source of truth** for the current Helpdesk Anywhere Proof of Concept (POC).

Helpdesk Anywhere is a browser-based remote IT support application inspired by products such as LogMeIn Rescue, TeamViewer, and AnyDesk.

The purpose of this POC is **not** to build the complete production platform. The purpose is to prove that the core remote-support engine works reliably on **Google Cloud Platform (GCP)**.

ZCode Agent must read this file fully before making architectural or implementation decisions.

### 0.1 Document priority

If project documentation conflicts, use this priority order:

1. `AGENTS.md`
2. `docs/POC_PLAN.md`
3. `docs/POC_SCOPE.md`
4. Existing implementation and protocol documentation
5. `docs/PRODUCTION_ROADMAP.md`

`AGENTS.md` always wins for the current POC.

`docs/PRODUCTION_ROADMAP.md` must never be used to expand POC scope unless the user explicitly requests that change.

### 0.2 Current implementation status

The current repository already contains reusable, cloud-agnostic work:

- `apps/backend`: NestJS backend with session REST API, join-token auth, audit/session events.
- Signalling WebSocket gateway doing SDP/ICE relay.
- `apps/web`: proven browser-to-browser WebRTC loop with screen sharing and DataChannel.
- `packages/shared`: TypeScript signalling protocol contracts.
- `apps/agent`: scaffold only; the real .NET Windows endpoint agent is not yet implemented.
- `infra/`: GCP infrastructure is not yet complete.

**Progress status:**

- Phase 0 — Repository scaffold: ✅ DONE
- Phase 1 — Browser-to-browser WebRTC: ✅ DONE
- Phase 2 — Windows agent WebRTC: 🔨 CURRENT / NEXT
- Phase 3 — Windows screen streaming: ⏳ PENDING
- Phase 4 — Remote control: ⏳ PENDING
- Phase 5 — Chat integration: ⏳ PENDING
- Phase 6 — TURN fallback: ⏳ PENDING
- Phase 7 — UAC / Secure Desktop feasibility spike: ⏳ PENDING
- Phase 8 — POC integration: ⏳ PENDING

Do not skip Phase 2 on the assumption that it is already complete.

---

# 1. POC Goal

Build a working end-to-end remote support prototype where:

1. A technician opens the Helpdesk Anywhere web application.
2. The technician creates a remote support session.
3. A Windows endpoint agent joins using a session code/token.
4. The technician can see the Windows desktop live.
5. The technician can remotely control mouse and keyboard.
6. Technician and end user can exchange basic chat messages.
7. WebRTC connects directly when possible.
8. If direct WebRTC fails, the session can fall back to TURN over TCP/TLS 443.
9. Either side can disconnect safely.
10. Basic session metadata is stored.
11. UAC / Secure Desktop is validated as a separate feasibility spike.

The POC is technically successful only when the end-to-end flow is demonstrated and the UAC feasibility result is documented.

---

# 2. Core POC Principles

## 2.1 Keep the POC small

Do not build production features unless explicitly requested.

The POC exists to validate the hardest technical assumptions:

- browser-to-Windows WebRTC
- Windows screen capture
- keyboard/mouse remote control
- TURN fallback
- enterprise-network compatibility
- UAC / Secure Desktop feasibility

Do not spend time on enterprise dashboards, DR, advanced RBAC, analytics, AI, or large-scale infrastructure before these are proven.

## 2.2 Google Cloud is the primary platform

For this POC, GCP is the actual build target.

Use:

- Cloud Run
- Cloud SQL for PostgreSQL
- Compute Engine for coturn
- Secret Manager when secrets are required
- Cloud Logging where useful

Do not build an Azure deployment unless explicitly requested.

## 2.3 Two-plane architecture

The application follows a two-plane model.

### Control plane

The backend handles:

- session creation
- technician identity / POC auth
- session join tokens
- signalling
- session lifecycle
- basic persistence
- basic audit/session metadata

### Remote session transport

The backend must **not** terminate or process screen/video remote desktop payload traffic.

Preferred path:

```text
Technician Browser
        ⇅
      WebRTC
        ⇅
Windows Endpoint Agent
```

Fallback path:

```text
Technician Browser
        ⇅
coturn TURN Relay
(TCP/TLS 443)
        ⇅
Windows Endpoint Agent
```

TURN may relay encrypted WebRTC transport.

The NestJS backend must never become a screen/video relay.

---

# 3. Locked POC Scope

Do not expand this scope unless the user explicitly requests it.

## 3.1 Technician web application

Required:

- simple technician login / POC identification
- session creation
- generated session ID / join token
- waiting state
- remote-screen viewer
- mouse input capture
- keyboard input capture
- basic chat panel
- connection status
- disconnect button

Technology:

- React
- Vite
- TypeScript
- native browser WebRTC APIs
- socket.io client for signalling

Keep the UI simple, professional, and functional.

Do not spend large amounts of time polishing UI during the POC.

## 3.2 Backend

Use a NestJS modular monolith.

Required responsibilities:

- temporary POC technician authentication
- create session
- join session
- end session
- session token generation
- session token expiry
- WebSocket signalling
- SDP relay
- ICE candidate relay
- basic session-state persistence
- basic audit/session events

Never process screen/video payloads inside the backend.

## 3.3 Windows endpoint agent

Use .NET 8.

Architecture should support:

- Windows Service for lifecycle/elevated coordination
- interactive worker process for user-session work
- signalling connection
- WebRTC peer connection
- Windows screen capture
- screen streaming
- mouse control
- keyboard control
- basic chat
- clean disconnect

Preferred screen capture:

- DXGI Desktop Duplication API

Preferred input:

- Windows `SendInput`

The normal-desktop worker may be implemented before Secure Desktop support.

## 3.4 WebRTC

The POC must prove:

- SDP offer/answer exchange
- ICE candidate exchange
- browser↔browser connection already proven
- browser↔.NET endpoint connection
- video transport
- WebRTC DataChannel
- TURN fallback

Remote-control commands and chat use DataChannels.

Screen/video uses a WebRTC video/media track.

---

# 4. Mandatory and Optional Features

## 4.1 Mandatory

- technician web app
- technician identification/login
- create support session
- session code/token
- Windows endpoint joins
- live screen view
- mouse control
- keyboard control
- direct WebRTC
- TURN fallback
- basic chat
- disconnect/end session
- basic session metadata
- basic audit events
- UAC / Secure Desktop feasibility spike

## 4.2 Optional — only after core POC is stable

- clipboard text sync
- simple file transfer
- basic multi-monitor detection
- connection quality indicator

Do not implement optional features before all mandatory normal-desktop features work.

---

# 5. Explicitly Out of Scope

Do not build these unless explicitly requested:

- full admin portal
- advanced dashboards
- unattended access
- device inventory
- full RBAC
- SSO hardening
- Conditional Access
- session transfer
- remote PowerShell
- advanced file transfer
- resumable file transfer
- multi-monitor production support
- reboot-and-auto-rejoin
- session recording
- sophisticated audit viewer
- analytics
- AI copilot
- RAG
- knowledge-base suggestions
- ticket drafting
- automatic ITSM integration
- DR
- cross-region failover
- production HA
- 500-user scale-out
- Kubernetes
- microservices
- message buses
- Kafka
- Firestore unless a clear POC need appears
- Redis unless a clear POC need appears
- production auto-update infrastructure

Future production scope belongs in `docs/PRODUCTION_ROADMAP.md`.

---

# 6. GCP POC Architecture

Use the smallest practical architecture.

```text
Technician Browser (React + WebRTC)
        │
        │ HTTPS / WSS 443
        ▼
Google Cloud Run
  - REST API
  - Signalling
  - Session logic
        │
        ▼
Cloud SQL (PostgreSQL)

Compute Engine
  - coturn
  - TURN/TCP/TLS 443
        ▲
        │ encrypted WebRTC relay when needed
        ▼
Windows Endpoint Agent (.NET 8)
  - DXGI Capture
  - WebRTC
  - DataChannel
  - SendInput
```

---

# 7. GCP Services

## 7.1 Cloud Run

Use Cloud Run for:

- NestJS REST API
- session management
- socket.io signalling

Cloud Run WebSocket connections must be designed for reconnection.

Do not assume a WebSocket connection stays alive forever.

Clients must be able to reconnect and rejoin the correct session.

Do not add production-grade distributed socket infrastructure unless a real POC limitation requires it.

## 7.2 Cloud SQL — PostgreSQL

Suggested tables:

### technicians

- id
- email
- display_name
- created_at

### sessions

- id
- session_code
- technician_id
- status
- created_at
- connected_at
- ended_at

### session_events

- id
- session_id
- event_type
- metadata
- created_at

Do not add Firestore simply because it exists.

## 7.3 Compute Engine — coturn

Use a small Linux VM.

TURN service must validate:

- TURN
- TURN over TCP
- TURN over TLS
- port 443 where practical

The purpose is to prove fallback connectivity, not production capacity.

---

# 8. Signalling Protocol

Keep signalling messages simple.

The existing working implementation currently uses:

Client → server:

- `signal:join`
- `signal:sdp`
- `signal:ice`

Server → client:

- `signal:peer-joined`
- `signal:peer-left`
- `signal:error`

Session create/join/end lifecycle is handled over REST.

These names are already tested and must not be renamed merely to match an illustrative spec.

Document the exact mapping in:

`docs/signalling-protocol.md`

The signalling backend must:

- authenticate peers
- verify session membership
- relay SDP
- relay ICE candidates
- avoid persisting SDP
- avoid inspecting media
- never relay screen/video payloads

Exactly two peers participate in the initial POC:

1. technician browser
2. Windows endpoint agent

---

# 9. Shared Protocol Contracts

Browser/backend protocol definitions remain in:

`packages/shared`

Use strongly typed TypeScript contracts.

Mirror the same protocol in C# models inside the endpoint agent.

Avoid undocumented duplicate message formats.

If a protocol change is required:

1. modify the shared contract
2. update backend
3. update browser
4. update C# endpoint model
5. run protocol/integration tests

---

# 10. Windows Endpoint Architecture

Do not put all functionality into a single Windows Service process.

Preferred architecture:

```text
Windows PC
┌──────────────────────────────────────────────┐
│ Helpdesk Anywhere Windows Service            │
│ LocalSystem                                  │
│                                              │
│ - lifecycle                                  │
│ - reconnect coordination                     │
│ - endpoint/session coordination              │
│ - secure-desktop coordination                │
│                                              │
│                 IPC                          │
│                  │                           │
│                  ▼                           │
│ Interactive Session Worker                   │
│                                              │
│ - DXGI screen capture                        │
│ - WebRTC                                     │
│ - mouse / keyboard injection                 │
│ - chat                                       │
└──────────────────────────────────────────────┘
```

For the first normal-desktop POC, focus on the interactive worker and required service coordination.

Secure Desktop support is a separate feasibility spike.

---

# 11. Screen Capture

Target pipeline:

```text
Windows Desktop
    ↓
DXGI Desktop Duplication
    ↓
Video Frame
    ↓
Encoder
    ↓
WebRTC Video Track
    ↓
Technician Browser
```

First objective:

- stable live desktop image
- acceptable latency
- usable mouse control
- usable keyboard control

Do not prematurely optimize:

- frame rate
- bitrate
- codec details
- dirty-region optimization
- image quality

Optimize only after the pipeline works.

---

# 12. Mouse and Keyboard

Technician browser captures input and sends it over a WebRTC DataChannel.

Example logical messages:

```json
{ "type": "mouse_move", "x": 0.45, "y": 0.62 }
{ "type": "mouse_click", "button": "left", "state": "down" }
{ "type": "key", "code": "KeyA", "state": "down" }
```

Use normalized screen coordinates.

Windows worker converts remote commands into Windows input events.

Validate:

- DPI scaling
- target display dimensions
- resolution mapping
- keyboard key-down/key-up behavior
- mouse button states
- coordinate bounds

Do not assume `SendInput` works on the UAC Secure Desktop.

---

# 13. Chat

Use a WebRTC DataChannel.

Required:

- technician sends text
- endpoint receives text
- endpoint sends text
- technician receives text
- timestamps
- minimal chat UI

Do not build chat search/history during the POC.

---

# 14. TURN Fallback

TURN validation is mandatory.

The test must intentionally make the direct ICE path unavailable.

Success means all core remote-support functions still work:

- screen
- mouse
- keyboard
- chat

through TURN over TCP/TLS 443 where supported by the validated stack.

Do not declare POC networking complete without this test.

---

# 15. UAC / Secure Desktop Feasibility Spike

Treat this as the highest-risk technical spike.

It is a feasibility validation, not a polished POC feature.

Test scenario:

1. Start remote session.
2. Confirm normal desktop screen viewing.
3. Confirm normal desktop remote control.
4. Launch an application requiring elevation.
5. Observe the UAC Secure Desktop transition.
6. Verify whether screen capture continues.
7. Verify whether remote input can interact with the prompt.
8. Approve/close UAC and confirm normal desktop session resumes.

Likely architecture:

```text
LocalSystem Service
       ↓ IPC
Interactive Worker
       +
Secure Desktop Helper
```

Do not claim full UAC support until demonstrated on a real Windows environment.

VM behavior may differ from physical hardware.

Record the findings in:

`docs/uac-spike-findings.md`

The report must state:

- Windows version tested
- VM or physical machine
- process/service privilege
- desktop/session context
- capture result
- input result
- reconnect/resume result
- blockers
- recommended next step

If reliable capture/control cannot cross the Secure Desktop boundary, stop and report the limitation before redesigning the entire application.

---

# 16. .NET WebRTC Library Validation

Do not blindly lock the project to a WebRTC library.

**Evaluate SIPSorcery first.**

Before committing to it for the POC, create the smallest possible proof validating:

1. browser↔.NET WebRTC connection
2. DataChannel works
3. video track can be sent to the browser
4. TURN works
5. TURN over TCP/TLS 443 works where supported
6. reconnection behavior is acceptable
7. sustained DataChannel traffic is stable

If SIPSorcery fails a critical requirement:

- capture the exact failure
- include logs/errors
- create the smallest reproducible test
- explain which POC requirement is blocked
- stop before silently replacing the WebRTC stack

Do not invent library capabilities.

Do not replace the library just because implementation is difficult.

Replacement requires a demonstrated blocker.

---

# 17. Mandatory Build Order

ZCode Agent must follow this order unless the user explicitly changes it.

## Phase 0 — Repository scaffold

**Status: ✅ DONE**

Expected structure includes:

- `apps/backend`
- `apps/web`
- `apps/agent`
- `packages/shared`
- `infra`
- `docs`

## Phase 1 — Browser-to-browser WebRTC

**Status: ✅ DONE**

Already proven:

- signalling
- room/session pairing
- SDP/ICE relay
- browser A ↔ browser B
- screen sharing
- DataChannel
- basic test chat

Do not rebuild this from scratch.

Reuse it as the known-good reference.

## Phase 2 — Windows Agent WebRTC

**Status: 🔨 CURRENT / NEXT**

Replace Browser B with the .NET endpoint.

First validate SIPSorcery.

Success criteria:

- .NET endpoint connects to signalling backend
- browser and .NET peer establish WebRTC
- DataChannel opens
- browser→endpoint test message succeeds
- endpoint→browser test message succeeds
- connection remains stable for a meaningful test period

Do not implement full DXGI capture before this succeeds.

## Phase 3 — Windows Screen Streaming

Add:

- DXGI Desktop Duplication capture
- frame conversion/encoding
- WebRTC video track
- browser rendering

Success criteria:

- technician sees the Windows desktop
- stream remains stable for a meaningful continuous test
- latency is usable for POC
- no fatal memory/CPU behavior

Do not prematurely optimize quality.

## Phase 4 — Remote Control

Add:

- normalized mouse movement
- left click
- right click
- wheel if easy
- keyboard key down/up
- DPI/resolution mapping
- Windows `SendInput`

Success criteria:

Technician can:

- open Start menu
- launch an application
- click controls
- type text
- move a window

## Phase 5 — Chat

Wire basic bidirectional chat over DataChannel.

Success criteria:

- browser→endpoint text
- endpoint→browser text
- timestamps
- minimal usable UI

## Phase 6 — TURN

Deploy/configure coturn on GCP.

Point browser and endpoint ICE configuration at the TURN service.

Deliberately force direct P2P failure.

Success criteria:

Through TURN, confirm:

- WebRTC connects
- video works
- mouse works
- keyboard works
- chat works

## Phase 7 — UAC / Secure Desktop Feasibility

Run the isolated spike from Section 15.

Do not let UAC block delivery of the normal-desktop POC.

Document the result even if the result is partial or negative.

## Phase 8 — Full POC Integration

Integrate:

- technician identification
- create session
- join token
- endpoint join
- screen
- mouse
- keyboard
- chat
- direct WebRTC
- TURN fallback
- disconnect
- session metadata
- audit events

Run the final acceptance scenario.

---

# 18. Final POC Success Criteria

The POC is complete only when the following scenario works:

```text
Technician opens Helpdesk Anywhere
    ↓
Technician creates session
    ↓
Session code/token generated
    ↓
Windows endpoint joins
    ↓
WebRTC established
    ↓
Windows desktop visible
    ↓
Mouse control works
    ↓
Keyboard control works
    ↓
Chat works
    ↓
Direct P2P path is deliberately blocked
    ↓
Session reconnects/works through TURN
    ↓
Either side can disconnect cleanly
```

Additionally:

- basic session metadata must be stored
- basic audit/session events must be recorded
- UAC / Secure Desktop feasibility must be separately documented

Do not mark the POC complete because individual components work independently.

The exact end-to-end flow must be demonstrated.

---

# 19. Non-Goals

Do not judge POC success based on:

- visual polish
- production scalability
- HA
- DR
- enterprise dashboards
- advanced observability
- complex database architecture
- hundreds of concurrent sessions
- automatic endpoint deployment
- enterprise compliance certification

The POC exists to prove the remote-support engine.

---

# 20. Coding Rules

## Always

- use TypeScript strict mode
- enable C# nullable reference types
- validate external input
- use structured logging
- keep protocol contracts explicit
- keep control plane separate from media plane
- implement error handling at external boundaries
- write small tests for session lifecycle/signalling
- preserve known-good functionality
- keep repository runnable after each milestone
- prefer working vertical slices over broad unfinished features

## Never

- route screen/video through NestJS
- invent APIs
- invent library capabilities
- silently change architecture
- add microservices
- add Kubernetes
- add Kafka
- add unnecessary databases
- add production-scale infrastructure during POC
- copy AGPL RustDesk code
- commit secrets
- log access tokens
- introduce hidden/persistent remote-access behavior outside the agreed POC

RustDesk or similar projects may be studied conceptually only; do not copy code with incompatible licensing.

---

# 21. Security Minimums

Even for the POC:

- use TLS
- use short-lived session tokens
- authorize session joins
- reject unknown peers
- expire session codes
- never commit secrets
- never log access tokens
- avoid persisting SDP/ICE
- if SDP/ICE debugging logs are temporarily enabled, remove/disable them afterward
- do not expose unrestricted PowerShell
- do not add hidden remote access
- provide visible session/disconnect behavior
- validate all network-facing inputs
- use least privilege where practical

Do not put real production credentials or customer data into model prompts, logs, tests, or committed configuration.

---

# 22. Locked / Validate / Deferred Decisions

| Decision | Default | Status |
|---|---|---|
| Browser WebRTC | Native `RTCPeerConnection` | PROCEED — already proven |
| Backend signalling | NestJS + socket.io | PROCEED — already proven |
| Backend hosting | Cloud Run | PROCEED |
| POC relational DB | Cloud SQL PostgreSQL | PROCEED |
| TURN | coturn on Compute Engine | PROCEED |
| Windows capture | DXGI Desktop Duplication | VALIDATE IN BUILD |
| Windows input | `SendInput` | VALIDATE IN BUILD |
| .NET WebRTC | SIPSorcery | VALIDATE FIRST |
| UAC Secure Desktop | SYSTEM service + helper architecture | HIGH-RISK VALIDATION |
| Firestore | Not required initially | DEFER |
| Redis | Not required initially | DEFER |
| Production scale-out | Not part of POC | DEFER |

---

# 23. ZCode Execution Contract

This section is mandatory.

ZCode Agent is responsible for implementing the POC incrementally.

Do **not** generate the entire application and assume it works.

For every phase:

1. Read `AGENTS.md`.
2. Inspect the current repository state.
3. Identify the current phase.
4. State the exact success criteria.
5. Identify technical assumptions that could affect architecture.
6. For any `VALIDATE` item, create the smallest possible experiment first.
7. Implement the smallest working increment.
8. Build.
9. Run.
10. Execute automated tests.
11. Execute applicable integration/manual verification.
12. Inspect compiler output, runtime logs, browser console, service logs, and network errors.
13. Fix root causes.
14. Rebuild.
15. Retest.
16. Verify the phase success criteria.
17. Commit the known-good working state.
18. Proceed only when the current phase passes.

## Mandatory loop

```text
INSPECT
  ↓
IMPLEMENT
  ↓
BUILD
  ↓
RUN
  ↓
TEST
  ↓
INSPECT LOGS
  ↓
FIX
  ↓
REBUILD
  ↓
RETEST
  ↓
VERIFY
  ↓
COMMIT
```

Never mark a feature complete merely because source code exists.

Never mark a phase complete because compilation alone passes.

Never proceed past a failed core acceptance criterion.

---

# 24. Failure and Recovery Rules

If an approach fails repeatedly:

1. Stop making random changes.
2. Re-read the relevant requirement.
3. Inspect the existing working reference implementation.
4. Reduce the problem to the smallest reproduction.
5. Capture exact logs/errors.
6. Verify the library/API actually supports the required behavior.
7. Identify whether the failure is:
   - implementation bug
   - configuration bug
   - environment limitation
   - network limitation
   - library limitation
   - architecture blocker
8. Fix the root cause.
9. Retest the minimal reproduction.
10. Reintegrate only after the minimal test succeeds.

If a critical architectural blocker is demonstrated:

- report it clearly
- preserve the last known-good commit
- do not silently replace locked technology
- do not expand scope to compensate
- propose the smallest viable alternative

---

# 25. Git and Repository Safety

Use Git checkpoints aggressively.

At minimum, create a commit after each successfully verified phase.

Recommended milestone tags/commit labels:

- `poc-phase-2-webrtc-dotnet-working`
- `poc-phase-3-screen-stream-working`
- `poc-phase-4-remote-input-working`
- `poc-phase-5-chat-working`
- `poc-phase-6-turn-working`
- `poc-phase-7-uac-spike-documented`
- `poc-phase-8-end-to-end-working`

Before risky architecture work:

- ensure working tree status is understood
- preserve current known-good implementation
- do not delete working code without a proven replacement

Do not rewrite unrelated working components.

---

# 26. Testing Requirements

## Backend

Test:

- session creation
- valid join
- invalid/expired token
- unauthorized join
- session end
- signalling membership enforcement
- peer leave/disconnect behavior

## Browser

Test:

- session create flow
- waiting state
- remote video render
- DataChannel state
- input capture
- chat
- disconnect
- reconnect behavior where implemented

## Windows Agent

Test:

- signalling reconnect
- WebRTC setup
- DataChannel send/receive
- screen capture lifecycle
- capture cleanup
- input command validation
- DPI/resolution mapping
- disconnect cleanup

## End-to-end

At minimum validate on two endpoints:

- technician browser
- Windows endpoint agent

Then validate forced TURN fallback.

UAC spike must be tested separately.

---

# 27. GCP Infrastructure Rules

Keep infrastructure minimal.

Preferred `infra/gcp/` structure:

```text
infra/gcp/
├── backend.Dockerfile
├── coturn/
│   └── startup.sh
└── terraform/
    ├── main.tf
    ├── variables.tf
    ├── outputs.tf
    └── README.md
```

Infrastructure scope:

- Cloud Run backend
- Cloud SQL PostgreSQL
- Secret Manager
- Compute Engine coturn VM
- required networking/firewall configuration
- Cloud Logging where useful

Do not create production HA architecture.

Do not create Kubernetes.

Do not create multi-region infrastructure.

For infrastructure-as-code:

- validate syntax
- run format/lint
- run plan/dry-run where credentials are available
- do not claim deployment success unless resources were actually deployed and verified

---

# 28. Definition of "Done"

A task is not done when:

- code was generated
- code compiles
- unit tests alone pass
- UI renders
- one component works in isolation

A task is done when:

- the required behavior works
- relevant tests pass
- logs show no unresolved fatal error
- integration with already-completed phases still works
- acceptance criteria are explicitly verified
- a known-good Git checkpoint exists

---

# 29. Priority Rule for Limited Development Time

If development time is limited, prioritize in this exact order:

1. browser↔.NET WebRTC
2. screen streaming
3. mouse/keyboard
4. session flow
5. TURN fallback
6. chat
7. disconnect/session logging
8. UAC feasibility spike documentation
9. optional features

Do not sacrifice the core remote-control path for UI polish or optional features.

---

# 30. Final POC Definition

Helpdesk Anywhere POC is complete when we have proven:

**Browser technician → secure session → Windows screen → remote mouse/keyboard → chat → TURN fallback → clean disconnect**

with:

- basic session metadata
- basic audit events
- UAC/Secure Desktop separately validated and documented

Everything else belongs to the MVP or production roadmap.

---

# 31. First Instruction for a New ZCode Session

At the beginning of a new development session:

1. Read `AGENTS.md` fully.
2. Read `docs/POC_PLAN.md`.
3. Inspect Git status and recent commits.
4. Inspect the repository instead of assuming file state.
5. Determine the earliest incomplete phase.
6. Restate that phase's success criteria.
7. Continue from the existing known-good state.
8. Do not restart completed phases.
9. Execute the mandatory build/test/fix/verify/commit loop.
