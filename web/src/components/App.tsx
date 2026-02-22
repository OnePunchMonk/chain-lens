import React, { useRef, useState, useEffect } from 'react';
import '../styles/index.css';
import { TransactionLoader } from './TransactionLoader';
import { BlockVisualizer } from './BlockVisualizer';
import { TransactionComparison } from './TransactionComparison';
import { analyzeBlock, analyzeBlockUpload, getErrorEli5 } from '../utils/api';

type Tab = 'tx' | 'block' | 'compare';
type Theme = 'dark' | 'light' | 'system';

export default function App() {
    const [tab, setTab] = useState<Tab>('tx');

    // Theme state
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem('chain-lens-theme');
        return (saved as Theme) || 'system';
    });

    useEffect(() => {
        localStorage.setItem('chain-lens-theme', theme);
        const root = document.documentElement;
        root.classList.remove('theme-dark', 'theme-light');
        if (theme === 'dark') root.classList.add('theme-dark');
        else if (theme === 'light') root.classList.add('theme-light');
        // 'system' → no class, CSS handles via prefers-color-scheme
    }, [theme]);

    const cycleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark');
    };
    const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';
    const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

    // Block mode state — store File objects (binary upload) OR small hex strings
    const [blkFile, setBlkFile] = useState<File | null>(null);
    const [revFile, setRevFile] = useState<File | null>(null);
    const [xorFile, setXorFile] = useState<File | null>(null);
    const [blkHex, setBlkHex] = useState('');
    const [revHex, setRevHex] = useState('');
    const [xorHex, setXorHex] = useState('0000000000000000');
    const [blockResult, setBlockResult] = useState<any>(null);
    const [blockLoading, setBlockLoading] = useState(false);
    const [blockError, setBlockError] = useState('');

    // File upload refs
    const blkRef = useRef<HTMLInputElement>(null);
    const revRef = useRef<HTMLInputElement>(null);
    const xorRef = useRef<HTMLInputElement>(null);

    const runBlockAnalysis = async () => {
        setBlockError('');
        setBlockResult(null);
        setBlockLoading(true);
        try {
            let data: any;
            if (blkFile) {
                // Binary file upload path — no hex conversion, no browser crash
                data = await analyzeBlockUpload(blkFile, revFile, xorFile);
            } else {
                // Small hex string path (paste mode)
                data = await analyzeBlock(blkHex.trim(), revHex.trim(), xorHex.trim() || '0000000000000000');
            }
            setBlockResult(data);
        } catch (e: any) {
            setBlockError(e.message || String(e));
        } finally {
            setBlockLoading(false);
        }
    };

    const hasBlockInput = blkFile !== null || blkHex.trim().length > 0;

    return (
        <div className="app-layout">
            {/* ── Header ── */}
            <header className="header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="header-icon">⛓</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span className="header-logo">Chain Lens</span>
                        <span className="header-sub">Bitcoin Transaction & Block Analyzer</span>
                    </div>
                </div>
                <div style={{ flex: 1 }} />
                <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '6px 12px', minWidth: 80 }}
                    onClick={cycleTheme}
                    title={`Theme: ${themeLabel}`}
                >
                    {themeIcon} {themeLabel}
                </button>
                <div className="tabs" style={{ width: 380 }}>
                    <button className={`tab ${tab === 'tx' ? 'active' : ''}`} onClick={() => setTab('tx')}>
                        <span style={{ marginRight: 6 }}>◉</span> Transaction
                    </button>
                    <button className={`tab ${tab === 'block' ? 'active' : ''}`} onClick={() => setTab('block')}>
                        <span style={{ marginRight: 6 }}>▣</span> Block
                    </button>
                    <button className={`tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>
                        <span style={{ marginRight: 6 }}>⇆</span> Compare
                    </button>
                </div>
            </header>

            {/* ── Main content ── */}
            <main className="page">
                {tab === 'tx' && <TransactionLoader />}

                {tab === 'compare' && <TransactionComparison />}

                {tab === 'block' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div className="card">
                            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Analyze Block File</h2>
                            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                                Upload <code>blk*.dat</code>, <code>rev*.dat</code>, and <code>xor.dat</code> from a Bitcoin Core data directory, or paste their hex contents below.
                            </p>
                            <div className="eli5-callout" style={{
                                padding: '10px 14px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
                                borderRadius: 8, marginBottom: 14, fontSize: 12, color: 'var(--text-soft)'
                            }}>
                                <strong>What are these files?</strong> <code>blk*.dat</code> contains raw block data (the ledger pages). <code>rev*.dat</code> is an undo file that helps us find where each input came from. <code>xor.dat</code> holds a key to decode blocks that Bitcoin Core obfuscates on disk.
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                {/* ── blk*.dat ── */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 500 }}>
                                            blk*.dat <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>(block file — may contain multiple blocks)</span>
                                        </label>
                                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }}
                                            onClick={() => blkRef.current?.click()}>
                                            📂 Upload blk*.dat
                                        </button>
                                        <input ref={blkRef} type="file" accept=".dat" style={{ display: 'none' }}
                                            onChange={e => { const f = e.target.files?.[0]; if (f) { setBlkFile(f); setBlkHex(''); } }} />
                                        {blkFile && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {blkFile.name} ({(blkFile.size / 1024 / 1024).toFixed(1)} MB)</span>}
                                    </div>
                                    {!blkFile && (
                                        <textarea rows={2} placeholder="…or paste raw block hex here (small blocks only)"
                                            value={blkHex} onChange={e => setBlkHex(e.target.value)}
                                            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }} />
                                    )}
                                </div>
                                {/* ── rev*.dat ── */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 500 }}>
                                            rev*.dat <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>(undo file for prevouts, optional)</span>
                                        </label>
                                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }}
                                            onClick={() => revRef.current?.click()}>
                                            📂 Upload rev*.dat
                                        </button>
                                        <input ref={revRef} type="file" accept=".dat" style={{ display: 'none' }}
                                            onChange={e => { const f = e.target.files?.[0]; if (f) { setRevFile(f); setRevHex(''); } }} />
                                        {revFile && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {revFile.name} ({(revFile.size / 1024 / 1024).toFixed(1)} MB)</span>}
                                    </div>
                                    {!revFile && (
                                        <textarea rows={2} placeholder="…or paste rev hex here (optional)"
                                            value={revHex} onChange={e => setRevHex(e.target.value)}
                                            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }} />
                                    )}
                                </div>
                                {/* ── xor.dat ── */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 500 }}>
                                            xor.dat <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>(XOR obfuscation key, default: all zeros)</span>
                                        </label>
                                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }}
                                            onClick={() => xorRef.current?.click()}>
                                            📂 Upload xor.dat
                                        </button>
                                        <input ref={xorRef} type="file" accept=".dat" style={{ display: 'none' }}
                                            onChange={e => { const f = e.target.files?.[0]; if (f) setXorFile(f); }} />
                                        {xorFile && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {xorFile.name}</span>}
                                    </div>
                                    {!xorFile && (
                                        <input type="text" placeholder="0000000000000000" value={xorHex}
                                            onChange={e => setXorHex(e.target.value)}
                                            style={{ resize: 'none', maxWidth: 300, fontFamily: 'JetBrains Mono, monospace' }} />
                                    )}
                                </div>
                                <div>
                                    <button className="btn btn-primary" onClick={runBlockAnalysis}
                                        disabled={blockLoading || !hasBlockInput}>
                                        {blockLoading
                                            ? <><span className="animate-spin" style={{ display: 'inline-block', marginRight: 4 }}>⟳</span> Analyzing…</>
                                            : <>📦 Analyze Block</>}
                                    </button>
                                    {blkFile && (
                                        <button className="btn btn-ghost" style={{ marginLeft: 8, fontSize: 12 }}
                                            onClick={() => { setBlkFile(null); setRevFile(null); setXorFile(null); setBlkHex(''); setRevHex(''); setBlockResult(null); }}>
                                            Clear files
                                        </button>
                                    )}
                                </div>
                            </div>

                            {blockError && (
                                <div style={{
                                    marginTop: 14, padding: '10px 14px', background: 'var(--red-glow)',
                                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)'
                                }}>
                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>✗ Something went wrong</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 4 }}>
                                        {getErrorEli5(blockError).eli5}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                        🔧 Details for nerds: {getErrorEli5(blockError).nerd}
                                    </div>
                                </div>
                            )}
                        </div>

                        {blockResult && !Array.isArray(blockResult) && blockResult.ok === false && (
                            <div className="card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
                                <div style={{ color: 'var(--red)', fontSize: 13 }}>
                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>✗ Something went wrong</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 4 }}>
                                        {getErrorEli5(blockResult.error).eli5}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                        🔧 Details for nerds: {getErrorEli5(blockResult.error).nerd}
                                    </div>
                                </div>
                            </div>
                        )}

                        {Array.isArray(blockResult) && blockResult.length > 0 && (
                            <BlockVisualizer reports={blockResult} />
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
