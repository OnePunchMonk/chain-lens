# Chain Lens: Week 1 Challenge — Complete Task Breakdown

## Overview
Build a Bitcoin transaction parser (CLI + Web) that converts raw transactions into precise JSON reports and user-friendly visualizations. This guide breaks down required functionality and identifies opportunities to reach the top 5%.

---

## PHASE 1: Core Requirements (Table Stakes)

### 1.1 CLI Foundation: `cli.sh`
**File: `cli.sh`**

- [x] Parse command-line arguments (fixture path or `--block <blk> <rev> <xor>`)
- [x] Validate fixture JSON schema (transaction mode)
- [x] Create `out/` directory if missing
- [x] Exit codes: 0 (success), 1 (error)
- [x] Print JSON to stdout for single-tx fixtures
- [x] Write JSON to `out/<txid>.json`

**Subtasks:**
- [x] Detect and route: single-tx vs. block mode
- [x] Error handling: malformed JSON, missing prevouts, mismatched inputs
- [x] Validate that each input finds exactly one prevout by (txid, vout)

---

### 1.2 Transaction Parser Core
**File: `lib/parser.rs` (or equivalent)**

#### Wire Format Parsing
- [x] Read Bitcoin varint encoding (variable-length integers)
- [x] Parse version field (4 bytes)
- [x] Parse input count (varint)
- [x] Parse each input:
  - [x] Previous outpoint (txid 32 bytes + vout 4 bytes)
  - [x] Script length (varint)
  - [x] Script sig (witness flag aware)
  - [x] Sequence (4 bytes)
- [x] Parse output count (varint)
- [x] Parse each output:
  - [x] Value (8 bytes, little-endian satoshis)
  - [x] Script pubkey length (varint)
  - [x] Script pubkey
- [x] Parse locktime (4 bytes)
- [x] Detect SegWit marker (0x00 0x01) and parse witness data

#### TXID & WTXID Computation
- [x] Compute txid: `SHA256(SHA256(non-witness bytes))` in display hex order
- [x] Compute wtxid: `SHA256(SHA256(all bytes including witness))` in display hex order
- [x] Set wtxid to `null` for non-SegWit transactions

#### Size & Weight (BIP141)
- [x] `size_bytes`: length of serialized transaction (all bytes)
- [x] `weight`: `(base_size × 3) + total_size` where `base_size` = non-witness bytes
- [x] `vbytes`: `weight / 4` as a float (NOT ceiling — stored and returned as exact float, e.g. 140.25)
- [x] Validate: `weight == size_bytes × 4` for legacy transactions

> **Clarification**: `vbytes` is stored as an exact float (`weight as f64 / 4.0`), not ceiling-rounded. The spec accepts this as a JSON number.

---

### 1.3 Input/Output Classification & Address Derivation
**File: `lib/classify.rs`**

#### Script Type Classification (Outputs)
Match exactly against these patterns:

| Type | Pattern | Address |
|------|---------|---------|
| `p2pkh` | `OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG` | P2PKH (1-prefix) |
| `p2sh` | `OP_HASH160 <20 bytes> OP_EQUAL` | P2SH (3-prefix) |
| `p2wpkh` | `OP_0 <20 bytes>` | Bech32 (bc1...) |
| `p2wsh` | `OP_0 <32 bytes>` | Bech32 (bc1...) |
| `p2tr` | `OP_1 <32 bytes>` | Bech32 (bc1p...) |
| `op_return` | `OP_RETURN [data...]` | `null` |
| `unknown` | Anything else | `null` |

#### Script Type Classification (Inputs)
Infer from spend pattern + witness structure:

- [x] `p2pkh`: scriptSig = `<sig> <pubkey>`, no witness
- [x] `p2sh-p2wpkh`: scriptSig = `<push of p2wpkh script>`, witness = `[sig, pubkey]`
- [x] `p2sh-p2wsh`: scriptSig = `<push of p2wsh script>`, witness = `[..., witnessScript]`
- [x] `p2wpkh`: scriptSig = empty, witness = `[sig, pubkey]`
- [x] `p2wsh`: scriptSig = empty, witness = `[..., witnessScript]`
- [x] `p2tr_keypath`: scriptSig = empty, witness = `[sig]` (64 bytes)
- [x] `p2tr_scriptpath`: scriptSig = empty, witness = `[sig, ..., script, control_block]` (control block starts 0xc0 or 0xc1)
- [x] `unknown`: Does not match any pattern

