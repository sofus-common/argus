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

For each bounded market-data run, ARGUS shall produce a deterministic baseline
candidate or abstention, an independently recorded AI recommendation or
abstention, a paired comparison, a falsification result, a risk-approved paper
order proposal, and an append-only evidence trail.

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
abstention. The control owns features, contract construction, strikes, expiry,
quantity, maximum loss, and execution instructions.

### AI ablation

AI receives a fixed decision packet and returns `bullish`, `bearish`, or
`abstain`, with confidence and a concise rationale. It cannot modify
control-owned fields. Explanations are not evidence.

### Falsification

Use paired outcomes over identical observations, costs, constraints, and data
feed. M1 rejects an AI-value claim with fewer than 20 pairs or non-positive
mean AI excess return. A passing result is only an in-sample finding.

### Risk and execution

Before submission, enforce paper mode, options-only symbols, whole contracts,
day time-in-force, defined maximum loss, a 1% configured-equity position-risk
cap, and underlying/expiry allowlists. An explicit operator action is required
to submit. Write order intent before calling Alpaca and reconcile orders,
positions, and activities afterward.

### Evidence ledger

M1 uses append-only JSONL. Each event has UTC timestamp, run ID, kind, inputs
or input hash, output, source-data identifiers, and a predecessor link.
Required kinds: `data_snapshot`, `baseline`, `ai_recommendation`, `ablation`,
`backtest`, `falsification`, `risk_decision`, `order_intent`, `order_result`,
and `reconciliation`.

## Operator surfaces

The selected companion surface is a CLI. Commands: `ingest`, `research`,
`backtest`, `propose-order`, `execute --execute`, `reconcile`, and `serve`.
`execute` dry-runs without the literal flag. A local read-only JSON/HTML shell
may show health, ledger, account state, and proposed/order state.

## M1 definition of done

An operator can ingest one underlying plus a bounded option universe, run the
control, record a supplied AI output, backtest both paths, obtain a
falsification decision, and produce a risk-capped paper-order proposal with a
complete ledger trail. M1 does not require order submission.
