"""Paired metrics over identical observations. Pure function of a ledger."""

from __future__ import annotations

import random

from .engine import open_observations
from .ledger import Ledger


def _max_drawdown(series: list[float]) -> float:
    peak, cum, mdd = 0.0, 0.0, 0.0
    for x in series:
        cum += x
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return round(mdd, 2)


def _block_bootstrap(deltas: list[float], block: int = 3, reps: int = 2000, seed: int = 7) -> tuple[float, float]:
    if len(deltas) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    n = len(deltas)
    means = []
    for _ in range(reps):
        sample: list[float] = []
        while len(sample) < n:
            start = rng.randrange(n)
            sample.extend(deltas[start:start + block])
        means.append(sum(sample[:n]) / n)
    means.sort()
    return (round(means[int(0.025 * reps)], 5), round(means[int(0.975 * reps)] - 1e-12, 5))


def score(ledger: Ledger, settings) -> dict:
    ok, why = ledger.verify()
    if not ok:
        raise ValueError(f"refusing to score {ledger.run_mode} ledger {ledger.path}: {why}")
    obs = open_observations(ledger)
    rows = []
    for sid, o in sorted(obs.items(), key=lambda kv: kv[1]["ts"]):
        q, a = o["arms"]["quant"], o["arms"]["ai"]
        if q is None or a is None:
            continue  # not yet marked; never silently scored
        rb = o["risk_budget"] or (settings.risk_cap_pct * settings.start_equity)
        q_net, a_net = float(q.get("pnl_net", 0.0)), float(a.get("pnl_net", 0.0))
        inf = float(o["inference_cost_usd"] or 0.0)
        delta = (a_net - inf - q_net) / rb
        rows.append({"snapshot_id": sid, "ts": o["ts"], "quant_choice": o["quant"], "ai_choice": o["ai"], "changed": o["quant"] != o["ai"],
                     "quant_net": q_net, "ai_net": a_net, "ai_net_after_inference": round(a_net - inf, 2), "inference_cost_usd": inf,
                     "delta": round(delta, 6), "quant_status": q["status"], "ai_status": a["status"], "executed": bool(o.get("executed"))})
    n = len(rows)
    deltas = [r["delta"] for r in rows]
    changed = sum(1 for r in rows if r["changed"])
    ai_abst = sum(1 for r in rows if r["ai_choice"] == "abstain")
    q_abst = sum(1 for r in rows if r["quant_choice"] == "abstain")
    lo, hi = _block_bootstrap(deltas) if n >= 2 else (None, None)
    q_series = [r["quant_net"] for r in rows]
    a_series = [r["ai_net_after_inference"] for r in rows]
    evidence = "DESCRIPTIVE" if n < settings.min_observations else "EXPLORATORY"
    return {
        "trial_id": settings.trial_id, "model": settings.model, "run_mode": ledger.run_mode, "evidence_state": evidence,
        "n_observations": n, "n_unmarked": len(obs) - n, "changed_decisions": changed, "ai_abstentions": ai_abst,
        "quant_abstentions": q_abst, "coverage": round(1 - ai_abst / n, 4) if n else None,
        "paired_delta_sum": round(sum(deltas), 6), "paired_delta_mean": round(sum(deltas) / n, 6) if n else None,
        "paired_delta_ci95": [lo, hi], "quant_net_total": round(sum(q_series), 2), "ai_net_total": round(sum(a_series), 2),
        "ai_minus_quant_usd": round(sum(a_series) - sum(q_series), 2), "inference_cost_total_usd": round(sum(r["inference_cost_usd"] for r in rows), 4),
        "max_drawdown_quant": _max_drawdown(q_series), "max_drawdown_ai": _max_drawdown(a_series),
        "changed_only": {"n": changed, "delta_sum": round(sum(r["delta"] for r in rows if r["changed"]), 6)},
        "executed_observations": sum(1 for r in rows if r["executed"]), "min_observations_for_exploratory": settings.min_observations,
        "supported_enabled": False, "rows": rows,
    }
