"""Deterministic quant control. Same packet + same parameters => same choice.

Registered rule (part of the trial contract), motivated by Goyal & Saretto
(2009): when implied vol is rich relative to realized (wedge = RV20 - IV below
credit_wedge_max) sell premium with a defined-risk credit vertical; when it is
cheap, buy a debit vertical. Direction follows the 20-day trend.

1. Drop candidates whose spread_pct exceeds max_spread_pct (liquidity gate).
2. Choose kind: wedge <= credit_wedge_max -> credit; wedge >= wedge_min -> debit;
   between them either kind qualifies. Drop the rest.
3. Direction must match the 20-day trend; |ret20| < trend_min => abstain.
4. Rank: credit by most negative wedge (richest IV), debit by highest wedge;
   tie-break by lower spread_pct, then nearer expiry. Pick the top one.
"""

from __future__ import annotations


def choose(packet: dict, settings) -> dict:
    reasons: list[str] = []
    cands = packet["candidates"]
    liquid = [c for c in cands if c["features"]["spread_pct"] is not None and c["features"]["spread_pct"] <= settings.max_spread_pct]
    if not liquid:
        reasons.append("no_liquid_candidate")
    fit = []
    for c in liquid:
        w = c["features"]["wedge"]
        if w is None:
            continue
        if c["kind"] == "credit" and w <= settings.credit_wedge_max:
            fit.append(c)
        elif c["kind"] == "debit" and w >= settings.wedge_min:
            fit.append(c)
    if liquid and not fit:
        reasons.append("wedge_outside_both_regimes")
    aligned = []
    for c in fit:
        r = c["features"]["ret20"]
        if r is None or abs(r) < settings.trend_min:
            continue
        if (r > 0 and c["direction"] == "bullish") or (r < 0 and c["direction"] == "bearish"):
            aligned.append(c)
    if fit and not aligned:
        reasons.append("no_trend")
    if not aligned:
        return {"arm": "quant", "choice": "abstain", "confidence": None, "reason_codes": reasons or ["no_candidate"],
                "considered": len(cands), "survivors": 0}
    # Prefer the regime with the stronger signal: credit when IV is rich, debit when cheap.
    credit = [c for c in aligned if c["kind"] == "credit"]
    debit = [c for c in aligned if c["kind"] == "debit"]
    if credit and (not debit or min(c["features"]["wedge"] for c in credit) <= settings.credit_wedge_max):
        pool, regime = credit, "credit_iv_rich"
        pool.sort(key=lambda c: (c["features"]["wedge"], c["features"]["spread_pct"], c["dte"]))
    else:
        pool, regime = debit, "debit_iv_cheap"
        pool.sort(key=lambda c: (-c["features"]["wedge"], c["features"]["spread_pct"], c["dte"]))
    top = pool[0]
    return {"arm": "quant", "choice": top["candidate_id"], "confidence": None,
            "reason_codes": ["liquidity_ok", regime, "trend_aligned", f"wedge:{top['features']['wedge']}"],
            "considered": len(cands), "survivors": len(aligned)}
