import { cameraMatrices, type Camera } from '../engine/camera.ts';
import { mat4MulVec4 } from '../engine/math.ts';
import { pokerSeatAngle } from '../game-visuals/poker/layout.ts';

export interface CinematicOrbitCamera extends Camera { azimuth: number }
export interface ChessCinematicPose { azimuth: number; elevation: number; distance: number; target: { x: number; y: number; z: number } }

export function chessCinematicPose(progress: number): ChessCinematicPose {
  const p = clamp01(progress);
  // One restrained sine-shaped lens move: establish, approach e4 once, then
  // pull back once. The former 3.55-unit dive crossed the black-king wisp's
  // volume; 4.9 retains a real piece close-up without entering the model mark.
  const close = Math.sin(Math.PI * smoothstep(p));
  // e4 in the production board's world coordinates.
  const e4 = { x: 0.525, y: 0.68, z: 0.525 };
  return {
    // One uninterrupted counterclockwise orbit: no sine-driven reversals.
    azimuth: -0.72 + p * Math.PI * 1.28,
    elevation: lerp(0.76, 0.42, close),
    distance: lerp(11.2, 4.9, close),
    target: { x: e4.x * close, y: lerp(0.28, e4.y - 0.38, close), z: e4.z * close },
  };
}

export function pokerCinematicCamera(progress: number, aspect: number): CinematicOrbitCamera {
  const p = clamp01(progress);
  const travel = smootherstep(p);
  // Begin at the human side in a genuine shuffle insert, aimed at the production
  // deck position. Then use the same counterclockwise direction as Chess and
  // Islanders while performing one uninterrupted pullback.
  // Begin just past xAI in the direction of travel. Starting before seat 0
  // made the positive orbit cross through that flame during the close insert.
  // The deck remains the optical target and the final angle is unchanged.
  const azimuth = lerp(Math.PI / 10, 2.32, travel);
  const elevation = lerp(0.52, 0.95, travel);
  const portraitDistance = lerp(31.65, 18, smootherstep(range(aspect, 0.55, 1)));
  const desktopDistance = lerp(18, 13.5, smootherstep(range(aspect, 1, 16 / 9)));
  const finalDistance = aspect < 1 ? portraitDistance : desktopDistance;
  // Preserve the close shuffle insert, then complete more of the pullback
  // before the side-on creator angles. This is monotonic and has no late zoom
  // correction; it only redistributes the same start/end lens move.
  const pullback = smootherstep(p + Math.sin(Math.PI * p) * 0.18);
  const distance = lerp(4.45, finalDistance, pullback);
  // One continuous point-of-interest move: begin on the production deck, then
  // arrive at the table center at the same instant as the orbit and pullback.
  // There is no separate late settle/correction phase.
  const target = { x: 0, y: lerp(0.08, 0, travel), z: lerp(-1.4, 0, travel) };
  return framePokerReveal(pokerOrbit(azimuth, elevation, distance, target), travel);
}

export function islandersCinematicCamera(progress: number, aspect: number, brickHarbor = { x: -3.6, z: -3.12 }): CinematicOrbitCamera {
  const p = clamp01(progress), fit = narrowCameraFit(aspect);
  const studyAzimuth = -0.72 + p * Math.PI * 1.24; // slower continuous counterclockwise motion
  const cluster = { x: 0.5, y: 0.24, z: Math.sqrt(3) / 2 };
  // Aim just inside the boat rather than placing the optical axis directly on
  // the outer water edge. The port stays prominent, while the finite production
  // water mesh continues beyond the foreground on every side of the viewport.
  const coastRadius = Math.hypot(brickHarbor.x, brickHarbor.z) * 0.7;
  const brickAngle = Math.atan2(brickHarbor.x, brickHarbor.z);
  const brickFocus = { x: Math.sin(brickAngle) * coastRadius, y: 0.03, z: Math.cos(brickAngle) * coastRadius };
  if (p < 0.22) { const t=smoothstep(p/0.22); return orbit(studyAzimuth,lerp(0.92,0.68,t),lerp(14.8,10.8,t)*fit,{x:lerp(0,cluster.x,t),y:lerp(-0.1,cluster.y,t),z:lerp(0,cluster.z,t)}); }
  if (p < 0.64) { const t=smootherstep((p-0.2)/0.14); return orbit(studyAzimuth,lerp(0.68,0.4,t),lerp(10.8,3.35,t)*fit,cluster); }

  // Keep the same angular cadence used by the terrain study. The prior coast
  // cut compressed a second multi-radian orbit into the final fifth, which is
  // why equal scroll input suddenly made the camera fly around the island.
  const arrival = smootherstep(range(p, 0.64, 0.86));
  if (p < 0.86) return coastFrame(orbit(studyAzimuth, lerp(0.4, 0.62, arrival), lerp(3.35, 4.65, arrival) * fit, {
    x: lerp(cluster.x, brickFocus.x, arrival),
    y: lerp(cluster.y, brickFocus.y, arrival),
    z: lerp(cluster.z, brickFocus.z, arrival),
  }), arrival);

  // Travel along the coast at that same restrained angular rate. A moderately
  // higher elevation keeps the foreground water crossing the bottom edge while
  // retaining an oblique close view of boats and adjacent hex corners.
  const coastT = (p - 0.86) / 0.14;
  const coastAngle = brickAngle + (p - 0.86) * Math.PI * 1.24;
  return coastFrame(orbit(studyAzimuth, lerp(0.62, 0.68, smootherstep(coastT)), 4.65 * fit, {
    x: Math.sin(coastAngle) * coastRadius, y: 0.03, z: Math.cos(coastAngle) * coastRadius,
  }), 1);
}

