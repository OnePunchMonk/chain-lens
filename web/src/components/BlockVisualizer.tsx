import React, { useState, useMemo } from 'react';
import { formatSats, short, downloadJson, copyJsonToClipboard, TERM_ELI5 } from '../utils/api';
import { TransactionVisualizer } from './TransactionVisualizer';

interface MerkleNode {
    hash: string;
    duplicated: boolean;
}

interface MerkleLayer {
    nodes: MerkleNode[];
}

interface MerkleTree {
    layers: MerkleLayer[];
    root: string;
}

interface VersionBit {
    bit: number;
    name: string;
    active: boolean;
}

interface BlockHeader {
    version: number;
    prev_block_hash: string;
    merkle_root: string;
    merkle_root_valid: boolean;
    timestamp: number;
    bits: string;
    nonce: number;
    block_hash: string;
    version_bits?: VersionBit[];
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
    merkle_tree?: MerkleTree;
}

function formatTs(ts: number): string {
    try { return new Date(ts * 1000).toUTCString(); } catch { return String(ts); }
}

const BLOCK_TERM_ELI5: Record<string, { eli5: string; nerd: string }> = {
    timestamp: { eli5: "When the miner created this block — the block's clock.", nerd: 'Unix timestamp; miner-set block creation time.' },
    bits: { eli5: "A number that sets how hard miners had to work — like a difficulty dial.", nerd: 'Compact difficulty target (nBits).' },
    nonce: { eli5: "A random number miners tweak to find a valid block — like rolling dice.", nerd: '4-byte field; part of Proof-of-Work; miner varies to find valid hash.' },
    merkle_root: { eli5: "A fingerprint of all transactions — if any tx changes, this changes.", nerd: 'Root hash of Merkle tree of all txids; commits to block contents.' },
    prev_block: { eli5: "The previous block's fingerprint — chains blocks together.", nerd: 'Hash of the previous block header; forms the blockchain.' },
};

function BlockTooltip({ tip, children }: { tip: { eli5: string; nerd: string }; children: React.ReactNode }) {
    return (
        <span className="tooltip-wrap" style={{ display: 'inline-flex' }}>
            {children}
            <span className="tooltip">{tip.eli5}<span style={{ display: 'block', marginTop: 6, fontSize: '0.9em', opacity: 0.8 }}>🔧 Details for nerds: {tip.nerd}</span></span>
        </span>
    );
}

// ─── Intra-block Spending Detection ──────────────────────────────────────────
/** Build a map of txid → index for all txs, then check if any input spends an output from an earlier tx in the same block. */
function detectIntraBlockSpending(transactions: any[]): Map<number, number[]> {
    const txidToIdx = new Map<string, number>();
    transactions.forEach((tx: any, i: number) => {
        if (tx.txid) txidToIdx.set(tx.txid, i);
    });
    // Map: txIndex → [list of tx indices it depends on]
    const deps = new Map<number, number[]>();
    transactions.forEach((tx: any, i: number) => {
        if (!tx.vin) return;
        const myDeps: number[] = [];
        for (const inp of tx.vin) {
            const depIdx = txidToIdx.get(inp.txid);
            if (depIdx !== undefined && depIdx < i) {
                myDeps.push(depIdx);
            }
        }
        if (myDeps.length > 0) deps.set(i, myDeps);
    });
    return deps;
}

// ─── Fee Rate Distribution ───────────────────────────────────────────────────
interface FeeRateBucket { label: string; count: number; color: string; }
function computeFeeRateDistribution(transactions: any[]): FeeRateBucket[] {
    const buckets = [
        { label: '0-1', min: 0, max: 1, count: 0, color: 'var(--text-dim)' },
        { label: '1-5', min: 1, max: 5, count: 0, color: 'var(--text-soft)' },
        { label: '5-20', min: 5, max: 20, count: 0, color: 'var(--green)' },
        { label: '20-50', min: 20, max: 50, count: 0, color: 'var(--accent)' },
        { label: '50-200', min: 50, max: 200, count: 0, color: 'var(--amber)' },
        { label: '200+', min: 200, max: Infinity, count: 0, color: 'var(--red)' },
    ];
    for (const tx of transactions) {
        if (tx.fee_rate_sat_vb == null || tx.fee_sats === 0) continue; // skip coinbase
        const rate = tx.fee_rate_sat_vb;
        for (const b of buckets) {
            if (rate >= b.min && rate < b.max) { b.count++; break; }
        }
    }
    return buckets;
}

