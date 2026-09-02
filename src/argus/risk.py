"""Governor: final order authority. Nothing reaches the gateway without it.

The governor re-observes quotes and the account immediately before approval,
runs every gate, and issues a short-lived authorization bound to the exact
proposal hash. The submit path verifies the authorization (hash match, not
expired, never used) and refuses otherwise. This is autonomous: no human token,
but an operator kill switch (``argus halt``) is honored before every approval.
"""

from __future__ import annotations

import hmac
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .alpaca import parse_occ
from .ledger import canonical, sha256


def proposal_hash(proposal: dict) -> str:
    return sha256(canonical({k: proposal[k] for k in ("snapshot_id", "candidate_id", "legs", "qty", "limit_price", "run_id")}))


def client_order_id(run_id: str, candidate_id: str, intent: str) -> str:
    return "argus-" + sha256(f"{run_id}:{candidate_id}:{intent}")[:24]


class Governor:
    def __init__(self, settings, state_dir: Path, secret: bytes | None = None):
        self.settings = settings
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._secret = secret or secrets.token_bytes(32)
        self._used = self.state_dir / "authorizations_used.txt"
        self._halt = self.state_dir / "HALT"

    def halted(self) -> bool:
        return self._halt.exists()

    def evaluate(self, proposal: dict, account: dict, fresh_quotes: dict, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        s = self.settings
        checks: list[dict] = []

        def check(name: str, ok: bool, detail: str = "") -> None:
            checks.append({"check": name, "ok": bool(ok), "detail": detail})

        check("not_halted", not self.halted(), "operator HALT file present" if self.halted() else "")
        check("paper_account", account.get("paper") is True and account.get("trading_blocked") is False)
        check("options_level_3_for_spreads", int(account.get("options_trading_level", 0)) >= 3, str(account.get("options_trading_level")))
        legs = proposal["legs"]
        check("two_legs", len(legs) == 2)
        occ_ok = True
        for leg in legs:
            try:
                meta = parse_occ(leg["symbol"])
                occ_ok &= meta["root"] in s.underlyings
                exp = datetime.fromisoformat(meta["expiry"]).date()
                occ_ok &= exp > s.flatten_at.date()
            except ValueError:
                occ_ok = False
        check("options_only_allowlisted_underlying_and_expiry", occ_ok)
        check("structure_allowed", proposal["structure"] in s.allowed_structures, proposal["structure"])
        qty = proposal["qty"]
        check("whole_positive_qty", isinstance(qty, int) and qty >= 1, str(qty))
        check("time_in_force_day", proposal.get("time_in_force") == "day")

        # Re-observed max loss from fresh quotes (defined risk = debit paid at the limit).
        lq, sq = fresh_quotes.get(legs[0]["symbol"]), fresh_quotes.get(legs[1]["symbol"])
        check("fresh_quotes_present", lq is not None and sq is not None)
        limit = float(proposal["limit_price"])
        if str(proposal.get("intent", "")).startswith("close"):
            # Alpaca MLEG: positive limit = pay debit, negative = receive credit. A close of a debit spread is a
            # credit (negative), a close of a credit spread is a debit (positive); either way |limit| < width.
            check("close_limit_within_width", 0 < abs(limit) < proposal["width"], f"limit={limit}")
            check("close_legs_reduce", all(l["position_intent"].endswith("to_close") for l in legs))
        elif lq and sq:
            fresh_value = (lq["bid"] + lq["ask"]) / 2 - (sq["bid"] + sq["ask"]) / 2
            entry = float(proposal["entry_mid"])
            kind = proposal.get("kind", "debit" if entry > 0 else "credit")
            check("limit_sign_matches_kind", (limit > 0) if kind == "debit" else (limit < 0), f"limit={limit} kind={kind}")
            check("limit_within_width", 0 < abs(limit) < proposal["width"], f"limit={limit}")
            drift = abs(fresh_value - entry) / max(abs(entry), 1e-6)
            check("quote_drift_under_15pct", drift <= 0.15, f"drift={drift:.3f}")
            max_loss = (limit if kind == "debit" else proposal["width"] + limit) * 100.0 * qty
            cap = s.risk_cap_pct * min(float(account.get("equity", 0)), s.start_equity)
            check("max_loss_within_1pct_cap", 0 < max_loss <= cap + 1e-6, f"max_loss={max_loss:.2f} cap={cap:.2f}")
            check("buying_power_ok", float(account.get("options_buying_power", 0)) >= max_loss, "")
            open_risk = float(account.get("open_risk_usd", 0.0))
            agg_cap = s.aggregate_risk_cap_pct * min(float(account.get("equity", 0)), s.start_equity)
            check("aggregate_open_risk_within_cap", open_risk + max_loss <= agg_cap + 1e-6, f"open={open_risk:.2f} new={max_loss:.2f} cap={agg_cap:.2f}")
            open_symbols = set(account.get("open_symbols", []))
            check("no_duplicate_open_legs", not any(l["symbol"] in open_symbols for l in legs), ", ".join(sorted(open_symbols & {l["symbol"] for l in legs})))
        if not str(proposal.get("intent", "")).startswith("close"):
            check("before_flatten_cutoff", now < s.flatten_at - timedelta(minutes=s.no_new_positions_minutes_before_flatten),
                  f"cutoff={(s.flatten_at - timedelta(minutes=s.no_new_positions_minutes_before_flatten)).isoformat()}")

        approved = all(c["ok"] for c in checks)
        decision = {
            "proposal_hash": proposal_hash(proposal),
            "approved": approved,
            "checks": checks,
            "failed": [c["check"] for c in checks if not c["ok"]],
            "evaluated_at": now.isoformat(),
        }
        if approved:
            expires = now + timedelta(seconds=s.auth_ttl_seconds)
            token = hmac.new(self._secret, f"{decision['proposal_hash']}:{expires.isoformat()}".encode(), hashlib.sha256).hexdigest()
            decision["authorization"] = {"token": token, "expires_at": expires.isoformat(), "proposal_hash": decision["proposal_hash"]}
        return decision

    def verify_authorization(self, auth: dict | None, proposal: dict, now: datetime | None = None) -> tuple[bool, str]:
        now = now or datetime.now(timezone.utc)
        if not auth:
            return False, "missing_authorization"
        ph = proposal_hash(proposal)
        if auth.get("proposal_hash") != ph:
            return False, "proposal_hash_mismatch"
        expires = datetime.fromisoformat(auth["expires_at"])
        if now > expires:
            return False, "authorization_expired"
        expected = hmac.new(self._secret, f"{ph}:{auth['expires_at']}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, auth.get("token", "")):
            return False, "authorization_forged"
        used = set(self._used.read_text().split()) if self._used.exists() else set()
        if auth["token"] in used:
            return False, "authorization_already_used"
        return True, "ok"

    def consume(self, auth: dict) -> None:
        with self._used.open("a") as fh:
            fh.write(auth["token"] + "\n")


def governed_submit(governor: Governor, gateway, proposal: dict, auth: dict | None, ledger, run_id: str, now: datetime | None = None) -> dict:
    """The only submission path: verify authorization, write intent, submit, record result."""
    ok, why = governor.verify_authorization(auth, proposal, now=now)
    if not ok:
        ledger.append("order_intent", run_id, {"proposal_hash": proposal_hash(proposal), "rejected": why, "submitted": False})
        return {"submitted": False, "reason": why}
    cid = client_order_id(run_id, proposal["candidate_id"], proposal["intent"])
    existing = gateway.order_by_client_id(cid)
    if existing is not None:
        ledger.append("reconciliation", run_id, {"client_order_id": cid, "found_existing": existing, "action": "skip_duplicate"})
        return {"submitted": False, "reason": "duplicate_client_order_id", "order": existing}
    governor.consume(auth)
    intent = {"client_order_id": cid, "proposal_hash": proposal_hash(proposal), "legs": proposal["legs"], "qty": proposal["qty"],
              "limit_price": proposal["limit_price"], "intent": proposal["intent"], "submitted": True}
    ledger.append("order_intent", run_id, intent)
    try:
        order = gateway.submit_mleg(proposal["legs"], proposal["qty"], proposal["limit_price"], cid)
    except Exception as exc:  # noqa: BLE001
        ledger.append("order_result", run_id, {"client_order_id": cid, "error": f"{type(exc).__name__}: {exc}"[:300], "status": "error"})
        recon = gateway.order_by_client_id(cid)
        ledger.append("reconciliation", run_id, {"client_order_id": cid, "broker_state": recon, "action": "checked_after_error"})
        return {"submitted": True, "status": "error", "order": recon}
    ledger.append("order_result", run_id, {"client_order_id": cid, "order": order, "status": order.get("status")})
    return {"submitted": True, "status": order.get("status"), "order": order}
