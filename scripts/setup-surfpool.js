// Surfpool launcher: runs against a local MAINNET FORK, so we use the REAL
// $ANSEM mint and conjure balances with surfnet cheatcodes. No devnet faucet pain.
//
// 1. Install surfpool:  brew install txtx/taps/surfpool   (or see surfpool.run)
// 2. Start the fork:    surfpool start        (RPC at http://127.0.0.1:8899)
// 3. Run this:          npm run setup:surfpool [YOUR_WALLET_ADDRESS]
// 4. Play:              npm start  →  http://localhost:3000

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddressSync } from "@solana/spl-token";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const KEYS_DIR = path.join(ROOT, ".keys");
const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const ANSEM_MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump"; // real mainnet mint
let TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"; // auto-detected from the mint (may be Token-2022)

const conn = new Connection(RPC, "confirmed");

async function cheat(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function giveTokens(owner, uiAmount, decimals) {
  await cheat("surfnet_setTokenAccount", [
    owner,
    ANSEM_MINT,
    { amount: Number(BigInt(uiAmount) * 10n ** BigInt(decimals)), state: "initialized" },
    TOKEN_PROGRAM
  ]);
}

async function main() {
  // sanity: is surfpool running?
  try { await conn.getLatestBlockhash(); }
  catch { console.error(`Can't reach ${RPC}. Start it first: surfpool start`); process.exit(1); }

  fs.mkdirSync(KEYS_DIR, { recursive: true });

  // 1. prize wallet
  const kpPath = path.join(KEYS_DIR, "prize-wallet.json");
  let prize;
  if (fs.existsSync(kpPath)) {
    prize = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf8"))));
    console.log("Using existing prize wallet:", prize.publicKey.toBase58());
  } else {
    prize = Keypair.generate();
    fs.writeFileSync(kpPath, JSON.stringify([...prize.secretKey]));
    console.log("Created prize wallet:", prize.publicKey.toBase58());
  }

  // 2. real mint metadata from the fork.
  // Surfpool lazy-fetches mainnet accounts through its datasource RPC — retry while it loads.
  // The mint's OWNER tells us which token program it uses (legacy SPL vs Token-2022);
  // $ANSEM is Token-2022, so we auto-detect instead of assuming.
  let acc = null;
  for (let i = 0; i < 6; i++) {
    acc = await conn.getAccountInfo(new PublicKey(ANSEM_MINT));
    if (acc) break;
    console.log(`Mint not loaded from mainnet yet — retrying in 3s… [${i + 1}/5]`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!acc) {
    console.error(`
❌ The fork can't load the real $ANSEM mint at all — surfpool's mainnet datasource RPC
   is failing/rate-limited. Restart surfpool with a solid mainnet RPC, e.g.:

     surfpool start --rpc-url "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"

   Then re-run: npm run setup:surfpool <YOUR_WALLET_ADDRESS>
`);
    process.exit(1);
  }
  TOKEN_PROGRAM = acc.owner.toBase58();
  const is2022 = TOKEN_PROGRAM.startsWith("Tokenz");
  const mintInfo = await getMint(conn, new PublicKey(ANSEM_MINT), "confirmed", acc.owner);
  const decimals = mintInfo.decimals;
  console.log(`Real $ANSEM mint loaded — ${is2022 ? "Token-2022" : "legacy SPL Token"}, decimals: ${decimals}, supply: ${mintInfo.supply}`);

  // 3. SOL for fees (surfpool airdrops freely on the fork)
  const sig = await conn.requestAirdrop(prize.publicKey, 10 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  console.log("Airdropped 10 SOL to prize wallet");

  // 4. seed the prize pool with 500 real $ANSEM (cheatcode — creates the ATA too)
  await giveTokens(prize.publicKey.toBase58(), 500, decimals);
  const poolAta = getAssociatedTokenAddressSync(new PublicKey(ANSEM_MINT), prize.publicKey, false, acc.owner);
  console.log("Prize pool ATA seeded with 500 $ANSEM:", poolAta.toBase58());

  // 5. fund a player wallet, if provided
  const player = process.argv[2];
  if (player) {
    await giveTokens(player, 1000, decimals);
    const psig = await conn.requestAirdrop(new PublicKey(player), 5 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(psig, "confirmed");
    console.log(`Player ${player}: 1,000 $ANSEM + 5 SOL`);
  }

  // 6. config
  const config = {
    cluster: "surfnet",
    rpcUrl: RPC,
    mint: ANSEM_MINT,
    tokenProgram: TOKEN_PROGRAM,
    decimals,
    prizeWalletKeypairPath: kpPath,
    devMode: false,
    port: 3000
  };
  fs.writeFileSync(path.join(ROOT, "config.json"), JSON.stringify(config, null, 2));
  console.log("\n✅ Surfpool ready — REAL $ANSEM mint on a local mainnet fork. config.json written.");
  console.log("Run: npm start  →  http://localhost:3000");
  console.log("In-app FAUCET button gives any connected wallet test tokens.");
  if (!player) console.log("Or: npm run setup:surfpool <YOUR_WALLET_ADDRESS>");
}

main().catch((e) => { console.error(e); process.exit(1); });
