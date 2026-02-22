import React, { useState } from 'react';
import { formatSats, short, scriptTypeColor, WARNING_INFO } from '../utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Vin {
  txid: string;
  vout: number;
  sequence: number;
  script_sig_hex: string;
  script_asm: string;
  witness: string[];
  witness_script_asm?: string;
  script_type: string;
  address?: string;
  prevout?: { value_sats: number; script_pubkey_hex: string };
  relative_timelock: { enabled: boolean; type?: string; value?: number };
}

interface Vout {
  n: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_asm: string;
  script_type: string;
  address?: string;
  op_return_data_hex?: string;
  op_return_data_utf8?: string | null;
  op_return_protocol?: string;
}

interface SegwitSavings {
  witness_bytes: number;
  non_witness_bytes: number;
  total_bytes: number;
  weight_actual: number;
  weight_if_legacy: number;
  savings_pct: number;
}

interface Warning { code: string; }

interface TxData {
  ok: boolean;
  txid: string;
  wtxid?: string;
  network: string;
  segwit: boolean;
  version: number;
  locktime: number;
  locktime_type: string;
  locktime_value: number;
  size_bytes: number;
  weight: number;
  vbytes: number;
  total_input_sats: number;
  total_output_sats: number;
  fee_sats: number;
  fee_rate_sat_vb: number;
  rbf_signaling: boolean;
  segwit_savings?: SegwitSavings;
  vin: Vin[];
  vout: Vout[];
  warnings: Warning[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Tooltip({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <span className="tooltip-wrap">
      {children}
      <span className="tooltip">{tip}</span>
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      style={{
        background: 'none', padding: '2px 6px', borderRadius: 4,
        fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--border)'
      }}
    >
      {copied ? '✓' : 'copy'}
    </button>
  );
}

function Collapsible({ label, badge, children, defaultOpen = false }: {
  label: string; badge?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="collapse-header" onClick={() => setOpen(!open)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'monospace' }}>{open ? '▾' : '▸'}</span>
          {label}
          {badge}
        </span>
      </div>
      <div className={`collapse-body ${open ? 'open' : ''}`}>
        {children}
      </div>
    </div>
  );
}

function ScriptAsm({ asm }: { asm: string }) {
  const colorize = (token: string) => {
    if (token.startsWith('OP_PUSH') || token.startsWith('OP_0')) return { color: 'var(--text-dim)' };
    if (token.startsWith('OP_CHECKSIG') || token.startsWith('OP_HASH') || token.startsWith('OP_SHA'))
      return { color: 'var(--accent)' };
    if (token.startsWith('OP_IF') || token.startsWith('OP_ELSE') || token.startsWith('OP_RETURN'))
      return { color: 'var(--amber)' };
    if (token.startsWith('OP_')) return { color: 'var(--purple)' };
    // hex data
    return { color: 'var(--text-soft)', fontSize: 11 };
  };
  const tokens = asm.split(' ');
  return (
    <div className="script-asm" style={{
      marginTop: 6, padding: '8px 10px',
      background: 'rgba(0,0,0,0.2)', borderRadius: 6, lineHeight: 2
    }}>
      {tokens.map((t, i) => (
        <span key={i} style={{ ...colorize(t), marginRight: 6 }}>{t}</span>
      ))}
    </div>
  );
}

