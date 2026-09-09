# ARGUS implementation plan

## Active web product plan — visual workbench (9 September 2026)

Status: W1 and W2 implemented; local W3 checks passed. User approved implementation on 9 September 2026 ("execute the plan"). Production release confirmation and WB-7 remain pending.
This section supersedes the delivery priorities below for `web/` only. The legacy
Python experiment remains separate and unchanged. Integration owner: root agent.
Controlled lane: financial analysis, user-owned records and production release.

### Outcome and evidence

Open or build a position, explore an adjustment visually, discuss that exact
comparison, then apply a draft change or explicitly record an actual fill.
Conversation is optional assistance, never a prerequisite to using the builder.

First-person workflow evidence, not verified profitability:
- Partial exits and rolling an iron-condor side:
  https://www.reddit.com/r/options/comments/1ns9m6s/comment/ngndi00/
- Pre-entry price/date/IV exploration and liquidity inspection:
  https://www.reddit.com/r/thetagang/comments/swxi4e/anybody_using_optionstrat/
- Screenshot-to-AI handoff described in the app discussion:
  https://www.reddit.com/r/options/comments/1ns9m6s/options_strat_app/
- After-hours quote caveat:
  https://www.reddit.com/r/options/comments/1jg12cu/comment/miwjl3x/

These anecdotes justify testing the workflow, not claiming a trading edge or
representative demand. Earlier thesis-first/three-candidate ideas are deferred.

### Capability classification and invariants

| Component | Class | Responsibility |
|---|---|---|
| Chart/leg edits, preview, Apply, Undo | DETERMINISTIC | One validated position state; no implicit recording. |
| Quotes, quantities, costs, scenarios, comparisons | DETERMINISTIC | Existing engines; shared snapshot, basis, date and model. |
| State identity and stale-result rejection | DETERMINISTIC | Bind result to position version, saved revision and comparison inputs. |
| Natural-language scenario interpretation | PROBABILISTIC | Propose bounded typed coordinates; ask when materially ambiguous. |
| Explanation and objections | PROBABILISTIC | Interpret server-computed facts; do not supply authoritative arithmetic. |
| Validation, permissions, persistence and rate limits | DETERMINISTIC | Enforce before provider calls, state changes or saved writes. |
| Tracing, evals and release checks | DETERMINISTIC | Observable evidence, not model self-assessment. |

No classification is unresolved. No new autonomous loop. Reuse the existing
bounded scenario-call path; direct interactions require zero inference calls.
Do not increase its call/token caps or introduce agents in the runtime. Any such
change requires a measured per-question cost multiplier and explicit approval.
Prompts remain versioned in the existing prompt-bundle mechanism; new bundles
must pass offline regression tests before production activation.

### Existing seams to reuse

- `web/src/App.tsx`: `commit`, proposal request/version checks, Apply/Undo,
  chart context, frozen comparisons and candidate preview. Do not replace these.
- `web/src/LotManagement.tsx`: hypothetical transaction comparison,
  `LotScenarios`, read-only discussion and Show scenario on chart.
- `web/src/lot-scenarios.ts`: `prepareLotScenarioComparison` and
  `calculateLotScenarioComparison` already require matched basis and inventories.
- `web/src/position-lots.ts`: lot projection/valuation and realized accounting.
- `web/src/sparring.ts` and `web/src/worker.ts`: typed discussion/scenario boundary,
  server calculation, guarded requests and bounded provider calls.
- `web/src/analysis-prompts.ts` and existing prompt bundles/traces: preserve active
  baseline until a separately evaluated prompt change is actually needed.

### Ordered build and proof

**W1 — One chart-bound comparison, first shippable tracer.** Characterize current
behavior before editing. In App.tsx/styles.css, promote `RequestedScenarios` and
the validated `ScenarioPreview` from disclosure/modal into a chart-adjacent
selection using `PayoffChart`'s existing comparison support. Ask an explicit
price/date/IV question, select the calculated result and see its preview without
leaving the workspace. Dismiss restores the normal chart. Show reviewed version,
scenario and quote basis beside the answer. No new prompt or model call is needed.
Reuse existing validation/recalculation; preserve original legs, entry prices and
scenario inputs. Draft edits, quote refresh, scenario changes and load/Undo must discard
in-flight stale output and mark older explanations as historical. Preserve any
user question text when rejecting a stale result. No new discovery wizard.

