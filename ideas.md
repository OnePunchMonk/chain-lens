# Chain Lens — Extra Feature Ideas

Ideas for features you can add on top of the current implementation. Pick by impact, effort, and grading criteria.

---

## High impact, moderate effort

### 1. **Relative timelock calculator (BIP68)**
- Show BIP68 values as human time: e.g. `value: 1008 blocks` → “~1 week (at 10 min/block)”.
- Add a small “blocks ↔ time” helper in the UI for block-based and time-based relative timelocks.
- *Why:* Makes a complex topic understandable; often called out in evaluation.

### 2. **Fee marketplace context**
- Use a static/cached table of recent fee percentiles (e.g. 1–3 buckets: low / medium / high).
- Show: “This fee rate is in the **X** percentile” and a simple badge (e.g. ✓ competitive, ⚠ high).
- *Why:* Directly addresses “fee and fee rate” in plain language.

### 3. **Animated value flow**
- Animate the value-flow diagram: sats moving from inputs → outputs, with fee as the “missing” slice.
- Optional: pause on click to inspect a single flow; color by script type.
- *Why:* Strong visual for “what a transaction is” and “who paid whom.”

### 4. **Change address heuristic**
- Heuristic: e.g. single output with same script type as an input, or “smallest non-fee output” as likely change.
- Show a “likely change” label with a short tooltip that it’s a guess.
- *Why:* Helps non-experts see “where did my change go?”

---

## Block mode & education

### 5. **Merkle tree visualization**
- For block mode: small diagram of the merkle tree (nodes = hashes, leaves = txids).
- Highlight the path used to compute the root; optionally flag mismatches.
- *Why:* Demonstrates understanding of block structure and merkle verification.

### 6. **Block stats dashboard**
- Script type distribution (e.g. pie or bar).
- Simple histogram of tx size or fee rate.
- Coinbase breakdown: subsidy + fees.
- *Why:* Good for “block overview” and manual evaluation.

### 7. **Intra-block spending**
- In block mode, detect when a tx spends an output created earlier in the same block.
- Highlight those txs and optionally show “depends on tx #N in this block.”
- *Why:* Shows awareness of tx ordering and validity.

---

## Parsing & robustness

### 8. **Multisig witness script disassembly**
- For P2WSH (and P2SH-P2WSH): parse witness script as `OP_M [pubkey]... OP_N OP_CHECKMULTISIG`.
- Show “M-of-N multisig” and, if possible, list derived addresses.
- *Why:* Handles hidden fixture categories and shows script literacy.

### 9. **Graceful empty prevouts**
- If prevouts are missing or empty: still render the tx (txid, structure, outputs, weight).
- Show “Unknown input value” and a short message: “Add prevouts to see fees and addresses.”
- *Why:* Better UX and robustness without changing the API contract.

### 10. **Truncated/malformed tx errors**
- On parse failure, try to report “Truncated at byte N” or “Expected witness item K.”
- Keep returning structured JSON errors with a clear `code` and `message`.
- *Why:* Helps debugging and satisfies “error handling” criteria.

---

## UX & accessibility

### 11. **Export options**
- “Download JSON” (full report) and “Copy JSON” to clipboard.
- Optional: print-friendly CSS (e.g. high contrast, no heavy colors).
- *Why:* Useful for sharing and documentation.

### 12. **Keyboard navigation**
- Tab through inputs/outputs; Enter/Space to expand/collapse details.
- *Why:* Accessibility and power users.

### 13. **Dark/light + system preference**
- Toggle or auto-detect `prefers-color-scheme` and switch theme.
- *Why:* Often mentioned in “polish” and accessibility.

---

## Optional / stretch

### 14. **BIP9 version bits (block mode)**
- Parse block header version bits and label known softforks (e.g. SegWit, Taproot).
- *Why:* Shows protocol depth; block-only.

### 15. **Script pattern labels**
- Heuristics: e.g. “Lightning-like” (specific script pattern), “Coinjoin-like” (many equal inputs).
- Show as a small badge with a short explanation.
- *Why:* Educational and memorable.

### 16. **Side-by-side comparison**
- Load two transactions and show diff-style view: fee, script types, locktime, etc.
- *Why:* Helps compare strategies (e.g. RBF vs non-RBF).

---

## Suggested order

1. Fix grading issues (CLI JSON, block fees) — **done**.
2. Add **relative timelock calculator** and **fee context** (high impact, fits README topics).
3. Add **animated value flow** or **change heuristic** (visible in UI).
4. Add **export (download/copy JSON)** and **keyboard nav** (low effort, high polish).
5. Block mode: **merkle viz** or **block stats dashboard** if you focus on block grading.

Use this list as a backlog; implement in small steps and re-run the grader after each change.
