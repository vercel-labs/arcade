import assert from 'node:assert/strict';
import test from 'node:test';
import type { PointerFieldSnapshot } from '../engine/pointer-field.ts';
import { Surface } from '../engine/surface.ts';
import { applySurfacePointerEffect, applySurfacePointerTrail } from './surface-pointer-effects.ts';

const pointer=(strength=1):PointerFieldSnapshot=>({x:.5,y:.5,rawX:.5,rawY:.5,vx:3,vy:.5,speed:3.04,strength,trail:[{id:2,x:.48,y:.5,vx:2.5,vy:.4,age:.08,strength:1},{id:1,x:.42,y:.52,vx:1.8,vy:-.3,age:.28,strength:.8}],bursts:[]});

test('paint trail adds residue without clearing underlying scene glyphs',()=>{
  const source=new Surface(40,18);source.fillRect(0,0,40,18,[0,0,0]);source.drawText(2,2,'UNCHANGED',[255,255,255],[0,0,0]);
  const output=applySurfacePointerTrail(source,pointer());
  assert.equal(output.getCell(2,2)?.ch,'U');
  assert.ok(countGlyphs(output)>countGlyphs(source));
});

test('trail uses prominent VERCEL vocabulary',()=>{
  const source=new Surface(40,18);source.fillRect(0,0,40,18,[0,0,0]);
  const output=applySurfacePointerTrail(source,pointer());
  for(let y=0;y<output.rows;y++)for(let x=0;x<output.cols;x++){
    const cell=output.getCell(x,y);if(!cell?.ch?.trim())continue;
    assert.ok('VERCEL'.includes(cell.ch));
  }
  assert.equal(applySurfacePointerTrail(source,{...pointer(0),trail:[]}),source);
  assert.equal(applySurfacePointerEffect(source,pointer(),'off'),source);
});

test('trail translucently samples scene color and preserves its background',()=>{
  const source=new Surface(40,18);source.fillRect(0,0,40,18,[8,16,24]);
  source.setCell(20,9,'X',[220,40,20],[8,16,24],0);
  const output=applySurfacePointerTrail(source,pointer());
  const cell=output.getCell(20,9)!;
  assert.ok('VERCEL'.includes(cell.ch));
  assert.deepEqual(cell.bg,[8,16,24]);
  assert.ok(cell.fg[0]>cell.fg[1]&&cell.fg[1]>=cell.fg[2]);
  assert.ok(cell.fg[0]-cell.fg[1]>50,'scene red should remain prominent through the trail');
});

test('click burst adds expanding VERCEL fragments without clearing the scene',()=>{
  const source=new Surface(50,20);source.fillRect(0,0,50,20,[0,0,0]);source.drawText(2,2,'SCENE',[255,255,255],[0,0,0]);
  const burst={...pointer(0),trail:[],bursts:[{id:9,x:.5,y:.5,vx:.3,vy:-.2,age:.2,lifetime:1}]};
  const output=applySurfacePointerTrail(source,burst);
  assert.equal(output.getCell(2,2)?.ch,'S');
  assert.ok(countGlyphs(output)>countGlyphs(source));
});

test('click smoke remains a loose ring instead of filling one compact blob',()=>{
  const source=new Surface(72,30);source.fillRect(0,0,72,30,[0,0,0]);
  const particles=Array.from({length:30},(_,id)=>{const edge=id%3,t=(Math.floor(id/3)%10)/9;const points=[[0,-1],[.866,.5],[-.866,.5]];const a=points[edge],b=points[(edge+1)%3];return{id:id+100,x:.5+(a[0]+(b[0]-a[0])*t)*.12,y:.5+(a[1]+(b[1]-a[1])*t)*.12,vx:0,vy:0,age:.42,lifetime:1.1}});
  const output=applySurfacePointerTrail(source,{...pointer(0),trail:[],bursts:particles});
  let center=0,ring=0;
  for(let y=0;y<output.rows;y++)for(let x=0;x<output.cols;x++){if(!output.getCell(x,y)?.ch?.trim())continue;const d=Math.hypot(x/(output.cols-1)-.5,y/(output.rows-1)-.5);if(d<.035)center++;if(d>.07&&d<.18)ring++;}
  assert.ok(ring>center*4,'triangle perimeter should outweigh its hollow center');
});

test('trail contains visible blended light and dim residue without pure white',()=>{
  const source=new Surface(60,24);source.fillRect(0,0,60,24,[0,0,0]);
  const output=applySurfacePointerTrail(source,pointer());
  const levels=new Set<number>();
  for(let y=0;y<output.rows;y++)for(let x=0;x<output.cols;x++){const c=output.getCell(x,y);if(c?.ch?.trim())levels.add(c.fg[0]);}
  assert.ok([...levels].some((value)=>value>=100));
  assert.ok([...levels].some((value)=>value<180));
  assert.ok([...levels].every((value)=>value<255));
});

function countGlyphs(surface:Surface):number{let n=0;for(let y=0;y<surface.rows;y++)for(let x=0;x<surface.cols;x++)if(surface.getCell(x,y)?.ch?.trim())n++;return n}
