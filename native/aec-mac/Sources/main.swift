// macOS VoiceProcessingIO (VPIO) AEC spike.
//
// A headless CLI audio sidecar that proves true acoustic echo cancellation works
// from a terminal/Node process without headphones. It owns BOTH directions of
// audio through a single VPIO audio unit so the OS can use the rendered output as
// the echo-cancellation reference:
//
//   stdin  ← far-end PCM16 (24 kHz mono LE) — the model's audio. We render it to
//            the speaker through VPIO's output bus, which makes it the AEC reference.
//   stdout → near-end PCM16 (24 kHz mono LE) — the microphone, echo-cancelled by
//            VPIO (the far-end is subtracted out before we ever see it).
//
// Node spawns this, writes the model's audio to stdin, and reads clean mic from
// stdout — replacing both sox capture and node-speaker playback, with real AEC.
//
// Diagnostics go to stderr (stdout is reserved for PCM). Build with ./build.sh.

import AudioToolbox
import AVFoundation
import Foundation
import os

let SAMPLE_RATE = 24_000.0

func log(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

// Lock-protected ring buffer holding far-end (playback) samples fed from stdin and
// drained by the output render callback. Float32 mono. Underrun → silence.
final class Ring {
  private var buf: [Float]
  private let cap: Int
  private var readIdx = 0
  private var writeIdx = 0
  private var count = 0
  private var lock = os_unfair_lock_s()

  init(seconds: Double) {
    cap = Int(SAMPLE_RATE * seconds)
    buf = [Float](repeating: 0, count: cap)
  }

  // Append far-end samples, blocking (backpressure) when full so audio is NEVER
  // dropped. The model sends a reply's audio faster than realtime in bursts; the
  // render callback drains the ring at realtime, so the writer (the stdin-reader
  // thread) is simply throttled to playback rate — overflow into Node's pipe rather
  // than discarding queued samples (which skipped whole sentences).
  func write(_ samples: [Float]) {
    var i = 0
    while i < samples.count {
      os_unfair_lock_lock(&lock)
      while i < samples.count && count < cap {
        buf[writeIdx] = samples[i]
        writeIdx = (writeIdx + 1) % cap
        count += 1
        i += 1
      }
      os_unfair_lock_unlock(&lock)
      if i < samples.count { usleep(2000) }  // ring full → let the render callback drain
    }
  }

  func read(into ptr: UnsafeMutablePointer<Float>, frames: Int) {
    os_unfair_lock_lock(&lock)
    for i in 0..<frames {
      if count > 0 {
        ptr[i] = buf[readIdx]
        readIdx = (readIdx + 1) % cap
        count -= 1
      } else {
        ptr[i] = 0  // underrun
      }
    }
    os_unfair_lock_unlock(&lock)
  }

  // Drop all queued far-end audio (barge-in: stop playback instantly).
  func clear() {
    os_unfair_lock_lock(&lock)
    readIdx = 0
    writeIdx = 0
    count = 0
    os_unfair_lock_unlock(&lock)
  }
}

final class Aec {
  var unit: AudioComponentInstance?
  // Generous buffer so a full reply (delivered faster-than-realtime in a burst) fits
  // without backpressuring; longer replies overflow losslessly into Node's pipe.
  let farRing = Ring(seconds: 8)
  let out = FileHandle.standardOutput
}

let engine = Aec()

// Output render callback (bus 0): fill the speaker buffer from the far-end ring.
// VPIO uses whatever we render here as its echo-cancellation reference.
let renderCallback: AURenderCallback = { (_, _, _, _, inNumberFrames, ioData) -> OSStatus in
  guard let ioData = ioData else { return noErr }
  let abl = UnsafeMutableAudioBufferListPointer(ioData)
  guard let mData = abl[0].mData else { return noErr }
  let ptr = mData.assumingMemoryBound(to: Float.self)
  engine.farRing.read(into: ptr, frames: Int(inNumberFrames))
  return noErr
}

// Input callback (bus 1): pull the echo-cancelled mic buffer, convert Float→Int16,
// write to stdout. (Writing in the audio thread isn't realtime-safe, but it's fine
// for a spike.)
let inputCallback: AURenderCallback = {
  (_, ioActionFlags, inTimeStamp, _, inNumberFrames, _) -> OSStatus in
  guard let unit = engine.unit else { return noErr }
  // mData = nil → the unit hands us its internal buffer pointer.
  var list = AudioBufferList(
    mNumberBuffers: 1,
    mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: 0, mData: nil))
  let status = AudioUnitRender(unit, ioActionFlags, inTimeStamp, 1, inNumberFrames, &list)
  if status != noErr { return status }
  guard let mData = list.mBuffers.mData else { return noErr }
  let n = Int(inNumberFrames)
  let f = mData.assumingMemoryBound(to: Float.self)
  var pcm = [Int16](repeating: 0, count: n)
  for i in 0..<n {
    let v = max(-1.0, min(1.0, f[i]))
    pcm[i] = Int16(v * 32767.0)
  }
  pcm.withUnsafeBytes { engine.out.write(Data($0)) }
  return noErr
}

