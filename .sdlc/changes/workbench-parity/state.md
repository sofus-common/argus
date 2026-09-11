status: building
lane: controlled
current_gate: build
next_action: verify live AI discussion and launch configuration against the qualified release bundle
blocker: null
updated: 2026-09-11

Launch checkpoint: normal / now opens consolidated Workbench; classic layout stays
at ?workbench=classic. Explicit Optimize quote-window loading reuses preserved
market refresh, retains all held expiries including excluded legs, and keeps search
preferences only for that refresh. Other successful commits reset search inputs.
Missing selected expiries disable Search with a visible message, not a broader
implicit search. No pricing model, auth, provider or AI prompt was changed.
Fresh proof: TypeScript and production build pass; 54 focused quote/thesis/UI
tests pass; independent release wave reports 177 auth/save/prompt/market tests pass.
Native integrated-browser.cjs passes at normal /: real October 9 quotes, four
retained legs and fixed costs, search preference/thesis preservation, Inspect/Cancel,
save/reload, new-thesis reset, and 1440/390px no overflow. Test saves were deleted.
Screenshots inspected locally under docs/screenshots/launch-*.png (not committed).
Overall goal remains active: live AI qualification, useful two-sided/candidate
tradeoffs and hosted auth/storage/config release proof are not yet completed.
approvals:
  - gate: plan
    decision: accepted
    by: human-confirmed-in-session
    evidence: user replied "continue" after recommendation to save thesis target and horizon with each position
  - gate: plan
    decision: accepted
    by: human-confirmed-in-session
    evidence: user accepted preceding recommendations with "go and implement your recommendations"
  - gate: plan
    decision: accepted
    by: human-confirmed-in-session
    evidence: user replied "continue" to explicit root-state-owner architecture approval question

The accepted scope is root capabilities behind the compact prototype layout.
The file-level sequence is implementation detail, not a new product direction.
Production release is not approved. Overall parity is not complete.
Independent architecture review recommends a root-owned compact presentation
variant rather than duplicating financial state. Human accepted this approach.
Read-only risk/evidence tracer can proceed without that structural migration.
Fresh local /api/bootstrap probe returned HTTP 200 application/json; previous
root tab JSON error is not evidence of a currently failing bootstrap endpoint.

Read-only tracer verified: TypeScript passed; 13 focused Vitest tests passed;
desktop disclosures expanded successfully and context retrieval returned 12
available items with 3 explicit gaps. Quote valuation coverage uses fixtures,
not a live execution claim. Mobile check and full migration remain pending.
Independent reviewer found no blockers; existing snapshot-age copy mentions
stream capture not yet supported in the prototype (non-blocking caveat).
No financial state handlers, AI prompts or root presentation were changed.

Second checkpoint: opt-in /?workbench=integrated renders the same App state owner
with a top thesis/symbol strip, collapsed library and workspace controls, and
chart-first compact presentation. Default / and /prototype.html remain intact.
This staged URL preserves the existing sample optimizer until a compatible
bridge exists; it is not the completed prototype replacement.
TypeScript and presentation regression passed. Desktop browser: leg quantity
1 to 2 then Undo restored 1; original heatmap rendered. Independent review found
no state/financial blocker; corrected quote retrieval wording as requested.
Mobile viewport override did not take effect, so mobile verification is pending.
No fresh end-to-end AI, quote-refresh or durable-save proof in this checkpoint.

Third checkpoint: WorkbenchThesis adds temporary target/UTC horizon with strict
valuation-to-first-included-expiry bounds, cloned read-only preview, and explicit
optimizer prefill. CandidateSearch retains held state and guarded explicit search;
seed is gated by underlying/version and preserves milliseconds. No new AI call,
prompt, order capability, or persistence schema. Focused tests and TypeScript pass;
independent static review found no blockers. Browser rendered fields/disabled
guards, but native datetime automation could not establish successful entry.
Successful preview and quoted prefill interaction remain unverified, as do mobile,
AI and durable-save flows. Overall migration is still building, not released.

Fourth checkpoint supersedes the native-input limitation above: browser-native
date entry, bounded read-only preview and exact millisecond optimizer prefill
passed without changing the held scenario or Undo. Actual search exposed a local
5174-to-5173 origin mismatch. Fixed only the prototype proxy with exact-origin
translation for HTTP and the existing feed socket; production auth unchanged.
Regression, TypeScript and 11 auth tests passed. Live invalid-body probe reaches
validation (400); hostile, null, missing and cross-site origins remain 403.
After restarting the stalled prototype server, browser quote refresh and explicit
search returned five quoted candidates while retaining the held position.
Socket translation is regression-tested, not live-feed verified. Mobile, AI and
durable-save browser verification remain pending. No production deployment.

