import crypto from "crypto";
import { newServerSeed, commitment, crashPoint, roundRng } from "./fair.js";
import { BehaviorMonitor } from "./antibot.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPES = ["circle", "square", "hex", "diamond", "star"];
const COLORS = ["#ff5252", "#ffb300", "#00e676", "#40c4ff", "#e040fb", "#ffee58", "#ff6e40", "#69f0ae"];
const LATENCY_GRACE_MS = 250;
const CLICK_RADIUS_GRACE_PX = 45;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Round {
  /**
   * @param {object} o
   * @param {(msg: object) => void} o.send        push a message to the client
   * @param {(reason: string, round: Round) => void} o.onEnd
   * @param {object} o.cfg                        CONFIG
   * @param {string} o.clientSeed
   * @param {number} o.nonce
   * @param {{w:number,h:number}} o.arena         client arena size in px
   */
  constructor({ send, onEnd, cfg, clientSeed, nonce, arena }) {
    this.send = send;
    this.onEnd = onEnd;
    this.cfg = cfg;
    this.clientSeed = clientSeed || "bullish";
    this.nonce = nonce;
    this.arena = arena || { w: 800, h: 500 };

    this.serverSeed = newServerSeed();
    this.commit = commitment(this.serverSeed);
    this.crashAt = crashPoint(this.serverSeed, this.clientSeed, this.nonce, cfg.houseEdge, cfg.maxMultiplier, cfg.minCrashPoint ?? 1.0);
    this.rng = roundRng(this.serverSeed, this.clientSeed, this.nonce);

    this.state = "ready"; // ready -> running -> ended
    this.targets = new Map(); // id -> target
    this.monitor = new BehaviorMonitor(cfg.antibot);
    this.timers = new Set();
    this.endInfo = null;
  }

  // ---- lifecycle ----

  start() {
    if (this.state !== "ready") return;
    this.state = "running";
    this.startedAt = Date.now();
    this.send({ type: "started", at: this.startedAt });

    this.tickTimer = setInterval(() => {
      const m = this.multiplier();
      if (m >= this.crashAt) return this.crash("crash_point");
      this.send({ type: "tick", m: round2(m) });
    }, this.cfg.tickMs);

    // first letter comes fast so there's always gameplay before any crash
    const f = this.cfg.spawn.firstSpawnMs || [600, 1100];
    this.scheduleSpawn(lerp(f[0], f[1], this.rng()));
  }

  multiplier(now = Date.now()) {
    const t = (now - this.startedAt) / 1000;
    return Math.min(2 ** (t / this.cfg.multiplierDoubleEverySec), this.cfg.maxMultiplier);
  }

  difficulty() {
    // 0 at 1.00x -> 1 at hardnessAtMultiplier
    return clamp01((this.multiplier() - 1) / (this.cfg.spawn.hardnessAtMultiplier - 1));
  }

  // ---- spawning ----

  scheduleSpawn(delayOverride = null) {
    if (this.state !== "running") return;
    const s = this.cfg.spawn;
    const d = this.difficulty();
    const delay = delayOverride ?? lerp(
      lerp(s.startDelayMs[0], s.endDelayMs[0], d),
      lerp(s.startDelayMs[1], s.endDelayMs[1], d),
      this.rng()
    );
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.state !== "running") return;
      this.spawnOne();
      if (this.multiplier() > s.doubleSpawnAfter && this.rng() < 0.35) this.spawnOne();
      this.scheduleSpawn();
    }, delay);
    this.timers.add(t);
  }

  spawnOne() {
    const s = this.cfg.spawn;
    const d = this.difficulty();
    const isDecoy = this.multiplier() > 1.5 && this.rng() < s.decoyChance;
    const ttl = Math.round(lerp(s.startTtlMs, s.endTtlMs, d));
    const target = {
      id: crypto.randomBytes(6).toString("hex"),
      letter: LETTERS[Math.floor(this.rng() * 26)],
      shape: SHAPES[Math.floor(this.rng() * SHAPES.length)],
      color: COLORS[Math.floor(this.rng() * COLORS.length)],
      size: Math.round(lerp(110, 48, d) * (0.8 + this.rng() * 0.4)), // px, shrinks as it gets harder
      x: 0.08 + this.rng() * 0.84, // normalized center
      y: 0.12 + this.rng() * 0.76,
      rot: Math.round((this.rng() - 0.5) * 50), // degrees
      isDecoy,
      ttl,
      spawnedAt: Date.now(),
      whacked: false
    };
    this.targets.set(target.id, target);
    this.send({ type: "spawn", target: publicTarget(target) });

    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.state !== "running") return;
      const tg = this.targets.get(target.id);
      if (!tg || tg.whacked) return;
      this.targets.delete(target.id);
      if (tg.isDecoy) {
        this.send({ type: "despawn", id: tg.id }); // bombs fizzle out harmlessly
      } else {
        this.crash("missed_letter"); // real letter expired -> bucked off
      }
    }, ttl + LATENCY_GRACE_MS + 20);
    this.timers.add(t);
  }

  // ---- input ----

  // Click anywhere in the arena — the SERVER decides what was hit, using true
  // target geometry. (CSS clip-path shapes have deceptive hit areas client-side.)
  handleClick({ x, y, path }) {
    if (this.state !== "running") return;
    const now = Date.now();
    let best = null;
    let bestDist = Infinity;
    for (const tg of this.targets.values()) {
      if (tg.whacked || now > tg.spawnedAt + tg.ttl + LATENCY_GRACE_MS) continue;
      const dist = Math.hypot((x ?? -1e4) - tg.x * this.arena.w, (y ?? -1e4) - tg.y * this.arena.h);
      if (dist <= tg.size / 2 + CLICK_RADIUS_GRACE_PX && dist < bestDist) {
        best = tg;
        bestDist = dist;
      }
    }
    if (!best) return this.send({ type: "miss", x, y }); // swung and hit air
    this.registerHit(best, now, path, false);
  }

  // Typing the letter is an alternative to clicking (bombs show 💣, so keys can't hit them)
  handleKey({ letter, path }) {
    if (this.state !== "running" || typeof letter !== "string") return;
    const now = Date.now();
    const L = letter.toUpperCase();
    for (const tg of this.targets.values()) {
      if (!tg.isDecoy && !tg.whacked && tg.letter === L && now <= tg.spawnedAt + tg.ttl + LATENCY_GRACE_MS) {
        return this.registerHit(tg, now, path, true);
      }
    }
  }

  registerHit(tg, now, path, viaKey) {
    if (tg.isDecoy) {
      tg.whacked = true;
      return this.crash("hit_bomb");
    }
    const reactionMs = now - tg.spawnedAt;
    const humanOk = this.monitor.recordWhack({ reactionMs, path, viaKey });
    tg.whacked = true;
    this.targets.delete(tg.id);
    this.send({ type: "whacked", id: tg.id, reactionMs });
    if (!humanOk) return this.crash("bot_flagged");
  }

  handleCashout() {
    if (this.state !== "running") return null;
    if (this.monitor.flagged) {
      this.crash("bot_flagged");
      return null;
    }
    const m = round2(this.multiplier());
    this.end("cashed_out", m);
    return m;
  }

  // ---- endings ----

  crash(reason) {
    if (this.state === "ended") return;
    const m = round2(this.multiplier());
    this.end("crashed", m, reason);
    this.send({
      type: "crashed",
      reason,
      m,
      crashPoint: reason === "crash_point" ? this.crashAt : round2(this.crashAt),
      serverSeed: this.serverSeed, // reveal — verify sha256(serverSeed) === commit
      flags: this.monitor.flags
    });
  }

  end(kind, multiplier, reason = null) {
    this.state = "ended";
    clearInterval(this.tickTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.endInfo = { kind, multiplier, reason };
    this.onEnd?.(kind, this);
  }
}

function publicTarget(t) {
  // never leak isDecoy truthfully? — we DO tell the client it's a bomb so it can
  // render it as one (humans must read & avoid it). The skill is perception.
  const { spawnedAt, whacked, ...pub } = t;
  return pub;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
