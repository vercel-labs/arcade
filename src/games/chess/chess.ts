import { type Game, type GameState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { Board } from './board.ts';
import { generateLegalMoves, isInCheck } from './movegen.ts';
import { looseKey, moveToSan, moveToUci } from './san.ts';
import {
  BISHOP,
  BLACK,
  type Color,
  EMPTY,
  FILES,
  fileOf,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_PROMO,
  KING,
  KNIGHT,
  type Move,
  PAWN,
  piece,
  pieceColor,
  PIECE_CHARS,
  type PieceType,
  pieceType,
  QUEEN,
  rankOf,
  ROOK,
  square,
  squareColor,
  WHITE,
} from './types.ts';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Algebraic square ("e4") → 0x88 index, and SAN piece letters → PieceType — for
// the loose (illegal-moves) parser.
const algSquare = (a: string): number => square(a.charCodeAt(0) - 97, Number(a[1]) - 1);
const CHAR_TYPE: Record<string, PieceType> = { n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING, p: PAWN };

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

  // Parse ANY move string into a concrete Move WITHOUT legality (the illegal-moves
  // toggle): pull out the piece type + destination (+ disambiguation/promotion),
  // pick a source piece of that type for the side to move, and relocate it there.
  // Captures (even own pieces), moving into check, non-L knight hops, etc. are all
  // allowed — applyMove just trusts the Move. null only when nothing can be parsed
  // (no destination, or no such piece exists to move).
  actionFromStringLoose(s: string): Move | null {
    const color = this.board.turn;
    const sq = this.board.squares;
    const cleaned = s.trim().replace(/^\d+\.+\s*/, '').replace(/[+#!?]/g, '').trim();

    // Castling → the side-to-move's standard king + rook squares.
    const cnorm = cleaned.toLowerCase().replace(/0/g, 'o').replace(/[^o]/g, '');
    if (cnorm === 'oo' || cnorm === 'ooo') {
      const rank = color === WHITE ? 0 : 7;
      const from = square(4, rank);
      const kingside = cnorm === 'oo';
      return {
        from,
        to: square(kingside ? 6 : 2, rank),
        piece: sq[from] || piece(color, KING),
        captured: EMPTY,
        promotion: 0,
        flags: kingside ? FLAG_CASTLE_K : FLAG_CASTLE_Q,
      };
    }

    // UCI (e2e4, g1f3, e7e8q): move whatever sits on `from` to `to`.
    const uci = cleaned.toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/);
    if (uci) {
      const from = algSquare(uci[1]);
      const to = algSquare(uci[2]);
      if (!sq[from]) return null;
      return this.looseMove(from, to, sq[from], uci[3] ? CHAR_TYPE[uci[3].toLowerCase()] : 0);
    }

    // SAN: [piece?][disambig file?][disambig rank?][x?][dest][=promo?].
    const m = cleaned.match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])=?([NBRQK])?$/i);
    if (!m) return null;
    const type: PieceType = m[1] ? CHAR_TYPE[m[1].toLowerCase()] : PAWN;
    const to = algSquare(m[4].toLowerCase());
    const from = this.findSource(color, type, m[2]?.toLowerCase(), m[3], to);
    if (from < 0) return null;
    return this.looseMove(from, to, sq[from], m[5] ? CHAR_TYPE[m[5].toLowerCase()] : 0);
  }

  // A source piece of (color, type) for the side to move, narrowed by any
  // disambiguation. Pawn moves without a file hint take the destination file (a
  // push); otherwise the first matching piece wins (illegal mode is permissive).
  private findSource(color: Color, type: PieceType, disFile: string | undefined, disRank: string | undefined, to: number): number {
    const sq = this.board.squares;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      const p = sq[s];
      if (!p || pieceColor(p) !== color || pieceType(p) !== type) continue;
      if (disFile && FILES[fileOf(s)] !== disFile) continue;
      if (disRank && rankOf(s) + 1 !== Number(disRank)) continue;
      if (type === PAWN && !disFile && fileOf(s) !== fileOf(to)) continue;
      return s;
    }
    return -1;
  }

  // Assemble a Move that relocates `moving` from→to (capturing whatever's on `to`,
  // including an own piece), with promotion when given. No legality implied.
  private looseMove(from: number, to: number, moving: number, promotion: PieceType | 0): Move {
    const captured = this.board.squares[to];
    let flags = 0;
    if (captured) flags |= FLAG_CAPTURE;
    if (promotion) flags |= FLAG_PROMO;
    return { from, to, piece: moving, captured, promotion, flags };
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
