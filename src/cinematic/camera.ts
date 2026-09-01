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
  const reveal = smoothstep(range(p, 0.08, 0.52));
  // Begin at the human side in a genuine shuffle insert, aimed at the production
  // deck position. Then perform one continuous clockwise orbit and monotonic
  // pullback until the complete table and creator seats are established.
  const azimuth = lerp(0.12, -2.08, smoothstep(p));
  const elevation = lerp(0.58, 0.98, smoothstep(p));
  const responsiveFit = aspect < 1.05 ? 3.4 : lerp(1.45, 1, clamp01((aspect - 1.05) / 1.15));
  // Preserve the card insert on portrait too; introduce its stronger table fit
  // only as the reveal opens, without changing direction.
  const distance = lerp(5.4, 18.6 * responsiveFit, smoothstep(p));
  const target = { x: 0, y: lerp(0.18, -1.1, reveal), z: lerp(-1.4, 0.18, reveal) };
  return framePokerReveal(pokerOrbit(azimuth, elevation, distance, target), aspect, reveal, p);
}

export function catanCinematicCamera(progress: number, aspect: number): CinematicOrbitCamera {
  const p = clamp01(progress), fit = narrowCameraFit(aspect);
  const azimuth = -0.72 + p * Math.PI * 1.24; // slower continuous counterclockwise motion
  const cluster = { x: 0.5, y: 0.24, z: Math.sqrt(3) / 2 };
  if (p < 0.22) { const t=smoothstep(p/0.22); return orbit(azimuth,lerp(0.92,0.68,t),lerp(14.8,10.8,t)*fit,{x:lerp(0,cluster.x,t),y:lerp(-0.1,cluster.y,t),z:lerp(0,cluster.z,t)}); }
  if (p < 0.64) { const t=smoothstep((p-0.22)/0.06); return orbit(azimuth,lerp(0.68,0.4,t),lerp(10.8,3.35,t)*fit,cluster); }
  const t=smoothstep(clamp01((p-0.64)/0.1)); return orbit(azimuth,lerp(0.4,0.8,t),lerp(3.35,12.8,t)*fit,{x:lerp(cluster.x,0,t),y:lerp(cluster.y,-0.1,t),z:lerp(cluster.z,0,t)});
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
function framePokerReveal(camera: CinematicOrbitCamera, aspect: number, reveal: number, progress: number): CinematicOrbitCamera {
  // Distance is authored monotonically above. Only shift the film gate here;
  // never invoke the iterative zoom solver, which would add an unintended
  // in/out pulse as different chairs become the widest projected anchor.
  const bounds = pokerCreatorBounds(camera, aspect);
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const desiredCenterY = Math.min(0.52, 0.9 - (bounds.maxY - bounds.minY) / 2);
  // The close insert deliberately excludes seats. During reveal, clamp the
  // projected creator envelope just below the top edge using film shift alone.
  const fittedOffset = desiredCenterY - centerY;
  const middleLift = Math.sin(Math.PI * progress) * 0.13;
  const revealOffset = lerp(0.08, fittedOffset, reveal) + middleLift;
  // Once the complete table is established, let the shot settle around the
  // felt instead of continuing to privilege the upper creator envelope. This
  // affects only the final fifth of the orbit and adapts to narrow screens.
  const table = projectNdc(cameraMatrices({ ...camera, ndcOffsetY: revealOffset }, aspect).viewProjection, { x: 0, y: 0, z: 0 });
  const desiredTableY = aspect < 1.05 ? 0.18 : 0.08;
  const settle = smoothstep(range(progress, 0.78, 1));
  return { ...camera, ndcOffsetY: revealOffset + (desiredTableY - table.y) * settle };
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
