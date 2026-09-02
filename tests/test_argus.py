import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from argus import data, inference, quant, replay, validation
from argus.alpaca import FakeGateway, parse_occ
from argus.config import load_settings
from argus.engine import run_cycle
from argus.ledger import Ledger, canonical, sha256
from argus.risk import Governor, governed_submit, proposal_hash

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "replay" / "fixture.json"


@pytest.fixture
def settings(monkeypatch):
    for k in ("ALPACA_API_KEY", "ALPACA_SECRET_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    return load_settings(dotenv=None)


@pytest.fixture
def fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_ledger_chain_and_tamper_detection(tmp_path):
    led = Ledger(tmp_path / "e.jsonl", "paper")
    led.append("note", "r1", {"a": 1})
    led.append("note", "r1", {"a": 2})
    assert led.verify() == (True, "ok")
    lines = (tmp_path / "e.jsonl").read_text().splitlines()
    lines[0] = lines[0].replace('"a":1', '"a":9')
    (tmp_path / "e.jsonl").write_text("\n".join(lines) + "\n")
    ok, msg = Ledger(tmp_path / "e.jsonl", "paper").verify()
    assert not ok and "hash" in msg


def test_replay_events_cannot_enter_paper_ledger(tmp_path):
    Ledger(tmp_path / "e.jsonl", "replay").append("note", "r", {})
    ok, msg = Ledger(tmp_path / "e.jsonl", "paper").verify()
    assert not ok and "run_mode" in msg


def test_candidates_are_deterministic(settings, fixture):
    gw = FakeGateway(fixture)
    now = datetime.fromisoformat(fixture["now"])
    s1, s2 = data.build_snapshot(gw, settings, now), data.build_snapshot(gw, settings, now)
    assert s1["snapshot_id"] == s2["snapshot_id"]
    c1, c2 = data.build_candidates(s1, settings), data.build_candidates(s2, settings)
    assert canonical(c1) == canonical(c2) and len(c1) > 0
    for c in c1:
        assert c["max_loss_total"] <= settings.risk_cap_pct * settings.start_equity
        assert parse_occ(c["legs"][0]["symbol"])["expiry"] == c["expiry"]
    p1, p2 = data.decision_packet(s1, c1, settings), data.decision_packet(s2, c2, settings)
    assert p1["packet_hash"] == p2["packet_hash"]
    assert quant.choose(p1, settings) == quant.choose(p2, settings)


def test_ai_cannot_invent_or_alter_a_trade(settings, fixture):
    gw = FakeGateway(fixture)
    snap = data.build_snapshot(gw, settings, datetime.fromisoformat(fixture["now"]))
    packet = data.decision_packet(snap, data.build_candidates(snap, settings), settings)
    out = inference.select(packet, settings, recorded={"parsed": {"choice": "made_up_id", "confidence": 0.9, "reason_codes": []}})
    assert out["choice"] == "abstain" and any(r.startswith("refused_out_of_set_choice") for r in out["reason_codes"])
    valid = packet["candidates"][0]["candidate_id"]
    out = inference.select(packet, settings, recorded={"parsed": {"choice": valid, "confidence": 0.5, "reason_codes": ["x"]}})
    assert out["choice"] == valid and out["packet_hash"] == packet["packet_hash"]
    # No credentials => recorded abstention, never a silent default trade.
    assert inference.select(packet, settings)["choice"] == "abstain"
    # The request itself is pinned: strict schema, no fallbacks, no data collection.
    req = inference.build_request(packet, settings)
    assert req["provider"] == {"allow_fallbacks": False, "data_collection": "deny", "zdr": True, "require_parameters": True}
    assert req["response_format"]["json_schema"]["strict"] is True and req["temperature"] == 0


def _proposal(fixture, settings):
    gw = FakeGateway(fixture)
    snap = data.build_snapshot(gw, settings, datetime.fromisoformat(fixture["now"]))
    cand = data.build_candidates(snap, settings)[0]
    return gw, {"run_id": "t", "snapshot_id": snap["snapshot_id"], "candidate_id": cand["candidate_id"], "structure": cand["structure"],
                "legs": [{k: l[k] for k in ("symbol", "side", "position_intent")} for l in cand["legs"]], "qty": cand["qty"],
                "limit_price": cand["entry_mid"], "entry_mid": cand["entry_mid"], "width": cand["width"], "time_in_force": "day", "intent": "open"}


def test_governor_gates_and_authorization(tmp_path, settings, fixture):
    gw, prop = _proposal(fixture, settings)
    gov = Governor(settings, tmp_path)
    now = datetime.fromisoformat(fixture["now"])
    fresh = gw.latest_option_quotes([l["symbol"] for l in prop["legs"]])
    ok = gov.evaluate(prop, gw.account(), fresh, now=now)
    assert ok["approved"], ok["failed"]
    # over the 1% cap
    big = {**prop, "qty": prop["qty"] * 50}
    assert "max_loss_within_1pct_cap" in gov.evaluate(big, gw.account(), fresh, now=now)["failed"]
    # wrong underlying / expiry inside deadline
    bad = {**prop, "legs": [{"symbol": "TSLA260903C00300000", "side": "buy", "position_intent": "buy_to_open"}, prop["legs"][1]]}
    assert "options_only_allowlisted_underlying_and_expiry" in gov.evaluate(bad, gw.account(), fresh, now=now)["failed"]
    # not paper
    assert "paper_account" in gov.evaluate(prop, {**gw.account(), "paper": False}, fresh, now=now)["failed"]
    # halted
    (tmp_path / "HALT").write_text("x")
    assert "not_halted" in gov.evaluate(prop, gw.account(), fresh, now=now)["failed"]
    (tmp_path / "HALT").unlink()
    # authorization binding
    auth = ok["authorization"]
    assert gov.verify_authorization(auth, prop, now=now)[0]
    assert gov.verify_authorization(auth, {**prop, "qty": prop["qty"] + 1}, now=now) == (False, "proposal_hash_mismatch")
    assert gov.verify_authorization(auth, prop, now=now + timedelta(seconds=settings.auth_ttl_seconds + 1)) == (False, "authorization_expired")
    assert gov.verify_authorization({**auth, "token": "0" * 64}, prop, now=now) == (False, "authorization_forged")
    assert gov.verify_authorization(None, prop, now=now) == (False, "missing_authorization")


def test_governed_submit_records_intent_then_result_and_refuses_reuse(tmp_path, settings, fixture):
    gw, prop = _proposal(fixture, settings)
    gov = Governor(settings, tmp_path)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    now = datetime.fromisoformat(fixture["now"])
    auth = gov.evaluate(prop, gw.account(), gw.latest_option_quotes([l["symbol"] for l in prop["legs"]]), now=now)["authorization"]
    res = governed_submit(gov, gw, prop, auth, led, "t", now=now)
    assert res["submitted"] and res["status"] == "filled"
    kinds = [e["kind"] for e in led.events()]
    assert kinds == ["order_intent", "order_result"]
    # same authorization again: refused before any broker call
    res2 = governed_submit(gov, gw, prop, auth, led, "t", now=now)
    assert res2 == {"submitted": False, "reason": "authorization_already_used"}
    # rejected proposals never submit
    res3 = governed_submit(gov, gw, prop, None, led, "t", now=now)
    assert not res3["submitted"] and len(gw.orders) == 1


def test_duplicate_client_order_id_reconciles_instead_of_resubmitting(tmp_path, settings, fixture):
    gw, prop = _proposal(fixture, settings)
    gov = Governor(settings, tmp_path)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    now = datetime.fromisoformat(fixture["now"])
    quotes = gw.latest_option_quotes([l["symbol"] for l in prop["legs"]])
    a1 = gov.evaluate(prop, gw.account(), quotes, now=now)["authorization"]
    governed_submit(gov, gw, prop, a1, led, "t", now=now)
    a2 = gov.evaluate(prop, gw.account(), quotes, now=now + timedelta(seconds=1))["authorization"]
    res = governed_submit(gov, gw, prop, a2, led, "t", now=now + timedelta(seconds=1))
    assert res["reason"] == "duplicate_client_order_id" and len(gw.orders) == 1
    assert [e["kind"] for e in led.events()][-1] == "reconciliation"


def test_dry_run_never_submits(tmp_path, settings, fixture):
    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    res = run_cycle(gw, settings, led, "r1", execute=False, ai_recorded=fixture["ai"], now=datetime.fromisoformat(fixture["now"]),
                    governor=Governor(settings, tmp_path / "state"))
    assert res["execution"]["approved"] and "result" not in res["execution"] and gw.orders == {}


def test_replay_full_evidence_path_without_credentials(tmp_path, settings):
    out = replay.run_replay(settings, FIXTURE, tmp_path / "replay")
    assert out["ledger_ok"]
    sc = out["score"]
    assert sc["run_mode"] == "replay" and sc["evidence_state"] == "DESCRIPTIVE" and sc["n_observations"] == 1
    assert sc["changed_decisions"] == 1 and sc["executed_observations"] == 1
    assert (tmp_path / "replay" / "site" / "index.html").exists()
    claims = json.loads((tmp_path / "replay" / "claims.json").read_text())
    assert all(c["status"] in ("REPRODUCIBLE", "RECORDED", "UNSUPPORTED", "RETRACTED") for c in claims["claims"])
    assert any(c["status"] == "UNSUPPORTED" and c["label"] == "AI beats quant" for c in claims["claims"])
    src = json.loads((tmp_path / "replay" / "score.json").read_text())
    assert claims["claims"][0]["source_sha256"] == sha256((tmp_path / "replay" / "score.json").read_text(encoding="utf-8"))
    assert src["ai_minus_quant_usd"] == sc["ai_minus_quant_usd"]


def test_score_is_pure_and_replay_reproducible(tmp_path, settings):
    a = replay.run_replay(settings, FIXTURE, tmp_path / "a")["score"]
    b = replay.run_replay(settings, FIXTURE, tmp_path / "b")["score"]
    assert a == b
    led = Ledger(tmp_path / "a" / "events.jsonl", "replay")
    assert {k: v for k, v in validation.score(led, settings).items() if k != "rows"} == a


def test_aggregate_cap_and_duplicate_legs_block_stacking(tmp_path, settings, fixture):
    from argus.engine import next_wake, open_risk_usd, open_observations

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    r1 = run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    assert r1["execution"]["result"]["status"] == "filled"
    assert open_risk_usd(open_observations(led)) > 0
    # Same decision next cycle: identical legs already open -> refused, but the observation is still paired/scored.
    t2 = now + timedelta(minutes=30)
    legs1 = [l["symbol"] for l in led.by_kind("risk_decision")[0]["payload"]["proposal"]["legs"]]
    snap2 = data.build_snapshot(gw, settings, t2)
    same = next(c for c in data.build_candidates(snap2, settings) if [l["symbol"] for l in c["legs"]] == legs1)
    ai2 = {"parsed": {"choice": same["candidate_id"], "confidence": 0.6, "reason_codes": ["same_again"]}, "cost_usd": 0.0002}
    r2 = run_cycle(gw, settings, led, "r2", execute=True, ai_recorded=ai2, now=t2, governor=gov)
    assert r2["execution"]["approved"] is False and "no_duplicate_open_legs" in r2["execution"]["failed"]
    assert len(gw.orders) == 1
    # Aggregate cap: 5% of 100k = $5,000 of defined max loss across open AI positions.
    prop = {**{k: v for k, v in led.by_kind("risk_decision")[0]["payload"]["proposal"].items()}}
    acct = {**gw.account(), "open_risk_usd": 4500.0, "open_symbols": []}
    d = gov.evaluate(prop, acct, gw.latest_option_quotes([l["symbol"] for l in prop["legs"]]), now=now)
    assert "aggregate_open_risk_within_cap" in d["failed"]
    # No new positions inside the pre-flatten cutoff; closes are still allowed.
    late = settings.flatten_at - timedelta(minutes=settings.no_new_positions_minutes_before_flatten - 1)
    d = gov.evaluate(prop, {**gw.account(), "open_symbols": []}, gw.latest_option_quotes([l["symbol"] for l in prop["legs"]]), now=late)
    assert "before_flatten_cutoff" in d["failed"]
    # Loop never sleeps past the flatten deadline.
    assert next_wake(settings.flatten_at - timedelta(minutes=10), 30, settings.flatten_at) == settings.flatten_at + timedelta(seconds=15)
    assert next_wake(settings.flatten_at - timedelta(minutes=40), 30, settings.flatten_at) == settings.flatten_at - timedelta(minutes=10)


def test_close_is_retried_until_filled_and_flatten_is_aggressive(tmp_path, settings, fixture):
    from argus.engine import mark_cycle, open_observations

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    gw.marks_active = True
    # Make the first close attempt expire unfilled, then verify a second attempt with a new client id goes out.
    original = gw.submit_mleg
    calls = []

    def flaky(legs, qty, limit_price, cid):
        o = original(legs, qty, limit_price, cid)
        calls.append(cid)
        if len(calls) == 1:
            o["status"] = "expired"
        return o

    gw.submit_mleg = flaky
    t = settings.flatten_at + timedelta(minutes=1)  # flatten => outcome closes, aggressive limit
    mark_cycle(gw, settings, led, "m1", execute=True, now=t, governor=gov)
    ex = list(open_observations(led).values())[0]["executed"]
    assert ex["close_attempts"] == 1 and not ex["closed"]
    mark_cycle(gw, settings, led, "m2", execute=True, now=t + timedelta(minutes=30), governor=gov)
    ex = list(open_observations(led).values())[0]["executed"]
    assert ex["close_attempts"] == 2 and ex["closed"] and len(set(calls)) == 2
    rd = [e["payload"] for e in led.by_kind("risk_decision") if e["payload"]["proposal"]["intent"].startswith("close")]
    assert all(r["aggressive"] for r in rd)
    # A third mark does nothing more for that position.
    before = len(list(led.events()))
    mark_cycle(gw, settings, led, "m3", execute=True, now=t + timedelta(minutes=60), governor=gov)
    assert not any(e["kind"] == "order_intent" for e in list(led.events())[before:])


def test_cli_reconciliation_flags_mismatch_and_degrades_gracefully(tmp_path, settings, fixture, monkeypatch):
    from argus import alpaca_cli

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    # CLI missing -> recorded skip, no exception (chdir away from a repo-local bin/)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PATH", "/nonexistent")
    out = alpaca_cli.reconcile(led, settings, "rc0")
    assert out["action"] == "skipped" and "alpaca_cli_not_installed" in out["errors"]
    # Shim CLI on PATH; broker agrees with ledger (shim is a POSIX script)
    import os
    if os.name == "nt":
        pytest.skip("CLI shim needs a POSIX shell; run this part on Linux/macOS/WSL")
    shim = str(Path(__file__).resolve().parent / "bin")
    monkeypatch.setenv("PATH", shim + os.pathsep + "/usr/bin" + os.pathsep + "/bin")
    legs = led.by_kind("risk_decision")[0]["payload"]["proposal"]["legs"]
    qty = led.by_kind("risk_decision")[0]["payload"]["proposal"]["qty"]
    positions = [{"symbol": legs[0]["symbol"], "qty": str(qty), "asset_class": "us_option"},
                 {"symbol": legs[1]["symbol"], "qty": str(-qty), "asset_class": "us_option"}]
    monkeypatch.setenv("ALPACA_SHIM_STATE", json.dumps({"positions": positions}))
    out = alpaca_cli.reconcile(led, settings, "rc1")
    assert out["consistent"] and out["source"] == "alpaca-cli"
    # Broker shows a leg the ledger does not -> mismatch recorded, never auto-fixed
    monkeypatch.setenv("ALPACA_SHIM_STATE", json.dumps({"positions": positions[:1]}))
    out = alpaca_cli.reconcile(led, settings, "rc2")
    assert not out["consistent"] and out["mismatches"][0]["symbol"] == legs[1]["symbol"]
    assert led.by_kind("reconciliation")[-1]["payload"]["mismatches"] == out["mismatches"]


def test_score_refuses_wrong_mode_or_tampered_ledger(tmp_path, settings):
    replay.run_replay(settings, FIXTURE, tmp_path / "r")
    with pytest.raises(ValueError, match="run_mode"):
        validation.score(Ledger(tmp_path / "r" / "events.jsonl", "paper"), settings)
    path = tmp_path / "r" / "events.jsonl"
    lines = path.read_text().splitlines()
    lines[2] = lines[2].replace('"arm":"quant"', '"arm":"QUANT"')
    path.write_text("\n".join(lines) + "\n")
    with pytest.raises(ValueError, match="hash"):
        validation.score(Ledger(path, "replay"), settings)


def test_credit_and_debit_verticals_share_one_signed_price_model(tmp_path, settings, fixture):
    from argus.engine import mark_cycle, open_observations

    gw = FakeGateway(fixture)
    now = datetime.fromisoformat(fixture["now"])
    snap = data.build_snapshot(gw, settings, now)
    cands = data.build_candidates(snap, settings)
    kinds = {c["kind"] for c in cands}
    assert kinds == {"debit", "credit"}
    for c in cands:
        if c["kind"] == "debit":
            assert 0 < c["entry_mid"] < c["width"] and abs(c["max_loss_per_contract"] - c["entry_ask"] * 100) < 1e-6
        else:
            assert -c["width"] < c["entry_mid"] < 0 and abs(c["max_loss_per_contract"] - (c["width"] + c["entry_ask"]) * 100) < 1e-6
        assert c["max_loss_total"] <= settings.risk_cap_pct * settings.start_equity
        assert c["entry_bid"] <= c["entry_mid"] <= c["entry_ask"]
    # Quant: IV is ~5 vol points rich in this fixture -> credit regime.
    q = quant.choose(data.decision_packet(snap, cands, settings), settings)
    by_id = {c["candidate_id"]: c for c in cands}
    assert q["choice"] != "abstain" and by_id[q["choice"]]["kind"] == "credit" and "credit_iv_rich" in q["reason_codes"]
    # Execute a credit spread through the governor: open limit is negative (credit), close limit is positive (debit).
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    credit = by_id[q["choice"]]
    ai = {"parsed": {"choice": credit["candidate_id"], "confidence": 0.6, "reason_codes": ["sell_rich_vol"]}, "cost_usd": 0.0002}
    r = run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=ai, now=now, governor=gov)
    assert r["execution"]["approved"], r["execution"]["failed"]
    open_limit = led.by_kind("risk_decision")[0]["payload"]["proposal"]["limit_price"]
    assert open_limit < 0 and gw.orders and list(gw.orders.values())[0]["filled_avg_price"] == open_limit
    gw.marks_active = True
    mark_cycle(gw, settings, led, "m1", execute=True, now=settings.flatten_at + timedelta(minutes=1), governor=gov)
    close = [e["payload"]["proposal"] for e in led.by_kind("risk_decision") if e["payload"]["proposal"]["intent"].startswith("close")][0]
    assert close["limit_price"] > 0 and close["legs"][0]["position_intent"] == "sell_to_close"
    assert list(open_observations(led).values())[0]["executed"]["closed"]
    # And a debit spread closes for a credit (negative limit).
    debit = next(c for c in cands if c["kind"] == "debit")
    led2 = Ledger(tmp_path / "e2.jsonl", "paper")
    gw2 = FakeGateway(fixture)
    ai2 = {"parsed": {"choice": debit["candidate_id"], "confidence": 0.6, "reason_codes": []}, "cost_usd": 0.0}
    run_cycle(gw2, settings, led2, "r1", execute=True, ai_recorded=ai2, now=now, governor=Governor(settings, tmp_path / "s2"))
    gw2.marks_active = True
    mark_cycle(gw2, settings, led2, "m1", execute=True, now=settings.flatten_at + timedelta(minutes=1), governor=Governor(settings, tmp_path / "s2"))
    close2 = [e["payload"]["proposal"] for e in led2.by_kind("risk_decision") if e["payload"]["proposal"]["intent"].startswith("close")][0]
    assert close2["limit_price"] < 0


