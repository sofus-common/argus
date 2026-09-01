# ARGUS implementation plan

## Operating decisions

- Build one Python service, not microservices.
- Use official `alpaca-py` with `TradingClient(..., paper=True)` and its option
  data client. Do not use the obsolete `alpaca-trade-api` package.
- Use a CLI for the hackathon's “MCP or CLI” condition. Do not build an MCP
  server unless an agent-facing demo specifically needs it.
- Keep the dashboard read-only. One explicit CLI command owns paper execution.

## Delivery order

### M0 — repository and safety foundation

Create a Python package with `src/argus`, `tests`, `.env.example`, and docs.
Add environment-only settings and immutable records for run IDs, candidates,
AI recommendations, risk decisions, and ledger entries.

Verify: package install and tests run without credentials.

### M1 — Alpaca gateway and data snapshots

Implement one SDK gateway. It owns account lookup, contract discovery with
explicit expiry bounds, option-chain data, orders, order status, positions,
and activities. Persist feed/timestamp metadata with every snapshot.

Verify: fake-client tests cover paper-only configuration and request shape; an
operator can save a real snapshot with paper credentials.

### M2 — deterministic control and research runner

Implement a small parameterized baseline with abstention. It selects a
defined-risk structure from the bounded universe and owns its trade fields.
Backtest the same rules while recording assumptions, costs, and results.

Verify: identical fixture input produces identical candidate and backtest output.

### M3 — AI ablation and claim falsification

Freeze the AI decision packet and adapter protocol. Begin with recorded AI
outputs if provider choice is still open. Persist paired results and apply the
20-sample/positive-mean-excess-return gate.

Verify: tests prove AI cannot change control-owned fields and prove the gate
rejects insufficient or no-edge evidence.

### M4 — governor, paper order, reconciliation

Implement the governor before submission. Validate defined loss, 1% risk cap,
whole quantity, expiry/underlying policies, day TIF, paper client, and the
literal `--execute` flag. Record intent before submission and reconcile REST
order/position/activity state.

Verify: rejected proposals never submit; approved proposals record intent then
result with a fake client.

### M5 — minimal demo surface

Add a local read-only shell showing health, last research run, evidence, paper
account summary, and order state. No frontend build step.

Verify: a smoke test starts the shell and reads fixture-ledger output.

## Module map

```text
src/argus/
  config.py       environment-only settings
  alpaca.py       official SDK gateway, paper mode only
  data.py         snapshot normalization
  quant.py        deterministic baseline
  ablation.py     AI decision comparison
  falsification.py paired-performance gate
  risk.py         final order authority
  ledger.py       append-only evidence trail
  backtest.py     repeatable research runner
  cli.py          operator commands
  api.py          read-only local status shell
tests/            fixture and fake-client tests
```

## Handoff decisions needed before M3/M4

1. Which underlying symbols and expiry range are allowed?
2. Is the first structure a defined-risk vertical debit spread, or another
   specified option structure?
3. Which AI provider/model, budget, and prompt-retention rules apply?
4. What transaction-cost and slippage assumptions apply to the backtest?

Do not invent these product/risk choices in implementation.
