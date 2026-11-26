# GhostInk — Multi-Modal Authenticated Steganography & Threshold Cryptography Suite

**GhostInk** is a 100% client-side cryptographic and covert-communication web application built with **Next.js (App Router), TypeScript, Tailwind CSS, and Framer Motion**. All compression, encryption, key derivation, secret sharing, chess move encoding, steganalysis, and peer-to-peer messaging execute strictly inside the browser using native Web APIs (**Web Crypto API** `window.crypto.subtle`, **Compression Streams API**, and **WebRTC**) with **zero backend servers** and **zero external crypto libraries**.

---

## Table of Contents

1. [Core Cryptographic Pipeline (`src/lib/crypto.ts`)](#1-core-cryptographic-pipeline-srclibcryptots)
2. [Binary Framing & Version Specification](#2-binary-framing--version-specification)
3. [Unicode Steganography & Emoji Cloaking (`src/lib/stego.ts`)](#3-unicode-steganography--emoji-cloaking-srclibstegots)
4. [Platform Limit & Survival Guard (`src/lib/platforms.ts`)](#4-platform-limit--survival-guard-srclibplatformsts)
5. [X-Ray Steganalysis Inspector (`src/lib/inspector.ts`)](#5-x-ray-steganalysis-inspector-srclibinspectorts)
6. [Shamir’s Secret Sharing over $GF(2^8)$ (`src/lib/shamir.ts`)](#6-shamirs-secret-sharing-over-gf28-srclibshamirts)
7. [Chess Game PGN Cipher (`src/lib/chessCipher.ts`)](#7-chess-game-pgn-cipher-srclibchesscipherts)
8. [Serverless P2P Whisper (`src/lib/p2pWhisper.ts`)](#8-serverless-p2p-whisper-srclibp2pwhisperts)
9. [Refresh Persistence & Live Countdowns](#9-refresh-persistence--live-countdowns)
10. [Project Structure & Running Locally](#10-project-structure--running-locally)

---

## 1. Core Cryptographic Pipeline (`src/lib/crypto.ts`)

Every payload encoding mode (Zero-Width, Single-Emoji, Shamir Split Vault, and Chess PGN) shares the same authenticated compression and encryption pipeline:

```text
UTF-8 Secret
   │
   ▼  (Optional) Prepend 8-Byte Big-Endian UTC Expiration Timestamp (expiresAtMs)
   │
   ▼  Compress via CompressionStream('deflate-raw')
   │
   ├──► No-Password Mode ──► Frame with 0x00 (or 0x03 with TTL)
   │
   └──► Passphrase Mode  ──► PBKDF2-HMAC-SHA256 (250,000 iterations, 16B random salt)
                                │
                                ├──► AES-256-GCM (12B random IV, 16B GCM Auth Tag) ──► 0x01 / 0x02
                                │
                                └──► AES-256-CTR + HMAC-SHA256 (512-bit key split,
                                     16B counter nonce, 32B Encrypt-then-MAC tag)  ──► 0x04 / 0x05
```

### Key Cryptographic Choices
- **Pre-Encryption Compression (`deflate-raw`):** Secrets are compressed before encryption so ciphertext entropy is unaffected by predictable plaintext compression ratios and covert payloads stay as short as possible.
- **Key Stretching (`PBKDF2`):** Uses `SHA-256` with **`250,000` iterations** and a fresh `16-byte` (`128-bit`) `crypto.getRandomValues` salt per message.
- **Selectable Cipher Algorithms:**
  - **`AES-256-GCM` (Default AEAD):** Derives a 256-bit `AES-GCM` key (`12-byte` random IV + built-in `16-byte` authentication tag), yielding compact `45-byte` framing overhead.
  - **`AES-256-CTR + HMAC-SHA256` (Encrypt-then-MAC):** Uses `PBKDF2` (`deriveBits`) to generate **512 bits**, splitting bytes `0..31` into an `AES-CTR` encryption key (`16-byte` random counter block with `length: 64`) and bytes `32..63` into an `HMAC-SHA256` key. The `32-byte` MAC authenticates `[Version || Salt || Counter || Ciphertext]` and is verified via `crypto.subtle.verify` **before** decryption.
- **Tamper-Proof Self-Destruct TTL:** When a TTL preset (`10m`, `1h`, `24h`, `7d`) is chosen, an `8-byte` unsigned big-endian millisecond epoch (`high * 2^32 + low`) is prepended *inside* the compressed plaintext before encryption. An attacker cannot alter or extend expiration without invalidating the GCM/HMAC authentication tag. On reveal, if `Date.now() > expiresAtMs`, a `PAYLOAD_EXPIRED` error is thrown without releasing the secret.
- **Explicit Failure Classification (`StegoError`):**
  - `NO_PAYLOAD` — No stego code points or PGN tokens detected.
  - `MISSING_PASSPHRASE` — Encrypted version header detected (`0x01`/`0x02`/`0x04`/`0x05`) with empty passphrase.
  - `DECRYPT_FAILED` — `AES-GCM` `OperationError` or failed `HMAC` verification (wrong passphrase or tampered payload).
  - `CORRUPTED_PAYLOAD` — Broken bit/nibble alignment, truncated header, or invalid `deflate-raw` stream.
  - `PAYLOAD_EXPIRED` — Authenticated TTL timestamp is in the past.

---

## 2. Binary Framing & Version Specification

| Version Byte | Mode | Binary Layout | Min Frame Size |
| :--- | :--- | :--- | :--- |
| `0x00` | Unencrypted | `[1B 0x00] + [Deflate Plaintext]` | `2 B` |
| `0x01` | `AES-256-GCM` | `[1B 0x01] + [16B Salt] + [12B IV] + [Ciphertext + 16B Tag]` | `45 B` |
| `0x02` | `AES-256-GCM` + TTL | `[1B 0x02] + [16B Salt] + [12B IV] + [Ciphertext(TTL+Msg) + 16B Tag]` | `45 B` |
| `0x03` | Unencrypted + TTL | `[1B 0x03] + [Deflate(8B TTL + Plaintext)]` | `2 B` |
| `0x04` | `AES-256-CTR + HMAC` | `[1B 0x04] + [16B Salt] + [16B Counter] + [Ciphertext] + [32B HMAC]` | `66 B` |
| `0x05` | `AES-256-CTR + HMAC` + TTL | `[1B 0x05] + [16B Salt] + [16B Counter] + [Ciphertext(TTL+Msg)] + [32B HMAC]` | `66 B` |

---

## 3. Unicode Steganography & Emoji Cloaking (`src/lib/stego.ts`)

### A. Zero-Width Base-4 Encoding (`encoding: "zero-width"`)
Each byte is split into four 2-bit pairs (MSB to LSB: shifts `6, 4, 2, 0`), yielding **4 invisible characters per byte**:

| 2-Bit Value | Code Point | Unicode Name |
| :---: | :---: | :--- |
| `00` | `\u200B` | Zero Width Space (`ZWSP`) |
| `01` | `\u200C` | Zero Width Non-Joiner (`ZWNJ`) |
| `10` | `\u200D` | Zero Width Joiner (`ZWJ`) |
| `11` | `\u2060` | Word Joiner (`WJ`) |

#### Safe Interior Anchoring (`anchorPayload`)
Messaging apps, mobile keyboards, and browsers often `.trim()` leading or trailing invisible characters on copy-paste. GhostInk therefore:
1. Strips any pre-existing hidden stego characters from the cover text.
2. **Multi-word cover:** Injects the zero-width payload strictly *between* the first word and the whitespace preceding the second word (`/^(\s*\S+)(\s+)([\s\S]*)$/`).
3. **Single-word cover:** Splits on the first grapheme cluster using `Intl.Segmenter` (`granularity: "grapheme"`) so multi-byte emojis/accents are never split mid-codepoint, embedding immediately after the first visible grapheme.
4. **Empty cover fallback:** Falls back to `"Hi" + hiddenPayload + " there"`.

### B. Single-Emoji Cloaking via Variation Selectors (`encoding: "emoji-vs"`)
Each byte is split into two 4-bit nibbles (`(byte >> 4) & 0x0F` and `byte & 0x0F`), mapped onto the 16 consecutive BMP **Variation Selectors** (`U+FE00`–`U+FE0F`):
- **Density:** **2 invisible characters per byte** (50% shorter than Base-4 zero-width).
- **Grapheme Binding (`anchorEmojiPayload`):** Attaches the selector stream directly after a single base emoji (`👻`, `🔐`, `🫥`, `✨`, `🎭`, `🫧`, `🚀`, `👀`, or custom). Per Unicode UAX #29 (`GB9`), Variation Selectors extend the preceding grapheme cluster so copying the single emoji copies the entire hidden payload.
- **False-Positive Immunity:** Standard emojis such as `❤️` use `U+FE0F` (`0xF`). `detectPayload` ignores isolated `U+FE0F` runs (`< 4` chars), and two `U+FE0F` selectors decode to `0xFF`, which is rejected as a non-header byte.

---

## 4. Platform Limit & Survival Guard (`src/lib/platforms.ts`)

Because covert encoding multiplies character length (`×4` for Zero-Width, `×2` for Emoji VS), **HidePanel** calculates projected total UTF-16 character length in real time (`coverLength + hiddenChars`) against common platform caps:

- **SMS:** `160` chars
- **X / Twitter:** `280` chars
- **Instagram DM:** `1,000` chars
- **Discord:** `2,000` chars
- **Telegram:** `4,096` chars
- **Slack:** `40,000` chars
- **WhatsApp:** `65,536` chars

`assessCoverSurvival` additionally warns if a cover text is empty (`fallback`), 1-character (`caution` — trailing edge risk), or single-word (`caution`) vs. multi-word (`optimal`).

---

## 5. X-Ray Steganalysis Inspector (`src/lib/inspector.ts`)

`inspectStegoText` scans arbitrary pasted text in a single pass and outputs:
- Inline tokenized segments distinguishing visible text runs, zero-width tokens (`[ZWSP]`, `[ZWNJ]`, `[ZWJ]`, `[WJ]`), and Variation Selectors (`[VS1]`–`[VS16]`, `U+FE00`–`U+FE0F`).
- Grapheme-accurate visible character count (`Intl.Segmenter`), hidden character count, raw decoded byte count, bit/nibble alignment status, and detected version/algorithm header.
- **`edgeExposed` check:** Flags zero-width glyphs sitting at index `0` or the final index where messaging apps may strip them.
- **One-click Sanitizer (`stripAllHiddenChars`):** Removes all `[\u200B\u200C\u200D\u2060\uFE00-\uFE0F]` code points cleanly.

---

## 6. Shamir’s Secret Sharing over $GF(2^8)$ (`src/lib/shamir.ts`)

Split Vault implements a $(k, n)$ threshold secret sharing scheme ($2 \le k \le n \le 255$) directly over the Galois Field $GF(2^8)$ using the AES irreducible polynomial:

$$P(x) = x^8 + x^4 + x^3 + x + 1 \quad (\text{0x11B})$$

- **Splitting (`splitBytesShamir`):** For each byte $s_i$ of the framed (and optionally encrypted + TTL) payload, $k - 1$ random coefficients $a_1, \dots, a_{k-1} \in [0, 255]$ are drawn from `crypto.getRandomValues`. Each shard $j \in \{1, \dots, n\}$ evaluates:
  $$f_i(j) = s_i \oplus a_1 j \oplus a_2 j^2 \oplus \dots \oplus a_{k-1} j^{k-1}$$
  via Horner’s method.
- **Reconstruction (`combineBytesShamir`):** Given any $k$ distinct shards $(x_m, y_m)$, the original byte $s_i = f_i(0)$ is recovered via Lagrange interpolation at $x = 0$:
  $$f_i(0) = \bigoplus_{m=1}^{k} y_{m,i} \odot \prod_{r \ne m} \frac{x_r}{x_m \oplus x_r}$$
  where multiplicative inverses $b^{-1}$ are computed as $b^{254}$ in $GF(2^8)$.
- **Shard Format:** `gi1.<threshold>.<index>.<base64url(bytes)>`. Any fewer than $k$ shards reveal **zero** information about the payload.

---

## 7. Chess Game PGN Cipher (`src/lib/chessCipher.ts`)

Encodes arbitrary encrypted payloads as **100% legal chess matches in Standard Algebraic Notation (PGN)** with **zero invisible characters**—allowing secrets to survive strict text filters, SMS, screenshots, and OCR:

1. **Deterministic Legal Move Engine:** `getLegalMoves` implements complete chess rules (pawn pushes, double pushes, en passant, 4-piece promotions, knight/bishop/rook/queen movement, castling `O-O`/`O-O-O`, check/pin filtering) and sorts all legal moves canonically by `(from, to, promotion)`.
2. **Variable-Radix Bitstream Packing:** The frame is prefixed with a `16-bit` big-endian byte length (`[lenHi, lenLo]`). At each board ply with $M \ge 2$ legal moves, the encoder reads $k = \lfloor \log_2 M \rfloor$ bits from the bitstream (`4` bits/move at the opening position, rising to `5` bits/move in open middlegames), selects `legalMoves[value]`, and formats standard SAN (including file/rank disambiguation and `+`/`#` check/mate suffixes).
3. **Automatic Multi-Game Framing:** If `ply >= 80` (40 moves per side) or `M < 2` (checkmate/stalemate/forced move) before all bits are encoded, both encoder and decoder deterministically reset to the starting board and emit `[Event "Casual Match N"]` for the next game.
4. **Decoding (`decodeSecretFromPgn`):** Parses PGN movetext, replays the exact legal move list at each ply, matches each normalized SAN token back to its move index, extracts $k$ bits, reads the 16-bit byte length, and passes the recovered binary frame to `unpackPayloadFrame`.

---

## 8. Serverless P2P Whisper (`src/lib/p2pWhisper.ts`)

Provides direct browser-to-browser encrypted chat over **WebRTC DataChannels** without a signaling server or database:

1. **Copy-Paste Signaling & ECDH Key Agreement:**
   - Host creates an `RTCPeerConnection` (`stun:stun.l.google.com:19302`), opens an ordered `RTCDataChannel` (`ghostink-whisper`), generates an ephemeral **ECDH (NIST P-256)** keypair, waits for ICE gathering, and outputs a `GHOST-INVITE-...` base64url envelope (`{ sdp, pubKeyJwk, displayName }`).
   - Peer imports the invite, generates its own ephemeral `ECDH (P-256)` keypair, derives a shared **256-bit `AES-GCM`** session key via `crypto.subtle.deriveKey`, and returns `GHOST-ANSWER-...`.
   - Both sides compute an identical `6-byte` **SHA-256 Safety Fingerprint** (`XX-XX-XX-XX-XX-XX`) over the sorted public keys to detect MITM tampering.
2. **Chunked End-to-End Encrypted Wire Protocol:**
   - All chat messages, display name sync (`hello`), typing indicators (`typing`), delivery/read receipts (`ack`), emoji reactions (`reaction`), unsend commands (`delete`), and file/image attachments (up to `4 MB`) are serialized and encrypted with `AES-256-GCM` (`12-byte` random IV per message).
   - Ciphertexts exceeding `24,000` base64url characters are automatically split into `chunk` frames (`transferId`, `index`, `total`, `slice`) for cross-browser WebRTC SCTP compatibility and reassembled before decryption.

---

## 9. Refresh Persistence & Live Countdowns

- **`useSessionState` (`src/lib/sessionPersist.ts`):** Uses React’s `useSyncExternalStore` backed by `sessionStorage` so refreshing the page (`F5`) preserves active tabs, drafts, outputs, and P2P Whisper transcripts/burn-timers with zero SSR hydration mismatches—while closing the tab clears session storage automatically (and plaintext passphrases are never persisted to storage).
- **Shared Live Ticker (`src/components/CountdownBadge.tsx`):** Uses a single shared `1s` `useSyncExternalStore` interval (`useLiveNow`) to drive live countdowns (`Expires in 9m 58s`, `🔥 29s`) across all TTL outputs and burning chat messages.

---

## 10. Project Structure & Running Locally

```text
src/
├── app/
│   ├── globals.css          # Dark monochrome theme (#121212), glass-card & dot-grid styles
│   ├── icon.svg             # Custom GhostInk vector favicon
│   ├── layout.tsx           # Inter & JetBrains Mono fonts + SEO/OpenGraph metadata
│   └── page.tsx             # Entry route rendering StegoWorkspace
├── components/
│   ├── ChessPanel.tsx       # Chess PGN encoder/decoder + 8x8 SVG board preview
│   ├── CountdownBadge.tsx   # Shared 1s live countdown ticker & formatter
│   ├── HidePanel.tsx        # Zero-Width & Single-Emoji cloaking + Platform Guard
│   ├── RevealPanel.tsx      # Auto-detecting stego decoder & TTL validator
│   ├── ShamirPanel.tsx      # GF(2^8) K-of-N shard splitter & reconstructor
│   ├── StegoWorkspace.tsx   # 6-tab Framer Motion workspace shell
│   ├── WhisperPanel.tsx     # Full-featured serverless WebRTC + ECDH chat UI
│   └── XRayInspector.tsx    # Inline code-point steganalysis & sanitizer
└── lib/
    ├── chessCipher.ts       # Deterministic legal chess engine & SAN bitstream codec
    ├── crypto.ts            # PBKDF2, AES-256-GCM, AES-256-CTR+HMAC, deflate-raw, TTL
    ├── inspector.ts         # ZWSP/ZWNJ/ZWJ/WJ & VS1..VS16 tokenizer
    ├── p2pWhisper.ts        # ECDH P-256, chunked AES-GCM frames, WebRTC helpers
    ├── platforms.ts         # Messaging character limits & anchor survival checks
    ├── sessionPersist.ts    # Hydration-safe sessionStorage state hook
    └── shamir.ts            # GF(2^8) arithmetic, Horner evaluation, Lagrange recovery
```

### Commands

```bash
npm install
npm run dev      # Start local dev server at http://localhost:3000
npm run lint     # Run ESLint
npm run build    # Production build
```

### Deploying to Vercel

This repository requires **zero environment variables or backend setup**. Push to GitHub and import into [Vercel](https://vercel.com/new) using the default **Next.js** preset—HTTPS is enabled automatically for `window.crypto.subtle`.
