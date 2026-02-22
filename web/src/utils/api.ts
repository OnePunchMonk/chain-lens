const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function analyzeTransaction(raw_tx: string, prevouts: unknown[]) {
  const res = await fetch(`${API}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_tx, prevouts }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Accept full fixture JSON and analyze. Extracts raw_tx and prevouts. */
export async function analyzeFixture(fixture: { raw_tx?: string; prevouts?: unknown[] }) {
  const raw_tx = fixture.raw_tx;
  const prevouts = fixture.prevouts ?? [];
  if (!raw_tx) throw new Error('Fixture must contain raw_tx');
  return analyzeTransaction(raw_tx, prevouts);
}

export async function analyzeBlock(
  block_data_hex: string,
  undo_data_hex: string,
  xor_key_hex: string,
) {
  const res = await fetch(`${API}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'block', block_data_hex, undo_data_hex, xor_key_hex }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(`${API}/api/health`);
  return res.json();
}

export function formatSats(sats: number | undefined | null): string {
  if (sats == null) return '—';
  if (sats >= 1e8) return `${(sats / 1e8).toFixed(4)} BTC`;
  if (sats >= 1000) return `${sats.toLocaleString()} sats`;
  return `${sats} sats`;
}

export function short(hash: string, n = 8): string {
  if (!hash) return '';
  return `${hash.slice(0, n)}…${hash.slice(-n)}`;
}

export function scriptTypeColor(type: string): string {
  const map: Record<string, string> = {
    p2pkh: 'badge-amber',
    p2sh: 'badge-purple',
    p2wpkh: 'badge-blue',
    p2wsh: 'badge-blue',
    p2tr: 'badge-green',
    op_return: 'badge-gray',
    unknown: 'badge-red',
  };
  return map[type] || 'badge-gray';
}

export const WARNING_INFO: Record<string, { title: string; eli5: string; nerd: string }> = {
  HIGH_FEE: {
    title: 'High Fee',
    eli5: "You're paying more than usual to send this transaction — like using express shipping when standard would do.",
    nerd: 'The fee rate or absolute fee is unusually high.',
  },
  DUST_OUTPUT: {
    title: 'Dust Output',
    eli5: "One or more payments are so tiny (under 546 sats) they might be stuck — like pennies that cost more to pick up than they're worth.",
    nerd: 'One or more outputs are below the 546-satoshi dust threshold and may be unspendable.',
  },
  UNKNOWN_OUTPUT_SCRIPT: {
    title: 'Unknown Output Script',
    eli5: "The address type of some outputs isn't recognized — unusual, but not necessarily wrong.",
    nerd: 'One or more outputs have a non-standard script type.',
  },
  RBF_SIGNALING: {
    title: 'RBF Signaling',
    eli5: "This payment can be replaced with a higher-fee version before it confirms — useful if you need to speed it up.",
    nerd: 'This transaction signals Replace-By-Fee (BIP125), meaning it can be replaced with a higher-fee version.',
  },
};

/** ELI5 + technical definitions for common Bitcoin terms */
export const TERM_ELI5: Record<string, { eli5: string; nerd: string }> = {
  input: {
    eli5: "Old coins you're spending — like bills from your wallet.",
    nerd: 'An unspent transaction output (UTXO) being spent; references a previous txid + vout.',
  },
  output: {
    eli5: "Where the coins go — a new address or an OP_RETURN note.",
    nerd: 'A new UTXO created; specifies value, scriptPubKey (address or script pattern).',
  },
  fee: {
    eli5: "The tip you pay miners to process your transaction — like a toll on the highway.",
    nerd: 'total_input_sats - total_output_sats; paid to the miner who includes the tx in a block.',
  },
  vbytes: {
    eli5: "The size of your transaction in virtual bytes — bigger transactions cost more.",
    nerd: 'Virtual bytes (weight / 4); used for fee calculation; SegWit data is discounted.',
  },
  weight: {
    eli5: "How much 'space' your transaction takes — SegWit transactions use less space.",
    nerd: 'BIP141 weight units: (base_size × 3) + total_size; 1 vbyte = 4 WU.',
  },
  SegWit: {
    eli5: "A way to make transactions smaller and cheaper by moving signatures out of the main data.",
    nerd: 'Segregated Witness (BIP141); witness data stored separately, discounted at 1/4 weight.',
  },
  witness: {
    eli5: "The signature and proof data in a SegWit transaction — stored outside the main body.",
    nerd: 'Witness stack; contains signatures, public keys, or scripts; discounted in weight.',
  },
  'OP_RETURN': {
    eli5: "A special output that holds a note or data — no coins go there, it's like writing on the back of a check.",
    nerd: 'Provably unspendable output; up to 80 bytes of arbitrary data; used for metadata.',
  },
  locktime: {
    eli5: "A deadline — the transaction can't be used until a certain block height or time.",
    nerd: 'Absolute locktime: block height (< 500M) or Unix timestamp (≥ 500M).',
  },
  RBF: {
    eli5: "Replace-By-Fee: lets you replace a pending transaction with a higher-fee version to speed it up.",
    nerd: 'BIP125; signaled when any sequence < 0xfffffffe; allows replacement if fee rate increases.',
  },
};

