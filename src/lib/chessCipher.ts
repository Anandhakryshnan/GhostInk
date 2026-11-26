import {
  buildPayloadFrame,
  CipherAlgorithm,
  StegoError,
  StegoVersion,
  unpackPayloadFrame,
} from "./crypto";

type PromoPiece = "" | "q" | "r" | "b" | "n";

export interface ChessMove {
  from: number;
  to: number;
  promo: PromoPiece;
}

export interface ChessState {
  squares: Int8Array; // 64 squares: +1..+6 White (P,N,B,R,Q,K), -1..-6 Black
  turn: 1 | -1;
  castling: number; // 1=WK, 2=WQ, 4=BK, 8=BQ
  epSquare: number; // -1 or 0..63
  ply: number;
}

export interface ChessEncodeResult {
  pgn: string;
  gameCount: number;
  moveCount: number;
  finalBoard: Int8Array;
  framedBytes: number;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  expiresAt: number | null;
}

export interface ChessDecodeResult {
  secret: string;
  gameCount: number;
  moveCount: number;
  finalBoard: Int8Array;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  expiresAt: number | null;
}

const MAX_PLIES_PER_GAME = 80;
const FILES = "abcdefgh";
const PIECE_CHARS: Record<number, string> = {
  2: "N",
  3: "B",
  4: "R",
  5: "Q",
  6: "K",
};
const PROMO_RANK: Record<PromoPiece, number> = {
  "": 0,
  q: 1,
  r: 2,
  b: 3,
  n: 4,
};

export function createInitialBoard(): ChessState {
  const squares = new Int8Array(64);
  const backRank = [4, 2, 3, 5, 6, 3, 2, 4];
  for (let f = 0; f < 8; f++) {
    squares[f] = backRank[f]; // Rank 1 (White)
    squares[8 + f] = 1; // Rank 2 (White pawns)
    squares[48 + f] = -1; // Rank 7 (Black pawns)
    squares[56 + f] = -backRank[f]; // Rank 8 (Black)
  }
  return {
    squares,
    turn: 1,
    castling: 0b1111,
    epSquare: -1,
    ply: 0,
  };
}

function sqName(sq: number): string {
  const f = sq % 8;
  const r = Math.floor(sq / 8);
  return `${FILES[f]}${r + 1}`;
}

function isSquareAttacked(
  squares: Int8Array,
  sq: number,
  bySide: 1 | -1
): boolean {
  const r = Math.floor(sq / 8);
  const f = sq % 8;

  // Pawn attacks: a pawn of side `bySide` at (r - bySide, f +- 1) attacks (r, f)
  const pawnRank = r - bySide;
  if (pawnRank >= 0 && pawnRank < 8) {
    if (f > 0 && squares[pawnRank * 8 + (f - 1)] === bySide) return true;
    if (f < 7 && squares[pawnRank * 8 + (f + 1)] === bySide) return true;
  }

  // Knight attacks
  const knightSteps = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  for (const [dr, df] of knightSteps) {
    const nr = r + dr;
    const nf = f + df;
    if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
      if (squares[nr * 8 + nf] === bySide * 2) return true;
    }
  }

  // King attacks
  for (let dr = -1; dr <= 1; dr++) {
    for (let df = -1; df <= 1; df++) {
      if (dr === 0 && df === 0) continue;
      const nr = r + dr;
      const nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        if (squares[nr * 8 + nf] === bySide * 6) return true;
      }
    }
  }

  // Diagonal rays (Bishop / Queen)
  const diagDirs = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  for (const [dr, df] of diagDirs) {
    let nr = r + dr;
    let nf = f + df;
    while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
      const p = squares[nr * 8 + nf];
      if (p !== 0) {
        if (p === bySide * 3 || p === bySide * 5) return true;
        break;
      }
      nr += dr;
      nf += df;
    }
  }

  // Orthogonal rays (Rook / Queen)
  const orthoDirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dr, df] of orthoDirs) {
    let nr = r + dr;
    let nf = f + df;
    while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
      const p = squares[nr * 8 + nf];
      if (p !== 0) {
        if (p === bySide * 4 || p === bySide * 5) return true;
        break;
      }
      nr += dr;
      nf += df;
    }
  }

  return false;
}

