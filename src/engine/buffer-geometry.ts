import type { Vec3 } from './math.ts';
import type { AABB, Mesh } from './mesh.ts';
import type { VertexIn } from './shader.ts';

export type BufferAttributeName = 'position' | 'normal' | 'uv' | 'color';

export interface UpdateRange {
  offset: number;
  count: number;
}

export interface BoundingSphere {
  center: Vec3;
  radius: number;
}

function cloneVertex(vertex: VertexIn): VertexIn {
  return {
    position: { ...vertex.position },
    normal: { ...vertex.normal },
    uv: [...vertex.uv],
    color: { ...vertex.color },
  };
}

/** A typed view over one field of BufferGeometry's rasterizer-compatible vertices. */
export class BufferAttribute {
  version = 0;
  readonly updateRange: UpdateRange = { offset: 0, count: -1 };

  constructor(
    private readonly geometry: BufferGeometry,
    readonly name: BufferAttributeName,
    readonly itemSize: 2 | 3,
  ) {}

  get count(): number {
    return this.geometry.vertices.length;
  }

  get needsUpdate(): boolean {
    return false;
  }

  set needsUpdate(value: boolean) {
    if (value) this.markUpdated(0, this.count);
  }

  getX(index: number): number {
    return this.component(index, 0);
  }

  getY(index: number): number {
    return this.component(index, 1);
  }

  getZ(index: number): number {
    return this.itemSize === 3 ? this.component(index, 2) : 0;
  }

  setX(index: number, x: number): this {
    this.setComponent(index, 0, x);
    return this.markUpdated(index, 1);
  }

  setY(index: number, y: number): this {
    this.setComponent(index, 1, y);
    return this.markUpdated(index, 1);
  }

  setZ(index: number, z: number): this {
    if (this.itemSize < 3) throw new Error(`${this.name} is a 2-component attribute`);
    this.setComponent(index, 2, z);
    return this.markUpdated(index, 1);
  }

  setXY(index: number, x: number, y: number): this {
    this.setComponent(index, 0, x);
    this.setComponent(index, 1, y);
    return this.markUpdated(index, 1);
  }

  setXYZ(index: number, x: number, y: number, z: number): this {
    if (this.itemSize < 3) throw new Error(`${this.name} is a 2-component attribute`);
    this.setComponent(index, 0, x);
    this.setComponent(index, 1, y);
    this.setComponent(index, 2, z);
    return this.markUpdated(index, 1);
  }

  markUpdated(offset = 0, count = this.count): this {
    this.version++;
    this.updateRange.offset = offset;
    this.updateRange.count = count;
    this.geometry.markNeedsUpdate(offset, count, this.name === 'position');
    return this;
  }

  private component(index: number, component: 0 | 1 | 2): number {
    const vertex = this.geometry.vertices[index];
    if (!vertex) throw new RangeError(`vertex ${index} is outside geometry with ${this.count} vertices`);
    if (this.name === 'uv') return component === 0 ? vertex.uv[0] : component === 1 ? vertex.uv[1] : 0;
    const value = vertex[this.name];
    return component === 0 ? value.x : component === 1 ? value.y : value.z;
  }

  private setComponent(index: number, component: 0 | 1 | 2, value: number): void {
    const vertex = this.geometry.vertices[index];
    if (!vertex) throw new RangeError(`vertex ${index} is outside geometry with ${this.count} vertices`);
    if (this.name === 'uv') {
      if (component === 0) vertex.uv[0] = value;
      else if (component === 1) vertex.uv[1] = value;
      return;
    }
    const target = vertex[this.name];
    if (component === 0) target.x = value;
    else if (component === 1) target.y = value;
    else target.z = value;
  }
}

/**
 * Mutable geometry with Three.js-style attributes and update tracking. It still
 * implements Mesh directly, so the software rasterizer consumes it unchanged.
 */
