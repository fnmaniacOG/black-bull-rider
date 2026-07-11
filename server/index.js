import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { CONFIG } from "./config.js";
import { Round } from "./game.js";
import { initSolana, verifyEntryTx, payout, publicInfo, stats } from "./solana.js";
import { canStart, markStart, markEnd } from "./antibot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/config", (_req, res) => res.json(publicInfo()));
app.get("/api/stats", async (_req, res) => res.json(await stats()));

initSolana();

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const nonces = new Map(); // wallet -> round counter

wss.on("connection", (ws) => {
  let wallet = null;
  let round = null;
  const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    try {
      switch (msg.type) {
        case "hello": {
          wallet = String(msg.wallet || "").slice(0, 64);
          ws._arena = sanitizeArena(msg.arena);
          send({ type: "config", ...publicInfo() });
          break;
        }

        case "start": {
          if (!wallet) return send({ type: "error", reason: "no_hello" });
          if (round && round.state === "running") return send({ type: "error", reason: "round_in_progress" });

          const gate = canStart(wallet, CONFIG.antibot.walletCooldownMs);
          if (!gate.ok) return send({ type: "error", reason: gate.reason });

          const v = await verifyEntryTx(String(msg.signature || ""), wallet);
          if (!v.ok) return send({ type: "error", reason: `entry_rejected:${v.reason}` });

          const nonce = (nonces.get(wallet) || 0) + 1;
          nonces.set(wallet, nonce);
          markStart(wallet);

          round = new Round({
            send,
            cfg: CONFIG,
            clientSeed: String(msg.clientSeed || "bullish").slice(0, 64),
            nonce,
            arena: ws._arena,
            onEnd: async (kind, r) => {
              markEnd(wallet);
              if (kind === "cashed_out") {
                const m = r.endInfo.multiplier;
                const tokens = Math.floor(CONFIG.payoutBaseTokens * m * 100) / 100;
                const p = await payout(wallet, tokens).catch((e) => ({ ok: false, reason: e.message }));
                send({
                  type: "cashed_out",
                  m,
                  tokens,
                  payout: p,
                  serverSeed: r.serverSeed,
                  crashPoint: r.crashAt
                });
              }
            }
          });

          send({ type: "round_ready", commit: round.commit, nonce, countdownMs: 1200 });
          setTimeout(() => round.start(), 1200);
          break;
        }

        case "whack":
          round?.handleWhack({
            id: String(msg.id || ""),
            x: Number(msg.x),
            y: Number(msg.y),
            path: Array.isArray(msg.path) ? msg.path.slice(0, 80) : []
          });
          break;

        case "cashout":
          round?.handleCashout();
          break;
      }
    } catch (e) {
      console.error("[ws]", e);
      send({ type: "error", reason: "server_error" });
    }
  });

  ws.on("close", () => {
    if (round && round.state === "running") round.crash("disconnected");
    if (wallet) markEnd(wallet);
  });
});

function sanitizeArena(a) {
  const w = Math.max(320, Math.min(4000, Number(a?.w) || 800));
  const h = Math.max(240, Math.min(3000, Number(a?.h) || 500));
  return { w, h };
}

server.listen(CONFIG.port, () => {
  console.log(`🐂 Black Bull Rider on http://localhost:${CONFIG.port} ${CONFIG.devMode ? "(DEV_MODE — free play)" : ""}`);
});