function findKing(squares: Int8Array, side: 1 | -1): number {
  const target = side * 6;
  for (let i = 0; i < 64; i++) {
    if (squares[i] === target) return i;
  }
  return -1;
}

export function applyMove(state: ChessState, move: ChessMove): ChessState {
  const nextSquares = new Int8Array(state.squares);
  const movingPiece = nextSquares[move.from];
  const absPiece = Math.abs(movingPiece);
  const side = state.turn;
  let nextEp = -1;
  let nextCastling = state.castling;

  // En passant capture
  if (absPiece === 1 && move.to === state.epSquare) {
    const capSq = move.to - side * 8;
    nextSquares[capSq] = 0;
  }

  // Castling rook move
  if (absPiece === 6 && Math.abs(move.to - move.from) === 2) {
    const rankBase = side === 1 ? 0 : 56;
    if (move.to > move.from) {
      nextSquares[rankBase + 5] = nextSquares[rankBase + 7];
      nextSquares[rankBase + 7] = 0;
    } else {
      nextSquares[rankBase + 3] = nextSquares[rankBase];
      nextSquares[rankBase] = 0;
    }
  }

  // Move piece (with optional promotion)
  nextSquares[move.from] = 0;
  if (move.promo) {
    const promoMap: Record<Exclude<PromoPiece, "">, number> = {
      q: 5,
      r: 4,
      b: 3,
      n: 2,
    };
    nextSquares[move.to] = side * promoMap[move.promo];
  } else {
    nextSquares[move.to] = movingPiece;
  }

  // Update en passant target on double pawn push
  if (absPiece === 1 && Math.abs(move.to - move.from) === 16) {
    nextEp = (move.from + move.to) / 2;
  }

  // Update castling rights when king or rook moves or corner rook is captured
  if (move.from === 4 || move.to === 4) nextCastling &= ~0b0011;
  if (move.from === 60 || move.to === 60) nextCastling &= ~0b1100;
  if (move.from === 0 || move.to === 0) nextCastling &= ~0b0010;
  if (move.from === 7 || move.to === 7) nextCastling &= ~0b0001;
  if (move.from === 56 || move.to === 56) nextCastling &= ~0b1000;
  if (move.from === 63 || move.to === 63) nextCastling &= ~0b0100;

  return {
    squares: nextSquares,
    turn: (side * -1) as 1 | -1,
    castling: nextCastling,
    epSquare: nextEp,
    ply: state.ply + 1,
  };
}

