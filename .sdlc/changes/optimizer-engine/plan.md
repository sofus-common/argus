# Accepted implementation plan

1. options.ts shared numeric validation and existing regression tests: AC1.
2. Independent pricing-benchmarks.test.ts with sourced references: AC2.
3. Inspect and reuse existing market snapshot/search seams for the local Optimize
   screen; implement dated quote adapter and replay acceptance: AC3.
4. Reuse scenario calculations for explicit fill/cost/stress comparisons: AC4.
5. Focused Vitest, TypeScript, browser replay and independent diff review: AC5.

Isolation: engine/hardening worktree. No dependencies or new runtime agent.
Recovery: revert scoped checkpoint commits; original product checkout remains
untouched until verified integration. No data migrations or deployment.
Commit/push authority: user's standing completed-work instruction.
