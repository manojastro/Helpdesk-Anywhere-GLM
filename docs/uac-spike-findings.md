# UAC / Secure Desktop Feasibility Spike — Findings

**Date:** 2026-08-23 · **Status:** Spike complete (normal-desktop POC unaffected) ·
UAC support is **NOT claimed** — see Recommendation.

## Test environment

| Item | Value |
|---|---|
| Windows version | Windows 11 Home Single Language, 10.0.26200 |
| Machine | Physical/console session (`SESSIONNAME=Console`), single 1920×1080 output |
| UAC policy | `EnableLUA=1`, `ConsentPromptBehaviorAdmin=5`, `PromptOnSecureDesktop=1` |
| Agent privilege | Normal interactive user process, **medium integrity, not elevated** |
| Desktop/session context | Agent runs in the interactive user desktop (`winsta0\Default`), user session |
| Capture path under test | DXGI Desktop Duplication (GDI fallback available for RDP-black DXGI) |
| Input path under test | `SendInput` from the same medium-IL process |

## Test procedure (per AGENTS.md §15)

1. Started a live remote session (technician browser ↔ .NET agent, screen
   streaming confirmed active — frames flowing, video decoding in browser).
2. Confirmed normal-desktop capture and remote input channels operational.
3. Launched an elevation-requiring command (`Start-Process cmd -Verb RunAs`) →
   UAC consent appeared **on the Secure Desktop**.
4. Observed capture behavior and attempted remote input during the prompt.
5. Took no local action on the prompt; waited for the consent timeout.
6. Confirmed return-to-desktop behavior and session resumption.

## Results

### Screen capture during Secure Desktop — STOPS (expected)

The moment the secure desktop activated:

- DXGI duplication raised `DXGI_ERROR_ACCESS_LOST (0x887A0026)`.
- Every re-duplication attempt while the secure desktop was active failed with
  `E_ACCESSDENIED (0x80070005)` — logged ~1×/s by the agent's recovery loop
  (121 attempts over the prompt's lifetime).
- Encoded frame count froze (98 frames → no further frames); the last frame
  remained displayed to the technician (frozen picture, not a black screen).
- **WebRTC connection and DataChannel stayed alive** throughout — the transport
  does not fail, only capture pauses.

### Remote input during Secure Desktop — BLOCKED (expected)

- Remote `mouse_move`/`mouse_click` sent from the technician while the prompt
  was displayed were injected by the agent (injection counter incremented) but
  **did not reach the consent dialog** — UIPI blocks medium-integrity
  `SendInput` from targeting the secure desktop (high integrity).
- The prompt was unaffected by remote input and was eventually dismissed by
  the **consent timeout (~2 minutes)**, not by any input.

### Return to normal desktop — session resumes automatically

- At the consent timeout the desktop returned and the agent's recovery loop
  re-established duplication (`DXGI duplication recovered (attempt 121)`).
- With the post-spike fix, the first frame after recovery is pushed even on an
  idle desktop (`_forceNextFrame`), so the technician's view unfreezes
  immediately instead of waiting for the next desktop update.
- WebRTC/DataChannel/chat never dropped; the same session continued.

## Limitations of this spike

- Tested on one Windows 11 Home machine; Group Policy machines
  (`ConsentPromptBehaviorAdmin` variants), multi-monitor, and
  domain-joined/AD environments may differ.
- VM behavior (per AGENTS.md) untested.
- The spike observed capture+input from a medium-IL process only; no
  LocalSystem service or secure-desktop helper was implemented.

## Recommendation

1. **Ship the normal-desktop POC as-is** — secure-desktop transitions do not
   kill the session; capture pauses and then auto-recovers. This is acceptable
   POC behavior and matches commercial tools' first versions.
2. For full UAC support, validate in an MVP increment the architecture from
   AGENTS.md §10: `LocalSystem Windows Service → IPC → Interactive Worker` +
   a **Secure Desktop Helper**:
   - A LocalSystem (or appropriately privileged) component that runs in the
     user session can potentially capture the secure desktop by creating a
     duplication handle while attached to `winsta0\Winlogon`; `SendInput`
     across the boundary additionally requires high integrity
     (elevated/UIAccess-signed helper).
   - Both capture and input across the secure desktop remain **unproven** in
     this spike and must be demonstrated on real hardware before any claim.
3. Document to end users (MVP): during a UAC prompt the technician sees a
   frozen frame for up to ~2 minutes and cannot click the prompt; the session
   resumes automatically afterwards.
