import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraMatrices, mat4MulVec4, RenderTarget } from '../../engine/index.ts';
import { PRISM_TEST_DEPTH, PRISM_TEST_SIDE, prismTestCamera, PrismTestScene } from './prism-test-scene.ts';

test('prism-test is deterministic and pointer-reactive',()=>{
  const scene=new PrismTestScene(),a=new RenderTarget(240,120),b=new RenderTarget(240,120),moved=new RenderTarget(240,120);
  scene.renderScene(a,2);scene.resetView();scene.renderScene(b,2);
  assert.deepEqual([...a.color],[...b.color]);
  scene.setPointer(.9,.1);for(let i=0;i<24;i++)scene.renderScene(moved,2+i/30);
  assert.notDeepEqual([...a.color],[...moved.color]);
  const lit=a.color.reduce((n,value)=>n+(value>8?1:0),0);
  assert.ok(lit>300,'dark prism should still contain glass, beam, spectrum, and dust');
});

test('prism-test preserves vGPU depth ratio and pointer camera parallax',()=>{
  assert.ok(Math.abs(PRISM_TEST_DEPTH/PRISM_TEST_SIDE-.3/.57)<1e-9);
  const offset=(orbit:number)=>{const vp=cameraMatrices(prismTestCamera(orbit,0),2).viewProjection,front=mat4MulVec4(vp,{x:0,y:0,z:PRISM_TEST_DEPTH/2,w:1}),back=mat4MulVec4(vp,{x:0,y:0,z:-PRISM_TEST_DEPTH/2,w:1});return front.x/front.w-back.x/back.w;};
  assert.ok(offset(-1)*offset(1)<0,'opposite pointer sides reveal the back face on opposite sides');
});