/** ELI5 + technical explanations for common error codes */
export const ERROR_ELI5: Record<string, { eli5: string; nerd: string }> = {
  INVALID_FIXTURE: {
    eli5: "The data format is wrong — like a broken form with missing boxes.",
    nerd: 'Malformed JSON, missing required fields (raw_tx, prevouts, etc.).',
  },
  INVALID_TX: {
    eli5: "The transaction data is corrupted or incomplete — like a torn or partial message.",
    nerd: 'Truncated or malformed transaction bytes; parsing failed.',
  },
  MISSING_PREVOUT: {
    eli5: "We don't know where some inputs came from — you need to provide prevout info.",
    nerd: 'Input outpoint (txid, vout) not found in the prevouts array.',
  },
  DUPLICATE_PREVOUT: {
    eli5: "The same input appears more than once — something's duplicated.",
    nerd: 'Multiple prevouts provided for the same (txid, vout).',
  },
  INCONSISTENT_PREVOUTS: {
    eli5: "The prevout details don't match the input — like the wrong key for a lock.",
    nerd: 'Prevout script/value does not match the referenced input.',
  },
  PARSE_ERROR: {
    eli5: "Something went wrong while reading the data — it might be incomplete or in the wrong format.",
    nerd: 'General parsing failure during deserialization.',
  },
};

/** Map error code or message to ELI5 + technical text */
export function getErrorEli5(err: string | { code?: string; message?: string } | null): { eli5: string; nerd: string } {
  const code = typeof err === 'object' && err?.code ? err.code : null;
  const msg = typeof err === 'object' && err?.message ? err.message : typeof err === 'string' ? err : '';
  const known = code ? ERROR_ELI5[code] : null;
  if (known) return known;
  for (const [k, v] of Object.entries(ERROR_ELI5)) {
    if (msg.toUpperCase().includes(k)) return v;
  }
  return {
    eli5: "Something went wrong — check that your data is complete and in the right format.",
    nerd: msg || 'Unknown error',
  };
}

// ── BIP68 Relative Timelock Helpers ─────────────────────────────────
/** Convert a BIP68 relative timelock to a human-readable string. */
export function formatRelativeTimelock(type: string, value: number): string {
  if (type === 'blocks') {
    const approxMinutes = value * 10;
    if (approxMinutes < 60) return `${value} blocks (~${approxMinutes} min)`;
    if (approxMinutes < 1440) return `${value} blocks (~${(approxMinutes / 60).toFixed(1)} hours)`;
    const days = approxMinutes / 1440;
    if (days < 14) return `${value} blocks (~${days.toFixed(1)} days)`;
    return `${value} blocks (~${(days / 7).toFixed(1)} weeks)`;
  }
  // time-based (seconds)
  if (value < 60) return `${value} seconds`;
  if (value < 3600) return `${(value / 60).toFixed(1)} minutes`;
  if (value < 86400) return `${(value / 3600).toFixed(1)} hours`;
  if (value < 604800) return `${(value / 86400).toFixed(1)} days`;
  return `${(value / 604800).toFixed(1)} weeks`;
}

// ── Fee Marketplace Context ──────────────────────────────────────────
export type FeeBucket = 'low' | 'moderate' | 'competitive' | 'high' | 'very-high';
export interface FeeContext {
  bucket: FeeBucket;
  label: string;
  icon: string;
  color: string;
  desc: string;
}
/** Classify a fee rate into a static bucket (no live data needed). */
export function classifyFeeRate(satVb: number): FeeContext {
  if (satVb <= 1) return { bucket: 'low', label: 'Very Low', icon: '🐢', color: 'var(--text-dim)', desc: 'This fee rate is very low — the transaction may take a long time to confirm or get stuck.' };
  if (satVb <= 5) return { bucket: 'low', label: 'Low', icon: '🐢', color: 'var(--text-soft)', desc: 'This fee rate is below average — confirmation may be slow during busy periods.' };
  if (satVb <= 20) return { bucket: 'moderate', label: 'Moderate', icon: '✓', color: 'var(--green)', desc: 'This fee rate is moderate — should confirm within a few blocks under normal conditions.' };
  if (satVb <= 50) return { bucket: 'competitive', label: 'Competitive', icon: '⚡', color: 'var(--accent)', desc: 'This fee rate is competitive — likely to confirm in the next block or two.' };
  if (satVb <= 200) return { bucket: 'high', label: 'High', icon: '⚠', color: 'var(--amber)', desc: 'This fee rate is higher than typical — you may be overpaying.' };
  return { bucket: 'very-high', label: 'Very High', icon: '🔥', color: 'var(--red)', desc: 'This fee rate is extremely high — likely overpaying significantly.' };
}

