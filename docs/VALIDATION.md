# Validation protocol

## Pre-registration

Before each scored experiment, record the trial ID, frozen feature/candidate
code version, symbols, dates, costs, primary metric, model ID, prompt/schema
versions, routing policy, and stopping rule. Parameter searches and prompt/model
changes create new trials.

## Experimental unit

One unit is an immutable timestamped market snapshot and candidate set. Quant
control and AI treatment receive identical inputs and constraints. Record the
outcome of every valid candidate where market data permits, not only the
executed choice. This makes selection effects visible.

## Outcomes

Primary: paired net AI excess return versus control after modeled transaction
costs and inference cost.

Required diagnostics:

- sample count and number of changed decisions;
- uncertainty interval using a block bootstrap where observations overlap;
- maximum-drawdown difference;
- coverage, selective risk, and abstention value;
- transaction-cost and slippage sensitivity;
- inference cost, tokens, and latency;
- results by predeclared regime;
- total trial count and chosen multiple-testing correction.

Use chronological or walk-forward evaluation. Freeze source timestamps, avoid
future text, and record model knowledge cutoffs. Never tune on the final holdout.

## Evidence states

- `DESCRIPTIVE`: fewer observations than the pre-registered minimum; report only.
- `EXPLORATORY`: evaluated out of sample but not sufficient for a promoted claim.
- `SUPPORTED`: meets the pre-registered effect, uncertainty, cost, drawdown, and
  trial-correction requirements.
- `CONTRADICTED`: the result opposes the registered claim.

For broad strategy/model searches, use an appropriate control such as White's
Reality Check, Hansen's SPA, Deflated Sharpe Ratio, or probability of backtest
overfitting. Hackathon data will normally remain descriptive or exploratory.

## Public claim gate

Every displayed metric must map to a claim-manifest entry and immutable source
artifact. `SUPPORTED` is an experimental evidence state; public claim statuses
remain `REPRODUCIBLE`, `RECORDED`, `UNSUPPORTED`, or `RETRACTED`. A reproduction
command must run against the seeded public fixtures without secrets. Corrections
do not delete the original claim.