export class BufferGeometry implements Mesh {
  readonly attributes: Readonly<Record<BufferAttributeName, BufferAttribute>>;
  readonly updateRange: UpdateRange = { offset: 0, count: -1 };
  version = 0;
  boundingBox: AABB | null = null;
  boundingSphere: BoundingSphere | null = null;
  private reusableVertices: VertexIn[] = [];

  constructor(
    public vertices: VertexIn[] = [],
    public indices: number[] = [],
  ) {
    this.attributes = {
      position: new BufferAttribute(this, 'position', 3),
      normal: new BufferAttribute(this, 'normal', 3),
      uv: new BufferAttribute(this, 'uv', 2),
      color: new BufferAttribute(this, 'color', 3),
    };
  }

  static fromMesh(mesh: Mesh, copy = false): BufferGeometry {
    return new BufferGeometry(
      copy ? mesh.vertices.map(cloneVertex) : mesh.vertices,
      copy ? [...mesh.indices] : mesh.indices,
    );
  }

  /**
   * Reset active topology while retaining vertex objects for a same-shape procedural rebuild.
   * Builders repopulate through appendReusableVertex(); the rasterizer still sees ordinary
   * active `vertices`/`indices` arrays, including legitimately empty or variable-size frames.
   */
  resetForReuse(): this {
    for (let i = this.reusableVertices.length; i < this.vertices.length; i++) {
      this.reusableVertices[i] = this.vertices[i];
    }
    this.vertices.length = 0;
    this.indices.length = 0;
    this.markNeedsUpdate(0, 0);
    return this;
  }

  appendReusableVertex(vertex: VertexIn): number {
    const index = this.vertices.length;
    let retained = this.reusableVertices[index];
    if (!retained) {
      retained = vertex;
      this.reusableVertices[index] = retained;
    } else {
      retained.position.x = vertex.position.x;
      retained.position.y = vertex.position.y;
      retained.position.z = vertex.position.z;
      retained.normal.x = vertex.normal.x;
      retained.normal.y = vertex.normal.y;
      retained.normal.z = vertex.normal.z;
      retained.uv[0] = vertex.uv[0];
      retained.uv[1] = vertex.uv[1];
      retained.color.x = vertex.color.x;
      retained.color.y = vertex.color.y;
      retained.color.z = vertex.color.z;
    }
    this.vertices.push(retained);
    return index;
  }

  getAttribute(name: BufferAttributeName): BufferAttribute {
    return this.attributes[name];
  }

  markNeedsUpdate(offset = 0, count = this.vertices.length, positionsChanged = true): this {
    this.version++;
    this.updateRange.offset = offset;
    this.updateRange.count = count;
    if (positionsChanged) {
      this.boundingBox = null;
      this.boundingSphere = null;
    }
    return this;
  }

  computeBoundingBox(): AABB | null {
    if (this.vertices.length === 0) {
      this.boundingBox = null;
      return null;
    }
    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const vertex of this.vertices) {
      const { x, y, z } = vertex.position;
      if (x < min.x) min.x = x;
      if (y < min.y) min.y = y;
      if (z < min.z) min.z = z;
      if (x > max.x) max.x = x;
      if (y > max.y) max.y = y;
      if (z > max.z) max.z = z;
    }
    this.boundingBox = { min, max };
    return this.boundingBox;
  }

  computeBoundingSphere(): BoundingSphere | null {
    const box = this.boundingBox ?? this.computeBoundingBox();
    if (!box) {
      this.boundingSphere = null;
      return null;
    }
    const center: Vec3 = {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2,
    };
    let radiusSq = 0;
    for (const vertex of this.vertices) {
      const dx = vertex.position.x - center.x;
      const dy = vertex.position.y - center.y;
      const dz = vertex.position.z - center.z;
      radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
    }
    this.boundingSphere = { center, radius: Math.sqrt(radiusSq) };
    return this.boundingSphere;
  }
}
