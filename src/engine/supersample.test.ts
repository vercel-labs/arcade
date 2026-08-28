import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from './framebuffer.ts';
import { downsample } from './supersample.ts';

test('downsample preserves nearest finite depth for foreground coverage', () => {
  const source = new RenderTarget(4, 2);
  source.clear();
  source.depth[1] = 0.4;
  source.depth[2] = 0.2;

  const result = downsample(source, 2);

  assert.ok(Math.abs(result.depth[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(result.depth[1] - 0.2) < 1e-6);
});

test('downsample gamma lookup matches the exact transfer curve', () => {
  const source = new RenderTarget(6, 2);
  const samples = [
    0, 0.125, 1.75, 8.5, 31.25, 63.875,
    95.5, 127.125, 159.75, 191.5, 223.875, 255,
  ];
  for (let pixel = 0; pixel < source.depth.length; pixel++) {
    source.depth[pixel] = pixel / 10;
    const color = pixel * 3;
    source.color[color] = samples[pixel];
    source.color[color + 1] = samples[(pixel * 5 + 3) % samples.length];
    source.color[color + 2] = samples[(pixel * 7 + 1) % samples.length];
  }

  const result = downsample(source, 2);
  const gamma = 2.2;
  const exactChannel = (channel: number, outputX: number): number => {
    let linear = 0;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const sourcePixel = y * source.width + outputX * 2 + x;
        linear += Math.pow(source.color[sourcePixel * 3 + channel] / 255, gamma);
      }
    }
    return Math.pow(linear / 4, 1 / gamma) * 255;
  };

  for (let x = 0; x < result.width; x++) {
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(result.color[x * 3 + channel] - exactChannel(channel, x)) < 1e-5);
    }
  }
});
