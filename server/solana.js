import fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction
} from "@solana/spl-token";
import { CONFIG, halfFeeBaseUnits } from "./config.js";

let connection = null;
let prizeKeypair = null;
let mintPk = null;
let prizeAta = null;

const usedEntrySigs = new Set(); // replay protection
let totalBurnedBaseUnits = 0n;   // observed via verified entries

export function initSolana() {
  if (CONFIG.devMode && !CONFIG.mint) {
    console.log("[solana] DEV_MODE without mint — chain checks disabled (free play).");
    return { chainEnabled: false };
  }
  if (!CONFIG.mint) throw new Error("No mint configured. Run `npm run setup:devnet` first.");
  connection = new Connection(CONFIG.rpcUrl, "confirmed");
  mintPk = new PublicKey(CONFIG.mint);
  prizeKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(CONFIG.prizeWalletKeypairPath, "utf8")))
  );
  prizeAta = getAssociatedTokenAddressSync(mintPk, prizeKeypair.publicKey);
  console.log(`[solana] cluster=${CONFIG.cluster} mint=${CONFIG.mint}`);
  console.log(`[solana] prize wallet=${prizeKeypair.publicKey.toBase58()} ata=${prizeAta.toBase58()}`);
  return { chainEnabled: true };
}

export function publicInfo() {
  return {
    cluster: CONFIG.cluster,
    rpcUrl: CONFIG.rpcUrl,
    mint: CONFIG.mint,
    decimals: CONFIG.decimals,
    entryFeeTokens: CONFIG.entryFeeTokens,
    payoutBaseTokens: CONFIG.payoutBaseTokens,
    prizeWallet: prizeKeypair ? prizeKeypair.publicKey.toBase58() : null,
    prizeAta: prizeAta ? prizeAta.toBase58() : null,
    devMode: CONFIG.devMode
  };
}

/**
 * Verify the entry transaction on-chain. It must contain, from the player, in one atomic tx:
 *   1. transfer(Checked) of exactly half the entry fee to the prize pool ATA
 *   2. burn(Checked) of exactly half the entry fee
 * Plus: confirmed success, recent, never used before.
 */
export async function verifyEntryTx(signature, playerWallet) {
  if (CONFIG.devMode) return { ok: true, devMode: true };
  if (usedEntrySigs.has(signature)) return { ok: false, reason: "signature_already_used" };

  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed"
  });
  if (!tx) return { ok: false, reason: "tx_not_found" };
  if (tx.meta?.err) return { ok: false, reason: "tx_failed" };
  if (!tx.blockTime || Date.now() / 1000 - tx.blockTime > CONFIG.antibot.txMaxAgeSec) {
    return { ok: false, reason: "tx_too_old" };
  }

  const half = halfFeeBaseUnits();
  let paidToPool = false;
  let burned = false;

  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions?.flatMap((i) => i.instructions) ?? [])
  ];

  for (const ix of instructions) {
    const p = ix.parsed;
    if (!p || !p.info) continue;
    const amt = BigInt(p.info.tokenAmount?.amount ?? p.info.amount ?? 0);
    const auth = p.info.authority ?? p.info.multisigAuthority;

    if ((p.type === "transferChecked" || p.type === "transfer") &&
        p.info.destination === prizeAta.toBase58() &&
        auth === playerWallet &&
        amt === half &&
        (p.type === "transfer" || p.info.mint === CONFIG.mint)) {
      paidToPool = true;
    }
    if ((p.type === "burnChecked" || p.type === "burn") &&
        p.info.mint === CONFIG.mint &&
        auth === playerWallet &&
        amt === half) {
      burned = true;
    }
  }

  if (!paidToPool) return { ok: false, reason: "pool_payment_missing_or_wrong_amount" };
  if (!burned) return { ok: false, reason: "burn_missing_or_wrong_amount" };

  usedEntrySigs.add(signature);
  totalBurnedBaseUnits += half;
  return { ok: true };
}

/** Pay a winner from the prize pool. Amount capped to a fraction of the pool. */
export async function payout(playerWallet, tokens) {
  if (CONFIG.devMode) return { ok: true, devMode: true, tokens };

  const player = new PublicKey(playerWallet);
  const poolBal = BigInt((await connection.getTokenAccountBalance(prizeAta)).value.amount);
  let amount = BigInt(Math.floor(tokens * 10 ** CONFIG.decimals));
  const cap = (poolBal * BigInt(Math.floor(CONFIG.maxPayoutPoolFraction * 1000))) / 1000n;
  if (amount > cap) amount = cap;
  if (amount <= 0n) return { ok: false, reason: "pool_empty" };

  const playerAta = getAssociatedTokenAddressSync(mintPk, player);
  const txn = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(prizeKeypair.publicKey, playerAta, player, mintPk),
    createTransferCheckedInstruction(prizeAta, mintPk, playerAta, prizeKeypair.publicKey, amount, CONFIG.decimals)
  );
  const sig = await sendAndConfirmTransaction(connection, txn, [prizeKeypair]);
  return { ok: true, signature: sig, amountBaseUnits: amount.toString() };
}

export async function stats() {
  if (CONFIG.devMode || !connection) {
    return { poolTokens: 0, burnedTokens: Number(totalBurnedBaseUnits) / 10 ** CONFIG.decimals, devMode: true };
  }
  let poolTokens = 0;
  try {
    poolTokens = Number((await connection.getTokenAccountBalance(prizeAta)).value.uiAmount ?? 0);
  } catch { /* ATA may not exist yet */ }
  return {
    poolTokens,
    burnedTokens: Number(totalBurnedBaseUnits) / 10 ** CONFIG.decimals,
    devMode: false
  };
}
