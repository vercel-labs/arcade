// Headless test of the chess dirty-flag state machine (the logic the orchestrator
// gate relies on). Asserts: first frame paints, idle frames skip, a camera change
// re-arms, and a move stays dirty for the whole animation then settles.
import { RenderTarget } from '../engine/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';

const target = new RenderTarget(280, 192);
const s = new ChessGameScene();
let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    fails++;
    console.log(`❌ ${msg}`);
  } else console.log(`✅ ${msg}`);
};

ok(s.needsRender() === true, 'fresh scene is dirty (first frame paints)');
s.renderScene(target);
ok(s.needsRender() === false, 'idle after a still frame is painted');
s.renderScene(target);
ok(s.needsRender() === false, 'still idle on a second still render (frame would be skipped)');

s.orbit(2, 1);
ok(s.needsRender() === true, 'camera orbit re-arms dirty');
s.renderScene(target);
ok(s.needsRender() === false, 'idle again after rendering the moved camera');

s.zoomBy(0.9);
ok(s.needsRender() === true, 'zoom re-arms dirty');
s.renderScene(target);
s.pan(5, 0);
ok(s.needsRender() === true, 'pan re-arms dirty');
s.renderScene(target);
ok(s.needsRender() === false, 'settled');

// Drive a real move and verify the scene stays dirty across the WHOLE slide,
// then settles. White's pieces render in the lower half of the screen (ndcY<0);
// pawns there have legal moves at the start. Try sources in that band; for each,
// sweep destinations until one launches a multi-frame animation.
const aspect = target.width / target.height;
const off = (): void => {
  s.click(5, 5, aspect); // off-board → deselect
  if (s.needsRender()) s.renderScene(target);
};
let dirtyFrames = 0;
let selected = false;
const NS = 28;
search: for (let sy = 0; sy <= NS; sy++) {
  for (let sx = 0; sx <= NS; sx++) {
    off();
    const sX = (sx / NS) * 1.6 - 0.8; // ndcX ∈ [-0.8, 0.8]
    const sY = -0.1 - (sy / NS) * 0.8; // ndcY ∈ [-0.1, -0.9]  (white's half)
    s.click(sX, sY, aspect);
    if (!s.needsRender()) continue; // nothing selected here
    selected = true;
    s.renderScene(target); // settle selection (one paint, no anim)
    for (let dy = 0; dy <= NS; dy++) {
      for (let dx = 0; dx <= NS; dx++) {
        const dX = (dx / NS) * 1.6 - 0.8;
        const dY = -0.1 - (dy / NS) * 0.8;
        s.click(dX, dY, aspect);
        if (!s.needsRender()) continue;
        let f = 0;
        while (s.needsRender() && f < 20) {
          s.renderScene(target);
          f++;
        }
        if (f >= 3) {
          dirtyFrames = f;
          break search;
        }
        // settled quickly → deselect/reselect, not a move; re-select source.
        s.click(sX, sY, aspect);
        if (s.needsRender()) s.renderScene(target);
      }
    }
  }
}
ok(selected, 'selected a side-to-move piece via ray picking');
ok(dirtyFrames >= 3, `move stayed dirty across ${dirtyFrames} animation frames, then settled`);
ok(s.needsRender() === false, 'scene settles idle after the move completes');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
