"""Credential-free seeded replay: full evidence path from a public fixture."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from . import claims, engine, site, validation
from .alpaca import FakeGateway
from .ledger import Ledger
from .risk import Governor


def run_replay(settings, fixture_path: Path, out_dir: Path) -> dict:
    fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    out_dir = Path(out_dir)
    ledger_path = out_dir / "events.jsonl"
    if ledger_path.exists():
        ledger_path.unlink()
    for stale in ("state/authorizations_used.txt",):
        p = out_dir / stale
        if p.exists():
            p.unlink()
    ledger = Ledger(ledger_path, "replay")
    gateway = FakeGateway(fixture)
    governor = Governor(settings, out_dir / "state")
    now = datetime.fromisoformat(fixture["now"])
    results = []
    default_marks = dict(fixture.get("marks", {}))
    cycles = fixture.get("cycles", [{"ai": fixture.get("ai")}])
    for i, cyc in enumerate(cycles):
        run_id = f"replay-{i + 1:03d}"
        t = now + timedelta(minutes=30 * i)
        if "chains" in cyc:
            gateway.fixture["chains"] = cyc["chains"]
        gateway.marks_active = False  # governor re-observes the snapshot quotes at decision time
        results.append(engine.run_cycle(gateway, settings, ledger, run_id, execute=True, ai_recorded=cyc.get("ai"), now=t, governor=governor))
        gateway.fixture["marks"] = cyc.get("marks", default_marks)
        gateway.marks_active = True
        engine.mark_cycle(gateway, settings, ledger, run_id, execute=True, now=t + timedelta(minutes=29), governor=governor)
    sc = validation.score(ledger, settings)
    score_path = out_dir / "score.json"
    score_path.write_text(json.dumps(sc, indent=2), encoding="utf-8")
    manifest = claims.build_manifest(score_path, sc, ledger_path, public=True)
    claims.write_manifest(out_dir / "claims.json", manifest)
    site.export(out_dir / "site" / "index.html", sc, manifest, ledger)
    ok, msg = ledger.verify()
    return {"cycles": results, "score": {k: v for k, v in sc.items() if k != "rows"}, "ledger_ok": ok, "ledger_msg": msg, "out_dir": str(out_dir)}