def test_stale_pending_open_order_is_canceled_next_cycle_and_limit_is_marketable(tmp_path, settings, fixture):
    from argus.engine import mark_cycle, open_observations

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    original = gw.submit_mleg

    def resting(legs, qty, limit_price, cid):  # broker accepts but does not fill
        o = original(legs, qty, limit_price, cid)
        o["status"] = "new"
        return o

    gw.submit_mleg = resting
    r = run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    prop = led.by_kind("risk_decision")[0]["payload"]["proposal"]
    cand = next(c for c in led.by_kind("candidates")[0]["payload"]["candidates"] if c["candidate_id"] == prop["candidate_id"])
    assert prop["limit_price"] == round(cand["entry_ask"], 2)  # marketable, not resting at mid
    assert open_observations(led)[r["snapshot_id"]]["executed"] is None  # not filled => not executed
    mark_cycle(gw, settings, led, "m1", execute=True, now=now + timedelta(minutes=20), governor=gov)
    rec = [e["payload"] for e in led.by_kind("reconciliation")]
    assert rec and rec[-1]["action"] == "canceled_stale_pending_order" and rec[-1]["broker_state"]["status"] == "canceled"
    assert open_observations(led)[r["snapshot_id"]]["executed"] is None
    assert all(e["payload"].get("submitted") is not True or e["payload"]["intent"] == "open" for e in led.by_kind("order_intent"))


