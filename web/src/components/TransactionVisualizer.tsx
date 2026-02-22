import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  formatSats, short, scriptTypeColor, WARNING_INFO,
  formatRelativeTimelock, classifyFeeRate, detectLikelyChangeOutput,
  detectMultisig, downloadJson, copyJsonToClipboard, detectTxPattern,
} from '../utils/api';
import { TransactionFlowDiagram } from './TransactionFlowDiagram';

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
function InputPanel({ v, idx, showTechnical }: { v: Vin; idx: number; showTechnical: boolean }) {
  const hasWitness = v.witness.length > 0;
  const rtl = v.relative_timelock;
  const multisig = v.witness_script_asm ? detectMultisig(v.witness_script_asm) : null;

  return (
    <Collapsible
      label={`Input #${idx}`}
      badge={
        <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span className={`badge ${scriptTypeColor(v.script_type)}`}>{v.script_type}</span>
          {hasWitness && <span className="badge badge-blue">segwit</span>}
          {rtl.enabled && <span className="badge badge-amber">timelock</span>}
          {multisig && <span className="badge badge-purple">{multisig.m}-of-{multisig.n}</span>}
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

        {rtl.enabled && rtl.type && rtl.value != null && (
          <div className="timelock-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>⏱</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  Relative Timelock: {formatRelativeTimelock(rtl.type, rtl.value)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>
                  {rtl.type === 'blocks'
                    ? `This input cannot be spent until ${rtl.value} blocks have been mined after the prevout was confirmed (~10 min per block).`
                    : `This input cannot be spent until ${rtl.value} seconds have elapsed since the prevout was confirmed.`
                  }
                </div>
              </div>
            </div>
            {rtl.type === 'blocks' && rtl.value > 0 && (
              <div className="timelock-calc">
                <div className="timelock-calc-row">
                  <span className="kv-label">Blocks</span>
                  <span style={{ fontWeight: 600 }}>{rtl.value}</span>
                </div>
                <span style={{ color: 'var(--text-dim)' }}>→</span>
                <div className="timelock-calc-row">
                  <span className="kv-label">≈ Minutes</span>
                  <span style={{ fontWeight: 600 }}>{rtl.value * 10}</span>
                </div>
                <span style={{ color: 'var(--text-dim)' }}>→</span>
                <div className="timelock-calc-row">
                  <span className="kv-label">≈ Hours</span>
                  <span style={{ fontWeight: 600 }}>{(rtl.value * 10 / 60).toFixed(1)}</span>
                </div>
                <span style={{ color: 'var(--text-dim)' }}>→</span>
                <div className="timelock-calc-row">
                  <span className="kv-label">≈ Days</span>
                  <span style={{ fontWeight: 600 }}>{(rtl.value * 10 / 1440).toFixed(1)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {showTechnical && v.script_asm && (
          <Collapsible label="scriptSig ASM">
            <ScriptAsm asm={v.script_asm} />
          </Collapsible>
        )}
        {!showTechnical && v.script_asm && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Enable &quot;Show technical details&quot; to view scriptSig
          </div>
        )}

        {showTechnical && hasWitness && (
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
                <div className="stat-label" style={{ marginBottom: 4 }}>
                  Witness Script
                  {multisig && <span className="badge badge-purple" style={{ marginLeft: 8, fontSize: 10, padding: '1px 8px' }}>{multisig.m}-of-{multisig.n} multisig</span>}
                </div>
                <ScriptAsm asm={v.witness_script_asm} />
              </div>
            )}
          </Collapsible>
        )}
        {!showTechnical && hasWitness && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Enable &quot;Show technical details&quot; to view witness data
          </div>
        )}
      </div>
    </Collapsible>
  );
}

// ─── Output Panel ─────────────────────────────────────────────────────────────
function OutputPanel({ v, showTechnical, isLikelyChange }: { v: Vout; showTechnical: boolean; isLikelyChange: boolean }) {
  const isDust = v.script_type !== 'op_return' && v.value_sats < 546;

  return (
    <Collapsible
      label={`Output #${v.n}`}
      badge={
        <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span className={`badge ${scriptTypeColor(v.script_type)}`}>{v.script_type}</span>
          {isDust && <span className="badge badge-red">dust</span>}
          {isLikelyChange && (
            <Tooltip tip="Heuristic guess: this output likely returns change to the sender (smallest output matching an input script type).">
              <span className="badge badge-gray" style={{ cursor: 'help' }}>🔄 likely change</span>
            </Tooltip>
          )}
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
              UTF-8: &quot;{v.op_return_data_utf8}&quot;
            </div>}
            {v.op_return_protocol && v.op_return_protocol !== 'unknown' && (
              <div style={{ marginTop: 4 }}>
                <span className="badge badge-purple">{v.op_return_protocol}</span>
              </div>
            )}
          </div>
        )}

        {showTechnical && (
          <Collapsible label="scriptPubKey ASM">
            <ScriptAsm asm={v.script_asm} />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all', flex: 1 }}>
                {v.script_pubkey_hex}
              </code>
              <CopyBtn text={v.script_pubkey_hex} />
            </div>
          </Collapsible>
        )}
        {!showTechnical && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Enable &quot;Show technical details&quot; to view scriptPubKey
          </div>
        )}
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

// ─── Story Narrative ───────────────────────────────────────────────────────────
function StoryNarrative({ data }: { data: TxData }) {
  const inpCount = data.vin.length;
  const outCount = data.vout.length;
  const hasWarnings = data.warnings.length > 0;

  return (
    <div className="card story-card">
      <div className="section-title" style={{ marginBottom: 12 }}>📖 What happened?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
        <p>
          This transaction <strong>spends {inpCount} old payment{inpCount !== 1 ? 's' : ''}</strong> (inputs)
          and creates <strong>{outCount} new payment{outCount !== 1 ? 's' : ''}</strong> (outputs).
          Inputs are previous outputs being spent; outputs are where value goes (addresses or OP_RETURN data).
        </p>
        <p>
          <strong>Who paid whom?</strong> Value flowed from the input addresses to the output addresses.
          The difference between <strong>{formatSats(data.total_input_sats)}</strong> in and{' '}
          <strong>{formatSats(data.total_output_sats)}</strong> out is the{' '}
          <strong style={{ color: 'var(--amber)' }}>fee: {formatSats(data.fee_sats)}</strong> paid to the network.
        </p>
        <p>
          <strong>What did it cost?</strong> The fee rate is{' '}
          <strong>{data.fee_rate_sat_vb.toFixed(2)} sat/vB</strong>. Transaction size is{' '}
          <strong>{data.vbytes.toFixed(0)} vBytes</strong> (virtual bytes) — larger transactions cost more.
          {data.segwit && (
            <> This is a <strong>SegWit</strong> transaction, so witness data is discounted and saves space.</>
          )}
        </p>
        {hasWarnings && (
          <p>
            <strong>Is anything risky?</strong> ⚠ This transaction has {data.warnings.length} warning{data.warnings.length !== 1 ? 's' : ''} —
            see the warnings panel for details.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Visualizer ──────────────────────────────────────────────────────────
export function TransactionVisualizer({ data }: { data: TxData }) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const efficiency = data.total_input_sats > 0
    ? ((data.total_output_sats / data.total_input_sats) * 100).toFixed(1)
    : '?';

  const feeCtx = useMemo(() => classifyFeeRate(data.fee_rate_sat_vb), [data.fee_rate_sat_vb]);
  const changeIdx = useMemo(() => detectLikelyChangeOutput(data.vin, data.vout), [data.vin, data.vout]);
  const txPattern = useMemo(() => detectTxPattern(data.vin, data.vout), [data.vin, data.vout]);

  // Keyboard navigation: Tab/Arrow through collapsibles
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const headers = Array.from(el.querySelectorAll<HTMLElement>('.collapse-header'));
        const idx = headers.indexOf(document.activeElement as HTMLElement);
        if (idx < 0) return;
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, headers.length - 1) : Math.max(idx - 1, 0);
        headers[next].focus();
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, []);

  const handleCopyJson = async () => {
    const ok = await copyJsonToClipboard(data);
    if (ok) { setJsonCopied(true); setTimeout(() => setJsonCopied(false), 2000); }
  };

  return (
    <div ref={containerRef} className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Story Narrative ── */}
      <StoryNarrative data={data} />

      {/* ── Toolbar: technical toggle + export ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={handleCopyJson}>
            {jsonCopied ? '✓ Copied!' : '📋 Copy JSON'}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }}
            onClick={() => downloadJson(data, `${data.txid.slice(0, 16)}.json`)}>
            💾 Download JSON
          </button>
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        >
          {showTechnicalDetails ? '🙈 Hide' : '🔬 Show'} technical details (hex, scripts)
        </button>
      </div>

      {/* ── Pattern label ── */}
      {txPattern && (
        <div className="card card-sm" style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: 'rgba(139,92,246,0.25)' }}>
          <span style={{ fontSize: 22 }}>{txPattern.icon}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{txPattern.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{txPattern.desc}</div>
          </div>
        </div>
      )}

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
            <Tooltip tip="Satoshis per virtual byte — the cost density of this transaction">
              <span className="kv-label">Fee Rate</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.fee_rate_sat_vb.toFixed(2)}</span>
            <span className="stat-sub">sat/vB</span>
            {/* Fee context badge */}
            <Tooltip tip={feeCtx.desc}>
              <span className="fee-context-badge" style={{ color: feeCtx.color, borderColor: feeCtx.color, cursor: 'help' }}>
                {feeCtx.icon} {feeCtx.label}
              </span>
            </Tooltip>
          </div>
          <div className="kv">
            <Tooltip tip="Virtual weight (weight / 4) — the effective size used for fee calculation">
              <span className="kv-label">Virtual Size</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.vbytes.toFixed(2)}</span>
            <span className="stat-sub">vBytes</span>
          </div>
          <div className="kv">
            <Tooltip tip="BIP141 weight units — SegWit transactions weigh less because witness data is discounted">
              <span className="kv-label">Weight</span>
            </Tooltip>
            <span className="stat-value" style={{ fontSize: 18 }}>{data.weight.toLocaleString()}</span>
            <span className="stat-sub">WU</span>
          </div>
          <div className="kv">
            <Tooltip tip="Raw serialized byte size including all data">
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
            <Tooltip tip={data.locktime_type === 'unix_timestamp' ? `Unix timestamp: ${data.locktime_value}` : data.locktime_type === 'block_height' ? `Block height: ${data.locktime_value}` : 'No locktime set'}>
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

      {/* ── Value Flow Diagram (SVG visualizer) ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Transaction Flow</div>
          <p style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4, marginBottom: 0 }}>
            Value moves from inputs (left) through the miner fee (center) to outputs (right). Line thickness approximates value proportion.
          </p>
        </div>
        <div style={{ padding: 24 }}>
          <TransactionFlowDiagram
            vin={data.vin}
            vout={data.vout}
            totalInput={data.total_input_sats}
            totalOutput={data.total_output_sats}
            feeSats={data.fee_sats}
          />
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
          {data.vin.map((v, i) => <InputPanel key={i} v={v} idx={i} showTechnical={showTechnicalDetails} />)}
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
          {data.vout.map((v, i) => <OutputPanel key={i} v={v} showTechnical={showTechnicalDetails} isLikelyChange={v.n === changeIdx} />)}
        </div>
      </div>

      {/* ── Raw JSON ── */}
      {showTechnicalDetails ? (
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
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', padding: 8 }}>
          Enable &quot;Show technical details&quot; to view raw JSON
        </div>
      )}
    </div>
  );
}
