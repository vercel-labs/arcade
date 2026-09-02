import type { Camera } from './camera.ts';
import { add3, clamp, cross3, normalize3, scale3, sub3, type Vec3 } from './math.ts';

export interface OrbitState {
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;
}

export interface OrbitCameraSnapshotOptions {
  fovy: number;
  near: number;
  far: number;
  up?: Vec3;
}

/**
 * Input-agnostic turntable camera state. Callers translate terminal, mouse, or
 * controller input into orbit/pan/zoom deltas; this class only owns camera math.
 */
export class OrbitCamera {
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;

  private readonly home: OrbitState;
  private readonly minDist: number;
  private readonly maxDist: number;

  constructor(home: OrbitState, minDist = 2, maxDist = 60) {
    this.home = { ...home, target: { ...home.target } };
    this.minDist = minDist;
    this.maxDist = maxDist;
    this.azimuth = home.azimuth;
    this.elevation = home.elevation;
    this.distance = home.distance;
    this.target = { ...home.target };
  }

  reset(): void {
    this.azimuth = this.home.azimuth;
    this.elevation = this.home.elevation;
    this.distance = this.home.distance;
    this.target = { ...this.home.target };
  }

  orbit(dx: number, dy: number): void {
    this.azimuth -= dx * 0.012;
    this.elevation = clamp(this.elevation + dy * 0.02, -1.4, 1.4);
  }

  // Shared playable-table orbit: nearly edge-on through nearly overhead, but
  // never below the board/table plane or through the vertical pole.
  orbitAbovePlane(dx: number, dy: number): void {
    this.azimuth -= dx * 0.012;
    this.elevation = clamp(this.elevation + dy * 0.02, 0.02, Math.PI / 2 - 0.02);
  }

  pan(dx: number, dy: number): void {
    const { right, up } = this.basis();
    const k = this.distance * 0.0016;
    this.target = add3(this.target, add3(scale3(right, -dx * k), scale3(up, dy * k)));
  }

  zoomBy(factor: number): void {
    this.distance = clamp(this.distance * factor, this.minDist, this.maxDist);
  }

  eye(): Vec3 {
    const ce = Math.cos(this.elevation);
    const dir: Vec3 = {
      x: ce * Math.sin(this.azimuth),
      y: Math.sin(this.elevation),
      z: ce * Math.cos(this.azimuth),
    };
    return add3(this.target, scale3(dir, this.distance));
  }

  /** Capture the current orbit pose with the projection settings used for one frame. */
  toCamera(options: OrbitCameraSnapshotOptions): Camera {
    return {
      eye: this.eye(),
      target: { ...this.target },
      up: { ...(options.up ?? { x: 0, y: 1, z: 0 }) },
      fovy: options.fovy,
      near: options.near,
      far: options.far,
    };
  }

  basis(): { forward: Vec3; right: Vec3; up: Vec3 } {
    const forward = normalize3(sub3(this.target, this.eye()));
    const right = normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
    const up = cross3(right, forward);
    return { forward, right, up };
  }
}
