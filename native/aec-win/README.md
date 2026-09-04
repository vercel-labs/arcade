# aec-win — Windows VoiceCapture DMO AEC sidecar

How this fits the voice layer, and why it does not ship yet: [`docs/voice.md`](../../docs/voice.md).

The Windows mirror of [`../aec-mac`](../aec-mac). Same job, same stdio contract, so
the Node side (`src/voice/aec-sidecar.ts`) treats them identically — it just spawns
whichever binary matches `process.platform`.

```
stdin  ← far-end PCM16 (24 kHz mono LE)   model audio → rendered to the speaker (= AEC reference)
stdout → near-end PCM16 (24 kHz mono LE)  mic, echo-cancelled by the Voice Capture DMO
fd 3   ← control: byte 'f' = flush playback (barge-in)   [macOS uses SIGUSR1 instead]
```

## ⚠️ Status: UNTESTED
This was written **on macOS, with no Windows compiler or machine to test on.** The
architecture and Win32 APIs are real (CWMAudioAEC DMO in source mode + WASAPI render),
but the code has **not been compiled or run.** Treat it as a strong starting point,
not working software — budget time to fix compile errors and tune device/format
details on an actual Windows box. The riskiest spots are marked `// VERIFY` in
`main.cpp`:
- **Device indices** (`MFPKEY_WMAAECMA_DEVICE_INDEXES`) — default selection vs. enumerating endpoints.
- **WASAPI mix format** — shared mode renders at the device format (often 48 kHz float); the float/PCM conversion and resample need checking on real hardware.
- **fd 3** mapping for the control pipe under Windows child stdio.

## Build
From a **Developer Command Prompt for VS** (so `cl.exe` + Windows SDK are on PATH):
```bat
cd native\aec-win
build.bat        :: → aec-win.exe
```
Once `aec-win.exe` exists, arcade auto-detects it on Windows and routes voice through
it (replacing sox + node-speaker), exactly like the Mac sidecar. No signing needed on
Windows for an npm-spawned binary.

## How it differs from the Mac sidecar
- macOS **VoiceProcessingIO** is one unit that owns capture + render, so the OS handles
  the reference + time-alignment for free. The Windows **Voice Capture DMO** in source
  mode does the AEC capture, but references whatever is on the default *render*
  endpoint — so this sidecar **also renders the far-end via WASAPI** to guarantee a
  well-formed, time-aligned reference (the same "own both directions" idea).
- The DMO runs at ≤16 kHz, so the mic is cancelled at 16 kHz and **resampled to 24 kHz**
  for stdout; the 24 kHz far-end is resampled to the render device's mix format.
- Windows can't receive POSIX signals, so barge-in flush comes over **fd 3** (`'f'`),
  not `SIGUSR1`.

## If this proves fiddly
The cross-platform alternative is a single Rust addon (cpal + webrtc-audio-processing
AEC3) instead of two OS-native sidecars — one codebase, but you own the reference
time-alignment and bundle the C++ AEC lib. See the project notes; the OS-native route
(this) gives better cancellation and the OS handles alignment, at the cost of a second
codebase.
