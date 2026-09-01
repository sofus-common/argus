# ARGUS thesis

## Testable claim

Implied-versus-realized volatility, volatility term structure, and liquidity
have been associated with option outcomes in prior samples. LLMs may extract
incremental information, but can also be miscalibrated, contaminated by
memorization, or fail live. ARGUS tests whether a bounded AI selector or
abstainer improves an otherwise identical deterministic options strategy after
costs.

The null hypothesis is that paired net AI excess return is no better than zero.
The alternative is positive paired net excess return under the pre-registered
evaluation, without unacceptable drawdown, coverage, or cost deterioration.

## Mechanism under test

Deterministic code freezes the market snapshot and constructs all valid,
defined-risk candidates. In the primary trial, the quant control and AI arm see
the same serialized numeric packet, candidates, costs, and constraints. A
separate `ai_plus_text` trial may test a frozen text bundle and must be labeled as
AI plus extra information. AI may select a candidate or abstain; it may not
invent or alter a trade.

The plausible AI contribution is narrow: extracting context or nonlinear
interactions that change selection or improve abstention. If AI agrees with the
control, its gross decision difference is zero; its net incremental value is
negative by inference cost and any measured latency impact.

## Predictions

- AI should change or abstain on enough decisions to be testable.
- Changed decisions should improve paired net outcomes, not merely gross P&L.
- Selective abstention should improve risk at a stated coverage level.
- Any advantage should survive plausible transaction costs and chronological
  out-of-sample evaluation.
- Inference cost and latency should not erase the measured benefit.

## Evidence boundary

Research supports testing these mechanisms; it does not validate ARGUS. A
small positive paper-trading sample is exploratory. A null or negative result
is a valid product result and remains in the public ledger. ARGUS will not claim
that AI beats quant, that a backtest proves future profitability, or that a
defined-risk structure is inherently superior. Results from cross-sectional or
index-option research do not automatically transfer to ARGUS's eventual symbols,
holding period, or spread structure.
