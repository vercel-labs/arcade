import type { RenderTarget } from '../framebuffer.ts';
import type { Mesh } from '../mesh.ts';
import type { Material } from '../shader.ts';
import type { Texture } from '../texture.ts';
import { TextureReadbackRing } from './readback-ring.ts';

const COPY_DST = 0x0008;
const INDEX = 0x0010;
const VERTEX = 0x0020;
const UNIFORM = 0x0040;
const TEXTURE_BINDING = 0x04;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_COPY_SRC = 0x01;
const RENDER_ATTACHMENT = 0x10;
const COLOR_FORMAT: GPUTextureFormat = 'rgba16float';
const VERTEX_STAGE = 0x1;
const FRAGMENT_STAGE = 0x2;
const UNIFORM_SLOT_BYTES = 256;
const UNIFORM_SLOT_FLOATS = UNIFORM_SLOT_BYTES / 4;

interface GeometryBuffers {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
  vertexBytes: number;
  indexBytes: number;
  version?: number;
}

interface RenderResources {
  width: number;
  height: number;
  color: GPUTexture;
  depth: GPUTexture;
  readback: TextureReadbackRing;
  lastSubmission?: SubmissionSnapshot;
}

interface SubmissionSnapshot {
  readonly clear: readonly [number, number, number];
  readonly draws: readonly SubmissionDraw[];
  readonly uniforms: Float32Array;
}

interface SubmissionDraw {
  readonly geometry: Mesh;
  readonly geometryVersion: number | undefined;
  readonly material: Material<unknown>;
  readonly texture: Texture | undefined;
}

export interface WebGpuDraw {
  geometry: Mesh;
  material: Material<unknown>;
  /** Snapshot captured while scene traversal points at this exact object/instance. */
  uniforms: Float32Array;
  texture?: Texture;
}

export interface WebGpuFrameStats {
  readonly submitMs: number;
  readonly readbackMs: number;
  readonly draws: number;
  readonly triangles: number;
  readonly submissions: number;
}

export class WebGpuSceneRenderer {
  readonly #geometry = new WeakMap<Mesh, GeometryBuffers>();
  readonly #pipelines = new WeakMap<Material<unknown>, GPURenderPipeline>();
  readonly #textures = new WeakMap<Texture, GPUTexture>();
  readonly #ownedTextures = new Set<GPUTexture>();
  readonly #bindGroupLayout: GPUBindGroupLayout;
  readonly #pipelineLayout: GPUPipelineLayout;
  readonly #sampler: GPUSampler;
  readonly #fallbackTexture: GPUTexture;
  readonly #streams = new Map<object, RenderResources>();
  readonly #retired = new Set<Promise<void>>();
  #bindGroups = new WeakMap<GPUTexture, GPUBindGroup>();
  #uniformBuffer?: GPUBuffer;
  #uniformCapacity = 0;
  #lastSubmitMs = 0;
  #lastDraws = 0;
  #lastTriangles = 0;
  #lastReadbackMs = 0;
  #submissions = 0;