// ─── Coinbase Reward Breakdown ───────────────────────────────────────────────
function CoinbaseBreakdown({ coinbase, totalFees }: { coinbase: CoinbaseInfo; totalFees: number }) {
    const subsidy = coinbase.total_output_sats - totalFees;
    const totalReward = coinbase.total_output_sats;
    const subsidyPct = totalReward > 0 ? (subsidy / totalReward * 100) : 0;
    const feesPct = totalReward > 0 ? (totalFees / totalReward * 100) : 0;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-title">Coinbase reward breakdown</div>
            <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
                <div title={`Subsidy: ${formatSats(subsidy)}`}
                    style={{ flex: subsidy, background: 'var(--green)', minWidth: 4 }} />
                <div title={`Fees: ${formatSats(totalFees)}`}
                    style={{ flex: totalFees, background: 'var(--amber)', minWidth: totalFees > 0 ? 4 : 0 }} />
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--green)', display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-soft)' }}>Subsidy</span>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>{formatSats(subsidy)}</span>
                    <span style={{ color: 'var(--text-dim)' }}>({subsidyPct.toFixed(1)}%)</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--amber)', display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-soft)' }}>Fees</span>
                    <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{formatSats(totalFees)}</span>
                    <span style={{ color: 'var(--text-dim)' }}>({feesPct.toFixed(1)}%)</span>
                </span>
            </div>
        </div>
    );
}

