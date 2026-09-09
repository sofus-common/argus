# ARGUS — does the AI earn its inference bill?

## AI-native options builder PoC

The new local PoC is an OptionStrat-style strategy workspace with 23
templates, custom one- to four-leg composition, payoff and price/time views,
deterministic risk metrics, and an AI sparring rail. AI responses are proposals:
assumptions, objections, and metric changes are shown before Accept or Reject.
The UTC scenario-date control and time slider update the solid modeled P/L curve
and Greeks; the dashed curve remains an expiration/first-expiry reference. Click
a heatmap cell, or inspect with arrow keys and select with Enter/Space, to apply
its date and spot. These changes share AI context, saved state and Undo. Modeling
stops at the first expiry; moving time is a what-if scenario, not a forecast.
The builder starts with a normalized replay-safe SPY sample. Select **Use real
prices** to load Tastytrade SPY contracts, or enter a standard equity/ETF ticker
and select **Load symbol**. QQQ and AAPL have been checked against real provider
responses. Each symbol uses its own contracts, underlying quote, news and expiry
schedule; unsupported or incomplete provider data fails without changing the position.
Loading a symbol rebuilds the template; Undo restores the previous position.
The window includes bid/ask quotes and provider IV for up to
100 contracts across two expiries and 25 strikes per expiry. All 23 templates
use listed strikes. Midpoint is the default entry estimate; buy-at-ask/sell-at-bid
is selectable. Neither promises a fill. Quote timestamps remain visible; this is
an explicitly refreshed snapshot, not a streaming feed. Refresh preserves selected
contracts and quantities or fails without changing the position. Changing the
chain window explicitly rebuilds the template. Sample mode is never a fallback.
Within **Choose chain window**, set **Strike center** and select **Browse strikes**
to load another strike neighborhood while keeping selected legs and quantities.
Those legs are retained inside the bounded quote window. Browsing refreshes quotes
and re-estimates entry unless **Keep entry costs** is enabled. Held per-share costs
are editable and survive refresh, basis changes, and save/load; they are not broker-
verified fills. Changing a contract or side initializes that leg from quotes.
**Re-estimate entry** explicitly resets costs. Dated liquidation estimates use
midpoint or sell-long-at-bid/buy-short-at-ask prices, separately from scenario P/L.
Neither includes fees or guarantees a fill. Refresh retains the
committed center; Undo restores the prior catalog and center.
Server snapshots use shared D1 storage for ten minutes, scoped to the owner and
provider credential fingerprint. Other app instances can resolve the same handle;
expired handles require refresh rather than trusting client quotes. Apply local
migrations before running real pricing. Separate, dated market context comes from Alpaca quotes/news, FRED rates, Exa official-source research
and Tastytrade underlying quotes. ThetaData supplies local contract-reference
metadata only, not live option prices. There is no account or order path.

Alpaca cash-dividend context supplies validated provider-reported upcoming ex-dates
to the AI and its existing source disclosure. The bounded query uses provider
process dates; those and retrieval time are not ex-dates. Missing results do not
prove there is no event. This is not a complete earnings/dividend calendar and
does not change the model dividend yield or simulate discrete dividend cashflows.

Tastytrade underlying IV-index/rank and liquidity metrics are separate contextual
sources. Missing/stale timestamps fail closed. Raw provider scores do not replace
contract IV or establish executable liquidity; record update time is not a quote
observation. The source disclosure preserves those limits rather than implying
that a provider score is a trade recommendation or probability of profit.

Provider-reported earnings dates use the earnings record timestamp and explicit
estimate flag. Even estimated=false is not treated as issuer confirmation; no
report session, expected move or EPS association is inferred. Missing/stale
records are disclosed as gaps, not absence of an upcoming report.

Open **Events & market context** in the sparring rail and select **Load context**
to inspect dated sources without running AI or changing the position. Earnings
and dividends appear first. Refresh may reuse the shared60-second cache; AI
requests retrieve their own context. Changing symbol clears the displayed results.

```bash
pnpm --dir web install
pnpm --dir web db:migrate:local
pnpm --dir web dev
```