func check(_ status: OSStatus, _ what: String) {
  if status != noErr { log("ERROR \(what): OSStatus \(status)"); exit(2) }
}

func setupAndStart() {
  var desc = AudioComponentDescription(
    componentType: kAudioUnitType_Output,
    componentSubType: kAudioUnitSubType_VoiceProcessingIO,
    componentManufacturer: kAudioUnitManufacturer_Apple,
    componentFlags: 0, componentFlagsMask: 0)
  guard let comp = AudioComponentFindNext(nil, &desc) else {
    log("ERROR: VoiceProcessingIO component not found"); exit(2)
  }
  var unit: AudioComponentInstance?
  check(AudioComponentInstanceNew(comp, &unit), "AudioComponentInstanceNew")
  engine.unit = unit
  guard let au = unit else { exit(2) }

  var one: UInt32 = 1
  check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &one, UInt32(MemoryLayout<UInt32>.size)), "EnableIO input")
  check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &one, UInt32(MemoryLayout<UInt32>.size)), "EnableIO output")

  // 24 kHz, mono, Float32 packed — the client format on both directions.
  var asbd = AudioStreamBasicDescription(
    mSampleRate: SAMPLE_RATE,
    mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
    mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4,
    mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
  let sz = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
  // Format of mic samples we receive (output scope of input bus 1).
  check(AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &asbd, sz), "StreamFormat mic")
  // Format of far-end samples we provide (input scope of output bus 0).
  check(AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &asbd, sz), "StreamFormat speaker")

  var inCb = AURenderCallbackStruct(inputProc: inputCallback, inputProcRefCon: nil)
  check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &inCb, UInt32(MemoryLayout<AURenderCallbackStruct>.size)), "SetInputCallback")

  var renderCb = AURenderCallbackStruct(inputProc: renderCallback, inputProcRefCon: nil)
  check(AudioUnitSetProperty(au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &renderCb, UInt32(MemoryLayout<AURenderCallbackStruct>.size)), "SetRenderCallback")

  check(AudioUnitInitialize(au), "AudioUnitInitialize")
  check(AudioOutputUnitStart(au), "AudioOutputUnitStart")
  log("VPIO started: AEC on, 24 kHz mono. stdin=far-end PCM16, stdout=clean mic PCM16.")

  startStdinReader()
}

// Read far-end PCM16 (24 kHz mono LE) from stdin into the ring, on a background
// thread. Carries a leftover odd byte across reads so sample framing stays aligned.
func startStdinReader() {
  DispatchQueue.global(qos: .userInitiated).async {
    let chunk = 4096
    var raw = [UInt8](repeating: 0, count: chunk)
    var carry: UInt8? = nil
    while true {
      let n = read(0, &raw, chunk)
      if n <= 0 { log("stdin EOF — far-end stream ended"); break }
      var bytes = [UInt8]()
      bytes.reserveCapacity(n + 1)
      if let c = carry { bytes.append(c); carry = nil }
      bytes.append(contentsOf: raw[0..<n])
      if bytes.count % 2 == 1 { carry = bytes.removeLast() }
      let count = bytes.count / 2
      if count == 0 { continue }
      var floats = [Float](repeating: 0, count: count)
      bytes.withUnsafeBytes { rb in
        let i16 = rb.bindMemory(to: Int16.self)
        for i in 0..<count { floats[i] = Float(i16[i]) / 32767.0 }
      }
      engine.farRing.write(floats)
    }
  }
}

// Barge-in: SIGUSR1 flushes the far-end ring so playback stops at once. The host
// (Node) sends it when the user interrupts the model. DispatchSource is used so the
// handler runs on a normal queue (async-signal-safe).
signal(SIGUSR1, SIG_IGN)
let sigSource = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .global())
sigSource.setEventHandler { engine.farRing.clear() }
sigSource.resume()

// Request mic permission (shows the TCC prompt if the embedded Info.plist has
// NSMicrophoneUsageDescription), then start. Keep the process alive on the run loop.
AVCaptureDevice.requestAccess(for: .audio) { granted in
  if !granted { log("ERROR: microphone access denied"); exit(1) }
  log("microphone access granted")
  setupAndStart()
}
RunLoop.main.run()
