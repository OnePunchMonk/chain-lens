import React, { useState } from 'react';
import { analyzeTransaction, analyzeFixture, short, downloadJson, copyJsonToClipboard, getErrorEli5 } from '../utils/api';
import { TransactionVisualizer } from './TransactionVisualizer';

const EXAMPLES = [
  { label: 'Legacy P2PKH', file: '/fixtures/transactions/tx_legacy_p2pkh.json' },
  { label: 'SegWit P2WPKH+P2TR', file: '/fixtures/transactions/tx_segwit_p2wpkh_p2tr.json' },
];

type InputMode = 'split' | 'fixture';

export function TransactionLoader() {
  const [inputMode, setInputMode] = useState<InputMode>('split');
  const [rawTx, setRawTx] = useState('');
  const [prevoutsJson, setPrevoutsJson] = useState('[]');
  const [fixtureJson, setFixtureJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [noPrevoutHint, setNoPrevoutHint] = useState(false);

  const analyze = async () => {
    setError('');
    setResult(null);
    setNoPrevoutHint(false);
    setLoading(true);
    try {
      if (inputMode === 'fixture') {
        const fixture = JSON.parse(fixtureJson.trim());
        if (!fixture.prevouts || fixture.prevouts.length === 0) setNoPrevoutHint(true);
        const data = await analyzeFixture(fixture);
        setResult(data);
      } else {
        let prevouts: any[] = [];
        if (prevoutsJson.trim()) {
          prevouts = JSON.parse(prevoutsJson);
        }
        const data = await analyzeTransaction(rawTx.trim(), prevouts);
        setResult(data);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadFixture = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fixture not found — serve with vite proxying or set VITE_API_URL');
      const json = await res.json();
      setRawTx(json.raw_tx || '');
      setPrevoutsJson(JSON.stringify(json.prevouts || [], null, 2));
      setFixtureJson(JSON.stringify(json, null, 2));
      setResult(null);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const loadFixtureJson = async (url: string) => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fixture not available — make sure the server is running with static file serving or use the text area');
      const json = await res.json();
      const data = await analyzeTransaction(json.raw_tx, json.prevouts || []);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const canAnalyze =
    inputMode === 'fixture'
      ? fixtureJson.trim().length > 0
      : rawTx.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>Analyze Transaction</h2>
            <p style={{ fontSize: 13, color: 'var(--text-soft)', margin: 0 }}>
              Paste raw hex + prevouts, or load a full fixture JSON to visualize value flow.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <button
                className={`btn btn-ghost ${inputMode === 'split' ? 'active' : ''}`}
                style={{ padding: '6px 14px', fontSize: 12 }}
                onClick={() => setInputMode('split')}
              >
                Raw + Prevouts
              </button>
              <button
                className={`btn btn-ghost ${inputMode === 'fixture' ? 'active' : ''}`}
                style={{ padding: '6px 14px', fontSize: 12 }}
                onClick={() => setInputMode('fixture')}
              >
                Full Fixture
              </button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Examples</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.file}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={() => loadFixture(ex.file)}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {inputMode === 'fixture' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{
                display: 'block', marginBottom: 6, fontSize: 12,
                color: 'var(--text-soft)', fontWeight: 500
              }}>
                Fixture JSON{' '}
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  (paste full {`{network, raw_tx, prevouts}`})
                </span>
              </label>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                <strong>What is this?</strong> A fixture is the transaction data plus info about where each input came from (prevouts). Paste the whole JSON here.
              </p>
              <textarea
                rows={8}
                placeholder='{"network":"mainnet","raw_tx":"0200000001...","prevouts":[{"txid":"...","vout":0,"value_sats":100000,"script_pubkey_hex":"76a914...88ac"}]}'
                value={fixtureJson}
                onChange={e => setFixtureJson(e.target.value)}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={analyze}
                disabled={loading || !canAnalyze}
              >
                {loading
                  ? <><span className="animate-spin" style={{ display: 'inline-block', marginRight: 4 }}>⟳</span> Analyzing…</>
                  : <>🔍 Analyze</>}
              </button>
              {fixtureJson && (
                <button
                  className="btn btn-ghost"
                  onClick={() => { setFixtureJson(''); setResult(null); setError(''); }}
                >
                  Clear
                </button>
              )}
              {result?.ok && (
                <span style={{ fontSize: 12, color: 'var(--green)' }}>
                  ✓ txid: {short(result.txid, 10)}
                </span>
              )}
            </div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{
              display: 'block', marginBottom: 6, fontSize: 12,
              color: 'var(--text-soft)', fontWeight: 500
            }}>
              Raw Transaction (hex)
            </label>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
              <strong>What is this?</strong> The raw transaction as a hex string — the exact bytes that get broadcast to the network.
            </p>
            <textarea
              rows={4}
              placeholder="01000000..."
              value={rawTx}
              onChange={e => setRawTx(e.target.value)}
            />
          </div>
          <div>
            <label style={{
              display: 'block', marginBottom: 6, fontSize: 12,
              color: 'var(--text-soft)', fontWeight: 500
            }}>
              PrevOuts JSON{' '}
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                (array of {`{txid, vout, value_sats, script_pubkey_hex}`})
              </span>
            </label>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
              <strong>What is this?</strong> Info about where each input came from — the previous transaction ID, output index, value, and address/script. Needed for fee and address display.
            </p>
            <textarea
              rows={5}
              placeholder='[{"txid":"...","vout":0,"value_sats":100000,"script_pubkey_hex":"76a914...88ac"}]'
              value={prevoutsJson}
              onChange={e => setPrevoutsJson(e.target.value)}
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={analyze}
              disabled={loading || !canAnalyze}
            >
              {loading
                ? <><span className="animate-spin" style={{ display: 'inline-block', marginRight: 4 }}>⟳</span> Analyzing…</>
                : <>🔍 Analyze</>}
            </button>
            {rawTx && (
              <button
                className="btn btn-ghost"
                onClick={() => { setRawTx(''); setPrevoutsJson('[]'); setResult(null); setError(''); }}
              >
                Clear
              </button>
            )}
            {result?.ok && (
              <span style={{ fontSize: 12, color: 'var(--green)' }}>
                ✓ txid: {short(result.txid, 10)}
              </span>
            )}
          </div>
        </div>
        )}

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 14px', background: 'var(--red-glow)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>✗ Something went wrong</div>
            <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 4 }}>
              {getErrorEli5(error).eli5}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              🔧 Details for nerds: {getErrorEli5(error).nerd}
            </div>
            {noPrevoutHint && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-soft)' }}>
                💡 No prevouts were provided. Add prevout data to see fee calculations, input addresses, and value flow.
              </div>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div style={{
            marginTop: 14, padding: '10px 14px', background: 'var(--red-glow)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>✗ Something went wrong</div>
            <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 4 }}>
              {getErrorEli5(result.error).eli5}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              🔧 Details for nerds: {getErrorEli5(result.error).nerd}
            </div>
            {noPrevoutHint && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-soft)' }}>
                💡 No prevouts were provided. Add prevout data to see fee calculations, input addresses, and value flow.
              </div>
            )}
          </div>
        )}
      </div>

      {result?.ok && <TransactionVisualizer data={result} />}
    </div>
  );
}
