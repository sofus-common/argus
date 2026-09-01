# ARGUS thesis

## Testable claim

Implied-versus-realized volatility, volatility term structure, skew, liquidity,
and textual information contain economically meaningful signals. LLMs may
extract incremental information, but can also be miscalibrated, contaminated by
memorization, or fail live. ARGUS tests whether a bounded AI selector or
abstainer improves an otherwise identical deterministic options strategy after
costs.

The null hypothesis is that paired net AI excess return is no better than zero.
The alternative is positive paired net excess return under the pre-registered
evaluation, without unacceptable drawdown, coverage, or cost deterioration.

## Mechanism under test

Deterministic code freezes the market snapshot and constructs all valid,
defined-risk candidates. The quant control and AI arm see the same candidates,
features, costs, and constraints. AI may select a candidate or abstain; it may
not invent or alter a trade.

The plausible AI contribution is narrow: extracting context or nonlinear
interactions that change selection or improve abstention. If AI agrees with the
control, its incremental decision value is zero for that observation.

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
defined-risk structure is inherently superior.
