import type { RenderTarget } from '../framebuffer.ts';
import type { Mesh } from '../mesh.ts';
import type { Material } from '../shader.ts';
import { TextureReadbackRing } from './readback-ring.ts';

const COPY_DST = 0x0008;
const INDEX = 0x0010;
const VERTEX = 0x0020;
const UNIFORM = 0x0040;
const TEXTURE_COPY_SRC = 0x01;
const RENDER_ATTACHMENT = 0x10;
const VERTEX_STAGE = 0x1;
const FRAGMENT_STAGE = 0x2;
const UNIFORM_SLOT_BYTES = 256;
const UNIFORM_SLOT_FLOATS = UNIFORM_SLOT_BYTES / 4;

interface GeometryBuffers {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

interface RenderResources {
  width: number;
  height: number;
  color: GPUTexture;
  depth: GPUTexture;
  readback: TextureReadbackRing;
}

export interface WebGpuDraw {
  geometry: Mesh;
  material: Material<unknown>;
  /** Snapshot captured while scene traversal points at this exact object/instance. */
  uniforms: Float32Array;
}

export interface WebGpuFrameStats {
  readonly submitMs: number;
  readonly readbackMs: number;
  readonly draws: number;
  readonly triangles: number;
}

export class WebGpuSceneRenderer {
  readonly #geometry = new WeakMap<Mesh, GeometryBuffers>();
  readonly #pipelines = new WeakMap<Material<unknown>, GPURenderPipeline>();
  readonly #bindGroupLayout: GPUBindGroupLayout;
  readonly #pipelineLayout: GPUPipelineLayout;
  #resources?: RenderResources;
  #uniformBuffer?: GPUBuffer;
  #uniformBindGroup?: GPUBindGroup;
  #uniformCapacity = 0;
  #lastSubmitMs = 0;
  #lastDraws = 0;
  #lastTriangles = 0;
  #lastReadbackMs = 0;
  #streamKey?: object;