// ─── Fee Rate Histogram ──────────────────────────────────────────────────────
function FeeRateHistogram({ buckets }: { buckets: FeeRateBucket[] }) {
    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-title">Fee rate distribution (sat/vB)</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
                {buckets.map((b, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{b.count || ''}</span>
                        <div style={{
                            width: '100%', borderRadius: '4px 4px 0 0',
                            background: b.color, opacity: b.count > 0 ? 1 : 0.2,
                            height: `${Math.max((b.count / maxCount) * 60, 3)}px`,
                            transition: 'height 0.3s ease',
                        }} />
                        <span style={{ fontSize: 10, color: 'var(--text-soft)', whiteSpace: 'nowrap' }}>{b.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Merkle Tree Visualization ───────────────────────────────────────────────
function MerkleTreeVisualization({ tree, valid }: { tree: MerkleTree; valid: boolean }) {
    const [hoveredHash, setHoveredHash] = useState<string | null>(null);
    // Show tree bottom-up: root at top, leaves at bottom
    const reversedLayers = useMemo(() => [...tree.layers].reverse(), [tree.layers]);
    const maxNodesInLayer = Math.max(...tree.layers.map(l => l.nodes.length), 1);
    // For large trees, only show abbreviated view
    const isBig = maxNodesInLayer > 16;

    if (tree.layers.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="section-title">Merkle tree</div>
            <div className="eli5-callout" style={{
                padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 8, fontSize: 12, marginBottom: 4,
            }}>
                <strong>ELI5:</strong> The Merkle tree is like a fingerprint pyramid — each level combines pairs of hashes until you get a single root. If anyone tampers with a transaction, the root changes.
            </div>
            <div className="merkle-tree-container">
                {reversedLayers.map((layer, layerIdx) => {
                    const depth = reversedLayers.length - 1 - layerIdx;
                    const isRoot = layerIdx === 0;
                    const isLeaves = layerIdx === reversedLayers.length - 1;
                    const label = isRoot ? 'Root' : isLeaves ? 'Leaves (txids)' : `Level ${depth}`;
                    return (
                        <div key={layerIdx} className="merkle-layer">
                            <div className="merkle-layer-label">{label}</div>
                            <div className="merkle-layer-nodes" style={{
                                justifyContent: layer.nodes.length <= 8 ? 'center' : 'flex-start',
                            }}>
                                {isBig && layer.nodes.length > 16 ? (
                                    <>
                                        {layer.nodes.slice(0, 4).map((node, ni) => (
                                            <MerkleNodeBox key={ni} node={node} isRoot={isRoot} valid={valid}
                                                hovered={hoveredHash === node.hash}
                                                onHover={setHoveredHash} />
                                        ))}
                                        <span style={{ alignSelf: 'center', color: 'var(--text-dim)', fontSize: 12, padding: '0 4px' }}>
                                            … {layer.nodes.length - 8} more …
                                        </span>
                                        {layer.nodes.slice(-4).map((node, ni) => (
                                            <MerkleNodeBox key={`e${ni}`} node={node} isRoot={isRoot} valid={valid}
                                                hovered={hoveredHash === node.hash}
                                                onHover={setHoveredHash} />
                                        ))}
                                    </>
                                ) : (
                                    layer.nodes.map((node, ni) => (
                                        <MerkleNodeBox key={ni} node={node} isRoot={isRoot} valid={valid}
                                            hovered={hoveredHash === node.hash}
                                            onHover={setHoveredHash} />
                                    ))
                                )}
                            </div>
                            {/* Connecting lines */}
                            {layerIdx < reversedLayers.length - 1 && (
                                <div className="merkle-connectors" style={{ height: 16, position: 'relative' }}>
                                    <svg width="100%" height="16" style={{ display: 'block' }}>
                                        <line x1="50%" y1="0" x2="50%" y2="16"
                                            stroke="var(--border)" strokeWidth="1" strokeDasharray="3 2" />
                                    </svg>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 4 }}>
                🔧 Details for nerds: {tree.layers.length} levels, {tree.layers[0]?.nodes.length ?? 0} leaves. Duplicate markers (⬆) show where Bitcoin's odd-length duplication rule applied.
            </div>
        </div>
    );
}

function MerkleNodeBox({ node, isRoot, valid, hovered, onHover }: {
    node: MerkleNode; isRoot: boolean; valid: boolean;
    hovered: boolean; onHover: (h: string | null) => void;
}) {
    const borderColor = isRoot
        ? (valid ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)')
        : node.duplicated
            ? 'rgba(251,191,36,0.4)'
            : 'var(--border)';
    const bg = isRoot
        ? (valid ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)')
        : hovered ? 'var(--surface3)' : 'var(--surface2)';
    return (
        <div
            className="merkle-node"
            style={{ borderColor, background: bg }}
            onMouseEnter={() => onHover(node.hash)}
            onMouseLeave={() => onHover(null)}
            title={node.hash}
        >
            <code style={{ fontSize: 10, color: isRoot ? (valid ? 'var(--green)' : 'var(--red)') : 'var(--accent)' }}>
                {node.hash.slice(0, 8)}…
            </code>
            {node.duplicated && <span style={{ fontSize: 9, color: 'var(--amber)' }} title="Duplicated (odd-level)">⬆</span>}
            {isRoot && <span style={{ fontSize: 9, color: valid ? 'var(--green)' : 'var(--red)' }}>
                {valid ? '✓' : '✗'}
            </span>}
        </div>
    );
}

// ─── BIP9 Version Bits Panel ─────────────────────────────────────────────────
function VersionBitsPanel({ versionBits, version }: { versionBits: VersionBit[]; version: number }) {
    // BIP9: top 3 bits should be 001 (version >= 0x20000000)
    const isBip9 = (version & 0xE0000000) === 0x20000000;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-title">BIP9 Version bits</div>
            <div className="eli5-callout" style={{
                padding: '8px 12px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
                borderRadius: 8, fontSize: 12, marginBottom: 4,
            }}>
                <strong>ELI5:</strong> Version bits are like voting flags — miners set specific bits in the block version to signal support for proposed upgrades (soft forks).
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                <span className={`badge ${isBip9 ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 11 }}>
                    {isBip9 ? '✓ BIP9 compatible' : '— Pre-BIP9'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                    0x{(version >>> 0).toString(16).padStart(8, '0')}
                </span>
            </div>
            {/* Bit grid: show all 29 bits (0-28) */}
            <div className="version-bits-grid">
                {Array.from({ length: 29 }, (_, i) => {
                    const active = (version & (1 << i)) !== 0;
                    const known = versionBits.find(vb => vb.bit === i);
                    return (
                        <div key={i}
                            className={`version-bit ${active ? 'version-bit-active' : ''} ${known ? 'version-bit-known' : ''}`}
                            title={known ? `Bit ${i}: ${known.name} (${active ? 'signaling' : 'not signaling'})` : `Bit ${i}: ${active ? 'set' : 'unset'}`}
                        >
                            <span className="version-bit-num">{i}</span>
                            <span className="version-bit-val">{active ? '1' : '0'}</span>
                            {known && <span className="version-bit-name">{known.name}</span>}
                        </div>
                    );
                })}
            </div>
            {/* Known softfork legend */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                {versionBits.map(vb => (
                    <span key={vb.bit} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        <span style={{
                            width: 8, height: 8, borderRadius: 2, display: 'inline-block',
                            background: vb.active ? 'var(--green)' : 'var(--text-dim)',
                        }} />
                        <span style={{ color: 'var(--text-soft)', textTransform: 'capitalize' }}>{vb.name}</span>
                        <span style={{ color: vb.active ? 'var(--green)' : 'var(--text-dim)', fontWeight: 600, fontSize: 11 }}>
                            bit {vb.bit} {vb.active ? '✓' : '—'}
                        </span>
                    </span>
                ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 2 }}>
                🔧 Details for nerds: BIP9 uses version bits 0-28 for softfork signaling. Top 3 bits (29-31) = 001 indicates BIP9 versioning.
            </div>
        </div>
    );
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
    const feeRateBuckets = useMemo(() => computeFeeRateDistribution(report.transactions), [report.transactions]);
    const [jsonCopied, setJsonCopied] = useState(false);

    const handleCopyJson = async () => {
        const ok = await copyJsonToClipboard(report);
        if (ok) { setJsonCopied(true); setTimeout(() => setJsonCopied(false), 2000); }
    };

    return (
        <div className="card animate-in" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
            <div className="eli5-callout" style={{
                padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 8, marginBottom: 14
            }}>
                <strong>ELI5:</strong> A block is a batch of transactions that miners added to the chain. Like a page in a ledger — each block links to the previous one.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <span className="badge badge-green">Block</span>
                        <span className="badge badge-gray" title={`Version 0x${(h.version >>> 0).toString(16).padStart(8, '0')}`}>v{h.version}</span>
                        {(h.version & 0xE0000000) === 0x20000000 && (
                            <span className="badge badge-purple" style={{ fontSize: 10 }}>BIP9</span>
                        )}
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

            {/* Export buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={handleCopyJson}>
                    {jsonCopied ? '✓ Copied!' : '📋 Copy Block JSON'}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }}
                    onClick={() => downloadJson(report, `block-${h.block_hash.slice(0, 16)}.json`)}>
                    💾 Download JSON
                </button>
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
                <div className="kv">
                    <BlockTooltip tip={BLOCK_TERM_ELI5.timestamp}><span className="kv-label">Timestamp</span></BlockTooltip>
                    <span className="kv-value" style={{ fontSize: 12 }}>{formatTs(h.timestamp)}</span></div>
                <div className="kv">
                    <BlockTooltip tip={BLOCK_TERM_ELI5.bits}><span className="kv-label">Bits</span></BlockTooltip>
                    <span className="kv-value" style={{ fontFamily: 'monospace' }}>{h.bits}</span></div>
                <div className="kv">
                    <BlockTooltip tip={BLOCK_TERM_ELI5.nonce}><span className="kv-label">Nonce</span></BlockTooltip>
                    <span className="kv-value" style={{ fontFamily: 'monospace' }}>{h.nonce.toLocaleString()}</span></div>
                <div className="kv"><span className="kv-label">Coinbase reward</span>
                    <span className="kv-value" style={{ color: 'var(--green)' }}>{formatSats(report.coinbase.total_output_sats)}</span></div>
            </div>

            {/* Coinbase breakdown */}
            <div style={{ marginTop: 16 }}>
                <CoinbaseBreakdown coinbase={report.coinbase} totalFees={s.total_fees_sats} />
            </div>

            <div style={{ marginTop: 16 }}>
                <div className="section-title">Output script types</div>
                <ScriptTypeChart summary={s.script_type_summary} />
            </div>

            {/* Fee rate histogram */}
            <div style={{ marginTop: 16 }}>
                <FeeRateHistogram buckets={feeRateBuckets} />
            </div>

            {/* Merkle root display */}
            <div style={{ marginTop: 14 }}>
                <div className="section-title"><BlockTooltip tip={BLOCK_TERM_ELI5.merkle_root}><span style={{ cursor: 'help' }}>Merkle root</span></BlockTooltip></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ fontSize: 11, color: h.merkle_root_valid ? 'var(--green)' : 'var(--red)', wordBreak: 'break-all' }}>{h.merkle_root}</code>
                    <span style={{ fontSize: 11, color: h.merkle_root_valid ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                        {h.merkle_root_valid ? '✓ valid' : '✗ invalid'}
                    </span>
                </div>
            </div>

            {/* Merkle tree visualization */}
            {report.merkle_tree && report.merkle_tree.layers.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <MerkleTreeVisualization tree={report.merkle_tree} valid={h.merkle_root_valid} />
                </div>
            )}

            {/* BIP9 Version Bits */}
            {h.version_bits && h.version_bits.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <VersionBitsPanel versionBits={h.version_bits} version={h.version} />
                </div>
            )}

            <div style={{ marginTop: 14 }}>
                <div className="section-title"><BlockTooltip tip={BLOCK_TERM_ELI5.prev_block}><span style={{ cursor: 'help' }}>Previous block</span></BlockTooltip></div>
                <code style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{h.prev_block_hash}</code>
            </div>
        </div>
    );
}

export function BlockVisualizer({ reports }: { reports: BlockReport[] }) {
    const [selectedBlock, setSelectedBlock] = useState(0);
    const [selectedTx, setSelectedTx] = useState<number | null>(null);

    const report = reports[selectedBlock];

    // Detect intra-block spending
    const intraBlockDeps = useMemo(() => detectIntraBlockSpending(report.transactions), [report.transactions]);

    // Compute % of segwit txs
    const segwitCount = useMemo(
        () => report.transactions.filter((tx: any) => tx.segwit).length,
        [report.transactions],
    );
    const segwitPct = report.tx_count > 0 ? ((segwitCount / report.tx_count) * 100).toFixed(1) : '0';

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

            {/* SegWit adoption + intra-block stats */}
            <div className="card card-sm" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>⚡ SegWit Adoption</span>
                        <span className="badge badge-blue">{segwitPct}%</span>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>({segwitCount} of {report.tx_count})</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}><strong>ELI5:</strong> {TERM_ELI5.SegWit.eli5}</span>
                </div>
                {intraBlockDeps.size > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>🔗 Intra-block Spending</span>
                            <span className="badge badge-purple">{intraBlockDeps.size} tx{intraBlockDeps.size !== 1 ? 's' : ''}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>spend outputs from earlier txs in this block</span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}><strong>ELI5:</strong> Some transactions in this block spend money that was created by other transactions in the same block — like passing a note in class.</span>
                    </div>
                )}
            </div>

            {/* Transaction list */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div className="section-title" style={{ marginBottom: 0 }}>
                        Transactions ×{report.tx_count}
                    </div>
                </div>
                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {report.transactions.map((tx: any, i: number) => {
                        const deps = intraBlockDeps.get(i);
                        return (
                            <div
                                key={i}
                                className="io-item"
                                style={{
                                    cursor: 'pointer', borderBottom: '1px solid var(--border)',
                                    borderRadius: 0, background: i === selectedTx ? 'var(--surface2)' : undefined,
                                    borderLeft: deps ? '3px solid var(--purple)' : '3px solid transparent',
                                }}
                                onClick={() => setSelectedTx(i === selectedTx ? null : i)}
                            >
                                <div className="io-idx">{i}</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)' }}>
                                        {tx.txid ? short(tx.txid, 10) : '—'}
                                    </div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                                        {i === 0 && <span className="badge badge-amber" style={{ fontSize: 10, padding: '1px 6px' }}>coinbase</span>}
                                        {tx.ok === false && <span className="badge badge-red" style={{ fontSize: 10 }}>parse error</span>}
                                        {tx.segwit && <span className="badge badge-blue" style={{ fontSize: 10, padding: '1px 6px' }}>segwit</span>}
                                        {deps && (
                                            <span className="badge badge-purple" style={{ fontSize: 10, padding: '1px 6px' }}
                                                title={`Spends outputs from tx ${deps.join(', ')}`}>
                                                🔗 depends on tx #{deps.join(', #')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div className="io-sats" style={{ color: tx.fee_sats > 0 ? 'var(--amber)' : 'var(--text-dim)' }}>
                                        {tx.fee_sats != null && tx.fee_sats > 0 ? formatSats(tx.fee_sats) : '—'}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                        {tx.vin ? `${tx.vin.length}→${tx.vout?.length ?? 0}` : ''}
                                        {tx.vbytes != null ? ` • ${tx.vbytes.toFixed(1)} vB` : ''}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Selected transaction detail */}
            {selectedTx !== null && report.transactions[selectedTx]?.ok && (
                <div>
                    <div className="section-title">Transaction Detail — #{selectedTx}</div>
                    {intraBlockDeps.has(selectedTx) && (
                        <div className="card card-sm" style={{ marginBottom: 12, borderColor: 'rgba(139,92,246,0.3)', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 18 }}>🔗</span>
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>Intra-block Spending</div>
                                <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 4 }}>
                                    <strong>ELI5:</strong> This payment uses money that was just created by another payment in the same block — like getting change from a purchase and spending it right away.
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                    🔧 Details for nerds: Spends outputs from tx #{intraBlockDeps.get(selectedTx)!.join(', #')}. If block order changed, this tx would be invalid.
                                </div>
                            </div>
                        </div>
                    )}
                    <TransactionVisualizer data={report.transactions[selectedTx]} />
                </div>
            )}
        </div>
    );
}
