export const visibleViewportHeight = (visualViewportHeight: number | undefined, layoutViewportHeight: number) => (
  Number.isFinite(visualViewportHeight) && (visualViewportHeight ?? 0) > 0
    ? visualViewportHeight as number
    : layoutViewportHeight
);
