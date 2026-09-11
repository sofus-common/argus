# Migration plan

1. Trace existing App.tsx flows and shared helpers; confirm backend/session routing.
2. First tracer: existing assignment/probability/evidence and quote-risk displays
   under compact Workbench disclosures. Export/reuse components rather than clone.
3. Architecture decision after independent review: use root App as the single
   state/guard owner under a compact Workbench presentation variant. Do not copy
   Undo, snapshot registry, saved revisions or proposal handlers into ScenarioLab.
   Await human confirmation of this structural migration before implementing it.
4. Preserve thesis/inspection separation while retaining root worker valuation,
   conversation and persistence. Test failed responses, explicit Apply, save/load,
   held-cost refresh, stale-response rejection and recovery isolation.
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
