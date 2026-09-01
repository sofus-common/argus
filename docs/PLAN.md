# ARGUS implementation plan

## Operating decisions

- Build one Python service, not microservices.
- Use official `alpaca-py` with `TradingClient(..., paper=True)` and its option
  data client. Do not use the obsolete `alpaca-trade-api` package.
- Use both surfaces: CLI plus `alpaca-py` is the sole governed write path;
  Alpaca MCP is read-only for research and demonstration.
- Use OpenRouter as a bounded inference adapter. Pin one model for scored runs;
  permit same-model provider fallback only.
- Use Codex as the primary development harness and Claude Code as an optional
  review/planning harness. Neither is part of the trading runtime.
- Run the product as plain Python. Do not add LangGraph, CrewAI, Strands, or AWS
  AgentCore until a measured orchestration need appears.
- Keep the dashboard read-only. One explicit CLI command owns paper execution.

## Delivery order

### M0 — credential-free vertical slice

Create a Python package with `src/argus`, `tests`, `.env.example`, and docs.
Add environment-only settings and immutable records for snapshots, candidates,
arm choices, paired outcomes, risk decisions, events, and claims. Ship one seeded
replay: snapshot → candidates → quant choice → recorded AI choice → paired
scoring → claim manifest → minimal scoreboard.

Verify: package install, tests, and full replay run without credentials.

### M1 — Alpaca gateway and data snapshots

Implement one SDK gateway. It owns account lookup, contract discovery with
explicit expiry bounds, option-chain data, orders, order status, positions,
and activities. Persist feed/timestamp metadata with every snapshot. Configure
Alpaca MCP with only `assets,stock-data,options-data,news`; exclude toolsets with
mutations.

Verify: fake-client tests cover paper-only configuration and request shape; an
operator can save a real snapshot with paper credentials.

### M2 — deterministic control and research runner

Implement a small parameterized baseline with abstention using RV-IV wedge, IV
term slope, skew, liquidity, and an observable regime. It selects a defined-risk
structure from the bounded universe and owns its trade fields. Backtest with
chronological/walk-forward splits, source cutoffs, costs, slippage, parameter
sensitivity, and a registered trial ID.

Verify: identical fixture input produces identical candidate and backtest output.

### M3 — OpenRouter AI ablation

Freeze the AI decision packet and strict schema. Pin model, prompt, schema,
temperature, token ceiling, routing policy, trial ID, and data cutoff. Persist
provider, token, cost, and latency metadata. Score all candidates where possible
so executed-choice selection does not hide counterfactual outcomes.

Verify: tests prove AI cannot change deterministic candidates; scored runs fail
closed if the model or experiment contract drifts.

### M4 — validation and public claims

Implement paired metrics, uncertainty, coverage/selective risk, abstention
value, cost sensitivity, drawdown comparison, and the trial registry. Generate
the claim manifest and keep null, negative, unsupported, and retracted results.

Verify: fixtures reproduce every public metric and insufficient evidence cannot
be promoted as supported.

### M5 — governor, paper order, reconciliation

Implement the governor before submission. Validate defined loss, 1% risk cap,
whole quantity, expiry/underlying policies, day TIF, paper client, and the
literal `--execute` flag. Record intent before submission and reconcile REST
order/position/activity state. Immediately reobserve relevant market and account
state; bind short-lived approval to the exact proposal hash and use a
deterministic client order ID.

Verify: rejected proposals never submit; approved proposals record intent then
result with a fake client.

### M6 — evidence-first app and demo

Add the five read-only views in [APP.md](APP.md): Scoreboard, Last Decision,
Decision Ledger, Falsification Lab, and Claims. Values must derive from event and
claim artifacts. Preserve credential-free replay for closed markets/provider
outages. No frontend build step unless plain server-rendered HTML proves
insufficient.

Verify: a smoke test starts the shell and reads fixture-ledger output.

## Module map

```text
src/argus/
  config.py       environment-only settings
  alpaca.py       official SDK gateway, paper mode only
  data.py         snapshot normalization
  quant.py        deterministic baseline
  inference.py    bounded OpenRouter adapter
  ablation.py     AI decision comparison
  validation.py   paired metrics and claim promotion
  risk.py         final order authority
  ledger.py       append-only evidence trail
  claims.py       public claim manifest
  backtest.py     repeatable research runner
  replay.py       credential-free seeded demo
  cli.py          operator commands
  api.py          read-only local status shell
tests/            fixture and fake-client tests
```

## Handoff decisions needed before M3/M4

1. Which underlying symbols and expiry range are allowed?
2. Is the first structure a defined-risk vertical debit spread, or another
   specified option structure?
3. What per-run budget applies to the initial pinned OpenRouter model,
   `google/gemini-2.5-flash-lite`, and what evidence would justify changing it?
4. What transaction-cost and slippage assumptions apply to the backtest?

Do not invent these product/risk choices in implementation.