def test_second_writer_does_not_break_the_hash_chain(tmp_path):
    # argus halt and argus mark append while the loop holds its own Ledger; a stale cached head hash would
    # corrupt the chain and make the run permanently unscorable.
    a = Ledger(tmp_path / "e.jsonl", "paper")
    b = Ledger(tmp_path / "e.jsonl", "paper")
    a.append("note", "r1", {"a": 1})
    b.append("halt", "r2", {"b": 2})
    a.append("note", "r3", {"a": 3})
    assert Ledger(tmp_path / "e.jsonl", "paper").verify() == (True, "ok")


def test_deep_itm_close_limit_is_clamped_inside_the_width(tmp_path, settings, fixture):
    # The aggressive close price is long_bid - short_ask, which for a deep-ITM credit spread can exceed the
    # width and be vetoed by close_limit_within_width forever - on exactly the position that must be closed.
    from argus.engine import mark_cycle, open_observations

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    r = run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    obs = open_observations(led)[r["snapshot_id"]]
    cand = obs["candidates"][obs["ai"]]
    long_sym, short_sym = cand["legs"][0]["symbol"], cand["legs"][1]["symbol"]

    gw.marks_active = True
    original = gw.latest_option_quotes

    def deep_itm(symbols):
        q = dict(original(symbols))
        if long_sym in q and short_sym in q:  # |long_bid - short_ask| > width
            q[long_sym] = {**q[long_sym], "bid": 2.00, "ask": 2.30}
            q[short_sym] = {**q[short_sym], "bid": 6.90, "ask": 7.20}
        return q

    gw.latest_option_quotes = deep_itm
    mark_cycle(gw, settings, led, "m1", execute=True, now=settings.flatten_at + timedelta(minutes=1), governor=gov)
    rd = [e["payload"] for e in led.by_kind("risk_decision") if e["payload"]["proposal"]["intent"].startswith("close")]
    assert rd, "no close was ever proposed"
    assert abs(rd[-1]["proposal"]["limit_price"]) < cand["width"]
    assert rd[-1]["approved"], [c for c in rd[-1]["checks"] if not c["ok"]]


