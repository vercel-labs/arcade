import type { ChipColumn } from './chips.ts';
import { chipPileHalfExtent } from './chips.ts';
import { CARD_H, CARD_W } from './card-render.ts';
import { TABLE_RADIUS } from './table.ts';

export const POKER_HOLE_RADIUS = TABLE_RADIUS * 0.72;
export const POKER_HOLE_GAP = 0.62 * CARD_W;
const CHIP_SIDE = 1.58;
const CHIP_EDGE_NUDGE = 0.12;
const CARD_TANGENT_EDGE = POKER_HOLE_GAP + CARD_W / 2;
const CHIP_CARD_GAP = 0.11;
const FELT_USABLE_RADIUS = TABLE_RADIUS - 0.42;
export const POKER_DECK_POSITION = { x: 0, z: -1.4 } as const;
export const POKER_DECK_FULL = 34;
export const POKER_DECK_THICKNESS = 0.02;
export const POKER_CARD_LIFT = 0.08;
export const POKER_DEAL_HOP = 0.85;
export const POKER_BOARD_Z = 0.5;
export const POKER_BOARD_SPACING = CARD_W * 1.12;
export const POKER_BET_RADIUS = 2.4;
export const POKER_BET_CARD_GAP = 0.18;

export function pokerSeatAngle(seat: number, seatCount: number): number {
  return (seat / seatCount) * Math.PI * 2;
}

export function pokerSeatPosition(seat: number, seatCount: number, radius: number): { x: number; z: number } {
  const angle = pokerSeatAngle(seat, seatCount);
  return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
}

export function pokerHoleCardPose(seat: number, round: number, seatCount: number): { x: number; z: number; yaw: number } {
  const yaw = pokerSeatAngle(seat, seatCount);
  const center = pokerSeatPosition(seat, seatCount, POKER_HOLE_RADIUS);
  const offset = round === 0 ? -POKER_HOLE_GAP : POKER_HOLE_GAP;
  return { x: center.x + Math.cos(yaw) * offset, z: center.z - Math.sin(yaw) * offset, yaw };
}

/** Exact carried-stack clearance used by the production Poker table. */
export function pokerStackCenter(seat: number, seatCount: number, columns: ChipColumn[]): { x: number; z: number } {
  const yaw = pokerSeatAngle(seat, seatCount);
  const extent = chipPileHalfExtent(columns, seat);
  const offset = Math.max(CHIP_SIDE, CARD_TANGENT_EDGE + CHIP_CARD_GAP + extent.perp);
  const tangentReach = offset + extent.perp;
  const maxRadius = Math.sqrt(Math.max(0, FELT_USABLE_RADIUS ** 2 - tangentReach ** 2)) - extent.axis;
  const radius = Math.max(0, Math.min(POKER_HOLE_RADIUS + CHIP_EDGE_NUDGE, maxRadius));
  const center = pokerSeatPosition(seat, seatCount, radius);
  return { x: center.x + Math.cos(yaw) * offset, z: center.z - Math.sin(yaw) * offset };
}

/** Fixed five-slot row: flop uses slots 0–2 and turn/river extend rightward. */
export function pokerBoardCardPose(index: number): { x: number; z: number } {
  return { x: (index - 2) * POKER_BOARD_SPACING, z: POKER_BOARD_Z };
}

/** Production bet placement, including community-row collision avoidance. */
export function pokerBetCenter(seat: number, seatCount: number, columns: ChipColumn[], seed: number, boardShown: number): { x: number; z: number } {
  const angle = pokerSeatAngle(seat, seatCount);
  const axis = { x: Math.cos(angle), z: -Math.sin(angle) };
  const perp = { x: Math.sin(angle), z: Math.cos(angle) };
  const extent = chipPileHalfExtent(columns, seed);
  const halfX = Math.abs(axis.x) * extent.axis + Math.abs(perp.x) * extent.perp;
  const halfZ = Math.abs(axis.z) * extent.axis + Math.abs(perp.z) * extent.perp;
  const center = pokerSeatPosition(seat, seatCount, POKER_BET_RADIUS);
  if (boardShown <= 0) return center;
  const boardMinX = pokerBoardCardPose(0).x - CARD_W / 2;
  const boardMaxX = pokerBoardCardPose(boardShown - 1).x + CARD_W / 2;
  const boardMinZ = POKER_BOARD_Z - CARD_H / 2;
  const boardMaxZ = POKER_BOARD_Z + CARD_H / 2;
  const overlaps = center.x + halfX + POKER_BET_CARD_GAP > boardMinX && center.x - halfX - POKER_BET_CARD_GAP < boardMaxX && center.z + halfZ + POKER_BET_CARD_GAP > boardMinZ && center.z - halfZ - POKER_BET_CARD_GAP < boardMaxZ;
  if (overlaps) center.z = boardMaxZ + halfZ + POKER_BET_CARD_GAP;
  return center;
}
