# Architecture decisions

## ADR-001: single Python service

One process and modules are sufficient for the hackathon's research, evidence,
and paper-execution loop. Service splits add deployment/reconciliation work
without improving the first demo.

## ADR-002: official SDK and paper-only boundary

Use `alpaca-py`, Alpaca's current Python SDK, with
`TradingClient(..., paper=True)`. The application has no live mode. A small
gateway wrapper retains testability and isolates third-party request models.

## ADR-003: CLI instead of MCP for M1

The competition requires Trading API plus MCP **or** CLI. CLI has fewer moving
parts, makes execution explicit, and exercises the same path as research. Add
MCP only when a demo needs agent-facing tools; it must call the same governor
and ledger boundary.

## ADR-004: AI must earn its place

The deterministic candidate owns structure and risk. AI returns only a
directional recommendation or abstention, making the ablation meaningful and
keeping safety out of a probabilistic component.

## ADR-005: JSONL ledger first

Append-only JSONL is inspectable and adequate for one local hackathon process.
Move to a transactional store only for concurrent writers or more durable
review/query requirements.
