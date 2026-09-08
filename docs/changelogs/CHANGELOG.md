# Changelog

## Unreleased

- Added fixed, secret-safe option-chain failure stages and reason codes for
  local development only; hosted responses remain generic. Regression checks
  cover provider/storage error redaction and hosted isolation. A real rejected
  quote was 223ms ahead of the local clock; an independent Windows time-server
  probe measured roughly 625ms host lag and Windows Time was stopped. No quote
  guard was relaxed or system clock changed. Clock correction and subsequent
  real-session verification remain outstanding.

- Real-data verification found remaining reliability gaps, not a release pass.
  A real four-leg SPY workspace retained all fixed costs and its exclusion on
  successful REST refresh; a failed refresh preserved the existing position.
  Explicit feed reconnect restored all selected quote/IV coverage, but bid/ask
  source timestamps remained unavailable and capture correctly stayed disabled.
  The bounded feed probe failed freshness/progression checks. Intermittent chain
  failures still need diagnosis; no freshness guard was weakened.

- Completed same-snapshot/basis candidate and template transfer into fixed-entry
  positions with exclusions. Retained costs stay unchanged; replacement quote
  estimates become fixed inputs. Raw candidate prices validate before promotion,
  including rejection of forged fixed-entry metadata. Browser checks cover
  Inspect, Apply, save, refresh, Undo and tampering at desktop and mobile widths.
  Verified604 offline tests,25 browser checks per viewport, TypeScript/build,
  independent review and one OpenRouter template replacement with a dated real
  Tastytrade snapshot. Snapshot/basis conflicts and contract collisions still fail
  safely; this is not a claim of complete optimizer coverage or live reliability.

- Enabled AI review and quantity/scenario proposals for nonempty included
  selections. Facts, tools, comparison pricing and verification use included
  holdings; canonical validation preserves excluded legs, costs and expiry shifts.
  Apply and Undo preserve the selection; malformed retained-inventory edits fail.
  Versioned the analysis contract and scope prompts. Verified602 offline tests,
  24 desktop and24 mobile browser checks, TypeScript/build, independent review
  and one real OpenRouter synthetic quantity proposal. Fixed-entry template and
  candidate replacement with exclusions still rejects pricing-context changes;
  that transfer workflow and broader live-data/model-quality proof remain open.

- Added visible reversible leg inclusion, Include all, and empty construction.
  Charts, quotes, probability and Greeks use included holdings; save/load, Undo
  and refresh retain canonical costs and legs. Empty selections stop pricing
  workers. Explicit date reset recovers excluded calendars after later scenarios.
  Verified23 browser checks at desktop and390px,147 focused tests, TypeScript,
  build and independent review. Synthetic data only. AI review is explicitly
  unavailable while legs are excluded, pending exclusion-aware proposal handling.

- Preserved hypothetical leg exclusions and empty constructions through draft
  recovery, owner-scoped saves, reload and import/export. Market validation still
  checks excluded contracts. Ledger marks and scenarios value every held lot;
  actual closes prune selection IDs without rewriting the original audit.
  Verified132 focused checks, expanded import/export coverage, TypeScript/build
  and independent review. Builder toggles/empty-state UI integration remains open.

- Added the reversible-exclusion calculation foundation: canonical inventory
  validation, empty construction admission and an explicit included-leg projection.
  Priced analysis rejects empty or unprojected excluded holdings. Costs, order and
  saved inventory remain untouched; scenario limits use included expiries.
  Regression checks cover malformed selections, all-excluded and stock-only
  projection, allowance accounting and calendar re-inclusion. UI, persistence and
  full-inventory ledger integration are still pending; no exclusion feature claim.

- Prepared the first buildable web-source baseline for the product branch,
  excluding credentials, local state, screenshots and generated compiler caches.
  Corrected import documentation and disclosed optional browser-harness setup.
  Fixed a streaming-test clock race by measuring receipt age from actual receipt.
  Versioned the stock-only tool/output contract as analysis-contract-v2; v8
  preserves every v5 prompt string for local offline contract requalification.
  Requalification passed all583 tests across36 files and activated v8 locally;
  TypeScript/build pass. This does not establish new model-quality claims.

- Integrated stock-only AI comparison and underlying-only streaming/capture.
  Enforced owned snapshots, source freshness and explicit empty selections;
  omitted option quotes/terms and expiry probabilities from share-only results.
  Capture, refresh and Undo preserve held costs. Verified91 analysis/tracing,
  86 feed/storage/API and12 saved/draft checks;22 browser checks pass on desktop
  and390px mobile. TypeScript/build pass; independent review found no blocker.
  Synthetic evidence only: real trading-session reliability remains unproven.

- Stock-only builder integration in progress: added exact signed-share valuation
  and no-expiry semantics; corrected worker admission to accept stock-only
  metrics/curves/table while rejecting fabricated option horizons. All 22
  workspace valuation tests and TypeScript check pass.
- Stock-only remaining holdings now return to analysis after option closes in
  both ledger versions. Fixed comparison compatibility and empty-contract refresh
  query; refresh preserves shares and held costs. 47 ledger/valuation tests,
  TypeScript, production build and22 synthetic browser checks pass. Underlying-only
  streaming/capture, AI comparison and mobile verification remain incomplete.
- Recorded user authorization to commit and push completed, verified work to
  GitHub with scoped staging. No deployment or brokerage authorization implied.

- Reprioritized the authoritative product goal/plan on September 8: major builder
  and live-data workflows, saved-trade performance, broader optimizer, then
  integrated AI/private-release readiness. Options flow explicitly excluded.
  Added MF-1..MF-6 acceptance gates; deferred micro-experiments without weakening
  security, numerical correctness or data-loss safeguards. Documentation only.

- Added an evaluation-only identical-facts compaction prototype and inactive v7
  transport instruction. Exact reconstruction/immutability checks pass; differing
  proposal/tool facts remain full. Matched frozen valuation checks preserved all
  four correct verdicts while reducing verifier input from33,270 to19,702 tokens
  (40.8%). Eight calls used53,028 total tokens. No runtime activation; semantic
  scope miss and broader readiness remain unresolved.

- Evaluated inactive analysis-v6 horizon-review instruction; rejected for promotion
  after it reproduced v5's scope miss. Four verifier calls /34,636 tokens; remaining
  paid checks canceled. V5 remains active. Added outgoing prompt identity assertion
  and verifier payload size measurements; offline checks pass. Identical proposed
  facts account for about42-44% of these read-only user payloads; no compaction yet.

- Added frozen full-answer valuation-scope evaluation pairs from observed v5
  replies. Paired facts/conversation are identical, with only designated wording
  corrected; ambiguous spread wording is exploratory, not falsely scored as a
  failure. Offline checks pass. Four live verifier calls /34,400 tokens reproduce
  acceptance of the contradictory preview assumption. No runtime prompt changes.

- Improved synthetic valuation evaluation diagnostics: generated candidate replies
  are now visible before verification, including rejected answers. Syntax and
  offline harness checks pass. Two live v5 runs used eight calls / 80,480 tokens:
  first preview rejected, repeat accepted; spread accepted in both. Independent
  review found scope/settlement wording defects in the repeat despite acceptance.
  No prompt promotion or runtime behavior change; expert-quality claims remain open.

- Added Saved workspace > Import saved JSON: native file selection, unverified
  metadata/history preview and explicit import-as-new confirmation. No automatic
  upload, load or retry. Confirmed writes and failed list refreshes are distinct;
  stale file reads, late response bodies and older saved-list responses are ignored.
  Imported quotes are visibly labelled unverified. Desktop/mobile browser checks
  pass (22 each), 144 API/provenance checks and build pass. Existing import limits
  remain. Tests used synthetic files and records, not the user's saved positions.

- Added a validated import-as-new saved-record API, preserving full close and lot
  ledgers atomically under the current owner. Imported quotes get new historical
  identities and an unverified marker; fresh captures cannot promote imported
  contract terms to verified. 144 focused checks and build pass, including
  near-limit history preservation and rejection without writes. Backend only:
  file selection/review UI remains to be built. Import limit2MiB; state/snapshot
  validator retains its128KiB sublimit. No live-user records were imported.

- Fixed clipped mobile chart controls by stacking the header and wrapping its
  control group. All modes and Greek selectors remain accessible, with 44px
  controls. Added viewport/text containment and mode-switch checks. Fail-first
  reproduced the mobile defect; 21 browser checks pass at mobile and desktop,
  actual 305/375px layouts inspected, build and independent review pass.

- Added a frozen manual comparison overlay with replace/clear controls and
  inspectable baseline inputs. Reuses the pricing worker; incompatible symbol,
  model, valuation time, scenario date or expiry horizon hides the overlay.
  Baselines do not change holdings/Undo, persist or enter AI requests. Desktop
  and 320px browser suites pass (21 each), 20 valuation tests and build pass.
  One earlier browser timeout remains unexplained; subsequent full runs pass.

- Added a reproducible near-exercise-boundary American price/Greek regression
  against refined independent FD references. Tightened boundary-specific oracle
  price/rho refinement and Greek tolerances; zero rho no longer passes this case.
  Oracle refinement, 43 pricing/workspace/surface checks, tightened focused test
  and build pass. Runtime pricing and inference unchanged.

- Fixed American vega/rho failures when valid low-volatility trees were pushed
  outside their numerical domain by fixed perturbations. Centered bumps now stay
  inside the valid margin; invalid base inputs and exact-boundary sensitivities
  still reject. Four independent analytic references, existing FD refinement,
  34 pricing/workspace checks, position integration and build pass. No inference.

- Unified recorded contract-term facts across the workspace, AI and conditional
  assignment. Removed the unconditional American/physical-settlement footer claim.
  Missing/unsupported terms stay unknown, including unsupported AM sessions.
  Verified sample/quoted unknown, recorded capture and Undo restoration; 87 market
  tests, 21 browser checks, build and independent review pass. No inference.

- Added quote-versus-scenario P/L reconciliation with dated quote provenance,
  selected model inputs and signed difference. Pending/failed model calculations
  never retain the previous value. Read-only American preview remains separate.
  Verified nonzero held-entry arithmetic, worker failure states, mobile rendering,
  21 browser checks at desktop and 320px, 28 valuation/preview tests and build.
  No inference.

- Reflowed mobile option legs into three rows using the existing controls, with
  visible labels on every leg and room for side/type labels at 320px. Quoted
  premium/IV remain read-only; held entry costs remain editable. Verified 320px
  and 390px layouts, quote provenance and quantity Undo. All 21 browser checks
  pass at mobile and desktop widths; build passes. No pricing or AI changes.

- Verified the thesis disclosure at phone width and after draft restoration.
  Added recovery regressions for the inclusion indicator, retained text and
  unchanged stored draft/request count on toggle. All 12 recovery checks and
  build pass. Mobile leg-editor horizontal scrolling remains a separate gap.

- Made the optional thesis field collapsible to give the conversation more reading
  space. Nonempty text stays visible as 'Included in review'; collapsing preserves
  the text and existing request/recovery behavior. Keyboard checks, 21 browser
  regressions and build pass. No AI calls or pricing changes.

- Activated v5 verifier locally after 574 tests, live model-preview/quote-cost
  controls and independent generated-answer review. Database readback and actual
  private API trace confirm the selected version. No deployment. Precision gaps
  remain around hypothetical contract terms and quote versus model valuation.

- Diagnosed calendar verifier control: original answer was factually supported
  but incomplete for its request. Preserved that failure; separate complete-answer
  negative/positive pair passes with correct passage projection. Full 574-test
  suite passes. V5 remains inactive pending remaining semantic/generation checks.

- Added frozen proposal-intent checks: unrequested/wrong-amount edits reject and
  requested edit passes live. Replaced obsolete verifier wording pins with retained
  calculation/transport coverage. 92 focused tests/build pass. Broader live matrix
  exposed a correct-answer rejection; v5 remains inactive, not ready for promotion.

- Assembled inactive v5 factual verifier with mixed-expiry schema and explicit
  request/operation alignment. Twelve live numeric, calendar and complete-answer
  controls pass. Five focused tests/build pass; full candidate suite still fails
  six legacy wording assertions. No activation pending broader scope checks.

- Evaluated a focused factual-audit verifier: the complete broker-answer regression
  and six nearby operational controls all pass on Google. Same facts/model/call
  budget; only verifier instructions differ. Candidate remains inactive pending
  numeric/proposal and mixed-expiry compatibility checks. No runtime switch.

- Verified assignment outcomes with actual dated SPY quotes: quantity changes,
  Undo, held-share offsets and keyboard disclosure work. Phone-width panel fits
  without horizontal overflow. Quotes remain visibly stale; this does not prove
  real-time feed quality. No runtime changes or AI inference in this check.

- Added workspace Assignment outcomes without AI inference: independent short-leg
  assignment scenarios show held-share effects, gross strike cashflow and surviving
  options. Reuses the engine's calculation; unknown or unsupported terms stay
  unavailable and broker policies remain explicit unknowns. 573 tests, 21 browser
  checks and build pass. No position changes or claim that AI verification is fixed.

