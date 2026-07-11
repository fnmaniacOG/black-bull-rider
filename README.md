# 🐂 Black Bull Rider

Skill-based crash game and deflationary utility for **$ANSEM** (Solana).

Ride the bull. The multiplier climbs. Letters (A–Z) pop up in random sizes, shapes, and colors — **whack every one before it fades or you get bucked off**. Avoid the 💣 bombs. Cash out any time before the crash.

## Tokenomics

Entry: **2 $ANSEM per ride**, one atomic transaction:

- **1 $ANSEM → prize pool wallet** (funds payouts)
- **1 $ANSEM → burned** (`BurnChecked` — supply destroyed forever)

Every ride is deflationary, win or lose. Cash out pays `1 $ANSEM × multiplier` from the pool (single payout capped at 25% of pool). House edge 4%, baked into the provably-fair crash point.

Mainnet mint (reference): `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`
Devnet uses a test mint created by the setup script.

## Provably fair

Before each round the server sends `sha256(serverSeed)`. After the round it reveals `serverSeed`. Crash point = `(1 - edge) / (1 - r)` where `r` comes from `HMAC-SHA256(serverSeed, clientSeed:nonce)`. Spawn schedule derives from the same seeds, so the whole round is verifiable.

## Anti-bot (defense in depth)

Nothing is literally unbotable; this stack makes botting uneconomical:

1. **Server-authoritative everything** — crash point, spawn schedule, TTLs, and true target positions never leave the server. Clicks are validated server-side against real geometry and timing.
2. **Reaction-time statistics** — clicks faster than 130ms flag instantly; a median under 190ms or robot-like consistency (stddev < 18ms) over 8+ whacks flags too.
3. **Mouse-path telemetry** — humans draw noisy curves; bots teleport. Pathless clicking gets flagged.
4. **Replay protection** — each entry tx signature is single-use; wrong amounts/mint/destination are rejected on-chain-verified.
5. **Per-wallet cooldowns** and one active session per wallet.
6. **Visual hardening** — rotated/skewed letters, 5 shapes, 8 colors, shrinking sizes, and bomb decoys raise the cost of computer-vision bots.

Flagged sessions crash immediately (entry already burned/pooled — botting only donates to the pool and the burn).

## Quick start

```bash
npm install

# free-play dev mode (no wallet/tokens needed) — good for recording gameplay
npm run dev

# devnet launch
npm run setup:devnet                       # creates test mint + prize wallet + pool
node scripts/setup-devnet.js <YOUR_PHANTOM_ADDRESS>   # mints you 1,000 test $ANSEM
npm start                                  # http://localhost:3000 — Phantom set to Devnet
npm test                                   # unit tests
```

`config.json` and `.keys/` (prize wallet secret) are gitignored — never commit them.

## Architecture

```
public/index.html    single-file client: Phantom connect, atomic pay+burn tx, game UI
server/index.js      express + websocket session routing
server/game.js       round engine: multiplier, spawns, click validation, crash
server/fair.js       provably-fair crash point + round RNG
server/antibot.js    behavioral analysis + wallet gating
server/solana.js     entry-tx verification, payouts, pool/burn stats
scripts/setup-devnet.js  devnet mint/wallet bootstrap
```

## Mainnet notes (read before flipping the switch)

- Real-money games of chance are **regulated gambling** in most jurisdictions — get legal advice and licensing before mainnet.
- Move the prize wallet to a multisig; add rate limits, monitoring, and a payout queue.
- Run behind TLS with a hardened RPC provider.
