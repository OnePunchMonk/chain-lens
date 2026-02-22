# Chain Lens — Requirements Gap Analysis

This document tracks implementation status against the Week 1 challenge README requirements.

---

## ✅ IMPLEMENTED (Core Requirements)

### CLI (`cli.sh` + `chain-lens-core`)
- [x] Parses fixture JSON (transaction mode)
- [x] Block mode: `--block <blk.dat> <rev.dat> <xor.dat>`
- [x] Writes `out/<txid>.json` (tx) or `out/<block_hash>.json` (block)
- [x] Prints JSON to stdout for single-tx mode
- [x] Exit 0 on success, 1 on error
- [x] Creates `out/` directory if missing

### Transaction Parsing
- [x] Varint encoding, version, inputs, outputs, locktime
- [x] SegWit marker & witness parsing
- [x] TXID / WTXID computation
- [x] Weight, vbytes, size_bytes (BIP141)
- [x] Prevout lookup by (txid, vout)
- [x] Duplicate prevout error
- [x] Missing prevout error

### Script Classification
- [x] Output types: p2pkh, p2sh, p2wpkh, p2wsh, p2tr, op_return, unknown
- [x] Input types: p2pkh, p2sh-p2wpkh, p2sh-p2wsh, p2wpkh, p2wsh, p2tr_keypath, p2tr_scriptpath
- [x] Address derivation (Base58Check, Bech32)

### Script Disassembly
- [x] Full opcode table
- [x] script_asm for vin/vout
- [x] witness_script_asm for p2wsh / p2sh-p2wsh

### Fee & Accounting
- [x] Fee, fee_rate_sat_vb
- [x] RBF signaling (BIP125)

### Timelocks
- [x] locktime_type: none, block_height, unix_timestamp
- [x] Relative timelock (BIP68) per vin

### OP_RETURN
- [x] Multiple push parsing
- [x] op_return_data_hex, op_return_data_utf8, op_return_protocol
- [x] Omni, OpenTimestamps detection

### SegWit Savings
- [x] witness_bytes, non_witness_bytes, savings_pct

### Warnings
- [x] HIGH_FEE, DUST_OUTPUT, UNKNOWN_OUTPUT_SCRIPT, RBF_SIGNALING

### Block Mode
- [x] 80-byte header parsing
- [x] Merkle root verification
- [x] Undo file parsing (nSize 0/1/2-5/≥6)
- [x] XOR decoding
- [x] Coinbase detection & BIP34
- [x] Block stats (fees, weight, script type summary)

### Web API
- [x] GET /api/health → { "ok": true }
- [x] POST /api/analyze (transaction + block mode)
- [x] PORT env support

### Web UI
- [x] Transaction loader (raw_tx + prevouts)
- [x] Block file upload
- [x] Value flow diagram
- [x] txid, fee, feerate, input/output counts
- [x] Script type badges
- [x] Collapsible input/output panels
- [x] OP_RETURN display
- [x] SegWit savings panel
- [x] Warnings panel
- [x] Block overview (tx count, fees, expandable tx list)

---

## ✅ GAPS IMPLEMENTED (this pass)

### 1. **Full Fixture JSON Paste** ✓
- **Action:** Added "Full Fixture JSON" mode to TransactionLoader with paste + analyze.

### 2. **Story / Narrative View** ✓
- **Action:** Added `StoryNarrative` component: What happened? Who paid whom? What did it cost? Is anything risky?

### 3. **One-Click "Show Technical Details"** ✓
- **Action:** Added global toggle; hex, script ASM, witness, raw JSON hidden by default.

### 4. **web.sh Cleanup** ✓
- **Action:** Removed duplicate content; single clean script.

### 5. **demo.md** ✓
- **Action:** Replaced with single URL line. **User must add actual video link before submission.**

### 6. **Server URL Print** ✓
- **Action:** "Serving static files" moved to stderr; stdout has single URL line.

### 7. **INCONSISTENT_PREVOUTS** ✓
- **Action:** Parser now checks for extra prevouts (not referenced by any input) and returns INCONSISTENT_PREVOUTS.

### 8. **Integration Tests**
- **Status:** Only 1 integration test (invalid hex).
- **Action:** Add fixture-based integration tests for public fixtures.

---

## 📋 OPTIONAL (Top 5% / Nice-to-Have)
- Fee marketplace context
- Animated value flow
- Change address heuristics
- Dark mode toggle
- WCAG AA accessibility
- JSON export / clipboard
- Side-by-side comparison
- Comprehensive test suite

---

## Implementation Priority
1. Full fixture paste (required)
2. web.sh cleanup
3. demo.md format
4. Story narrative
5. Show technical details toggle
6. INCONSISTENT_PREVOUTS (if needed)
7. Server single-line print