- Added full-answer broker-policy regression using current engine facts. Independent
  review confirms material false claims; Google accepts both original and corrected
  answers. Qwen comparison times out under the runtime deadline. Reports distinguish
  transport failure from semantic rejection. Mock checks pass; no model/prompt switch.

- Corrected verifier benchmark interpretation after independent review: the AAPL
  calendar answer is broadly correct with precision/state-clarity defects, not a
  consensus material-error example. Replay now labels its strict-precision
  criterion explicitly. No verdict relabeling or runtime changes; future hard
  gates must use unambiguous operational errors and separate clarity scoring.

- Added a controlled source-context ablation to the verifier replay: retain
  selected contracts and all strategy facts while omitting unrelated source bulk.
  Both answers remain accepted. Two calls used 29,479 reported tokens; syntax and
  self-check pass. No runtime context pruning or candidate activation.

- Added evaluation-only operational passage projection with strict reference and
  schema checks, retaining existing bound validation. The live model still accepts
  the flawed answer; corrected answer also passes. Syntax/mock checks pass, but
  semantic regression fails. Candidate remains inactive; no runtime changes.

- Fixed tracing to retain allowlisted inference effort/exclusion settings without
  retaining private reasoning. 95 focused tests and build pass, including fail-first
  tracing coverage. Corrected an earlier replay claim: redacted traces omitted
  those settings. Source-reconstructed baseline and candidate both still accept
  the flawed operational answer; the candidate remains evaluation-only/inactive.

- Added full-answer operational verifier replay with unchanged recorded
  evidence and a corrected-answer control, reusing the runtime bound validator.
  Live verifier accepted both: negative regression remains failing. Offline wiring,
  87 focused tests and build pass; no prompt activation or runtime behavior change.
  The replay requires its persisted local trace; it is not a portable fixture.
  Correction: the recorded body omitted redacted reasoning settings, so this was
  not an exact runtime-configuration replay. OS-40 restores explicit comparison.

- Added deterministic conditional assignment inventory to AI facts: each short
  leg independently maps to resulting shares, gross strike cashflow and surviving
  options. Requires matching verified recorded American physical-share terms;
  unknown/historical terms are unavailable. No trades or assignment records made.
  573-test suite passed; final 87 focused tests/build passed after copy refinement.
  Actual quoted calendar used the arithmetic, but narrative certainty remains
  insufficiently controlled. No prompt activation or deployment.

- Added versioned, source-linked exercise/assignment reference facts to both AI
  passes, with broker-specific policies explicitly unknown. Five live false-claim
  controls rejected and qualified positive accepted; 571 tests and build pass.
  Fresh calendar answer still overstates execution certainty and mixes pre/post
  assignment handling. This is partial improvement, not expert-level validation.
  Runtime prompt v4 unchanged; no extra agent loop or deployment.

- Added four live trading-judgment cases: ex-dividend assignment, expiration
  mismatch/after-hours risk, straddle IV crush and calendar lifetime exposure.
  All were accepted by the verifier, but review found material exercise-cutoff,
  broker-liquidation and rolling claims. Recorded these as failures, not readiness
  evidence. Eight inference calls; no runtime prompt or model changes.

- Added bounded four-leg workspace-feed diagnostic to the existing live-stream
  probe. Actual local feed supplied every selected quote/IV but no valid quote
  source times or timestamp advancement; direct provider check confirmed zero
  quote timestamps. Capture correctly remains unavailable. September7 is a
  regular equity-options holiday; repeat during a regular session before claiming
  real-time readiness. No runtime, prompt, account or entitlement changes.

- Position snapshot source age is always visible and updates while idle, using
  only underlying/selected-contract timestamps, independently of retrieval or
  uncaptured streamed marks. Missing/future times remain explicit. Removed old
  render-only age labels. 20 browser checks and build pass; real SPY workspace
  correctly disclosed selected quotes over two days old. Feed freshness itself
  is not fixed or proven by this change.

- Added full-workspace synthetic capture regression: repeated automatic captures
  retain option quantity/entry and share quantity/cost; one Undo restores the
  pre-session snapshot. Deliberate spot/date scenarios remain fixed and a delayed
  capture is rejected after an entry edit. 19 browser checks and build pass.
  No production logic or prompts changed; no provider calls. Multi-leg capture
  and actual market-open feed freshness remain outside this check.

- Shared dated-capture timestamp policy between server and live-feed UI. Incomplete,
  unknown, future, stale or skewed data cannot enable capture. A silent feed ages
  out visibly and stops automatic mode; recovery requires explicit re-enabling.
  28tests,18browser checks and build pass. Actual market-open freshness remains unproven.

- Activated local IV presentation v4: shorter explanations and rounded display,
  without changing raw facts, calculations or verification prompts. Real fractional
  and tiny-negative cases passed; all six negative controls retained.569tests pass.
  Some caveats still repeat. Next focus is live analytics freshness, not more IV polish.

- Activated IV prompt v3 locally after real generation, six negative controls,
  positive control and568 offline tests. Verified real provider-to-chart discussion
  and persisted prompt provenance; switching contracts clears the conversation.
  Fixed candidate-evaluation fixtures to explicitly test absent IV prompts.
  Output remains overly precise/verbose; no cloud deployment or broad quality claim.

- Added bounded real-inference IV evaluation and captured two verifier false
  accepts: requested-range endpoint confusion and an unsupported rank-method
  requirement. Tightened inactive candidate prompts and froze both as controls.
 15paid requests/20,439tokens/$0.02702626; latest correction passes offline checks
  but still requires live evaluation. Activation now reuses runtime validation;
  no prompt activation or deployment occurred.

- Added IV discussion beneath the existing contract chart/facts. Responses must
  match displayed observations and exact selection; contract/bucket changes abort
  pending work and discard late replies.17 browser checks,30 nearby tests and build
  pass. Candidate prompts are still inactive: live IV answers await evaluation.

- Connected IV discussion to the private history route with server-reloaded IV,
  owner/contract/bucket validation, rate limits, response binding and session-expiry
  withholding.27 focused tests and build pass; nonauthor review clear. Candidate
  prompts remain inactive; visible discussion and live semantic evaluation pending.

- Added inactive historical-IV discussion core: deterministic fact validation,
  frozen two-call generation/review, no tools or position mutations, and trace
  events. Optional IV prompt pair preserves the existing v2 digest. Candidate v3
  is not activated; server route/UI and live semantic evaluation remain pending.
  567 tests pass; focused tests and build pass. Nonauthor shared-context review clear.

- Added calculated historical-IV facts: timestamped extrema, coverage, whole-range
  and selected-observation changes in percentage points. Zero and gaps stay distinct;
  calculations precede display rounding.563tests,16 browser checks and build pass.
  Real mobile facts checked. AI discussion/prompts remain unchanged pending integration.

- Added historical IV view with exact-contract selection, percent chart, zoom,
  keyboard inspection and unfilled gaps. Actual private provider-to-UI path
  verified;70 nearby tests,16 browser checks and build pass. Improved mobile IV
  labels without changing price charts. IV discussion and full readiness remain open.

- Connected historical option IV to the private history API with owner-scoped
  snapshot, exact-contract, source/range and session checks. Reuses shared history
  admission and subscribes only to option trade candles.65 nearby tests/build pass;
  frontend and actual private-provider integration remain unverified. No AI calls.

- Added deterministic IV-only candle transport, independent of price availability.
  Preserves zero/missing IV and shared snapshot/security bounds; default price
  history unchanged.59 nearby tests and build pass. Private route, visible history
  chart and live reduced-field negotiation remain to be integrated and verified.

- Verified genuine historical option IV through existing DXLink candle probe:
  trade candles populated78/78 buckets; mark candles0/78. Theta Greeks blocked
  by FREE entitlement. Added bounded IV availability diagnostics/self-checks.
  Production unchanged; preserve midpoint price history during IV integration.

- Added dated call/put IV-by-strike observations to the existing strike chart,
  with expiry selection and keyboard inspection. Actual two-expiry values match
  the quote table; mobile fits and volume/OI remain available.31tests/build pass.
  No holdings changes or new inference steps. Not historical IV or a fitted surface.

- Added evaluation-only unchanged-facts reference control after profiling AI
  payload duplication. Exact expansion/offline checks and live wrong/correct
  loss controls pass. One matched negative uses1614fewer verifier tokens;
  broader quality/savings unproven. Production payloads and prompts unchanged.

- Diagnosed withheld synthetic chart analysis from its persisted trace. Numeric
  facts mostly match; contract/path claims exceed supplied evidence. Kept the
  fail-closed gate and prompt unchanged. Recovered prior three-request usage:
  6provider calls/74,647tokens. Exact verifier rejection reason remains unknown.

- Fixed long AI answers opening at their ending. Completed replies now align
  their beginning inside the conversation; pending and proposal behavior retained.
  Fresh live long-answer/short-notice/Clear browser checks, build and review pass.
  No prompt or inference changes. One synthetic draft was withheld by verification;
  analysis reliability remains open.

- Added mobile Chart/Legs/Ask section navigation using native links. Verified
  keyboard focus,44px targets, visible destinations, unchanged unsent question
  and position, and hidden desktop bar. Build/syntax and CUA checks pass.
  No AI calls, routing dependency or pricing changes.

- Enlarged default desktop payoff plot from215px to320px. Verified mobile250px
  and wide350px overrides, desktop/mobile strike editing and Undo, and empty
  browser error log. Build/regression syntax pass; no pricing or AI changes.

- Fixed mobile/tablet headers hiding sample-data status and quote controls.
  Mobile buttons now retain44px targets and wrap. Verified real dated-quote load,
  Refresh/Sample visibility and sample return at390px, tablet at900px, no overflow
  or browser errors. Build and regression syntax pass; chart sizing remains open.

- Prioritized payoff visualization by moving secondary display/expiryIV/range
  controls below it. Same1280x720 browser plot starts152px higher; date context
  and clipped-range warning stay above. Control interactions, build and browser
  error check pass. Added layout-order regression; full visual/mobile parity
  remains unverified. User draft and reference tabs preserved.

- Removed repeated expiry parsing and Greek accumulation from shared expiration
  payoff checks.100contract optimizer benchmark is2.4-2.9x faster locally, with
  identical complete results across all3objectives.547tests/build and independent
  review pass. Preserved arithmetic order, mixed-expiry guards and search limits;
  local measurements do not establish hosted Worker CPU performance.

- Verified the actual100contract/twoexpiry loader window exhaustively evaluates
  64,102 optimizer structures across all three objectives. Added merged-expiry
  ranking/count/immutability regression;77nearbytests/build and review pass.
  Kept the workload guard: the larger rejected single-expiry shape is different.
  No production edits; hosted Worker CPU performance remains unverified.

- Added frozen contract-style verifier controls: live model rejects observed
  European-settlement wording and accepts the corrected model/contract distinction.
  Fresh local quoted analysis passes contract-fact trace assertions without
  position changes. Offline controls and syntax pass; no production/prompt edits.
  This closes one regression, not general options-expertise or realtime readiness.

- Preserved provider-verified standard contract exercise and settlement terms
  through quote snapshots and AI facts, independently of the pricing model.
  Invalid metadata is rejected; legacy terms stay unknown. 546tests/build pass,
  independent review is clear, and live local SPY metadata is verified. No extra
  inference calls or prompt changes; AI settlement wording still needs live eval.

- Added strict whole-message JSON-fence handling for AI drafts without relaxing
  schema or verification gates. 544tests/build pass; component-separated review
  is clear. Live full-loss controls pass, and real quoted local analysis now
  completes with an accepted persisted trace. Contract settlement wording still
  needs grounding; this is not a consumer-readiness or general-quality claim.

- Added opt-in read-only local quote/analysis/trace verification. Real dated
  Tastytrade quotes and calculator guards work; analysis failed because Google
  fenced its JSON. The failed trace persisted with the correct local owner and
  request. Preserved a separate full-loss/breakeven draft error for regression.
  No application changes, retry, deployment or successful end-to-end claim.

- Added explicit gross/allowance/net entry accounting to shared strategy metrics,
  with eight arithmetic regressions. 542tests/build and independent review pass.
  Live verifier rejects frozen wrong net-credit wording and accepts its corrected
  control; fresh candidate analysis also reports net credit correctly. Five live
  calls cost$0.05991381. No extra runtime calls, prompt changes or deployment;
  this is narrow regression evidence, not expert-level reliability proof.

- Separated tool selection from structured-output requests without adding model
  calls. Tightened local reply/leg validation before quote normalization; added
  fail-first coverage. 534tests, build and independent review pass. Google live
  candidate roundtrip now succeeds (3calls,$0.0336196575), but fee-label mistakes
  escaped its verifier: narrative quality remains an explicit unfinished item.
  No prompt activation, position mutation or deployment.

