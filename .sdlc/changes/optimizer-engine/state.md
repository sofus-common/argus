status: building
lane: controlled
current_gate: build
next_action: finish prototype direction, expiry and ranking control migration without synthetic fallback
blocker: null
updated: 2026-09-11
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
