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

export const WARNING_INFO: Record<string, { title: string; desc: string }> = {
  HIGH_FEE: {
    title: 'High Fee',
    desc: 'The fee rate or absolute fee is unusually high.',
  },
  DUST_OUTPUT: {
    title: 'Dust Output',
    desc: 'One or more outputs are below the 546-satoshi dust threshold and may be unspendable.',
  },
  UNKNOWN_OUTPUT_SCRIPT: {
    title: 'Unknown Output Script',
    desc: 'One or more outputs have a non-standard script type.',
  },
  RBF_SIGNALING: {
    title: 'RBF Signaling',
    desc: 'This transaction signals Replace-By-Fee (BIP125), meaning it can be replaced with a higher-fee version.',
  },
};

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