- Added a three-request compatibility diagnostic with offline variant checks
  and independent review. Minimal, tools-only and schema-only Google requests
  succeeded; the earlier combined request failed. This narrows the cause to a
  possible tools/schema interaction without removing application validation.
  No tools executed, position changes, prompt changes or deployment. Live
  diagnostics used20395tokens/$0.0222891075; trading quality remains unverified.

- Added a bounded synthetic candidate-coverage evaluation with exact argument,
  risk/P&L and read-only checks. Offline positive/negative controls pass. Three
  live diagnostic requests returned Google400INVALID_ARGUMENT before output;
  model quality remains unverified. Added bounded, redacted provider diagnostics.
  No application/prompt changes or deployment.

- Added short butterfly and inverse iron candidates with side-correct quote
  pricing. Both orientations count toward the unchanged300000-structure limit;
  some wide windows now require narrowing. Limit refusals return a clear safe
  API422 instead of generic failure, without continuation inference.521tests,
  production build and independent review pass. No live inference or deployment.

- Expanded candidate search to same-expiry long straddles and strangles. Reused
  quoted pricing, deterministic ranking and fee-inclusive loss budgets; candidate
  cap remains enforced before model pricing. Updated AI tool coverage and offline
  roundtrip tests. 516tests/build pass; independent review clear. No extra model
  calls, provider changes or deployment.

- Compacted symbol, company-search and saved-workspace controls into a wrapping
  toolbar. The desktop chart starts43px higher without hiding recovery or pricing
  warnings. Desktop/mobile browser checks, keyboard disclosures, production build
  and independent source review pass. No state, inference or provider changes.

- Added shared manual chart bounds and Auto reset across curve, comparison,
  table and European/American heatmaps, with validated bounds in AI chart facts.
  Range changes preserve positions and Undo; stale results are range/view-bound.
  513 tests, production build, independent review and browser checks pass.
  Existing eight-decimal curve-coordinate precision remains a known ceiling.
  No new dependency, prompt, inference call or deployment.

- Audited authenticated OptionStrat and fresh ARGUS workspace. Identified missing
  manual chart range and inconsistent per-view domains; specified shared range,
  Auto reset and validated AI chart context (IC-18). Implementation remains next.
  Preserved the user's older loaded draft; closed only the temporary audit tab.

- Fixed minimal quoted-pair admission for four vertical spreads, long/short
  strangles and collars. No unused middle or opposite-type contract is required;
  dense choices, quote basis, expiry/order validation and collar shares persist.
  Twelve regressions added; full503tests/build pass, independent review clear.
  No prompts, provider changes, dependencies or deployment.

- Fixed iron strategy construction from sparse chains: standard/inverse butterflies
  require only their four typed contracts, and condors no longer require an unused
  fifth strike. Preserved dense selection and deterministic quote validation.
  Eight regressions added; full491tests/build pass and independent review clear.
  No UI, prompt, provider or deployment changes.

- Expanded the strategy library to 27 with inverse iron butterfly/condor and short
  call/put butterflies. Reused deterministic construction with side-correct quote
  pricing; iron butterflies now require equal wings. 483 tests and production
  build pass; browser selection, legs, metrics, search and Undo checked. Shared
  iron-family sparse-chain availability remains conservative and needs correction.
  No inference, provider changes or deployment.

- Made the chart's gesture ownership/cancellation rules directly testable with
  seven focused regressions, using the same logic in PayoffChart. Verified in
  browser that a no-op preserves all20Undo entries and group drag still restores
  with oneUndo. Actual cancellation-event delivery remains a separate unexecuted
  browser check; no dependency, inference or provider changes.

- Enabled whole-structure strike editing with Shift gestures or Move all strikes.
  Chart-local preview applies once on release, guarded against newer workspace
  state; no-op/cancel does not preemptively consume Undo. Individual strike drags
  share this boundary. Risk-percent previews without a valid denominator are
  rejected without removing the chart.468tests/build pass; actual browser proves
  group keyboard/drag, oneUndo, no-op and risk-rejection recovery. Dedicated
  cancellation/stale-preview browser regression remains unexecuted.

- Added tested atomic whole-structure strike translation for sample and captured
  quote grids: shared offsets preserve widths/ratios/expiries; fixed-entry changes
  are denied. Seven fail-first cases;74 options tests and build pass. UI wiring
  is not enabled: review caught stale gesture ownership and Undo-history defects
  in the attempted integration, which was removed pending correction.

- Audited authenticated OptionStrat and local ARGUS workspace controls. Confirmed
  whole-structure strike movement is absent from ARGUS's single-leg drag path;
  recorded IC-17 acceptance for atomic offsets, quoted-contract admission,
  held-cost protection and one Undo. Research/planning only; not implemented yet.

- Activated analysis-v2 locally after independent review and candidate-bound
  offline gates (461 tests/33 files). Only the loss-bound classification prompt
  changed: supported conditional first-expiry tails are distinguished from loss
  caps; deterministic veto/schema remain unchanged. Frozen live positive and
  injected lifetime-cap negative controls passed (20,248 tokens, $0.01702998).
  Actual local API returned HTTP200 with the exact v2 digest in its private trace,
  correct adjusted IV/P&L and zero operations. No deployment or new agent loop.
  This corrects the reproduced classification case, not general semantic reliability.

- Restored native-Node loading of the runtime prompt bundle by declaring its JSON
  import type. Live evaluation startup had failed before any inference with
  ERR_IMPORT_ATTRIBUTE_MISSING. Native import, two prompt tests and build now pass;
  canonical analysis-v1 digest is unchanged. No prompt behavior or deployment changed.

- Added a bounded adjusted-state IV evaluation with shared offline/live numerical
  assertions and a frozen observed-reply verifier replay. Offline checks pass;
  live generation used correct existing shifts and calculations, but a one-call
  replay reproduced a false rejection: an unbounded first-expiry model tail was
  classified as a loss cap. Retained full passage diagnostics and actual reported
  cost when available. The semantic classification defect remains open; safety
  guard and prompts were not weakened or changed to force this case to pass.

- Added deterministic, on-demand first-expiry breakeven candidates using the
  existing pricing/enclosure engine. Preserves evaluated zeros and unresolved
  merged intervals; reports spot tolerance and a fixed evaluation budget without
  replacing exact expiry metrics. Typed worker results are validated before UI
  use; chart markers are P/L-only and state-bound. Model/fee edits and Undo cannot
  revive prior results. Independent review found orphaned pending state on remount;
  fixed with a live-request loading gate and a rendering regression. Final full
  suite461tests/33files and build passed.
  Actual browser checks exercised European/American searches and mode isolation.
  No inference, prompts, provider calls or deployment changed. Finite-domain model
  candidates are not certified root counts, lifetime risk or executable prices.

- Added mandatory private tracing to all four AI workflows: frozen prompt identity,
  facts, generation, typed tool decisions/results, verification and analysis
  disposition. Trace capture/persistence failure withholds output without model
  retries. Owner-only readback validates chunk completeness; no list/admin API.
  Credentials, headers and private reasoning are excluded;64events/8MiB ceiling.
  Independent review found metadata/property-name credential leakage, now fixed.
  Local migration/build pass;452tests/31files pass. One real synthetic-position
  analysis returned HTTP200 with a complete10-event trace, exact prompt digest,
  two inference calls and20176reported total tokens. No position change/deployment.
  Traces are sensitive, retained locally without automatic expiry; analysis
  acceptance is not proof of response delivery or broad semantic quality.

- Externalized all nine analysis generation/verifier prompts as immutable,
  validated runtime bundles. Four AI routes capture one D1-selected version per
  request; invalid selected configuration withholds analysis before inference.
  Local activation freezes candidate bytes, runs hash-bound offline regressions,
  stores immutable versions and verifies exact database readback. No public admin
  endpoint, new agent loop, provider call or deployment. Baseline text unchanged.
  Invalid-candidate activation failed before database writes;442tests/29files and
  build pass. Baseline analysis-v1 activated/read back locally. Independent review
  caught incomplete readback validation; exact text/date checks and runnable
  corruption assertions now pass. Workflow tracing is addressed by the later entry.

- Added on-demand first-expiry range analysis using cached model evaluations,
  strike splits and signed convex interval estimates. Reports separate low/high
  intervals and remaining search uncertainty without replacing exact risk metrics.
  Initial ordinary-calendar probe exhausted256 evaluations; exterior-secant reuse
  reduced both local BSM/CRR examples to5 evaluations at1USD search tolerance.
- Applied deterministic routing to explicit range explanations: validated bounds
  are calculated server-side before generation, no tools advertised, no mutations
  accepted. Open-ended questions retain one bounded read-only tool pass. Offline
  regressions prove two inference requests for the explicit workflow, not a token
  cost guarantee.434tests/build pass; browser calculation/model invalidation and
  preview-to-curve action verified. No new paid inference or deployment. Private
  step traces and runtime-versioned prompts remain required architecture work.

- Completed tail-analysis re-review and fixed oversized puts bypassing the
  quantity guard. Unresolved results suppress all numeric tail fields. Regression
  failed before the fix;121 focused tests and build pass afterward. Independent
  source/test review clear. The American matrix has a30s test timeout rather than
  the default5s; assertions unchanged. Full mixed-expiry extrema remain incomplete.

- Added conditional first-expiry endpoint and upper-tail facts for mixed-expiry
  strategies, shared by workspace and AI. European carry and American exercise
  assumptions are separate; finite tails are not presented as complete bounds.
  Unsafe quantity sums and ambiguous slope cancellation suppress numeric facts.
  423 tests and build pass; rendered European/American switching verified locally.
  Independent review found two issues, both fixed and regression-covered; final
  re-review pending because the reviewer hit its account usage limit. No deployment.

- Added history zoom in/out, earlier/later windows and reset without changing
  selected AI facts. Reused currency formatting and cached static plot elements
  after dense-week hover measured115ms median; subsequent probes measured0.5/0.6ms
  (development harness, not a universal latency guarantee). Fifteen browser checks,
  21 focused tests/build and independent review pass. Real weekly pointer/keyboard
  navigation verified with gaps intact. No source, inference or deployment changes.

- Added shared hover previews to paired history charts without changing the AI's
  selected point or discarding its conversation. Preview/Selected labels, pointer
  exit restoration and keyboard selection preserve deliberate discussion context.
  Thirteen browser checks,14 focused tests/build and independent review pass.
  Real daily pointer/keyboard behavior verified; weekly hover performance and
  screen-reader behavior remain unmeasured. No source or inference changes.

- History now loads the default daily week when opened, using the existing loader.
  StrictMode and queued/inflight cancellation checks prevent duplicate or stale
  requests; failures do not retry automatically. Twelve browser checks,17 focused
  tests and build pass; independent review clear. Actual local open-to-chart
  verified without clicking Load. No provider, analytics or deployment changes.

- Extended five-minute history to seven UTC calendar days using the existing
  feed and native controls. All 2,016 possible buckets remain represented, with
  dated inspection and gaps; AI retains the full range. Actual SPY load returned
  405 strategy observations and a verified selected-point AI reply. Nine browser
  checks, 421 tests and production build pass; independent review found no blocker.
  Feed limits unchanged. Local only; broader coverage and expert reasoning unproven.

- Added a total-inventory/normalized-strategy-price history toggle with explicit
  whole-position ratio conversion, unchanged underlying/source totals and the
  same conversion in AI generation and verification. Eight browser checks and
  416 tests pass; production build and independent review pass. Actual local
  daily chart shows $126 inventory / $1.26 price. Local only; no new provider
  calls, deployment or claim of full OptionStrat normalization/analytics parity.

- Added one-click daily history ranges for7/14/31calendar days using the existing
  validated loader. Browser fail-first then7/7checks pass,19focused tests and
  production build pass; independent review clear. Actual seven-day Theta history
  returned5dated strategy observations with weekend gaps. No broader history or
  OptionStrat parity claim; no orders, saved changes or deployment.

- Added repeatable intraday date-verifier controls using reconstructed observed
  inputs. Actual verifier rejects the retained wrong-date reply, but also rejects
  its date-corrected full version; that failed discrimination remains recorded.
  Separate date-only minimal pair rejects wrong/accepts correct. Four paid calls,
  syntax/self-checks pass. No production model, prompt or behavior changes.

- Added read-only AI discussion for intraday history, with server-reloaded facts,
  exact range/selection binding, session checks and independent reply verification.
  Six browser checks pass. Actual SPY arithmetic verified; a live false acceptance
  confused expiry and observation date. Moved timestamp formatting into server
  code after failing regressions; fresh live reply uses correct September 4 dates.
  Final412tests/27files and production build pass; independent review clear.
  This is targeted evidence, not general expert-level AI reliability. Local only.

- Added five-minute history to the existing paired charts with native UTC date
  selection, shared keyboard/pointer inspection and constituent close details.
  Strict response binding and recomputed inventory preserve zero, negative values
  and missing bars; no invented bid/ask envelope or empty-chart price axes.
  Actual local SPY history and daily regression verified in browser. Four synthetic
  interaction checks, 407 tests/27 files and production build pass; review clear.
  Intraday AI discussion and hosted deployment remain outstanding.

