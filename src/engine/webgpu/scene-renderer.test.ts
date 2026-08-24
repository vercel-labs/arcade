import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../framebuffer.ts';
import type { Material } from '../shader.ts';
import { WebGpuSceneRenderer, type WebGpuDraw } from './scene-renderer.ts';

test('presenting an unchanged completed frame does not submit another GPU frame', async () => {
  const gpu = fakeGpuDevice();
  const renderer = new WebGpuSceneRenderer(gpu.device, undefined, () => {});
  const target = new RenderTarget(2, 2);
  target.clear(6, 10, 8);
  const stream = {};
  const draws = triangleDraws();

  assert.equal(renderer.render(target, draws, stream), false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(renderer.render(target, draws, stream), true);
  assert.equal(gpu.submissions(), 1);

  await renderer.dispose();
});

test('presenting a completed frame still submits changed scene uniforms', async () => {
  const gpu = fakeGpuDevice();
  const renderer = new WebGpuSceneRenderer(gpu.device, undefined, () => {});
  const target = new RenderTarget(2, 2);
  target.clear(6, 10, 8);
  const draws = triangleDraws();
  const stream = {};
  renderer.render(target, draws, stream);
  await new Promise<void>((resolve) => setImmediate(resolve));
  draws[0]!.uniforms[0] = 1;
  assert.equal(renderer.render(target, draws, stream), true);
  assert.equal(gpu.submissions(), 2);

  await renderer.dispose();
});

test('invalidating frames drops an in-flight image without reallocating the stream', async () => {
  const gpu = fakeGpuDevice();
  const renderer = new WebGpuSceneRenderer(gpu.device, undefined, () => {});
  const target = new RenderTarget(2, 2);
  target.clear(6, 10, 8);
  const draws = triangleDraws();
  const stream = {};

  assert.equal(renderer.render(target, draws, stream), false);
  const buffersBeforeInvalidation = gpu.createdBuffers();
  renderer.invalidateFrames();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(renderer.render(target, draws, stream), false);
  assert.equal(gpu.submissions(), 2);
  assert.equal(gpu.createdBuffers(), buffersBeforeInvalidation);

  await renderer.dispose();
});

test('rapid target resizes do not allocate another readback ring before retirement', async () => {
  const gpu = fakeGpuDevice({ deferMapping: true });
  const renderer = new WebGpuSceneRenderer(gpu.device, undefined, () => {});
  const draws = triangleDraws();
  const stream = {};

  assert.equal(renderer.render(clearedTarget(2, 2), draws, stream), false);
  const buffersDuringFirstFrame = gpu.createdBuffers();
  assert.equal(renderer.render(clearedTarget(3, 3), draws, stream), false);
  assert.equal(renderer.render(clearedTarget(4, 4), draws, stream), false);
  assert.equal(gpu.createdBuffers(), buffersDuringFirstFrame);

  gpu.resolveMappings();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(renderer.render(clearedTarget(4, 4), draws, stream), false);
  assert.equal(gpu.createdBuffers(), buffersDuringFirstFrame);

  gpu.resolveMappings();
  await renderer.dispose();
});

const material: Material<unknown> = {
  vertex: () => { throw new Error('CPU vertex shader should not run'); },
  fragment: () => null,
  webgpu: {
    wgsl: '',
    writeUniforms: () => {},
  },
};

function triangleDraws(): WebGpuDraw[] {
  return [{
    geometry: {
      vertices: [vertex(-1, -1), vertex(1, -1), vertex(0, 1)],
      indices: [0, 1, 2],
    },
    material,
    uniforms: new Float32Array(64),
  }];
}

function clearedTarget(width: number, height: number): RenderTarget {
  const target = new RenderTarget(width, height);
  target.clear(6, 10, 8);
  return target;
}

function vertex(x: number, y: number) {
  return {
    position: { x, y, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    uv: [0, 0] as [number, number],
    color: { x: 255, y: 255, z: 255 },
  };
}

function fakeGpuDevice(options: { deferMapping?: boolean } = {}): {
  device: GPUDevice;
  submissions(): number;
  createdBuffers(): number;
  resolveMappings(): void;
} {
  let submitCount = 0;
  const buffers = new Set<FakeBuffer>();
  const mappingResolvers = new Set<() => void>();
  const queue = {
    writeTexture() {},
    writeBuffer() {},
    submit() { submitCount++; },
  };
  const device = {
    queue,
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createSampler: () => ({}),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createBuffer({ size }: { size: number }) {
      const buffer = new FakeBuffer(
        size,
        () => buffers.delete(buffer),
        options.deferMapping ? mappingResolvers : undefined,
      );
      buffers.add(buffer);
      return buffer;
    },
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline() {},
        setBindGroup() {},
        setVertexBuffer() {},
        setIndexBuffer() {},
        drawIndexed() {},
        end() {},
      }),
      copyTextureToBuffer() {},
      finish: () => ({}),
    }),
    destroy() {
      for (const buffer of buffers) buffer.destroy();
    },
  } as unknown as GPUDevice;
  return {
    device,
    submissions: () => submitCount,
    createdBuffers: () => buffers.size,
    resolveMappings: () => {
      for (const resolve of mappingResolvers) resolve();
      mappingResolvers.clear();
    },
  };
}

class FakeBuffer {
  readonly bytes: ArrayBuffer;

  constructor(
    size: number,
    private readonly onDestroy: () => void,
    private readonly mappingResolvers?: Set<() => void>,
  ) {
    this.bytes = new ArrayBuffer(size);
  }

  async mapAsync(): Promise<void> {
    if (!this.mappingResolvers) return;
    await new Promise<void>((resolve) => this.mappingResolvers!.add(resolve));
  }
  getMappedRange(): ArrayBuffer { return this.bytes; }
  unmap(): void {}
  destroy(): void { this.onDestroy(); }
}
