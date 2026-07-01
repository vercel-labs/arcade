import { readFileSync } from 'node:fs';
import {
  type Camera,
  cameraMatrices,
  flatShade,
  mat4Multiply,
  mat4Scale,
  mat4Translate,
  meshBounds,
  type Mesh,
  normalize3,
  parseObj,
  pieceMaterial,
  rasterize,
  type RenderTarget,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';

// Left-to-right, matching the slice order.
const PIECE_NAMES = ['pawn', 'queen', 'bishop', 'rook', 'king', 'knight'];
const FOVY = (50 * Math.PI) / 180;
const TALLEST = 2; // world height the tallest piece is scaled to

// Two sets, distinguished by color (not brightness) so either reads clearly.
const IVORY: Vec3 = { x: 232, y: 228, z: 216 };
const BROWN: Vec3 = { x: 150, y: 96, z: 52 };

// Fixed world-space lights: anchored to the scene (not the camera) so the lit
// side shifts naturally as you orbit, and identical for every piece in both
// rows. Key from the upper-front-left, weaker fill from the right.
const KEY_DIR = normalize3({ x: -0.4, y: 0.85, z: 0.5 });
const FILL_DIR = normalize3({ x: 0.6, y: 0.25, z: 0.35 });
const AMBIENT = 0.32; // shadow floor — keeps unlit faces readable (and giving ASCII something to match)
const KEY_STRENGTH = 0.7;
const FILL_STRENGTH = 0.18;

interface Placed {
  mesh: Mesh;
  x: number; // world X of this piece's center within its row
}

interface Row {
  tint: Vec3;
  z: number; // world Z offset of this row
}

// Two rows of chess pieces (ivory + brown) with a turntable camera: left-drag
// orbits, modifier+drag pans, wheel zooms.
export class ChessScene {
  private pieces: Placed[] = [];
  private rows: Row[] = [];
  private scale = 1;
  private cam: OrbitCamera;
  // Static between camera moves (no auto-orbit), so the orchestrator can skip
  // re-rendering an unchanged frame. Set on any camera change, cleared on render.
  private dirty = true;

  needsRender(): boolean {
    return this.dirty;
  }

  constructor(dir = 'public/assets/chess_blender') {
    // Flat-shade so lighting reads from geometry, not the assets' inconsistent
    // stored normals (king/bishop/knight ship with jumbled normals that otherwise
    // shade washed-out and differently from the rest).
    const meshes = PIECE_NAMES.map((name) => flatShade(parseObj(readFileSync(`${dir}/${name}.obj`, 'utf8'))));
    const boxes = meshes.map(meshBounds);

    // Uniform scale keyed to the tallest piece, preserving relative sizes.
    let maxH = 0;
    let maxFootprint = 0;
    for (const b of boxes) {
      maxH = Math.max(maxH, b.max.y - b.min.y);
      maxFootprint = Math.max(maxFootprint, b.max.x - b.min.x, b.max.z - b.min.z);
    }
    this.scale = TALLEST / (maxH || 1);

    const foot = maxFootprint * this.scale;
    const spacing = foot * 1.4 + 0.5;
    const n = meshes.length;
    meshes.forEach((mesh, i) => this.pieces.push({ mesh, x: (i - (n - 1) / 2) * spacing }));

    // Two rows facing each other across the Z axis.
    const rowSep = foot * 2.2 + 0.8;
    this.rows = [
      { tint: IVORY, z: rowSep / 2 },
      { tint: BROWN, z: -rowSep / 2 },
    ];

    // Frame the whole layout: fit the wider of row-width (X) and total depth (Z).
    const rowWidth = spacing * n;
    const depth = rowSep + foot;
    const dist = Math.max(rowWidth, depth * 1.15) / (2 * Math.tan(FOVY / 2)) + 2;
    this.cam = new OrbitCamera({ azimuth: 0.6, elevation: 0.32, distance: dist, target: { x: 0, y: TALLEST * 0.45, z: 0 } }, 2, 40);
  }

  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dxCells: number, dyCells: number): void {
    this.cam.orbit(dxCells, dyCells);
    this.dirty = true;
  }
  pan(dxCells: number, dyCells: number): void {
    this.cam.pan(dxCells, dyCells);
    this.dirty = true;
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
    this.dirty = true;
  }

  // `_t` is unused (this turntable is static) but keeps the signature uniform
  // with ChessGameScene's animated HUD, so the shared orbit-scene call site can
  // pass time without branching.
  renderScene(target: RenderTarget, _t?: number): void {
    target.clear(10, 11, 14);
    const aspect = target.width / target.height;
    const eye = this.cam.eye();
    const camera: Camera = {
      eye,
      target: this.cam.target,
      up: { x: 0, y: 1, z: 0 },
      fovy: FOVY,
      near: 0.05,
      far: 200,
    };
    const { viewProjection } = cameraMatrices(camera, aspect);

    const scaleM = mat4Scale(this.scale, this.scale, this.scale);
    for (const row of this.rows) {
      for (const p of this.pieces) {
        const model = mat4Multiply(mat4Translate(p.x, 0, row.z), scaleM);
        const mvp = mat4Multiply(viewProjection, model);
        rasterize(target, p.mesh, pieceMaterial, {
          mvp,
          model,
          cameraPos: eye,
          keyDir: KEY_DIR,
          fillDir: FILL_DIR,
          keyStrength: KEY_STRENGTH,
          fillStrength: FILL_STRENGTH,
          ambient: AMBIENT,
          tint: row.tint,
        });
      }
    }
    this.dirty = false;
  }
}
