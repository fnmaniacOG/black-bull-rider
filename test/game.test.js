import { test } from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import { newServerSeed, commitment, crashPoint, roundRng } from "../server/fair.js";
import { BehaviorMonitor, median, stdDev, pathDistance } from "../server/antibot.js";
import { Round } from "../server/game.js";
import { CONFIG } from "../server/config.js";

// ---------- provably fair ----------

test("commitment verifies against revealed seed", () => {
  const seed = newServerSeed();
  assert.equal(commitment(seed), crypto.createHash("sha256").update(seed).digest("hex"));
});

test("crash point is deterministic for same seeds/nonce", () => {
  const seed = newServerSeed();
  assert.equal(crashPoint(seed, "abc", 1, 0.04), crashPoint(seed, "abc", 1, 0.04));
  assert.notEqual(crashPoint(seed, "abc", 1, 0.04), crashPoint(seed, "abc", 2, 0.04));
});

test("crash point distribution: min 1.00, house edge ≈ instant-crash rate", () => {
  const seed = newServerSeed();
  let instant = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const c = crashPoint(seed, "dist", i, 0.04);
    assert.ok(c >= 1.0 && c <= CONFIG.maxMultiplier);
    if (c === 1.0) instant++;
  }
  const rate = instant / N;
  assert.ok(rate > 0.02 && rate < 0.07, `instant crash rate ${rate} should be ~0.04`);
});

test("round rng is deterministic and uniform-ish", () => {
  const seed = newServerSeed();
  const a = roundRng(seed, "x", 1), b = roundRng(seed, "x", 1);
  const va = [a(), a(), a()], vb = [b(), b(), b()];
  assert.deepEqual(va, vb);
  const r = roundRng(seed, "y", 2);
  let sum = 0; for (let i = 0; i < 5000; i++) sum += r();
  assert.ok(Math.abs(sum / 5000 - 0.5) < 0.03);
});

// ---------- anti-bot ----------

test("median & stdDev helpers", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(stdDev([5, 5, 5]) === 0);
});

test("subhuman reaction time flags immediately", () => {
  const m = new BehaviorMonitor(CONFIG.antibot);
  const ok = m.recordWhack({ reactionMs: 40, path: fakePath(300) });
  assert.equal(ok, false);
  assert.match(m.flags[0], /subhuman/);
});

test("robotic consistency flags after enough samples", () => {
  const m = new BehaviorMonitor(CONFIG.antibot);
  for (let i = 0; i < 10; i++) m.recordWhack({ reactionMs: 250, path: fakePath(300) }); // sd = 0
  assert.ok(m.flagged);
  assert.ok(m.flags.some((f) => f.includes("robotic_consistency")));
});

test("human-like play does NOT flag", () => {
  const m = new BehaviorMonitor(CONFIG.antibot);
  const rts = [310, 420, 275, 505, 360, 445, 290, 380, 520, 335];
  for (const rt of rts) assert.equal(m.recordWhack({ reactionMs: rt, path: fakePath(200 + Math.random() * 200) }), true);
  assert.equal(m.flagged, false);
});

test("teleporting cursor flags", () => {
  const m = new BehaviorMonitor(CONFIG.antibot);
  const rts = [310, 420, 275, 505, 360, 445, 290, 380];
  for (const rt of rts) m.recordWhack({ reactionMs: rt, path: [] }); // no mouse movement at all
  assert.ok(m.flags.includes("teleporting_cursor"));
});

function fakePath(totalDist) {
  const pts = [{ x: 100, y: 100 }];
  let d = 0;
  while (d < totalDist) {
    const last = pts[pts.length - 1];
    const step = 10 + Math.random() * 20;
    pts.push({ x: last.x + step * (Math.random() - 0.3), y: last.y + step * (Math.random() - 0.3) });
    d += step;
  }
  assert.ok(pathDistance(pts) > 30);
  return pts;
}

// ---------- round mechanics ----------

function makeRound(msgs = []) {
  return new Round({
    send: (m) => msgs.push(m),
    onEnd: () => {},
    cfg: CONFIG,
    clientSeed: "test",
    nonce: 1,
    arena: { w: 800, h: 500 }
  });
}

test("round exposes commit before start, crash reveals matching seed", () => {
  const msgs = [];
  const r = makeRound(msgs);
  assert.equal(commitment(r.serverSeed), r.commit);
  r.start();
  r.crash("missed_letter");
  const crashed = msgs.find((m) => m.type === "crashed");
  assert.ok(crashed);
  assert.equal(commitment(crashed.serverSeed), r.commit);
  assert.equal(r.state, "ended");
});

test("whack on decoy crashes; whack outside target radius is ignored", () => {
  const msgs = [];
  const r = makeRound(msgs);
  r.start();
  // inject a known decoy
  r.targets.set("d1", { id: "d1", isDecoy: true, x: 0.5, y: 0.5, size: 80, ttl: 5000, spawnedAt: Date.now(), whacked: false });
  // click far away -> ignored
  r.handleWhack({ id: "d1", x: 10, y: 10, path: [] });
  assert.equal(r.state, "running");
  // click on it -> crash
  r.handleWhack({ id: "d1", x: 400, y: 250, path: [] });
  assert.equal(r.state, "ended");
  assert.equal(msgs.find((m) => m.type === "crashed").reason, "hit_bomb");
});

test("valid whack succeeds; late whack ignored", async () => {
  const msgs = [];
  const r = makeRound(msgs);
  r.start();
  const now = Date.now();
  r.targets.set("t1", { id: "t1", isDecoy: false, x: 0.5, y: 0.5, size: 80, ttl: 1000, spawnedAt: now - 300, whacked: false });
  r.targets.set("t2", { id: "t2", isDecoy: false, x: 0.5, y: 0.5, size: 80, ttl: 100, spawnedAt: now - 5000, whacked: false });
  r.handleWhack({ id: "t2", x: 400, y: 250, path: fakePath(100) }); // expired
  assert.ok(!msgs.some((m) => m.type === "whacked"));
  r.handleWhack({ id: "t1", x: 405, y: 245, path: fakePath(100) });
  assert.ok(msgs.some((m) => m.type === "whacked" && m.id === "t1"));
  r.crash("test_cleanup");
});

test("cashout returns multiplier and ends round; flagged player cannot cash out", () => {
  const r1 = makeRound();
  r1.start();
  const m = r1.handleCashout();
  assert.ok(m >= 1.0);
  assert.equal(r1.state, "ended");
  assert.equal(r1.endInfo.kind, "cashed_out");

  const r2 = makeRound();
  r2.start();
  r2.monitor.flags.push("subhuman_reaction:40ms");
  assert.equal(r2.handleCashout(), null);
  assert.equal(r2.endInfo.kind, "crashed");
});

test("multiplier follows 2^(t/8) curve", () => {
  const r = makeRound();
  r.start();
  r.startedAt = Date.now() - 8000; // pretend 8s elapsed
  const m = r.multiplier();
  assert.ok(Math.abs(m - 2) < 0.05, `expected ~2x got ${m}`);
  r.crash("test_cleanup");
});