export function getLegalMoves(state: ChessState): ChessMove[] {
  const pseudo: ChessMove[] = [];
  const side = state.turn;
  const enemy = (side * -1) as 1 | -1;

  for (let sq = 0; sq < 64; sq++) {
    const p = state.squares[sq];
    if (p * side <= 0) continue;

    const absP = Math.abs(p);
    const r = Math.floor(sq / 8);
    const f = sq % 8;

    if (absP === 1) {
      // Pawn moves
      const forward = sq + side * 8;
      const promoRank = side === 1 ? 7 : 0;
      const startRank = side === 1 ? 1 : 6;

      if (forward >= 0 && forward < 64 && state.squares[forward] === 0) {
        const destRank = Math.floor(forward / 8);
        if (destRank === promoRank) {
          for (const promo of ["q", "r", "b", "n"] as const) {
            pseudo.push({ from: sq, to: forward, promo });
          }
        } else {
          pseudo.push({ from: sq, to: forward, promo: "" });
          if (r === startRank) {
            const dbl = sq + side * 16;
            if (state.squares[dbl] === 0) {
              pseudo.push({ from: sq, to: dbl, promo: "" });
            }
          }
        }
      }

      for (const df of [-1, 1]) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const cap = forward + df;
        if (cap < 0 || cap >= 64) continue;
        const target = state.squares[cap];
        if (target * side < 0 || cap === state.epSquare) {
          const destRank = Math.floor(cap / 8);
          if (destRank === promoRank) {
            for (const promo of ["q", "r", "b", "n"] as const) {
              pseudo.push({ from: sq, to: cap, promo });
            }
          } else {
            pseudo.push({ from: sq, to: cap, promo: "" });
          }
        }
      }
    } else if (absP === 2) {
      const steps = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      for (const [dr, df] of steps) {
        const nr = r + dr;
        const nf = f + df;
        if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const to = nr * 8 + nf;
        if (state.squares[to] * side <= 0) {
          pseudo.push({ from: sq, to, promo: "" });
        }
      }
    } else if (absP === 3 || absP === 4 || absP === 5) {
      const dirs: number[][] = [];
      if (absP === 3 || absP === 5) {
        dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (absP === 4 || absP === 5) {
        dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      for (const [dr, df] of dirs) {
        let nr = r + dr;
        let nf = f + df;
        while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const to = nr * 8 + nf;
          const target = state.squares[to];
          if (target === 0) {
            pseudo.push({ from: sq, to, promo: "" });
          } else {
            if (target * side < 0) pseudo.push({ from: sq, to, promo: "" });
            break;
          }
          nr += dr;
          nf += df;
        }
      }
    } else if (absP === 6) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let df = -1; df <= 1; df++) {
          if (dr === 0 && df === 0) continue;
          const nr = r + dr;
          const nf = f + df;
          if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
          const to = nr * 8 + nf;
          if (state.squares[to] * side <= 0) {
            pseudo.push({ from: sq, to, promo: "" });
          }
        }
      }

      // Castling
      const homeRank = side === 1 ? 0 : 7;
      const kingSq = homeRank * 8 + 4;
      if (sq === kingSq && !isSquareAttacked(state.squares, kingSq, enemy)) {
        const kRight = side === 1 ? 1 : 4;
        const qRight = side === 1 ? 2 : 8;

        if (
          state.castling & kRight &&
          state.squares[kingSq + 1] === 0 &&
          state.squares[kingSq + 2] === 0 &&
          state.squares[kingSq + 3] === side * 4 &&
          !isSquareAttacked(state.squares, kingSq + 1, enemy) &&
          !isSquareAttacked(state.squares, kingSq + 2, enemy)
        ) {
          pseudo.push({ from: kingSq, to: kingSq + 2, promo: "" });
        }

        if (
          state.castling & qRight &&
          state.squares[kingSq - 1] === 0 &&
          state.squares[kingSq - 2] === 0 &&
          state.squares[kingSq - 3] === 0 &&
          state.squares[kingSq - 4] === side * 4 &&
          !isSquareAttacked(state.squares, kingSq - 1, enemy) &&
          !isSquareAttacked(state.squares, kingSq - 2, enemy)
        ) {
          pseudo.push({ from: kingSq, to: kingSq - 2, promo: "" });
        }
      }
    }
  }

  const legal = pseudo.filter((move) => {
    const next = applyMove(state, move);
    const kSq = findKing(next.squares, side);
    return kSq !== -1 && !isSquareAttacked(next.squares, kSq, enemy);
  });

  legal.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return a.to - b.to;
    return PROMO_RANK[a.promo] - PROMO_RANK[b.promo];
  });

  return legal;
}

function moveToBaseSan(
  state: ChessState,
  move: ChessMove,
  legalMoves: ChessMove[]
): string {
  const piece = Math.abs(state.squares[move.from]);

  if (piece === 6 && Math.abs(move.to - move.from) === 2) {
    return move.to > move.from ? "O-O" : "O-O-O";
  }

  const fromFile = move.from % 8;
  const fromRank = Math.floor(move.from / 8);
  const isCapture =
    state.squares[move.to] !== 0 || (piece === 1 && move.to === state.epSquare);

  if (piece === 1) {
    const prefix = isCapture ? `${FILES[fromFile]}x` : "";
    const promo = move.promo ? `=${move.promo.toUpperCase()}` : "";
    return `${prefix}${sqName(move.to)}${promo}`;
  }

  const samePieceToSameTarget = legalMoves.filter(
    (m) =>
      m.from !== move.from &&
      m.to === move.to &&
      Math.abs(state.squares[m.from]) === piece
  );

  let disambig = "";
  if (samePieceToSameTarget.length > 0) {
    const sameFile = samePieceToSameTarget.some((m) => m.from % 8 === fromFile);
    const sameRank = samePieceToSameTarget.some(
      (m) => Math.floor(m.from / 8) === fromRank
    );
    if (!sameFile) {
      disambig = FILES[fromFile];
    } else if (!sameRank) {
      disambig = String(fromRank + 1);
    } else {
      disambig = `${FILES[fromFile]}${fromRank + 1}`;
    }
  }

  const captureSym = isCapture ? "x" : "";
  return `${PIECE_CHARS[piece]}${disambig}${captureSym}${sqName(move.to)}`;
}

