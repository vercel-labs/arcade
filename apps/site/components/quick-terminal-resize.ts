export type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface ResizeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function resizeTerminalRect(
  origin: ResizeRect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
  minWidth: number,
  minHeight: number,
  margin = 8,
): ResizeRect {
  const originalRight = origin.left + origin.width;
  const originalBottom = origin.top + origin.height;
  let left = origin.left;
  let top = origin.top;
  let right = originalRight;
  let bottom = originalBottom;

  if (direction.includes('e')) right = Math.min(viewportWidth - margin, Math.max(origin.left + minWidth, originalRight + dx));
  if (direction.includes('s')) bottom = Math.min(viewportHeight - margin, Math.max(origin.top + minHeight, originalBottom + dy));
  if (direction.includes('w')) left = Math.max(margin, Math.min(originalRight - minWidth, origin.left + dx));
  if (direction.includes('n')) top = Math.max(margin, Math.min(originalBottom - minHeight, origin.top + dy));

  return { left, top, width: right - left, height: bottom - top };
}
