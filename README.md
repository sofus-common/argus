# ARGUS — does the AI earn its inference bill?

Paper-only options agent for the Alpaca AI Trading Agents Hackathon. Every
cycle a deterministic quant control picks a defined-risk SPY/QQQ vertical
(debit or credit) from a frozen candidate set, and a bounded LLM picks from the
**same** set (or abstains). ARGUS trades the AI's choice on Alpaca paper, marks *both* choices
every cycle, and publishes the paired net difference after transaction and
inference costs — positive, zero, or negative.

The AI cannot invent or alter a trade. Deterministic code owns strikes, expiry,
quantity, maximum loss, and execution. A governor re-observes quotes and the
account before every order and signs a short-lived authorization bound to the
exact proposal hash; the Alpaca gateway refuses anything else. Everything is
written to a hash-chained JSONL ledger; every displayed number maps to a claim
with a source artifact SHA-256 and a reproduction command.

## Quick start

```bash
pip install -e ".[dev]"
pytest                    # 27 tests: determinism, AI bounding, governor gates, replay
argus replay              # credential-free: fixture → candidates → both arms → governor → fill → marks → score → site
open runs/replay/site/index.html
```

With a **fresh, dedicated $100k paper account** (`cp .env.example .env`, fill keys):

```bash
argus status                                   # account + positions (paper=True is hardcoded)
argus run                                      # one dry-run cycle: nothing is submitted without --execute
argus loop --execute --interval 30 --publish docs/site/index.html   # autonomous while market open
argus halt                                     # kill switch; governor refuses everything until `argus resume`
argus reconcile                                # official Alpaca CLI vs ledger (independent read path)
argus score && argus verify                    # paired metrics; ledger hash-chain check
```

## What the AI sees and may do

Both arms receive one serialized numeric packet: ~48 candidates (bull call /
bear put debit verticals anchored at 0.40 delta, bull put / bear call credit
verticals anchored at 0.30 delta, $5 wide, 7–21 DTE) with structure, kind,
expiry, DTE, quantity, signed entry price, max loss, and features (anchor
delta, IV, 20-day realized vol, RV−IV wedge, IV term slope, spread % of mid,
20-day return). The packet hash is recorded. The AI (`google/gemini-2.5-flash-lite`
via OpenRouter, temperature 0, strict JSON schema, no provider fallback,
zero-data-retention routing) returns `{choice, confidence, reason_codes}`. Any
choice outside the packet is recorded as a refusal and scored as abstention.

## Quant control (registered)

Liquidity gate (spread ≤ 8% of mid) → regime by RV−IV wedge: IV rich
(wedge ≤ −0.01) sells premium with a credit vertical, IV cheap (wedge ≥ −0.10)
buys a debit vertical (Goyal & Saretto 2009) → direction must match the 20-day
trend (|ret20| ≥ 0.5%) → rank by wedge (richest IV for credit, cheapest for
debit). All thresholds live in `.env.example`; changing any is a new trial.

## Risk gates (every proposal, re-observed live)

Paper account · options level 3 (spreads) · exactly two legs · allowlisted
underlying · expiry after the flatten deadline · allowlisted structure · whole
positive quantity · DAY time-in-force · signed limit matches kind (Alpaca
MLEG: + debit / − credit) and sits inside the width ·
fresh-quote drift ≤ 15% · max loss ≤ 1% of min(equity, $100k) · aggregate open
max loss ≤ 5% · no leg already held (no stacking the same spread) · buying
power · no new positions in the last 60 min before flatten · operator HALT
absent. Sixteen checks, each recorded with its detail in the `risk_decision`
event. Exits: ±50% of the entry price, expiry guard, or forced flatten at
`ARGUS_FLATTEN_AT` (15:30 ET Thursday 3 Sep — Alpaca scores total equity as of
that day's close, so ARGUS ends the window in cash rather than in broker marks
on open spreads); unfilled closes are reconciled and retried with a fresh
client order ID, aggressively at flatten. Costs modelled
identically for both arms: 25% of the half-spread per leg per side plus $0.05
regulatory fees per contract per side (Alpaca charges no options commission).

## Alpaca surfaces — and why the write path is the official SDK

- **`alpaca-py` (official SDK)** is the only write path: `TradingClient(paper=True)`
  hardcoded, MLEG limit orders with signed net prices, deterministic client
  order IDs, intent-before-submit, reconcile-before-retry. Reason: the governor
  must bind a 60-second authorization to the exact proposal hash and verify it
  *inside the same process* immediately before the broker call; that contract
  cannot be enforced through a conversational MCP tool call or a shell
  invocation, where the model or the operator could alter the order between
  approval and submission. The SDK gives the governor a typed request it can
  hash, sign, submit, and re-query for reconciliation.
- **Alpaca CLI** (official `alpaca` binary) is an independent read path: after
  every cycle `account get`, `position list`, `order list` are compared with
  the ledger and any mismatch is recorded, never auto-fixed.
- **Alpaca MCP** is read-only for research and demos:
  `ALPACA_TOOLSETS=assets,stock-data,options-data,news`. The fixture in
  `fixtures/replay/` was captured through it.

## Evidence

`runs/paper/events.jsonl` is append-only and hash-chained (`argus verify`).
`score.json` is a pure function of the ledger; `claims.json` maps each displayed
value to its artifact hash and reproduction command. Replay ledgers carry
`run_mode=replay` and are rejected by the paper ledger by construction. With
fewer than 30 paired observations the evidence state is `DESCRIPTIVE`; the
claim "AI beats quant" is published as `UNSUPPORTED` until a pre-registered
`SUPPORTED` result exists — which this hackathon window cannot produce.

## Docs

[Submission one-pager](docs/SUBMISSION.md) · [Pitch](docs/PITCH.md) ·
[Spec](docs/SPEC.md) ·
[Plan](docs/PLAN.md) · [Thesis](docs/THESIS.md) ·
[Validation](docs/VALIDATION.md) · [App](docs/APP.md) ·
[Research](docs/RESEARCH.md)

## Disclosure

All work was done inside the hackathon window: planning documents on 1 Sep
2026, all code on 2 Sep 2026 (see `git log`). No pre-event code, libraries, or
infrastructure were reused. The agent went live on the dedicated $100k paper
account on Wednesday 2 Sep at 09:30 ET; equity before that is untouched.

MIT licensed. Paper trading only; nothing here is investment advice.