function formatSanWithCheck(
  state: ChessState,
  move: ChessMove,
  legalMoves: ChessMove[]
): { san: string; nextState: ChessState } {
  const base = moveToBaseSan(state, move, legalMoves);
  const nextState = applyMove(state, move);
  const oppKing = findKing(nextState.squares, nextState.turn);
  const inCheck =
    oppKing !== -1 && isSquareAttacked(nextState.squares, oppKing, state.turn);

  if (!inCheck) {
    return { san: base, nextState };
  }

  const oppMoves = getLegalMoves(nextState);
  return {
    san: `${base}${oppMoves.length === 0 ? "#" : "+"}`,
    nextState,
  };
}

function normalizeSanToken(token: string): string {
  return token.replace(/[+#!?]+$/g, "").replace(/0/g, "O");
}

function bytesToBitsWithLength(bytes: Uint8Array): number[] {
  const withLen = new Uint8Array(2 + bytes.byteLength);
  withLen[0] = (bytes.byteLength >> 8) & 0xff;
  withLen[1] = bytes.byteLength & 0xff;
  withLen.set(bytes, 2);

  const bits: number[] = [];
  for (let i = 0; i < withLen.byteLength; i++) {
    const b = withLen[i];
    for (let shift = 7; shift >= 0; shift--) {
      bits.push((b >> shift) & 1);
    }
  }
  return bits;
}

function bitsToBytes(bits: number[]): Uint8Array {
  const byteCount = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    out[i] = b;
  }
  return out;
}

function formatSinglePgnGame(
  sans: string[],
  gameNumber: number,
  whiteName: string,
  blackName: string
): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const headers = [
    `[Event "Casual Match ${gameNumber}"]`,
    `[Site "GhostInk Chess Board"]`,
    `[Date "${today}"]`,
    `[Round "${gameNumber}"]`,
    `[White "${whiteName || "Player A"}"]`,
    `[Black "${blackName || "Player B"}"]`,
    `[Result "*"]`,
  ];

  const movePairs: string[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const white = sans[i];
    const black = sans[i + 1];
    movePairs.push(black ? `${num}. ${white} ${black}` : `${num}. ${white}`);
  }

  return `${headers.join("\n")}\n\n${movePairs.join(" ")} *`;
}

function parsePgnGames(pgnText: string): string[][] {
  const trimmed = pgnText.trim();
  if (!trimmed) return [];

  // Split games on [Event ...] boundaries if multiple games exist
  const rawGames = trimmed
    .split(/(?=\[Event\s+")/i)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  return rawGames.map((gameText) => {
    const body = gameText
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/;[^\r\n]*/g, " ");

    return body
      .split(/\s+/)
      .map((tok) => tok.trim())
      .filter((tok) => {
        if (!tok) return false;
        if (/^\d+\.+$/.test(tok)) return false;
        if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) return false;
        return true;
      })
      .map((tok) => tok.replace(/^\d+\.+/, ""))
      .filter((tok) => tok.length > 0);
  });
}

