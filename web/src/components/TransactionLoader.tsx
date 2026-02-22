import React, { useState } from 'react';
import { analyzeTransaction, short } from '../utils/api';
import { TransactionVisualizer } from './TransactionVisualizer';

const EXAMPLES = [
  { label: 'Legacy P2PKH', file: '/fixtures/transactions/tx_legacy_p2pkh.json' },
  { label: 'SegWit P2WPKH+P2TR', file: '/fixtures/transactions/tx_segwit_p2wpkh_p2tr.json' },
];

export function TransactionLoader() {
  const [rawTx, setRawTx] = useState('');
  const [prevoutsJson, setPrevoutsJson] = useState('[]');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const analyze = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      let prevouts: any[] = [];
      if (prevoutsJson.trim()) {
        prevouts = JSON.parse(prevoutsJson);
      }
      const data = await analyzeTransaction(rawTx.trim(), prevouts);
      setResult(data);
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

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Analyze Transaction</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center' }}>Quick load:</span>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{
              display: 'block', marginBottom: 6, fontSize: 12,
              color: 'var(--text-soft)', fontWeight: 500
            }}>
              Raw Transaction (hex)
            </label>
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
              disabled={loading || !rawTx.trim()}
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

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 14px', background: 'var(--red-glow)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)'
          }}>
            ✗ {error}
          </div>
        )}
        {result && !result.ok && (
          <div style={{
            marginTop: 14, padding: '10px 14px', background: 'var(--red-glow)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)'
          }}>
            ✗ {result.error?.message || JSON.stringify(result.error)}
          </div>
        )}
      </div>

      {result?.ok && <TransactionVisualizer data={result} />}
    </div>
  );
}