#### Address Derivation
- [x] Implement Base58Check encoding/decoding (for P2PKH, P2SH)
- [x] Implement Bech32 encoding (for SegWit v0 and v1)
- [x] Extract 20 or 32-byte hashes from script pubkey
- [x] Use correct mainnet prefixes:
  - P2PKH: 0x00 (displays as '1')
  - P2SH: 0x05 (displays as '3')
  - Bech32: hrp = "bc", SegWit v0 = `bc1q...`, v1 = `bc1p...`

---

### 1.4 Script Disassembly
**File: `lib/disasm.rs`**

- [x] Build opcode table (OP_0 through OP_PUSHDATA4, OP_IF, OP_CHECKSIG, etc.)
- [x] Render each byte as opcode name (e.g., `OP_DUP`, `OP_HASH160`)
- [x] For direct pushes (0x01–0x4b): emit `OP_PUSHBYTES_<n> <hex>`
- [x] For OP_PUSHDATA1/2/4: emit opcode name + data in hex
- [x] For OP_1–OP_16: emit `OP_1`..`OP_16`
- [x] For OP_0: emit `OP_0`
- [x] Unknown opcodes: emit `OP_UNKNOWN_<0xHH>`
- [x] Join with spaces; empty script → `""`

**Example:**
```
Input: 483045022100... 21025f...
Output: "OP_PUSHBYTES_72 3045022100... OP_PUSHBYTES_33 025f..."
```

---

### 1.5 Fee Computation & RBF Detection
**File: `lib/accounting.rs`**

- [x] Compute `total_input_sats` = sum of all prevout values
- [x] Compute `total_output_sats` = sum of all output values
- [x] Compute `fee_sats = total_input_sats - total_output_sats`
- [x] Compute `fee_rate_sat_vb = fee_sats / vbytes` (as JSON number, round to 2 decimals acceptable)
- [x] **RBF Signaling**: `rbf_signaling = true` if any input has `sequence < 0xfffffffe` (BIP125)
- [x] For coinbase transactions: `fee_sats = 0` (inputs are generated, not spent)

---

### 1.6 Timelock Parsing
**File: `lib/timelock.rs`**

#### Absolute Locktime
- [x] Parse `locktime` field (4 bytes, little-endian)
- [x] If `locktime == 0`: `locktime_type = "none"`
- [x] If `locktime < 500_000_000`: `locktime_type = "block_height"`, `locktime_value = locktime`
- [x] If `locktime >= 500_000_000`: `locktime_type = "unix_timestamp"`, `locktime_value = locktime`

#### Relative Timelock (BIP68, per-input)
For each input, parse `sequence` field:
- [x] If bit 31 (0x80000000) is set: `"enabled": false` (timelock disabled)
- [x] Otherwise, extract bits 0–15:
  - [x] If bit 22 (0x400000) is set: `"type": "time"`, `"value": (sequence & 0xFFFF) * 512` seconds
  - [x] Otherwise: `"type": "blocks"`, `"value": sequence & 0xFFFF`

---

### 1.7 OP_RETURN Parsing
**File: `lib/op_return.rs`**

- [x] Detect `script_type == "op_return"` (first opcode is 0x6a)
- [x] Parse all subsequent data pushes (handle OP_PUSHDATA1/2/4):
  - [x] Extract raw bytes in order
  - [x] Concatenate into `op_return_data_hex`
- [x] Attempt UTF-8 decode → `op_return_data_utf8` (or `null` if invalid)
- [x] Detect protocol prefix:
  - [x] `0x6f6d6e69` → `"omni"`
  - [x] `0x0109f91102` → `"opentimestamps"`
  - [x] Otherwise → `"unknown"`

**Note:** Handle variable push sizes correctly; some fixtures may use OP_PUSHDATA1 for a single 8-byte payload.

---

### 1.8 Witness & SegWit Savings
**File: `lib/segwit.rs`**

- [x] If transaction has witness data:
  - [x] Compute `witness_bytes` = sum of all witness item lengths (varint-encoded) + witness script lengths
  - [x] Compute `non_witness_bytes` = `size_bytes - witness_bytes - 2` (subtracts the 2-byte marker+flag overhead)
  - [x] `weight_actual` = (non_witness_bytes × 3) + size_bytes
  - [x] `weight_if_legacy` = size_bytes × 4
  - [x] `savings_pct = 100.0 * (1.0 - weight_actual / weight_if_legacy)`, rounded to 2 decimals
  - [x] Include full `segwit_savings` object