export async function encodeSecretToPgn(options: {
  secret: string;
  passphrase: string;
  noPassword: boolean;
  ttlSeconds?: number;
  algorithm?: CipherAlgorithm;
  whiteName?: string;
  blackName?: string;
}): Promise<ChessEncodeResult> {
  const { frame, version, algorithm, expiresAt } = await buildPayloadFrame(
    options.secret,
    options.passphrase,
    options.noPassword,
    options.ttlSeconds ?? 0,
    options.algorithm ?? "aes-gcm"
  );

  if (frame.byteLength > 65_535) {
    throw new StegoError(
      "UNSUPPORTED_ENV",
      "Secret payload exceeds 64 KB chess PGN framing limit."
    );
  }

  const bits = bytesToBitsWithLength(frame);
  let cursor = 0;

  const games: string[] = [];
  let totalMoves = 0;
  let state = createInitialBoard();
  let currentSans: string[] = [];

  while (cursor < bits.length) {
    const legal = getLegalMoves(state);
    if (legal.length < 2 || state.ply >= MAX_PLIES_PER_GAME) {
      games.push(
        formatSinglePgnGame(
          currentSans,
          games.length + 1,
          options.whiteName ?? "Player A",
          options.blackName ?? "Player B"
        )
      );
      state = createInitialBoard();
      currentSans = [];
      continue;
    }

    const k = Math.floor(Math.log2(legal.length));
    let val = 0;
    for (let i = 0; i < k; i++) {
      const bit = cursor < bits.length ? bits[cursor] : 0;
      val = (val << 1) | bit;
      cursor += 1;
    }

    const move = legal[val];
    const { san, nextState } = formatSanWithCheck(state, move, legal);
    currentSans.push(san);
    totalMoves += 1;
    state = nextState;
  }

  if (currentSans.length > 0) {
    games.push(
      formatSinglePgnGame(
        currentSans,
        games.length + 1,
        options.whiteName ?? "Player A",
        options.blackName ?? "Player B"
      )
    );
  }

  return {
    pgn: games.join("\n\n"),
    gameCount: games.length,
    moveCount: totalMoves,
    finalBoard: state.squares,
    framedBytes: frame.byteLength,
    version,
    algorithm,
    expiresAt,
  };
}

export async function decodeSecretFromPgn(options: {
  pgn: string;
  passphrase: string;
}): Promise<ChessDecodeResult> {
  const gamesMoves = parsePgnGames(options.pgn);
  if (!gamesMoves.length || gamesMoves.every((g) => g.length === 0)) {
    throw new StegoError("NO_PAYLOAD", "No valid PGN chess moves found.");
  }

  const bits: number[] = [];
  let totalMoves = 0;
  let lastBoard = createInitialBoard().squares;
  let expectedByteLen: number | null = null;

  for (const moveTokens of gamesMoves) {
    let state = createInitialBoard();

    for (const rawToken of moveTokens) {
      const legal = getLegalMoves(state);
      if (legal.length < 2 || state.ply >= MAX_PLIES_PER_GAME) {
        throw new StegoError(
          "CORRUPTED_PAYLOAD",
          "PGN game boundary mismatch while decoding chess cipher."
        );
      }

      const targetSan = normalizeSanToken(rawToken);
      const matchIdx = legal.findIndex(
        (m) => moveToBaseSan(state, m, legal) === targetSan
      );

      if (matchIdx === -1) {
        throw new StegoError(
          "CORRUPTED_PAYLOAD",
          `Invalid or illegal chess move "${rawToken}" encountered in PGN.`
        );
      }

      const k = Math.floor(Math.log2(legal.length));
      if (matchIdx >= 1 << k) {
        throw new StegoError(
          "CORRUPTED_PAYLOAD",
          "Chess move index out of encoded radix range."
        );
      }

      for (let shift = k - 1; shift >= 0; shift--) {
        bits.push((matchIdx >> shift) & 1);
      }

      state = applyMove(state, legal[matchIdx]);
      lastBoard = state.squares;
      totalMoves += 1;

      if (expectedByteLen === null && bits.length >= 16) {
        const lenBytes = bitsToBytes(bits.slice(0, 16));
        expectedByteLen = (lenBytes[0] << 8) | lenBytes[1];
      }

      if (
        expectedByteLen !== null &&
        bits.length >= 16 + expectedByteLen * 8
      ) {
        break;
      }
    }

    if (expectedByteLen !== null && bits.length >= 16 + expectedByteLen * 8) {
      break;
    }
  }

  if (
    expectedByteLen === null ||
    expectedByteLen < 2 ||
    bits.length < 16 + expectedByteLen * 8
  ) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "PGN ended before the full encrypted payload could be reconstructed."
    );
  }

  const payloadBits = bits.slice(16, 16 + expectedByteLen * 8);
  const frame = bitsToBytes(payloadBits);

  const { plaintext, version, algorithm, expiresAt } = await unpackPayloadFrame(
    frame,
    options.passphrase
  );

  return {
    secret: plaintext,
    gameCount: gamesMoves.length,
    moveCount: totalMoves,
    finalBoard: lastBoard,
    version,
    algorithm,
    expiresAt,
  };
}
