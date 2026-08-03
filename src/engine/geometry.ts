import { cross3, dot3, normalize3, sub3, type Vec3 } from './math.ts';
import type { Mesh } from './mesh.ts';
import type { VertexIn } from './shader.ts';

export interface VertexOptions {
  normal?: Vec3;
  uv?: [number, number];
  color?: Vec3;
}

const WHITE: Vec3 = { x: 255, y: 255, z: 255 };

/** Mutable triangle buffer for procedural geometry authoring. */
export class GeometryBuilder {
  readonly vertices: VertexIn[] = [];
  readonly indices: number[] = [];

  vertex(position: Vec3, options: VertexOptions = {}): number {
    this.vertices.push({
      position: { ...position },
      normal: { ...(options.normal ?? { x: 0, y: 1, z: 0 }) },
      uv: [...(options.uv ?? [0, 0])] as [number, number],
      color: { ...(options.color ?? WHITE) },
    });
    return this.vertices.length - 1;
  }

  triangle(a: Vec3, b: Vec3, c: Vec3, options: VertexOptions = {}, outward?: Vec3): this {
    let bb = b;
    let cc = c;
    let normal = options.normal ?? normalize3(cross3(sub3(bb, a), sub3(cc, a)));
    if (outward && dot3(normal, outward) < 0) {
      [bb, cc] = [cc, bb];
      normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    }
    const base = this.vertices.length;
    this.vertex(a, { ...options, normal });
    this.vertex(bb, { ...options, normal });
    this.vertex(cc, { ...options, normal });
    this.indices.push(base, base + 1, base + 2);
    return this;
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, options: VertexOptions = {}, outward?: Vec3): this {
    this.triangle(a, b, c, options, outward);
    this.triangle(a, c, d, options, outward);
    return this;
  }

  append(mesh: Mesh): this {
    const base = this.vertices.length;
    for (const vertex of mesh.vertices) {
      this.vertices.push({
        position: { ...vertex.position },
        normal: { ...vertex.normal },
        uv: [...vertex.uv],
        color: { ...vertex.color },
      });
    }
    for (const index of mesh.indices) this.indices.push(base + index);
    return this;
  }

  mesh(): Mesh {
    return { vertices: this.vertices, indices: this.indices };
  }
}