- [x] If no witness: `segwit_savings = null`

For block mode, include `witness_script_asm` (disassembly of last witness item) for P2WSH/P2SH-P2WSH inputs.

---

### 1.9 Warnings
**File: `lib/warnings.rs`**

Emit warnings array with these codes (in any order):

- [x] `HIGH_FEE`: if `fee_sats > 1_000_000` OR `fee_rate_sat_vb > 200`
- [x] `DUST_OUTPUT`: any non-OP_RETURN output has `value_sats < 546`
- [x] `UNKNOWN_OUTPUT_SCRIPT`: any output has `script_type == "unknown"`
- [x] `RBF_SIGNALING`: if `rbf_signaling == true`

**Optional (bonus):**
- [ ] `EMPTY_SCRIPT`: scriptSig or scriptPubKey is empty in unexpected places
- [ ] `ZERO_CONFIRMATIONS`: if included in response context

---

### 1.10 Transaction Output JSON Schema
Ensure every field matches spec exactly:

```json
{
  "ok": true,
  "network": "mainnet",
  "segwit": true/false,
  "txid": "...",
  "wtxid": "..." or null,
  "version": 1,
  "locktime": 0,
  "size_bytes": 222,
  "weight": 561,
  "vbytes": 140.25,
  "total_input_sats": 123456,
  "total_output_sats": 120000,
  "fee_sats": 3456,
  "fee_rate_sat_vb": 24.51,
  "rbf_signaling": true,
  "locktime_type": "block_height",
  "locktime_value": 800000,
  "segwit_savings": { ... } or null,
  "vin": [ ... ],
  "vout": [ ... ],
  "warnings": [ ... ]
}
```

---

### 1.11 Error Handling
All errors must return:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

**Required error codes:**
- [x] `INVALID_FIXTURE`: Malformed JSON, missing fields
- [x] `INVALID_TX`: Truncated/malformed transaction bytes
- [x] `MISSING_PREVOUT`: Input outpoint not found in prevouts
- [x] `DUPLICATE_PREVOUT`: Multiple prevouts for same outpoint
- [ ] `INCONSISTENT_PREVOUTS`: Prevout doesn't match input position
- [x] `PARSE_ERROR`: General parsing failure

Exit code 1 on any error.

---

## PHASE 2: Block Mode (Extended Scope)

### 2.1 Block Header Parsing
**File: `lib/block_parser.rs`**

- [x] Read 80-byte header:
  - [x] Version (4 bytes)
  - [x] Previous block hash (32 bytes, reversed)
  - [x] Merkle root (32 bytes, reversed)
  - [x] Timestamp (4 bytes, little-endian)
  - [x] Bits (4 bytes)
  - [x] Nonce (4 bytes)
- [x] Compute block hash: `SHA256(SHA256(header))`
- [x] Parse all transactions after header

> **Clarification**: A single `blk*.dat` file may contain multiple blocks, each preceded by a 4-byte magic (`0xF9BEB4D9`) and a 4-byte size. `block_parser.rs` iterates all blocks in sequence until the file is exhausted.

### 2.2 XOR Decoding
- [x] Read XOR key file (first 8 bytes)
- [x] XOR-decode block data before parsing
- [x] If key is all zeros, skip transformation

### 2.3 Undo File Parsing
- [x] Parse rev*.dat file in parallel with block
- [x] For each non-coinbase input:
  - [x] Read `nSize` (varint)
  - [x] Decode prevout based on special compression:
    - [x] `nSize == 0`: P2PKH, reconstruct script
    - [x] `nSize == 1`: P2SH, reconstruct script
    - [x] `nSize >= 2 && <= 5`: Compressed P2PK, extract pubkey bits
    - [x] `nSize >= 6`: Raw script, read `nSize - 6` bytes
  - [x] Read `value` (8 bytes, little-endian satoshis)

### 2.4 Merkle Root Verification
- [x] Compute merkle root from all transactions
- [x] Compare against header's `merkle_root`
- [x] Set `merkle_root_valid` field
- [x] Error if mismatch

### 2.5 Coinbase Detection & BIP34
- [x] Verify first transaction has exactly 1 input with txid = 0x00...00, vout = 0xFFFFFFFF
- [x] Decode BIP34 block height from scriptSig (first few bytes)
- [x] Extract `coinbase_script_hex` and `total_output_sats`

