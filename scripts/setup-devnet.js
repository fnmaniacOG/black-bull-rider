// Devnet launcher: creates a test $ANSEM mint, prize wallet + pool ATA,
// funds everything, and writes config.json for the server.
// Usage: node scripts/setup-devnet.js [PLAYER_WALLET_ADDRESS]
//   If a player address is given, 1,000 test $ANSEM are minted to it so you can play.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const KEYS_DIR = path.join(ROOT, ".keys");
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const DECIMALS = 6;

const conn = new Connection(RPC, "confirmed");

async function main() {
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  // 1. prize wallet (also mint authority for the TEST token)
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

  // 2. airdrop devnet SOL for fees (devnet faucet is rate-limited; retry if it fails)
  const bal = await conn.getBalance(prize.publicKey);
  if (bal < 0.5 * LAMPORTS_PER_SOL) {
    console.log("Requesting devnet SOL airdrop…");
    try {
      const sig = await conn.requestAirdrop(prize.publicKey, 2 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
      console.log("Airdropped 2 SOL");
    } catch (e) {
      console.warn("Airdrop failed (faucet rate limit?). Fund manually: solana airdrop 2", prize.publicKey.toBase58(), "--url devnet");
    }
  }

  // 2.5 hard requirement: fees. If the faucet airdrop failed, stop with clear instructions.
  const solBal = await conn.getBalance(prize.publicKey);
  if (solBal < 0.05 * LAMPORTS_PER_SOL) {
    console.error(`
❌ Prize wallet has no devnet SOL (${solBal / LAMPORTS_PER_SOL} SOL) and the CLI airdrop is rate-limited.
   Fund it via the web faucet (sign in with GitHub for higher limits):

     https://faucet.solana.com  →  paste: ${prize.publicKey.toBase58()}

   Then re-run this script.
`);
    process.exit(1);
  }

  // 3. test $ANSEM mint (mainnet real mint: 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump)
  // Only reuse a saved mint if it came from a DEVNET config AND actually exists on this
  // cluster — a leftover surfpool config points at the mainnet mint, which devnet lacks.
  const cfgPath = path.join(ROOT, "config.json");
  let mint = null;
  const existing = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  if (existing.mint && existing.cluster === "devnet") {
    const acc = await conn.getAccountInfo(new PublicKey(existing.mint));
    if (acc) {
      mint = new PublicKey(existing.mint);
      console.log("Using existing devnet test mint:", mint.toBase58());
    }
  }
  if (!mint) {
    mint = await createMint(conn, prize, prize.publicKey, null, DECIMALS);
    console.log("Created test $ANSEM mint:", mint.toBase58());
  }

  // 4. prize pool ATA, seeded with 500 tokens so early winners can be paid
  const poolAta = await getOrCreateAssociatedTokenAccount(conn, prize, mint, prize.publicKey);
  const poolBal = Number(poolAta.amount) / 10 ** DECIMALS;
  if (poolBal < 100) {
    await mintTo(conn, prize, mint, poolAta.address, prize, 500n * 10n ** BigInt(DECIMALS));
    console.log("Seeded prize pool with 500 test $ANSEM");
  }

  // 5. optionally fund a player wallet for testing
  const player = process.argv[2];
  if (player) {
    const playerAta = await getOrCreateAssociatedTokenAccount(conn, prize, mint, new PublicKey(player));
    await mintTo(conn, prize, mint, playerAta.address, prize, 1000n * 10n ** BigInt(DECIMALS));
    console.log(`Minted 1,000 test $ANSEM to player ${player}`);
  }

  // 6. write config
  const config = {
    cluster: "devnet",
    rpcUrl: RPC,
    mint: mint.toBase58(),
    decimals: DECIMALS,
    prizeWalletKeypairPath: kpPath,
    devMode: false,
    port: 3000
  };
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
  console.log("\n✅ Devnet ready. config.json written.");
  console.log("   Prize wallet:", prize.publicKey.toBase58());
  console.log("   Pool ATA:   ", poolAta.address.toBase58());
  console.log("   Test mint:  ", mint.toBase58());
  console.log("\nRun: npm start  →  http://localhost:3000  (set Phantom to Devnet)");
  if (!player) console.log("Tip: node scripts/setup-devnet.js <YOUR_PHANTOM_ADDRESS> to get test tokens.");
}

main().catch((e) => { console.error(e); process.exit(1); });
