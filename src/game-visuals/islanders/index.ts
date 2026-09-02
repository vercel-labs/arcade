/** Browser-safe procedural Islanders visuals shared by Arcade and web embeds. */
export { tileBackMesh } from './base.ts';
export { dieMesh } from './dice.ts';
export { drawIslandersDiceOverlay, type IslandersDiceOverlayOptions } from './dice-overlay.ts';
export * from './dice-choreography.ts';
export { BOARD_BUILDING_RADIUS, BOARD_CITY_HEIGHT, BOARD_ROAD_HALF_WIDTH, BOARD_ROAD_LENGTH_SCALE, BOARD_SETTLEMENT_HEIGHT, boardOverlayMesh, hoverColorFor, piecesMesh, type BuildingSpec, type EdgeRoadSpec, type OverlaySpec } from './pieces.ts';
export { portMesh } from './port/index.ts';
export { harborPiersMesh } from './port/piers.ts';
export { BEACH_DRY_WIDTH, BEACH_OUTER_WIDTH, coastMesh, shoreWaveField, surfMesh, swashMesh, type ShoreWaveField } from './coast.ts';
export { BOARD_HARBOR_DISTANCE, BOARD_HARBOR_SCALE, BOARD_HARBOR_Y, boardHarborPoses, islandersWaterMesh, EDGE_ENDS, hexWorld, NODE_XZ, PRODUCTION_HARBOR_EDGES, type BoardHarborPose, type HarborConnector } from './board.ts';
export type { PortKind } from './port/spec.ts';
export type { RGB } from './build.ts';
export {
  AnimatedTileMeshCache,
  animatedTileMesh,
  robberMarkerMesh,
  tileMesh,
} from './tiles/index.ts';
export type { WindOrigin } from './tiles/wind.ts';