Fifth checkpoint: native 390x844 browser viewport reproduced thesis textarea
overflow (407px document width). A block textarea fixes the stacked layout;
document width is now 375px inside the 390px viewport. Mobile chart navigation,
Heatmap and Table switching passed; viewport reset after verification.
Synthetic position saved as a new record, modified, loaded and Undo restored the
pre-load contract quantity. Only that temporary verification record was deleted.
Live read-only AI response completed and matched the separate calculated $160
expiry loss, without a proposal or holding change. This is one response, not a
general analysis-quality claim. TypeScript and 2 presentation tests passed;
independent test runner reports 7 draft, 16 saved and 103 market-sparring tests
passed, with existing sandbox static-analysis and missing-secret warnings.
Important unresolved limitation: written thesis is tab-local, not stored with
saved positions; Load retains the current thesis. Structured target/time remain
explicitly temporary too. The accepted slice excluded persistence schema changes;
resolve that next rather than claiming the thesis-led workflow is complete.

Sixth checkpoint resolves durable ownership: optional typed thesis metadata in
existing position JSON, copied through save and draft boundaries. Existing Undo,
load and dirty detection now cover all fields. Legacy saves clear fields; legacy
draft text is preserved without truncation. Same-symbol template/quote changes
preserve metadata and proposal merge retains user ownership. Old horizons remain
storable but preview bounds still apply. Target uses a decimal edit buffer and
reverts invalid blur to the stored value. Browser saved/loaded text,103.5 and UTC
milliseconds together; Undo restored previous text,104.5 and different milliseconds;
legacy load cleared all fields. Only the new verification record was deleted.
TypeScript and 31 focused tests passed; independent AI regression 103/103 passed.
Independent review findings on decimal input and legacy truncation were resolved.
No SQL migration, prompt change, production deployment or default-page promotion.

Seventh checkpoint: live quoted candidate Inspect/Apply/Undo retains persisted
thesis and restores original legs. Added explicit best-per-family search mode
(browser default), with global top five retained as an option and API default.
Same financial calculations, constraints and tie ordering; family count and
duplicate-family responses fail closed. Live bullish search produced three distinct
families. Engine replay and client tampering regressions pass. Remaining work is
the visual optimizer/dated quote presentation and market stress comparison merge;
do not equate this search checkpoint with full prototype replacement.

Eighth checkpoint: separate integrated Workbench/Optimize screens share state;
quoted result cards reuse prototype expiry plots. On-demand stress uses the
existing valuation worker with bounded reply validation and cancellation.
TypeScript and 33 focused tests passed. Browser quoted search, seven stress rows,
mid/natural estimates and Inspect return passed; held Iron Condor stayed unchanged
and Apply remained explicit. Review found and fixed hidden inspection errors.
Mobile verification of this checkpoint remains pending. Direction icons, expiry
strip and ranking blend are not yet migrated. No deployment or default promotion.

Ninth checkpoint migrates outlook buttons and quoted expiry strip. Deterministic
offset presets select starter option families; not predictions or exhaustive
directional classification. Two-sided control stays disabled. domain.expiry is
an optional exact quoted first/short expiry, enforced before enumeration and
reconciled on the client; later long legs remain eligible. Reuses prototype strip
with quoted provenance and disabled pre-horizon dates. No snapshot filtering.
TypeScript and 98 tests passed with CLI 20s timeout after two 5s timeouts under
load; no test assertion failures remained. Independent reviewer found no blockers.
Browser selected Sep 14 reduced enumeration from1250 to625 and returned three
Sep14 families; Inspect retained Iron Condor and explicit Apply. 390px viewport
had375px document width; reset afterward. Drag/overflow across many quoted months
not exercised: current quote window has two dates. No deployment/default promotion.

Tenth checkpoint: explicit return/chance objective and native slider with disclosed
fixed normalization, raw target-return/risk and probability values. Endpoint
rankings match existing objectives; every intermediate weight reranks enumeration
before family/global selection. Mixed expiries and invalid weights rejected.
100 engine/client/API tests, TypeScript and independent review pass. Browser proof
is blocked by local quote catalog503 for SPY and QQQ; held position remains intact.
No successful slider/search/Inspect or mobile claim for this checkpoint. Default
ranking unchanged; no deployment/default promotion. Two-sided control still disabled.

Find-strategies verification supersedes catalog-blocked browser status: recovered
provider and local chain supplied100 contracts. Browser blended search evaluated
1250 structures, returned three bullish families, Inspect/Keep current preserved
held Iron Condor, and Optimize results were reopened. No candidate was applied.
Live API replay passed standard/blended/stock/mixed search without inference.
Observed Node/Worker probability drift around1.2e-13 exposed exact-float guard;
added absolute1e-12 probability/derived-score tolerance only, exact metadata/money
and server ordering retained. Seven regressions and TypeScript pass; independent
review found no blockers. Prior catalog outage recovered without configuration
changes; its cause is not established. No deployment.