**W2 — Position adjustment entry points.** After W1, improve access to existing
LotManagement hold-versus-close/partial-close/roll previews. Compare one proposed
adjustment against held inventory first, not a new multi-candidate engine.
Show remaining quantity, realized P/L, remaining modeled P/L and allowance once.
Discussion and plotting never record transactions. Recording requires explicit
actual-fill inputs and the existing saved revision check. A draft replacement is
not a roll. Unsupported dates/inventories return unavailable, not invented values.

**W3 — Integrated verification and release.** Independent review of the combined
diff, offline response/tool regressions if those contracts changed, full test/build,
and browser checks at desktop and narrow width. No production schema migration is
planned. Reuse saved state/lifecycle data; a new durable decision journal is deferred.

| Acceptance | Proof required before release |
|---|---|
| WB-1: Direct builder remains usable without AI | Browser: edit legs/scenario with inference unavailable; chart updates; keyboard controls work. |
| WB-2: Discussion and chart describe identical inputs | Fixture assertion of exact request context plus browser before/after chart and answer inspection. |
| WB-3: Stale responses cannot act | Delayed response, then edit/refresh/Undo/load; no stale overlay/Apply/write; question retained. |
| WB-4: Adjustment preserves accounting | Existing position-lots and lifecycle tests plus partial close and changed-expiry roll; costs once, held record unchanged before confirmation. |
| WB-5: Comparison is like-for-like | Matched snapshot/date/basis/model tests; quantity/exposure shown; incompatible horizons fail closed. |
| WB-6: Language stays untrusted | Existing API/market-sparring/analysis-tracing tests plus changed-contract evals for ambiguity, invalid coordinates and fabricated values. |
| WB-7: Production remains private and observable | Authenticated browser canary, unauthenticated HTML/assets/API denial, persisted Cloudflare logs, no sensitive payload logging. |

Run focused suites from `web/`: `pnpm exec vitest run test/api.test.ts
test/market-sparring.test.ts test/workspace-valuation.test.ts
test/position-lots.test.ts test/position-lifecycle.test.ts
test/private-api.test.ts test/analysis-tracing.test.ts`; then `pnpm test` and
`pnpm build` for the integrated release. Extend the existing browser test scripts
only where their current assertions do not prove WB-1 through WB-5.

### Delivery, cost and recovery

Local checkpoint evidence (9 September 2026): independent App review cleared;
`pnpm test` passed 40 files / 764 tests; `pnpm build` passed. Browser checks passed
for `scenario-browser.cjs` (default and `--stale-workspace-only`),
`market-browser.cjs` (`--preview-only`, `--what-if-only`, `--leg-iv-only`) and
`lots-browser.cjs --entry-only`. These cover keyboard/direct editing, captured
overlays, tampered results, pending-review reselection, edit/Undo/refresh/load
invalidation, loaded-record identity, partial-close and changed-expiry roll
previews without saved writes. Desktop and narrow previews were inspected.
The full legacy lots browser fixture has inconsistent synthetic projections and
does not pass current reconciliation; its wider amendment/retry UI coverage is
not claimed by this checkpoint. Root owns that separate fixture repair. Existing
offline accounting/API tests pass. Build warnings remain for unavailable local
provider secrets and the existing large client bundle. No live inference or
production changes were required; WB-7 is checked only during authorized release.

- First task is baseline characterization, not a rewrite. Target W1 to existing
  App.tsx/styles.css and relevant tests; expand server files only for a proven gap.
- No dependencies, logging SDK, pricing engine, data provider or parallel state
  store added. Root owns shared files/Git; independent read-only review can run in
  parallel. Keep implementation in the existing isolated product worktree.
- Commit/push each verified coherent increment to the existing
  `product/ai-sparring-partner` branch, explicitly staging only scoped files.
  Do not merge, tag, or publish private `.sdlc`/screenshots as part of checkpoints.
- Baseline manifest version is 0.1.0. Proposed additive feature release is 0.2.0;
  confirm release-history availability and manifest/lock consistency at release,
  not during this documentation-only checkpoint.
- This request prepares the plan. Human plan acceptance precedes implementation;
  obtain release confirmation for this feature before changing production.