def test_flatten_closes_even_when_the_quote_is_missing(tmp_path, settings, fixture):
    # A quote outage at the deadline must not skip the close and strand the position past it.
    from argus.engine import mark_cycle, open_observations

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    gw.marks_active = True
    gw.latest_option_quotes = lambda symbols: {}
    mark_cycle(gw, settings, led, "m1", execute=True, now=settings.flatten_at + timedelta(minutes=1), governor=gov)
    out = [e["payload"] for e in led.by_kind("outcome")]
    assert any(o["reason"] == "flatten_deadline_no_quote" and o["status"] == "closed" for o in out)
    intents = [e["payload"] for e in led.by_kind("order_intent") if e["payload"]["intent"].startswith("close")]
    assert intents and intents[-1]["submitted"] is True
    assert open_observations(led)[list(open_observations(led))[0]]["executed"]["closed"]


def test_unusable_quotes_never_mark_or_close_an_arm():
    # A crossed, offerless or stale quote yields a mark that can trip the profit target or stop loss and close an
    # arm permanently on a fabricated price, which then becomes the final scored value in score.json.
    from argus.engine import _usable_quote

    now = datetime(2026, 9, 2, 18, 0, tzinfo=timezone.utc)
    fresh = now.isoformat()
    assert _usable_quote({"bid": 1.0, "ask": 1.2, "quote_ts": fresh}, now)
    assert _usable_quote({"bid": 0.0, "ask": 0.05, "quote_ts": fresh}, now)  # far-OTM zero bid is legitimate
    assert not _usable_quote({"bid": 1.0, "ask": 0.0, "quote_ts": fresh}, now)  # no offer
    assert not _usable_quote({"bid": 1.5, "ask": 1.2, "quote_ts": fresh}, now)  # crossed
    assert not _usable_quote({"bid": 1.0, "ask": None, "quote_ts": fresh}, now)
    assert not _usable_quote(None, now)
    stale = (now - timedelta(minutes=90)).isoformat()
    assert not _usable_quote({"bid": 1.0, "ask": 1.2, "quote_ts": stale}, now)


