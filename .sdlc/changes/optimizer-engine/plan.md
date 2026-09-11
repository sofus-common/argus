# Accepted implementation plan

1. options.ts shared numeric validation and existing regression tests: AC1.
2. Independent pricing-benchmarks.test.ts with sourced references: AC2.
3. Inspect and reuse existing market snapshot/search seams for the local Optimize
   screen; implement dated quote adapter and replay acceptance: AC3.
   Market reconciliation: retain explicit net-entry-outlay semantics (not stock
   collateral). Add optional best-per-family result grouping to existing search;
   absence retains global top five for existing callers. Same deterministic score,
   risk checks and quote window. Browser default groups; user can select global.
   Verify each family winner against a separate single-family replay, returned
   family/count guards, and explicit Inspect/Apply/Undo with the persisted thesis.
4. Reuse scenario calculations for explicit fill/cost/stress comparisons: AC4.
5. Focused Vitest, TypeScript, browser replay and independent diff review: AC5.

Blended ranking checkpoint (user continued the remaining slider migration):
- Add explicit objective `balanced` with required integer `chanceWeight` 0..100;
  other objectives reject that field and retain their existing scores/defaults.
- For intermediate weight w=chanceWeight/100, score =
  (1-w)*r/(1+abs(r)) + w*(2*p-1), r=target P/L/expiry maximum loss,
  p=existing snapshot-to-expiry model probability. Fixed normalization prevents
  dollar size or a candidate-set-dependent normalization dominating the slider.
  This is a disclosed preference heuristic, not expected return or an edge claim.
- Endpoints reuse exact existing return-on-risk and probability scores/order.
  Reject missing/invalid weight, unavailable probability and mixed expiry.
- Reuse one pure score helper in engine and client reconciliation. Rank all
  eligible enumerated structures before existing family/global selection.
- UI keeps existing default until explicit blend selection; native slider edits
  invalidate results but never search/apply automatically. Show assumptions.
- Test endpoints, intermediate family/global replay, monotonic components,
  reversed quotes, invalid inputs, API/client tampering and browser handoff.
  No AI schema/prompt extension, new dependency, deployment or two-sided scoring.

Isolation: engine/hardening worktree. No dependencies or new runtime agent.
Recovery: revert scoped checkpoint commits; original product checkout remains
untouched until verified integration. No data migrations or deployment.
Commit/push authority: user's standing completed-work instruction.
