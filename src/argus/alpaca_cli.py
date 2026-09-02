"""Independent reconciliation through the official Alpaca CLI.

The SDK gateway is the write path. The Alpaca CLI (`alpaca`, alpacahq/cli) is a
second, independent read path: after every cycle ARGUS asks the CLI for the
account, positions, and open orders as JSON and compares them with what the
ledger believes is open. Disagreements are recorded, never silently resolved.

Credentials go to the CLI via environment variables only (paper by default;
ARGUS never sets ALPACA_LIVE_TRADE).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from .engine import open_observations


def cli_path() -> str | None:
    """Prefer a repo-local binary (bin/alpaca[.exe], gitignored), then PATH."""
    for cand in (Path("bin") / "alpaca.exe", Path("bin") / "alpaca"):
        if cand.is_file():
            return str(cand.resolve())
    return shutil.which("alpaca")


def cli_available() -> bool:
    return cli_path() is not None


def cli_json(args: list[str], settings, timeout: int = 30) -> tuple[dict | list | None, str | None]:
    """Run one CLI command and parse its JSON stdout. Returns (data, error)."""
    binary = cli_path()
    if binary is None:
        return None, "alpaca_cli_not_installed"
    env = {**os.environ, "ALPACA_API_KEY": settings.alpaca_api_key, "ALPACA_SECRET_KEY": settings.alpaca_secret_key,
           "ALPACA_QUIET": "1", "ALPACA_OUTPUT": "json"}
    env.pop("ALPACA_LIVE_TRADE", None)
    try:
        proc = subprocess.run([binary, *args], env=env, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"alpaca_cli_error:{type(exc).__name__}"
    if proc.returncode != 0:
        return None, f"alpaca_cli_exit_{proc.returncode}:{proc.stderr.strip()[:200]}"
    try:
        return json.loads(proc.stdout or "null"), None
    except json.JSONDecodeError:
        return None, "alpaca_cli_bad_json"


def reconcile(ledger, settings, run_id: str) -> dict:
    """Compare CLI-reported broker state with ledger-derived open AI positions."""
    account, e1 = cli_json(["account", "get"], settings)
    positions, e2 = cli_json(["position", "list"], settings)
    orders, e3 = cli_json(["order", "list", "--status", "open"], settings)
    errors = [e for e in (e1, e2, e3) if e]
    if errors:
        payload = {"source": "alpaca-cli", "available": cli_available(), "errors": errors, "action": "skipped"}
        ledger.append("reconciliation", run_id, payload)
        return payload
    obs = open_observations(ledger)
    ledger_legs: dict[str, float] = {}
    for o in obs.values():
        ex = o.get("executed")
        if ex and not ex["closed"]:
            cand = o["candidates"][o["ai"]]
            for leg in cand["legs"]:
                ledger_legs[leg["symbol"]] = ledger_legs.get(leg["symbol"], 0.0) + (cand["qty"] if leg["side"] == "buy" else -cand["qty"])
    broker_legs = {p.get("symbol"): float(p.get("qty", 0)) for p in (positions or []) if p.get("asset_class") == "us_option"}
    mismatches = []
    for sym in sorted(set(ledger_legs) | set(broker_legs)):
        lq, bq = ledger_legs.get(sym, 0.0), broker_legs.get(sym, 0.0)
        if abs(lq - bq) > 1e-9:
            mismatches.append({"symbol": sym, "ledger_qty": lq, "broker_qty": bq})
    payload = {
        "source": "alpaca-cli", "available": True, "action": "compared",
        "account": {k: (account or {}).get(k) for k in ("account_number", "equity", "cash", "options_buying_power", "status")},
        "broker_option_positions": broker_legs, "ledger_open_legs": ledger_legs,
        "open_orders": [{"client_order_id": o.get("client_order_id"), "status": o.get("status"), "symbol": o.get("symbol")} for o in (orders or [])],
        "mismatches": mismatches, "consistent": not mismatches,
    }
    ledger.append("reconciliation", run_id, payload)
    return payload