// ── Change Address Heuristic ──────────────────────────────────────────
/**
 * Heuristic: identify which output index is likely the "change" output.
 * Returns the output index or -1 if no clear candidate.
 * Rules: ignore OP_RETURN; if one non-OP_RETURN output shares script_type with
 * any input and is the smallest non-OP_RETURN output, flag it as likely change.
 */
export function detectLikelyChangeOutput(
  vin: { script_type: string }[],
  vout: { n: number; value_sats: number; script_type: string }[],
): number {
  const inputTypes = new Set(vin.map(v => v.script_type));
  const candidates = vout.filter(v => v.script_type !== 'op_return' && v.script_type !== 'unknown');
  if (candidates.length <= 1) return -1; // only one real output — can't pick change
  // Outputs whose script_type matches at least one input
  const matching = candidates.filter(v => inputTypes.has(v.script_type)
    || (v.script_type === 'p2wpkh' && inputTypes.has('p2sh-p2wpkh'))
    || (v.script_type === 'p2tr' && inputTypes.has('p2tr_keypath'))
    || (v.script_type === 'p2tr' && inputTypes.has('p2tr_scriptpath'))
  );
  if (matching.length === 0) return -1;
  // Pick the smallest matching output
  const smallest = matching.reduce((a, b) => a.value_sats <= b.value_sats ? a : b);
  return smallest.n;
}

// ── Multisig Detection ───────────────────────────────────────────────
export interface MultisigInfo { m: number; n: number; }
/** Parse an ASM string for OP_M ... OP_N OP_CHECKMULTISIG pattern. */
export function detectMultisig(asm: string): MultisigInfo | null {
  if (!asm) return null;
  const tokens = asm.split(' ');
  const last = tokens[tokens.length - 1];
  if (last !== 'OP_CHECKMULTISIG' && last !== 'OP_CHECKMULTISIGVERIFY') return null;
  const n = parseInt(tokens[tokens.length - 2]?.replace('OP_', ''));
  const m = parseInt(tokens[0]?.replace('OP_', ''));
  if (isNaN(m) || isNaN(n) || m < 1 || n < 1 || m > n) return null;
  return { m, n };
}

// ── JSON Export Helpers ──────────────────────────────────────────────
export function downloadJson(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyJsonToClipboard(data: unknown): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
}

// ── Script Pattern Labels ────────────────────────────────────────────
export interface PatternLabel { icon: string; label: string; desc: string; }

export function detectTxPattern(
  vin: { prevout?: { value_sats: number }; script_type: string }[],
  vout: { value_sats: number; script_type: string }[],
): PatternLabel | null {
  // CoinJoin heuristic: 3+ inputs AND 3+ equal-value outputs
  const nonOpReturnOuts = vout.filter(v => v.script_type !== 'op_return');
  if (vin.length >= 3 && nonOpReturnOuts.length >= 3) {
    const valueCounts: Record<number, number> = {};
    for (const o of nonOpReturnOuts) {
      valueCounts[o.value_sats] = (valueCounts[o.value_sats] || 0) + 1;
    }
    const maxEqual = Math.max(...Object.values(valueCounts));
    if (maxEqual >= 3) {
      return { icon: '🔀', label: 'CoinJoin-like', desc: 'Multiple inputs and several equal-value outputs suggest a CoinJoin mixing transaction.' };
    }
  }
  // Batch payment: 1 input, many outputs
  if (vin.length <= 2 && nonOpReturnOuts.length >= 5) {
    return { icon: '📦', label: 'Batch Payment', desc: 'Few inputs and many outputs suggest a batch payment (e.g. exchange withdrawal).' };
  }
  // Consolidation: many inputs, 1 output
  if (vin.length >= 5 && nonOpReturnOuts.length === 1) {
    return { icon: '🧹', label: 'Consolidation', desc: 'Many inputs into a single output — typical UTXO consolidation to reduce future fees.' };
  }
  return null;
}