### 2.6 Block Statistics
- [x] Count transactions
- [x] Sum fees (all non-coinbase tx)
- [x] Sum weight across all transactions
- [x] Compute average fee rate
- [x] Build script type summary (count of each output type across all transactions)

---

## PHASE 3: Web Visualizer

### 3.1 Web Server Setup (`web.sh`)
**File: `web.sh`**

- [x] Launch Node.js/Python/Rust web server
- [x] Default port: 3000; honor `$PORT` env var
- [x] Print single line: `http://127.0.0.1:3000`
- [x] Keep running until CTRL+C
- [x] No external internet required after install

### 3.2 API Endpoints
**File: `server/routes/api.ts` (or equivalent)**

#### GET /api/health
- [x] Return `{ "ok": true }` with 200 status

#### POST /api/analyze
**Request body:**
```json
{
  "raw_tx": "0200000001...",
  "prevouts": [ ... ]
}
```
OR (block mode)
```json
{
  "mode": "block",
  "block_data_hex": "...",
  "undo_data_hex": "...",
  "xor_key_hex": "..."
}
```

**Response:**
- [x] Return parsed transaction/block JSON (same format as CLI)
- [x] Or error JSON on failure

#### POST /api/upload-block
Optional convenience endpoint for file uploads.

### 3.3 Frontend UI Components
**File: `web/src/components/`**

#### Transaction Input Component
- [x] Load fixture from textarea or file upload
- [x] Validate JSON structure
- [x] Call `/api/analyze`

#### Transaction Visualizer
- [x] **Value Flow Diagram**:
  - [x] Left column: inputs (boxes with sats, address, script type)
  - [x] Right column: outputs (boxes with sats, address, script type)
  - [x] Center TX box with fee displayed
  
- [x] **Transaction Summary Card**:
  - [x] txid (truncated or full-display toggle)
  - [x] Fee & fee rate
  - [x] Input count, output count
  - [x] Weight/vbytes
  - [x] SegWit status
  - [x] Warnings (with tooltips)

- [x] **Input Details**:
  - [x] Per-input collapsible panel:
    - [x] Script type badge (P2PKH, P2WPKH, etc.)
    - [x] Address (if available)
    - [x] Satoshis
    - [x] Relative timelock (if any)
    - [x] scriptSig ASM collapsible
    - [x] Witness data collapsible (if SegWit)
    - [x] Witness script ASM for P2WSH/P2SH-P2WSH

- [x] **Output Details**:
  - [x] Per-output collapsible panel:
    - [x] Script type badge
    - [x] Address (if available)
    - [x] Satoshis
    - [x] scriptPubKey ASM collapsible
    - [x] OP_RETURN payload (if op_return):
      - [x] Hex display
      - [x] UTF-8 decode (if valid)
      - [x] Protocol label (omni, opentimestamps, etc.)

- [x] **Metadata Panel**:
  - [x] Version, locktime details
  - [x] RBF signaling (badge)
  - [x] Absolute/relative timelocks (with tooltips)
  - [x] SegWit savings bar chart (actual vs legacy weight)

#### Block Visualizer
- [x] Block header summary (hash, timestamp, difficulty)
- [x] Merkle root validity indicator
- [x] Transaction list:
  - [x] Clickable rows to expand tx details
  - [x] Row shows: txid, fee, input count, output count
- [x] Block statistics panel (total fees, avg fee rate, script type distribution)

### 3.4 UX/Design Goals (Top 5%)

#### Plain-Language Explanations
- [x] Avoid jargon; define terms on first use
- [x] Key numbers highlighted in color (fee amber, outputs green, inputs accent)

#### Visual Hierarchy
- [x] Highlight key numbers (fee, sats) in bold or color
- [x] Use icons or badges for script types
- [x] Color-code warnings (amber chip with icon)

#### Interactive Tooltips
- [x] Hover on technical terms → popup definition
- [x] Tooltips on Fee, Fee Rate, Virtual Size, Weight, Locktime

#### "Story" Narrative
- [x] Header card shows SegWit/Legacy badge, version, network, RBF badge, warnings inline
- [x] Efficiency % shown (output value / input value)

#### Dark Mode Support
- [x] Dark mode by default (CSS custom properties, glassmorphism design)

---