- Added authenticated intraday-history API and fixed-inventory five-minute values.
  Owner/snapshot/source checks precede shared feed use; missing bars remain gaps,
  stock trade contribution is explicitly distinguished from option midpoints.
  Actual local API returned78/78SPYspread buckets with checked arithmetic. Fixed
  post-body session-expiry gap after failing regression. All404tests/27files and
  production build pass with one test worker; affected branch re-reviewed.
  No intraday chart/AI or hosted deployment yet.

- Added bounded intraday transport and an internal shared-feed history route.
  History is isolated from live quotes, rejects overlap, checks exact contracts
  and session deadlines, and labels option midpoint/underlying trade bars apart.
  Fixed delayed-timer acceptance after a failing regression. All396tests/25files
  and production build pass with one test worker; independent review clear.
  Public owner-validated route, live service proof, charts and AI remain next.

- Added transactional Candle parsing with snapshot/transaction gating, corrections,
  removals, explicit gaps, strict validation and bounded detached results. Six
  acceptance tests and focused build passed; actual feed reproduced 78 spread
  buckets. Intraday route/chart integration is not implemented. All 383 tests and
  production build pass with one test worker. An earlier parallel run had three
  failures; affected suites also pass together without changing test deadlines.

- Verified two-leg intraday alignment:78/78five-minute buckets for SPY769/770
  calls in the testedSep4session, with separately labeled SPYtrade reference.
  Extended bounded tracer/selfchecks for missing, duplicate and off-grid buckets.
  No productionhistorychart yet; aligned buckets do not prove simultaneousquotes,
  actualP/L or executablespreadprices. No account/order/saved writes.

- Added bounded read-only intraday Candle tracer. Verified78five-minute option
  midpoint bars in one regular session; SPYmidpoint snapshotempty, separate SPY/
  option last-trade bars available. Corrected missingvolume handling to null after
  failing regression; syntax/selfchecks pass. No productionchart/feed change or
  broader realtime/multileg coverage claim, no saved/account/order writes.

- Fixed history AI prompt/verifier ambiguity that accepted quote inputs as closing
  prices despite a no-fill disclaimer. Live frozen control reproduced falseaccept
  before change and rejection after; correct quote explanation remains accepted.
  One generated reply inspected;377tests/build and finalfocusedchecks pass.
  Eight bounded synthetic inference calls, no saved writes or deployment. Targeted
  proof only, not general expert reliability or intraday-data parity.

- Corrected recovered historical quote labels that falsely implied a saved trade.
  Actual App recovery now browser-verified for exact entries, shares, fees, text,
  detached identity, Undo and delayed quote/review-error suppression.12browser
  checks and377tests/23files/build pass; independent review clear. Synthetic APIs,
  real local valuation Workers; no live saved writes, reload or hosted proof.

- Verified tab recovery with10browser-run component checks covering stale replies,
  owner boundaries, storage failures and historical market cost preservation.
  Dev-only harness makes no provider/saved-trade calls and is absent from production
  output. Fresh377tests/23files/build pass; independent review found no blockers.
  Full App market reload and pending-request integration remain unverified.

- Added owner-partitioned tab-draft recovery for position, dated quotes, title,
  thesis and unsent question. Explicit Restore opens detached unsaved analysis
  with Undo; startup cannot overwrite a pending recovery copy. Reused full quote
  validation and preserved historical costs/dates.377tests/23files and build pass;
  browser text-draft reload/restore/Undo verified. Not durable crash backup; edited
  position reload, market recovery and adversarial storage/race UI cases remain
  unverified. No saved trade writes or deployment.

- Connected historical charts to read-only AI discussion using freshly reloaded,
  owner-validated Theta series and a separate verification pass. Date/range changes
  cancel discussion; mismatched series are rejected. Reused lot discussion transport
  without exposing its tools. Verified374tests/22files, production build, independent
  review and a real local browser reply. Loose hypothetical-fill wording remains an
  AI-quality limitation; no realtime, hosted or full consumer-readiness claim.

- Added paired strategy/underlying daily history charts with shared date inspection,
  quote intervals, raw timestamps and explicit gaps. Client rejects mismatched or
  stale results. Verified371tests, build, independent review and live local browser
  flows. No AI history context or hosted/intraday parity yet. Development hot reload
  reset an unsaved workspace; saved positions were not changed, draft recovery open.

- Connected local historical pricing to an owner-scoped endpoint and shared paced
  Theta catalog/history loader. Invalid requests cannot reach Theta; hosted use
  remains explicitly disabled pending relay/shared limits. Verified369tests,
  production build, independent review and actual local API values. Charts next.

- Added the historical EOD parser/composite with signed quote intervals and null
  gaps; live Theta payloads reproduce the four-session spread values. Independent
  review caught a shared calendar-date validation defect; valuation, scenario and
  expiry timestamps now reject normalized dates such as February30. History API,
  coordinated transport and charts are not connected yet.

- Verified local Theta historical EOD access for a four-session SPY spread and
  underlying; recorded quote-side arithmetic, timestamp differences and the next
  historical-pricing acceptance/implementation plan. Research/probe only: no
  historical chart shipped, no deployment or subscription changes.

- Added quoted-window strike activity with separate call/put volume and open
  interest, expiry selection, keyboard inspection and contextual AI discussion.
  Missing counts remain distinct from zero; counts do not imply trade direction
  or execution quality. Moved the expandable chain below the payoff workspace.
  Local verification is recorded in the real-option-chain evidence; no deployment.

- Restored Analyze remaining holdings in lot management. Dated effective weighted
  costs and signed shares are checked against current inventory before opening a
  separate unsaved builder analysis; saved history and Undo remain intact.
  Unsupported inventory now shows its supplied reason. Verified:353 tests,
  production build, independent review, lot and original-lifecycle browsers.

- Added audited opening-price corrections for initial and later lots, including
  closed lots. Original executions remain unchanged; realized P/L and remaining
  basis recompute together. Preview, owner-scoped confirmation and identical
  retries reuse the existing ledger flow. Verified: 352 tests, production build,
  independent source review and lot browser regression. Local server restarted;
  no deployment. Quantity/time/identity corrections and opening voids remain open.

- Clarified existing AI model-basis facts: fixed-input option valuation has no
  historical price-path input; early-exercise pricing is not assignment accounting.
  Both engines' endpoint checks,348 tests/build and independent review pass.
  Fresh AI wording improved, but an unrelated leg-versus-position error remains.

- Added a local current-calendar loss-bound safeguard to the existing verifier
  call. It blocks recognized unsupported current caps even when AI says valid,
  without applying the calendar's missing bound to other positions. Verified:
  347 tests/build, independent review, three live verifier controls, local API
  generation and chain browser. Broader prose accuracy remains unresolved.

- Extended diagnostic claim checks to preserve negation/equality and reversed
  position naming. Added calendar cap-versus-sample projection. Four synthetic
  live calls passed; offline equality checks and independent review strengthened
  coverage. Runtime unchanged; no whole-reply or trading-readiness claim.

- Added four preregistered profitability-projection controls with independent
  wording. All pass live; reversed local numeric ordering flips the decisions.
  Recorded implicit-horizon/non-applicable distinctions and inconsistent extra
  claim extraction. Diagnostic only; runtime remains unchanged.

- Added diagnostic-only typed profitability-claim projection with local numerical
  checks. Two live synthetic calls distinguished the retained bad/corrected pair;
  coverage assertions and offline ordering/schema checks prevent empty-output
  success. No runtime verifier promotion or general AI-quality claim.

- Added scenario display choices for dollar P/L, signed position value and P/L
  divided by positive exact expiry maximum loss. Curve, heatmap, table, CSV and
  captured AI context share the same transform; canonical dollar calculations
  and holdings stay unchanged. Unsupported risk denominators remain unavailable.
  Verified with 341 tests, production build, display/chain browser checks and
  independent review; no live-provider or hosted deployment verification added.

- Refreshed documented parity audit against official indexed OptionStrat sources
  and current code. Corrected stale template/company-search/IV/export status;
  selected normalized scenario value views as the next material analytics gap.

- Labeled AI interpretation separately from calculated results in workspace and
  lot discussions, including generated assumptions/objections. Lot busy text now
  says Reviewing, not Verifying. Both browser paths and production build pass.

- Added unsaved-position indicator and native reload/leave warning. Successful
  save/load acknowledges exact local content; Undo can return clean, while failed
  or stale responses keep newer edits dirty. Real canceled reload and race tests pass.

- Quoted-chain contract identities now remain visible during horizontal scrolling.
  Opaque sticky cells preserve selection and header stacking. Desktop/mobile
  geometry, visible-action and corner hit checks plus production build pass.

- Chain explorer now adds an explicitly selected long or short contract to the
  workspace, preserving existing holdings and costs. Uses quote-basis pricing,
  snapshot validation and Undo. Keyboard/browser, 339 tests and build pass.

- Retained complete failing AI comparison and frozen numerical inputs. Full-reply
  replay reproduces Google's false acceptance with or without extra payoff facts;
  Qwen controls return HTTP429, not quality verdicts. Production settings unchanged.

- Added matched profit-threshold verifier diagnostic with optional calculated
  counterexample. Four real calls distinguish isolated false/correct claims with
  or without extra facts; no production change justified. Full-reply failure remains.

- AI comparisons now accept a shared total global IV shift while preserving
  matching expiry adjustments. Both inventories validate effective IV separately;
  UI displays assumptions without changing the workspace. 339 tests/build/browser
  pass; live synthetic shift interpretation passes, semantic reliability remains open.

- Added opt-in real two-turn AI comparison regression using synthetic quotes.
  The follow-up resolves "those two" from conversation text, recalculates both at
  $110 expiry, and asserts $568.40/$913 P/L with no workspace changes. Six actual
  provider calls pass; this does not establish general conversational reliability.

- AI holdings comparisons can now evaluate both positions at the same requested
  spot/date without changing the workspace. Returned baseline drives table/chart;
  unsupported horizons reject. Browser and live synthetic arithmetic checks pass.

- Chain rows now offer read-only AI comparison against a selected leg. The native
  tool prices the quoted alternative, preserves other holdings and separates it
  from roll cashflows. Comparison shows both quote identities and breakevens.
  337 tests/build and browser pass; live synthetic tool arithmetic passes, with
  interpretation weaknesses retained in the AI reliability evidence.

- Added captured-chain explorer with expiry/type filters and spread-percent,
  volume and open-interest sorting. Contract replacement reuses existing pricing,
  validation and Undo. Browser verifies liquidity ordering, missing counts,
  held-cost restoration and mobile layout; TypeScript/build pass.

- Added owner-scoped saved JSON export preserving original snapshots and complete
  null/v1/v2 ledgers without conversions. Real local download verifies saved versus
  unsaved revision fidelity. 336 tests and build pass; import is not yet available.

- Verified real company search -> AAPL chain -> SPY chain -> two Undo steps,
  including leg inputs and restored dated quote provenance. Search collapses on
  committed symbol changes so results no longer displace the chart after loading.

- Added company/ticker discovery using read-only Tastytrade search. Selecting a
  result fills the ticker without changing the trade; loading remains explicit.
  Authenticated bounded API, keyboard/mobile and stale-response checks pass;
  actual local Apple search returns three results. 335 tests and build pass.

- Added independent finite-difference aggregate coverage for an American put
  calendar with unequal quantities, signed stock, costs and expiry-specific IV.
  Reproduced existing oracle refinement; all 332 tests and production build pass.

- Lot transaction and amendment previews label projected accounting separately
  from saved realized P/L, including explicit uncertain-save warnings. Browser
  regression checks cover edit-without-save and ambiguous retries; build passes.

- Holdings comparisons now expose captured retrieval, underlying and selected
  option quote timestamps, with hypothetical-purchase and no-refresh labels.
  Dated AAPL live comparison correctly separates383current/381compared profit;
  wording/accounting weaknesses remain tracked. Browser and build checks pass.

- Verified live AI leg exclusion with retained expiry-IV assumptions and costs;
  remaining-call loss307/breakeven103.07 were correctly distinguished from closing
  economics. Comparison tables now show each position's payoff horizon. Browser
  regression covers calendar-to-long-call horizon changes and immutable history.

- Added read-only AI holdings comparison: additional shares use weighted held
  cost; excluded options show remaining exposure without invented close proceeds.
  Captured metrics and a read-only chart leave the workspace unchanged. Live
  three-call comparison passed with distinct current/compared payoff bounds.
- Fixed Google generation HTTP400 caused by the provider-facing nested expiry-IV
  reply field. Flat set_expiry_iv operations preserve canonical workspace data,
  unrelated expiry shifts and legacy parsing. Real generation now succeeds.

- Added a diagnostic-only Qwen probe separating completion quality from the
  production deadline. Bad full reply timed out even at60s; corrected control
  accepted at24.57s. No semantic verdict on the bad reply, no model/timeout switch.
  Frozen-request and strict-response offline checks pass; evidence retained.

