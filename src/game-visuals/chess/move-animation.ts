import { travelPoint, type Vec3 } from '../../engine/index.ts';
import { BLACK, FLAG_CAPTURE, FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_EP, KING, KNIGHT, pieceColor, pieceType, ROOK, square, WHITE, type Color, type Move, type PieceType } from '../../rules/chess/types.ts';

export const CHESS_MOVE_ARC_HEIGHT = 0.5;
export type ChessMoveMotion = 'slide' | 'arc';
export interface ChessMoveSegment { type: PieceType; color: Color; from: Vec3; to: Vec3; motion: ChessMoveMotion; hideSq: number }
export interface ChessMovePlan { segments: ChessMoveSegment[]; captured?: { type: PieceType; color: Color; captor: Color } }
export interface ChessMoveLayout { square: number; flipped?: boolean; whiteJailCount: number; blackJailCount: number }

export function chessSquarePosition(sq: number, squareSize: number, flipped = false): Vec3 {
  const x = ((sq & 7) - 3.5) * squareSize;
  const z = (3.5 - (sq >> 4)) * squareSize;
  return flipped ? { x: -x, y: 0, z: -z } : { x, y: 0, z };
}

export function chessJailPosition(captor: Color, index: number, squareSize: number, flipped = false): Vec3 {
  const edge = 4 * squareSize;
  const column = Math.floor(index / 8);
  const row = index % 8;
  const x = edge + 0.9 * squareSize + column * 0.9 * squareSize;
  const z = edge - 0.45 * squareSize - row * 0.9 * squareSize;
  const slot = captor === WHITE ? { x, y: 0, z } : { x: -x, y: 0, z: -z };
  return flipped ? { x: -slot.x, y: 0, z: -slot.z } : slot;
}

/** Exact production segment plan for captures, en passant, knight hops, and castling. */
export function planChessMove(move: Move, layout: ChessMoveLayout): ChessMovePlan {
  const color = pieceColor(move.piece);
  const segments: ChessMoveSegment[] = [];
  let captured: ChessMovePlan['captured'];
  if (move.flags & (FLAG_CAPTURE | FLAG_EP)) {
    const capturedSq = move.flags & FLAG_EP ? move.to + (color === WHITE ? -16 : 16) : move.to;
    const capturedColor = pieceColor(move.captured);
    const jailCount = color === WHITE ? layout.whiteJailCount : layout.blackJailCount;
    segments.push({ type: pieceType(move.captured) as PieceType, color: capturedColor, from: chessSquarePosition(capturedSq, layout.square, layout.flipped), to: chessJailPosition(color, jailCount, layout.square, layout.flipped), motion: 'arc', hideSq: capturedSq });
    captured = { type: pieceType(move.captured) as PieceType, color: capturedColor, captor: color };
  }
  segments.push({ type: pieceType(move.piece) as PieceType, color, from: chessSquarePosition(move.from, layout.square, layout.flipped), to: chessSquarePosition(move.to, layout.square, layout.flipped), motion: pieceType(move.piece) === KNIGHT ? 'arc' : 'slide', hideSq: move.from });
  const addRook = (fromFile: number, toFile: number) => {
    const rank = color === WHITE ? 0 : 7;
    segments.push({ type: ROOK, color, from: chessSquarePosition(square(fromFile, rank), layout.square, layout.flipped), to: chessSquarePosition(square(toFile, rank), layout.square, layout.flipped), motion: 'slide', hideSq: square(fromFile, rank) });
  };
  if (move.flags & FLAG_CASTLE_K) addRook(7, 5);
  if (move.flags & FLAG_CASTLE_Q) addRook(0, 3);
  return { segments, captured };
}

export function chessMovePosition(segment: ChessMoveSegment, progress: number): Vec3 {
  return travelPoint(segment.from, segment.to, progress, segment.motion === 'arc' ? CHESS_MOVE_ARC_HEIGHT : 0);
}

export function movingKingPosition(plan: ChessMovePlan | null, color: Color, progress: number): Vec3 | null {
  const segment = plan?.segments.find((candidate) => candidate.type === KING && candidate.color === color);
  return segment ? chessMovePosition(segment, progress) : null;
}
