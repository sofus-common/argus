# ARGUS specification

## Purpose

ARGUS is a paper-only options research system for the Alpaca hackathon. Its
core deliverable is evidence, not autonomous activity: it measures a proposed
AI-assisted decision against an identical deterministic quant-only control.

## Supplied competition constraints

- Use the supplied $100,000 Alpaca paper account.
- Trade options; an equity-only strategy is out of scope.
- Integrate the Alpaca Trading API and either an MCP server or a CLI.
- Optimise for transparent P&L, creativity, and engagement without claiming
  unverified performance.

## Product outcome

For each bounded market-data run, ARGUS shall freeze one timestamped snapshot
and deterministic candidate set. The quant control and bounded AI arm shall
independently choose one candidate or abstain. ARGUS shall record their paired
comparison, counterfactual outcomes for all valid candidates, a falsification
result, a risk-approved paper-order proposal, and an append-only evidence trail.

## Non-goals for M1

- Live trading, another broker, or automatic account fallback.
- Microservices, an agent framework, or a bespoke web frontend.
- Backtest cherry-picking or statistical-significance claims from a hackathon sample.

## Invariants

### Market data

Persist source timestamp, query parameters, symbols, and feed with every run.
Do not compare results across feeds without recording the difference.

### Deterministic control

Same normalized input and configuration must yield the same candidate or
abstention. Initial options-native features are the realized-minus-implied
volatility wedge, implied-volatility term slope, skew, liquidity/spread quality,
and a simple observable regime. Implied volatility is treated as an informative
market forecast, not presumed error. Deterministic code owns candidate creation,
strikes, expiry, quantity, maximum loss, and execution instructions.

### AI ablation

AI receives the same frozen snapshot and immutable candidate IDs as the control.
It returns strict structured data: `candidate_id` or `abstain`, `confidence`,
and `reason_codes`. It cannot create or modify contracts, strikes, expiry,
quantity, maximum loss, or execution fields.
Explanations and uncalibrated confidence are not evidence.

OpenRouter is the bounded inference adapter. The initial cost-aware scored model
is `google/gemini-2.5-flash-lite`; changing it creates a new trial. Scored runs pin model ID,
prompt and schema versions, temperature 0, token ceiling, data cutoff, and
trial ID. Only same-model provider fallback is allowed. Requests require
supported parameters and strict JSON Schema, zero-data-retention routing, and
provider data collection disabled. Record selected provider, tokens, cost, and
latency. Free/random model routing is permitted for wiring demos only, never
scored comparisons.

### Falsification

Use paired net outcomes over identical observations, candidates, costs,
constraints, and data feed. Predeclare primary metrics and trial count before a
scored run. Report paired AI excess return with uncertainty, drawdown difference,
decision-change count, coverage/selective risk, abstention value, cost
sensitivity, and inference cost. Use chronological or walk-forward splits and
block-bootstrap uncertainty where appropriate. Apply multiple-testing controls
such as White's Reality Check, SPA, Deflated Sharpe Ratio, or PBO when the search
scope warrants them. Hackathon-sized results remain exploratory unless the
stronger pre-registered requirements in [VALIDATION.md](VALIDATION.md) are met.

### Risk and execution

Before submission, enforce paper mode, options-only symbols, whole contracts,
day time-in-force, defined maximum loss, a 1% configured-equity position-risk
cap, and underlying/expiry allowlists. Reobserve quote, Greeks, account,
positions, and maximum loss immediately before submission. An explicit,
short-lived operator approval must bind to the exact proposal hash. Write order
intent with a deterministic client order ID before calling Alpaca; reconcile
uncertain outcomes before retrying.

### Evidence ledger

M1 uses append-only JSONL. Each event has UTC timestamp, run ID, kind, inputs
or input hash, output, source-data identifiers, and a predecessor link.
Required kinds: `data_snapshot`, `baseline`, `ai_recommendation`, `ablation`,
`backtest`, `falsification`, `risk_decision`, `order_intent`, `order_result`,
and `reconciliation`.

Public claims use a separate manifest with `claim_id`, `displayed_value`,
`source_artifact`, `reproduction_command`, `status`, and `last_verified_at`.
Allowed statuses are `REPRODUCIBLE`, `RECORDED`, `UNSUPPORTED`, and `RETRACTED`.
Unsupported and retracted claims remain visible.

## Operator surfaces

Use both CLI and Alpaca MCP with narrow authority. The CLI and `alpaca-py`
gateway are the sole governed write path. Alpaca MCP is read-only for research
and demonstration. Its `ALPACA_TOOLSETS` allowlist is limited to `assets`,
`stock-data`, `options-data`, and `news`; `trading`, `account`, and `watchlists`
are excluded because those toolsets contain mutations. CLI commands: `ingest`,
`research`, `backtest`, `replay`, `propose-order`, `execute --execute`,
`reconcile`, and `serve`. `execute` dry-runs without the literal flag. The app
is read-only and defined in [APP.md](APP.md).

## M1 definition of done

Without credentials, an operator can replay one seeded snapshot through
candidate creation, quant choice, recorded AI choice, paired scoring, validation,
claim manifest, and scoreboard. With credentials, the same path can ingest one
underlying and bounded option universe through Alpaca. M1 does not require order
submission or a positive AI result.
