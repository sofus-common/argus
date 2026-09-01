# Research basis

This literature motivates ARGUS's features and evaluation. It does not prove
that ARGUS, an option strategy, or an LLM will be profitable.

## Options signals and frictions

| Source | Finding used | ARGUS implication |
|---|---|---|
| [Christensen & Prabhala (1998)](https://doi.org/10.1016/S0304-405X(98)00034-8) | Implied volatility contains information about future realized volatility. | Treat IV as a forecast, not an error by default. |
| [Goyal & Saretto (2009)](https://doi.org/10.1016/j.jfineco.2009.01.001) | Realized-minus-implied volatility relates to cross-sectional option returns. | Include an RV-IV wedge in the deterministic control. |
| [Vasquez (2017)](https://www.cambridge.org/core/product/identifier/S002210901700076X/type/journal_article) | Equity IV term-structure slope predicts option returns. | Include term slope as a predeclared feature. |
| [Christoffersen et al. (2018)](https://doi.org/10.1093/rfs/hhx113) | Equity option illiquidity carries a premium. | Measure spread/liquidity and model execution costs. |
| [Bali et al. (2023)](https://doi.org/10.1093/rfs/hhad017) | Nonlinear methods predict option returns after modeled costs. | Permit nonlinear AI selection, but compare it with a strong control after costs. |
| [Driessen et al. (2009)](https://doi.org/10.1111/j.1540-6261.2009.01467.x) | Apparent option-strategy returns are sensitive to implementation frictions. | Publish cost sensitivity; do not headline frictionless results. |
| [Broadie, Chernov & Johannes (2009)](https://doi.org/10.1093/rfs/hhp032) | Extreme payoffs and small samples can mislead option-return inference. | Keep hackathon findings provisional and report uncertainty. |
| [Muravyev & Pearson (2020)](https://doi.org/10.1093/rfs/hhaa010) | Execution timing changes measured effective option spreads. | Freeze timing assumptions and revalidate before execution. |

## AI role and abstention

| Source | Finding used | ARGUS implication |
|---|---|---|
| [Gu, Kelly & Xiu (2020)](https://doi.org/10.1093/rfs/hhaa009) | Machine learning can capture nonlinear interactions in return prediction. | Use a deterministic quantitative control before attributing value to AI. |
| [FinBen (2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/adb1d9fa8be4576d28703b396b82ba1b-Abstract-Datasets_and_Benchmarks_Track.html) | Financial LLM performance varies by task; extraction is more credible than unsupported forecasting. | Bound AI to selection/context extraction and test its output. |
| [DeepFund (2025)](https://proceedings.neurips.cc/paper_files/paper/2025/hash/f37b0e09b90e9a6833aacf5768362b54-Abstract-Datasets_and_Benchmarks_Track.html) | A live post-cutoff benchmark exposes leakage and weak real-world trading performance. | Require chronological, post-cutoff evaluation and preserve negative results. |
| [SelectiveNet (2019)](https://proceedings.mlr.press/v97/geifman19a.html) | Selective prediction evaluates risk against coverage when a model may abstain. | Measure abstention value and coverage; do not treat raw confidence as calibrated. |

## Validation and data snooping

| Source | Finding used | ARGUS implication |
|---|---|---|
| [White (2000)](https://doi.org/10.1111/1468-0262.00152) | Testing many strategies inflates apparent significance. | Register trials and apply a Reality Check when search breadth warrants it. |
| [Hansen (2005)](https://doi.org/10.1198/073500105000000063) | SPA improves inference when comparing many predictive rules. | Use SPA as an available multi-model correction. |
| [Bailey & Lopez de Prado (2014)](https://doi.org/10.3905/jpm.2014.40.5.094) | Sharpe estimates should account for selection and non-normality. | Report Deflated Sharpe only with the required trial metadata. |
| [Bailey et al. (2017)](https://doi.org/10.21314/jcf.2016.322) | Cross-validation can estimate probability of backtest overfitting. | Use PBO/CSCV when enough configurations and history exist. |

## Claim boundary

The cited work concerns different samples, periods, instruments, tasks, and
cost models. ARGUS must reproduce its own results. Text-based LLM findings and
selective-prediction theory justify experiments, not a claim that LLM confidence
is calibrated or that AI produces options alpha.

Current product/competition observations are documented separately in
[APP.md](APP.md#competition-informed-choices) so academic evidence and competitor
submission claims are not conflated.
