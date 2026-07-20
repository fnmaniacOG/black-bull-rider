import crypto from "crypto";

// Provably fair crash point.
// Before the round: server sends sha256(serverSeed) as a commitment.
// After the round: server reveals serverSeed; anyone can recompute the crash point.
// crash = (1 - houseEdge) / (1 - r), r uniform in [0,1) from HMAC(serverSeed, clientSeed:nonce).
// P(instant crash at 1.00x) == houseEdge.

export function newServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

export function commitment(serverSeed) {
  return crypto.createHash("sha256").update(serverSeed).digest("hex");
}

export function crashPoint(serverSeed, clientSeed, nonce, houseEdge, maxMultiplier = 50, minCrash = 1.0) {
  const hmac = crypto
    .createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest("hex");
  // 52 bits of the hmac -> uniform r in [0,1)
  const r = parseInt(hmac.slice(0, 13), 16) / 2 ** 52;
  const raw = (1 - houseEdge) / (1 - r);
  const point = Math.max(minCrash, Math.floor(raw * 100) / 100);
  return Math.min(point, maxMultiplier);
}

// Deterministic per-round RNG for spawn schedule (also derivable from the seeds,
// so even spawn timing/placement is verifiable after the reveal).
export function roundRng(serverSeed, clientSeed, nonce) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  return function rand() {
    if (pool.length < 4) {
      pool = crypto
        .createHmac("sha256", serverSeed)
        .update(`${clientSeed}:${nonce}:rng:${counter++}`)
        .digest();
    }
    const v = pool.readUInt32BE(0) / 2 ** 32;
    pool = pool.subarray(4);
    return v;
  };
}
