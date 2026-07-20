import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Runtime config lives in config.json (created by scripts/setup-devnet.js).
// Never commit config.json or .keys/ — they hold the devnet prize wallet key path & mint.
let fileCfg = {};
const cfgPath = path.join(ROOT, "config.json");
if (fs.existsSync(cfgPath)) {
  fileCfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

export const CONFIG = {
  // --- chain ---
  rpcUrl: process.env.RPC_URL || fileCfg.rpcUrl || "https://api.devnet.solana.com",
  cluster: process.env.CLUSTER || fileCfg.cluster || "devnet",
  // Mainnet $ANSEM mint (for reference / mainnet launch): 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump
  mint: process.env.MINT || fileCfg.mint || null,
  // legacy SPL Token by default; Token-2022 mints (like real $ANSEM) auto-detected by setup scripts
  tokenProgram: process.env.TOKEN_PROGRAM || fileCfg.tokenProgram || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  decimals: Number(process.env.DECIMALS ?? fileCfg.decimals ?? 6),
  prizeWalletKeypairPath:
    process.env.PRIZE_WALLET_KEYPAIR || fileCfg.prizeWalletKeypairPath || path.join(ROOT, ".keys", "prize-wallet.json"),
  // for cloud hosts (Render etc.): the secret key as a JSON array env var, instead of a file
  prizeWalletSecret: process.env.PRIZE_WALLET_SECRET || null,

  // --- economics (base units computed from decimals at runtime) ---
  entryFeeTokens: 2,        // total entry fee in whole tokens
  // half goes to prize pool, half is burned — enforced when verifying the entry tx
  payoutBaseTokens: 1,      // payout = payoutBaseTokens * multiplier
  houseEdge: 0.04,          // 4% edge baked into crash point distribution
  minCrashPoint: 1.5,       // crash point floor — guarantees ~4.7s of gameplay every round
                            // (house edge comes mostly from skill failures: misses & bombs)
  maxPayoutPoolFraction: 0.25, // single payout can never exceed 25% of pool balance

  // --- game feel ---
  tickMs: 100,                    // multiplier tick rate
  multiplierDoubleEverySec: 8,    // m(t) = 2^(t/8)
  maxMultiplier: 50,
  spawn: {
    firstSpawnMs: [600, 1100],    // first letter appears fast — gameplay before any crash
    startDelayMs: [1500, 2400],   // spawn interval range at 1.00x
    endDelayMs: [520, 900],       // spawn interval range at high multiplier
    startTtlMs: 1900,             // time allowed to whack, at 1.00x
    endTtlMs: 650,                // at high multiplier
    hardnessAtMultiplier: 8,      // multiplier at which difficulty is maxed
    decoyChance: 0.14,            // bombs — click one and you crash (starts after 1.5x)
    doubleSpawnAfter: 3.0         // above this multiplier, sometimes 2 letters at once
  },

  // --- anti-bot ---
  antibot: {
    minReactionMs: 130,       // faster than human = instant flag
    medianReactionFloorMs: 190,
    stdDevFloorMs: 18,        // humans are noisy; robots are not
    minSamplesForStats: 8,
    maxPathlessRatio: 0.6,    // whacks with zero mouse-path movement
    walletCooldownMs: 3000,
    txMaxAgeSec: 180          // entry tx must be recent
  },

  devMode: process.env.DEV_MODE === "1" || fileCfg.devMode === true,
  port: Number(process.env.PORT || fileCfg.port || 3000)
};

export function entryFeeBaseUnits() {
  return BigInt(CONFIG.entryFeeTokens) * 10n ** BigInt(CONFIG.decimals);
}
export function halfFeeBaseUnits() {
  return entryFeeBaseUnits() / 2n;
}
