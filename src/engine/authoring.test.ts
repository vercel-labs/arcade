import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnimationScheduler,
  BufferGeometry,
  DrawList,
  FrameClock,
  GeometryBuilder,
  Group,
  InstancedMesh,
  MeshObject,
  Object3D,
  ObjectPool,
  OrbitCamera,
  RenderTarget,
  ResourceCache,
  Scene,
  SceneRenderer,
  SpringValue,
  Tween,
  cameraMatrices,
  intersectRayPlane,
  lambertMaterial,
  type LambertUniforms,
  mat4Identity,
  mat4Multiply,
  mat4Translate,
  projectedSegmentDistance,
  rayFromCamera,
  Raycaster,
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

test('BufferGeometry exposes mutable attributes, versions, dirty ranges, and bounds', () => {
  const source = new GeometryBuilder().triangle(
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
  ).mesh();
  const geometry = BufferGeometry.fromMesh(source, true);
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  assert.equal(position.count, 3);
  assert.notEqual(geometry.vertices, source.vertices);
  assert.deepEqual(geometry.computeBoundingBox(), {
    min: { x: -1, y: 0, z: 0 },
    max: { x: 1, y: 2, z: 0 },
  });
  assert.deepEqual(geometry.computeBoundingSphere(), {
    center: { x: 0, y: 1, z: 0 },
    radius: Math.sqrt(2),
  });
  position.setXYZ(1, 3, 4, 5);
  assert.deepEqual(geometry.vertices[1].position, { x: 3, y: 4, z: 5 });
  assert.equal(position.version, 1);
  assert.equal(geometry.version, 1);
  assert.deepEqual(geometry.updateRange, { offset: 1, count: 1 });
  assert.equal(geometry.boundingBox, null);
  assert.equal(geometry.boundingSphere, null);
  color.setXYZ(0, 10, 20, 30);
  assert.deepEqual(geometry.vertices[0].color, { x: 10, y: 20, z: 30 });
  assert.equal(geometry.version, 2);
});

test('DrawList snapshots mutable geometry without reallocating its frame slots', () => {
  const source = new GeometryBuilder().triangle(
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
  ).mesh();
  const geometry = BufferGeometry.fromMesh(source, true);
  const draws = new DrawList();
  const uniforms = {
    mvp: mat4Identity(),
    model: mat4Identity(),
    lightDir: { x: 0, y: 0, z: 1 },
    ambient: 0.4,
  };
  draws.draw(geometry, lambertMaterial, uniforms);
  const snapshot = draws.draws[0]!.geometry;
  const vertices = snapshot.vertices;
  const firstVertex = vertices[0];
  const indices = snapshot.indices;
  const version = snapshot.version;

  draws.clear();
  draws.draw(geometry, lambertMaterial, uniforms);
  assert.equal(draws.draws[0]!.geometry.version, version, 'unchanged source geometry should not trigger an upload');

  geometry.getAttribute('position').setXYZ(0, -2, 3, 4);
  draws.clear();
  draws.draw(geometry, lambertMaterial, uniforms);

  assert.equal(draws.draws[0]!.geometry, snapshot);
  assert.equal(snapshot.vertices, vertices);
  assert.equal(snapshot.vertices[0], firstVertex);
  assert.equal(snapshot.indices, indices);
  assert.deepEqual(snapshot.vertices[0]!.position, { x: -2, y: 3, z: 4 });
});

