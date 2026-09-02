"""Snapshot normalization and deterministic candidate construction.

Deterministic code owns everything about a trade: legs, strikes, expiry,
quantity, maximum loss, and execution instructions. Arms only pick an ID.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from .ledger import canonical, sha256


def realized_vol(closes: list[float], n: int = 20) -> float | None:
    if len(closes) < n + 1:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - n, len(closes))]
    mean = sum(rets) / n
    var = sum((r - mean) ** 2 for r in rets) / (n - 1)
    return math.sqrt(var * 252)


def build_snapshot(gateway, settings, now: datetime | None = None) -> dict:
    """Freeze one timestamped market observation for all underlyings."""
    now = now or datetime.now(timezone.utc)
    today = now.date()
    exp_gte = today + timedelta(days=settings.dte_min)
    exp_lte = today + timedelta(days=settings.dte_max)
    underlyings = {}
    for sym in settings.underlyings:
        spot = gateway.latest_stock_price(sym)
        closes = gateway.daily_closes(sym, 21)
        chain = gateway.option_chain(sym, exp_gte, exp_lte, spot * 0.90, spot * 1.10)
        underlyings[sym] = {
            "spot": spot,
            "closes": closes,
            "rv20": realized_vol(closes, 20),
            "ret20": (closes[-1] / closes[0] - 1.0) if len(closes) >= 21 else None,
            "chain": chain,
        }
    body = {
        "ts": now.isoformat(),
        "feed": settings.options_feed,
        "source": gateway.mode,
        "query": {"dte_min": settings.dte_min, "dte_max": settings.dte_max, "strike_band": 0.10, "closes": 21},
        "underlyings": underlyings,
    }
    body["snapshot_id"] = sha256(canonical(body))[:16]
    return body


def _mid(q: dict) -> float:
    return (q["bid"] + q["ask"]) / 2.0


def _atm_iv(chain: dict, spot: float, expiry: str) -> float | None:
    rows = [r for r in chain.values() if r["expiry"] == expiry and r["type"] == "call" and r.get("iv")]
    if not rows:
        return None
    return min(rows, key=lambda r: abs(r["strike"] - spot))["iv"]


STRUCTURES = (
    # name, option type, direction sign, kind. Anchor leg = nearest target delta; other leg = one width further OTM.
    ("bull_call_debit", "call", +1, "debit"),
    ("bear_put_debit", "put", -1, "debit"),
    ("bull_put_credit", "put", +1, "credit"),
    ("bear_call_credit", "call", -1, "credit"),
)


def build_candidates(snapshot: dict, settings) -> list[dict]:
    """Four defined-risk verticals per underlying per expiry.

    Net value convention (Alpaca MLEG): positive = debit paid, negative = credit
    received. ``entry_mid`` is the signed mid value; ``entry_ask`` the worst
    price to open; ``entry_bid`` the best. P&L of any candidate at a later mark
    is (mark_value - entry_mid) * 100 * qty, for debit and credit alike.
    Debit anchor: long leg nearest target_delta. Credit anchor: short leg
    nearest target_short_delta. The other leg sits one spread width further OTM.
    """
    ts = datetime.fromisoformat(snapshot["ts"])
    risk_budget = settings.risk_cap_pct * min(settings.start_equity, snapshot.get("equity", settings.start_equity))
    candidates: list[dict] = []
    for sym, u in snapshot["underlyings"].items():
        chain, spot = u["chain"], u["spot"]
        expiries = sorted({r["expiry"] for r in chain.values()})
        if not expiries:
            continue
        iv_near, iv_far = _atm_iv(chain, spot, expiries[0]), _atm_iv(chain, spot, expiries[-1])
        slope = (iv_far - iv_near) if (iv_near and iv_far and len(expiries) > 1) else 0.0
        for expiry in expiries:
            dte = (date.fromisoformat(expiry) - ts.date()).days
            for structure, otype, sign, kind in STRUCTURES:
                if structure not in settings.allowed_structures:
                    continue
                rows = [r for r in chain.values() if r["expiry"] == expiry and r["type"] == otype and r.get("delta") is not None]
                if not rows:
                    continue
                target = settings.target_delta if kind == "debit" else settings.target_short_delta
                anchor = min(rows, key=lambda r: abs(abs(r["delta"]) - target))
                # Debit: other leg further OTM in the trade's direction. Credit: other leg further OTM away from spot.
                otm_dir = sign if kind == "debit" else (-1 if otype == "put" else +1)
                other_strike = anchor["strike"] + otm_dir * settings.spread_width
                other = next((r for r in rows if abs(r["strike"] - other_strike) < 1e-6), None)
                if other is None:
                    continue
                long_leg, short_leg = (anchor, other) if kind == "debit" else (other, anchor)
                long_sym = next(k for k, v in chain.items() if v is long_leg)
                short_sym = next(k for k, v in chain.items() if v is short_leg)
                v_mid = _mid(long_leg) - _mid(short_leg)
                v_ask = long_leg["ask"] - short_leg["bid"]   # worst to open (pay more / receive less)
                v_bid = long_leg["bid"] - short_leg["ask"]   # best to open
                if kind == "debit" and not (0.05 <= v_mid < settings.spread_width):
                    continue
                if kind == "credit" and not (-settings.spread_width < v_mid <= -0.05):
                    continue
                spread_pct = (v_ask - v_bid) / abs(v_mid)
                # Size on the worst quoted open price (the marketable limit), so the cap holds at the fill, not at mid.
                max_loss = (v_ask if kind == "debit" else settings.spread_width + v_ask) * 100.0
                max_profit = (settings.spread_width - v_mid if kind == "debit" else -v_mid) * 100.0
                if max_loss <= 0:
                    continue
                qty = int(risk_budget // max_loss)
                if qty < 1:
                    continue
                cand = {
                    "underlying": sym, "structure": structure, "kind": kind,
                    "direction": "bullish" if sign > 0 else "bearish",
                    "expiry": expiry, "dte": dte,
                    "legs": [
                        {"symbol": long_sym, "side": "buy", "position_intent": "buy_to_open", "strike": long_leg["strike"], "type": otype},
                        {"symbol": short_sym, "side": "sell", "position_intent": "sell_to_open", "strike": short_leg["strike"], "type": otype},
                    ],
                    "qty": qty,
                    "entry_mid": round(v_mid, 4), "entry_ask": round(v_ask, 4), "entry_bid": round(v_bid, 4),
                    "width": settings.spread_width,
                    "max_loss_per_contract": round(max_loss, 2), "max_loss_total": round(max_loss * qty, 2),
                    "max_profit_per_contract": round(max_profit, 2),
                    "risk_budget": round(risk_budget, 2),
                    "features": {
                        "anchor_delta": round(anchor["delta"], 4),
                        "iv": round(anchor["iv"], 4) if anchor.get("iv") else None,
                        "rv20": round(u["rv20"], 4) if u["rv20"] else None,
                        "wedge": round(u["rv20"] - anchor["iv"], 4) if (u["rv20"] and anchor.get("iv")) else None,
                        "iv_term_slope": round(slope, 4),
                        "spread_pct": round(spread_pct, 4),
                        "ret20": round(u["ret20"], 4) if u["ret20"] is not None else None,
                        "spot": spot,
                    },
                }
                cand["candidate_id"] = sha256(canonical({"legs": [l["symbol"] for l in cand["legs"]], "snapshot_id": snapshot["snapshot_id"]}))[:12]
                candidates.append(cand)
    candidates.sort(key=lambda c: (c["underlying"], c["expiry"], c["structure"]))
    return candidates


def decision_packet(snapshot: dict, candidates: list[dict], settings) -> dict:
    """The serialized numeric packet both arms receive. Its hash is recorded."""
    packet = {
        "snapshot_id": snapshot["snapshot_id"],
        "ts": snapshot["ts"],
        "constraints": {
            "risk_cap_pct": settings.risk_cap_pct,
            "profit_target": settings.profit_target,
            "stop_loss": settings.stop_loss,
            "flatten_at": settings.flatten_at.isoformat(),
            "commission_per_contract": settings.commission_per_contract,
            "slippage_frac": settings.slippage_frac,
            "max_spread_pct": settings.max_spread_pct,
        },
        "candidates": [
            {k: c[k] for k in ("candidate_id", "underlying", "structure", "kind", "direction", "expiry", "dte", "qty",
                               "entry_mid", "width", "max_loss_total", "max_profit_per_contract", "features")}
            for c in candidates
        ],
    }
    packet["packet_hash"] = sha256(canonical(packet))
    return packet