## PHASE 4: Demo Video & Polish

### 4.1 Demo Video (`demo.md`)
**File: `demo.md`**

```markdown
# Chain Lens Demo

Video: [YouTube/Loom/Drive link — public or unlisted]

## Topics Covered
1. What a transaction is (inputs → outputs)
2. Inputs and outputs explained
3. Fee and fee rate
4. Weight/vbytes
5. SegWit vs. legacy
6. Script/address types (P2PKH, P2SH, P2WPKH, P2WSH, P2TR, OP_RETURN)
7. RBF signaling
8. Timelocks (absolute and relative)
9. SegWit discount visualization
10. Warnings shown in the UI

## Timing
< 2 minutes total

## Tone
Non-technical; speak to someone with no Bitcoin knowledge.
```

---

## TOP 5% FEATURES (Competitive Advantages)

### A. Advanced Parsing

#### A1. Compressed P2PK Key Reconstruction
- [ ] Correctly decompress 33-byte (even/odd prefix) and 65-byte uncompressed pubkeys from undo data
- [ ] Render full pubkey in output address field (rare in public submissions)

#### A2. BIP9 Softfork Signaling Detection
- [ ] Parse version bits from block headers
- [ ] Detect and label blocks signaling activation for known forks (SegWit, Taproot, etc.)
- [ ] *(Bonus: only relevant for block mode, but shows deep understanding)*

#### A3. Legacy Script Validation
- [ ] Recognize non-standard scripts and annotate them
- [ ] Handle OP_0 with various operands (not just 0x00)
- [ ] Support multisig patterns (OP_M...OP_CHECKMULTISIG)

---

### B. Forensic & Educational Features

#### B1. Transaction Fee Marketplace Context
- [ ] Show live (or cached) fee rate percentiles: "Your fee rate is in the Xth percentile"
- [ ] Suggest whether fee is competitive (visual indicator: ✓ good, ⚠ high, ✗ outlier)
- [ ] Include historical fee rate data (if cached/static)

#### B2. Value Flow Animation
- [ ] Animated SVG showing satoshis "flowing" from inputs to outputs
- [ ] Pause on click to inspect individual flows
- [ ] Color-code by script type

#### B3. Relative Timelock Calculator
- [ ] Convert BIP68 values to human time (e.g., "2 weeks" for block-based value)
- [ ] Show in both blocks and approximate days
- [ ] Explain use case (payment channels, pre-signed transactions)

#### B4. Address Linking (Heuristic)
- [ ] Detect change addresses (smallest or single output of type matching any input)
- [ ] Annotate as "likely change"
- [ ] (Caveat: heuristic only; note uncertainty)

#### B5. Script Recognition & Labeling
- [ ] Recognize common patterns:
  - [ ] Lightning channel opening (specific script pattern)
  - [ ] Coinjoin indicators (many inputs of equal value)
  - [ ] Staking pool outputs (multiple P2SH outputs)
- [ ] Label with emoji or icon (⚡ for Lightning, etc.)

#### B6. UTXO Age Inference
- [ ] If prevout contains a known block time, calculate age
- [ ] Label as "freshly minted", "old UTXO", etc.
- [ ] (Requires external context; skip if not available)

---

### C. Block Mode Excellence

#### C1. Transaction Ordering Analysis
- [ ] Show which tx is coinbase
- [ ] Highlight transactions using outputs from earlier in the same block (intra-block spending)
- [ ] Flag any that would be invalid if reordered

#### C2. Merkle Tree Visualization
- [ ] Render ASCII art of merkle tree structure
- [ ] Show leaf positions and hash progression
- [ ] Highlight any branches with mismatches

#### C3. Undo Data Validation
- [ ] Show undo file parsing steps: count items, sizes, verify reconstruction
- [ ] If compressed scripts detected, annotate decompression logic
- [ ] Educational callout: "Bitcoin Core uses compression to save disk space"

#### C4. Block Statistics Dashboard
- [ ] Time-series chart (if multiple blocks): fee rate trend
- [ ] Script type distribution pie chart
- [ ] Average transaction size histogram
- [ ] Coinbase reward breakdown (subsidy + fees)

---

### D. Robustness & Edge Cases

#### D1. Multisig Witness Script Disassembly
- [ ] Parse `OP_M [pubkey]... OP_N OP_CHECKMULTISIG`
- [ ] Render as "2-of-3 multisig" + list of addresses (if pubkey-to-address derivable)
- [ ] Show signature requirements

