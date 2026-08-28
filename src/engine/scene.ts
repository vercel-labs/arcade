import { cameraMatrices, type Camera, type CameraMatrices } from './camera.ts';
import {
  mat4Identity,
  mat4Multiply,
  mat4MultiplyInto,
  mat4RotX,
  mat4RotY,
  mat4RotZ,
  mat4Scale,
  mat4Translate,
  type Mat4,
  type Vec3,
} from './math.ts';
import type { Mesh } from './mesh.ts';
import { rasterize } from './raster.ts';
import type { Material } from './shader.ts';
import type { RenderTarget } from './framebuffer.ts';

function compose(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
  const rotate = mat4Multiply(mat4RotZ(rotation.z), mat4Multiply(mat4RotY(rotation.y), mat4RotX(rotation.x)));
  return mat4Multiply(
    mat4Translate(position.x, position.y, position.z),
    mat4Multiply(rotate, mat4Scale(scale.x, scale.y, scale.z)),
  );
}

function copyMatrix(out: Mat4, source: Mat4): Mat4 {
  for (let i = 0; i < 16; i++) out[i] = source[i];
  return out;
}

export class Object3D {
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly rotation: Vec3 = { x: 0, y: 0, z: 0 };
  readonly scale: Vec3 = { x: 1, y: 1, z: 1 };
  readonly children: Object3D[] = [];
  parent: Object3D | null = null;
  visible = true;
  renderOrder = 0;
  matrix: Mat4 = mat4Identity();
  worldMatrix: Mat4 = mat4Identity();
  matrixAutoUpdate = true;

  add<T extends Object3D>(child: T): T {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(child: Object3D): void {
    const index = this.children.indexOf(child);
    if (index < 0) return;
    this.children.splice(index, 1);
    child.parent = null;
  }

  clear(): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }

  setMatrix(matrix: Mat4): this {
    copyMatrix(this.matrix, matrix);
    this.matrixAutoUpdate = false;
    return this;
  }

  updateMatrix(): void {
    if (this.matrixAutoUpdate) this.matrix = compose(this.position, this.rotation, this.scale);
  }

  updateWorldMatrix(parentWorld: Mat4 | null = null): void {
    this.updateMatrix();
    if (parentWorld) mat4MultiplyInto(this.worldMatrix, parentWorld, this.matrix);
    else copyMatrix(this.worldMatrix, this.matrix);
    for (const child of this.children) child.updateWorldMatrix(this.worldMatrix);
  }
}

export class Group extends Object3D {}

export interface RenderContext {
  target: RenderTarget;
  camera: Camera;
  cameraMatrices: CameraMatrices;
  worldMatrix: Mat4;
  /** Present while an InstancedMesh is drawing one of its instances. */
  instanceIndex?: number;
  /** Optional per-instance color available to material uniform callbacks. */
  instanceColor?: Vec3;
}

export type UniformSource<U> = U | ((context: RenderContext) => U);

/** A retained shader definition plus the uniforms used by one or more objects. */
export class MaterialInstance<U> {
  constructor(
    readonly definition: Material<U>,
    public uniforms: UniformSource<U>,
  ) {}

  resolve(context: RenderContext): U {
    return typeof this.uniforms === 'function'
      ? (this.uniforms as (context: RenderContext) => U)(context)
      : this.uniforms;
  }
}

export interface WorldUniforms {
  mvp: Mat4;
  model: Mat4;
}

/** Bind material-specific values while the scene supplies model and camera matrices. */
export function worldUniforms<E extends object>(
  extras: E | ((context: RenderContext) => E),
): UniformSource<E & WorldUniforms> {
  return (context) => ({
    ...(typeof extras === 'function' ? (extras as (context: RenderContext) => E)(context) : extras),
    mvp: mat4Multiply(context.cameraMatrices.viewProjection, context.worldMatrix),
    model: context.worldMatrix,
  });
}

export type WorldMaterialValues<U extends WorldUniforms> = Omit<U, keyof WorldUniforms>;

/** Retained material values whose model/MVP fields are supplied by scene traversal. */
export class WorldMaterialInstance<U extends WorldUniforms> extends MaterialInstance<U> {
  private readonly resolved: U;