def test_flatten_still_attempts_a_close_after_the_attempt_budget_is_spent(tmp_path, settings, fixture):
    # max_close_attempts is a lifetime counter, so attempts spent on a profit target hours earlier must not
    # leave the deadline with none, which would end the run holding the position.
    from argus.engine import mark_cycle, open_observations

    settings = replace(settings, max_close_attempts=0)
    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    run_cycle(gw, settings, led, "r1", execute=True, ai_recorded=fixture["ai"], now=now, governor=gov)
    gw.marks_active = True
    mark_cycle(gw, settings, led, "m1", execute=True, now=settings.flatten_at + timedelta(minutes=1), governor=gov)
    closes = [e["payload"] for e in led.by_kind("order_intent") if e["payload"]["intent"].startswith("close")]
    assert closes and closes[-1]["submitted"] is True
    assert open_observations(led)[list(open_observations(led))[0]]["executed"]["closed"]

def test_usd_totals_count_a_held_spread_once_but_n_stays_per_snapshot(tmp_path, settings, fixture):
    # candidate_id is salted with snapshot_id, so a sticky arm re-picks the same contracts every cycle. The
    # pre-registered unit is the snapshot, so n must count every cycle - but the dollar totals must not add the
    # same position up again and again and publish the result as money.
    from argus.engine import mark_cycle

    gw = FakeGateway(fixture)
    led = Ledger(tmp_path / "e.jsonl", "paper")
    gov = Governor(settings, tmp_path / "state")
    now = datetime.fromisoformat(fixture["now"])
    for i in range(3):  # same fixture, same packet => both arms re-pick the same legs
        run_cycle(gw, settings, led, f"r{i}", execute=False, ai_recorded=fixture["ai"],
                  now=now + timedelta(minutes=20 * i), governor=gov)
    gw.marks_active = True
    mark_cycle(gw, settings, led, "m1", execute=False, now=now + timedelta(minutes=70), governor=gov)

    sc = validation.score(led, settings)
    assert sc["n_observations"] == 3, "the pre-registered unit is the snapshot"
    # The quant re-picks the same contracts every cycle, so its dollar total counts them once...
    assert sc["distinct_spreads"]["quant"] == 1
    assert sc["quant_net_total"] == pytest.approx(sc["rows"][0]["quant_net"])
    # ...while abstentions have no legs and stay one observation per snapshot.
    assert sc["distinct_spreads"]["ai"] == 3
