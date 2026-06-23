import { add3, clamp, cross3, normalize3, scale3, sub3, type Vec3 } from '../engine/index.ts';

export interface OrbitState {
  azimuth: number; // radians around the Y axis
  elevation: number; // radians above the horizon
  distance: number;
  target: Vec3; // look-at point
}

// A turntable camera: spherical angles around a look-at point. Shared by the
// chess scenes. Drag deltas are in terminal cells; left-drag orbits, drag-pan
// moves the target in the view plane, wheel zooms.
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

  // Drag right spins the scene right (camera orbits left); drag down lifts the
  // camera (grab-and-pull feel). Elevation is clamped to avoid pole flips.
  orbit(dxCells: number, dyCells: number): void {
    this.azimuth -= dxCells * 0.012;
    this.elevation = clamp(this.elevation + dyCells * 0.02, -1.4, 1.4);
  }

  // Pan the look-at point in the camera's screen plane; distance-scaled so it
  // feels consistent at any zoom.
  pan(dxCells: number, dyCells: number): void {
    const { right, up } = this.basis();
    const k = this.distance * 0.0016;
    this.target = add3(this.target, add3(scale3(right, -dxCells * k), scale3(up, dyCells * k)));
  }

  zoomBy(factor: number): void {
    this.distance = clamp(this.distance * factor, this.minDist, this.maxDist);
  }

  eye(): Vec3 {
    const ce = Math.cos(this.elevation);
    const dir: Vec3 = { x: ce * Math.sin(this.azimuth), y: Math.sin(this.elevation), z: ce * Math.cos(this.azimuth) };
    return add3(this.target, scale3(dir, this.distance));
  }

  // Camera right/up vectors (for panning and camera-relative effects).
  basis(): { forward: Vec3; right: Vec3; up: Vec3 } {
    const forward = normalize3(sub3(this.target, this.eye()));
    const right = normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
    const up = cross3(right, forward);
    return { forward, right, up };
  }
}
