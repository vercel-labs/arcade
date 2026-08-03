import { cameraMatrices, type Camera, type CameraMatrices } from './camera.ts';
import {
  mat4Identity,
  mat4Multiply,
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
    this.matrix = matrix.slice();
    this.matrixAutoUpdate = false;
    return this;
  }

  updateMatrix(): void {
    if (this.matrixAutoUpdate) this.matrix = compose(this.position, this.rotation, this.scale);
  }

  updateWorldMatrix(parentWorld: Mat4 | null = null): void {
    this.updateMatrix();
    this.worldMatrix = parentWorld ? mat4Multiply(parentWorld, this.matrix) : this.matrix.slice();
    for (const child of this.children) child.updateWorldMatrix(this.worldMatrix);
  }
}

export class Group extends Object3D {}

export interface RenderContext {
  target: RenderTarget;
  camera: Camera;
  cameraMatrices: CameraMatrices;
  worldMatrix: Mat4;
}

export type UniformSource<U> = U | ((context: RenderContext) => U);

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

abstract class RenderableObject extends Object3D {
  abstract draw(context: RenderContext): void;
}

export class MeshObject<U> extends RenderableObject {
  constructor(
    readonly geometry: Mesh,
    readonly material: Material<U>,
    readonly uniforms: UniformSource<U>,
  ) {
    super();
  }

  draw(context: RenderContext): void {
    const uniforms = typeof this.uniforms === 'function'
      ? (this.uniforms as (context: RenderContext) => U)(context)
      : this.uniforms;
    rasterize(context.target, this.geometry, this.material, uniforms);
  }
}

export class Scene extends Group {
  mesh<U>(geometry: Mesh, material: Material<U>, uniforms: UniformSource<U>, matrix?: Mat4): MeshObject<U> {
    const object = new MeshObject(geometry, material, uniforms);
    if (matrix) object.setMatrix(matrix);
    return this.add(object);
  }
}

interface RenderItem {
  object: RenderableObject;
  sequence: number;
}

/** Traverses a scene into a stable render list, then uses the existing rasterizer. */
export class SceneRenderer {
  render(target: RenderTarget, scene: Scene, camera: Camera): void {
    scene.updateWorldMatrix();
    const matrices = cameraMatrices(camera, target.width / target.height);
    const items: RenderItem[] = [];
    let sequence = 0;
    const visit = (object: Object3D, parentVisible: boolean): void => {
      const visible = parentVisible && object.visible;
      if (!visible) return;
      if (object instanceof RenderableObject) items.push({ object, sequence: sequence++ });
      for (const child of object.children) visit(child, visible);
    };
    visit(scene, true);
    items.sort((a, b) => a.object.renderOrder - b.object.renderOrder || a.sequence - b.sequence);
    for (const { object } of items) {
      object.draw({ target, camera, cameraMatrices: matrices, worldMatrix: object.worldMatrix });
    }
  }
}
