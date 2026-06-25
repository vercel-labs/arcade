import { type Game, type GameState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { Board } from './board.ts';
import { generateLegalMoves, isInCheck } from './movegen.ts';
import { looseKey, moveToSan, moveToUci } from './san.ts';
import {
  BISHOP,
  BLACK,
  type Color,
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

// How a finished game ended (for a result/game-over display).
export type ChessReason = 'checkmate' | 'stalemate' | 'fifty-move' | 'repetition' | 'insufficient-material';
export interface ChessResult {
  winner: Color | null; // null = draw
  reason: ChessReason;
}

// A chess position as a harness GameState. Players: 0 = White, 1 = Black.
// Utilities are +1 win / -1 loss / 0 draw.
export class ChessState implements GameState<Move> {
  readonly board: Board;
  private history: string[]; // repetition keys, including the current position
  private sanHistory: string[] = []; // SAN of each played move, for the PGN move history
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
    this.sanHistory.push(this.actionToString(m)); // SAN needs the pre-move board + legal list
    this.board.applyMove(m);
    this.history.push(this.board.key());
    this.cachedLegal = null;
  }

  clone(): ChessState {
    const s = Object.create(ChessState.prototype) as ChessState;
    (s as { board: Board }).board = this.board.clone();
    s.history = this.history.slice();
    s.sanHistory = this.sanHistory.slice();
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

  // Numbered PGN movetext of the moves played so far, in SAN — e.g.
  // "1. e4 e5 2. Nf3 Nc6". Empty at the start position. Matches the move-history
  // format Game Arena feeds its chess players, so an AI sees the game's narrative
  // (plans, repetitions) rather than a stateless snapshot of the current position.
  moveHistory(): string {
    const out: string[] = [];
    for (let i = 0; i < this.sanHistory.length; i++) {
      if (i % 2 === 0) out.push(`${i / 2 + 1}.`); // move number before each White ply
      out.push(this.sanHistory[i]);
    }
    return out.join(' ');
  }

  actionToString(m: Move): string {
    return moveToSan(this.board, m, this.legalActions());
  }

  // Lenient parse: accepts UCI ("e2e4", "e7e8q") or SAN ("Nf3", "exd5", "O-O"),
  // matched against the legal move list (Game Arena's "soft parse" approach).
  // First an exact match against canonical notation; failing that, a soft match
  // that forgives the common ways models mangle SAN — a dropped capture "x", a
  // missing promotion "=", wrong case, "0-0" for castling — but only when it
  // resolves to a UNIQUE legal move. Genuinely ambiguous under-specified input
  // (e.g. "Nd7" when two knights reach d7) returns null so the caller re-prompts.
  actionFromString(s: string): Move | null {
    const cleaned = s.trim().replace(/^\d+\.+\s*/, ''); // drop a leading move number ("1." / "2...")
    const uci = cleaned.toLowerCase();
    const san = cleaned.replace(/[+#!?]/g, '');
    const sanO = san.replace(/0/g, 'O'); // tolerate "0-0" for castling
    const want = looseKey(cleaned);
    const legal = this.legalActions();
    let loose: Move | null = null;
    let looseAmbiguous = false;
    for (const m of legal) {
      const mu = moveToUci(m);
      const ms = moveToSan(this.board, m, legal).replace(/[+#!?]/g, '');
      if (mu === uci || ms === san || ms === sanO) return m; // exact
      if (looseKey(mu) === want || looseKey(ms) === want) {
        if (loose) looseAmbiguous = true; // a second loose hit — too vague to trust
        loose = m;
      }
    }
    return looseAmbiguous ? null : loose;
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

  // Who won and how, or null while the game is ongoing. The side delivering
  // checkmate is the side NOT to move at the mated position.
  result(): ChessResult | null {
    const term = this.terminal();
    if (!term) return null;
    const winner = term.reason === 'checkmate' ? (this.board.turn === WHITE ? BLACK : WHITE) : null;
    return { winner, reason: term.reason };
  }

  // null = game ongoing; otherwise the per-player utility vector.
  private outcome(): number[] | null {
    return this.terminal()?.returns ?? null;
  }

  // The terminal verdict (utility vector + reason), or null if the game continues.
  private terminal(): { returns: number[]; reason: ChessReason } | null {
    if (this.legalActions().length === 0) {
      if (isInCheck(this.board)) return { returns: this.board.turn === WHITE ? [-1, 1] : [1, -1], reason: 'checkmate' };
      return { returns: [0, 0], reason: 'stalemate' };
    }
    if (this.board.halfmove >= 100) return { returns: [0, 0], reason: 'fifty-move' };
    if (this.isThreefold()) return { returns: [0, 0], reason: 'repetition' };
    if (this.insufficientMaterial()) return { returns: [0, 0], reason: 'insufficient-material' };
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
