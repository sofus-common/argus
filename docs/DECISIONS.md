# Architecture decisions

## ADR-001: single Python service

One process and modules are sufficient for the hackathon's research, evidence,
and paper-execution loop. Service splits add deployment/reconciliation work
without improving the first demo.

## ADR-002: official SDK and paper-only boundary

Use `alpaca-py`, Alpaca's current Python SDK, with
`TradingClient(..., paper=True)`. The application has no live mode. A small
gateway wrapper retains testability and isolates third-party request models.

## ADR-003: CLI write path plus read-only MCP

Use both without duplicating authority. The CLI and `alpaca-py` gateway are the
only governed paper-order path. Alpaca MCP supplies read-only research and demo
tools. Allowlist `assets,stock-data,options-data,news`; exclude `trading`,
`account`, and `watchlists` because those toolsets contain mutations. This meets
the competition constraint while keeping one auditable write boundary.

## ADR-004: AI must earn its place

Deterministic code creates immutable candidates and owns structure and risk.
Quant and AI consume the same frozen input, candidate set, costs, and constraints;
each selects a candidate or abstains. Scored runs pin the model and experiment
contract. Null and negative results are published with positive ones.

## ADR-005: JSONL ledger first

Append-only JSONL is inspectable and adequate for one local hackathon process.
Move to a transactional store only for concurrent writers or more durable
review/query requirements.

## ADR-006: OpenRouter is a bounded dependency

Use OpenRouter for one strict-schema selection call, not agent orchestration.
Start with the cost-aware `google/gemini-2.5-flash-lite`; pin model, prompt,
schema, temperature, token limit, retention/routing policy, and trial ID. Allow
no provider fallback in scored trials. Record cost, latency, and provider.
Same-model fallback and free/random routing are demo-only because routing changes
contaminate an ablation.

## ADR-007: research motivates; experiments decide

Use options-native features motivated by primary literature: RV-IV wedge, IV
term slope, and liquidity. Skew and regime are optional engineering hypotheses,
not literature-backed M1 requirements. None inherits proof of profitability or
transfers automatically to ARGUS's universe. Promotion follows the
pre-registered validation protocol and retains failed hypotheses.

## ADR-008: events and claims are separate artifacts

The JSONL event ledger records what happened. A claim manifest records what may
be displayed publicly and how to reproduce it. A dashboard may not invent or
hardcode performance values.

The ledger hash-chains events; each public claim includes the source artifact's
SHA-256. Hashes expose later edits but do not replace durable storage.

## ADR-009: coding harnesses are not runtime frameworks

Use Codex as the primary implementation harness and Claude Code optionally for
planning or review under their existing user subscriptions. ARGUS itself runs as
plain Python and calls OpenRouter only for the bounded AI arm. Do not add
LangGraph, CrewAI, Strands, or AWS AgentCore in M1: one inference call and one
deterministic pipeline do not justify an orchestration framework. Seeded replay
and recorded outputs keep development and judging functional with zero runtime
inference spend; scored live AI experiments require an explicit OpenRouter
budget.
