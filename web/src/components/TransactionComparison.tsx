import React, { useState } from 'react';
import { analyzeTransaction, analyzeFixture, formatSats, short, classifyFeeRate, getErrorEli5 } from '../utils/api';

interface TxSummary {
  txid: string;
  version: number;
  segwit: boolean;
  size_bytes: number;
  weight: number;
  vbytes: number;
  fee_sats: number;
  fee_rate_sat_vb: number;
  total_input_sats: number;
  total_output_sats: number;
  locktime: number;
  locktime_type: string;
  rbf_signaling: boolean;
  vin: any[];
  vout: any[];
  warnings: any[];
}

interface CompareRow {
  label: string;
  eli5: string;
  getA: (tx: TxSummary) => string;
  getB: (tx: TxSummary) => string;
  diff: (a: TxSummary, b: TxSummary) => 'same' | 'better-a' | 'better-b' | 'neutral';
}

const COMPARE_ROWS: CompareRow[] = [
  {
    label: 'Fee', eli5: 'Total fee paid to miners',
    getA: tx => formatSats(tx.fee_sats), getB: tx => formatSats(tx.fee_sats),
    diff: (a, b) => a.fee_sats === b.fee_sats ? 'same' : a.fee_sats < b.fee_sats ? 'better-a' : 'better-b',
  },
  {
    label: 'Fee Rate', eli5: 'Cost per virtual byte (sat/vB)',
    getA: tx => `${tx.fee_rate_sat_vb.toFixed(2)} sat/vB`, getB: tx => `${tx.fee_rate_sat_vb.toFixed(2)} sat/vB`,
    diff: (a, b) => a.fee_rate_sat_vb === b.fee_rate_sat_vb ? 'same' : a.fee_rate_sat_vb < b.fee_rate_sat_vb ? 'better-a' : 'better-b',
  },
  {
    label: 'Fee Bucket', eli5: 'How the fee rate compares to typical values',
    getA: tx => { const c = classifyFeeRate(tx.fee_rate_sat_vb); return `${c.icon} ${c.label}`; },
    getB: tx => { const c = classifyFeeRate(tx.fee_rate_sat_vb); return `${c.icon} ${c.label}`; },
    diff: () => 'neutral',
  },
  {
    label: 'Size', eli5: 'Raw byte size on disk',
    getA: tx => `${tx.size_bytes.toLocaleString()} bytes`, getB: tx => `${tx.size_bytes.toLocaleString()} bytes`,
    diff: (a, b) => a.size_bytes === b.size_bytes ? 'same' : a.size_bytes < b.size_bytes ? 'better-a' : 'better-b',
  },
  {
    label: 'Virtual Size', eli5: 'Size for fee calculation (SegWit discounted)',
    getA: tx => `${tx.vbytes.toFixed(1)} vB`, getB: tx => `${tx.vbytes.toFixed(1)} vB`,
    diff: (a, b) => Math.abs(a.vbytes - b.vbytes) < 0.1 ? 'same' : a.vbytes < b.vbytes ? 'better-a' : 'better-b',
  },
  {
    label: 'Weight', eli5: 'Transaction weight in weight units',
    getA: tx => `${tx.weight.toLocaleString()} WU`, getB: tx => `${tx.weight.toLocaleString()} WU`,
    diff: (a, b) => a.weight === b.weight ? 'same' : a.weight < b.weight ? 'better-a' : 'better-b',
  },
  {
    label: 'Inputs', eli5: 'Number of inputs (UTXOs being spent)',
    getA: tx => String(tx.vin.length), getB: tx => String(tx.vin.length),
    diff: (a, b) => a.vin.length === b.vin.length ? 'same' : 'neutral',
  },
  {
    label: 'Outputs', eli5: 'Number of outputs',
    getA: tx => String(tx.vout.length), getB: tx => String(tx.vout.length),
    diff: (a, b) => a.vout.length === b.vout.length ? 'same' : 'neutral',
  },
  {
    label: 'Total In', eli5: 'Total input value',
    getA: tx => formatSats(tx.total_input_sats), getB: tx => formatSats(tx.total_input_sats),
    diff: () => 'neutral',
  },
  {
    label: 'Total Out', eli5: 'Total output value',
    getA: tx => formatSats(tx.total_output_sats), getB: tx => formatSats(tx.total_output_sats),
    diff: () => 'neutral',
  },
  {
    label: 'Efficiency', eli5: 'How much of input value reaches outputs',
    getA: tx => tx.total_input_sats > 0 ? `${(tx.total_output_sats / tx.total_input_sats * 100).toFixed(1)}%` : '—',
    getB: tx => tx.total_input_sats > 0 ? `${(tx.total_output_sats / tx.total_input_sats * 100).toFixed(1)}%` : '—',
    diff: (a, b) => {
      const ea = a.total_input_sats > 0 ? a.total_output_sats / a.total_input_sats : 0;
      const eb = b.total_input_sats > 0 ? b.total_output_sats / b.total_input_sats : 0;
      return Math.abs(ea - eb) < 0.001 ? 'same' : ea > eb ? 'better-a' : 'better-b';
    },
  },
  {
    label: 'SegWit', eli5: 'Uses Segregated Witness',
    getA: tx => tx.segwit ? '⚡ Yes' : 'No', getB: tx => tx.segwit ? '⚡ Yes' : 'No',
    diff: (a, b) => a.segwit === b.segwit ? 'same' : 'neutral',
  },
  {
    label: 'RBF', eli5: 'Replace-By-Fee signaling',
    getA: tx => tx.rbf_signaling ? '✓ Yes' : 'No', getB: tx => tx.rbf_signaling ? '✓ Yes' : 'No',
    diff: (a, b) => a.rbf_signaling === b.rbf_signaling ? 'same' : 'neutral',
  },
  {
    label: 'Locktime', eli5: 'When the transaction can be included',
    getA: tx => tx.locktime_type === 'none' ? 'None' : `${tx.locktime} (${tx.locktime_type})`,
    getB: tx => tx.locktime_type === 'none' ? 'None' : `${tx.locktime} (${tx.locktime_type})`,
    diff: (a, b) => a.locktime === b.locktime ? 'same' : 'neutral',
  },
  {
    label: 'Warnings', eli5: 'Number of warnings',
    getA: tx => tx.warnings.length > 0 ? `⚠ ${tx.warnings.length}` : '✓ None',
    getB: tx => tx.warnings.length > 0 ? `⚠ ${tx.warnings.length}` : '✓ None',
    diff: (a, b) => a.warnings.length === b.warnings.length ? 'same' : a.warnings.length < b.warnings.length ? 'better-a' : 'better-b',
  },
  {
    label: 'Script Types (in)', eli5: 'Input script types used',
    getA: tx => [...new Set(tx.vin.map((v: any) => v.script_type))].join(', '),
    getB: tx => [...new Set(tx.vin.map((v: any) => v.script_type))].join(', '),
    diff: () => 'neutral',
  },
  {
    label: 'Script Types (out)', eli5: 'Output script types used',
    getA: tx => [...new Set(tx.vout.map((v: any) => v.script_type))].join(', '),
    getB: tx => [...new Set(tx.vout.map((v: any) => v.script_type))].join(', '),
    diff: () => 'neutral',
  },
];