// ─── Value Flow Diagram ───────────────────────────────────────────────────────
function ValueFlow({ vin, vout, fee_sats }: { vin: Vin[]; vout: Vout[]; fee_sats: number }) {
  const maxBars = Math.max(vin.length, vout.length);
  return (
    <div className="flow-container" style={{ alignItems: 'stretch' }}>
      {/* Inputs column */}
      <div className="flow-col">
        <div className="stat-label" style={{ marginBottom: 4, paddingLeft: 4 }}>Inputs</div>
        {vin.map((v, i) => (
          <div key={i} className="flow-node flow-node-in" style={{ animationDelay: `${i * 0.05}s` }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>#{i}</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>
              {v.prevout ? formatSats(v.prevout.value_sats) : '?'}
            </div>
            {v.address && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, wordBreak: 'break-all' }}>
                {short(v.address, 6)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Center arrow + tx box */}
      <div className="flow-center">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div className="flow-tx-box">
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>TX</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amber)', marginTop: 4 }}>
              Fee: {formatSats(fee_sats)}
            </div>
          </div>
        </div>
      </div>

      {/* Outputs column */}
      <div className="flow-col">
        <div className="stat-label" style={{ marginBottom: 4, paddingLeft: 4 }}>Outputs</div>
        {vout.map((v, i) => (
          <div key={i} className="flow-node flow-node-out" style={{ animationDelay: `${i * 0.05}s` }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>
              #{v.n} <span className={`badge ${scriptTypeColor(v.script_type)}`} style={{ padding: '1px 6px', fontSize: 10 }}>{v.script_type}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, color: v.script_type === 'op_return' ? 'var(--text-dim)' : 'var(--green)' }}>
              {v.script_type === 'op_return' ? 'OP_RETURN' : formatSats(v.value_sats)}
            </div>
            {v.address && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, wordBreak: 'break-all' }}>
                {short(v.address, 6)}
              </div>
            )}
            {v.op_return_data_utf8 && typeof v.op_return_data_utf8 === 'string' && (
              <div style={{ fontSize: 10, color: 'var(--purple)', marginTop: 2 }}>
                "{v.op_return_data_utf8}"
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SegWit Savings ───────────────────────────────────────────────────────────
function SegwitSavingsPanel({ s }: { s: SegwitSavings }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>SegWit Space Savings</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
          {s.savings_pct.toFixed(1)}%
        </span>
      </div>
      <div className="savings-bar-track">
        <div className="savings-bar-fill" style={{ width: `${s.savings_pct}%` }} />
      </div>
      <div className="kv-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kv">
          <span className="kv-label">Actual weight</span>
          <span className="kv-value">{s.weight_actual.toLocaleString()} WU</span>
        </div>
        <div className="kv">
          <span className="kv-label">Legacy weight</span>
          <span className="kv-value">{s.weight_if_legacy.toLocaleString()} WU</span>
        </div>
        <div className="kv">
          <span className="kv-label">Witness bytes</span>
          <span className="kv-value">{s.witness_bytes.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Input Panel ──────────────────────────────────────────────────────────────
function InputPanel({ v, idx }: { v: Vin; idx: number }) {
  const hasWitness = v.witness.length > 0;
  const rtl = v.relative_timelock;

  return (
    <Collapsible
      label={`Input #${idx}`}
      badge={
        <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span className={`badge ${scriptTypeColor(v.script_type)}`}>{v.script_type}</span>
          {hasWitness && <span className="badge badge-blue">segwit</span>}
          {rtl.enabled && <span className="badge badge-amber">timelock</span>}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <div className="kv-grid">
          <div className="kv"><span className="kv-label">Prev txid</span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)', wordBreak: 'break-all' }}>
              {short(v.txid, 10)}
            </span>
          </div>
          <div className="kv"><span className="kv-label">Vout index</span><span className="kv-value">{v.vout}</span></div>
          <div className="kv"><span className="kv-label">Sequence</span>
            <span className="kv-value" style={{ fontFamily: 'monospace', fontSize: 13 }}>0x{v.sequence.toString(16).padStart(8, '0')}</span>
          </div>
          {v.prevout && <div className="kv"><span className="kv-label">Value</span>
            <span className="kv-value" style={{ color: 'var(--accent)' }}>{formatSats(v.prevout.value_sats)}</span>
          </div>}
          {v.address && <div className="kv" style={{ gridColumn: '1 / -1' }}><span className="kv-label">Address</span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--green)' }}>{v.address}</span>
          </div>}
        </div>

        {rtl.enabled && (
          <div style={{
            padding: '8px 12px', background: 'rgba(251,191,36,0.08)', borderRadius: 6,
            border: '1px solid rgba(251,191,36,0.25)', fontSize: 13
          }}>
            ⏱ Relative timelock: <strong>{rtl.type === 'time' ? `${rtl.value}s (~${(rtl.value! / 60).toFixed(1)} min)` : `${rtl.value} blocks`}</strong>
          </div>
        )}

        {v.script_asm && (
          <Collapsible label="scriptSig ASM">
            <ScriptAsm asm={v.script_asm} />
          </Collapsible>
        )}

        {hasWitness && (
          <Collapsible label={`Witness Stack (${v.witness.length} items)`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {v.witness.map((w, wi) => (
                <div key={wi} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 20 }}>[{wi}]</span>
                  <span className="hash" style={{ fontSize: 11, wordBreak: 'break-all', flex: 1 }}>{w}</span>
                  <CopyBtn text={w} />
                </div>
              ))}
            </div>
            {v.witness_script_asm && (
              <div style={{ marginTop: 10 }}>
                <div className="stat-label" style={{ marginBottom: 4 }}>Witness Script</div>
                <ScriptAsm asm={v.witness_script_asm} />
              </div>
            )}
          </Collapsible>
        )}
      </div>
    </Collapsible>
  );
}

// ─── Output Panel ─────────────────────────────────────────────────────────────
function OutputPanel({ v }: { v: Vout }) {
  const isDust = v.script_type !== 'op_return' && v.value_sats < 546;

  return (
    <Collapsible
      label={`Output #${v.n}`}
      badge={
        <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span className={`badge ${scriptTypeColor(v.script_type)}`}>{v.script_type}</span>
          {isDust && <span className="badge badge-red">dust</span>}
          {v.script_type !== 'op_return' && (
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--green)' }}>
              {formatSats(v.value_sats)}
            </span>
          )}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <div className="kv-grid">
          <div className="kv"><span className="kv-label">Value</span>
            <span className="kv-value" style={isDust ? { color: 'var(--red)' } : {}}>
              {formatSats(v.value_sats)}
              {isDust && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--red)' }}>⚠ dust</span>}
            </span>
          </div>
          {v.address && <div className="kv" style={{ gridColumn: '1 / -1' }}><span className="kv-label">Address</span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--green)' }}>{v.address}</span>
          </div>}
        </div>

        {v.script_type === 'op_return' && (
          <div style={{
            padding: '10px 12px', background: 'rgba(139,92,246,0.08)',
            border: '1px solid rgba(139,92,246,0.25)', borderRadius: 6
          }}>
            <div className="kv-label" style={{ marginBottom: 4 }}>OP_RETURN payload</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--purple)', wordBreak: 'break-all' }}>
              {v.op_return_data_hex || '(empty)'}
            </div>
            {v.op_return_data_utf8 && <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>
              UTF-8: "{v.op_return_data_utf8}"
            </div>}
            {v.op_return_protocol && v.op_return_protocol !== 'unknown' && (
              <div style={{ marginTop: 4 }}>
                <span className="badge badge-purple">{v.op_return_protocol}</span>
              </div>
            )}
          </div>
        )}

        <Collapsible label="scriptPubKey ASM">
          <ScriptAsm asm={v.script_asm} />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <code style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all', flex: 1 }}>
              {v.script_pubkey_hex}
            </code>
            <CopyBtn text={v.script_pubkey_hex} />
          </div>
        </Collapsible>
      </div>
    </Collapsible>
  );
}

// ─── Warnings ─────────────────────────────────────────────────────────────────
function WarningsPanel({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {warnings.map((w) => {
        const info = WARNING_INFO[w.code] || { title: w.code, desc: '' };
        return (
          <div key={w.code} className="warning-chip">
            <span style={{ fontSize: 18 }}>⚠</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{info.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>{info.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Visualizer ──────────────────────────────────────────────────────────
export function TransactionVisualizer({ data }: { data: TxData }) {
  const efficiency = data.total_input_sats > 0
    ? ((data.total_output_sats / data.total_input_sats) * 100).toFixed(1)
    : '?';

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header Row ── */}
      <div className="card" style={{
        borderColor: data.segwit ? 'rgba(59,130,246,0.3)' : 'var(--border)',
        boxShadow: data.segwit ? '0 0 30px rgba(59,130,246,0.07)' : 'none'
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          flexWrap: 'wrap', gap: 12, marginBottom: 16
        }}>
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className={`badge ${data.segwit ? 'badge-blue' : 'badge-gray'}`}>
                {data.segwit ? '⚡ SegWit' : 'Legacy'}
              </span>
              <span className="badge badge-gray">v{data.version}</span>
              <span className="badge badge-gray">{data.network}</span>
              {data.rbf_signaling && <span className="badge badge-amber">RBF</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code className="hash" style={{ fontSize: 12 }}>{data.txid}</code>
              <CopyBtn text={data.txid} />
            </div>
            {data.wtxid && data.wtxid !== data.txid && (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>wtxid:</span>
                <code style={{ fontSize: 11, color: 'var(--text-soft)' }}>{short(data.wtxid, 10)}</code>
              </div>
            )}
          </div>
          <WarningsPanel warnings={data.warnings} />
        </div>

        {/* Stats grid */}
        <div className="kv-grid">
          <div className="kv">
            <Tooltip tip="Total fee paid to miner">
              <span className="kv-label">Fee</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18, color: 'var(--amber)' }}>
              {formatSats(data.fee_sats)}
            </span>
          </div>
          <div className="kv">
            <Tooltip tip="Satoshis per virtual byte">
              <span className="kv-label">Fee Rate</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.fee_rate_sat_vb.toFixed(2)}</span>
            <span className="stat-sub">sat/vB</span>
          </div>
          <div className="kv">
            <Tooltip tip="Virtual weight (weight / 4)">
              <span className="kv-label">Virtual Size</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.vbytes.toFixed(2)}</span>
            <span className="stat-sub">vBytes</span>
          </div>
          <div className="kv">
            <Tooltip tip="BIP141 weight units">
              <span className="kv-label">Weight</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.weight.toLocaleString()}</span>
            <span className="stat-sub">WU</span>
          </div>
          <div className="kv">
            <Tooltip tip="Raw serialized byte size">
              <span className="kv-label">Size</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.size_bytes.toLocaleString()}</span>
            <span className="stat-sub">bytes</span>
          </div>
          <div className="kv">
            <Tooltip tip="Percentage of input value that ends up in outputs (not fees)">
              <span className="kv-label">Efficiency</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18, color: 'var(--green)' }}>{efficiency}%</span>
          </div>
          <div className="kv">
            <Tooltip tip={data.locktime_type === 'unix_timestamp' ? `Unix timestamp: ${data.locktime_value}` : `Block height: ${data.locktime_value}`}>
              <span className="kv-label">Locktime</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 15 }}>
              {data.locktime_type === 'none' ? 'None' : data.locktime_value.toLocaleString()}
            </span>
            <span className="stat-sub">{data.locktime_type}</span>
          </div>
          <div className="kv">
            <span className="kv-label">Inputs</span>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.vin.length}</span>
          </div>
          <div className="kv">
            <span className="kv-label">Outputs</span>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.vout.length}</span>
          </div>
        </div>
      </div>

      {/* ── SegWit Savings ── */}
      {data.segwit_savings && (
        <div className="card" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
          <SegwitSavingsPanel s={data.segwit_savings} />
        </div>
      )}

      {/* ── Value Flow ── */}
      <div className="card">
        <div className="section-title">Value Flow</div>
        <ValueFlow vin={data.vin} vout={data.vout} fee_sats={data.fee_sats} />
        <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-soft)' }}>
          <span>In: <strong style={{ color: 'var(--text)' }}>{formatSats(data.total_input_sats)}</strong></span>
          <span>Out: <strong style={{ color: 'var(--text)' }}>{formatSats(data.total_output_sats)}</strong></span>
          <span>Fee: <strong style={{ color: 'var(--amber)' }}>{formatSats(data.fee_sats)}</strong></span>
        </div>
      </div>

      {/* ── Inputs ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Inputs <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-dim)' }}>×{data.vin.length}</span>
          </div>
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.vin.map((v, i) => <InputPanel key={i} v={v} idx={i} />)}
        </div>
      </div>

      {/* ── Outputs ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Outputs <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-dim)' }}>×{data.vout.length}</span>
          </div>
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.vout.map((v, i) => <OutputPanel key={i} v={v} />)}
        </div>
      </div>

      {/* ── Raw JSON ── */}
      <Collapsible label="Raw JSON Response">
        <div style={{ position: 'relative' }}>
          <pre style={{
            fontSize: 11, color: 'var(--text-soft)', whiteSpace: 'pre-wrap',
            wordBreak: 'break-all', maxHeight: 400, overflowY: 'auto',
            background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 12
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <CopyBtn text={JSON.stringify(data, null, 2)} />
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