#### D2. Miner Fee Anomaly Detection
- [ ] Warn on extremely low fees (< 1 sat/vB) with reason: "May be stuck"
- [ ] Warn on extremely high fees with reason: "Possible overpayment"

#### D3. Truncated/Malformed Input Handling
- [ ] Don't crash on incomplete witness data
- [ ] Return graceful error: "Transaction truncated at byte 342 (expected witness item 3)"

#### D4. Empty Prevouts Graceful Fallback
- [ ] If prevouts array is empty or missing, render transaction with "unknown input values"
- [ ] Show: "Click to provide prevout data"
- [ ] Still compute txid and other format-based fields

---

### E. Web UI Excellence (Design)

#### E1. Dark Mode with System Preference Detection
- [ ] Default to system setting (prefers-color-scheme)
- [ ] Smooth transitions

#### E2. Responsive Layout
- [ ] Mobile-friendly diagram layout (inputs/outputs stack vertically)
- [ ] Touch-friendly tooltips (tap-to-expand)

#### E3. Keyboard Navigation
- [ ] Tab through inputs/outputs
- [ ] Arrow keys to expand/collapse
- [ ] Space to toggle details

#### E4. Accessibility (WCAG AA)
- [ ] Color not the only indicator (use labels, icons)
- [ ] High contrast mode
- [ ] Screen reader friendly (aria labels, semantic HTML)

#### E5. Export Options
- [ ] Download JSON (transaction or block report)
- [ ] Copy JSON to clipboard
- [ ] Share-friendly short URL (hashrouter; no backend state needed)
- [ ] Print-friendly CSS (black on white, no colors)

#### E6. Comparison View
- [ ] Load two transactions side-by-side
- [ ] Highlight differences (fees, script types, etc.)
- [ ] *(Bonus: helps understand transaction patterns)*

---

### F. Documentation & Code Quality

#### F1. Inline Comments on Hard Parts
- [ ] Explain merkle root computation
- [ ] Explain witness weight calculation with example
- [ ] Explain script classification logic (why p2wpkh vs. p2sh-p2wpkh)

#### F2. Rustdoc / JSDoc Comments
- [ ] Every public function documented
- [ ] Examples for complex functions
- [ ] Link to relevant BIPs (BIP173 for Bech32, BIP141 for SegWit, etc.)

#### F3. Testing Strategy
- [ ] Unit tests for parsing (each fixture type)
- [ ] Integration tests (end-to-end fixture → JSON)
- [ ] Property tests (varint encoding/decoding symmetry, hash consistency)
- [ ] Include public fixtures in test suite

#### F4. Error Recovery Examples
- [ ] Document why each error code is emitted
- [ ] Provide example input that triggers each code
- [ ] Show how to fix it (in README)

---

### G. Performance & Scaling

#### G1. Large Block Handling
- [ ] Optimize parsing for blocks with 5000+ transactions
- [ ] Lazy-load large transaction lists in UI (virtualization)
- [ ] Streaming JSON output (not fully loaded into memory)

#### G2. Caching Strategy
- [ ] Cache parsed transactions (by txid) in UI
- [ ] Cache addresses (by pubkey hash) to avoid recomputation
- [ ] Invalidation on reload

---

## Implementation Checklist

### Must-Have (Table Stakes)
- [x] CLI parsing (single-tx, block mode)
- [x] Transaction JSON schema (all fields)
- [x] Address derivation (all types)
- [x] Script disassembly
- [x] Fee & RBF detection
- [x] Timelock parsing
- [x] OP_RETURN parsing
- [x] SegWit savings
- [x] Warnings (required codes)
- [x] Web server + /api/health
- [x] Web UI (rich layout)
- [ ] Demo video (all required topics)

### Should-Have (Top 10%)
- [x] Block mode with merkle verification
- [x] Witness script disassembly (p2wsh, p2sh-p2wsh)
- [x] Relative timelock explanation
- [x] OP_RETURN protocol detection
- [x] Value flow diagram
- [x] Interactive tooltips
- [x] Plain-language narrative (badges + story cards)
- [x] Error handling resilience
- [ ] Code documentation