function coastFrame(camera: CinematicOrbitCamera, strength: number): CinematicOrbitCamera {
  return { ...camera, ndcOffsetY: lerp(0, -0.22, smootherstep(strength)) };
}

function orbit(azimuth: number, elevation: number, distance: number, target: { x: number; y: number; z: number }): CinematicOrbitCamera {
  const ce=Math.cos(elevation); return { eye:{x:target.x+ce*Math.sin(azimuth)*distance,y:target.y+Math.sin(elevation)*distance,z:target.z+ce*Math.cos(azimuth)*distance},target,up:{x:0,y:1,z:0},fovy:48*Math.PI/180,near:0.05,far:100,azimuth };
}
function pokerOrbit(azimuth: number, elevation: number, distance: number, target: { x: number; y?: number; z: number }): CinematicOrbitCamera {
  // Compose around the tabletop and chair backs. Lower furniture is allowed to
  // leave the bottom edge; preserving chair feet was what pushed every
  // meaningful Poker element into the lower half of the browser viewport.
  const verticalCenter = target.y ?? -1.1;
  return { ...orbit(azimuth, elevation, distance, { ...target, y: verticalCenter }), fovy: 50 * Math.PI / 180 };
}
function fitPokerCreators(base: CinematicOrbitCamera, aspect: number, strength = 1): CinematicOrbitCamera {
  let camera = base;
  // Fit the actual four creator anchors, including the flame/logo radius.
  // A small iterative solve is deterministic and cheaper than one raster pass.
  for (let iteration = 0; iteration < 8; iteration++) {
    const bounds = pokerCreatorBounds(camera, aspect);
    const scale = Math.max(
      1,
      Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) / 0.89,
      (bounds.maxY - bounds.minY) / 1.5,
    );
    if (scale > 1.001) camera = scaleOrbit(camera, lerp(1, scale * 1.015, strength));
  }
  const fitted = pokerCreatorBounds(camera, aspect);
  // Film shift reframes the complete shot without changing the perspective
  // relationship between felt, cards, chairs, and wisps.
  const centerY = (fitted.minY + fitted.maxY) / 2;
  const desiredCenterY = Math.min(0.25, 0.94 - (fitted.maxY - fitted.minY) / 2);
  return { ...camera, ndcOffsetY: (desiredCenterY - centerY) * strength };
}
function framePokerReveal(camera: CinematicOrbitCamera, travel: number): CinematicOrbitCamera {
  // One monotonic film-gate move keeps the opening deck centered, then places
  // the established table a touch lower. The former sine-shaped hump pushed
  // the far wisp through the hard top edge before relaxing into a late settle.
  return { ...camera, ndcOffsetY: lerp(0.08, -0.01, smootherstep(range(travel, 0.35, 0.76))) };
}
function pokerCreatorBounds(camera: CinematicOrbitCamera, aspect: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const vp = cameraMatrices(camera, aspect).viewProjection;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let seat = 1; seat < 5; seat++) {
    const angle = pokerSeatAngle(seat, 5);
    const anchor = { x: Math.sin(angle) * 5.97, y: 2.2, z: Math.cos(angle) * 5.97 };
    const center = projectNdc(vp, anchor);
    const edge = projectNdc(vp, { ...anchor, y: anchor.y + 0.82 });
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    minX = Math.min(minX, center.x - radius); maxX = Math.max(maxX, center.x + radius);
    minY = Math.min(minY, center.y - radius); maxY = Math.max(maxY, center.y + radius);
  }
  return { minX, maxX, minY, maxY };
}
function projectNdc(vp: number[], point: { x: number; y: number; z: number }): { x: number; y: number } {
  const clip = mat4MulVec4(vp, { ...point, w: 1 });
  return { x: clip.x / clip.w, y: clip.y / clip.w };
}
function scaleOrbit(camera: CinematicOrbitCamera, scale: number): CinematicOrbitCamera {
  const t = camera.target;
  return { ...camera, eye: { x: t.x + (camera.eye.x - t.x) * scale, y: t.y + (camera.eye.y - t.y) * scale, z: t.z + (camera.eye.z - t.z) * scale } };
}
function narrowCameraFit(aspect: number): number { return aspect >= 1 ? 1 : lerp(2.5,1,clamp01((aspect-0.55)/0.45)); }
function range(value:number,from:number,to:number):number{return clamp01((value-from)/(to-from))}
function clamp01(v:number):number{return Math.max(0,Math.min(1,v))} function lerp(a:number,b:number,t:number):number{return a+(b-a)*t} function smoothstep(v:number):number{const t=clamp01(v);return t*t*(3-2*t)}
function smootherstep(v:number):number{const t=clamp01(v);return t*t*t*(t*(t*6-15)+10)}
