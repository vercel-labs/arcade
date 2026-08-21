const MAP_READ = 0x0001;
const COPY_DST = 0x0008;
const MAP_MODE_READ = 0x0001;

interface Slot {
  readonly buffer: GPUBuffer;
  readonly pixels: Uint8Array;
  state: 'free' | 'mapping' | 'ready';
  mapping?: Promise<void>;
  sequence: number;
  submittedAt: number;
  completedAt: number;
}

export interface ReadbackFrame {
  readonly pixels: Uint8Array;
  readonly latencyMs: number;
}

/** Reusable staging buffers overlap GPU frame N+1 with mapping frame N. */
export class TextureReadbackRing {
  readonly #bytesPerRow: number;
  readonly #slots: Slot[];
  #sequence = 0;

  constructor(
    private readonly device: GPUDevice,
    readonly width: number,
    readonly height: number,
    depth = 2,
  ) {
    this.#bytesPerRow = align(width * 4, 256);
    this.#slots = Array.from({ length: depth }, (_, index) => ({
      buffer: device.createBuffer({
        label: `arcade-webgpu-readback-${index}`,
        size: this.#bytesPerRow * height,
        usage: MAP_READ | COPY_DST,
      }),
      pixels: new Uint8Array(width * height * 4),
      state: 'free',
      sequence: 0,
      submittedAt: 0,
      completedAt: 0,
    }));
  }

  capture(encoder: GPUCommandEncoder, texture: GPUTexture, onReady: () => void): (() => void) | null {
    const slot = this.#slots.find((candidate) => candidate.state === 'free');
    if (!slot) return null;
    slot.state = 'mapping';
    slot.sequence = ++this.#sequence;
    slot.submittedAt = performance.now();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: slot.buffer, bytesPerRow: this.#bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height },
    );
    return () => {
      slot.mapping = this.#map(slot)
        .then(() => {
          slot.completedAt = performance.now();
          slot.state = 'ready';
          onReady();
        })
        .catch(() => {
          slot.state = 'free';
        });
    };
  }

  takeLatest(): ReadbackFrame | null {
    let latest: Slot | undefined;
    for (const slot of this.#slots) {
      if (slot.state === 'ready' && (!latest || slot.sequence > latest.sequence)) latest = slot;
    }
    if (!latest) return null;
    for (const slot of this.#slots) {
      if (slot.state === 'ready' && slot !== latest) slot.state = 'free';
    }
    const frame = { pixels: latest.pixels, latencyMs: latest.completedAt - latest.submittedAt };
    latest.state = 'free';
    return frame;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.#slots.map((slot) => slot.mapping));
    for (const slot of this.#slots) slot.buffer.destroy();
  }

  async #map(slot: Slot): Promise<void> {
    await slot.buffer.mapAsync(MAP_MODE_READ);
    try {
      const padded = new Uint8Array(slot.buffer.getMappedRange());
      const tightRow = this.width * 4;
      for (let y = 0; y < this.height; y++) {
        slot.pixels.set(padded.subarray(y * this.#bytesPerRow, y * this.#bytesPerRow + tightRow), y * tightRow);
      }
    } finally {
      slot.buffer.unmap();
    }
  }
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
