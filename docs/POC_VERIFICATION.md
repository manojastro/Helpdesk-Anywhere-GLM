# POC Verification Record

**Date:** 2026-08-23 · **Result: core POC end-to-end scenario VERIFIED on real
hardware** (with documented exceptions below).

All numbers below come from live runs on this Windows 11 machine (browser =
technician console, .NET 8 console agent = endpoint).

## Acceptance checklist (docs/POC_PLAN.md §10)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Technician opens web app | ✅ | Vite dev server, React console |
| 2 | Technician creates session | ✅ | Session `9FEKEQ` created via UI |
| 3 | Session code/token generated | ✅ | 6-char code + 24-byte join token; expiry proven live (403 "Join token expired") |
| 4 | Windows endpoint joins | ✅ | agent `--code 9FEKEQ --token …`; `endpoint_joined` audit event |
| 5 | Browser↔Windows WebRTC | ✅ | SIPSorcery 10 offer/answer + ICE, `state=connected` |
| 6 | Windows desktop visible live | ✅ | DXGI 1920×1080 → VP8 960×528; e.g. 472 frames captured = encoded; browser `176+ frames decoded · 0 lost`; canvas probe `σ=17.9` (real picture, not black) |
| 7 | Mouse movement | ✅ | `--input-test` self-test: cursor landed exactly (480,270)/(1439,540)/(960,540) for normalized (0.25,0.25)/(0.75,0.5)/(0.5,0.5); live remote injections counted (inputs=4 in acceptance run) |
| 8 | Mouse clicking | ✅ | click down/up injected (counter + cursor movement); UI-level "click Start menu" needs human operator (see below) |
| 9 | Keyboard input | ✅ | self-test: ShiftLeft down/up verified via GetAsyncKeyState; full KeyboardEvent.code→VK map incl. modifiers/arrows/function keys |
| 10 | Chat both directions | ✅ | "acceptance test message" → agent → "echo: acceptance test message" in UI; timestamps rendered (06:26 PM) |
| 11 | Direct WebRTC path | ✅ | host/srflx ICE, all sessions above |
| 12 | Forced TURN fallback | ⚠️ NOT RUN | Code paths complete (agent TURN env, browser `/config/ice` + `relay=1` forced-relay mode, coturn infra); no TURN server available in this environment (Docker daemon requires interactive setup; no GCP credentials). See "How to run it" below |
| 13–16 | Screen/mouse/kbd/chat through TURN | ⚠️ blocked by #12 | same |
| 17 | Either side disconnects cleanly | ✅ | "End session" → agent log `agent exited cleanly`; agent kill → browser showed `disconnected`/peer-left and chat retained |
| 18 | Session metadata stored | ✅ | `status=ended`, created/connected/ended timestamps (JSON above) |
| 19 | Audit events recorded | ✅ | session_created, technician_joined, endpoint_joined, peer_connected ×2, peer_left, session_ended |
| 20 | UAC spike completed | ✅ | `docs/uac-spike-findings.md` — live-tested: capture pauses (ACCESS_LOST→ACCESS_DENIED during secure desktop), input blocked by UIPI, auto-recovery after ~2-min consent timeout; UAC support NOT claimed |
| 21 | Repository known-good state | ✅ | milestone commits per phase (`git log --oneline`) |

## Stability evidence

- 10-minute continuous session: 143/143 status ticks `connected`, zero
  disconnected/failed, 1,632 frames captured, clean exit.
- Bandwidth controlled by integer downscale (≤1280 wide default, `HA_MAX_WIDTH`)
  after an early ICE collapse from uncapped 1080p VP8 (~300 KB frames).

## Automated tests

- Backend: 21/21 jest e2e green (session lifecycle, join tokens, signalling
  relay + membership enforcement, peer-left). Run: `npm test -w apps/backend`.

## Not verified here (and exactly how to verify)

1. **Forced TURN relay** (checklist 12–16):
   - Deploy coturn: `infra/gcp/terraform` (README has commands) or any coturn
     instance with static-auth-secret.
   - Point backend env: `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`
     (served to both peers via `GET /config/ice`).
   - Agent env: same TURN vars.
   - Open the console with `#/…&relay=1` — more precisely append `relay=1` to
     the URL hash (e.g. `http://<host>/#relay=1`) so the technician peer sets
     `iceTransportPolicy: 'relay'`, then run the full session; screen/mouse/
     keyboard/chat must all still work through the relay.
2. **GCP deployment** (Cloud Run / Cloud SQL / Compute Engine): Terraform plan
   validated by inspection only; no credentials in this environment. No
   deployment is claimed.
3. **Human-interactive control checks** ("open Start menu, launch app, type
   into Notepad"): the injection primitives are verified at OS level
   (self-test + live counter), but these flows need a human technician
   operating the console; ~15 minutes with the running stack.
4. **Browser-to-browser screen share** (Phase 1 loop): the automated signalling
   tests cover the protocol; media-level loop was superseded by the stronger
   browser↔.NET proof. The JoinPage includes a synthetic-stream fallback for
   headless contexts.

## Known POC limitations

- Single monitor only; agent targets adapter0/output0 matched to the primary
  screen.
- VP8 only, fixed quality, integer downscale; no bitrate API on the managed
  encoder.
- GDI fallback captures the primary screen via BitBlt when DXGI yields black
  frames (observed in some remote sessions).
- Agent is a console app (interactive worker). Windows Service lifecycle
  (AGENTS.md §10) is future work; not required for the POC flow.
- `painted: 0` in the console stats is an artifact of the in-app test browser
  lacking `requestVideoFrameCallback`; the canvas content probe (`σ=…`)
  is the reliable indicator.
