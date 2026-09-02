"""Public claim manifest: what may be displayed, where it comes from, how to reproduce it."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .ledger import sha256

DISPLAYED = [
    ("n_observations", "Paired observations"),
    ("changed_decisions", "Decisions where AI differed from quant"),
    ("ai_abstentions", "AI cycles with no trade decision (deliberate abstentions plus inference errors)"),
    ("ai_abstentions_deliberate", "AI abstentions the model actually chose"),
    ("ai_inference_errors", "Cycles with no AI answer because the inference call failed"),
    ("coverage", "AI coverage (1 - all no-decision cycles / observations)"),
    ("quant_net_total", "Quant control net P&L (USD, modelled costs)"),
    ("ai_net_total", "AI arm net P&L after inference cost (USD)"),
    ("ai_minus_quant_usd", "AI minus quant (USD)"),
    ("paired_delta_mean", "Mean paired delta per unit risk budget"),
    ("paired_delta_ci95", "Block-bootstrap 95% interval of mean delta"),
    ("max_drawdown_quant", "Max drawdown, quant"),
    ("max_drawdown_ai", "Max drawdown, AI"),
    ("inference_cost_total_usd", "Total inference cost (USD)"),
    ("evidence_state", "Evidence state"),
]


def build_manifest(score_path: Path, score: dict, ledger_path: Path, public: bool) -> dict:
    src_sha = sha256(score_path.read_text(encoding="utf-8"))
    status = "REPRODUCIBLE" if public else "RECORDED"
    now = datetime.now(timezone.utc).isoformat()
    claims = []
    for key, label in DISPLAYED:
        claims.append({
            "claim_id": f"{score['trial_id']}:{score['run_mode']}:{key}", "trial_id": score["trial_id"], "label": label,
            "evidence_state": score["evidence_state"], "displayed_value": score.get(key), "source_artifact": str(score_path),
            "source_sha256": src_sha, "reproduction_command": f"argus score --ledger {ledger_path} --mode {score['run_mode']}",
            "status": status, "last_verified_at": now,
            "note": "Sample below pre-registered minimum; descriptive only." if score["evidence_state"] == "DESCRIPTIVE" else "",
        })
    claims.append({
        "claim_id": f"{score['trial_id']}:{score['run_mode']}:ai_beats_quant", "trial_id": score["trial_id"],
        "label": "AI beats quant", "evidence_state": score["evidence_state"], "displayed_value": None,
        "source_artifact": str(score_path), "source_sha256": src_sha, "reproduction_command": "n/a",
        "status": "UNSUPPORTED", "last_verified_at": now,
        "note": "Requires SUPPORTED evidence state and REPRODUCIBLE artifact; SUPPORTED is disabled for this trial.",
    })
    return {"generated_at": now, "run_mode": score["run_mode"], "claims": claims}


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
