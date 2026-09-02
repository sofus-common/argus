"""Operator commands. `execute` requires the literal --execute flag; everything else is read-only."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import alpaca_cli, claims, engine, replay, site, validation
from .config import load_settings
from .ledger import Ledger
from .risk import Governor


def _gateway(settings):
    from .alpaca import AlpacaGateway

    if not settings.has_alpaca:
        sys.exit("Alpaca credentials missing. Copy .env.example to .env, or use `argus replay`.")
    return AlpacaGateway(settings.alpaca_api_key, settings.alpaca_secret_key, settings.options_feed)


def _paths(settings, mode: str) -> dict:
    base = settings.data_dir / mode
    return {"base": base, "ledger": base / "events.jsonl", "snapshots": base / "snapshots", "ai": base / "ai",
            "score": base / "score.json", "claims": base / "claims.json", "site": base / "site" / "index.html", "state": base / "state"}


def _run_id() -> str:
    return "run-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def cmd_run(args, settings):
    p = _paths(settings, "paper")
    gw = _gateway(settings)
    ledger = Ledger(p["ledger"], "paper")
    governor = Governor(settings, p["state"])
    if not args.no_mark:
        mk = engine.mark_cycle(gw, settings, ledger, _run_id(), execute=args.execute, governor=governor)
        print("mark:", json.dumps(mk))
    res = engine.run_cycle(gw, settings, ledger, _run_id(), execute=args.execute, snapshot_dir=p["snapshots"], governor=governor)
    if res.get("ai_record"):
        p["ai"].mkdir(parents=True, exist_ok=True)
        (p["ai"] / f"{res['snapshot_id']}.json").write_text(json.dumps(res["ai_record"], indent=2), encoding="utf-8")
    res.pop("ai_record", None)
    print("run:", json.dumps(res))
    if not args.execute:
        print("dry run: pass --execute to submit approved paper orders")


def cmd_mark(args, settings):
    p = _paths(settings, "paper")
    gw = _gateway(settings)
    ledger = Ledger(p["ledger"], "paper")
    print(json.dumps(engine.mark_cycle(gw, settings, ledger, _run_id(), execute=args.execute, governor=Governor(settings, p["state"]))))


def cmd_loop(args, settings):
    """Autonomous loop: mark + run every N minutes while the market is open, until flatten time."""
    from alpaca.trading.client import TradingClient

    p = _paths(settings, "paper")
    gw = _gateway(settings)
    clock_client = TradingClient(settings.alpaca_api_key, settings.alpaca_secret_key, paper=True)
    governor = Governor(settings, p["state"])
    while True:
        now = datetime.now(timezone.utc)
        if governor.halted():
            print(now.isoformat(), "HALT present; exiting loop")
            return
        clock = clock_client.get_clock()
        ledger = Ledger(p["ledger"], "paper")
        if clock.is_open:
            try:
                mk = engine.mark_cycle(gw, settings, ledger, _run_id(), execute=args.execute, governor=governor)
                print(now.isoformat(), "mark", json.dumps(mk))
                if now < settings.flatten_at:
                    res = engine.run_cycle(gw, settings, ledger, _run_id(), execute=args.execute, snapshot_dir=p["snapshots"], governor=governor)
                    if res.get("ai_record"):
                        p["ai"].mkdir(parents=True, exist_ok=True)
                        (p["ai"] / f"{res['snapshot_id']}.json").write_text(json.dumps(res["ai_record"], indent=2), encoding="utf-8")
                    res.pop("ai_record", None)
                    print(now.isoformat(), "run", json.dumps(res))
                rc = alpaca_cli.reconcile(ledger, settings, _run_id())
                print(now.isoformat(), "reconcile", json.dumps({k: rc.get(k) for k in ("action", "consistent", "mismatches", "errors")}))
                _score_and_export(settings, "paper", quiet=True, out=args.publish)
            except Exception as exc:  # noqa: BLE001 - keep the loop alive, record the failure
                ledger.append("note", _run_id(), {"loop_error": f"{type(exc).__name__}: {exc}"[:300]})
                print(now.isoformat(), "error", type(exc).__name__, exc)
        else:
            print(now.isoformat(), "market closed; next open", clock.next_open)
        if args.once:
            return
        wake = engine.next_wake(datetime.now(timezone.utc), args.interval, settings.flatten_at)
        time.sleep(max(1.0, (wake - datetime.now(timezone.utc)).total_seconds()))


def _score_and_export(settings, mode: str, quiet: bool = False, out: str | None = None) -> dict:
    p = _paths(settings, mode)
    ledger = Ledger(p["ledger"], mode)
    sc = validation.score(ledger, settings)
    p["score"].parent.mkdir(parents=True, exist_ok=True)
    p["score"].write_text(json.dumps(sc, indent=2), encoding="utf-8")
    manifest = claims.build_manifest(p["score"], sc, p["ledger"], public=(mode == "replay"))
    claims.write_manifest(p["claims"], manifest)
    site.export(p["site"], sc, manifest, ledger)
    if out:
        target = Path(out)
        site.export(target, sc, manifest, ledger)
        (target.parent / "score.json").write_text(json.dumps(sc, indent=2), encoding="utf-8")
        (target.parent / "claims.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if not quiet:
        print(json.dumps({k: v for k, v in sc.items() if k != "rows"}, indent=2))
        print("site:", out or p["site"])
    return sc


def cmd_score(args, settings):
    if args.ledger:
        ledger = Ledger(Path(args.ledger), args.mode)
        print(json.dumps({k: v for k, v in validation.score(ledger, settings).items() if k != "rows"}, indent=2))
    else:
        _score_and_export(settings, args.mode)


def cmd_export_site(args, settings):
    _score_and_export(settings, args.mode, out=args.out)


def cmd_replay(args, settings):
    out = replay.run_replay(settings, Path(args.fixture), settings.data_dir / "replay")
    print(json.dumps(out, indent=2, default=str))


def cmd_reconcile(args, settings):
    p = _paths(settings, "paper")
    print(json.dumps(alpaca_cli.reconcile(Ledger(p["ledger"], "paper"), settings, _run_id()), indent=2))


def cmd_verify(args, settings):
    for mode in ("paper", "replay"):
        p = _paths(settings, mode)
        if p["ledger"].exists():
            ok, msg = Ledger(p["ledger"], mode).verify()
            print(f"{mode}: {'OK' if ok else 'FAIL'} — {msg}")


def cmd_halt(args, settings):
    for mode in ("paper",):
        p = _paths(settings, mode)
        p["state"].mkdir(parents=True, exist_ok=True)
        (p["state"] / "HALT").write_text(datetime.now(timezone.utc).isoformat())
        Ledger(p["ledger"], mode).append("halt", _run_id(), {"by": "operator", "note": args.note or ""})
    print("HALT set; governor refuses all proposals until `argus resume`")


def cmd_resume(args, settings):
    p = _paths(settings, "paper")
    h = p["state"] / "HALT"
    if h.exists():
        h.unlink()
    print("HALT cleared")


def cmd_status(args, settings):
    gw = _gateway(settings)
    print(json.dumps({"account": gw.account(), "positions": gw.positions()}, indent=2))


def cmd_fixture(args, settings):
    """Save the current live snapshot as a replay fixture (chains, closes, spot, account)."""
    gw = _gateway(settings)
    from . import data

    now = datetime.now(timezone.utc)
    snap = data.build_snapshot(gw, settings, now)
    fixture = {
        "now": now.isoformat(), "account": {**gw.account(), "account_number": "PAPER-FIXTURE"},
        "spot": {s: u["spot"] for s, u in snap["underlyings"].items()},
        "closes": {s: u["closes"] for s, u in snap["underlyings"].items()},
        "chains": {s: u["chain"] for s, u in snap["underlyings"].items()},
        "marks": {}, "ai": None,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(fixture, indent=1), encoding="utf-8")
    print("fixture written:", args.out, "contracts:", sum(len(c) for c in fixture["chains"].values()))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="argus", description="Paired AI-vs-quant options research agent (Alpaca paper only)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("run", help="one cycle: mark open observations, snapshot, both arms, governor, (paper order with --execute)")
    s.add_argument("--execute", action="store_true"); s.add_argument("--no-mark", action="store_true"); s.set_defaults(fn=cmd_run)
    s = sub.add_parser("mark", help="re-mark open observations; close on exit rules (with --execute)")
    s.add_argument("--execute", action="store_true"); s.set_defaults(fn=cmd_mark)
    s = sub.add_parser("loop", help="autonomous loop while market is open")
    s.add_argument("--execute", action="store_true"); s.add_argument("--interval", type=int, default=30); s.add_argument("--once", action="store_true")
    s.add_argument("--publish", help="after each cycle also export the site here (e.g. docs/site/index.html)"); s.set_defaults(fn=cmd_loop)
    s = sub.add_parser("score", help="paired metrics"); s.add_argument("--ledger"); s.add_argument("--mode", default="paper", choices=["paper", "replay"]); s.set_defaults(fn=cmd_score)
    s = sub.add_parser("export-site", help="write score, claims, static site"); s.add_argument("--mode", default="paper", choices=["paper", "replay"])
    s.add_argument("--out", help="also copy site + score + claims here, e.g. docs/site/index.html for GitHub Pages"); s.set_defaults(fn=cmd_export_site)
    s = sub.add_parser("replay", help="credential-free seeded replay"); s.add_argument("--fixture", default="fixtures/replay/fixture.json"); s.set_defaults(fn=cmd_replay)
    s = sub.add_parser("reconcile", help="compare broker state (official Alpaca CLI) with the ledger"); s.set_defaults(fn=cmd_reconcile)
    s = sub.add_parser("verify", help="verify ledger hash chains"); s.set_defaults(fn=cmd_verify)
    s = sub.add_parser("halt", help="operator kill switch"); s.add_argument("--note"); s.set_defaults(fn=cmd_halt)
    s = sub.add_parser("resume", help="clear kill switch"); s.set_defaults(fn=cmd_resume)
    s = sub.add_parser("status", help="account and positions"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("fixture", help="save live snapshot as replay fixture"); s.add_argument("--out", default="fixtures/replay/fixture.json"); s.set_defaults(fn=cmd_fixture)
    args = ap.parse_args(argv)
    settings = load_settings()
    args.fn(args, settings)


if __name__ == "__main__":
    main()
