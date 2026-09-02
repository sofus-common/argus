# Validation protocol

## Pre-registration

Before each scored experiment, record the trial ID, frozen feature/candidate
code version, symbols, dates, costs, primary metric, model ID, prompt/schema
versions, routing policy, and stopping rule. Parameter searches and prompt/model
changes create new trials.

Before M2, freeze an outcome contract covering entry/fill rule, valuation source,
holding horizon and exit rule, expiration/assignment, stale or missing quotes,
the shared per-observation risk budget, abstention, overlapping positions, and
drawdown allocation. Missing counterfactuals retain a reason code and are never
silently dropped. The default abstention outcome is zero trading P&L minus
inference cost; any cash benchmark must be pre-registered instead.

## Uncertainty

The paired delta interval is a block bootstrap with `block=3`, `reps=2000`,
`seed=7`, all pre-registered. One unit is a snapshot and snapshots overlap in
time by design, so consecutive deltas are not independent. `score.json` reports
`max_leg_run`, the longest run of consecutive snapshots on identical legs, which
bounds the correlation the overlap can induce; a reader can check it against the
registered block length. Pairing removes most of the shared market move before
the delta is formed, so the overlap that inflates arm sums largely does not
survive into the difference series.

Two known deviations of the sampler from the registered scheme, recorded before
the run closed and deliberately not changed during it. Blocks are truncated at
the end of the array rather than wrapped, so the last observations are drawn less
often than the rest, which biases the resampled mean toward early observations
and slightly narrows the interval; the effect scales as block/n. And the
percentile indices are taken as `int(0.025*reps)` and `int(0.975*reps)`, which
read the 2.55th and 97.55th percentiles rather than the 2.5th and 97.5th,
displacing the interval marginally upward. Both are corrected after the run and
reported as a documented sensitivity check, not as a revision: editing the
sampler after seeing the interval it produces, in the direction that widens it,
is not distinguishable from tuning it.

The interval describes the mean paired delta per snapshot under the registered
resampling scheme. It is not a forecast of realized AI-versus-quant return, and
below the pre-registered minimum sample it is reported as descriptive only.

## Experimental unit

One unit is an immutable timestamped market snapshot and candidate set. Quant
control and AI treatment receive identical inputs and constraints. Record the
outcome of every valid candidate where market data permits, not only the
executed choice. This makes selection effects visible.

## Outcomes

Primary: paired net AI excess return versus control, normalized by the shared
pre-selection risk budget for that observation. Per observation:

`delta = (AI P&L - AI trading costs - inference cost - control P&L + control trading costs) / shared risk budget`

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

`SUPPORTED` is disabled unless the pre-registration fixes the minimum sample,
effect threshold, uncertainty level, drawdown limit, cost scenario, and one
multiple-testing method before scoring begins. The hackathon MVP does not need a
`SUPPORTED` result.

For broad strategy/model searches, use an appropriate control such as White's
Reality Check, Hansen's SPA, Deflated Sharpe Ratio, or probability of backtest
overfitting. Hackathon data will normally remain descriptive or exploratory.

## Public claim gate

Every displayed metric must map to a claim-manifest entry and SHA-256-addressed
source artifact. `SUPPORTED` is an experimental evidence state; public claim
statuses remain `REPRODUCIBLE`, `RECORDED`, `UNSUPPORTED`, or `RETRACTED`.
`REPRODUCIBLE` means the command consumes the exact public artifact; it does not
mean scientifically supported. Seeded fixtures reproduce replay claims only.
Live claims whose exact data cannot be published are `RECORDED` or `UNSUPPORTED`.
A positive performance headline requires both `SUPPORTED` and `REPRODUCIBLE`.
`CONTRADICTED` cannot support a positive claim. Corrections do not delete the
original claim.
