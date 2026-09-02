import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const profiles = [
  ['phone-landscape', 142, 32],
  ['laptop', 213, 60],
  ['large-monitor', 320, 90],
  ['4k-like', 426, 120],
] as const;

const matrix = profiles.map(([profile, cols, rows]) => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'src/tools/hero-cinematic-bench.ts', String(cols), String(rows), '--json'], { encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || `hero benchmark failed for ${profile}`);
  return { profile, ...JSON.parse(child.stdout) };
});

const output = { generatedAt: new Date().toISOString(), matrix };
const baselineArg = process.argv.find((arg) => arg.startsWith('--baseline='));
const writeArg = process.argv.find((arg) => arg.startsWith('--write='));
if (writeArg) writeFileSync(writeArg.slice('--write='.length), `${JSON.stringify(output, null, 2)}\n`);

if (baselineArg) {
  const baseline = JSON.parse(readFileSync(baselineArg.slice('--baseline='.length), 'utf8')) as typeof output;
  let regression = false;
  for (const currentProfile of matrix) {
    const previousProfile = baseline.matrix.find((item) => item.profile === currentProfile.profile);
    if (!previousProfile) continue;
    for (const current of currentProfile.results.filter((entry: { kind: string }) => entry.kind === 'scene')) {
      const previous = previousProfile.results.find((entry: { kind: string; name: string }) => entry.kind === 'scene' && entry.name === current.name);
      if (!previous) continue;
      const delta = ((Number(current.sceneP50Ms) / Number(previous.sceneP50Ms)) - 1) * 100;
      console.log(`${currentProfile.profile}/${current.name}: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% p50`);
      if (delta > 10) regression = true;
    }
  }
  if (regression) process.exitCode = 1;
}

if (process.argv.includes('--json')) console.log(JSON.stringify(output, null, 2));
else for (const item of matrix) {
  console.log(`\n${item.profile} @ ${item.cols}x${item.rows}`);
  for (const result of item.results.filter((entry: { kind: string }) => entry.kind === 'scene')) {
    console.log(`${String(result.name).padEnd(10)} ${Number(result.sceneP50Ms).toFixed(1)}ms p50  ${Number(result.sceneP95Ms).toFixed(1)}ms p95  ${Number(result.fps).toFixed(1)} fps`);
  }
}
