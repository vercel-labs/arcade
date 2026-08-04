import { cameraMatrices, type Mat4, mat4MulVec4, type RenderTarget, type Vec3 } from '../../engine/index.ts';
import { OrbitCamera } from '../orbit.ts';
import { loadCreatorWisp, mulberry32, type Wisp, WISP_SIZE } from './wisp.ts';

// Will-o'-wisp logos in 3D: each AI Gateway provider mark floats as a spectral
// plasma orb (see wisp.ts) with the logo billboarded inside, plus drifting ember
// sparks. The screen is an orbit turntable (drag/pan/zoom) like chess; the orbs
// are world-anchored so they read correctly from any angle. Click an orb to
// toggle its speaking pulse. The per-orb rendering lives in Wisp, reused as the
// per-side HUD in the chess match.

const CREATORS = ['openai', 'anthropic', 'google', 'xai'] as const;
const FOVY = (50 * Math.PI) / 180;
const SPACING = 2.8; // gap between orb centers along x

export class LogosScene {
  private wisps: { wisp: Wisp; x: number }[];
  private cam: OrbitCamera;
  private lastT = -1;
  // Cached from the last render so click picking projects against the live camera.
  private lastVp: Mat4 | null = null;
  private lastUp: Vec3 = { x: 0, y: 1, z: 0 };

  constructor(creators: readonly string[] = CREATORS) {
    const rng = mulberry32(0x10905c); // fixed seed → reproducible snapshots
    this.wisps = creators.map((name, i) => {
      const wisp = loadCreatorWisp(name, i * 1.7, rng);
      return { wisp, x: (i - (creators.length - 1) / 2) * SPACING };
    });
    // Frame the whole row, viewed from a slight angle so the 3D/billboard reads.
    const rowWidth = SPACING * (creators.length - 1) + 2 * WISP_SIZE;
    const dist = rowWidth / (2 * Math.tan(FOVY / 2)) + 1.5;
    this.cam = new OrbitCamera({ azimuth: 0.5, elevation: 0.16, distance: dist, target: { x: 0, y: 0, z: 0 } }, 3, 40);
  }

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

  // Toggle the speaking pulse on the orb nearest a click (in NDC, +y up). Returns
  // true if an orb was hit. Projects each orb center against the last-rendered
  // camera and accepts a click within ~1.4× the orb's projected radius.
  toggleAt(ndcX: number, ndcY: number): boolean {
    if (!this.lastVp) return false;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.wisps.length; i++) {
      const { x } = this.wisps[i];
      const c = mat4MulVec4(this.lastVp, { x, y: 0, z: 0, w: 1 });
      const cw = c.w || 1e-4;
      const cx = c.x / cw;
      const cy = c.y / cw;
      const e = mat4MulVec4(this.lastVp, {
        x: x + this.lastUp.x * WISP_SIZE,
        y: this.lastUp.y * WISP_SIZE,
        z: this.lastUp.z * WISP_SIZE,
        w: 1,
      });
      const ew = e.w || 1e-4;
      const radius = Math.hypot(e.x / ew - cx, e.y / ew - cy);
      const d = Math.hypot(ndcX - cx, ndcY - cy);
      if (d < radius * 1.4 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return false;
    const w = this.wisps[best].wisp;
    w.setSpeaking(!w.speaking);
    return true;
  }

  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;

    const camera = this.cam.toCamera({ fovy: FOVY, near: 0.05, far: 200 });
    const { viewProjection: vp } = cameraMatrices(camera, W / H);
    const { right, up } = this.cam.basis();
    this.lastVp = vp;
    this.lastUp = up;

    for (const { wisp, x } of this.wisps) {
      wisp.renderWorld(target, vp, right, up, { x, y: 0, z: 0 }, W, H, t, dt);
    }
  }
}
