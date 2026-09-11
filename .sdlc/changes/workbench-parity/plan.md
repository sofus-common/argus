# Migration plan

## Launch-readiness priority (user goal, September 11)

Finish the defined thesis-to-decision workflow; avoid adjacent cosmetic work.
1. Expose quoted expiry/strike-window loading in Optimize through existing
   loadMarket(preserve=true), retaining holdings and search preferences. Prove
   later-expiry search, invalidation, fixed costs and thesis preservation.
2. Verify integrated symbol/thesis/search/Inspect/Apply/Undo/save/reload and mobile
   layout. Reuse existing API, financial and prompt regression suites.
3. Promote the consolidated Workbench to the normal local entry after that proof;
   keep Workbench and Optimize separate. Prepare build and release checks.
4. Hosted Access, saved-data and qualified AI configuration verification remain
   release gates. No production deployment without separate authorization.

All new behavior is deterministic UI/state handling. Existing probabilistic
conversation is unchanged. No dependency, pricing formula or agent loop changes.
The current-checkout approval remains; scoped commits provide recovery.

1. Trace existing App.tsx flows and shared helpers; confirm backend/session routing.
2. First tracer: existing assignment/probability/evidence and quote-risk displays
   under compact Workbench disclosures. Export/reuse components rather than clone.
3. Architecture decision after independent review: use root App as the single
   state/guard owner under a compact Workbench presentation variant. Do not copy
   Undo, snapshot registry, saved revisions or proposal handlers into ScenarioLab.
   Human confirmed this structural migration with "continue". First expose it
   at /?workbench=integrated, retaining both existing screens during verification.
4. Preserve thesis/inspection separation while retaining root worker valuation,
   conversation and persistence. Test failed responses, explicit Apply, save/load,
   held-cost refresh, stale-response rejection and recovery isolation.
   Structured target/time initially remain explicitly temporary UI inputs. Test
   them through a cloned read-only chart; prefill existing CandidateSearch only
   on explicit Optimize. No persistence schema or AI prompt change in this slice.
   Follow-up approved by user "continue" after durable-thesis recommendation:
   store optional typed thesis metadata in existing StrategyState/state_json;
   reuse commit/Undo and save revisions. Copy through worker/draft sanitizers,
   preserve legacy draft text, and control Workbench fields from the same owner.
   No SQL migration, prompt change or new dependency. Test round trips, invalid
   metadata, proposal ownership and native load/Undo including legacy saves.
5. Broader construction/market search: reuse root workflows; do not simply remove
   prototype mixed-expiry/model guards without updating every dependent display.
6. Verify tsc, relevant Vitest suites and in-app desktop/mobile interactions;
   independent diff review. Checkpoint coherent increments on product branch.

Root App.tsx remains functional. Prototype files are integration owner scope.
No dependency additions. This is the user-selected local prototype checkout;
parallel work must have distinct files. Recovery: revert scoped commits, leaving
saved-data schema unchanged. Live deployment is out of scope.

Independent review also found optimizer-engine/state.md still awaiting AC3
ranking/collateral reconciliation. Merely exposing CandidateSearch is not proof
that this existing engine acceptance gate is closed.
