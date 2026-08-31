import { addLocalizedEdgeLight, addSoftPoint, addSoftSegment, addSpectralRibbon, bloom, cameraMatrices, dielectricIor, matchingRayTopology, mat4Multiply, mat4MulVec4, mat4Scale, mat4Translate, mulberry32, pointSegmentDistance, rasterize, refractTriangleScreen, RenderTarget, studioGlassMaterial, traceTrianglePrism, triangularPrism, wavelengthRgb, type Camera, type RGB, type SpectralRibbonSample, type Vec2 } from '../../engine/index.ts';

export const PRISM_TEST_SIDE=2.75;
export const PRISM_TEST_DEPTH=PRISM_TEST_SIDE*(.3/.57);
export const PRISM_TEST_ORBIT_RADIANS=3.5*Math.PI/180;
const SIDE=PRISM_TEST_SIDE, H=SIDE*Math.sqrt(3)/2;
const TRI={a:[0,H*2/3] as Vec2,b:[-SIDE/2,-H/3] as Vec2,c:[SIDE/2,-H/3] as Vec2};
const GLASS_MODEL=mat4Multiply(mat4Translate(0,.12,0),mat4Scale(SIDE,SIDE,SIDE));
const GLASS=triangularPrism(.3/.57);
const BEAM_HALF_WIDTH=SIDE*(.025/.57)*.5;
const BEAM_PROFILES=[-.72,0,.72] as const;
const BEAM_WEIGHTS=[.24,.52,.24] as const;
const DUST=Array.from({length:260},(_,i)=>{const r=mulberry32(0x91e10+i*37);return{x:r()*2-1,y:r()*2-1,z:r()*2-1,size:r(),phase:r()*20,energy:.25+r()*.9};});
type Pair={x:number;y:number};

