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