- Added opt-in passage-verification diagnostic with strict complete-ID coverage
  and offline regression checks. Live two-case test failed: every passage was
  inspected, but unsupported calendar claims were still approved. Retained
  evidence and usage; no production gate change or broader reliability claim.

- Repeated full-calendar verifier evaluation with unchanged sampled-range facts.
  Across three runs low reasoning falsely accepted the bad reply3/3; medium
  rejected2/3 and timed out1/3. Both accepted corrected controls3/3. Retained
  negative evidence; no production reasoning-policy change.

- Retained sampled P/L extrema coordinates, date, grid domain and count in the
  shared metrics and AI facts; mixed-expiry workspace now exposes these assumptions.
  Exact bounds and pricing are unchanged. 328 tests/build and browser pass.
  Live calendar replay with added provenance: low-effort verifier still falsely
  accepts the bad reply; medium rejected it in one trial. No model-policy change.

- Added expiry-specific scenario IV controls without changing quoted IV or entry
  costs. Shared effective-IV pricing covers European/American valuation, AI
  scenarios and remaining lots; validated maps survive save/load and Undo and
  are pruned only on trusted inventory changes. Captured analysis and CSV retain
  assumptions. 326 tests/build and expiry-control, table and AI what-if browser
  checks pass; independent integration review found no blocker. Local only.

- Fixed effective-IV validation accepting overflow from two finite inputs. Shared
  validation now rejects non-finite sums before valuation or persistence. Regression
  reproduced acceptance before the guard;320tests/build pass. Per-expiry controls
  remain an in-progress cross-workspace change, not implemented by this fix.

- Fixed American continuation theta instability by using the pricing PDE with
  tree price/delta/gamma instead of bumping time across different lattice grids.
  Existing exercise/expiry/zero-spot guards preserved; two repricings removed.
  Regression fails before, passes across six tree depths after.320tests/build and
  canonical American browser checks pass; prior reference tolerances unchanged.

- Extended independent American valuation references to one-day ATM call/put,
  two-year high-volatility put and OTM dividend-yield call. QuantLib FD800/1600
  converges; canonical CRR1024 meets unchanged tolerances.319tests pass. Nearby
  tree sizes fail the OTM theta tolerance: recorded instability, not full parity.
  Pricing logic unchanged; corrected stale tracer-only source comment.

- Added local scenario-table CSV download with full-precision displayed P/L/Greeks,
  model/date/input assumptions and explicit modeled-not-fill labels. Export uses
  current worker results only and is disabled while unavailable; no position edits
  or new dependencies. Browser download rows match calculator exactly; existing
  table keyboard/Undo/mobile checks and production build pass.

- Added paired Google/Qwen full-reply verification diagnostic with identical inputs,
  low effort and counterbalanced order. Google repeats false acceptance; Qwen returns
  HTTP200 but times out on both drafts under the existing deadline. Corrected Google
  control passes. No semantic ranking or production switch justified; four calls,
  expected-outcome suite fails3/4. Syntax/trace checks pass.

- Tested three diagnostic-only verifier interventions against the retained calendar:
  duplicate-fact removal, explicit audit, and claim-by-claim audit. All still falsely
  accept the bad reply; corrected controls pass. Claim audit omits problematic
  clauses. Preserved negative results; no unsupported runtime promotion. Ten paid
  verifier requests total; diagnostic syntax/trace checks pass.

- Added retained full-calendar reply replay with reconstructed selected-contract
  context and exact metric/quote assertions. Reproduced low-effort false acceptance;
  medium timed out on the original. Corrected reply accepted at both efforts.
  Four-call diagnostic intentionally fails2/4 expected outcomes; no model switch
  or production fix claimed. Original full provider envelope was not retained.

- Added bounded calendar verifier discrimination checks using the existing harness.
  Four frozen claims pass at both low/medium effort (8calls); four softer observed-
  wording controls pass at low (4calls). No demonstrated reason to raise effort.
  These isolated snippets do not reproduce the full generated paragraph failure;
  no model/prompt change or general reliability claim. Syntax/trace checks pass.

- Retained three post-fix real-chain AI assessments and independent scoring:
  straddle7.5/10, partial coverage7.5/10, calendar4/10 (fail). Recomputed alternative
  coverage exposes current/proposed metric leakage ($383 versus $381). Split
  horizon negatives and aligned their question; both rejected, positive accepted
  in three real verifier calls. Diagnostic syntax/trace checks pass. No production
  behavior change this pass; generation remains below consumer acceptance.

- Added real-chain assessment diagnostics for straddle events, half-covered calls
  and calendars. Three live contract checks passed; reviewed straddle prose scored
  6/10 and exposed expiry/pre-expiry reasoning errors. Strengthened both AI prompts;
  two paid verifier controls pass and 318 tests/build pass. Other two replies were
  truncated before prose review; no expertise or corrected-generation claim.

- Added explicit Events & market context inspection in the AI rail, with event-first
  ordering, dated sources/gaps, safe links and symbol-switch cancellation. Shared
  authenticated rate-limited endpoint runs no AI or position writes. Full318tests
  pass; final browser/build checks pass. Full-workspace visual inspection caught
  composer squeezing; bounded panel height fixes it with regression coverage.

- Added provider-reported earnings dates from the existing metrics response,
  independently dated and explicitly not issuer-confirmed. No EPS/session/forecast
  inference or extra provider request.317tests/build pass; live AAPL stale record
  withheld. Four synthetic live Google verifier controls rejected false issuer
  confirmation, wrong ex-date and executable-liquidity overclaim, accepting the
  correct control. This is narrow verifier evidence, not general expertise proof.

- Added separate Tastytrade IV-index/rank and underlying-liquidity evidence with
  one shared read-only OAuth request. Source-specific IV/rank timestamps are
  validated independently; undated percentile is omitted. Raw scores never imply
  executable contract liquidity or change model assumptions.315tests/build pass;
  final timestamp tightening49focusedtests/build pass and independent review clear.
  Live AAPL staleIV withheld, liquidity labeled by record time only.

- Added bounded Alpaca provider-reported cash-dividend context to AI evidence and
  existing source disclosure. Validated ex-dates remain distinct from retrieval
  and process dates; incomplete/empty results never imply no upcoming event.
  Generation/verifier prompts preserve those limits, with no automatic yield or
  pricing change.313tests/build and independent review pass. Live access200;
  actual AAPL loader reports upcoming evidence unavailable, not an empty calendar.

- Enforced the configured application destination origin before JWT verification.
  Valid identities cannot use alternate hosts, HTTP or alternate ports to reach
  APIs/assets. Regression reproduced admission before the fix;311tests/build pass.
  Built output has no local bypass, Worker-first assets and disabled preview URLs.
  Actual hosted DB/Access configuration and deployment proof remain pending.

- Replaced the eight-entry isolate-local quote cache with shared owner-scoped D1
  snapshots. Ten-minute expiry, hashed credential binding, immutable dated
  provenance and async persistence protect calculation/save/capture across app
  instances. Independent review clear; 309tests/build pass, local migration applied,
  real Tastytrade100-contract load and calculation return200. No deployment.

- Refreshed the full readiness audit and prioritized hosting/data foundations over
  more chart polish. Fixed feed sockets outliving verified login expiry: trusted
  per-connection deadlines, expiry closure, send-time checks and race-safe cleanup
  preserve other subscribers. Loopback development gets a one-hour reconnect lease.
  306tests/build pass; no deployment or hosted-security claim. Shared snapshot
  continuity and private-hosting configuration remain open.

- Added pointer and native keyboard inspection of held/proposed lot curves, with
  shared sampled prices, crosshair and both P/L totals/difference. No interpolation
  or pricing/network work on hover. Independent review caught stale inspection
  returning after a preview; reproduced and fixed with browser regression.
  303tests/build and both local browser workflows pass.

- Added explicit chart previews for conversational lot scenarios. Shared curve
  workers must match server point totals; selected controls, conversation and saved
  lots remain unchanged. Return-to-selected and input/source invalidation included.
  Browser acceptance failed before the action existed, then passed;303tests/build
  and lifecycle browser pass. No new dependencies or provider calls.

- Added conversational lot what-ifs: one read-only calculation call for up to four
  scenarios, displayed without changing workspace controls. Strict arguments,
  shared30s tool deadline and calculation-backed verification;303tests/build and
  browser checks pass. Live Google tool flow and targeted attribution controls
  pass after fixing an unsupported routing parameter and a misleading explanation.
  These controls do not establish general AI expertise or full product readiness.

- Connected modeled lot scenarios to read-only AI discussion. The server rebuilds
  both sides from owned saved lots and quotes, using the same scenario preparation
  as browser curves; only coordinates cross from browser to server. Mismatched
  replies are discarded and coordinate changes clear discussion context. Existing
  302 tests extended and passing, build and both browser workflows pass. No new
  dependencies or ledger writes; free-form scenario tool requests remain next work.

- Added read-only AI discussion of saved-lot comparisons, with server-owned facts,
  bounded follow-ups and a separate generation/verification contract. No operations,
  Apply action or client-supplied P/L. 302 tests/build and both browser workflows pass.
  Live synthetic accounting passed; an invented-user-belief failure prompted a
  targeted prompt fix and paired controls. This is not general expertise proof.

- Added v2 recorded-close price corrections and erroneous-close voids with native
  action/target/reason inputs, preview and append-only confirmation. Stable retries
  stay locked through lost responses, mismatched reloads and rate limits. Existing
  owner/revision checks and dependency replay reject invalid restorations.
  300 tests/build and both browser workflows pass; no actual trade reversal/orders.

- Added held/proposed future price, UTC time and IV-shift scenarios with overlaid
  P/L curves from the existing pricing workers. Realized P/L stays fixed; allowance
  deducted once; closed and stock-only sides supported. Shared first-expiry limit
  and lot/source checks prevent dropped holdings or mismatched assumptions.
  299 tests/build and real-worker browser comparison pass, including mobile.

- Added read-only held/proposed transaction P/L comparison from one owned snapshot.
  Shows realized, unrealized, allowance and combined totals before confirming a roll;
  fully closed sides use realized totals. Shared execution/source chronology also
  applies to closed sides. 296 tests/build and mocked desktop/mobile comparison pass.
  Future price/time scenario curves and v2 amendment forms remain unfinished.

- Added explicit dated lot P/L from captured workspace quotes, midpoint/natural
  liquidation basis, per-lot marks and realized/unrealized/allowance breakdown.
  Quote/revision identity guards and source-change clearing prevent stale results.
  295 tests/build and both mocked lot/legacy lifecycle browser checks pass.
  Before/after scenario comparison and v2 amendment forms remain open.

- Added Manage lots & rolls: explicit lot closes and captured-builder openings,
  empty execution-price inputs, inventory/accounting preview and atomic confirm.
  Protected transaction routes preserve stable retries and owner/revision checks.
  295 tests/build and mocked mobile/retry browser checks pass. No broker orders;
  dated P/L/scenario comparison and amendment forms still need UI integration.

- Integrated v2 lot persistence with owner/revision CAS, validated reads and
  exact legacy retries after upgrade. Added read-only lot inventory and schema-aware
  valuation; legacy close routes reject v2 rather than showing original holdings.
  294 tests/build pass. Public roll writes and lot-management UI remain disabled.

- Added ordered v2 close-price corrections and erroneous-close voids, preserving
  raw legacy/transaction history and checking later inventory dependencies.
  Replay now withholds restored quantity until its void is recorded; regression
  covers legacy/new lots, equal-time reclose and independent earlier quantity.
  291 tests/build pass. V2 persistence/UI and opening cancellation remain absent.

- Added dated v2 lot valuation with per-lot marks, once-only allowance and
  weighted-basis chart projection. Wide inventory and invalid chart IV retain
  quoted P/L with an explicit unavailable chart; expired options are not settled
  implicitly.287 tests/build pass. Not yet exposed through persistence/API/UI.

- Implemented isolated v2 opening-lot domain: preserved v1 base, dated additions,
  explicit lot closes and atomic close/open rolls. Immutable contract metadata,
  stable semantic retries, chronology and finite accounting checks; no FIFO/netting.
  284 tests and build pass. Legacy expiry spellings compare by equivalent instant
  without rewriting history. Not yet connected to valuation, persistence or UI.

- Added pre-migration v1 ledger characterization for exact serialized close,
  correction/void history and old retry behavior after subsequent full closure.
  All8 lifecycle tests pass. Defined opening-lot/atomic-roll acceptance and ordered
  integration plan; corrected stale readiness audit. No opening/roll runtime yet.

- Reordered Manage closes around remaining inventory and dated P/L, with one
  native action selector instead of three simultaneous forms. Added sticky header,
  visible keyboard focus and single-column mobile forms; retained audit history
  and uncertain-save locks.277 tests and mocked desktop/mobile browser checks pass.

