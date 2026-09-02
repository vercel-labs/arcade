export type Vec2 = readonly [number, number];
export interface Triangle2 { a: Vec2; b: Vec2; c: Vec2 }
export interface RayPath2 { points: Vec2[]; edges: number[]; direction: Vec2; transmission: number }

const add=(a:Vec2,b:Vec2):Vec2=>[a[0]+b[0],a[1]+b[1]];
const sub=(a:Vec2,b:Vec2):Vec2=>[a[0]-b[0],a[1]-b[1]];
const scale=(a:Vec2,k:number):Vec2=>[a[0]*k,a[1]*k];
const dot=(a:Vec2,b:Vec2):number=>a[0]*b[0]+a[1]*b[1];
const cross=(a:Vec2,b:Vec2):number=>a[0]*b[1]-a[1]*b[0];
const normalize=(a:Vec2):Vec2=>{const l=Math.hypot(a[0],a[1])||1;return[a[0]/l,a[1]/l]};

export function dielectricIor(wavelengthNm:number,base=1.2,strength=0.1):number { const um=wavelengthNm*1e-3; return base+strength/(um*um); }
export function refract2(incident:Vec2,normal:Vec2,eta:number):Vec2|null { const ci=-dot(incident,normal),st2=eta*eta*(1-ci*ci); if(st2>1)return null; return normalize(add(scale(incident,eta),scale(normal,eta*ci-Math.sqrt(1-st2)))); }
export function reflect2(incident:Vec2,normal:Vec2):Vec2 { return normalize(sub(incident,scale(normal,2*dot(incident,normal)))); }
export function fresnelTransmission(incident:Vec2,normal:Vec2,n1:number,n2:number):number { const ci=Math.max(0,Math.min(1,-dot(incident,normal))),eta=n1/n2,st2=eta*eta*(1-ci*ci);if(st2>=1)return 0;const ct=Math.sqrt(1-st2),rs=(n1*ci-n2*ct)/(n1*ci+n2*ct),rp=(n1*ct-n2*ci)/(n1*ct+n2*ci);return 1-(rs*rs+rp*rp)/2; }

function hit(tri:Triangle2,origin:Vec2,direction:Vec2,minT=1e-4):{t:number;normal:Vec2;edge:number}|null { const vs=[tri.a,tri.b,tri.c] as const;let best:null|{t:number;normal:Vec2;edge:number}=null;for(let i=0;i<3;i++){const a=vs[i],b=vs[(i+1)%3],edge=sub(b,a),den=cross(direction,edge);if(Math.abs(den)<1e-9)continue;const off=sub(a,origin),t=cross(off,edge)/den,s=cross(off,direction)/den;if(t<=minT||s<0||s>1||best&&best.t<=t)continue;best={t,normal:normalize([edge[1],-edge[0]]),edge:i};}return best; }

/** Trace air -> convex triangular glass -> air, including total internal reflections. */
export function traceTrianglePrism(triangle:Triangle2,origin:Vec2,direction:Vec2,ior:number,maxBounces=3):RayPath2|null { const dir=normalize(direction),entry=hit(triangle,origin,dir);if(!entry||dot(dir,entry.normal)>=0)return null;let p=add(origin,scale(dir,entry.t)),inside=refract2(dir,entry.normal,1/ior);if(!inside)return null;const points=[p],edges=[entry.edge];let transmission=fresnelTransmission(dir,entry.normal,1,ior);for(let i=0;i<=maxBounces;i++){const exit=hit(triangle,p,inside);if(!exit)return null;p=add(p,scale(inside,exit.t));points.push(p);edges.push(exit.edge);const out=refract2(inside,scale(exit.normal,-1),ior);if(out){transmission*=fresnelTransmission(inside,scale(exit.normal,-1),ior,1);return{points,edges,direction:out,transmission};}inside=reflect2(inside,exit.normal);}return null; }

export function matchingRayTopology(a:RayPath2,b:RayPath2):boolean { return a.edges.length===b.edges.length&&a.edges.every((edge,index)=>edge===b.edges[index]); }

/** Approximate a monochromatic wavelength as display RGB while preserving hue order. */
export function wavelengthRgb(nm:number):[number,number,number] { let r=0,g=0,b=0;if(nm<440){r=-(nm-440)/60;b=1}else if(nm<490){g=(nm-440)/50;b=1}else if(nm<510){g=1;b=-(nm-510)/20}else if(nm<580){r=(nm-510)/70;g=1}else if(nm<645){r=1;g=-(nm-645)/65}else r=1;const edge=nm<420?0.3+0.7*(nm-400)/20:nm>680?0.3+0.7*(700-nm)/20:1;return[Math.max(0,r*edge*255),Math.max(0,g*edge*255),Math.max(0,b*edge*255)]; }