export class PrismTestScene {
  private pointer={x:.5,y:.5}; private aim={x:.5,y:.5}; private orbit={x:0,y:0};
  setPointer(x:number,y:number):void { this.pointer={x:clamp01(x),y:clamp01(y)}; }
  resetView():void { this.pointer={x:.5,y:.5}; }
  renderScene(target:RenderTarget,time:number):void {
    this.aim.x+=(this.pointer.x-this.aim.x)*.12;this.aim.y+=(this.pointer.y-this.aim.y)*.12;
    this.orbit.x+=((this.pointer.x*2-1)-this.orbit.x)*.08;this.orbit.y+=((this.pointer.y*2-1)-this.orbit.y)*.08;
    target.clear(0,0,0);const aspect=target.width/target.height;
    const camera=prismTestCamera(this.orbit.x,this.orbit.y),yaw=this.orbit.x*PRISM_TEST_ORBIT_RADIANS,pitch=-this.orbit.y*PRISM_TEST_ORBIT_RADIANS;
    // The prism and light sheet stay fixed. Pointer parallax comes solely from
    // the camera orbit, matching vGPU's scene rather than rotating the mesh.
    const {viewProjection:vp}=cameraMatrices(camera,aspect),model=GLASS_MODEL,mvp=mat4Multiply(vp,model);
    // Arcade's cross-section winding is mirrored from the reference's screen
    // convention. This equivalent incidence sends the neutral beam from the
    // upper-right through the prism and disperses it toward the lower-right.
    const incidence=(-58+this.aim.y*36)*Math.PI/180,entryT=.18+this.aim.x*.64;
    const entry:Vec2=[TRI.a[0]+(TRI.c[0]-TRI.a[0])*entryT,TRI.a[1]+(TRI.c[1]-TRI.a[1])*entryT];
    const direction:Vec2=[-Math.cos(incidence),-Math.sin(incidence)];const source:Vec2=[entry[0]-direction[0]*7,entry[1]-direction[1]*7];
    const project=(p:Vec2,z=.02):Pair=>{const q=mat4MulVec4(mat4Multiply(vp,mat4Translate(0,.12,0)),{x:p[0],y:p[1],z,w:1});return{x:(q.x/q.w*.5+.5)*target.width,y:(.5-q.y/q.w*.5)*target.height}};
    const beamB=project(entry);
    const perpendicular:Vec2=[-direction[1],direction[0]],spectral:Array<{a:Pair;b:Pair;color:RGB;strength:number}>=[],centerPaths:Array<NonNullable<ReturnType<typeof traceTrianglePrism>>>=[];
    for(let profileIndex=0;profileIndex<BEAM_PROFILES.length;profileIndex++){
      const profile=BEAM_PROFILES[profileIndex],weight=BEAM_WEIGHTS[profileIndex],offset:Vec2=[perpendicular[0]*BEAM_HALF_WIDTH*profile,perpendicular[1]*BEAM_HALF_WIDTH*profile],profileSource:Vec2=[source[0]+offset[0],source[1]+offset[1]],profileEntry:Vec2=[entry[0]+offset[0],entry[1]+offset[1]];
      addSoftSegment(target,project(profileSource),project(profileEntry),[255,255,255],Math.max(.8,target.height*.0028),weight*4.8);
      const ribbons:SpectralRibbonSample[][]=[[]],profilePaths:Array<NonNullable<ReturnType<typeof traceTrianglePrism>>>=[];let previous:NonNullable<ReturnType<typeof traceTrianglePrism>>|null=null;
      for(let i=0;i<36;i++){const nm=400+i*300/35,path=traceTrianglePrism(TRI,profileSource,direction,dielectricIor(nm));if(!path){previous=null;ribbons.push([]);continue;}if(previous&&!matchingRayTopology(previous,path))ribbons.push([]);profilePaths.push(path);const start=project(path.points.at(-1)!, .08),end=project([path.points.at(-1)![0]+path.direction[0]*7,path.points.at(-1)![1]+path.direction[1]*7],.08),color=wavelengthRgb(nm),sample={start,end,color,intensity:path.transmission*weight};ribbons.at(-1)!.push(sample);spectral.push({a:start,b:end,color,strength:path.transmission*weight});previous=path;}
      if(profile===0)centerPaths.push(...profilePaths);
      for(const ribbon of ribbons)if(ribbon.length>1)addSpectralRibbon(target,ribbon,1.5);
    }
    const glassUniforms={mvp,model,cameraPos:camera.eye,edgeColor:{x:7,y:10,z:17},edgeWidth:.012,glassColor:{x:2,y:4,z:8},bodyStrength:.09,ambient:.01,fresnelPower:4.2,dispersion:.004,panelDirection:{x:-.55,y:.3,z:.78},panelStrength:.1};
    // vGPU's dark pass order: external light, back glass, internal light,
    // refracted scene, then front glass. The separated interfaces make the
    // physical extrusion and between-face light path legible in ASCII.
    rasterize(target,GLASS,{...studioGlassMaterial,cull:'front'},glassUniforms);
    // Inside the glass, wavelengths overlap almost completely. Render the
    // median optical path as one white-hot bundle; color separation emerges at
    // the exit instead of creating a knot of 36 centerlines.
    const median=centerPaths[Math.floor(centerPaths.length/2)];
    if(median)for(let s=1;s<median.points.length;s++)addSoftSegment(target,project(median.points[s-1],.08),project(median.points[s],.08),[255,255,255],Math.max(1.2,target.height*.007),median.transmission*2.5);
    const pa=project(TRI.a),pb=project(TRI.b),pc=project(TRI.c);refractTriangleScreen(target,pa,pb,pc,2.2,.7,.9);
    rasterize(target,GLASS,{...studioGlassMaterial,cull:'back'},glassUniforms);
    // The unlit solid is defined by two quiet offset contours. Brightness is
    // added locally below where physical light actually crosses the glass.
    for(const z of[-PRISM_TEST_DEPTH/2,PRISM_TEST_DEPTH/2]){const a=project(TRI.a,z),b=project(TRI.b,z),c=project(TRI.c,z);addSoftSegment(target,a,b,[34,41,56],Math.max(.55,target.height*.0015),.18);addSoftSegment(target,b,c,[34,41,56],Math.max(.55,target.height*.0015),.18);addSoftSegment(target,c,a,[34,41,56],Math.max(.55,target.height*.0015),.18);}
    addSoftPoint(target,beamB.x,beamB.y,[255,246,232],target.height*.018,1.35);
    if(median){const exit=project(median.points.at(-1)!, .08),edges:[[Pair,Pair],[Pair,Pair],[Pair,Pair]]=[[pa,pb],[pb,pc],[pc,pa]];addSoftPoint(target,exit.x,exit.y,[238,246,255],target.height*.025,1.5);for(const [a,b] of edges){addLocalizedEdgeLight(target,a,b,beamB,[245,249,255],target.height*.045,.62);addLocalizedEdgeLight(target,a,b,exit,[205,228,255],target.height*.04,.52);}}
    bloom(target,{threshold:48,intensity:.52,radius:2,passes:2});
    this.drawDust(target,time,spectral);
  }
  private drawDust(target:RenderTarget,time:number,rays:Array<{a:Pair;b:Pair;color:RGB;strength:number}>):void { for(const p of DUST){const life=(time*(.07+p.size*.08)+p.phase)%1,fade=smoothstep(0,.18,life)*(1-smoothstep(.76,1,life));if(fade<=.01)continue;const x=Math.floor((p.x*.5+.5)*target.width+Math.sin(time*.12+p.phase)*4)+.5,y=Math.floor((p.y*.5+.5)*target.height+Math.cos(time*.1+p.phase)*3)+.5;let best=Infinity,c:RGB=[188,198,216];for(let i=0;i<rays.length;i+=3){const d=pointSegmentDistance(x,y,rays[i].a,rays[i].b);if(d<best){best=d;const spectral=rays[i].color;c=[168+spectral[0]*.18,174+spectral[1]*.18,190+spectral[2]*.16]}}const light=Math.exp(-best*best/(2*Math.pow(target.height*.085,2))),classGain=p.size>.995?.42:p.size>.96?.62:1,energy=fade*p.energy*classGain*(.46+light*2.25);if(energy<.1)continue;const radius=p.size>.995?4:p.size>.96?2:1;for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const k=Math.exp(-(dx*dx+dy*dy)/(Math.max(1,radius)*1.35))*energy;target.plot(x+dx,y+dy,-.98,{r:c[0]*k,g:c[1]*k,b:c[2]*k,a:1},'add');}} }
}
export function prismTestCamera(orbitX:number,orbitY:number):Camera { const yaw=clampSigned(orbitX)*PRISM_TEST_ORBIT_RADIANS,pitch=-clampSigned(orbitY)*PRISM_TEST_ORBIT_RADIANS,cp=Math.cos(pitch);return{eye:{x:Math.sin(yaw)*cp*5.6,y:Math.sin(pitch)*5.6,z:Math.cos(yaw)*cp*5.6},target:{x:0,y:.12,z:0},up:{x:0,y:1,z:0},fovy:48*Math.PI/180,near:.05,far:50}; }
function clampSigned(v:number):number{return Math.max(-1,Math.min(1,v))}
function clamp01(v:number):number{return Math.max(0,Math.min(1,v))}function smoothstep(a:number,b:number,v:number):number{const t=clamp01((v-a)/(b-a));return t*t*(3-2*t)}
