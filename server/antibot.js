// Behavioral anti-bot. Nothing is 100% unbotable — this is defense in depth:
//  1. All game state lives server-side (crash point, spawn schedule, TTLs).
//     A bot can't precompute anything; it must perceive and react like a human.
//  2. Reaction-time statistics: sub-human speed or robot-like consistency = flag.
//  3. Mouse-path telemetry: bots teleport the cursor; humans draw noisy curves.
//  4. Per-wallet cooldowns + entry-tx replay protection (see solana.js).
//  5. Letters are rendered rotated/skewed with decoys, raising the bar for pixel bots.
// A flagged session is crashed immediately (player loses only the entry fee).

export class BehaviorMonitor {
  constructor(cfg) {
    this.cfg = cfg;
    this.reactions = [];   // ms between spawn and whack
    this.pathless = 0;     // whacks with no meaningful mouse path
    this.total = 0;
    this.flags = [];
  }

  recordWhack({ reactionMs, path, viaKey = false }) {
    this.reactions.push(reactionMs);

    if (reactionMs < this.cfg.minReactionMs) {
      this.flags.push(`subhuman_reaction:${reactionMs}ms`);
    }

    // mouse-path telemetry only applies to clicks — key hits have no cursor path
    if (!viaKey) {
      this.total++;
      const moved = Array.isArray(path) && pathDistance(path) > 30;
      if (!moved) this.pathless++;
    }

    if (this.reactions.length >= this.cfg.minSamplesForStats) {
      const med = median(this.reactions);
      const sd = stdDev(this.reactions);
      if (med < this.cfg.medianReactionFloorMs) this.flags.push(`median_reaction:${med.toFixed(0)}ms`);
      if (sd < this.cfg.stdDevFloorMs) this.flags.push(`robotic_consistency:sd=${sd.toFixed(1)}ms`);
      if (this.total >= this.cfg.minSamplesForStats && this.pathless / this.total > this.cfg.maxPathlessRatio) {
        this.flags.push("teleporting_cursor");
      }
    }
    return this.flags.length === 0;
  }

  get flagged() {
    return this.flags.length > 0;
  }
}

export function pathDistance(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < Math.min(path.length, 60); i++) {
    const dx = (path[i].x ?? 0) - (path[i - 1].x ?? 0);
    const dy = (path[i].y ?? 0) - (path[i - 1].y ?? 0);
    d += Math.hypot(dx, dy);
  }
  return d;
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdDev(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

// Per-wallet cooldown / single-session registry
const lastPlay = new Map();
const activeWallets = new Set();

export function canStart(wallet, cooldownMs) {
  if (activeWallets.has(wallet)) return { ok: false, reason: "session_already_active" };
  const last = lastPlay.get(wallet) || 0;
  if (Date.now() - last < cooldownMs) return { ok: false, reason: "cooldown" };
  return { ok: true };
}
export function markStart(wallet) {
  activeWallets.add(wallet);
  lastPlay.set(wallet, Date.now());
}
export function markEnd(wallet) {
  activeWallets.delete(wallet);
}
