// The leaderboard's own wisp backdrop: 0, 1, or 2 creator wisps. The scene is inset to
// the region the data panels DON'T cover (see activeSceneViewport / insetLeftSceneViewport),
// so the wisps simply center in that frame — one in the middle, two split symmetrically —
// and mouse-orbit pivots around the visible center rather than behind the panel. Wisps are
// cached per creator and keep breathing, so the scene reports dirty every frame.

import { type Camera, cameraMatrices, mat4MulVec4, type RenderTarget, type Vec3 } from '../../engine/index.ts';
import { OrbitCamera } from '../orbit.ts';
import { loadCreatorWisp, mulberry32, WISP_SIZE, type Wisp } from '../scenes/wisp.ts';

const FOVY = (50 * Math.PI) / 180;
// Two wisps split symmetrically about the frame center (world origin); one wisp centers.
const SIDE_X = 0.95;
// Render scale per layout. Named because wispAt() has to place its hit circles on exactly
// the same spots renderScene() draws on — when those two drifted apart, picking broke.
const SOLO_SCALE = 1.4;
const PAIR_SCALE = 0.85;
// Multiplier on the projected orb radius. No slack is added here, unlike poker's 1.6: these
// two wisps sit shoulder to shoulder, and WISP_SIZE is the billboard quad — already about
// half again wider than the visible glow — so 1.0 is a generous target that still leaves
// dead space between the pair.
const PICK_SLACK = 1.0;

/** Where each wisp sits for a given count, left to right. */
function wispSpots(count: number): { side: 'a' | 'b'; at: Vec3; scale: number }[] {
  if (count === 1) return [{ side: 'a', at: { x: 0, y: 0, z: 0 }, scale: SOLO_SCALE }];
  return [
    { side: 'a', at: { x: -SIDE_X, y: 0, z: 0 }, scale: PAIR_SCALE },
    { side: 'b', at: { x: SIDE_X, y: 0, z: 0 }, scale: PAIR_SCALE },
  ];
}

export class LeaderboardScene {
  private cam = new OrbitCamera({ azimuth: 0.35, elevation: 0.1, distance: 4.8, target: { x: 0, y: 0, z: 0 } }, 2, 30);
  private rng = mulberry32(0x1ead1);
  private cache = new Map<string, Wisp>();
  private creators: string[] = [];
  private lastT = -1;

  // Show these creators' wisps (deduped to ≤2). Loads a wisp per new creator once.
  setCreators(list: string[]): void {
    this.creators = list.slice(0, 2);
    for (const c of this.creators) {
      if (c && !this.cache.has(c)) this.cache.set(c, loadCreatorWisp(c, this.cache.size * 1.7, this.rng));
    }
  }

  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, W / H);
    const { right, up } = this.cam.basis();
    const wisps = this.loaded();
    const spots = wispSpots(wisps.length);
    for (const [i, w] of wisps.entries()) {
      const spot = spots[i];
      if (spot) w.renderWorld(target, vp, right, up, spot.at, W, H, t, dt, spot.scale);
    }
  }

  private loaded(): Wisp[] {
    return this.creators.map((c) => this.cache.get(c)).filter((w): w is Wisp => !!w);
  }

  // Which wisp is under the pointer, or null on a miss.
  //
  // The head-to-head swap used to hit-test nothing but the scene viewport's LEFT edge, so
  // every click anywhere right of the panel — the whole empty half of the screen, top to
  // bottom — opened the modal, picking a side by which half of the frame was clicked. This
  // projects each wisp's world position through the live camera and compares against its
  // projected radius instead, the same way the chess and poker scenes already did.
  wispAt(ndcX: number, ndcY: number, aspect: number): 'a' | 'b' | null {
    const wisps = this.loaded();
    if (wisps.length === 0) return null;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, aspect);
    const { up } = this.cam.basis();
    let best: 'a' | 'b' | null = null;
    let bestD = Infinity;
    for (const { side, at, scale } of wispSpots(wisps.length)) {
      const c = mat4MulVec4(vp, { x: at.x, y: at.y, z: at.z, w: 1 });
      const cw = c.w || 1e-4;
      const cx = c.x / cw;
      const cy = c.y / cw;
      // Project a point one orb-radius "up" from the centre to get the on-screen radius,
      // so the target tracks zoom and perspective rather than assuming a fixed size.
      const size = WISP_SIZE * scale;
      const e = mat4MulVec4(vp, { x: at.x + up.x * size, y: at.y + up.y * size, z: at.z + up.z * size, w: 1 });
      const ew = e.w || 1e-4;
      const radius = Math.hypot(e.x / ew - cx, e.y / ew - cy);
      const d = Math.hypot(ndcX - cx, ndcY - cy);
      if (d < radius * PICK_SLACK && d < bestD) {
        bestD = d;
        best = side;
      }
    }
    return best;
  }

  // The wisps animate continuously, so the loop should keep re-rendering.
  needsRender(): boolean {
    return true;
  }

  // Camera passthroughs so the shared mouse handler can rotate / pan / zoom the
  // wisp scene (drags on empty space; UI hits still go to the components first).
  resetView(): void {
    this.cam.reset();
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }
}