  constructor(
    readonly device: GPUDevice,
    private gpuRoot: GPU | undefined,
    private readonly onFrameReady: () => void,
  ) {
    this.#bindGroupLayout = device.createBindGroupLayout({
      label: 'arcade-webgpu-draw-layout',
      entries: [
        {
          binding: 0,
          visibility: VERTEX_STAGE | FRAGMENT_STAGE,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNIFORM_SLOT_BYTES },
        },
        { binding: 1, visibility: FRAGMENT_STAGE, texture: { sampleType: 'float' } },
        { binding: 2, visibility: FRAGMENT_STAGE, sampler: { type: 'filtering' } },
      ],
    });
    this.#pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.#bindGroupLayout] });
    this.#sampler = device.createSampler({
      label: 'arcade-webgpu-linear-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.#fallbackTexture = device.createTexture({
      label: 'arcade-webgpu-white-texture',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
    });
    device.queue.writeTexture({ texture: this.#fallbackTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  }

  supports(draws: readonly WebGpuDraw[]): boolean {
    return draws.every((draw) => draw.material.webgpu !== undefined);
  }

  render(target: RenderTarget, draws: readonly WebGpuDraw[], streamKey: object): boolean {
    const resources = this.#ensureResources(streamKey, target.width, target.height);
    if (!resources) return false;
    // The caller clears the CPU target to the background intended for the frame being
    // submitted. Preserve it before consuming the previous asynchronous readback: that copy
    // overwrites target.color, and using its top-left scene pixel as the next clear color makes
    // geometry that crossed the corner flood a later camera pose's entire background.
    const clearColor: readonly [number, number, number] = [
      target.color[0] ?? 0,
      target.color[1] ?? 0,
      target.color[2] ?? 0,
    ];
    const completed = resources.readback.takeLatest();
    if (completed) {
      this.#lastReadbackMs = completed.latencyMs;
      copyFrame(completed.pixels, target);
    }

    // A readback completion requests one render so the terminal can present that frame. If
    // traversal resolves to the exact state that produced it, do not turn that presentation
    // render into another submission/readback notification forever. Animated or otherwise
    // changed scenes still submit their next frame in the same call.
    const afterSubmit = this.#encodeAndSubmit(clearColor, resources, draws, completed !== null);
    afterSubmit?.();
    return completed !== null;
  }

  stats(): WebGpuFrameStats {
    return {
      submitMs: this.#lastSubmitMs,
      readbackMs: this.#lastReadbackMs,
      draws: this.#lastDraws,
      triangles: this.#lastTriangles,
      submissions: this.#submissions,
    };
  }

  invalidateFrames(): void {
    for (const resources of this.#streams.values()) {
      resources.readback.discardPending();
      resources.lastSubmission = undefined;
    }
  }

  resetFrames(): void {
    for (const resources of this.#streams.values()) {
      this.#retire(resources);
    }
    this.#streams.clear();
  }

  resetStream(streamKey: object): void {
    const resources = this.#streams.get(streamKey);
    if (!resources) return;
    this.#streams.delete(streamKey);
    this.#retire(resources);
  }

  async dispose(): Promise<void> {
    for (const resources of this.#streams.values()) {
      await resources.readback.dispose();
      resources.color.destroy();
      resources.depth.destroy();
    }
    this.#streams.clear();
    await Promise.all(this.#retired);
    this.#uniformBuffer?.destroy();
    this.#uniformBuffer = undefined;
    for (const texture of this.#ownedTextures) texture.destroy();
    this.#ownedTextures.clear();
    this.#fallbackTexture.destroy();
    this.device.destroy();
    this.gpuRoot = undefined;
  }

  #encodeAndSubmit(
    clear: readonly [number, number, number],
    resources: RenderResources,
    draws: readonly WebGpuDraw[],
    suppressUnchanged: boolean,
  ): (() => void) | null {
    if (suppressUnchanged && submissionMatches(resources.lastSubmission, clear, draws)) return null;
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
      const gpuTexture = draw.texture ? this.#texture(draw.texture) : this.#fallbackTexture;
      const bindGroup = this.#bindGroup(gpuTexture);
      pass.setBindGroup(0, bindGroup, [index * UNIFORM_SLOT_BYTES]);
      pass.setVertexBuffer(0, geometry.vertex);
      pass.setIndexBuffer(geometry.index, 'uint32');
      pass.drawIndexed(geometry.indexCount);
    }
    pass.end();
    const afterSubmit = resources.readback.capture(encoder, resources.color, this.onFrameReady);
    if (!afterSubmit) return null;
    this.device.queue.submit([encoder.finish()]);
    this.#submissions++;
    const submission: SubmissionSnapshot = {
      clear: [clear[0], clear[1], clear[2]],
      draws: draws.map((draw) => ({
        geometry: draw.geometry,
        geometryVersion: draw.geometry.version,
        material: draw.material,
        texture: draw.texture,
      })),
      uniforms: uniformData,
    };
    resources.lastSubmission = submission;
    this.#lastSubmitMs = performance.now() - started;
    this.#lastDraws = draws.length;
    this.#lastTriangles = triangles;
    return afterSubmit;
  }

  #ensureResources(streamKey: object, width: number, height: number): RenderResources | null {
    const current = this.#streams.get(streamKey);
    if (current && current.width === width && current.height === height) return current;
    if (current) {
      this.#streams.delete(streamKey);
      this.#retire(current);
    }
    // A resize can arrive faster than Dawn finishes mapping the previous frame. Refuse another
    // full-resolution allocation while any old ring is retiring; the CPU fallback paints this
    // frame and #retire requests a retry as soon as the staging buffers are actually released.
    if (this.#retired.size > 0) return null;
    const color = this.device.createTexture({
      label: 'arcade-webgpu-color',
      size: [width, height],
      format: COLOR_FORMAT,
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
      readback: new TextureReadbackRing(this.device, width, height, 8),
    };
    this.#streams.set(streamKey, resources);
    return resources;
  }

  #retire(resources: RenderResources): void {
    resources.color.destroy();
    resources.depth.destroy();
    let retirement!: Promise<void>;
    retirement = resources.readback.dispose().finally(() => {
      this.#retired.delete(retirement);
      this.onFrameReady();
    });
    this.#retired.add(retirement);
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
    this.#uniformCapacity = capacity;
    this.#bindGroups = new WeakMap();
  }

  #bindGroup(texture: GPUTexture): GPUBindGroup {
    const cached = this.#bindGroups.get(texture);
    if (cached) return cached;
    const bindGroup = this.device.createBindGroup({
      layout: this.#bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.#uniformBuffer!, size: UNIFORM_SLOT_BYTES } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: this.#sampler },
      ],
    });
    this.#bindGroups.set(texture, bindGroup);
    return bindGroup;
  }

  #texture(texture: Texture): GPUTexture {
    const cached = this.#textures.get(texture);
    if (cached) return cached;
    const gpuTexture = this.device.createTexture({
      label: 'arcade-webgpu-material-texture',
      size: [texture.width, texture.height],
      format: 'rgba8unorm',
      usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: gpuTexture },
      texture.data,
      { bytesPerRow: texture.width * 4, rowsPerImage: texture.height },
      [texture.width, texture.height],
    );
    this.#textures.set(texture, gpuTexture);
    this.#ownedTextures.add(gpuTexture);
    return gpuTexture;
  }

  #geometryBuffers(mesh: Mesh): GeometryBuffers {
    const cached = this.#geometry.get(mesh);
    if (cached && cached.version === mesh.version) return cached;
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
    if (cached && cached.vertexBytes >= vertices.byteLength && cached.indexBytes >= indices.byteLength) {
      if (vertices.byteLength) this.device.queue.writeBuffer(cached.vertex, 0, vertices);
      if (indices.byteLength) this.device.queue.writeBuffer(cached.index, 0, indices);
      cached.indexCount = indices.length;
      cached.version = mesh.version;
      return cached;
    }
    cached?.vertex.destroy();
    cached?.index.destroy();
    const vertexBytes = Math.max(4, vertices.byteLength);
    const indexBytes = Math.max(4, indices.byteLength);
    const vertex = this.device.createBuffer({
      label: 'arcade-webgpu-vertices',
      size: vertexBytes,
      usage: VERTEX | COPY_DST,
    });
    const index = this.device.createBuffer({
      label: 'arcade-webgpu-indices',
      size: indexBytes,
      usage: INDEX | COPY_DST,
    });
    if (vertices.byteLength) this.device.queue.writeBuffer(vertex, 0, vertices);
    if (indices.byteLength) this.device.queue.writeBuffer(index, 0, indices);
    const buffers = { vertex, index, indexCount: indices.length, vertexBytes, indexBytes, version: mesh.version };
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
      ? { color: { srcFactor: 'src-alpha' as const, dstFactor: 'one' as const }, alpha: { srcFactor: 'one' as const, dstFactor: 'one' as const } }
      : material.blend === 'alpha'
        ? {
            color: { srcFactor: 'src-alpha' as const, dstFactor: 'one-minus-src-alpha' as const },
            alpha: { srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const },
          }
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
        targets: [{ format: COLOR_FORMAT, blend }],
      },
      primitive: { topology: 'triangle-list', cullMode: material.cull === 'none' ? 'none' : material.cull ?? 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: material.blend === undefined || material.blend === 'opaque', depthCompare: 'less' },
    });
    this.#pipelines.set(material, pipeline);
    return pipeline;
  }
}

