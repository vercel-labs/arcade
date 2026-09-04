# Voice: realtime models at the table

`src/voice/` and `native/` are the realtime speech-to-speech layer. It is built
and it works on macOS, but nothing in the published CLI reaches it. This page
records what it is for, how it is shaped, why it is parked, and what shipping it
would take, so the code can stay uncommented about its own status.

## Goal

A realtime model sits at a table like any other seat. It plays through the same
harness as a text model, taking its game actions through tool calls against the
same rules authority (`src/rules/`), but it hears the human and talks back out
loud instead of exchanging text. The first target was heads-up poker (AIG-79):
one human, one model, table talk that feels like a home game, with the model's
bet, call, and fold coming from the same session that is doing the talking. The
chess Audio scene (AIG-66) was the proving ground for the session itself.

## Why a terminal makes this hard

A browser gets an `AudioContext` with echo cancellation built in. A terminal
process gets nothing: the microphone and the speaker are separate OS processes,
and the model's own voice comes straight back through the mic. Without echo
cancellation the model hears itself, treats it as the human speaking, and the
conversation collapses. So the layer needs three things a text model never does:
a way to capture audio, a way to play it back with low latency, and a way to
cancel the playback out of the capture.

## Architecture as built

```
RealtimeSession   src/voice/realtime-session.ts   WebSocket to the AI Gateway realtime endpoint;
                                                  PCM16 in, PCM16 + transcripts + tool calls out
VoiceDuplex       src/voice/voice-duplex.ts       the audio bus: mic → session, session → speaker,
                                                  push-to-talk and hands-free, barge-in gating
MicCapture        src/voice/audio-in.ts           sox `rec` (any OS), ffmpeg avfoundation (macOS)
StreamPlayer /    src/voice/audio-out.ts          `speaker` addon when present, else a finished
AudioPlayer                                       file through afplay / ffplay / sox `play`
AecSidecar        src/voice/aec-sidecar.ts        spawns a native process that owns BOTH directions
                                                  so the OS cancels the echo (see below)
PokerVoice        src/arcade/match/poker-voice.ts one session per heads-up table, bridged into the
                                                  turn loop as a Player<PokerAction>
AudioScene        src/arcade/scenes/audio-scene.ts the dev-only conversation screen
```

`VoiceDuplex.probe()` picks one of two mutually exclusive I/O paths. When a
sidecar binary exists for the platform, it owns mic and playback in one unit and
the OS does true acoustic echo cancellation. Otherwise capture and playback are
separate processes and a software gate drops quiet mic chunks while the model is
speaking (thresholds borrowed from OpenAI's Codex CLI), which is good enough
with headphones and unreliable on speakers.

The sidecars live in `native/`:

- `native/aec-mac`: a small Swift CLI around Apple's VoiceProcessingIO audio
  unit, the same canceller FaceTime uses. Built ad hoc and unsigned with
  `./build.sh`; tested and working.
- `native/aec-win`: the Windows mirror on the Voice Capture DMO plus WASAPI.
  Written without a Windows machine and never compiled; its README marks the
  spots to verify.
- Linux: none. PipeWire's `module-echo-cancel` at the OS layer, or the software
  gate.

The stdio contract is the same on every platform: far-end PCM16 (24 kHz mono)
in on stdin, echo-cancelled near-end PCM16 out on stdout, so
`aec-sidecar.ts` only has to pick a binary for `process.platform`.

## Where it stands

- **Not reachable in the published CLI.** Poker setup only ever creates
  `runtime: 'text'` seats, so `PokerVoice` is never constructed from the UI, and
  the Audio scene is a `dev: true` menu entry that the release build hides. The
  `realtime` runtime is still exercised by `src/tools/match-test.ts`, which
  drives a `RealtimeSession` directly.
- **No native dependency ships.** `speaker` was an `optionalDependencies` entry
  and its node-gyp build failed installs, so PR #34 removed it. `audio-out.ts`
  still tries `require('speaker')` and falls back to a CLI player when it is
  absent, which for installed users is always. `native/` is outside the package
  `files` list, so no sidecar ships either; `AecSidecar.available()` is false and
  the software gate applies. Installing Arcade cannot fail on audio.
- **Team availability applies.** The gateway's `/v1/models?include_availability`
  returns realtime models with `evaluated_runtime: 'realtime_websocket'`;
  `team-model-catalog.ts` groups them into `realtimeCreators`, with
  `realtime-models.ts` as the baked fallback.
- **One bot voice at a time.** Realtime is only eligible when at most one seat
  is a live voice, which is why the poker milestone is heads-up. Several models
  talking over each other is an unsolved turn-taking problem (the "talking
  stick" in AIG-79), not a transport one.

## What shipping it needs

1. **Distribute the sidecars** instead of building on install: prebuilt per
   platform and bundled under `files`. npm's download and extract never set the
   macOS quarantine attribute, so an unsigned `aec-mac` runs from a global
   install without an Apple account (a pnpm content-addressable store is the one
   edge case to test); this is verified, not assumed.
2. **Finish Windows** on a real machine (`native/aec-win/README.md` lists the
   `// VERIFY` sites), and decide what Linux gets.
3. **Say why voice is off** rather than hiding it: when sox or ffmpeg is missing,
   the seat picker should offer the realtime runtime disabled with a tooltip
   naming the tool to install, the way build controls in Islanders explain
   themselves.
4. **Re-expose the runtime choice** in poker setup for a two-seat human-vs-AI
   table, gated on `pokerVoiceCapable()`, and route its models through the same
   creator-only defaults the text seats use.
5. **Multi-voice turn-taking** before any table with more than one model voice:
   a floor-holder plus a queue, time-boxed so talk cannot stall the deal.

Diagnostics: `ARCADE_RT_LOG=<file>` traces every realtime event with audio
frames summarized; `ARCADE_AUDIO_LOG=0` turns off the per-session audio log;
`ARCADE_NO_AEC=1` forces the software-gate path even when a sidecar is built.