  constructor(
    definition: Material<U>,
    readonly values: WorldMaterialValues<U>,
  ) {
    const resolved = {
      ...values,
      mvp: mat4Identity(),
      model: mat4Identity(),
    } as U;
    super(definition, resolved);
    this.resolved = resolved;
  }

  override resolve(context: RenderContext): U {
    Object.assign(this.resolved, this.values);
    mat4MultiplyInto(this.resolved.mvp, context.cameraMatrices.viewProjection, context.worldMatrix);
    copyMatrix(this.resolved.model, context.worldMatrix);
    return this.resolved;
  }
}

abstract class RenderableObject extends Object3D {
  abstract draw(context: RenderContext): void;
}

export class MeshObject<U> extends RenderableObject {
  geometry: Mesh;
  material: MaterialInstance<U>;

  constructor(geometry: Mesh, material: MaterialInstance<U>);
  constructor(
    geometry: Mesh,
    material: Material<U>,
    uniforms: UniformSource<U>,
  );
  constructor(
    geometry: Mesh,
    material: Material<U> | MaterialInstance<U>,
    uniforms?: UniformSource<U>,
  ) {
    super();
    this.geometry = geometry;
    this.material = material instanceof MaterialInstance
      ? material
      : new MaterialInstance(material, uniforms as UniformSource<U>);
  }

  draw(context: RenderContext): void {
    rasterize(context.target, this.geometry, this.material.definition, this.material.resolve(context));
  }
}

/** One geometry/material rendered repeatedly with retained per-instance transforms. */
export class InstancedMesh<U> extends RenderableObject {
  geometry: Mesh;
  material: MaterialInstance<U>;
  private readonly instanceMatrices: Mat4[] = [];
  private readonly instanceWorldMatrices: Mat4[] = [];
  private readonly instanceColors: (Vec3 | undefined)[] = [];
  private _count = 0;
  instanceMatrixVersion = 0;
  instanceColorVersion = 0;

  constructor(geometry: Mesh, material: MaterialInstance<U>);
  constructor(geometry: Mesh, material: Material<U>, uniforms: UniformSource<U>);
  constructor(
    geometry: Mesh,
    material: Material<U> | MaterialInstance<U>,
    uniforms?: UniformSource<U>,
  ) {
    super();
    this.geometry = geometry;
    this.material = material instanceof MaterialInstance
      ? material
      : new MaterialInstance(material, uniforms as UniformSource<U>);
  }

  get count(): number {
    return this._count;
  }

  set count(count: number) {
    if (!Number.isInteger(count) || count < 0 || count > this.instanceMatrices.length) {
      throw new RangeError(`instance count ${count} is outside capacity ${this.instanceMatrices.length}`);
    }
    this._count = count;
  }

  get capacity(): number {
    return this.instanceMatrices.length;
  }

  clearInstances(): this {
    this._count = 0;
    return this;
  }

  setMatrixAt(index: number, matrix: Mat4): this {
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`invalid instance index ${index}`);
    const retained = this.instanceMatrices[index] ?? mat4Identity();
    copyMatrix(retained, matrix);
    this.instanceMatrices[index] = retained;
    this.instanceWorldMatrices[index] ??= mat4Identity();
    if (index >= this._count) this._count = index + 1;
    this.instanceMatrixVersion++;
    return this;
  }

  getMatrixAt(index: number, target: Mat4 = mat4Identity()): Mat4 {
    const matrix = this.instanceMatrices[index];
    if (!matrix) throw new RangeError(`instance ${index} is outside capacity ${this.capacity}`);
    return copyMatrix(target, matrix);
  }

  setColorAt(index: number, color: Vec3): this {
    if (!this.instanceMatrices[index]) throw new RangeError(`instance ${index} is outside capacity ${this.capacity}`);
    const retained = this.instanceColors[index] ?? { x: 0, y: 0, z: 0 };
    retained.x = color.x;
    retained.y = color.y;
    retained.z = color.z;
    this.instanceColors[index] = retained;
    this.instanceColorVersion++;
    return this;
  }

  getColorAt(index: number): Vec3 | undefined {
    const color = this.instanceColors[index];
    return color ? { ...color } : undefined;
  }

  draw(context: RenderContext): void {
    const objectWorld = context.worldMatrix;
    for (let index = 0; index < this._count; index++) {
      const instanceMatrix = this.instanceMatrices[index];
      const instanceWorld = this.instanceWorldMatrices[index];
      mat4MultiplyInto(instanceWorld, objectWorld, instanceMatrix);
      context.worldMatrix = instanceWorld;
      context.instanceIndex = index;
      context.instanceColor = this.instanceColors[index];
      rasterize(context.target, this.geometry, this.material.definition, this.material.resolve(context));
    }
    context.worldMatrix = objectWorld;
    context.instanceIndex = undefined;
    context.instanceColor = undefined;
  }
}