function submissionMatches(
  previous: SubmissionSnapshot | undefined,
  clear: readonly [number, number, number],
  draws: readonly WebGpuDraw[],
): boolean {
  if (!previous || previous.draws.length !== draws.length) return false;
  if (previous.clear[0] !== clear[0] || previous.clear[1] !== clear[1] || previous.clear[2] !== clear[2]) return false;
  for (let index = 0; index < draws.length; index++) {
    const draw = draws[index]!;
    const prior = previous.draws[index]!;
    if (
      prior.geometry !== draw.geometry ||
      prior.geometryVersion !== draw.geometry.version ||
      prior.material !== draw.material ||
      prior.texture !== draw.texture
    ) return false;
    const offset = index * UNIFORM_SLOT_FLOATS;
    for (let uniform = 0; uniform < UNIFORM_SLOT_FLOATS; uniform++) {
      if (previous.uniforms[offset + uniform] !== draw.uniforms[uniform]) return false;
    }
  }
  return true;
}

function copyFrame(pixels: Uint8Array, target: RenderTarget): void {
  const color = target.color;
  const depth = target.depth;
  const values = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let pixel = 0, rgba = 0, rgb = 0; pixel < depth.length; pixel++, rgba += 8, rgb += 3) {
    color[rgb] = halfToFloat(values.getUint16(rgba, true)) * 255;
    color[rgb + 1] = halfToFloat(values.getUint16(rgba + 2, true)) * 255;
    color[rgb + 2] = halfToFloat(values.getUint16(rgba + 4, true)) * 255;
    depth[pixel] = values.getUint16(rgba + 6, true) === 0 ? Infinity : 0;
  }
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) === 0 ? 1 : -1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
