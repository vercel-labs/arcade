// The Catan mesh library: everything the scene needs to draw a board, a tile, the pieces, the
// dice and a harbour ship. Presentation code imports from this barrel only; inside the library
// modules import each other directly.
//
// Layout, in dependency order — each tier only reaches downward:
//   build            mesh buffer + face emitters + vector/colour helpers
//   base             the shared thin hexagon slab and its ground surface
//   props, nature    solids (boxes, rocks, logs) and natural props (pines, sheep, brick)
//   tiles/           one module per terrain; tiles/fields/ holds the wheat system
//   pieces, dice     player pieces, the board overlay, the rollable die
//   port/            the harbour ship: form data, hull + rig, deck cargo
export type { RGB } from './build.ts';
export { tileBackMesh } from './base.ts';
export { BEACH_DRY_WIDTH, BEACH_OUTER_WIDTH, coastMesh, shoreWaveField, surfMesh, swashMesh } from './coast.ts';
export type { ShoreWaveField } from './coast.ts';
export { dieMesh } from './dice.ts';
export { boardOverlayMesh, type BuildingSpec, type EdgeRoadSpec, hoverColorFor, type OverlaySpec, piecesMesh } from './pieces.ts';
export { PORT_SAIL_CENTER } from './port/hull.ts';
export { portMesh } from './port/index.ts';
export { harborPiersMesh } from './port/piers.ts';
export type { PortKind } from './port/spec.ts';
export { animatedTileMesh, tileMesh } from './tiles/index.ts';