- Enabled erroneous-close void preview/confirm in Manage closes, preserving
  original/correction/void audit history and restoring recorded inventory only.
  Owner-scoped CAS and stable retries protect duplicate submissions; voided closes
  leave active selectors.277tests/build and integrated mocked browser pass.
  Not an actual trade reversal or order; no user records changed during checks.

- Added erroneous-close void domain: preserves original audit history, removes
  cancelled realized P/L and restores held inventory. Validates original fills,
  effective capacity, global event IDs and chronological rules.276tests/build pass.
  No void writer/API/UI yet; this cancels bad records, not actual executed trades.

- Enabled audited close-price corrections in Manage closes: explicit preview and
  confirmation, reason and exact-price history, fullyclosed support, safe retries.
  Shared owner/CAS writer prevents competing closes/corrections from overwriting.
  Original fills/inventory unchanged.275tests/build and mocked browser pass.

- Added audited close-price correction domain: original fills retained, exact
  retry IDs, reason/time validation and effective-price realized recalculation.
  Inventory, execution timestamps and held basis unchanged; legacy records work.
  Full273tests/build passed; extra boundary assertions checked separately.
  Correction store/API/UI writer remains pending; no records changed.

- Added explicit Analyze remaining holdings from a successful dated valuation.
  Validates inventory/basis/snapshot, opens detached unsaved builder analysis with
  Undo and excludes recorded realized P/L/original allowance. No ledger/save/AI
  side effects.272tests/build and malformed/valid import browser checks pass.

- Added explicit dated remaining-holdings valuation in Manage closes. Owner-scoped
  workspace quotes preserve held basis; source times must follow recorded closes,
  expired remaining options reject. Realized plus unrealized less allowance once,
  including stock-only positions.272tests/build and mocked lifecycle browser pass.
  No automatic provider fetch, builder mutation or live-return claim.

- Added saved-position lifecycle read, close preview and explicit confirmation
  endpoints, with owner/CSRF checks and authoritative market-basis validation.
  Dedicated Manage closes panel keeps recorded inventory separate from builder
  scenarios.270tests/build pass; interaction verification recorded in SDLC evidence.

- Added owner-scoped recorded-close persistence with atomic revision checks,
  exact retry identity and protection against builder overwrites. Applied local
  0002 migration. Malformed history/basis fails closed; ordinary load rejects
  lifecycle records until its dedicated view exists.269tests/build pass; local
  saved-list returns200. Close API/UI remain unexposed; nothing deployed.

- Added recorded-close lifecycle domain and regression tests: partial/full option
  and share closes, frozen basis, long/short realized arithmetic, retry identity,
  stock-only/closed boundaries and allowance-once closed totals. Rejects over-close,
  invalid dates/quotes/basis and numeric/version overflow.265tests passed before
  final version guard; focused4tests/build pass after. Not yet wired to saved API/UI.

- Refreshed readiness audit against current local source/browser and official
  OptionStrat documentation. Corrected stale absent-optimizer/12-template claims.
  Prioritized recorded close/roll lifecycle and realized/unrealized separation;
  retained hosted, mixed-expiry, historicalanalytics and demonstratedUIparity gaps.
  Planning/audit only this tranche; no lifecycle feature claimed implemented.

- Removed repeated full validation from generated-candidate probability calculation;
  public validation and internal numerical/reference guards remain. Frozen256100-
  candidate result SHA unchanged; local runs4.13/4.76s became3.40/4.06s. Added
  malformed unheld-contract/quote/IV regression assertions.261tests/build pass.
  Large-search hosted CPU budget remains unverified.

- Live synthetic probability search passes exact tool/read-only assertions across
  three paid stages. AI correctly explains snapshot versus workspace horizons and
  high-probability gain/loss asymmetry. Candidate cards now show maximum gain/loss
  beside probability, label unbounded gain explicitly and expand detailed references.
  Browser red/green label and Inspect/Apply/Undo checks pass; 261 tests/build passed
  before final label-only correction. No broad expertise or hosted-readiness claim.

- Added expiry-probability candidate objective and displayed finalist probabilities.
  Every candidate in an expiry uses one quoted-window IV reference and snapshot
  spot/time, independent of its legs or target scenario. Candidate IVs/entries stay
  unchanged. 261 tests/build and mocked probability display/Apply/Undo pass.
  256100-candidate local probability profile: 4815ms; hosted CPU and live AI
  probability-objective behavior remain unverified. Not a forecast win rate.

- Expanded bounded synthetic AI probe to neutral-expiry butterfly search with held
  stock/fixed-cost preservation and a composite false-claim verifier/control pair.
  First live draft exceeded reply text schema; explicit concise-generation guidance
  fixes the sampled retry without relaxing the 1500-character guard. Seven total
  paid requests: failed two-stage draft, negative/control one each, successful
  three-stage retry. 257 tests and build pass; no general AI reliability claim.

- Candidate search now validates and counts its exact domain before pricing or
  enumeration. Oversized American search regression changed from 100 pricing
  calls to zero; separated 100-contract local rejection observed at 12.98ms.
  Planned/evaluated counts reconcile across irregular and two-expiry grids.
  Full 256-test suite, build and mocked candidate browser pass. No hosted CPU claim.

- Expanded quoted candidate search to equal-wing 1:2:1 long call/put butterflies
  and iron butterflies/condors, including unequal wings. Quantity-aware repricing,
  deterministic top-five retention and complete eligibility counts. Searches over
  300,000 structures fail explicitly and require a narrower window; no partial ranks.
  Both-model canonical small-chain tests, irregular millistrikes, 100-contract
  counts and mocked inspection/Apply/Undo pass. Full suite 256 tests passed before
  final limit; focused 15 tests pass with limit. No hosted performance claim.

- Candidate browser rejects altered metrics and Clear cancels both inspection
  workers without mutation. Added bounded synthetic live-search probe; second
  three-stage run passes exact tool/ranking/read-only assertions. First run only
  failed harness version expectation, corrected to existing API behavior. Six
  total paid requests; no data-provider/order calls or broad expertise claim.

- Added ranked candidate results and Inspect candidate into existing curve
  comparison/Apply/Undo. Local worker recomputes full metrics; stale snapshot,
  version or model blocks inspection. Explicit new-position replacement warning.
  Fixed non-curve inspection after reviewer finding.255 tests/build and mocked
  desktop/mobile candidate browser pass; live search reasoning remains unverified.

- Wired read-only search_candidates into the existing AI tool roundtrip using
  server-resolved quotes. Search facts reach generation/verifier; operations after
  search are rejected. Five-minute all-window freshness gates tool availability
  and execution. Mocked native-tool, stale/spoof/mutation checks and build pass.
  No candidate inspection controls or live model-quality proof yet.

- Added quoted candidate-search engine for all long options and same-expiry
  verticals in a100-contract window. Explicit target/budget/fee/basis, deterministic
  P/L or return-on-risk ranking, per-contract pricing reuse and top5 full metrics.
  Exhaustive18-candidate Euro/American regression passes; invalid-date review fix
  verified. Not yet connected to AI/UI; broader strategy coverage remains open.

- Audited candidate-search gap and defined CS-1..7 acceptance plus implementation
  plan. Current AI tool only reprices unchanged positions; no optimizer exists yet.
  Independent review required explicit quantity domain, held/new trade separation
  and positive exact-loss denominator. Updated stale readiness model/feed rows.

- Fixed historical-to-current capture disconnecting an unchanged subscription:
  feed identity now depends on symbol/contracts, not snapshot provenance.
  Saved roundtrip/load/re-enable with obsolete JSON rejection passes. Moved auto
  control into feed details after chart-position regression; feed layout stable.
  253 tests, final build and automatic/feed browsers pass with mocked providers.

- Extended automatic repricing browser proof: AI submission freezes state and
  disables repricing while pending; obsolete invalid-JSON capture is ignored.
  Save pending blocks enable and submits exactly the reviewed state. Mocked run
  passes; corrected test-only React visibility assertion timing.

- Added opt-in automatic workspace repricing from server-validated feed captures
  every15seconds, preserving held costs, quantities, custom targets and future
  dates. One Undo checkpoint per session; edits, AI review, save/load, hidden tabs
  and feed interruption stop updates.253 tests/build and mocked automatic/capture
  review browsers pass. This is sampled repricing, not tick-by-tick or market-hours proof.

- Stream source-time regressions now clear the shared feed and block capture
  until reconnect. Independent bid/ask/IV watermarks survive unknown timestamps;
  equal-time changed quotes remain accepted. Six regression sequences verified.
  Conservative availability tradeoff, not a provider ordering guarantee.

- Removed unused Greek calculations from spot attribution, sharing existing
  price-only valuation and table coordinates. Frozen 16-case results unchanged;
  252 tests/build and table/American-model browser checks pass. Local American
  table observations improved from1177 to580ms (condor),782 to428ms (calendar).
  These are single-machine observations, not hosted performance guarantees.

- Added a quantity-only AI operation that preserves option contract/held fields
  server-side. Live American-model probe first failed an empty full-leg edit;
  narrowed operation worked, then verifier caught incorrect after-Apply wording.
  Corrected generation guidance; final two-stage synthetic check passed. 251
  tests/build pass. One ambiguous IV suggestion remains; no broad quality claim.

- Added canonical American CRR valuation across prices, Greeks, chart/table/
  heatmap calculations and AI scenario/proposal facts. Choose the model under
  View assumptions; European remains default. Model identity survives templates,
  saved state and Undo. 250 tests/build and canonical/legacy-preview browsers
  pass. Corrected cramped mobile assumptions layout after screenshot review.
  Continuous-yield valuation only; no discrete-dividend or assignment accounting.

- American sensitivity calculation can return one requested Greek while skipping
  unrelated bumps. Same lattice depth/formulas; full-result callers unchanged.
  Exact parity matrix, existing independent references and245 tests/build pass.
  Canonical workspace routing is not yet enabled; no UI speedup claimed.

- Audited canonical American routing across engine, AI, persistence and UI;
  recorded AM-1..6 integration gates. Local161-point/four-leg CRR1024 measurement:
  price-only621.7ms, all-Greeks4093.3ms. Model switch remains gated; labels,
  template identity and canonical-versus-preview routing need coordinated changes.

- Historical scenario previews reconcile their six recorded values in the
  calculation worker before displaying targets or charts. Closing cancels work;
  unavailable calculations remain distinct from mismatched records. 244 tests,
  build and held-worker/failure/reopen historical browser checks pass.

- AI proposal before/after metrics now use the existing background worker.
  Recheck captured identity/version after calculation; Clear and failures cancel
  pending work without publishing partial comparisons. 244 tests/build and
  delayed-proposal plus existing cost Apply/Undo browser checks pass.

- Moved P/L and Greek curves, expiration references and proposal/history chart
  geometry into the existing calculation worker. Replaced inputs hide stale
  geometry; cancellation and retry preserve builder state and Undo. Worker
  validation rejects incomplete grids. 244 tests/build and target, Greek,
  historical-preview and delayed-worker browser regressions pass.

- Moved canonical44x18heatmap pricing into the existing calculation worker.
  Canvas now only renders supplied points; pending work clears old pixels/tooltips
  and blocks selection. Exact grid/date/P-L parity covers all23templates across
  three domains. 243 tests/build and worker/heatmap/American/table browsers pass.

- Moved scenario-table rows and stock/option attribution into the canonical
  worker bundle. Pending tables hide stale rows, retain expanded attribution,
  restore selected-row keyboard focus without stealing it from another control.
  241 tests/build and baseline-plus-delayed-worker browser checks pass.

- Moved headline metrics, Net Greeks, per-leg Greeks and position brief to a
  cancellable canonical calculation worker. Replaced inputs hide old results;
  failures permit retry without changing builder/Undo. Preserved expanded leg-risk
  panels during recalculation. 240 tests/full build, focused post-review tests,
  and worker/brief/leg-risk/American-preview browser checks pass. Chart geometry,
  proposed/historical calculation and canonical American routing remain separate work.

- Split P/L-only grids and modeled ranges from unused Greek calculations;
  P/L curves use that shared path. All23-template baseline outputs remain exact.
  Added analytic American zero-spot pricing, including negative-rate delayed
  exercise; undefined zero-rate put rho fails explicitly. 237 tests/build and
  P/L/Greek chart browser regressions pass. Canonical American switch not enabled.

- Connected American preview to read-only AI review using seven server-recomputed
  selected-date checkpoints. Canonical European facts remain separately labeled;
  preview rejects edits and extra tools. Historical analysis keeps its model label.
  234 tests, build and mocked browser integration pass; one live synthetic Gemini
  generation/verification returned correct requested P/L values. This supersedes
  the earlier temporary American-AI restriction, not the canonical-model boundary.

- Added visible read-only American heatmap preview with background calculation,
  loading and replacement/unmount cancellation. Browser desktop/mobile checks
  pass. Fixed AI model-context mismatch and stale tooltip after resize. Saved
  state/metrics remain European; American AI analysis is explicitly unavailable.