function diffColor(d: string) {
  if (d === 'same') return 'var(--text-dim)';
  if (d === 'better-a') return 'var(--green)';
  if (d === 'better-b') return 'var(--green)';
  return 'var(--text-soft)';
}
function diffIcon(d: string) {
  if (d === 'same') return '=';
  if (d === 'better-a') return '◀';
  if (d === 'better-b') return '▶';
  return '↔';
}

type InputMethod = 'fixture' | 'raw';

function TxInputPanel({ label, onLoaded }: { label: string; onLoaded: (data: TxSummary) => void }) {
  const [method, setMethod] = useState<InputMethod>('fixture');
  const [fixture, setFixture] = useState('');
  const [rawTx, setRawTx] = useState('');
  const [prevouts, setPrevouts] = useState('[]');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const analyze = async () => {
    setError('');
    setLoading(true);
    try {
      let data: any;
      if (method === 'fixture') {
        const parsed = JSON.parse(fixture.trim());
        data = await analyzeFixture(parsed);
      } else {
        const p = prevouts.trim() ? JSON.parse(prevouts) : [];
        data = await analyzeTransaction(rawTx.trim(), p);
      }
      if (!data.ok) throw new Error(data.error?.message || 'Analysis failed');
      onLoaded(data);
      setLoaded(true);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card card-sm" style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        {loaded && <span className="badge badge-green" style={{ fontSize: 10 }}>✓ loaded</span>}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button className={`btn btn-ghost ${method === 'fixture' ? 'active' : ''}`}
          style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setMethod('fixture')}>Fixture</button>
        <button className={`btn btn-ghost ${method === 'raw' ? 'active' : ''}`}
          style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setMethod('raw')}>Raw + Prevouts</button>
      </div>
      {method === 'fixture' ? (
        <textarea rows={4} placeholder='{"raw_tx":"...","prevouts":[...]}'
          value={fixture} onChange={e => setFixture(e.target.value)}
          style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
      ) : (
        <>
          <textarea rows={2} placeholder="Raw tx hex…"
            value={rawTx} onChange={e => setRawTx(e.target.value)}
            style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginBottom: 6 }} />
          <textarea rows={2} placeholder='[{"txid":"...","vout":0,"value_sats":0,"script_pubkey_hex":"..."}]'
            value={prevouts} onChange={e => setPrevouts(e.target.value)}
            style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
        </>
      )}
      <button className="btn btn-primary" style={{ marginTop: 8, fontSize: 12, padding: '6px 14px' }}
        onClick={analyze} disabled={loading}>
        {loading ? '⟳ Loading…' : '🔍 Analyze'}
      </button>
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)', padding: '6px 10px',
          background: 'var(--red-glow)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)' }}>
          {getErrorEli5(error).eli5}
        </div>
      )}
    </div>
  );
}

