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
