# Accepted scope

Implements the user-approved five-step plan in docs/VALIDATION.md.
All capabilities are deterministic; no LLM is involved.

- AC1: unsafe quantities and overflowing totals fail closed across calculation,
  draft import and search, with regressions for the reported NaN.
- AC2: independent European/American price and sensitivity benchmarks pass with
  explicit numerical tolerances and expiry-boundary coverage.
- AC3: existing Optimize presentation can use dated validated market quotes,
  without synthetic fallback or silently treating midpoint as an executable fill.
- AC4: cost/fill and adverse price/time/IV comparisons retain explicit assumptions.
- AC5: replay tests and independent review pass before integration. Production
  release remains a separate human gate.
