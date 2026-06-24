// Measure overdraw: how many fragment-shaded pixels get thrown away by the depth
// test? The rasterizer shades (interpolate + fragment) BEFORE plot() does the
// depth test, so every depth-rejected pixel is wasted shading that an early-Z
// test (or front-to-back draw order) would skip. Subclass RenderTarget to count
// plot() entries vs depth rejections.
import { RenderTarget } from '../engine/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';

const cols = Number(process.argv[2]) || 140;
const rows = Number(process.argv[3]) || 50;
const SS = 3;
const presentRows = rows - 2;

class CountingTarget extends RenderTarget {
  plotCalls = 0;
  depthRejects = 0;
  writes = 0;
  plot(x: number, y: number, z: number, c: { r: number; g: number; b: number; a: number }, blend: 'opaque' | 'add' | 'alpha'): void {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || px >= this.width || py < 0 || py >= this.height) return;
    this.plotCalls++;
    const di = py * this.width + px;
    if (z >= this.depth[di]) this.depthRejects++;
    else this.writes++;
    super.plot(x, y, z, c, blend);
  }
}

const target = new CountingTarget(cols * SS, presentRows * 2 * SS);
const scene = new ChessGameScene();
target.plotCalls = 0;
target.depthRejects = 0;
target.writes = 0;
scene.renderScene(target);

const screen = target.width * target.height;
console.log(`chess @ ${cols}x${rows}, RT ${target.width}x${target.height} = ${(screen / 1000).toFixed(0)}k px`);
console.log('─'.repeat(60));
console.log(`fragment-shaded pixels (plot calls): ${target.plotCalls.toLocaleString()}`);
console.log(`  → depth-rejected (WASTED shading): ${target.depthRejects.toLocaleString()}  (${((100 * target.depthRejects) / target.plotCalls).toFixed(1)}%)`);
console.log(`  → actually written:                ${target.writes.toLocaleString()}  (${((100 * target.writes) / target.plotCalls).toFixed(1)}%)`);
console.log(`overdraw factor (shaded / screen):   ${(target.plotCalls / screen).toFixed(2)}x`);
console.log(`fraction of screen ever touched:     ${((100 * target.writes) / screen).toFixed(1)}% (upper bound; writes incl. re-writes)`);