Open `http://127.0.0.1:5173`. OpenRouter is optional for local use. Local development
loads the allowlisted keys in `web/.dev.vars.example` from the repository `.env`
(or the main checkout's `.env` when using a worktree). `web/.dev.vars` is also
supported. Credentials stay in Worker bindings and are never included in the client.
For local development, `http://theta-terminal:25503` maps to the Docker-published
`http://127.0.0.1:25503`. This loopback integration is unavailable on Cloudflare;
the other providers use cloud-reachable HTTPS APIs. Do not expose the terminal
publicly. Commercial data redistribution and Tastytrade user authorization are
separate release gates for any later public product; this workspace is private.

### Private workspace

The local development server supplies an explicit loopback-only identity. Saved
workspace controls offer Save, Save as new, Load and Delete; there is no autosave.
Records persist in local D1 under `web/.wrangler/state`. Revisions prevent a stale
tab from overwriting another save. Loading goes through the builder's Undo path.
Real quote catalogs are copied from the server cache, never accepted from the
browser. Reopened quotes are marked historical and keep their original quote and
valuation timestamps. Refresh prices is a separate action. Snapshot handles and
records are scoped to the authenticated owner; API responses are not cached.
The saved picker loads 50 records at a time. **Load more saved positions** reaches
older records; **Refresh saved positions** restarts from the newest page. Records
changed elsewhere can move ahead of a cursor, so refresh to see new or updated
records. Refresh may clear an older picker selection with an explicit notice;
it never replaces the open position. Pending pages are discarded after refresh.

Export saved JSON downloads the selected record's current stored revision,
including original quote data and close/roll/correction history. It excludes
unsaved edits and AI conversations. Keep exports private. The versioned JSON
format supports preview and import as a new private saved record; it never
overwrites the original. Imported quotes remain historical and unverified.

Stock-only positions support signed shares, held costs, scenario curves/tables,
frozen comparison, saved remaining holdings and underlying-only stream capture.
They have no option expiry or expiry probability. Capture and refresh preserve
entry cost; Undo restores the prior position. Streaming limits apply to the
underlying bid/ask timestamps even when no options remain.

The private app is deployed at https://easyoptions.trading behind Cloudflare
Access and an explicit user allowlist. Required production settings are `ACCESS_TEAM_DOMAIN`
(full HTTPS team origin), `ACCESS_AUD`, `APP_ORIGIN` (exact HTTPS app origin), and
a real `DB` D1 binding with migrations applied. The Worker verifies Access JWTs
for HTML, assets and APIs. Missing configuration fails closed; workers.dev and
preview URLs are disabled. Production output contains no development identity or
local database binding. Do not use `wrangler.local.json` as a deployment config.
Keep the dev server bound to loopback; local development is not a hosted login.
Release verification must test every enabled hostname with and without Access.

Hosted Theta history now has a separate `THETA_RELAY` Durable Object binding.
It is inactive until server configuration supplies `THETA_RELAY_ORIGIN` (a fixed
HTTPS origin), `THETA_ACCESS_CLIENT_ID` and `THETA_ACCESS_CLIENT_SECRET`. Store
the service credentials as Worker secrets. Incomplete configuration fails closed;
it never falls back to a local terminal. Every hosted catalog/EOD request uses
the same `theta-terminal` object, including across users and credential rotation.
The object rejects concurrent batches and persists request-start spacing and a
recovery lease. Timeouts cannot prove the terminal stopped processing upstream.

Provisioning is not performed here. Use a dedicated Cloudflare Tunnel hostname
with an Access **Service Auth** policy permitting only the dedicated service token.
The terminal must remain bound to loopback/internal networking. Tunnel ingress
must allow only this exact read-path pattern, followed by a catch-all 404:

```yaml
ingress:
  - hostname: theta.example.com
    path: ^/v3/(option/(list/expirations|history/eod)|stock/history/eod)$
    service: http://127.0.0.1:25503
    originRequest:
      access:
        required: true
        teamName: YOUR_TEAM
        audTag:
          - YOUR_THETA_ACCESS_AUDIENCE
  - service: http_status:404
```

Replace the placeholders only during authorized setup. This follows Cloudflare's
[service-token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
and [Tunnel ingress](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)
controls; it is not evidence that the hostname is protected. Before enabling use,
verify absent/wrong tokens, every non-allowlisted path, direct-origin denial and
two authenticated users' isolated histories. Do not run direct local Theta calls
or local relay emulators alongside hosted use: neither shares the deployed
admission state. Local development does not automatically load relay credentials
from `.env`; never inject real relay credentials into local emulators while the
hosted service uses that terminal. Local and hosted tests with
mocked transport do not establish real Tunnel security or Theta availability.

Analysis uses `google/gemini-3.8-flash` through OpenRouter with medium reasoning,
no provider fallback and data collection denied. ZDR is not required, as explicitly
requested by the owner. Secrets remain server-side. Calculated risk and payoff
checkpoints are authoritative; the server rejects conflicting risk classifications
and unavailable source citations. Quotes older than 24 hours are excluded from
current claims; news/research and FRED observations retain their dates. Providers
have bounded requests and a 60-second per-configuration cache. Missing sources
degrade explicitly. A separate fresh-context verification call now checks draft
prose and proposed facts before return. Rejection or unavailable verification
withholds the draft and leaves the position unchanged. Both calls share a20-second
deadline, without retries. The same-model check is probabilistic screening, not
proof that free-text reasoning is always correct.

Analysis prompts live in `web/prompts/analysis-v1.json`; tool permissions, schemas,
calculations and model settings remain code-enforced. To activate a new local
version, copy the complete bundle, change its version and text, then run:

```bash
node web/activate-prompts.mjs path/to/candidate.json
```

Apply local migrations first. The command freezes the candidate, runs the full
offline regression suite against those exact bytes, then activates it in local
D1 and checks the stored version/hash. It never deploys or calls inference.
Versions cannot be overwritten or deleted; changed text needs a new version.
Changing model/tool/output contracts requires updating `ANALYSIS_ENGINE_VERSION`
and reevaluating a new bundle version; old-engine selections fail closed.
Each AI request loads one frozen generation/verifier bundle without a redeploy.
No active selection uses the shipped baseline; invalid selected configuration
withholds analysis. This is a private operator command, not an HTTP editor.
Offline mocks check contracts, not trading-analysis quality; semantic prompt
changes still require separately reviewed model-output evaluations before release.
All four AI workflows now require private D1 tracing. Responses include
`X-ARGUS-Trace-Id` and `X-ARGUS-Trace-Status`; authenticated
`GET /api/analysis-traces/:id` returns only the current owner's trace. There is no
listing or administration endpoint. Traces contain frozen facts, allowed model
inputs/outputs, tool admission/results, verification and analysis disposition,
with prompt version/hash, elapsed times and available total-token usage. They are
not a whole-application HTTP audit or proof of response delivery.

Transport headers, private model reasoning and known configured credentials are
excluded. This does not detect arbitrary secrets a user types. Conversations and
strategy/source snapshots remain sensitive; keep local D1 private. No automatic
trace expiry is implemented yet. Capture is bounded to64events/8MiB per analysis;
overflow or failed persistence withholds the answer with `trace_unavailable`
without retrying inference. Running/incomplete traces expose metadata only.
Local migrations are required before chat; deployment and hosted retention are
still separate release gates.

Verification: `pnpm --dir web test` and `pnpm --dir web build`. With the local app
running, `node web/test/live-analysis.mjs --run` makes up to eight paid generation/
verification requests. `node web/test/live-chain.mjs --run` retrieves real quotes and
makes up to four paid requests. Review prose as well as contract assertions:
the live chain check exposed incorrect free-text payoff explanations despite
correct calculated metrics. This remains a consumer-release blocker.
`node web/test/live-verification.mjs --run` makes six paid verifier-only requests
against paired false/correct synthetic claims, reporting both false accepts and
false rejects. `node web/test/model-comparison.mjs --run` makes up to24 paid synthetic-position
requests comparing Qwen3.8Max and Gemini3.8Flash using the same cases and runtime
deadline. Its contract assertions are not an automatic prose-accuracy score.

`node web/test/live-stream.mjs --self-check` checks DXLink compact decoding offline.
With the local app running, `node web/test/live-stream.mjs --run` opens a bounded
read-only streaming probe for SPY and one verified option; no AI calls or orders.
It distinguishes provider timestamps from receipt time and exits 1 on incomplete
timestamped coverage. The initial Saturday probe authenticated and received quotes
and IV, but quotes had zero timestamps. **Connect live feed** now displays separate
streamed marks through a shared authenticated server relay. Unknown timestamps stay
unknown; these marks do not silently replace scenario/AI snapshots or held costs.
Upstream interruptions receive three shared bounded retries; marks clear while
reconnecting. Silent/flapping sessions exhaust the budget. Browser-to-relay loss,
protocol rejection or exhaustion still requires explicit reconnect.
**Capture for analysis** explicitly creates a new immutable snapshot for selected
contracts only, with held entry costs preserved. The server requires complete
bid/ask/IV source times no older than five minutes, receipts within60s and source
skew within60s. Unknown timestamps fail closed; these limits do not promise fills.
Now advances to capture time; a future scenario stays fixed. Undo restores the
previous snapshot. Refresh quotes to retrieve alternative contracts again.
`node web/test/market-browser.cjs --capture-only` checks capture interactions with
fixtures; `--live-feed-only --live-capture-check` checks real missing-time rejection.
`node web/test/market-browser.cjs --feed-only`
checks UI isolation with a mock stream; `--live-feed-only` checks the real local feed.
The Cloudflare Durable Object binding is configured, not deployed or hosted-verified.

The browser regression pages under `web/test/` run against the local development
server with synthetic inputs. Legacy `.cjs` browser scripts require a separately
installed Playwright/Chrome setup. Optional live-verification replay modes also
require local `.sdlc` evidence; those artifacts are not part of this source release.

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
pytest                    # 28 tests: determinism, AI bounding, governor gates, replay
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
