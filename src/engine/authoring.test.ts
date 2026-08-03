import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnimationScheduler,
  FrameClock,
  GeometryBuilder,
  Group,
  MeshObject,
  Object3D,
  ObjectPool,
  RenderTarget,
  Scene,
  SceneRenderer,
  Tween,
  cameraMatrices,
  intersectRayPlane,
  lambertMaterial,
  type LambertUniforms,
  mat4Identity,
  mat4Multiply,
  mat4Translate,
  rayFromCamera,
  rasterize,
  smoothstep,
  travelPoint,
  type Camera,
  type Vec3,
  WorldMaterialInstance,
  worldUniforms,
} from './index.ts';

const camera: Camera = {
  eye: { x: 0, y: 4, z: 6 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovy: Math.PI / 3,
  near: 0.05,
  far: 100,
};

test('Object3D propagates exact local matrices through parent groups', () => {
  const scene = new Scene();
  const group = scene.add(new Group().setMatrix(mat4Translate(2, 3, 4)));
  const child = group.add(new Object3D().setMatrix(mat4Translate(5, 6, 7)));
  scene.updateWorldMatrix();
  assert.deepEqual(child.worldMatrix, mat4Multiply(mat4Translate(2, 3, 4), mat4Translate(5, 6, 7)));
  assert.deepEqual([child.worldMatrix[12], child.worldMatrix[13], child.worldMatrix[14]], [7, 9, 11]);
});

test('SceneRenderer preserves the existing rasterizer output', () => {
  const geometry = new GeometryBuilder()
    .triangle(
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1.5, z: 0 },
      { color: { x: 210, y: 120, z: 70 }, normal: { x: 0, y: 0, z: 1 } },
    )
    .mesh();
  const direct = new RenderTarget(80, 48);
  const authored = new RenderTarget(80, 48);
  direct.clear(3, 4, 5);
  authored.clear(3, 4, 5);
  const matrices = cameraMatrices(camera, direct.width / direct.height);
  const uniforms = {
    mvp: matrices.viewProjection,
    model: mat4Identity(),
    lightDir: { x: 0, y: 0, z: 1 } as Vec3,
    ambient: 0.4,
  };
  // Importing through the public path is intentional: the authored path must be
  // a compatibility layer over the exact same material and rasterizer semantics.
  const scene = new Scene();
  scene.mesh(
    geometry,
    lambertMaterial,
    worldUniforms({
      ...uniforms,
    }),
  );
  rasterize(direct, geometry, lambertMaterial, uniforms);
  new SceneRenderer().render(authored, scene, camera);
  assert.deepEqual(authored.color, direct.color);
  assert.deepEqual(authored.depth, direct.depth);
});

test('retained materials and object pools reuse identities across frames', () => {
  const geometry = new GeometryBuilder().triangle(
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
  ).mesh();
  let created = 0;
  const pool = new ObjectPool(() => {
    created++;
    return new MeshObject(geometry, new WorldMaterialInstance(lambertMaterial, {
      lightDir: { x: 0, y: 0, z: 1 },
      ambient: 0.4,
    }));
  });
  pool.begin();
  const first = pool.acquire();
  const second = pool.acquire();
  assert.equal(created, 2);
  pool.begin();
  const reused = pool.acquire();
  assert.equal(reused, first);
  assert.equal(created, 2);
  assert.equal(second.visible, false);
  const material = reused.material as WorldMaterialInstance<LambertUniforms>;
  material.values.ambient = 0.8;
  assert.equal(material.values.ambient, 0.8);
});

test('shared camera picking intersects the board plane', () => {
  const ray = rayFromCamera(camera, 0, 0, 16 / 9);
  const hit = intersectRayPlane(ray, { x: 0, y: 1, z: 0 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.x) < 1e-9);
  assert.ok(Math.abs(hit.y) < 1e-9);
  assert.ok(Math.abs(hit.z) < 1e-9);
});

test('animation scheduler composes tweens while custom geometry stays custom', () => {
  const values: number[] = [];
  let completed = 0;
  const scheduler = new AnimationScheduler();
  scheduler.add(new Tween({ duration: 1, ease: smoothstep, update: (value) => values.push(value), complete: () => completed++ }));
  assert.equal(scheduler.update(0.25), true);
  assert.equal(scheduler.update(0.75), false);
  assert.deepEqual(values, [smoothstep(0.25), 1]);
  assert.equal(completed, 1);
  assert.equal(scheduler.needsFrame, false);
  assert.deepEqual(travelPoint({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 4 }, 0.5, 1), { x: 1, y: 1, z: 2 });

  const clock = new FrameClock();
  assert.equal(clock.tick(10), 0);
  assert.equal(clock.tick(10.25), 0.25);
  assert.equal(clock.elapsed, 0.25);
  clock.reset();
  assert.equal(clock.elapsed, 0);
});