- Release to existing easyoptions.trading/Worker with unchanged Access, D1,
  secrets, canonical-origin checks and observability. One bounded synthetic AI
  canary only when needed; no benchmark sweep and no real record mutation.
- Record the previous Worker version before release. Roll back to that version
  if the canary fails, preserving auth, secrets, logs and all saved data; verify
  the restored domain. Never use an unprotected preview as recovery.

Independent read-only code review confirmed these reuse points. In particular,
`PositionComparison` is a hypothetical replacement, not roll accounting; real
adjustment comparisons must remain on the LotManagement transaction path.

Out of scope: options flow, autonomous trading, broker execution, new discovery
engine, historical data expansion/Theta, billing, broad visual redesign, performance
claims and a new journaling subsystem. Native error alerting is a separate task.

## Historical Python experiment plan (retained)

## Status (2 Sep 2026, 14:00 CEST)

M0–M5 are implemented as a vertical slice in `src/argus/` (10 passing tests,
credential-free replay, live dry run against the fresh paper account and
OpenRouter verified). M6 is a static exported site rather than a server. The
six handoff decisions below were taken with the defaults recorded in
`.env.example` (rationale in the private competition notes). Remaining: run the loop
during market hours, submission assets, social posts.

## Operating decisions

- Build one Python service, not microservices.
- Use official `alpaca-py` with `TradingClient(..., paper=True)` and its option
  data client. Do not use the obsolete `alpaca-trade-api` package.
- Use both surfaces: CLI plus `alpaca-py` is the sole governed write path;
  Alpaca MCP is read-only for research and demonstration.
- Use OpenRouter as a bounded inference adapter. Pin one model for scored runs;
  pin one provider and disable fallback. Same-model fallback is demo-only.
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
Replay records carry `run_mode=replay` and cannot enter scored aggregates.

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
term slope, and liquidity. It selects a defined-risk structure from the bounded
universe and owns its trade fields. Backtest with
chronological/walk-forward splits, source cutoffs, costs, slippage, parameter
sensitivity, and a registered trial ID.

Verify: identical fixture input produces identical candidate and backtest output.

### M3 — OpenRouter AI ablation

Freeze the AI decision packet and strict schema. Pin model, prompt, schema,
temperature, token ceiling, routing policy, trial ID, and data cutoff. Persist
provider, token, cost, and latency metadata. Score all candidates where possible
so executed-choice selection does not hide counterfactual outcomes.

Verify: tests prove AI cannot change deterministic candidates; scored runs fail
closed if the information set, model, provider, or experiment contract drifts.

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
result with a fake client. Tests cover expired/reused approval, changed proposal
hash, stale market/account state, duplicate client order ID, timeout after
submission, and reconciliation before retry.

### M6 — evidence-first app and demo

Add the five read-only views in [APP.md](APP.md): Scoreboard, Last Decision,
Decision Ledger, Falsification Lab, and Claims. Values must derive from event and
claim artifacts. Preserve credential-free replay for closed markets/provider
outages. No frontend build step unless plain server-rendered HTML proves
insufficient.

Verify: a smoke test starts the shell and reads fixture-ledger output.
The server binds to loopback by default and never renders secrets or raw broker
responses.

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

## Handoff decisions required before M2

1. Which underlying symbols and expiry range are allowed?
2. Is the first structure a defined-risk vertical debit spread, or another
   specified option structure?
3. What per-run budget applies to the initial pinned OpenRouter model,
   `google/gemini-2.5-flash-lite`, and what evidence would justify changing it?
4. What transaction-cost and slippage assumptions apply to the backtest?
5. What exact entry, exit, mark, holding-period, expiration, missing-quote,
   abstention, capital-normalization, overlap, and drawdown rules define outcomes?
6. What deterministic feature lookbacks, thresholds, and candidate-ranking rule
   define the control?

Do not invent these product/risk choices in implementation.

## Public documentation release gate

Before each public push:

- verify every research summary against the cited primary abstract and state
  universe-transfer limits;
- check local links and internal terminology for contradictions;
- confirm runtime data, ledgers, logs, databases, `.env*`, and `private/` remain
  ignored while `.env.example` and deliberate public fixtures remain eligible;
- stage explicit files only and scan the staged diff for secrets and private
  absolute paths.
