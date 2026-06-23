import {
  algToSquare,
  BLACK,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  type Color,
  EMPTY,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_DOUBLE,
  FLAG_EP,
  FLAG_PROMO,
  KING,
  type Move,
  PAWN,
  piece,
  pieceColor,
  type PieceType,
  pieceType,
  PIECE_CHARS,
  square,
  squareToAlg,
  WHITE,
} from './types.ts';

const CHAR_TO_TYPE: Record<string, PieceType> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

// The mutable chess position: the 0x88 board plus side-to-move, castling rights,
// en-passant square, and the two move clocks. Pure rules — no move generation
// (that's movegen.ts) and no notation (san.ts).
export class Board {
  squares = new Int8Array(128);
  turn: Color = WHITE;
  castling = 0;
  ep = -1; // 0x88 square behind a pawn that just double-pushed, or -1
  halfmove = 0; // plies since last capture/pawn move (50-move rule)
  fullmove = 1;

  clone(): Board {
    const b = new Board();
    b.squares = this.squares.slice();
    b.turn = this.turn;
    b.castling = this.castling;
    b.ep = this.ep;
    b.halfmove = this.halfmove;
    b.fullmove = this.fullmove;
    return b;
  }

  kingSquare(color: Color): number {
    const k = piece(color, KING);
    for (let sq = 0; sq < 128; sq++) {
      if ((sq & 0x88) === 0 && this.squares[sq] === k) return sq;
    }
    return -1;
  }

  applyMove(m: Move): void {
    const us = pieceColor(m.piece);
    const sq = this.squares;
    this.ep = -1;
    this.halfmove = pieceType(m.piece) === PAWN || m.flags & FLAG_CAPTURE ? 0 : this.halfmove + 1;

    sq[m.to] = m.piece;
    sq[m.from] = EMPTY;
    if (m.flags & FLAG_EP) sq[m.to + (us === WHITE ? -16 : 16)] = EMPTY;
    if (m.flags & FLAG_PROMO) sq[m.to] = piece(us, m.promotion as PieceType);
    if (m.flags & FLAG_CASTLE_K) {
      const rank = us === WHITE ? 0 : 7;
      sq[square(5, rank)] = sq[square(7, rank)];
      sq[square(7, rank)] = EMPTY;
    }
    if (m.flags & FLAG_CASTLE_Q) {
      const rank = us === WHITE ? 0 : 7;
      sq[square(3, rank)] = sq[square(0, rank)];
      sq[square(0, rank)] = EMPTY;
    }
    if (m.flags & FLAG_DOUBLE) this.ep = m.to + (us === WHITE ? -16 : 16);

    this.updateCastling(us, m);
    if (us === BLACK) this.fullmove++;
    this.turn = (us ^ 1) as Color;
  }

  // Any move from/to a rook's home corner, or any king move, revokes the
  // corresponding castling rights.
  private updateCastling(us: Color, m: Move): void {
    const touch = (s: number): void => {
      if (s === 0) this.castling &= ~CASTLE_WQ;
      else if (s === 7) this.castling &= ~CASTLE_WK;
      else if (s === 112) this.castling &= ~CASTLE_BQ;
      else if (s === 119) this.castling &= ~CASTLE_BK;
    };
    touch(m.from);
    touch(m.to);
    if (pieceType(m.piece) === KING) {
      this.castling &= us === WHITE ? ~(CASTLE_WK | CASTLE_WQ) : ~(CASTLE_BK | CASTLE_BQ);
    }
  }

  /** Position identity for repetition detection (placement + turn + castling + ep). */
  key(): string {
    return this.toFEN().split(' ').slice(0, 4).join(' ');
  }

  static fromFEN(fen: string): Board {
    const b = new Board();
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    let rank = 7;
    let file = 0;
    for (const ch of placement) {
      if (ch === '/') {
        rank--;
        file = 0;
      } else if (ch >= '1' && ch <= '8') {
        file += +ch;
      } else {
        const color: Color = ch === ch.toUpperCase() ? WHITE : BLACK;
        b.squares[square(file, rank)] = piece(color, CHAR_TO_TYPE[ch.toLowerCase()]);
        file++;
      }
    }
    b.turn = turn === 'b' ? BLACK : WHITE;
    if (castling?.includes('K')) b.castling |= CASTLE_WK;
    if (castling?.includes('Q')) b.castling |= CASTLE_WQ;
    if (castling?.includes('k')) b.castling |= CASTLE_BK;
    if (castling?.includes('q')) b.castling |= CASTLE_BQ;
    b.ep = ep && ep !== '-' ? algToSquare(ep) : -1;
    b.halfmove = half ? +half : 0;
    b.fullmove = full ? +full : 1;
    return b;
  }

  toFEN(): string {
    let placement = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.squares[square(file, rank)];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) {
          placement += empty;
          empty = 0;
        }
        const c = PIECE_CHARS[pieceType(p)];
        placement += pieceColor(p) === WHITE ? c.toUpperCase() : c;
      }
      if (empty) placement += empty;
      if (rank > 0) placement += '/';
    }
    let cr = '';
    if (this.castling & CASTLE_WK) cr += 'K';
    if (this.castling & CASTLE_WQ) cr += 'Q';
    if (this.castling & CASTLE_BK) cr += 'k';
    if (this.castling & CASTLE_BQ) cr += 'q';
    const ep = this.ep >= 0 ? squareToAlg(this.ep) : '-';
    return `${placement} ${this.turn === WHITE ? 'w' : 'b'} ${cr || '-'} ${ep} ${this.halfmove} ${this.fullmove}`;
  }
}
