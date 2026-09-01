/** Browser-safe procedural Catan visuals shared by Arcade and web embeds. */
export { tileBackMesh } from './base.ts';
export { dieMesh } from './dice.ts';
export { drawCatanDiceOverlay, type CatanDiceOverlayOptions } from './dice-overlay.ts';
export * from './dice-choreography.ts';
export { BOARD_BUILDING_RADIUS, BOARD_CITY_HEIGHT, BOARD_ROAD_HALF_WIDTH, BOARD_ROAD_LENGTH_SCALE, BOARD_SETTLEMENT_HEIGHT, boardOverlayMesh, hoverColorFor, piecesMesh, type BuildingSpec, type EdgeRoadSpec, type OverlaySpec } from './pieces.ts';
export { portMesh } from './port/index.ts';
export { boardHarborPoses, catanWaterMesh, EDGE_ENDS, hexWorld, NODE_XZ, PRODUCTION_HARBOR_EDGES, type BrowserHarborPose } from './board.ts';
export type { PortKind } from './port/spec.ts';
export type { RGB } from './build.ts';
export {
  AnimatedTileMeshCache,
  animatedTileMesh,
  robberMarkerMesh,
  tileMesh,
} from './tiles/index.ts';
export type { WindOrigin } from './tiles/wind.ts';