- Added cancellable American-surface browser worker. Real browser check passed
  792 points with an18.7ms maximum frame gap, plus active cancellation, captured
  inputs and invalid-state rejection. Completion remains multi-second; not yet
  connected to App or represented as a production worker bundle.

- Added explicit European valuation identity to new positions and AI facts,
  preserving old saved-state interpretation. Save/load keeps metadata and
  unsupported models fail before calculation/inference. American routing remains
  disabled pending non-blocking chart integration.

- Added reproducible independent QuantLib FD references for five American
  continuation cases, grid refinement and sensitivity-bump checks. Corrected
  a theta-definition mismatch in verification; nine tracer tests/build pass.
  QuantLib is test-only and the new model remains outside workspace routing.

- Added isolated American sensitivities and fixed a reproduced exercise-boundary
  gamma/delta error. Analytic call, expiry and exercise checks pass; independent
  continuation-region Greek validation remains open. Workspace pricing unchanged.

- Added an isolated American CRR price tracer with independent early-exercise
  premium checks and a four-leg heatmap workload benchmark. Four focused tests
  and build pass; synchronous performance fails the declared interaction gate.
  Not enabled in the workspace; existing saved analyses and pricing unchanged.

- Reconciled the old viewer contract with the full options-workspace goal and
  recorded seven unmet readiness gates. Added six independently specified AI
  verifier holdout cases: all six passed their first live run, as did six prior
  regressions. This is verifier-only evidence, not end-to-end AI expertise.

- Added dated option spread-width ledger and midpoint-to-natural liquidation
  difference to quote details and AI facts. No double deduction from P/L or
  implied execution/liquidity guarantee. 215 tests, build and mocked browser
  capture/review regression pass; independent second-pass found no defects.

- Added explicit Capture and review: commits a validated stream snapshot before
  asking AI, with no inference on failed/stale capture. Clear suppresses pending
  review intent; unsent drafts survive.213tests/build and mocked workflow/browser
  checks pass. Independent review caught a draft-erasure race; regression fixed.

- Same-symbol/contract live feeds now remain connected through quote refresh,
  capture and Undo; historical/current or selection changes still remount.
  Repeated capture uses the latest snapshot ID. Browser regression reproduced
  disconnection before fix and passes afterward. Restored chart-first layout by
  moving probability details below the canvas; prior visibility test retained.

- Added strategy-library search and family filtering across23templates, with
  result count, clear filters and actionable empty state. Browsing leaves the
  position and Undo untouched.213tests/build and desktop/mobile browser pass;
  native controls and existing workspace styling retained.

- Added long bullish-call and bearish-put diagonals;23templates total. Quoted
  selection searches valid cross-expiry pairs even without shared strikes.
  Same-strike/reversed/single-expiry substitutes rejected. Mixed-expiry bounds
  remain explicitly modeled, not exact.213tests/build and all23browser checks pass.

- Added long call/put butterflies with three legs and1:2:1 quantities;21templates
  total. Quoted-chain construction requires actual equal-width wings, ranked by
  center distance then width. Independent review caught/fixed equal-distance tie
  selection.211tests/build and all21-template browser checks pass (mocked quotes).

- Added short call, short put, short straddle and short strangle templates to
  sample/quoted constructors, UI and AI proposals. Uncovered-short family does
  not imply collateral or margin approval. Golden payoff vectors, natural bid
  entry and browser all19-template checks pass. Short put remains bounded at
  zero stock price; the other three retain unbounded upside loss labels.

- AI can propose an explicit new total cost allowance through existing Apply/Undo.
  Comparison shows both amounts to cents; edits invalidate stale proposals.
 207tests/build and mocked browser pass; live Google returned the requested20
  from10 without changing other fields. Verifier accepted, but wording about
  allowance affecting breakevens was imprecise; no general analysis-quality pass.

- Added optional flat total-position cost allowance across modeled/quoted P/L,
  payoff bounds, breakevens, probability, saved positions and AI facts. Asset
  values and Greeks are unchanged. Native control supports Undo; quantity edits
  preserve the allowance and templates reset it. 204tests/build and browser pass.
  This is a user assumption, not actual broker fees or realized accounting.

- Added modeled stock/option spot-move contributions to table UI and captured AI
  facts/history. Entry costs cancel; full option repricing replaces delta estimates.
 202tests/build and browser pass. Correctly scoped live verifier pair rejects
  zero-protection claim and accepts partial-offset explanation; earlier positive
  control was rejected under an overly broad table question and remains recorded.

- Historical table analysis now shows all five Greeks alongside P/L, with captured
  rows preserved after scenario edits. Browser/build pass. Live AI copied table
  values but overstated covered-call downside protection as zero; verifier accepted
  it. This remains an analysis-quality defect, not a clean semantic pass.

- Added scenario table beside Curve/Heatmap: selected-date P/L and five position
  Greeks, exact spot/target/strike rows, keyboard row selection and Undo. AI table
  context uses the same complete rows.201tests/build and browser pass; no ROI or
  capital-denominator assumptions added. Live AI table interpretation unverified.

- Added conditional expiry density curve with read-only range shading, density
  units and omitted-tail disclosure. Exact mode is sampled; expiry uses explicit
  point-mass text.199tests/build and browser checks pass; bounded rendering is
  sampled geometry, while range percentages remain CDF-derived.

- Verified the touch-magnitude correction with a frozen live pair: unsupported
  claim rejected, matched qualified explanation accepted. Historical probability
  cards now retain full distribution assumptions and both outside-range masses.
  Browser regression, build and diagnostic self-check pass; no general AI
  reliability claim follows from this targeted pair.

- Connected Ask about this range to validated server-calculated AI context and
  immutable historical range disclosure.198tests/build and delayed-reply browser
  regression pass. Live AI copied range probabilities correctly but verifier
  accepted an unsupported touch-probability magnitude claim; tightened prompts,
  with post-fix live semantic rejection still unverified.

- Added read-only expiry price-range probabilities (below/between inclusive/above)
  sharing the POP distribution, with invalid-range feedback and isolated Undo.
 197tests/build and browser pass. One two-call live AI check correctly explained
  sample46.80% POP with model assumptions and no win-rate/edge claim. Range
  selections are local controls, not yet supplied as AI conversation context.

- Added conditional scenario-to-expiry probability of positive P/L to workspace
  and AI facts. Full-domain piecewise payoff integration includes shares and held
  costs. Disclosed risk-neutral single-IV assumptions; not a forecast/win rate.
  Mixed expiries explicitly unavailable.196tests/build and probability browser
  checks pass; no live AI probability-quality or competitor numerical-parity claim.

- Preserved explicit scenario dates during ordinary quote refresh, matching stream
  capture behavior: newer quotes cannot silently move a selected scenario forward.
  Choose Now to advance. Browser regression failed before/pass after;193tests/build
  pass. No automatic target-spot reset or changes to held costs.

- Integrated stock-backed workspace: covered calls, protective puts and collars;
  held share costs, signed stock Greeks, explicit AI proposals/Undo and private
  save/load.193 tests, build and stock browser regression pass (browser APIs mocked).
  Fixed coverage facts after live AI incorrectly suggested two short calls against
  150shares as covered. Frozen unsafe suggestion now rejected; matched correct
  explanation accepted by live verifier. General AI correctness remains unproven.

- Implemented internal stock-backed accounting: signed share value/cost/delta,
  stock-aware expiration bounds and separately labeled dated stock marks. Frozen
  covered-call/protective-put/collar vectors pass.191 tests/build and existing
  browser regression pass. Public stock APIs remain blocked pending UI/AI/save
  integration; this is not yet an available workspace feature.

- Planned end-to-end stock-backed support with independently derived covered-call,
  protective-put and collar acceptance vectors. Identified save-field projection
  and stock-mark provenance requirements. No stock runtime capability added yet.

- Fixed quoted templates failing when spot lies outside a sufficient strike
  window. The shared builder now chooses a feasible center without collapsing
  legs or changing centered recipes. All12 templates pass both edge tests;
 185 tests/build and browser construction/sparse-rejection checks pass.

- Fixed Add leg rejecting unused quoted contracts when the last leg's type/expiry
  bucket was exhausted. It now prefers matching expiry/type, then nearest strike,
  while excluding contracts before the selected scenario. Held costs and Undo
  remain intact. Historical-window browser checks,184 tests and build pass.

- Corrected the position brief's zero-vega volatility-benefit claim. Theta and
  vega are now explicitly local sensitivities with two-decimal units, not finite
  move forecasts. Expiry wording checks every leg; calendars retain remaining
  IV exposure. Browser sign/expiry checks,184 tests and build pass.

- Fixed heatmap target coverage: distant/sub-dollar scenarios and leg strikes now
  expand the price range. Labels and selection markers align with sampled cells;
  keyboard inspection starts at the selected scenario. Endpoint pricing, mouse/
  keyboard selection and Undo pass browser checks; 184 tests and build pass.
  The44-column grid remains approximate, especially across wide price ranges.

- Fixed chart sampling that could miss near-expiry strike Greek peaks. Current,
  proposed and expiry-reference curves now include exact strike/target samples;
  sub-dollar and distant targets stay in range without changing quote spot.
  184 tests/build and browser geometry, preview, pointer-drag/Undo checks pass.
  Sampling does not guarantee every between-anchor extremum.

- Added Preview chart to calculated what-ifs: native read-only modal, captured
  position/quote context, per-leg IV and independent Greek selection. Target
  prices stay visible, including sub-dollar values and narrow near-expiry peaks.
  Invalid ledgers/metrics cannot render.184 tests/build and browser checks pass;
  live workspace, costs, quotes and Undo remain unchanged.

- Added explicit per-leg IV what-ifs to AI conversations, with complete effective-
  IV disclosure and full-vector P/L comparisons. Hypothetical pricing leaves
  market quotes, costs and position state unchanged.184 tests/build, independent
  review, browser checks and a live back-month-only request pass. Chart controls
  still use global IV; per-leg what-if results are currently read-only disclosures.

- Selected low reasoning for the verifier only; generation/tool continuation stay
  medium. Both settings passed six harder calendar/scope/attribution checks. A
  complete low-verifier scenario trial passed with independently checked claims.
  181 tests/build pass; deadlines, schemas and rejection rules remain unchanged.
  This is a reversible local candidate, not demonstrated general equivalence.

- Added a bounded paired verifier-effort diagnostic with fixed inputs, usage and
  timing records. Low and medium both passed six basic factual checks; observed
  means1.40s versus2.98s. Review found case-order confounding; corrected future
  scheduling and added payload-equality assertions. Production settings unchanged;
  complex scenario quality and end-to-end reliability are not established.

- Added baseline-preserving spot-only, date-only and IV-only P/L comparisons with
  a reconciled joint interaction residual to AI what-ifs and their UI disclosure.
  181 tests/build, independent review and browser checks pass. Live draft used
  the numbers but retained an overbroad theta claim; verification timed out and
  withheld the reply. This improves numeric grounding, not proven AI reliability.

- Added read-only conversational date/spot/IV scenario calculations through the
  existing pricing engine, with immutable per-reply results and no automatic edits.
  Fixed live Gemini routing and tool-envelope compatibility; verifier now receives
  the original question to check requested assumptions.180 tests/build, browser and
  a three-completion live calculation check pass. Causal explanation quality remains
  open: simultaneous date/spot/IV changes do not isolate any single driver.

- Added bounded synthetic draft tracing with offline byte/cancellation checks.
  Captured replies exposed a shared prompt error: uncomputed mixed-expiry bounds
  were described as impossible. Corrected generator/verifier and risk facts without
  changing prices or risk classification.169 tests/build and independent review
  pass; post-fix live-answer quality remains unverified.

- Added private verification-failure categories without changing public errors or
  the verification gate.168 tests/build pass. A bounded synthetic probe confirmed
  explicit Theta rejection before deadline; earlier HTTP failures remain unclassified.

- Live chart evaluation exposed a verifier-approved false generalization about
  calendar theta. Added near-spot calculated counterexamples and regression proof;
  166 tests/build pass. Bounded live rerun returned1/3 answers, withholding2/3.
  AI answer reliability remains an open defect, not a passing readiness gate.

- Added Ask about this chart and chart-aware conversation requests. Server-calculated
  nearby spot scenarios go to both AI passes and remain inspectable with each reply.
  Context validation rejects client-supplied values; old clients remain supported.
  165 tests/build pass. This verifies calculation/transport, not live-model accuracy.

- Added scenario Delta/Gamma/Theta/Vega/Rho curves with native metric selection,
  neutral exposure coloring, explicit units and keyboard inspection. Date/IV,
  strike edits and Undo reuse existing workspace controls. Shared scenarioSeries
  preserves payoffSeries output; fixed gamma's zero-spot boundary.163 tests/build
  and browser geometry checks pass. P/L retains its expiry reference and layout.

