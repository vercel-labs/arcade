# aec-mac — macOS VoiceProcessingIO AEC spike

A throwaway spike to prove **true acoustic echo cancellation** works headless from
a terminal/Node process on macOS — no headphones, no Apple account, no signing.

It's a tiny Swift CLI that wraps Apple's **VoiceProcessingIO** audio unit (the
OS-native canceller, the same one FaceTime uses). It owns both directions of audio
through one VPIO unit so the OS uses the rendered output as the echo-cancellation
reference:

```
stdin  ← far-end PCM16 (24 kHz mono LE)   the model's audio → rendered to speaker (= AEC reference)
stdout → near-end PCM16 (24 kHz mono LE)  the microphone, echo-cancelled by VPIO
```

If this works, it replaces **both** sox (capture) and node-speaker (playback) with
one component that also does real AEC — and Node just spawns it and pipes PCM.

## Build & run

```bash
cd native/aec-mac
./build.sh          # swiftc → ./aec-mac (ad-hoc/unsigned, no account needed)
node test.mjs       # plays a 440 Hz tone on the speaker, records echo-cancelled mic
afplay /tmp/aec-spike.wav
```

## What this spike is meant to answer

1. **Does it run unsigned?** It's built ad-hoc/unsigned. If `./aec-mac` launches
   (no "cannot be verified" wall), that's evidence a CLI binary spawned by Node
   isn't Gatekeeper-blocked the way a double-clicked app is — i.e. notarization may
   not be needed for the `npx` distribution after all.

   - To simulate an npm-*downloaded* binary, tag it with the quarantine xattr and
     retry: `xattr -w com.apple.quarantine "0081;0;test;" aec-mac && ./aec-mac`.
     If that's blocked but the untagged one runs, the quarantine xattr (not the
     binary) is the gate — and npm-extracted files usually lack it.

2. **Does the mic permission (TCC) work?** On first run macOS should prompt for
   microphone access (the prompt text comes from the `NSMicrophoneUsageDescription`
   in `Info.plist`, embedded into the binary via `-sectcreate`). If you get the
   prompt and granting it works, TCC is fine for a CLI helper. (Grant it to your
   terminal app too: System Settings → Privacy & Security → Microphone.)

3. **Does the cancellation actually work?** The killer test: `test.mjs` plays a
   440 Hz tone out the speakers the whole time. Open `/tmp/aec-spike.wav` — if VPIO
   is cancelling, the **tone is gone** from the recording but **your voice remains**,
   despite the tone blasting on the speakers. That's true AEC, no headphones.

## Notes / known rough edges (it's a spike)

- Stdout is written from the audio callback (not realtime-safe) — fine here, would
  be buffered to another thread in the real helper.
- VPIO client format is set to 24 kHz mono Float32 directly; if `AudioUnitInitialize`
  errors with an OSStatus, VPIO may want a different rate on this device — bump
  `SAMPLE_RATE` (e.g. 48000) and resample at the stdio boundary.
- All diagnostics go to **stderr**; **stdout is PCM only**.

## If it works
This becomes the basis for the real macOS AEC sidecar: shipped as a prebuilt,
per-arch `optionalDependency`, spawned by arcade in place of sox + node-speaker.
Windows (Voice Capture DMO) and Linux (PipeWire `module-echo-cancel`) come later.