### Nice-to-Have (Top 5%)
- [ ] Fee marketplace context
- [ ] Animated value flow
- [ ] Address change detection
- [ ] Multisig labeling
- [x] Block statistics dashboard
- [x] Dark mode
- [x] Responsive layout
- [ ] Accessibility (WCAG AA)
- [ ] Export options
- [ ] Side-by-side comparison
- [ ] Comprehensive test suite
- [ ] Performance optimization

---

## Recommended Architecture

### Backend (CLI + API Server)
```
src/
├── main.rs (CLI entry point)
├── lib.rs (library facade)
├── parser/ (transaction parsing)
│   ├── tx.rs (transaction structure)
│   ├── varint.rs (variable-length integers)
│   └── witness.rs (witness data)
├── classify/ (script classification)
│   ├── output.rs
│   ├── input.rs
│   ├── address.rs (base58check, bech32)
│   └── script.rs
├── disasm/ (script disassembly)
│   └── opcode.rs
├── accounting/ (fees, RBF)
│   └── fee.rs
├── timelock/ (locktime, BIP68)
│   └── timelock.rs
├── op_return/ (OP_RETURN parsing)
│   └── op_return.rs
├── segwit/ (SegWit analysis)
│   └── segwit.rs
├── warnings/ (warning codes)
│   └── warnings.rs
├── block/ (block-mode parsing)
│   ├── header.rs
│   ├── merkle.rs
│   ├── undo.rs
│   └── xor.rs
└── error/ (error types)
    └── error.rs

server/ (web API)
├── main.rs (Axum or Rocket server)
└── routes/ (API endpoints)

tests/ (integration tests)
├── fixtures/ (symlink to fixtures/)
└── integration_tests.rs
```

### Frontend (Web UI)
```
web/
├── index.html
├── src/
│   ├── main.tsx
│   ├── components/
│   │   ├── TransactionLoader.tsx
│   │   ├── TransactionVisualizer.tsx
│   │   ├── InputPanel.tsx
│   │   ├── OutputPanel.tsx
│   │   ├── FeeSummary.tsx
│   │   ├── ValueFlowDiagram.tsx
│   │   ├── Tooltip.tsx
│   │   └── Warnings.tsx
│   ├── hooks/
│   │   ├── useTransaction.ts
│   │   └── useTheme.ts
│   ├── utils/
│   │   ├── api.ts
│   │   └── format.ts
│   └── styles/
│       ├── index.css
│       └── dark-mode.css
└── vite.config.ts (or webpack)
```

---

## Testing Strategy

### Unit Tests
```rust
#[test]
fn test_varint_encoding_decoding() { ... }

#[test]
fn test_p2wpkh_address_derivation() { ... }

#[test]
fn test_segwit_weight_calculation() { ... }

#[test]
fn test_bip68_relative_timelock_parsing() { ... }
```

### Integration Tests
```rust
#[test]
fn test_fixture_tx_legacy_p2pkh() { ... }

#[test]
fn test_fixture_tx_taproot_keypath() { ... }

#[test]
fn test_fixture_block_with_merkle_verification() { ... }
```

### Fixtures to Create/Test
- [ ] Legacy P2PKH (single input, single output)
- [ ] P2SH-wrapped P2WPKH (nested SegWit)
- [ ] P2WPKH (native SegWit v0)
- [ ] P2WSH with multisig (SegWit v0, 2-of-3)
- [ ] P2TR keypath (Taproot, key path spend)
- [ ] P2TR scriptpath (Taproot, script path spend)
- [ ] OP_RETURN with Omni prefix
- [ ] OP_RETURN with multiple pushes
- [ ] RBF signaling (sequence < 0xfffffffe)
- [ ] Relative timelock (blocks-based)
- [ ] Relative timelock (time-based)
- [ ] Absolute locktime (block height)
- [ ] Absolute locktime (unix timestamp)
- [ ] Small block (5-10 transactions with undo file)
- [ ] Block with invalid merkle root (error case)

---

## Key Gotchas & Mitigations

### Gotcha 1: Witness Bytes Calculation
- **Issue**: Easy to miscount witness bytes; many off-by-one errors
- **Mitigation**: Implement carefully; validate against BIP141 examples; add comments

### Gotcha 2: Address Derivation Checksum
- **Issue**: Base58Check has a 4-byte checksum; easy to encode wrong
- **Mitigation**: Use tested libraries (bitcoin-core, bitcoinlib) or verify checksums carefully

### Gotcha 3: Script Classification Ambiguity
- **Issue**: Is `OP_1 <32 bytes>` always P2TR, or could it be something else?
- **Answer**: In practice, yes. But spec says "p2tr"; don't overthink.

