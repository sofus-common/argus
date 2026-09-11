status: building
lane: controlled
current_gate: build
next_action: reconcile final engine acceptance and hosted release evidence; two-sided scoring implemented locally
blocker: null
updated: 2026-09-11

Two-sided checkpoint: Either direction now selects editable down/up targets and
move families. Engine ranks weaker conditional net P/L at the two prices, not
expected P/L/global worst case; same date, IV, costs and existing budgets.
Strict lower<quoted spot<upper validation; client revalues both outcomes and
rejects altered downside/score/request. Inspect remains explicitly upper-target.
Independent review found no blockers. Eight presentation/client tests, focused
engine/API acceptance (--testTimeout20000), TypeScript/build and live integrated journey pass: Oct9
quoted window, preferences, fixed costs/thesis, two-sided cards, Inspect/Apply/Undo,
save/reload, invalid target prevention and1440/390px overflow. Broad engine/API
run165passed with two separate lot-discussion timeout failures; no full API pass
claimed. One fresh candidate API run exceeded the default5s test ceiling; the
bounded20s rerun passed both acceptance checks in1.60s total test execution.
Saved reload requires fresh quotes; browser search moved before reload.
No production deployment. Older checkpoint text below is historical.
approvals:
  - gate: plan
    decision: accepted
    by: human-confirmed-in-session
    evidence: user reply "approve" to engine-hardening acceptance plan

Intent, scope and sequence accepted together. Production release not approved.

AC1 and AC2 implemented. AC4 helper and synthetic preview implemented; market
UI use awaits AC3. Independent guard review found no blockers. Recorded fail-first
quantity test failed before the fix and passes after it. No runtime changes to
market search ranking, API or provider access in this checkpoint.

Checkpoint verification: 151 tests in options, scenario-lab, american-price,
pricing-benchmarks and optimizer-sensitivity; TypeScript exit 0. Browser test
passed at isolated port 5175, including seven stress rows, desktop/mobile,
expiry selection, preview/Escape and Apply. Independent pricing_benchmarks
review found no blockers in numeric guard or sensitivity implementation.
Full plan remains building, not verified or released.

Market ranking reconciliation: optional best-per-family result mode reuses the
same quoted enumeration, risk/outlay checks and score/ID ordering. Existing callers
without the mode retain global top five. Browser defaults to family grouping with
explicit global option. Net entry outlay remains net debit plus share cost and fee,
not margin or collateral. Cash-secured-put collateral policy is not implemented.
Replay compared every family winner with independent single-family searches under
mid/natural and P/L/risk ranking, plus probability ordering and reversed quote order.
Client validates mode echo, family counts/uniqueness, pricing and ranking.
Live three-family bullish search returned bull put, bull call and long call results;
Inspect/Apply/Undo passed. No synthetic fallback, order or AI call was added.
The old prototype visual optimizer is not yet the market-quote presentation;
AC3/AC4 remain incomplete. No deployment or default-page promotion.

Presentation/stress checkpoint: separate integrated Optimize screen, compact
quoted expiry plots and explicit worker-backed sensitivity using the existing
deterministic helper. Browser returned seven scenario and two entry-basis rows;
Inspect returned to Workbench without applying. TypeScript and 33 focused tests
passed. Direction icons, expiry strip and ranking blend remain pending; overall
AC3 is not complete. No production deployment or default-page promotion.

Quoted expiry checkpoint: optional domain.expiry selects exact first/short expiry
before enumeration/counts/ranking, retaining later mixed long legs. API uses stored
snapshot unchanged; UI verifies selected expiry and exact domain echo. Engine
replay verifies partition counts, family winners, reversed quotes and mixed legs.
98 focused/API tests and TypeScript pass; browser three-family Sep14 search and
Inspect handoff pass. Direction controls use disclosed fixed target offsets and
starter families only. Existing objectives remain unchanged; no cosmetic blend.
No production deployment or default promotion; overall AC3 still incomplete.

Blend checkpoint: explicit balanced objective requires integer chanceWeight0..100
only for that objective. Shared pure score uses fixed normalization documented in
plan.md; exact endpoints reproduce legacy rankings. Mixed expiry fails closed.
100 engine/client/API tests and TypeScript pass; independent review found no
blockers. Tests cover component monotonicity, endpoint identity, intermediate
family/global replay, quote order and tampered requests/replies. New UI offers an
explicit slider without changing default objective or automatically searching.
SPY and QQQ browser quote load failed; direct local chain probe returned503 with
chain_unavailable/catalog/Unavailable. Live slider/search/Inspect and mobile proof
are pending. No synthetic fallback, provider configuration edits or deployment.
Overall acceptance remains building; this checkpoint is not a proven trading edge.

Catalog recovered; actual browser blended search and Inspect/Keep current passed.
100-contract live API replay passed standard, blended, stock-backed and mixed
search with zero inference calls. Exact probability comparison failed on observed
Node/Worker drift1.2e-13; probability/derived-score tolerance is now1e-12 absolute.
Metadata, monetary metrics and returned score/tie ordering remain strict. Regression
accepts roundoff and rejects larger drift, changed metadata/null and forged scores.
Seven presentation tests and TypeScript pass; independent review has no blockers.
Provider recovery was observed, not attributed to a transport fix. No deployment.
