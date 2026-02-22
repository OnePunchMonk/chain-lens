import React, { useState } from 'react';
import { formatSats, short } from '../utils/api';
import { TransactionVisualizer } from './TransactionVisualizer';

interface BlockHeader {
    version: number;
    prev_block_hash: string;
    merkle_root: string;
    merkle_root_valid: boolean;
    timestamp: number;
    bits: string;
    nonce: number;
    block_hash: string;
}

interface CoinbaseInfo {
    bip34_height?: number;
    coinbase_script_hex: string;
    total_output_sats: number;
}

interface BlockStats {
    total_fees_sats: number;
    total_weight: number;
    avg_fee_rate_sat_vb: number;
    script_type_summary: Record<string, number>;
}

interface BlockReport {
    ok: boolean;
    mode: string;
    block_header: BlockHeader;
    tx_count: number;
    coinbase: CoinbaseInfo;
    transactions: any[];
    block_stats: BlockStats;
}

function formatTs(ts: number): string {
    try { return new Date(ts * 1000).toUTCString(); } catch { return String(ts); }
}

function ScriptTypeChart({ summary }: { summary: Record<string, number> }) {
    const colors: Record<string, string> = {
        p2wpkh: 'var(--accent)',
        p2tr: 'var(--green)',
        p2sh: 'var(--purple)',
        p2pkh: 'var(--amber)',
        p2wsh: '#60a5fa',
        op_return: 'var(--text-dim)',
        unknown: 'var(--red)',
    };
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
                {Object.entries(summary).filter(([, v]) => v > 0).map(([k, v]) => (
                    <div key={k} title={`${k}: ${v}`}
                        style={{ flex: v, background: colors[k] || 'var(--border)', minWidth: 4 }} />
                ))}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.entries(summary).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[k] || 'var(--border)', display: 'inline-block' }} />
                        <span style={{ color: 'var(--text-soft)' }}>{k}</span>
                        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{v}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

function BlockSummaryCard({ report }: { report: BlockReport }) {
    const h = report.block_header;
    const s = report.block_stats;
    return (
        <div className="card animate-in" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <span className="badge badge-green">Block</span>
                        <span className="badge badge-gray">v{h.version}</span>
                        {report.coinbase.bip34_height != null && (
                            <span className="badge badge-blue">#{report.coinbase.bip34_height.toLocaleString()}</span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code className="hash" style={{ fontSize: 11 }}>{h.block_hash}</code>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span className={`badge ${h.merkle_root_valid ? 'badge-green' : 'badge-red'}`}>
                        {h.merkle_root_valid ? '✓ Merkle OK' : '✗ Merkle FAIL'}
                    </span>
                </div>
            </div>

            <div className="kv-grid">
                <div className="kv"><span className="kv-label">Transactions</span>
                    <span className="stat-value" style={{ fontSize: 18 }}>{report.tx_count.toLocaleString()}</span></div>
                <div className="kv"><span className="kv-label">Total Fees</span>
                    <span className="stat-value" style={{ fontSize: 18, color: 'var(--amber)' }}>{formatSats(s.total_fees_sats)}</span></div>
                <div className="kv"><span className="kv-label">Avg Fee Rate</span>
                    <span className="stat-value" style={{ fontSize: 18 }}>{s.avg_fee_rate_sat_vb.toFixed(2)}</span>
                    <span className="stat-sub">sat/vB</span></div>
                <div className="kv"><span className="kv-label">Total Weight</span>
                    <span className="stat-value" style={{ fontSize: 18 }}>{s.total_weight.toLocaleString()}</span>
                    <span className="stat-sub">WU</span></div>
                <div className="kv"><span className="kv-label">Timestamp</span>
                    <span className="kv-value" style={{ fontSize: 12 }}>{formatTs(h.timestamp)}</span></div>
                <div className="kv"><span className="kv-label">Bits</span>
                    <span className="kv-value" style={{ fontFamily: 'monospace' }}>{h.bits}</span></div>
                <div className="kv"><span className="kv-label">Nonce</span>
                    <span className="kv-value" style={{ fontFamily: 'monospace' }}>{h.nonce.toLocaleString()}</span></div>
                <div className="kv"><span className="kv-label">Coinbase reward</span>
                    <span className="kv-value" style={{ color: 'var(--green)' }}>{formatSats(report.coinbase.total_output_sats)}</span></div>
            </div>

            <div style={{ marginTop: 16 }}>
                <div className="section-title">Output script types</div>
                <ScriptTypeChart summary={s.script_type_summary} />
            </div>

            <div style={{ marginTop: 14 }}>
                <div className="section-title">Previous block</div>
                <code style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{h.prev_block_hash}</code>
            </div>
        </div>
    );
}

export function BlockVisualizer({ reports }: { reports: BlockReport[] }) {
    const [selectedBlock, setSelectedBlock] = useState(0);
    const [selectedTx, setSelectedTx] = useState<number | null>(null);

    const report = reports[selectedBlock];

    return (
        <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {reports.length > 1 && (
                <div className="card card-sm">
                    <div className="section-title">Blocks in file ({reports.length})</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {reports.map((r, i) => (
                            <button
                                key={i}
                                className={`badge ${i === selectedBlock ? 'badge-blue' : 'badge-gray'}`}
                                style={{ cursor: 'pointer', fontSize: 12 }}
                                onClick={() => { setSelectedBlock(i); setSelectedTx(null); }}
                            >
                                #{r.block_header.block_hash.slice(0, 8)}…
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <BlockSummaryCard report={report} />

            {/* Transaction list */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div className="section-title" style={{ marginBottom: 0 }}>
                        Transactions ×{report.tx_count}
                    </div>
                </div>
                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {report.transactions.map((tx: any, i: number) => (
                        <div
                            key={i}
                            className="io-item"
                            style={{
                                cursor: 'pointer', borderBottom: '1px solid var(--border)',
                                borderRadius: 0, background: i === selectedTx ? 'hsl(225,14%,14%)' : undefined
                            }}
                            onClick={() => setSelectedTx(i === selectedTx ? null : i)}
                        >
                            <div className="io-idx">{i}</div>
                            <div>
                                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)' }}>
                                    {tx.txid ? short(tx.txid, 10) : '—'}
                                </div>
                                {i === 0 && <span className="badge badge-amber" style={{ fontSize: 10, padding: '1px 6px' }}>coinbase</span>}
                                {tx.ok === false && <span className="badge badge-red" style={{ fontSize: 10 }}>parse error</span>}
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div className="io-sats" style={{ color: tx.fee_sats > 0 ? 'var(--amber)' : 'var(--text-dim)' }}>
                                    {tx.fee_sats != null && tx.fee_sats > 0 ? formatSats(tx.fee_sats) : '—'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                    {tx.vbytes != null ? `${tx.vbytes.toFixed(1)} vB` : ''}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Selected transaction detail */}
            {selectedTx !== null && report.transactions[selectedTx]?.ok && (
                <div>
                    <div className="section-title">Transaction Detail — #{selectedTx}</div>
                    <TransactionVisualizer data={report.transactions[selectedTx]} />
                </div>
            )}
        </div>
    );
}