### Gotcha 4: Prevout Matching
- **Issue**: Fixture may have prevouts out of order; must match by (txid, vout)
- **Mitigation**: Use a HashMap for O(1) lookup; validate no duplicates

### Gotcha 5: Block XOR Decoding
- **Issue**: XOR key is read as first 8 bytes of xor.dat; easy to read wrong length
- **Mitigation**: Read exactly 8 bytes; test with real mainnet blocks

### Gotcha 6: Undo Data Compression
- **Issue**: Special-case handling for nSize 0/1 (P2PKH, P2SH); fragile if misunderstood
- **Mitigation**: Study Bitcoin Core's `undo.h` carefully; test with real blocks

### Gotcha 7: Fee Rate Rounding
- **Issue**: Spec says "evaluator accepts small rounding differences (+/-0.01)"
- **Mitigation**: Store as float; round to 2 decimals; don't overthink precision

### Gotcha 8: Demo Video Timing
- **Issue**: 2-minute hard limit; easy to ramble
- **Mitigation**: Script the walkthrough; time it; aim for 90 seconds

---

## Evaluation Prioritization

### Week 1 Pass/Fail Criteria
1. ✓ cli.sh runs on all public fixtures → JSON output matches schema
2. ✓ web.sh starts and responds to /api/health
3. ✓ No crashes on malformed input (structured errors)
4. ✓ demo.md exists with valid public link

### Phase 1 (Automated) Scoring
- Correct JSON schema (all fields present, correct types)
- Correct txid/wtxid computation
- Correct fee calculation
- Correct address derivation (all types)
- Correct warnings (required codes)
- Block mode merkle verification (if attempted)

### Phase 2 (Manual) Scoring
- Hidden fixtures: coverage of edge cases (taproot, multisig, OP_RETURN, etc.)
- Web UI quality: clarity, design, accessibility
- Demo video: coverage of all required topics, tone, pacing
- Code quality: readability, comments, structure

### Competitive Scoring (Top 5%)
- Advanced features (fee context, value flow animation, multisig recognition)
- Robustness (handles truncated/malformed input gracefully)
- Documentation (clear comments, BIP references, example code)
- Polish (dark mode, responsive, accessible)
- Testing (comprehensive fixtures, property tests, integration tests)

---

## Summary: Fast Track to Top 5%

1. **Nail the basics first**: CLI parsing, JSON schema, address derivation. No shortcuts.
2. **Add value flow visualization**: Even a simple SVG diagram beats text for learning.
3. **Plain-language narrative**: "Inputs → Outputs" story beats technical details.
4. **Witness script disassembly**: Shows you understand SegWit deeply; rare.
5. **Relative timelock calculator**: Explains a complex concept simply; impressive.
6. **Dark mode + accessibility**: Low effort, high perceived quality.
7. **Comprehensive tests**: Proves correctness; shows confidence.
8. **Demo video pacing**: 90 seconds, no filler, all required topics = 100% clarity.
9. **Code comments on hard parts**: Explains merkle root, BIP68, compression = transparency.
10. **Error recovery examples**: Proves you've thought about robustness.

---

## Files to Create

1. `claude.md` (this file) — task breakdown
2. `README.md` — project overview, setup, usage
3. `cli.sh` — entry point
4. `web.sh` — web server entry point
5. `Cargo.toml` / `package.json` — dependencies
6. `src/main.rs` / `src/lib.rs` — Rust implementation
7. `server/main.rs` — web server (Rust)
8. `web/index.html` + `src/` — React frontend
9. `tests/integration_tests.rs` — test suite
10. `demo.md` — demo video link
11. `.gitignore` — standard patterns
12. `fixtures/` → symlink or copy of public fixtures (for local testing)

---

## Next Steps

1. **Parse this document thoroughly**
2. **Create project structure** (directories, cargo init, etc.)
3. **Start with parser** (varint → transaction → JSON)
4. **Add classify + address** (script types, base58check, bech32)
5. **Add CLI** (argument parsing, error handling, file I/O)
6. **Test on public fixtures**
7. **Build web UI** (React, API integration, visualization)
8. **Polish + docs** (comments, README, test suite)
9. **Record demo video** (under 2 minutes, all topics)
10. **Final review** (schema, error codes, exit codes)

Good luck! 🚀