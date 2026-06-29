// VPIO AEC spike harness.
//
// Spawns ./aec-mac, feeds a continuous 440 Hz tone to its stdin (which VPIO plays
// through the speaker as the "model"), and records the echo-cancelled mic from its
// stdout into a WAV. While it runs you'll HEAR the tone — talk into the mic.
//
// The proof: open the recording. If VPIO's AEC works, the 440 Hz tone is largely
// GONE from it (VPIO subtracted the rendered far-end) while your voice remains —
// even though it was playing out loud on the speakers the whole time.
//
//   ./build.sh && node test.mjs   then:   afplay /tmp/aec-spike.wav

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 24_000;
const SECONDS = 12;
const FREQ = 440;
const bin = fileURLToPath(new URL('./aec-mac', import.meta.url));

const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
proc.on('error', (e) => {
  console.error(`failed to spawn ${bin}: ${e.message}\nDid you run ./build.sh?`);
  process.exit(1);
});

// Feed a tone to stdin in ~100 ms blocks (this is what plays on the speaker).
let phase = 0;
const blockFrames = RATE / 10;
const feed = setInterval(() => {
  const b = Buffer.alloc(blockFrames * 2);
  for (let i = 0; i < blockFrames; i++) {
    const s = Math.sin(phase) * 0.3;
    phase += (2 * Math.PI * FREQ) / RATE;
    b.writeInt16LE(Math.max(-32767, Math.min(32767, (s * 32767) | 0)), i * 2);
  }
  if (proc.stdin.writable) proc.stdin.write(b);
}, 100);

// Record the echo-cancelled mic from stdout.
const chunks = [];
proc.stdout.on('data', (d) => chunks.push(d));

console.error(`Recording ${SECONDS}s — you should hear a ${FREQ}Hz tone; talk into the mic…`);
setTimeout(() => {
  clearInterval(feed);
  proc.kill('SIGTERM');
  const pcm = Buffer.concat(chunks);
  const file = '/tmp/aec-spike.wav';
  writeFileSync(file, toWav(pcm, RATE));
  const secs = (pcm.length / 2 / RATE).toFixed(1);
  console.error(`\nwrote ${file} (${secs}s of echo-cancelled mic).`);
  console.error(`listen:  afplay ${file}`);
  console.error(`AEC works if the ${FREQ}Hz tone is gone but your voice is there.`);
  process.exit(0);
}, SECONDS * 1000);

function toWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
