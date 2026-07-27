// The leaderboard's own wisp backdrop: 0, 1, or 2 creator wisps floating on the
// RIGHT of the frame (the left is covered by the opaque data panels; the right
// region of the overlay is transparent, so these show through). A fixed camera —
// the leaderboard has no camera controls. Wisps are cached per creator and keep
// breathing, so the scene reports dirty every frame like the audio/poker scenes.

import { type Camera, cameraMatrices, type RenderTarget } from '../../engine/index.ts';
import { OrbitCamera } from '../orbit.ts';
import { loadCreatorWisp, mulberry32, type Wisp } from '../scenes/wisp.ts';

const FOVY = (50 * Math.PI) / 180;
// World X that projects into the right region; two wisps sit side by side.
const RIGHT_X = 1.6;
const SIDE_X_A = 0.6;
const SIDE_X_B = 1.95;

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
    const wisps = this.creators.map((c) => this.cache.get(c)).filter((w): w is Wisp => !!w);
    if (wisps.length === 1) {
      wisps[0].renderWorld(target, vp, right, up, { x: RIGHT_X, y: 0, z: 0 }, W, H, t, dt, 1.4);
    } else if (wisps.length >= 2) {
      wisps[0].renderWorld(target, vp, right, up, { x: SIDE_X_A, y: 0, z: 0 }, W, H, t, dt, 0.85);
      wisps[1].renderWorld(target, vp, right, up, { x: SIDE_X_B, y: 0, z: 0 }, W, H, t, dt, 0.85);
    }
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