test('InstancedMesh matches separately authored objects and retains instance state', () => {
  const geometry = new GeometryBuilder().triangle(
    { x: -0.5, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { color: { x: 190, y: 120, z: 80 }, normal: { x: 0, y: 0, z: 1 } },
  ).mesh();
  const left = mat4Translate(-1, 0, 0);
  const right = mat4Translate(1, 0, 0);
  const values = { lightDir: { x: 0, y: 0, z: 1 }, ambient: 0.4 };
  const separate = new Scene();
  separate.mesh(geometry, new WorldMaterialInstance(lambertMaterial, values), left);
  separate.mesh(geometry, new WorldMaterialInstance(lambertMaterial, values), right);
  const authored = new Scene();
  const instances = authored.add(new InstancedMesh(
    geometry,
    new WorldMaterialInstance(lambertMaterial, values),
  ));
  instances.setMatrixAt(0, left).setMatrixAt(1, right).setColorAt(1, { x: 1, y: 2, z: 3 });
  const separateTarget = new RenderTarget(80, 48);
  const instancedTarget = new RenderTarget(80, 48);
  separateTarget.clear(3, 4, 5);
  instancedTarget.clear(3, 4, 5);
  const renderer = new SceneRenderer();
  renderer.render(separateTarget, separate, camera);
  renderer.render(instancedTarget, authored, camera);
  assert.deepEqual(instancedTarget.color, separateTarget.color);
  assert.deepEqual(instancedTarget.depth, separateTarget.depth);
  assert.equal(instances.count, 2);
  assert.equal(instances.capacity, 2);
  assert.equal(instances.instanceMatrixVersion, 2);
  assert.equal(instances.instanceColorVersion, 1);
  assert.deepEqual(instances.getMatrixAt(1), right);
  assert.deepEqual(instances.getColorAt(1), { x: 1, y: 2, z: 3 });
  instances.clearInstances();
  assert.equal(instances.count, 0);
  assert.equal(instances.capacity, 2);
});

test('ResourceCache creates once and disposes replaced, deleted, and cleared resources', () => {
  const disposed: string[] = [];
  const cache = new ResourceCache<string, { id: string }>((value, key) => disposed.push(`${key}:${value.id}`));
  let creates = 0;
  const first = cache.getOrCreate('mesh', () => ({ id: `mesh-${++creates}` }));
  const reused = cache.getOrCreate('mesh', () => ({ id: `mesh-${++creates}` }));
  assert.equal(reused, first);
  assert.equal(creates, 1);
  cache.set('mesh', { id: 'replacement' });
  assert.deepEqual(disposed, ['mesh:mesh-1']);
  assert.equal(cache.delete('missing'), false);
  assert.equal(cache.delete('mesh'), true);
  cache.getOrCreate('texture', () => ({ id: 'face' }));
  cache.clear();
  assert.deepEqual(disposed, ['mesh:mesh-1', 'mesh:replacement', 'texture:face']);
  assert.equal(cache.size, 0);
});

test('ResourceCache evicts the least-recently-used entry at a bounded capacity', () => {
  const disposed: string[] = [];
  const cache = new ResourceCache<string, { id: string }>({
    maxEntries: 2,
    dispose: (value, key) => disposed.push(`${key}:${value.id}`),
  });
  cache.set('a', { id: 'A' }).set('b', { id: 'B' });
  assert.equal(cache.get('a')?.id, 'A'); // a becomes newer than b
  cache.set('c', { id: 'C' });
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.deepEqual(disposed, ['b:B']);
});

test('ResourceCache validates bounded capacity', () => {
  assert.throws(() => new ResourceCache({ maxEntries: 0 }), /positive integer/);
});

test('ResourceCache bounds caches whose key type includes undefined', () => {
  const disposed: Array<number | undefined> = [];
  const cache = new ResourceCache<number | undefined, string>({
    maxEntries: 1,
    dispose: (_value, key) => disposed.push(key),
  });
  cache.set(undefined, 'first').set(2, 'second');
  assert.equal(cache.size, 1);
  assert.equal(cache.has(undefined), false);
  assert.deepEqual(disposed, [undefined]);
});

test('ResourceCache snapshot iterators remain finite while reads update bounded recency', () => {
  const cache = new ResourceCache<string, number>({ maxEntries: 2 });
  cache.set('a', 1).set('b', 2);
  const visited: string[] = [];
  for (const key of cache.keys()) {
    visited.push(key);
    cache.get(key);
  }
  assert.deepEqual(visited, ['a', 'b']);
});

test('unbounded ResourceCache reads preserve insertion order', () => {
  const cache = new ResourceCache<string, number>();
  cache.set('a', 1).set('b', 2);
  cache.get('a');
  cache.set('a', 3);
  assert.deepEqual([...cache.keys()], ['a', 'b']);
  assert.deepEqual([...cache.values()], [3, 2]);
});

test('shared camera picking intersects the board plane', () => {
  const ray = rayFromCamera(camera, 0, 0, 16 / 9);
  const hit = intersectRayPlane(ray, { x: 0, y: 1, z: 0 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.x) < 1e-9);
  assert.ok(Math.abs(hit.y) < 1e-9);
  assert.ok(Math.abs(hit.z) < 1e-9);
  const raycaster = new Raycaster().setFromCamera(camera, 0, 0, 16 / 9);
  assert.deepEqual(raycaster.ray, ray);
  assert.deepEqual(raycaster.intersectPlane({ x: 0, y: 1, z: 0 }), hit);
  assert.equal(raycaster.projectedDistance({ x: 0, y: 0, z: 0 }), 0);
  assert.ok(raycaster.projectedDisc(
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
  ));

  const segment = projectedSegmentDistance(
    raycaster.viewProjection,
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    0,
    0.1,
    raycaster.aspect,
    true,
  );
  assert.ok(segment);
  assert.ok(Math.abs(segment.t - 0.5) < 1e-9);
  assert.ok(Math.abs(segment.distance - 0.1) < 1e-9);
  assert.deepEqual(
    raycaster.projectedSegmentDistance({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, true),
    { distance: 0, t: 0.5 },
  );

  const capsule = raycaster.projectedCapsule(
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    [{ x: 0, y: 0.25, z: 0 }],
  );
  assert.equal(capsule.distance, 0);
  assert.equal(capsule.score, 0);
  assert.ok(capsule.radius > 0);

  const closeCamera: Camera = {
    eye: { x: 0, y: 0, z: 3 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fovy: Math.PI / 3,
    near: 0.05,
    far: 100,
  };
  const closeRaycaster = new Raycaster().setFromCamera(closeCamera, 0, 0, 1);
  const farToNear = closeRaycaster.projectedCapsule(
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 },
    [{ x: 0.1, y: 0, z: 0 }],
  );
  const nearToFar = closeRaycaster.projectedCapsule(
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    [{ x: 0.1, y: 0, z: 0 }],
  );
  assert.ok(farToNear.radius < nearToFar.radius, 'capsule thickness is sampled at its authored start');
});

test('OrbitCamera snapshots one pose with explicit projection settings', () => {
  const orbit = new OrbitCamera({
    azimuth: 0.4,
    elevation: 0.6,
    distance: 8,
    target: { x: 1, y: 2, z: 3 },
  });
  const snapshot = orbit.toCamera({ fovy: Math.PI / 4, near: 0.1, far: 250 });
  assert.deepEqual(snapshot, {
    eye: orbit.eye(),
    target: { x: 1, y: 2, z: 3 },
    up: { x: 0, y: 1, z: 0 },
    fovy: Math.PI / 4,
    near: 0.1,
    far: 250,
  });
  orbit.pan(10, -5);
  assert.deepEqual(snapshot.target, { x: 1, y: 2, z: 3 });
  orbit.target.x = 99;
  assert.deepEqual(snapshot.target, { x: 1, y: 2, z: 3 });
  const tilted = orbit.toCamera({ fovy: 1, near: 2, far: 3, up: { x: 0, y: 0, z: 1 } });
  assert.deepEqual(tilted.up, { x: 0, y: 0, z: 1 });
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

  const oneFrame = new SpringValue({ stiffness: 190, damping: 19, min: 0, maxStep: 0.02 }).setTarget(0.6);
  const substeps = new SpringValue({ stiffness: 190, damping: 19, min: 0, maxStep: 0.02 }).setTarget(0.6);
  oneFrame.update(0.1);
  for (let i = 0; i < 5; i++) substeps.update(0.02);
  assert.ok(Math.abs(oneFrame.value - substeps.value) < 1e-12);
  assert.ok(Math.abs(oneFrame.velocity - substeps.velocity) < 1e-12);
  const bounded = new SpringValue({ min: 0 }).setTarget(-1);
  bounded.update(0.02);
  assert.equal(bounded.value, 0);
  assert.equal(bounded.velocity, 0);
});