export function TransactionComparison() {
  const [txA, setTxA] = useState<TxSummary | null>(null);
  const [txB, setTxB] = useState<TxSummary | null>(null);

  const bothLoaded = txA && txB;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="animate-in">
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Compare Transactions</h2>
        <div className="eli5-callout" style={{
          padding: '8px 12px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
          borderRadius: 8, fontSize: 12, marginBottom: 14,
        }}>
          <strong>ELI5:</strong> Load two transactions side by side to compare fees, sizes, script types, and more — like comparing two shipping quotes.
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <TxInputPanel label="Transaction A" onLoaded={setTxA} />
          <TxInputPanel label="Transaction B" onLoaded={setTxB} />
        </div>
      </div>

      {bothLoaded && (
        <div className="card animate-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Comparison Results</div>
          </div>

          {/* TXID headers */}
          <div className="compare-header">
            <div className="compare-label"></div>
            <div className="compare-cell compare-cell-a">
              <span className="badge badge-blue" style={{ fontSize: 10 }}>A</span>
              <code style={{ fontSize: 10, color: 'var(--accent)' }}>{short(txA!.txid, 8)}</code>
            </div>
            <div className="compare-diff"></div>
            <div className="compare-cell compare-cell-b">
              <span className="badge badge-green" style={{ fontSize: 10 }}>B</span>
              <code style={{ fontSize: 10, color: 'var(--green)' }}>{short(txB!.txid, 8)}</code>
            </div>
          </div>

          {/* Comparison rows */}
          {COMPARE_ROWS.map((row, i) => {
            const d = row.diff(txA!, txB!);
            const valA = row.getA(txA!);
            const valB = row.getB(txB!);
            const isDiff = valA !== valB;
            return (
              <div key={i} className={`compare-row ${isDiff ? 'compare-row-diff' : ''}`}
                title={row.eli5}>
                <div className="compare-label">{row.label}</div>
                <div className={`compare-cell compare-cell-a ${d === 'better-a' ? 'compare-winner' : ''}`}>
                  {valA}
                </div>
                <div className="compare-diff" style={{ color: diffColor(d) }}>
                  {diffIcon(d)}
                </div>
                <div className={`compare-cell compare-cell-b ${d === 'better-b' ? 'compare-winner' : ''}`}>
                  {valB}
                </div>
              </div>
            );
          })}

          {/* Summary */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', color: 'var(--text-soft)' }}>
              <span><span style={{ color: 'var(--text-dim)' }}>◀</span> = A wins (green highlight)</span>
              <span><span style={{ color: 'var(--text-dim)' }}>▶</span> = B wins (green highlight)</span>
              <span><span style={{ color: 'var(--text-dim)' }}>=</span> = same value</span>
              <span><span style={{ color: 'var(--text-dim)' }}>↔</span> = different but not comparable</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
