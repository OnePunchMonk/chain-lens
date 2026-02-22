import React, { useRef, useState } from 'react';
import '../styles/index.css';
import { TransactionLoader } from './TransactionLoader';
import { BlockVisualizer } from './BlockVisualizer';
import { analyzeBlock } from '../utils/api';

type Tab = 'tx' | 'block';

/** Read a File and return its contents as a lowercase hex string. */
async function fileToHex(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function App() {
    const [tab, setTab] = useState<Tab>('tx');

    // Block mode state
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

    const handleFileUpload = async (
        file: File,
        setter: React.Dispatch<React.SetStateAction<string>>,
    ) => {
        try {
            const hex = await fileToHex(file);
            setter(hex);
        } catch (e: any) {
            setBlockError(`File read error: ${e.message}`);
        }
    };

    const runBlockAnalysis = async () => {
        setBlockError('');
        setBlockResult(null);
        setBlockLoading(true);
        try {
            const data = await analyzeBlock(blkHex.trim(), revHex.trim(), xorHex.trim() || '0000000000000000');
            setBlockResult(data);
        } catch (e: any) {
            setBlockError(e.message || String(e));
        } finally {
            setBlockLoading(false);
        }
    };

    const FileUploadRow = ({
        label, hint, value, setter, inputRef, accept = '.dat',
    }: {
        label: string; hint: string; value: string;
        setter: React.Dispatch<React.SetStateAction<string>>;
        inputRef: React.RefObject<HTMLInputElement>;
        accept?: string;
    }) => (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 500 }}>
                    {label} <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{hint}</span>
                </label>
                <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }}
                    onClick={() => inputRef.current?.click()}
                >
                    📂 Upload {label.split(' ')[0]}
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    style={{ display: 'none' }}
                    onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f, setter);
                    }}
                />
                {value && (
                    <span style={{ fontSize: 11, color: 'var(--green)' }}>
                        ✓ {(value.length / 2).toLocaleString()} bytes loaded
                    </span>
                )}
            </div>
            <textarea
                rows={2}
                placeholder={`Paste hex or upload file above…`}
                value={value}
                onChange={e => setter(e.target.value)}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
            />
        </div>
    );

    return (
        <div className="app-layout">
            {/* ── Header ── */}
            <header className="header">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="header-logo">⛓ Chain Lens</span>
                    <span className="header-sub">Bitcoin Transaction Analyzer</span>
                </div>
                <div style={{ flex: 1 }} />
                <div className="tabs" style={{ width: 260 }}>
                    <button className={`tab ${tab === 'tx' ? 'active' : ''}`} onClick={() => setTab('tx')}>
                        🔍 Transaction
                    </button>
                    <button className={`tab ${tab === 'block' ? 'active' : ''}`} onClick={() => setTab('block')}>
                        📦 Block
                    </button>
                </div>
            </header>

            {/* ── Main content ── */}
            <main className="page">
                {tab === 'tx' && <TransactionLoader />}

                {tab === 'block' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div className="card">
                            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Analyze Block File</h2>
                            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
                                Upload <code>blk*.dat</code>, <code>rev*.dat</code>, and <code>xor.dat</code> from a Bitcoin Core data directory, or paste their hex contents below.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <FileUploadRow
                                    label="blk*.dat"
                                    hint="(block file — may contain multiple blocks)"
                                    value={blkHex}
                                    setter={setBlkHex}
                                    inputRef={blkRef}
                                />
                                <FileUploadRow
                                    label="rev*.dat"
                                    hint="(undo file for prevouts, optional)"
                                    value={revHex}
                                    setter={setRevHex}
                                    inputRef={revRef}
                                />
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 500 }}>
                                            xor.dat <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>(XOR obfuscation key, default: all zeros)</span>
                                        </label>
                                        <button
                                            className="btn btn-ghost"
                                            style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }}
                                            onClick={() => xorRef.current?.click()}
                                        >
                                            📂 Upload xor.dat
                                        </button>
                                        <input
                                            ref={xorRef}
                                            type="file"
                                            accept=".dat"
                                            style={{ display: 'none' }}
                                            onChange={e => {
                                                const f = e.target.files?.[0];
                                                if (f) handleFileUpload(f, setXorHex);
                                            }}
                                        />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="0000000000000000"
                                        value={xorHex}
                                        onChange={e => setXorHex(e.target.value)}
                                        style={{ resize: 'none', maxWidth: 300, fontFamily: 'JetBrains Mono, monospace' }}
                                    />
                                </div>
                                <div>
                                    <button
                                        className="btn btn-primary"
                                        onClick={runBlockAnalysis}
                                        disabled={blockLoading || !blkHex.trim()}
                                    >
                                        {blockLoading
                                            ? <><span className="animate-spin" style={{ display: 'inline-block', marginRight: 4 }}>⟳</span> Analyzing…</>
                                            : <>📦 Analyze Block</>}
                                    </button>
                                </div>
                            </div>

                            {blockError && (
                                <div style={{
                                    marginTop: 14, padding: '10px 14px', background: 'var(--red-glow)',
                                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)'
                                }}>
                                    ✗ {blockError}
                                </div>
                            )}
                        </div>

                        {blockResult && !Array.isArray(blockResult) && blockResult.ok === false && (
                            <div className="card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
                                <div style={{ color: 'var(--red)', fontSize: 13 }}>
                                    ✗ {blockResult.error?.message || JSON.stringify(blockResult.error)}
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
