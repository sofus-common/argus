# ARGUS — does the AI earn its inference bill?

*One-page write-up for the Alpaca AI Trading Agents Hackathon (Options Alpha Agents track).*
*Fill the three bracketed numbers from `runs/paper/score.json` before submitting.*

**Short description (≤ 200 chars).** An autonomous options agent that runs a
deterministic quant and a bounded LLM on the same frozen trade shortlist, trades
the LLM's pick on Alpaca paper, and publishes whether the AI beat its own cost.

**The question.** Forty-plus entries in this track say "LLM proposes, code
decides." None of them measure what the LLM adds. ARGUS does: every cycle the
quant control and the AI arm receive an identical numeric packet, pick one
defined-risk spread or abstain, and both picks are marked from the same quotes
until exit. The product is one number — AI minus quant, after transaction and
inference costs — with its uncertainty and its sample size, published whether it
is positive, zero, or negative.

**AI logic.** Deterministic code freezes a market snapshot (SPY, QQQ; Alpaca
option chains, 7–21 DTE) and builds every $5-wide vertical — debit spreads
anchored at 0.40 delta, credit spreads anchored at 0.30 delta — whose max loss
fits 1% of equity: typically 48 candidates with features: anchor IV, 20-day
realized vol, the RV−IV wedge, IV term slope, quoted spread as % of mid, 20-day
return. The quant control applies a registered rule from the options
literature: sell premium (credit vertical) when IV is rich versus realized, buy
(debit vertical) when cheap, direction from the 20-day trend, rank by wedge. The AI
arm (`google/gemini-2.5-flash-lite` via OpenRouter, temperature 0, strict JSON
schema, no provider fallback, zero-data-retention routing) sees the same packet
and returns `{choice, confidence, reason_codes}`. It cannot invent or alter a
trade; a choice outside the packet is recorded as a refusal and scored as an
abstention. Packet hash, model, prompt and schema versions are pinned per trial.

**Risk gates.** Seventeen checks re-observed live before every order: paper
account · options level 3 · two legs · allowlisted underlying · expiry after
the flatten deadline · allowlisted structure · whole quantity · DAY · signed limit
matches kind (Alpaca MLEG: + debit / − credit) and sits inside the width · fresh-quote drift ≤ 15% · max loss ≤ 1% of min(equity,
$100k) · aggregate open max loss ≤ 5% · no leg already held · buying power ·
no new positions in the last 60 min before flatten · operator kill switch
absent. An approved proposal receives a 60-second HMAC authorization bound to
its hash; the gateway refuses missing, expired, forged, reused, or mismatched
authorizations. Exits: ±50% of the entry price, expiry guard, forced flatten one
hour before the deadline; unfilled closes are reconciled and retried. Costs are
modelled identically for both arms (25% of half-spread per leg per side plus
regulatory fees), inference cost is charged to the AI arm only.

**Alpaca infrastructure.** `alpaca-py` is the single governed write path:
`TradingClient(paper=True)` hardcoded, MLEG limit orders with deterministic
client order IDs, intent written to the ledger before submission, broker state
re-queried before any retry. The official **Alpaca CLI** runs after every cycle
as an independent read path (`account get`, `position list`, `order list`) and
records whether broker positions match the ledger; mismatches are surfaced,
never auto-fixed. The **Alpaca MCP server** is configured read-only
(`assets,stock-data,options-data,news`) for research and captured the replay
fixture. Market data: options snapshots (indicative feed), latest quotes, daily
bars. The agent loops autonomously every 30 minutes while the market is open.

**Evidence.** Append-only, SHA-256 hash-chained JSONL ledger; `score.json` is a
pure function of it; every displayed value maps to a claim with a source
artifact hash, a reproduction command, and a status (REPRODUCIBLE / RECORDED /
UNSUPPORTED / RETRACTED). Replay ledgers cannot enter scored aggregates. With
fewer than 30 paired observations the evidence state is DESCRIPTIVE; "AI beats
quant" is published as UNSUPPORTED. The evidence board, `argus replay`, and 15
tests run without credentials.

**Result at submission (paper account `[ACCOUNT_ID]`).** `[N]` paired
observations, `[K]` where AI ≠ quant. AI minus quant after inference:
`[$X.XX]`. Quant net `[$]`, AI net `[$]`, inference cost `[$]`. Evidence state
DESCRIPTIVE — a measurement apparatus with a real number on it, not a claim.

Repo: `[GITHUB_URL]` · Board: `[PAGES_URL]` · Video: `[VIDEO_URL]`