  constructor(
    readonly device: GPUDevice,
    private gpuRoot: GPU | undefined,
    private readonly onFrameReady: () => void,
  ) {
    this.#bindGroupLayout = device.createBindGroupLayout({
      label: 'arcade-webgpu-draw-layout',
      entries: [{
        binding: 0,
        visibility: VERTEX_STAGE | FRAGMENT_STAGE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNIFORM_SLOT_BYTES },
      }],
    });
    this.#pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.#bindGroupLayout] });
  }

  supports(draws: readonly WebGpuDraw[]): boolean {
    return draws.every((draw) => draw.material.webgpu !== undefined && draw.material.blend !== 'alpha');
  }

  render(target: RenderTarget, draws: readonly WebGpuDraw[], streamKey: object): boolean {
    if (this.#streamKey !== streamKey) {
      this.#streamKey = streamKey;
      this.resetFrames();
    }
    const resources = this.#ensureResources(target.width, target.height);
    const completed = resources.readback.takeLatest();
    if (completed) {
      this.#lastReadbackMs = completed.latencyMs;
      copyFrame(completed.pixels, target);
    }

    const afterSubmit = this.#encodeAndSubmit(target, resources, draws);
    afterSubmit?.();
    return completed !== null;
  }

  stats(): WebGpuFrameStats {
    return {
      submitMs: this.#lastSubmitMs,
      readbackMs: this.#lastReadbackMs,
      draws: this.#lastDraws,
      triangles: this.#lastTriangles,
    };
  }

  resetFrames(): void {
    const resources = this.#resources;
    this.#resources = undefined;
    if (!resources) return;
    void resources.readback.dispose();
    resources.color.destroy();
    resources.depth.destroy();
  }

  async dispose(): Promise<void> {
    const resources = this.#resources;
    this.#resources = undefined;
    if (resources) {
      await resources.readback.dispose();
      resources.color.destroy();
      resources.depth.destroy();
    }
    this.#uniformBuffer?.destroy();
    this.#uniformBuffer = undefined;
    this.device.destroy();
    this.gpuRoot = undefined;
  }

  #encodeAndSubmit(
    target: RenderTarget,
    resources: RenderResources,
    draws: readonly WebGpuDraw[],
  ): (() => void) | null {
    this.#ensureUniformCapacity(draws.length);
    const uniformData = new Float32Array(draws.length * UNIFORM_SLOT_FLOATS);
    let triangles = 0;
    for (let index = 0; index < draws.length; index++) {
      const draw = draws[index]!;
      uniformData.set(draw.uniforms, index * UNIFORM_SLOT_FLOATS);
      triangles += Math.floor(draw.geometry.indices.length / 3);
    }
    if (uniformData.byteLength > 0) this.device.queue.writeBuffer(this.#uniformBuffer!, 0, uniformData);

    const started = performance.now();
    const encoder = this.device.createCommandEncoder({ label: 'arcade-webgpu-frame' });
    const clear = target.color;
    const pass = encoder.beginRenderPass({
      label: 'arcade-webgpu-scene',
      colorAttachments: [{
        view: resources.color.createView(),
        clearValue: {
          r: (clear[0] ?? 0) / 255,
          g: (clear[1] ?? 0) / 255,
          b: (clear[2] ?? 0) / 255,
          a: 0,
        },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: resources.depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    for (let index = 0; index < draws.length; index++) {
      const draw = draws[index]!;
      const geometry = this.#geometryBuffers(draw.geometry);
      pass.setPipeline(this.#pipeline(draw.material));
      pass.setBindGroup(0, this.#uniformBindGroup!, [index * UNIFORM_SLOT_BYTES]);
      pass.setVertexBuffer(0, geometry.vertex);
      pass.setIndexBuffer(geometry.index, 'uint32');
      pass.drawIndexed(geometry.indexCount);
    }
    pass.end();
    const afterSubmit = resources.readback.capture(encoder, resources.color, this.onFrameReady);
    if (!afterSubmit) return null;
    this.device.queue.submit([encoder.finish()]);
    this.#lastSubmitMs = performance.now() - started;
    this.#lastDraws = draws.length;
    this.#lastTriangles = triangles;
    return afterSubmit;
  }

  #ensureResources(width: number, height: number): RenderResources {
    const current = this.#resources;
    if (current && current.width === width && current.height === height) return current;
    if (current) {
      void current.readback.dispose();
      current.color.destroy();
      current.depth.destroy();
    }
    const color = this.device.createTexture({
      label: 'arcade-webgpu-color',
      size: [width, height],
      format: 'rgba8unorm',
      usage: RENDER_ATTACHMENT | TEXTURE_COPY_SRC,
    });
    const resources = {
      width,
      height,
      color,
      depth: this.device.createTexture({
        label: 'arcade-webgpu-depth',
        size: [width, height],
        format: 'depth32float',
        usage: RENDER_ATTACHMENT,
      }),
      readback: new TextureReadbackRing(this.device, width, height),
    };
    this.#resources = resources;
    return resources;
  }

  #ensureUniformCapacity(draws: number): void {
    const needed = Math.max(1, draws) * UNIFORM_SLOT_BYTES;
    if (needed <= this.#uniformCapacity) return;
    let capacity = UNIFORM_SLOT_BYTES;
    while (capacity < needed) capacity *= 2;
    this.#uniformBuffer?.destroy();
    this.#uniformBuffer = this.device.createBuffer({
      label: 'arcade-webgpu-uniform-ring',
      size: capacity,
      usage: UNIFORM | COPY_DST,
    });
    this.#uniformBindGroup = this.device.createBindGroup({
      layout: this.#bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.#uniformBuffer, size: UNIFORM_SLOT_BYTES } }],
    });
    this.#uniformCapacity = capacity;
  }

  #geometryBuffers(mesh: Mesh): GeometryBuffers {
    const cached = this.#geometry.get(mesh);
    if (cached) return cached;
    const vertices = new Float32Array(mesh.vertices.length * 11);
    for (let index = 0; index < mesh.vertices.length; index++) {
      const vertex = mesh.vertices[index]!;
      const offset = index * 11;
      vertices.set([
        vertex.position.x, vertex.position.y, vertex.position.z,
        vertex.normal.x, vertex.normal.y, vertex.normal.z,
        vertex.uv[0], vertex.uv[1],
        vertex.color.x, vertex.color.y, vertex.color.z,
      ], offset);
    }
    const indices = Uint32Array.from(mesh.indices);
    const vertex = this.device.createBuffer({
      label: 'arcade-webgpu-vertices',
      size: Math.max(4, vertices.byteLength),
      usage: VERTEX | COPY_DST,
    });
    const index = this.device.createBuffer({
      label: 'arcade-webgpu-indices',
      size: Math.max(4, indices.byteLength),
      usage: INDEX | COPY_DST,
    });
    if (vertices.byteLength) this.device.queue.writeBuffer(vertex, 0, vertices);
    if (indices.byteLength) this.device.queue.writeBuffer(index, 0, indices);
    const buffers = { vertex, index, indexCount: indices.length };
    this.#geometry.set(mesh, buffers);
    return buffers;
  }

  #pipeline(material: Material<unknown>): GPURenderPipeline {
    const cached = this.#pipelines.get(material);
    if (cached) return cached;
    const module = this.device.createShaderModule({
      label: 'arcade-webgpu-material',
      code: material.webgpu!.wgsl,
    });
    const blend = material.blend === 'add'
      ? { color: { srcFactor: 'one' as const, dstFactor: 'one' as const }, alpha: { srcFactor: 'one' as const, dstFactor: 'one' as const } }
      : undefined;
    const pipeline = this.device.createRenderPipeline({
      label: 'arcade-webgpu-pipeline',
      layout: this.#pipelineLayout,
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 44,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
            { shaderLocation: 3, offset: 32, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm', blend }],
      },
      primitive: { topology: 'triangle-list', cullMode: material.cull === 'none' ? 'none' : material.cull ?? 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: material.blend === undefined || material.blend === 'opaque', depthCompare: 'less' },
    });
    this.#pipelines.set(material, pipeline);
    return pipeline;
  }
}

function copyFrame(pixels: Uint8Array, target: RenderTarget): void {
  const color = target.color;
  const depth = target.depth;
  for (let pixel = 0, rgba = 0, rgb = 0; pixel < depth.length; pixel++, rgba += 4, rgb += 3) {
    color[rgb] = pixels[rgba]!;
    color[rgb + 1] = pixels[rgba + 1]!;
    color[rgb + 2] = pixels[rgba + 2]!;
    depth[pixel] = pixels[rgba + 3] === 0 ? Infinity : 0;
  }
}
