"""One decision cycle and one marking cycle. Pure orchestration over the modules."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import data, inference, quant
from .ledger import Ledger, canonical, sha256
from .risk import Governor, client_order_id, governed_submit

TERMINAL_UNFILLED = {"canceled", "expired", "rejected", "error", "replaced", "done_for_day", "stopped", "suspended"}
PENDING = {"new", "accepted", "pending_new", "partially_filled", "accepted_for_bidding", "held", "calculated",
           "pending_cancel", "pending_replace", "pending_review"}  # still live: can still fill


def _costs(cand: dict, settings) -> float:
    """Modelled round-trip friction per observation, applied identically to both arms."""
    half_spread = max(cand["entry_ask"] - cand["entry_bid"], 0.0) / 2.0
    slippage = settings.slippage_frac * half_spread * 100.0 * 2  # open + close
    fees = settings.commission_per_contract * 2 * 2  # 2 legs, open + close (Alpaca: $0 commission, regulatory fees only)
    return round(cand["qty"] * (slippage + fees), 2)


def open_observations(ledger: Ledger) -> dict:
    """Reconstruct per-observation state from the ledger (pure function of events).

    ``executed`` is set only when the opening order is known FILLED. Close attempts
    are tracked so unfilled closes are retried with a fresh client order ID.
    """
    obs: dict[str, dict] = {}
    cands: dict[str, dict] = {}
    by_cid: dict[str, tuple[str, str]] = {}  # client_order_id -> (snapshot_id, "open"|"close")
    ai_source: dict[str, str | None] = {}
    for e in ledger.events():
        p, k = e["payload"], e["kind"]
        if k == "candidates":
            cands[p["snapshot_id"]] = {c["candidate_id"]: c for c in p["candidates"]}
        elif k == "ai_recommendation":
            ai_source[p["snapshot_id"]] = p.get("source")
        elif k == "ablation":
            obs[p["snapshot_id"]] = {"snapshot_id": p["snapshot_id"], "ts": e["ts"], "quant": p["quant_choice"], "ai": p["ai_choice"],
                                     "inference_cost_usd": p["inference_cost_usd"], "risk_budget": p["risk_budget"],
                                     "arms": {"quant": None, "ai": None}, "executed": None,
                                     "open_order": None, "close_orders": []}
        elif k == "order_intent" and p.get("submitted"):
            cid = p["client_order_id"]
            for sid, o in obs.items():
                if o["ai"] == "abstain":
                    continue
                if cid == client_order_id(e["run_id"], o["ai"], "open"):
                    o["open_order"] = {"client_order_id": cid, "run_id": e["run_id"], "status": "submitted", "qty": p["qty"]}
                    by_cid[cid] = (sid, "open")
                elif p.get("intent", "").startswith("close"):
                    if o.get("open_order") and cid == client_order_id(o["open_order"]["run_id"], o["ai"], p["intent"]):
                        o["close_orders"].append({"client_order_id": cid, "status": "submitted", "intent": p["intent"]})
                        by_cid[cid] = (sid, "close")
        elif k in ("order_result", "reconciliation"):
            cid = p.get("client_order_id")
            state = p.get("order") if k == "order_result" else p.get("broker_state")
            status = (state or {}).get("status") or p.get("status")
            if cid in by_cid and status:
                sid, kind = by_cid[cid]
                o = obs[sid]
                if kind == "open":
                    o["open_order"]["status"] = status
                else:
                    for c in o["close_orders"]:
                        if c["client_order_id"] == cid:
                            c["status"] = status
        elif k == "outcome":
            o = obs.get(p["snapshot_id"])
            if o is not None:
                o["arms"][p["arm"]] = p
    for sid, o in obs.items():
        o["candidates"] = cands.get(sid, {})
        o["ai_source"] = ai_source.get(sid)
        oo = o.get("open_order")
        o["open_pending"] = bool(oo and oo["status"] != "filled" and oo["status"] in PENDING | {"submitted"})
        if oo and oo["status"] == "filled":
            closed = any(c["status"] == "filled" for c in o["close_orders"])
            pending = [c for c in o["close_orders"] if c["status"] in PENDING | {"submitted"}]
            o["executed"] = {"client_order_id": oo["client_order_id"], "run_id": oo["run_id"], "status": "filled",
                             "closed": closed, "close_pending": pending[-1] if pending else None, "close_attempts": len(o["close_orders"])}
    return obs


def _committed_candidates(obs: dict) -> list[dict]:
    """Candidates whose risk is live: filled and unclosed, or an opening order still working."""
    out = []
    for o in obs.values():
        ex = o.get("executed")
        if (ex and not ex["closed"]) or o.get("open_pending"):
            cand = o.get("candidates", {}).get(o["ai"])
            if cand:
                out.append(cand)
    return out


def open_risk_usd(obs: dict) -> float:
    """Sum of defined max loss across AI positions that are filled or still working."""
    return round(sum(float(c["max_loss_total"]) for c in _committed_candidates(obs)), 2)


def committed_symbols(obs: dict) -> set[str]:
    """Leg symbols already committed by a filled or still-working AI order."""
    return {leg["symbol"] for c in _committed_candidates(obs) for leg in c["legs"]}


def run_cycle(gateway, settings, ledger: Ledger, run_id: str, *, execute: bool = False,
              ai_recorded: dict | None = None, now: datetime | None = None, snapshot_dir: Path | None = None,
              governor: Governor | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    account = gateway.account()
    snapshot = data.build_snapshot(gateway, settings, now)
    snapshot["equity"] = account["equity"]
    snap_json = canonical(snapshot)
    snap_sha = sha256(snap_json)
    if snapshot_dir is not None:
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        (snapshot_dir / f"{snapshot['snapshot_id']}.json").write_text(snap_json, encoding="utf-8")
    ledger.append("data_snapshot", run_id, {
        "snapshot_id": snapshot["snapshot_id"], "ts": snapshot["ts"], "feed": snapshot["feed"], "source": snapshot["source"],
        "query": snapshot["query"], "snapshot_sha256": snap_sha, "account_number": account.get("account_number"),
        "equity": account["equity"], "underlyings": {s: {"spot": u["spot"], "rv20": u["rv20"], "ret20": u["ret20"], "contracts": len(u["chain"])}
                                                    for s, u in snapshot["underlyings"].items()},
    })
    candidates = data.build_candidates(snapshot, settings)
    for c in candidates:
        c["modelled_costs"] = _costs(c, settings)
    packet = data.decision_packet(snapshot, candidates, settings)
    ledger.append("candidates", run_id, {"snapshot_id": snapshot["snapshot_id"], "packet_hash": packet["packet_hash"],
                                         "count": len(candidates), "candidates": candidates})
    q = quant.choose(packet, settings)
    ledger.append("baseline", run_id, {"snapshot_id": snapshot["snapshot_id"], "packet_hash": packet["packet_hash"], **q})
    a = inference.select(packet, settings, recorded=ai_recorded)
    ledger.append("ai_recommendation", run_id, {"snapshot_id": snapshot["snapshot_id"], **a})
    by_id = {c["candidate_id"]: c for c in candidates}
    ablation = {
        "snapshot_id": snapshot["snapshot_id"], "trial_id": settings.trial_id, "packet_hash": packet["packet_hash"],
        "quant_choice": q["choice"], "ai_choice": a["choice"], "changed": q["choice"] != a["choice"],
        "ai_abstained": a["choice"] == "abstain", "quant_abstained": q["choice"] == "abstain",
        "inference_cost_usd": a.get("cost_usd", 0.0), "risk_budget": candidates[0]["risk_budget"] if candidates else None,
        "contract_sha256": sha256(canonical(settings.contract())),
    }
    ledger.append("ablation", run_id, ablation)

    execution = {"attempted": False}
    if a["choice"] != "abstain":
        cand = by_id[a["choice"]]
        proposal = {
            "run_id": run_id, "snapshot_id": snapshot["snapshot_id"], "candidate_id": cand["candidate_id"], "structure": cand["structure"],
            "legs": [{k: l[k] for k in ("symbol", "side", "position_intent")} for l in cand["legs"]], "qty": cand["qty"],
            # signed net price (Alpaca MLEG: + debit / - credit). Marketable: the worst quoted open price, so the
            # order fills now against the snapshot it was decided on instead of resting and filling adversely later.
            "limit_price": round(cand["entry_ask"], 2),
            "entry_mid": cand["entry_mid"], "kind": cand.get("kind", "debit"), "width": cand["width"],
            "time_in_force": "day", "intent": "open",
        }
        governor = governor or Governor(settings, ledger.path.parent / "state")
        fresh = gateway.latest_option_quotes([l["symbol"] for l in proposal["legs"]])
        fresh_account = gateway.account()
        live_obs = open_observations(ledger)
        fresh_account["open_risk_usd"] = open_risk_usd(live_obs)
        fresh_account["open_symbols"] = sorted({p["symbol"] for p in gateway.positions()} | committed_symbols(live_obs))
        decision = governor.evaluate(proposal, fresh_account, fresh, now=now)
        ledger.append("risk_decision", run_id, {"proposal": proposal, **{k: v for k, v in decision.items() if k != "authorization"},
                                                "open_risk_usd": fresh_account["open_risk_usd"], "execute_flag": execute})
        execution = {"attempted": True, "approved": decision["approved"], "failed": decision["failed"]}
        if decision["approved"] and execute:
            execution["result"] = governed_submit(governor, gateway, proposal, decision.get("authorization"), ledger, run_id, now=now)
        elif decision["approved"]:
            ledger.append("note", run_id, {"snapshot_id": snapshot["snapshot_id"], "dry_run": True, "proposal_hash": decision["proposal_hash"]})
    return {"snapshot_id": snapshot["snapshot_id"], "candidates": len(candidates), "quant": q["choice"], "ai": a["choice"],
            "changed": ablation["changed"], "execution": execution, "ai_record": a.get("recorded")}


def _reconcile(gateway, ledger: Ledger, run_id: str, order: dict | None, cancel_if_pending: bool = False) -> str | None:
    """Re-query a submitted order; record the broker state if it changed. Returns the broker status.

    With ``cancel_if_pending`` a still-working order is canceled first: an order that did not fill within one
    cycle belongs to a stale snapshot and would otherwise fill only when the market moves against it.
    """
    if not order or order["status"] in TERMINAL_UNFILLED or order["status"] == "filled":
        return order["status"] if order else None
    state = gateway.order_by_client_id(order["client_order_id"])
    status = (state or {}).get("status")
    if cancel_if_pending and status in PENDING and state and state.get("id"):
        gateway.cancel_order(state["id"])
        state = gateway.order_by_client_id(order["client_order_id"]) or state
        status = state.get("status") or status
        ledger.append("reconciliation", run_id, {"client_order_id": order["client_order_id"], "broker_state": state,
                                                 "action": "canceled_stale_pending_order"})
        order["status"] = status
        return status
    if status and status != order["status"]:
        ledger.append("reconciliation", run_id, {"client_order_id": order["client_order_id"], "broker_state": state, "action": "status_update"})
        order["status"] = status
    return status or order["status"]


MAX_QUOTE_AGE = timedelta(minutes=40)  # ~2 cycles at the default 20-minute interval


def _usable_quote(q: dict | None, now: datetime) -> bool:
    """A quote we are willing to mark or price a close against.

    A crossed or offerless quote produces a mark that can trip the profit target or stop loss and close an arm
    permanently on a fabricated price, which then becomes the final scored value. A bid of 0 is legitimate on a
    far-OTM leg, so it is not rejected here.
    """
    if not q or q.get("bid") is None or q.get("ask") is None:
        return False
    if q["ask"] <= 0 or q["ask"] < q["bid"]:
        return False
    ts = q.get("quote_ts")
    if ts:
        try:
            return now - datetime.fromisoformat(ts) <= MAX_QUOTE_AGE
        except ValueError:
            return False
    return True


def mark_cycle(gateway, settings, ledger: Ledger, run_id: str, *, execute: bool = False, now: datetime | None = None,
               governor: Governor | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    obs = open_observations(ledger)
    # 1. Reconcile opening orders that are not yet terminal, so `executed` reflects broker truth. An opening order
    #    still working at the next cycle is stale (its snapshot is a cycle old): cancel it, then read the final state.
    changed = False
    for o in obs.values():
        oo = o.get("open_order")
        if oo and oo["status"] not in TERMINAL_UNFILLED and oo["status"] != "filled":
            changed |= _reconcile(gateway, ledger, run_id, oo, cancel_if_pending=True) != "submitted"
    if changed:
        obs = open_observations(ledger)
    symbols: set[str] = set()
    for o in obs.values():
        for arm in ("quant", "ai"):
            cid = o[arm]
            prior = o["arms"][arm]
            if cid != "abstain" and not (prior and prior["status"] == "closed" and not (arm == "ai" and o.get("executed") and not o["executed"]["closed"])):
                symbols.update(l["symbol"] for l in o["candidates"][cid]["legs"])
    quotes = gateway.latest_option_quotes(sorted(symbols)) if symbols else {}
    quotes = {occ: q for occ, q in quotes.items() if _usable_quote(q, now)}
    marked, closed, close_orders = 0, 0, 0
    flatten = now >= settings.flatten_at
    for sid, o in obs.items():
        for arm in ("quant", "ai"):
            cid = o[arm]
            prior = o["arms"][arm]
            if cid == "abstain":
                if prior is None:
                    ledger.append("outcome", run_id, {"snapshot_id": sid, "arm": arm, "candidate_id": "abstain", "status": "closed",
                                                      "pnl_gross": 0.0, "costs": 0.0, "pnl_net": 0.0, "reason": "abstained", "marked_at": now.isoformat()})
                continue
            cand = o["candidates"][cid]
            lq, sq = quotes.get(cand["legs"][0]["symbol"]), quotes.get(cand["legs"][1]["symbol"])
            already_closed = bool(prior and prior["status"] == "closed")
            if not already_closed:
                if not lq or not sq:
                    # Outside the deadline a missing quote just carries the last mark forward. At the deadline it
                    # must not skip the close below, or the position stays open past it.
                    status = "closed" if flatten else "open"
                    ledger.append("outcome", run_id, {"snapshot_id": sid, "arm": arm, "candidate_id": cid, "status": status,
                                                      "reason": "flatten_deadline_no_quote" if flatten else "missing_quote_keep_last",
                                                      "marked_at": now.isoformat(),
                                                      **{k: (prior or {}).get(k, 0.0) for k in ("mark", "pnl_gross", "costs", "pnl_net")}})
                    closed += status == "closed"
                    already_closed = status == "closed"
                    if not already_closed:
                        continue
                if lq and sq:
                    mark = (lq["bid"] + lq["ask"]) / 2 - (sq["bid"] + sq["ask"]) / 2
                    pnl_gross = round((mark - cand["entry_mid"]) * 100.0 * cand["qty"], 2)
                    costs = cand.get("modelled_costs", 0.0)
                    pnl_net = round(pnl_gross - costs, 2)
                    per_contract = mark - cand["entry_mid"]  # works for debit (entry>0) and credit (entry<0) alike
                    reason = None
                    if flatten:
                        reason = "flatten_deadline"
                    elif per_contract >= settings.profit_target * abs(cand["entry_mid"]):
                        reason = "profit_target"
                    elif per_contract <= -settings.stop_loss * abs(cand["entry_mid"]):
                        reason = "stop_loss"
                    elif (datetime.fromisoformat(cand["expiry"]).date() - now.date()).days <= 1:
                        reason = "expiry_guard"
                    status = "closed" if reason else "open"
                    ledger.append("outcome", run_id, {"snapshot_id": sid, "arm": arm, "candidate_id": cid, "status": status, "mark": round(mark, 4),
                                                      "pnl_gross": pnl_gross, "costs": costs, "pnl_net": pnl_net, "reason": reason or "marked",
                                                      "marked_at": now.isoformat(), "quote_ts": lq.get("quote_ts")})
                    marked += 1
                    closed += status == "closed"
                    already_closed = status == "closed"
            # 2. Real position management for the AI arm: close when the outcome closes; retry unfilled closes.
            ex = o.get("executed")
            if arm == "ai" and already_closed and ex and not ex["closed"] and execute and (flatten or (lq and sq)):
                pending_status = _reconcile(gateway, ledger, run_id, ex["close_pending"], cancel_if_pending=True) if ex["close_pending"] else None
                if pending_status == "filled" or pending_status in PENDING:
                    continue  # closed now, or cancel did not land yet — never stack close orders
                attempt = ex["close_attempts"] + 1
                if attempt > settings.max_close_attempts and not flatten:  # the deadline always gets an attempt
                    ledger.append("note", run_id, {"snapshot_id": sid, "close_attempts_exhausted": attempt - 1, "action": "operator_attention"})
                    continue
                governor = governor or Governor(settings, ledger.path.parent / "state")
                # Closing reverses the legs. The spread's value v = long mid - short mid is what we give up, so the
                # close order's signed net price is -v (Alpaca MLEG: negative = credit received, positive = debit paid).
                kind = cand.get("kind", "debit")
                cap = cand["width"] - 0.01  # the governor requires 0 < |limit| < width; width is the defined max loss
                aggressive = flatten or attempt > 1
                if lq and sq:
                    value_mid = (lq["bid"] + lq["ask"]) / 2 - (sq["bid"] + sq["ask"]) / 2
                    value_bid = lq["bid"] - sq["ask"]  # worst (most conservative) value we can close at
                    value_target = value_bid if aggressive else value_mid - 0.25 * (value_mid - value_bid)
                    limit = -value_target
                else:  # no quote at the deadline: concede the whole defined risk rather than stay open
                    limit = cap if kind == "credit" else -0.01
                if abs(limit) < 0.01:
                    limit = -0.01 if kind == "debit" else 0.01
                # A deep-ITM spread can quote wider than its own width, which would veto the close forever.
                limit = max(-cap, min(cap, limit))
                proposal = {
                    "run_id": ex["run_id"], "snapshot_id": sid, "candidate_id": cid, "structure": cand["structure"],
                    "legs": [{"symbol": cand["legs"][0]["symbol"], "side": "sell", "position_intent": "sell_to_close"},
                             {"symbol": cand["legs"][1]["symbol"], "side": "buy", "position_intent": "buy_to_close"}],
                    "qty": cand["qty"], "limit_price": round(limit, 2),
                    "entry_mid": cand["entry_mid"], "kind": cand.get("kind", "debit"), "width": cand["width"],
                    "time_in_force": "day", "intent": f"close{attempt}",
                }
                decision = governor.evaluate(proposal, gateway.account(), quotes, now=now)
                ledger.append("risk_decision", run_id, {"proposal": proposal, **{k: v for k, v in decision.items() if k != "authorization"},
                                                        "execute_flag": True, "close_attempt": attempt, "aggressive": aggressive})
                if decision["approved"]:
                    governed_submit(governor, gateway, proposal, decision.get("authorization"), ledger, ex["run_id"], now=now)
                    close_orders += 1
    return {"observations": len(obs), "marked": marked, "closed": closed, "close_orders": close_orders, "quotes": len(quotes),
            "open_risk_usd": open_risk_usd(open_observations(ledger))}


def next_wake(now: datetime, interval_minutes: int, flatten_at: datetime) -> datetime:
    """Sleep target for the loop: never sleep past the flatten deadline."""
    nxt = now + timedelta(minutes=interval_minutes)
    if now < flatten_at < nxt:
        return flatten_at + timedelta(seconds=15)
    return nxt
