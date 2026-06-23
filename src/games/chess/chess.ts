import { type Game, type GameState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { Board } from './board.ts';
import { generateLegalMoves, isInCheck } from './movegen.ts';
import { moveToSan, moveToUci } from './san.ts';
import {
  BISHOP,
  type Move,
  KNIGHT,
  PAWN,
  pieceColor,
  PIECE_CHARS,
  pieceType,
  QUEEN,
  ROOK,
  square,
  squareColor,
  WHITE,
} from './types.ts';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// A chess position as a harness GameState. Players: 0 = White, 1 = Black.
// Utilities are +1 win / -1 loss / 0 draw.
export class ChessState implements GameState<Move> {
  readonly board: Board;
  private history: string[]; // repetition keys, including the current position
  private cachedLegal: Move[] | null = null;

  constructor(fen: string = START_FEN) {
    this.board = Board.fromFEN(fen);
    this.history = [this.board.key()];
  }

  currentPlayer(): number {
    return this.isTerminal() ? TERMINAL : this.board.turn;
  }

  legalActions(): Move[] {
    if (!this.cachedLegal) this.cachedLegal = generateLegalMoves(this.board);
    return this.cachedLegal;
  }

  applyAction(m: Move): void {
    this.board.applyMove(m);
    this.history.push(this.board.key());
    this.cachedLegal = null;
  }

  clone(): ChessState {
    const s = Object.create(ChessState.prototype) as ChessState;
    (s as { board: Board }).board = this.board.clone();
    s.history = this.history.slice();
    s.cachedLegal = null;
    return s;
  }

  isTerminal(): boolean {
    return this.outcome() !== null;
  }

  returns(): number[] {
    return this.outcome() ?? [0, 0];
  }

  fen(): string {
    return this.board.toFEN();
  }

  actionToString(m: Move): string {
    return moveToSan(this.board, m, this.legalActions());
  }

  // Lenient parse: accepts UCI ("e2e4", "e7e8q") or SAN ("Nf3", "exd5", "O-O"),
  // matched against the legal move list (Game Arena's "soft parse" approach).
  actionFromString(s: string): Move | null {
    const uci = s.trim().toLowerCase();
    const san = s.trim().replace(/[+#!?]/g, '');
    const sanO = san.replace(/0/g, 'O'); // tolerate "0-0" for castling
    const legal = this.legalActions();
    for (const m of legal) {
      if (moveToUci(m) === uci) return m;
      const ms = moveToSan(this.board, m, legal).replace(/[+#!?]/g, '');
      if (ms === san || ms === sanO) return m;
    }
    return null;
  }

  toString(): string {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      out += rank + 1 + ' ';
      for (let file = 0; file < 8; file++) {
        const p = this.board.squares[square(file, rank)];
        if (!p) out += '. ';
        else {
          const ch = PIECE_CHARS[pieceType(p)];
          out += (pieceColor(p) === WHITE ? ch.toUpperCase() : ch) + ' ';
        }
      }
      out += '\n';
    }
    out += '  a b c d e f g h';
    return out;
  }

  // null = game ongoing; otherwise the per-player utility vector.
  private outcome(): number[] | null {
    if (this.legalActions().length === 0) {
      if (isInCheck(this.board)) return this.board.turn === WHITE ? [-1, 1] : [1, -1]; // checkmate
      return [0, 0]; // stalemate
    }
    if (this.board.halfmove >= 100) return [0, 0]; // 50-move rule
    if (this.isThreefold()) return [0, 0];
    if (this.insufficientMaterial()) return [0, 0];
    return null;
  }

  private isThreefold(): boolean {
    const k = this.board.key();
    let count = 0;
    for (const h of this.history) if (h === k) count++;
    return count >= 3;
  }

  // K vs K, K+minor vs K, and K+B vs K+B with both bishops on same-colored squares.
  private insufficientMaterial(): boolean {
    let knights = 0;
    const bishopColors: number[] = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const t = pieceType(this.board.squares[sq]);
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      if (t === KNIGHT) knights++;
      else if (t === BISHOP) bishopColors.push(squareColor(sq));
    }
    const minors = knights + bishopColors.length;
    if (minors <= 1) return true;
    if (knights === 0 && bishopColors.length === 2 && bishopColors[0] === bishopColors[1]) return true;
    return false;
  }
}

export const chessGame: Game<ChessState, Move> = {
  type: { shortName: 'chess', longName: 'Chess', numPlayers: 2 },
  newInitialState: () => new ChessState(),
};

registerGame('chess', () => chessGame as unknown as Game<GameState<unknown>, unknown>);
