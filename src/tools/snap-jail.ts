// Visual test for the capture/jail feature. Renders (a) a fully-populated jail
// to check the 2×8 grid placement, and (b) a real capture mid-animation across
// its phases. Uses `as any` to poke the scene's private state — this is a dev
// tool, not production. Outputs PPMs; convert with sips.
import { writeFileSync } from 'node:fs';
import { downsample, RenderTarget } from '../engine/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { ChessState } from '../games/chess/chess.ts';
import { BISHOP, BLACK, FLAG_CAPTURE, FLAG_EP, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from '../games/chess/types.ts';

const cols = 140;
const rows = 50;
const SS = 3;
const target = new RenderTarget(cols * SS, (rows - 2) * 2 * SS);

function dump(name: string): void {
  const d = downsample(target, SS);
  const W = d.width;
  const H = d.height;
  const body = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) {
    const v = d.color[i];
    body[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  writeFileSync(`.snapshots/${name}.ppm`, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote .snapshots/${name}.ppm`);
}

// (a) Full jail layout — 16 black pieces (White's jail, bottom-right), 6 white
// pieces (Black's jail, top-left). Tilt the camera slightly via orbit so depth reads.
{
  const s = new ChessGameScene() as any;
  const types = [PAWN, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KNIGHT, BISHOP];
  for (let i = 0; i < 16; i++) s.whiteJail.push({ type: types[i % types.length], color: BLACK });
  for (let i = 0; i < 6; i++) s.blackJail.push({ type: types[i % types.length], color: WHITE });
  s.renderScene(target);
  dump('jail-layout');
}

// (b) A real capture: white queen takes a black knight (Qxd5). Drive startMove
// and snapshot at phase-0 mid (knight arcing to jail), phase-1 mid (queen
// moving), and after completion (knight filed in jail).
{
  const s = new ChessGameScene() as any;
  s.game = new ChessState('8/8/8/3n4/8/8/8/3Q4 w - - 0 1');
  const cap = s.game.legalActions().find((m: any) => m.flags & (FLAG_CAPTURE | FLAG_EP) && m.from === (0 * 16 + 3));
  if (!cap) {
    console.log('no capture move found — FEN/logic mismatch');
  } else {
    s.startMove(cap);
    const shots: Record<number, string> = { 3: 'capture-early', 5: 'capture-mid', 7: 'capture-late' };
    for (let f = 1; f <= 25 && s.anim; f++) {
      s.renderScene(target);
      if (shots[f]) dump(shots[f]);
    }
    s.renderScene(target); // settled
    dump('capture-done');
    console.log(`whiteJail after capture: ${JSON.stringify(s.whiteJail)}`);
  }
}
