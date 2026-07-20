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

# RECOMMENDED: surfpool — local mainnet fork, REAL $ANSEM mint, no faucet pain
# install: brew install txtx/taps/surfpool   (surfpool.run)
surfpool start                                        # terminal 1: mainnet fork on :8899
npm run setup:surfpool <YOUR_WALLET_ADDRESS>          # terminal 2: seeds pool + your wallet
npm start                                             # http://localhost:3000
# in-app 🚰 FAUCET button tops up any connected wallet (surfnet only)
# note: the wallet signs, the app broadcasts to the fork — a "can't simulate" warning is expected

# alternative: devnet (test mint, faucet rate limits apply)
npm run setup:devnet
node scripts/setup-devnet.js <YOUR_PHANTOM_ADDRESS>   # mints you 1,000 test $ANSEM
npm start                                             # Phantom set to Devnet

npm test                                              # unit tests
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
scripts/setup-surfpool.js  surfpool bootstrap: real mint on a local mainnet fork (cheatcode funding)
scripts/setup-devnet.js    devnet bootstrap: test mint + faucet airdrops
```

## Public devnet demo (share a link anyone can play)

GitHub Pages can't host this — it only serves static files, and the game needs the Node
backend. Deploy the whole app (one service) to Render's free tier instead:

1. Locally: `RPC_URL="https://devnet.helius-rpc.com/?api-key=KEY" npm run setup:devnet`
   (get a free key at helius.dev — the public devnet RPC rate-limits hard) → note the
   test mint address in `config.json`. If the SOL airdrop fails, fund the prize wallet
   at faucet.solana.com and re-run.
2. Push this repo to GitHub. On [render.com](https://render.com): New → Blueprint → pick the repo
   (`render.yaml` configures everything).
3. Set the two secrets when prompted: `MINT` (test mint address) and `PRIZE_WALLET_SECRET`
   (paste the JSON array from `.keys/prize-wallet.json`).
4. Deploy → share `https://<your-app>.onrender.com`.

Visitors: install Phantom → Settings → Developer Settings → enable Testnet Mode (Devnet)
→ click 🚰 FAUCET in the game (mints 100 test $ANSEM + 0.01 SOL, 60s cooldown) → ride.

Keep the prize wallet topped up with devnet SOL for faucet/payout fees:
`solana airdrop 2 <PRIZE_WALLET> --url devnet`.

## Mainnet notes (read before flipping the switch)

- Real-money games of chance are **regulated gambling** in most jurisdictions — get legal advice and licensing before mainnet.
- Move the prize wallet to a multisig; add rate limits, monitoring, and a payout queue.
- Run behind TLS with a hardened RPC provider.
