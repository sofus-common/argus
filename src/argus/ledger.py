"""Append-only, hash-chained JSONL evidence ledger.

Every event carries: UTC timestamp, run_id, run_mode (replay|research|paper),
kind, payload, previous_event_hash, and its own SHA-256 content hash.
Replay ledgers live in a separate file so they can never enter scored aggregates.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

KINDS = {
    "data_snapshot", "candidates", "baseline", "ai_recommendation", "ablation",
    "backtest", "falsification", "risk_decision", "order_intent", "order_result",
    "reconciliation", "outcome", "halt", "note",
}
RUN_MODES = {"replay", "research", "paper"}
GENESIS = "0" * 64


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Ledger:
    def __init__(self, path: Path, run_mode: str):
        if run_mode not in RUN_MODES:
            raise ValueError(f"run_mode must be one of {sorted(RUN_MODES)}")
        self.path = Path(path)
        self.run_mode = run_mode
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._last_hash = self._read_last_hash()

    def _read_last_hash(self) -> str:
        last = GENESIS
        for event in self.events():
            last = event["event_hash"]
        return last

    def events(self) -> Iterator[dict]:
        if not self.path.exists():
            return iter(())
        return (json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines() if line.strip())

    def append(self, kind: str, run_id: str, payload: dict, ts: str | None = None) -> dict:
        if kind not in KINDS:
            raise ValueError(f"unknown event kind {kind}")
        body = {
            "ts": ts or utc_now(),
            "run_id": run_id,
            "run_mode": self.run_mode,
            "kind": kind,
            "payload": payload,
            "previous_event_hash": self._last_hash,
        }
        body["event_hash"] = sha256(canonical(body))
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(canonical(body) + "\n")
        self._last_hash = body["event_hash"]
        return body

    def verify(self) -> tuple[bool, str]:
        prev = GENESIS
        for i, event in enumerate(self.events()):
            claimed = event.get("event_hash")
            body = {k: v for k, v in event.items() if k != "event_hash"}
            if body.get("previous_event_hash") != prev:
                return False, f"event {i}: previous hash mismatch"
            if sha256(canonical(body)) != claimed:
                return False, f"event {i}: content hash mismatch"
            if event.get("run_mode") != self.run_mode:
                return False, f"event {i}: run_mode {event.get('run_mode')} in {self.run_mode} ledger"
            prev = claimed
        return True, "ok"

    def by_kind(self, kind: str) -> list[dict]:
        return [e for e in self.events() if e["kind"] == kind]
