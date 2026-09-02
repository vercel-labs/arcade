import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from './framebuffer.ts';
import { addSpectralRibbon } from './light-field.ts';

test('spectral ribbon continuously fills the space between wavelength paths',()=>{
  const target=new RenderTarget(80,40);
  addSpectralRibbon(target,[
    {start:{x:10,y:15},end:{x:70,y:8},color:[255,20,20],intensity:1},
    {start:{x:10,y:20},end:{x:70,y:20},color:[20,255,40],intensity:1},
    {start:{x:10,y:25},end:{x:70,y:32},color:[20,80,255],intensity:1},
  ]);
  for(let y=9;y<=30;y++){
    const i=(y*target.width+60)*3;
    assert.ok(target.color[i]+target.color[i+1]+target.color[i+2]>0,`gap at downstream row ${y}`);
  }
});
