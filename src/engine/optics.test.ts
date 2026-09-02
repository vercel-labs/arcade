import assert from 'node:assert/strict';
import test from 'node:test';
import { dielectricIor, fresnelTransmission, matchingRayTopology, refract2, traceTrianglePrism, wavelengthRgb } from './optics.ts';

const triangle={a:[0,1] as const,b:[-.866,-.5] as const,c:[.866,-.5] as const};

test('spectral glass bends blue more strongly than red',()=>{
  assert.ok(dielectricIor(420)>dielectricIor(680));
  const blue=traceTrianglePrism(triangle,[4,0],[-1,0],dielectricIor(420));
  const red=traceTrianglePrism(triangle,[4,0],[-1,0],dielectricIor(680));
  assert.ok(blue&&red);
  assert.ok(Math.abs(blue.direction[1]-red.direction[1])>.01);
  assert.equal(matchingRayTopology(blue,red),false,'topology changes must split a spectral ribbon');
});

test('refraction and Fresnel remain finite at ordinary incidence',()=>{
  const ray=refract2([-1,0],[1,0],1/1.5);
  assert.deepEqual(ray,[-1,0]);
  const transmission=fresnelTransmission([-1,0],[1,0],1,1.5);
  assert.ok(transmission>.9&&transmission<1);
});

test('visible wavelengths preserve blue-to-red display ordering',()=>{
  const blue=wavelengthRgb(430),green=wavelengthRgb(530),red=wavelengthRgb(660);
  assert.ok(blue[2]>blue[0]&&green[1]>green[0]&&red[0]>red[2]);
});
