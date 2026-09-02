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


def _representative(rows: list[dict], key, prefer_executed: bool) -> list[dict]:
    """One row per distinct spread, in time order.

    ``prefer_executed`` picks the observation whose order actually filled, which is not always the earliest: a
    dry-run cycle or a governor veto can precede the one that traded. Only ever pass it for the AI arm - the
    ``executed`` flag is the AI's, so using it to collapse the quant arm silently picks a different quant entry.
    """
    groups: dict = {}
    for r in rows:
        groups.setdefault(key(r), []).append(r)
    out = [next((r for r in grp if r["executed"]), grp[0]) if prefer_executed else grp[0]
           for grp in groups.values()]
    return sorted(out, key=lambda r: r["ts"])


def score(ledger: Ledger, settings) -> dict:
    ok, why = ledger.verify()
    if not ok:
        raise ValueError(f"refusing to score {ledger.run_mode} ledger {ledger.path}: {why}")
    obs = open_observations(ledger)
    # Settings.contract() is "everything that, if changed, creates a new trial", and flatten_at is in it and is
    # shown to the model in the decision packet. If the contract changed mid-run, observations from before the
    # change belong to a different trial and must not be pooled: score the current contract, report the rest as
    # discarded. They stay in the ledger; nothing is ever deleted.
    contracts: list[str] = []
    for o in sorted(obs.values(), key=lambda x: x["ts"]):
        c = o.get("contract_sha256")
        if c and c not in contracts:
            contracts.append(c)
    scored_contract = contracts[-1] if contracts else None
    discarded = []
    if len(contracts) > 1:
        for c in contracts[:-1]:
            seg = [o for o in obs.values() if o.get("contract_sha256") == c]
            discarded.append({"contract_sha256": c, "n": len(seg),
                              "first_ts": min(o["ts"] for o in seg), "last_ts": max(o["ts"] for o in seg),
                              "reason": "settings contract changed mid-run; a different trial by pre-registration"})
        obs = {sid: o for sid, o in obs.items() if o.get("contract_sha256") == scored_contract}
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
                     "delta": round(delta, 6), "quant_status": q["status"], "ai_status": a["status"], "executed": bool(o.get("executed")),
                     "ai_source": o.get("ai_source")})
    # The pre-registered experimental unit is the snapshot (VALIDATION.md), so n, the deltas and the CI stay
    # one-per-snapshot and the block bootstrap absorbs the overlap. The DOLLAR totals are a different quantity:
    # both arms are sticky, so one spread is re-picked for many consecutive snapshots, and summing per-snapshot
    # outcomes would count a single position many times over and report it as money. Those aggregate over the
    # observation of each run of identical legs that actually traded, or the earliest where none did.
    def _legs(r, arm):
        cand = obs[r["snapshot_id"]]["candidates"].get(r[arm + "_choice"])
        # an abstention has no legs and is genuinely one observation per snapshot
        return tuple(l["symbol"] for l in cand["legs"]) if cand else ("abstain", r["snapshot_id"])

    def _max_run(arm):
        """Longest run of consecutive snapshots on identical legs: the correlation length the overlap can induce.

        Reported, not acted on. block is pre-registered; this lets a reader check it against the data.
        """
        best = cur = 0
        prev = object()
        for r in rows:
            k = _legs(r, arm)
            cur = cur + 1 if k == prev else 1
            prev = k
            best = max(best, cur)
        return best

    q_rows = _representative(rows, lambda r: _legs(r, "quant"), prefer_executed=False)
    a_rows = _representative(rows, lambda r: _legs(r, "ai"), prefer_executed=True)

    n = len(rows)
    deltas = [r["delta"] for r in rows]
    changed = sum(1 for r in rows if r["changed"])
    ai_abst = sum(1 for r in rows if r["ai_choice"] == "abstain")
    ai_err = sum(1 for r in rows if r["ai_choice"] == "abstain" and r["ai_source"] in ("error", "unavailable"))
    q_abst = sum(1 for r in rows if r["quant_choice"] == "abstain")
    lo, hi = _block_bootstrap(deltas) if n >= 2 else (None, None)
    q_series = [r["quant_net"] for r in q_rows]
    a_series = [r["ai_net_after_inference"] for r in a_rows]
    evidence = "DESCRIPTIVE" if n < settings.min_observations else "EXPLORATORY"
    return {
        "trial_id": settings.trial_id, "model": settings.model, "run_mode": ledger.run_mode, "evidence_state": evidence,
        "n_observations": n, "n_unmarked": len(obs) - n, "changed_decisions": changed, "ai_abstentions": ai_abst,
        "quant_abstentions": q_abst, "coverage": round(1 - ai_abst / n, 4) if n else None,
        "ai_inference_errors": ai_err, "ai_abstentions_deliberate": ai_abst - ai_err,
        "paired_delta_sum": round(sum(deltas), 6), "paired_delta_mean": round(sum(deltas) / n, 6) if n else None,
        "paired_delta_ci95": [lo, hi], "quant_net_total": round(sum(q_series), 2), "ai_net_total": round(sum(a_series), 2),
        "ai_minus_quant_usd": round(sum(a_series) - sum(q_series), 2), "inference_cost_total_usd": round(sum(r["inference_cost_usd"] for r in rows), 4),
        "max_drawdown_quant": _max_drawdown(q_series), "max_drawdown_ai": _max_drawdown(a_series),
        "changed_only": {"n": changed, "delta_sum": round(sum(r["delta"] for r in rows if r["changed"]), 6)},
        "executed_observations": sum(1 for r in rows if r["executed"]), "min_observations_for_exploratory": settings.min_observations,
        "distinct_spreads": {"quant": len(q_rows), "ai": len(a_rows)},
        "max_leg_run": {"quant": _max_run("quant"), "ai": _max_run("ai")},
        "sessions_covered": len({r["ts"][:10] for r in rows}),
        "contract_sha256": scored_contract, "discarded_segments": discarded,
        "n_counts": "decisions, not market conditions: each snapshot is a fresh packet and a fresh inference call, "
                    "but the sample spans few sessions and two correlated ETFs",
        "bootstrap": {"block": 3, "reps": 2000, "seed": 7, "pre_registered": True},
        "usd_totals_basis": "distinct spreads (the observation that traded, else the earliest); n and the CI are per snapshot",
        "supported_enabled": False, "rows": rows,
    }