/** Retains objects between frames while exposing a sequential authoring API. */
export class ObjectPool<T extends Object3D> extends Group {
  private cursor = 0;

  constructor(private readonly factory: () => T) {
    super();
  }

  begin(): void {
    this.cursor = 0;
    for (const child of this.children) child.visible = false;
  }

  acquire(): T {
    let object = this.children[this.cursor] as T | undefined;
    if (!object) object = this.add(this.factory());
    object.visible = true;
    this.cursor++;
    return object;
  }

  get activeCount(): number {
    return this.cursor;
  }

  get pooledCount(): number {
    return this.children.length;
  }
}

export class Scene extends Group {
  mesh<U>(geometry: Mesh, material: MaterialInstance<U>, matrix?: Mat4): MeshObject<U>;
  mesh<U>(geometry: Mesh, material: Material<U>, uniforms: UniformSource<U>, matrix?: Mat4): MeshObject<U>;
  mesh<U>(
    geometry: Mesh,
    material: Material<U> | MaterialInstance<U>,
    uniformsOrMatrix?: UniformSource<U> | Mat4,
    matrix?: Mat4,
  ): MeshObject<U> {
    const retained = material instanceof MaterialInstance;
    const object = retained
      ? new MeshObject(geometry, material)
      : new MeshObject(geometry, material, uniformsOrMatrix as UniformSource<U>);
    const transform = retained ? uniformsOrMatrix as Mat4 | undefined : matrix;
    if (transform) object.setMatrix(transform);
    return this.add(object);
  }

  instancedMesh<U>(geometry: Mesh, material: MaterialInstance<U>): InstancedMesh<U>;
  instancedMesh<U>(geometry: Mesh, material: Material<U>, uniforms: UniformSource<U>): InstancedMesh<U>;
  instancedMesh<U>(
    geometry: Mesh,
    material: Material<U> | MaterialInstance<U>,
    uniforms?: UniformSource<U>,
  ): InstancedMesh<U> {
    const object = material instanceof MaterialInstance
      ? new InstancedMesh(geometry, material)
      : new InstancedMesh(geometry, material, uniforms as UniformSource<U>);
    return this.add(object);
  }
}

interface RenderItem {
  object: RenderableObject;
  sequence: number;
}

/** Traverses a scene into a stable render list, then uses the existing rasterizer. */
export class SceneRenderer {
  private readonly items: RenderItem[] = [];

  render(target: RenderTarget, scene: Scene, camera: Camera): void {
    scene.updateWorldMatrix();
    const matrices = cameraMatrices(camera, target.width / target.height);
    const items = this.items;
    let sequence = 0;
    const visit = (object: Object3D, parentVisible: boolean): void => {
      const visible = parentVisible && object.visible;
      if (!visible) return;
      if (object instanceof RenderableObject) {
        const item = items[sequence] ?? { object, sequence };
        item.object = object;
        item.sequence = sequence;
        items[sequence++] = item;
      }
      for (const child of object.children) visit(child, visible);
    };
    visit(scene, true);
    items.length = sequence;
    items.sort((a, b) => a.object.renderOrder - b.object.renderOrder || a.sequence - b.sequence);
    const context: RenderContext = { target, camera, cameraMatrices: matrices, worldMatrix: scene.worldMatrix };
    for (const { object } of items) {
      context.worldMatrix = object.worldMatrix;
      object.draw(context);
    }
  }
}
