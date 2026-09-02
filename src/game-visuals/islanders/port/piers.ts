import { type Mesh, type Vec3 } from '../../../engine/index.ts';
import { build, faceQuad, faceQuadFlat, norm, shade, UP, v, type Build, type RGB } from '../build.ts';
import type { HarborConnector } from '../board.ts';

const DECK: RGB = [202, 137, 55];
const EDGE: RGB = [126, 78, 35];
const SEAM: RGB = [111, 67, 31];
const SHORE_Y = -0.08;
const VESSEL_Y = -0.035;
const WALKWAY_WIDTH = 0.12;
const WALKWAY_THICKNESS = 0.045;

function pointAlong(a: Vec3, b: Vec3, t: number): Vec3 { return v(a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t, a.z + (b.z-a.z)*t); }

function walkway(m: Build, shore: { x:number; z:number }, vessel: { x:number; z:number }): void {
  const a=v(shore.x,SHORE_Y,shore.z), b=v(vessel.x,VESSEL_Y,vessel.z);
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1,px=(-dz/len)*WALKWAY_WIDTH*.5,pz=(dx/len)*WALKWAY_WIDTH*.5;
  const aL=v(a.x+px,a.y,a.z+pz),aR=v(a.x-px,a.y,a.z-pz),bL=v(b.x+px,b.y,b.z+pz),bR=v(b.x-px,b.y,b.z-pz);
  const aLd=v(aL.x,aL.y-WALKWAY_THICKNESS,aL.z),aRd=v(aR.x,aR.y-WALKWAY_THICKNESS,aR.z),bLd=v(bL.x,bL.y-WALKWAY_THICKNESS,bL.z),bRd=v(bR.x,bR.y-WALKWAY_THICKNESS,bR.z);
  faceQuadFlat(m,aL,bL,bR,aR,DECK,UP);
  faceQuad(m,aLd,bLd,bL,aL,EDGE,norm(v(px,0,pz)));
  faceQuad(m,aR,bR,bRd,aRd,shade(EDGE,.86),norm(v(-px,0,-pz)));
  faceQuad(m,aRd,bRd,bLd,aLd,shade(EDGE,.72),v(0,-1,0));
  for(let i=1;i<=6;i++){
    const t=i/7,c=pointAlong(a,b,t),along=v(dx/len,(b.y-a.y)/len,dz/len),h=.009;
    faceQuadFlat(m,v(c.x+px-along.x*h,c.y+.004,c.z+pz-along.z*h),v(c.x+px+along.x*h,c.y+.004,c.z+pz+along.z*h),v(c.x-px+along.x*h,c.y+.004,c.z-pz+along.z*h),v(c.x-px-along.x*h,c.y+.004,c.z-pz-along.z*h),SEAM,UP);
  }
}

export function harborPiersMesh(connectors: readonly HarborConnector[], progress=1): Mesh {
  const m=build(),extension=Math.max(0,Math.min(1,progress));
  if(extension<=0)return m;
  for(const connector of connectors){
    walkway(m,connector.shoreA,pointAlong(v(connector.shoreA.x,SHORE_Y,connector.shoreA.z),v(connector.vesselA.x,VESSEL_Y,connector.vesselA.z),extension));
    walkway(m,connector.shoreB,pointAlong(v(connector.shoreB.x,SHORE_Y,connector.shoreB.z),v(connector.vesselB.x,VESSEL_Y,connector.vesselB.z),extension));
  }
  return m;
}