- Added signed per-leg scenario Greeks with quantity scaling, exact scenario context,
  net reconciliation and AI-context reuse. Native disclosure preserves payoff-first
  layout. Fixed expansion from a single-expiry chain to a calendar's two expiries;
  empty choices remain disabled.161 tests and build pass; browser checks cover
  calendar construction, quantities/scenario/Undo, keyboard and mobile overflow.

- Added explicit server-validated streamed capture for selected contracts, preserving
  held entry costs and exact bid/ask/IV provenance through analysis, save and restore.
  Missing/stale/incoherent times reject without position changes. Capture uses the
  existing version guard and Undo; added a native Now scenario control.160 tests
  and Worker/client build pass. Real local feed capture correctly rejects unknown
  quote timestamps; successful capture is fixture-tested, not live freshness proof.

- Added bounded shared upstream recovery: three exponential/jittered retries,
  cleared marks while reconnecting, generation guards, preserved subscriptions,
  and cancellation when the last subscriber leaves. Healthy budget reset requires
  a validated message after60s; silence cannot renew its own retries.156 tests/build,
  recovery browser regression, real local feed delivery and independent review pass.
  Browser-relay loss and terminal errors still require explicit reconnect.

- Restored payoff-first desktop density using native source/valuation/policy details
  and a compact feed row. Incoming marks no longer expand the panel or move the
  chart. Stale/historical warnings remain visible when collapsed. At1440x900 the
  canvas moved from644.7px to499.7px; chart bottom838.7px.151 tests/build, complete
  market browser regression, keyboard/mobile and no-layout-shift checks passed.

- Wired opt-in streamed marks through an authenticated shared DXLink Durable Object
  relay. Exact upgrade Origin and owner-snapshot selection checks; provider metadata
  supplies streamer identities. Marks remain separate from position/AI snapshots.
  Added explicit unknown timestamps and disconnect/reconnect controls. Fixed partial
  configuration handling, late-upgrade cleanup, expiring REST authorization reuse
  and browser clock-skew rejection.151 tests/build, mock browser and actual local
  quote/IV delivery passed; independent review cleared findings. Hosted operation,
  automatic recovery and market-hours quote freshness remain unverified/unfinished.

- Added bounded, read-only DXLink streaming tracer with compact-frame self-check.
  Live authentication/subscriptions delivered SPY and option quotes plus IV, but
  both quote-side timestamps were zero. Probe correctly exits 1 for incomplete
  timestamped coverage; no realtime UI claim. Planned shared Cloudflare feed relay
  instead of full-chain polling, keeping mutable marks separate from snapshots.

- Added explicit held entry costs with editable per-share premiums, preserved by
  refresh, quote-basis changes, AI same-contract edits, and private save/load.
  Contract/side changes initialize quote estimates; template replacement resets
  the mode. Added separately labeled dated liquidation P/L with correct exit-side
  bid/ask pricing. Verified 142 tests, build, independent review, and Chrome
  refresh/re-estimation/Undo/mobile regression. No broker-fill or live-data claim.

- Added strike-center browsing beyond the original spot-centered window. Selected
  contracts take priority inside the100-quote bound; underlying spot is unchanged.
  Browse retains leg identity/quantity and re-estimates quote entry explicitly.
  Refresh uses committed center; Undo restores catalog/center. Legacy saved snapshots
  default center to spot. Fixed single-expiry restored positions being rejected by
  the chain API.139 tests/build and real AAPL browser navigation passed.

- Added a fresh-context verification pass before returning AI prose or proposals.
  Exact positive verdict required; rejection, malformed output, provider failure
  or timeout withholds the draft without changing the workspace. Both calls reuse
  bounded transport and share the existing20-second deadline; no retries/rewrites.
- Verified134 tests/build, browser withheld-answer preservation, six paired live
  false/correct verifier challenges and ordinary AAPL review/proposal requests.
  Same-model verification is a probabilistic screen, not certified financial prose.
  Opt-in test scripts now disclose generation plus verification request counts.

- Added deterministic position valuation accounting to the AI context and analysis
  disclosure: signed entry estimate, model value, intrinsic, model residual and
  modeled P/L. Per-leg residual fractions use model value, never entry cost. Tests
  cover quantity/direction, entry independence, credits, zero value and negative
  European carry residuals.126 tests and build passed; browser values matched.
- Live AAPL review used the correct model-value denominator after this correction,
  but repeated the false claim that all premium is lost below breakeven. AI semantic
  quality remains a failed gate; passing structured responses do not certify prose.

- Added standard equity/ETF ticker loading with exact snapshot/OCC/metadata binding,
  symbol-aware provider evidence and caches, and provider-derived expiry cutoffs.
  QQQ/AAPL real-chain browser and server-calculation checks passed. Legacy SPY saved
  quotes remain readable; symbol loads, refresh and Undo preserve coherent state.
- Second-pass review fixed snapshot eviction across repeated load/Undo and wrong-symbol
  Alpaca response relabeling. Added failing-before regression checks. No streaming,
  order path or deployment. Live AAPL AI contract checks passed, but prose still
  conflates model extrinsic value with quote entry; analysis quality is not certified.

- Added UTC scenario-date input, time slider and pointer/keyboard heatmap selection
  through the shared strategy state, AI context and Undo. Solid curves show the
  selected scenario date; dashed references retain the expiration/first-expiry
  horizon. Proposal overlays require matching dates and expiry horizons.
- Removed full expiry-curve calculation from every heatmap cell by reusing a
  validated scenario-only evaluator. Existing pricing formulas and deterministic
  vectors remain unchanged. Verified92 tests, build, scenario/conversation/real-chain
  browser regressions and independent review. Local Worker crashes were observed;
  restarted runtime responds, but their root cause remains unproven.

- Bound displayed AI reviews to their submitted workspace version and position
  name. Edits and Undo visibly mark earlier answers; follow-up model context
  carries the same distinction. Saved historical quotes have an explicit analysis
  badge rather than appearing as refreshed quotes. Independent review and browser
  regressions cover these paths; 89 tests and production build pass. No calculation
  or model-quality claim changed. Browser inference was mocked; saved quotes came
  from the real provider and local D1.
- Fixed Clear during an in-flight review: abort the browser request, invalidate its
  ownership and immediately allow a new conversation. Late success/error/finally
  paths cannot repopulate cleared chat or release a newer request's busy state.
  Browser regression deliberately ignores abort to verify stale-response safety.
  Browser cancellation does not guarantee cancellation of already-started provider
  inference or its charges.

- Implemented the user-approved private workspace locally: Access JWT verification
  before HTML/assets/APIs, fail-closed hosting configuration, Origin/JSON/request
  marker checks, verified-owner cache and rate-limit keys. Local identity and D1
  are development-only; no deployment, remote migration or public signup.
- Added D1 Save/Load/Delete with atomic owner/revision predicates, conflict-safe
  explicit UI saves and Undo-compatible loading. Saved quote catalogs are server
  owned; reopening retains original timestamps and marks quotes historical.
- Independent review caught and fixed storage rate limiting, full restored-catalog
  validation and concurrent JWKS refresh fanout. Browser checks cover persistence,
  conflicts, failed saves, stale loads, historical real-price/metric preservation,
  deletion and mobile layout; existing market proposal Apply/Undo still passes.
- Verified89 tests and production build; started the built Worker and confirmed
  unauthenticated HTML/JS/API fail closed. Fixed an existing numeric Worker export
  that broke preview startup. Client bundles contain none of eight configured
  secret values. Cloudflare Access login itself awaits hosted configuration.

- Added calculator-derived same-scenario option value/intrinsic decomposition and
  a fully repriced next-day value change, capped at first expiry. AI receives these
  facts; each reply exposes dated "Calculations for this analysis" independently
  of its prose. Entry cost is not relabeled as current time value.
- Fixed floating-point noise in quoted premiums using the engine's existing
  eight-decimal normalization. Verified71 tests, build, live real-chain replies,
  calculation disclosure and proposal Apply/Undo in the browser. Free-text judgment
  is still not guaranteed by numerical checks.

- Compared the requested Qwen3.8Max and Gemini3.8Flash models on six identical
  synthetic-position cases. Google passed6/6 runtime contracts; Qwen passed1/6
  with five deadline failures. Selected Google per user preference; enabled medium
  reasoning, supported enum discriminators and a4096-token output allocation.
- Removed the ZDR requirement at the user's explicit direction; kept server-side
  secrets, denied data collection and strict proposal/risk/citation checks.
  Model comparison does not establish general options expertise or prose accuracy.
- Verified68 tests, build and live Google analysis/proposals using100 real option
  contracts. Original premium-loss error no longer appeared in this check, but
  theta, intrinsic-value and spread-profit prose still need correction.

- Added real Tastytrade SPY option pricing: bounded two-expiry windows, actual
  listed contracts, bid/ask, provider IV and quote timestamps. All twelve templates
  support midpoint or buy-at-ask/sell-at-bid estimates, explicit refresh and Undo.
- Bound calculation and AI proposals to trusted server snapshots; reject forged
  premiums, invented contracts and expired snapshots. Preserve positions on source
  outages and late responses. Fixed padded OCC IDs and non-$1 keyboard stepping.
- Verified 66 tests, production build, sample and market browser checks, real
  100-contract retrieval and a live quote-backed AI proposal. AI prose still made
  a payoff error; calculated metrics passed, but consumer analysis quality remains
  a release blocker. No orders, deployment or data-redistribution rights implied.

- Wired server-side Alpaca quotes/news, FRED, Exa official research, Tastytrade
  quotes and local ThetaData contract-reference metadata into analysis. Added
  dated evidence, unavailable-source disclosure, credential-isolated caches and
  bounded requests; kept sample contracts separate from current market context.
- Grounded inference in calculated risk, payoff checkpoints and Greek units;
  upgraded Flash Lite to Gemini 2.5 Flash without weakening privacy routing.
  Added risk-classification and citation checks, including inline FRED citations.
- Exposed analysis-only objections, assumptions and source evidence in the UI.
  Verified 46 tests, build, browser regressions, live adversarial replies and no
  configured secrets in browser output. World-class analysis is not claimed.

- Assessed configured analysis data sources and prepared a gated integration plan:
  Alpaca, FRED and Exa probes succeeded; Theta was unreachable and Tastytrade
  entitlement remains unverified. Runtime integration awaits plan approval.

- Connected local OpenRouter inference to the existing repository `.env`, including
  worktree fallback, with only the declared API secret exposed to the Worker.
  Verified a live response, 23 tests, production build, and no key in client output.

- Reworked the options workspace with larger readable typography, a chart that
  uses its actual container size, compact leg columns, responsive layouts,
  editable thesis, and a calculated position brief.
- Added proposed-position curve overlays, risk and leg comparisons, and
  conversation scrolling to the proposal. Removed fabricated failure-state
  query parameters.
- Fixed duplicate-contract crashes, invalid scenario edits, tooltip interception
  of strike dragging, keyboard Undo snapshots, and unchanged-input commits.
  Verified pointer/keyboard edits, proposal Apply/Undo, delayed-response
  rejection, and offline behavior through real browser interactions.

- Built the production-grade local options-builder PoC: twelve templates,
  custom one- to four-leg construction, payoff and heatmap inspection,
  deterministic Greeks/risk metrics, and a persistent AI sparring workspace.
- Made AI edits reviewable proposals with assumptions, objections, before/after
  metrics, explicit Accept/Reject, and request/version stale-state protection.
- Constrained the normalized SPY demo to an exact replay-safe contract catalog,
  added rho and fixed twelve-template vectors, removed inert controls, and added
  keyboard-readable curve and heatmap values.
- Planned a polished, locally runnable and Cloudflare-ready AI-native options
  builder using Hono, server-side OpenRouter inference, a generic one- to
  four-leg calculation engine, twelve templates, synchronized conversation and
  canvas controls, and no broker-write path.
- Made OptionStrat-level visual and direct-manipulation quality a blocking gate
  before AI integration, with approved representative-state baselines.
- Second-pass review completed pricing inputs and risk labels, made AI changes
  atomic and stale-safe, corrected the approval gate, and strengthened runtime
  proof.
- Added the ARGUS implementation specification, phased plan, and architecture
  decisions for a paper-only options research system.
- Grounded the product thesis and options baseline in primary research.
- Replaced the fixed 20-pair gate with a pre-registered paired validation
  protocol, uncertainty reporting, cost sensitivity, and trial accounting.
- Selected OpenRouter for bounded inference and split Alpaca access between a
  governed CLI write path and read-only MCP research/demo tools.
- Added the evidence-first app contract, credential-free replay, and public
  claim manifest.
- Recorded Codex as the primary development harness, plain Python as the runtime,
  and the current MCP/OpenRouter least-authority settings.
- Second-pass review separated same-information and AI-plus-text trials, defined
  the missing outcome contract, disabled provider fallback for scored runs, and
  strengthened replay, execution, evidence-integrity, and public-claim gates.
- Corrected a miscited options-frictions paper and narrowed unsupported feature
  claims.
- Expanded ignore rules for secrets, runtime data, ledgers, logs, and databases.
