// The Catan tile test bed: one 3D hex tile at the origin, switchable between terrains from
// the HUD dropdown. Static and orbit-controlled (no auto-rotate) — like the chess turntable,
// it renders only when the camera moves or the tile changes. A place to dial in the tile
// look before the board exists.

import {
  type Camera,
  cameraMatrices,
  lambertMaterial,
  type Mat4,
  mat4Identity,
  mat4Multiply,
  normalize3,
  rasterize,
  type RenderTarget,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';
import { type Terrain } from '../../../rules/catan/types.ts';
import { tileMesh } from './tile-mesh.ts';

const FOVY = (44 * Math.PI) / 180;
// A warm key from the upper front-right so tops read bright and the raised content casts its
// form; a high ambient floor keeps side faces legible (especially in ASCII mode).
const LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
const AMBIENT = 0.52;
// Wrap the diffuse falloff toward half-Lambert so much more of each tile sits in the lit
// gradient instead of pinned at the flat ambient floor (≈24% lit at wrap 0 → ≈45% at 0.85).
const WRAP = 0.85;
const MODEL: Mat4 = mat4Identity();

export class TileScene {
  private cam: OrbitCamera;
  private terrain: Terrain = 'forest';
  private variant = 0; // per-tile seed: same style, different layout
  private robber = false; // show/hide the robber (works on any terrain)
  private dirty = true;

  constructor() {
    this.cam = new OrbitCamera({ azimuth: 0.62, elevation: 0.62, distance: 2.7, target: { x: 0, y: 0.02, z: 0 } }, 1.6, 6);
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
    this.dirty = true;
  }
  currentTerrain(): Terrain {
    return this.terrain;
  }
  // Advance to the next procedural variant of the current tile (a new seed).
  reroll(): void {
    this.variant++;
    this.dirty = true;
  }
  setRobber(on: boolean): void {
    this.robber = on;
    this.dirty = true;
  }

  // ── camera ──
  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
    this.cam.elevation = Math.max(-0.2, this.cam.elevation); // don't drop under the tile
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(f: number): void {
    this.cam.zoomBy(f);
    this.dirty = true;
  }

  // On-demand: only re-render after a camera move or a tile change.
  needsRender(): boolean {
    return this.dirty;
  }

  renderScene(target: RenderTarget, _t = 0): void {
    target.clear(14, 16, 22);
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    const vp = cameraMatrices(camera, target.width / target.height).viewProjection;
    rasterize(target, tileMesh(this.terrain, this.variant, this.robber), lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    this.dirty = false;
  }
}
