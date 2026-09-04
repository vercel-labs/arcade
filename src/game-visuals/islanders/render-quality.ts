import type { RenderTarget } from '../../engine/framebuffer.ts';

export const ISLANDERS_WATER_BUILD_LAYER_SCALE = 2 / 3;
export const ISLANDERS_WATER_SETTLED_LAYER_SCALE = 1 / 2;
export const ISLANDERS_WATER_SETTLED_LARGE_LAYER_SCALE = 1 / 3;
export const ISLANDERS_WATER_SETTLED_LARGE_TARGET_PIXELS = 4_000_000;
export const ISLANDERS_SETTLED_WATER_COLOR_STEP = 8;
export const ISLANDERS_WATER_LAYER_MIN_WIDTH = 180;
export const ISLANDERS_WATER_LAYER_MIN_HEIGHT = 120;

export function islandersWaterLayerScale(width: number, height: number, placing: boolean): number | null {
  if (width < ISLANDERS_WATER_LAYER_MIN_WIDTH || height < ISLANDERS_WATER_LAYER_MIN_HEIGHT) return null;
  if (placing) return ISLANDERS_WATER_BUILD_LAYER_SCALE;
  return width * height > ISLANDERS_WATER_SETTLED_LARGE_TARGET_PIXELS
    ? ISLANDERS_WATER_SETTLED_LARGE_LAYER_SCALE
    : ISLANDERS_WATER_SETTLED_LAYER_SCALE;
}

export function blitIslandersWater(source: RenderTarget, target: RenderTarget, colorStep = 1): void {
  includeScaledDepthBounds(source, target);
  const integerScale = target.width / source.width;
  if (integerScale >= 2 && Number.isInteger(integerScale) && target.height === source.height * integerScale) {
    for (let sy = 0; sy < source.height; sy++) {
      const sourceRow = sy * source.width;
      const targetRow = sy * integerScale * target.width;
      for (let sx = 0; sx < source.width; sx++) {
        const sourcePixel = sourceRow + sx;
        const depth = source.depth[sourcePixel];
        if (!Number.isFinite(depth)) continue;
        const sourceColor = sourcePixel * 3;
        const r = quantize(source.color[sourceColor], colorStep);
        const g = quantize(source.color[sourceColor + 1], colorStep);
        const b = quantize(source.color[sourceColor + 2], colorStep);
        const left = sx * integerScale;
        for (let dy = 0; dy < integerScale; dy++) {
          let targetPixel = targetRow + dy * target.width + left;
          for (let dx = 0; dx < integerScale; dx++, targetPixel++) {
            const targetColor = targetPixel * 3;
            target.color[targetColor] = r;
            target.color[targetColor + 1] = g;
            target.color[targetColor + 2] = b;
            target.depth[targetPixel] = depth;
          }
        }
      }
    }
    return;
  }
  const xScale = source.width / target.width;
  const yScale = source.height / target.height;
  for (let y = 0; y < target.height; y++) {
    const sourceRow = Math.min(source.height - 1, Math.floor(y * yScale)) * source.width;
    const targetRow = y * target.width;
    for (let x = 0; x < target.width; x++) {
      const sourcePixel = sourceRow + Math.min(source.width - 1, Math.floor(x * xScale));
      const depth = source.depth[sourcePixel];
      if (!Number.isFinite(depth)) continue;
      const targetPixel = targetRow + x;
      const sourceColor = sourcePixel * 3;
      const targetColor = targetPixel * 3;
      target.color[targetColor] = quantize(source.color[sourceColor], colorStep);
      target.color[targetColor + 1] = quantize(source.color[sourceColor + 1], colorStep);
      target.color[targetColor + 2] = quantize(source.color[sourceColor + 2], colorStep);
      target.depth[targetPixel] = depth;
    }
  }
}

function quantize(value: number, step: number): number {
  return step > 1 ? Math.round(value / step) * step : value;
}

function includeScaledDepthBounds(source: RenderTarget, target: RenderTarget): void {
  if (source.maxDepthX < 0) return;
  const xScale = target.width / source.width;
  const yScale = target.height / source.height;
  const minX = Math.floor(source.minDepthX * xScale);
  const minY = Math.floor(source.minDepthY * yScale);
  const maxX = Math.min(target.width - 1, Math.ceil((source.maxDepthX + 1) * xScale) - 1);
  const maxY = Math.min(target.height - 1, Math.ceil((source.maxDepthY + 1) * yScale) - 1);
  if (minX < target.minDepthX) target.minDepthX = minX;
  if (minY < target.minDepthY) target.minDepthY = minY;
  if (maxX > target.maxDepthX) target.maxDepthX = maxX;
  if (maxY > target.maxDepthY) target.maxDepthY = maxY;
}
