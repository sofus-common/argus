"""Static evidence viewer. One HTML file, no external assets; every value comes from score, claims, or the ledger."""

from __future__ import annotations

import html
import json
from pathlib import Path

from .ledger import Ledger

CSS = """
:root{--bg:#f4f6f9;--card:#ffffff;--fg:#182130;--mut:#5c6979;--line:#dbe2ea;--ok:#1f9d5a;--bad:#d64545;--warn:#b7791f;--q:#2f6fd6;--a:#d9822b;--grid:#e6ebf1}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0e1218;--card:#151b24;--fg:#e3e8ef;--mut:#8b97a8;--line:#232c38;--ok:#4cd58a;--bad:#ff6b6b;--warn:#f2c14e;--q:#6ea8fe;--a:#f0a35a;--grid:#1c2430}}
:root[data-theme="dark"]{--bg:#0e1218;--card:#151b24;--fg:#e3e8ef;--mut:#8b97a8;--line:#232c38;--ok:#4cd58a;--bad:#ff6b6b;--warn:#f2c14e;--q:#6ea8fe;--a:#f0a35a;--grid:#1c2430}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "IBM Plex Sans",system-ui,Segoe UI,Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1140px;margin:0 auto;padding:28px 24px 48px}h1{font-size:26px;line-height:1.2;margin:0 0 6px;font-weight:600;letter-spacing:-.01em;text-wrap:balance}
h2{font-size:12px;margin:32px 0 10px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-weight:600}
.sub{color:var(--mut);margin:12px 0 20px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.card b{font-size:24px;line-height:1.15;font-weight:600}.card small{color:var(--mut);font-size:12px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line);background:var(--card)}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;vertical-align:top}
th{color:var(--mut);font-weight:500;font-size:12px;letter-spacing:.02em}td:has(> code:only-child){font-size:12px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:6px}
code{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:12px;color:var(--mut)}
.funnel{display:flex;gap:8px;flex-wrap:wrap}.funnel div{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 14px;min-width:132px;flex:1}
.funnel b{display:block;font-size:22px;font-weight:600}.funnel small{color:var(--mut);font-size:12px}
.legend{color:var(--mut);font-size:12px;margin-top:6px}.legend span{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 5px 0 12px;vertical-align:middle}
details{margin:8px 0}summary{cursor:pointer;color:var(--mut);font-size:13px}summary:focus-visible{outline:2px solid var(--q);outline-offset:2px}
p.lead{max-width:68ch;color:var(--mut);margin:6px 0 0;font-size:15px}a{color:var(--q)}
.chart{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px}svg text{fill:var(--mut);font-size:11px;font-family:"IBM Plex Mono",monospace}
@media (prefers-reduced-motion: no-preference){.card{transition:border-color .15s}.card:hover{border-color:var(--mut)}}
"""
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">'


def _fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.4f}" if abs(v) < 1 else f"{v:,.2f}"
    if isinstance(v, list):
        return "[" + ", ".join(_fmt(x) for x in v) + "]"
    return html.escape(str(v))


def _chart(rows: list[dict]) -> str:
    """Inline SVG: cumulative net P&L per arm across observations, in order."""
    if not rows:
        return '<div class="card"><small>No marked observations yet.</small></div>'
    q, a, cq, ca = [], [], 0.0, 0.0
    for r in rows:
        cq += r["quant_net"]
        ca += r["ai_net_after_inference"]
        q.append(cq)
        a.append(ca)
    W, H, L, B = 1080, 260, 56, 28
    lo, hi = min(0.0, *q, *a), max(0.0, *q, *a)
    if hi - lo < 1e-9:
        hi = lo + 1.0
    n = max(len(rows) - 1, 1)

    def x(i):
        return L + i * (W - L - 12) / n

    def y(v):
        return 12 + (hi - v) * (H - B - 12) / (hi - lo)

    def path(series, color):
        pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(series))
        return f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{pts}"/>'

    ticks = "".join(f'<text x="4" y="{y(v):.1f}">{v:,.0f}</text><line x1="{L-6}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="var(--grid)"/>'
                    for v in sorted({lo, 0.0, hi}))
    dots = "".join(f'<circle cx="{x(i):.1f}" cy="{y(q[i]):.1f}" r="2.5" fill="var(--q)"/>'
                   f'<circle cx="{x(i):.1f}" cy="{y(a[i]):.1f}" r="3" fill="{"var(--a)" if r["changed"] else "var(--mut)"}"><title>{html.escape(r["ts"][:16])} AI {a[i]:,.2f} / quant {q[i]:,.2f}{" (changed)" if r["changed"] else ""}</title></circle>'
                   for i, r in enumerate(rows))
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Cumulative net P&L, quant vs AI">{ticks}'
            f'{path(q, "var(--q)")}{path(a, "var(--a)")}{dots}'
            f'<text x="{L}" y="{H-6}">observation 1</text><text x="{W-90}" y="{H-6}">observation {len(rows)}</text></svg>'
            f'<div class="legend"><span style="background:var(--q)"></span>quant control (counterfactual, same marks) '
            f'<span style="background:var(--a)"></span>AI arm after inference cost &nbsp;·&nbsp; orange dots = AI ≠ quant</div>')


def _funnel(events: list[dict]) -> str:
    snaps = sum(1 for e in events if e["kind"] == "data_snapshot")
    cands = sum(e["payload"].get("count", 0) for e in events if e["kind"] == "candidates")
    quant_picks = sum(1 for e in events if e["kind"] == "baseline" and e["payload"]["choice"] != "abstain")
    ai_picks = sum(1 for e in events if e["kind"] == "ai_recommendation" and e["payload"]["choice"] != "abstain")
    opens = [e["payload"] for e in events if e["kind"] == "risk_decision" and e["payload"]["proposal"]["intent"] == "open"]
    approved = sum(1 for p in opens if p["approved"])
    vetoed = len(opens) - approved
    fills = sum(1 for e in events if e["kind"] == "order_result" and e["payload"].get("status") == "filled")
    closes = sum(1 for e in events if e["kind"] == "outcome" and e["payload"]["status"] == "closed" and e["payload"]["arm"] == "ai" and e["payload"]["candidate_id"] != "abstain")
    items = [("Snapshots", snaps), ("Candidates built", cands), ("Quant picks", quant_picks), ("AI picks", ai_picks),
             ("Governor approved", approved), ("Governor vetoed", vetoed), ("Alpaca fills", fills), ("AI positions closed", closes)]
    return '<div class="funnel">' + "".join(f"<div><small>{k}</small><b>{v}</b></div>" for k, v in items) + "</div>"


def _decisions(events: list[dict], rows: list[dict]) -> str:
    by_snap: dict[str, dict] = {}
    for e in events:
        p = e["payload"]
        sid = p.get("snapshot_id") or (p.get("proposal") or {}).get("snapshot_id")
        if not sid:
            continue
        d = by_snap.setdefault(sid, {})
        if e["kind"] == "baseline":
            d["quant"] = p
        elif e["kind"] == "ai_recommendation":
            d["ai"] = p
        elif e["kind"] == "risk_decision" and p["proposal"]["intent"] == "open":
            d["risk"] = p
        elif e["kind"] == "candidates":
            d["cands"] = {c["candidate_id"]: c for c in p["candidates"]}
    out = ["<div class=wrap><table><tr><th>ts</th><th>snapshot</th><th>quant → candidate</th><th>AI → candidate</th><th>AI reasons</th>"
           "<th>conf</th><th>governor</th><th>quant net</th><th>AI net</th><th>Δ</th></tr>"]
    score_by = {r["snapshot_id"]: r for r in rows}

    def label(d, cid):
        c = d.get("cands", {}).get(cid)
        return f"<code>{cid}</code>" if not c else f"{c['underlying']} {c['structure'].replace('_debit','')} {c['expiry'][5:]} ×{c['qty']} @{c['entry_mid']:.2f}"

    for sid, d in list(by_snap.items())[-60:]:
        q, a, r = d.get("quant", {}), d.get("ai", {}), d.get("risk")
        sc = score_by.get(sid, {})
        gov = "—" if not r else ('<span class=ok>approved</span>' if r["approved"] else '<span class=bad>vetoed: ' + html.escape(", ".join(r["failed"])) + "</span>")
        delta = sc.get("delta")
        out.append(f"<tr><td>{html.escape(q.get('ts', '') or '')}</td><td><code>{sid}</code></td>"
                   f"<td>{label(d, q.get('choice', '—'))}</td><td>{label(d, a.get('choice', '—'))}</td>"
                   f"<td>{html.escape(', '.join(a.get('reason_codes', [])[:4]))}</td><td>{_fmt(a.get('confidence'))}</td><td>{gov}</td>"
                   f"<td>{_fmt(sc.get('quant_net'))}</td><td>{_fmt(sc.get('ai_net_after_inference'))}</td>"
                   f"<td class=\"{'ok' if (delta or 0) > 0 else ('bad' if (delta or 0) < 0 else '')}\">{_fmt(delta)}</td></tr>")
    out.append("</table></div>")
    return "".join(out)


def render(score: dict, manifest: dict, ledger: Ledger, title: str = "ARGUS") -> str:
    mode = score["run_mode"]
    banner = {"replay": ("warn", "REPLAY — seeded fixture, excluded from scored aggregates"),
              "research": ("warn", "RESEARCH — not paper-executed"),
              "paper": ("ok", "PAPER — dedicated $100k Alpaca paper account")}[mode]
    diff = score["ai_minus_quant_usd"]
    cls = "ok" if (diff or 0) > 0 else ("bad" if (diff or 0) < 0 else "")
    events = list(ledger.events())
    ok, msg = ledger.verify()
    rows = score["rows"]
    ts_by_snap = {e["payload"]["snapshot_id"]: e["payload"]["ts"] for e in events if e["kind"] == "data_snapshot"}
    for e in events:
        if e["kind"] == "baseline":
            e["payload"]["ts"] = ts_by_snap.get(e["payload"]["snapshot_id"], e["ts"])[:16]
    last = {}
    for e in events:
        if e["kind"] in ("data_snapshot", "baseline", "ai_recommendation", "risk_decision", "order_result", "reconciliation"):
            last[e["kind"]] = e
    recon = next((e["payload"] for e in reversed(events) if e["kind"] == "reconciliation" and e["payload"].get("source") == "alpaca-cli"), None)
    cards = [
        ("AI minus quant, net of inference", f"${_fmt(diff)}", cls, "USD, after modelled costs, same marks"),
        ("Paired observations", _fmt(score["n_observations"]), "", f"{score['n_unmarked']} not yet marked"),
        ("Changed decisions", _fmt(score["changed_decisions"]), "", f"Δ on changed only: {_fmt(score['changed_only']['delta_sum'])}"),
        ("AI coverage", _fmt(score["coverage"]), "", f"{score['ai_abstentions']} AI / {score['quant_abstentions']} quant abstentions"),
        ("Mean paired Δ / risk budget", _fmt(score["paired_delta_mean"]), "", "block-bootstrap CI95 " + _fmt(score["paired_delta_ci95"])),
        ("Quant net", f"${_fmt(score['quant_net_total'])}", "", f"max drawdown {_fmt(score['max_drawdown_quant'])}"),
        ("AI net", f"${_fmt(score['ai_net_total'])}", "", f"max drawdown {_fmt(score['max_drawdown_ai'])}"),
        ("Inference cost", f"${_fmt(score['inference_cost_total_usd'])}", "", score["model"]),
        ("Evidence state", score["evidence_state"], "warn", f"n ≥ {score['min_observations_for_exploratory']} needed for EXPLORATORY; SUPPORTED disabled"),
    ]

    def card(label, val, c, sub):
        return f'<div class="card"><small>{html.escape(label)}</small><b class="{c}">{val}</b><small>{html.escape(str(sub))}</small></div>'

    parts = [f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
             f"<title>{html.escape(title)}</title>{FONTS}<style>{CSS}</style></head><body><main>",
             "<h1>ARGUS — does the AI earn its inference bill?</h1>",
             '<p class=lead>Every cycle a deterministic quant picks a defined-risk SPY/QQQ debit vertical from a frozen candidate set; '
             'a bounded LLM picks from the <em>same</em> set or abstains. The AI\'s pick is traded on Alpaca paper; both picks are marked '
             'from the same quotes; the paired difference after transaction and inference costs is the product — positive, zero, or negative.</p>',
             f'<div class="sub"><span class="badge {banner[0]}">{banner[1]}</span> &nbsp; trial <code>{html.escape(score["trial_id"])}</code>'
             f' &nbsp; ledger chain <span class="{"ok" if ok else "bad"}">{html.escape(msg)}</span> · {len(events)} events'
             + (f' &nbsp; broker reconciliation (Alpaca CLI) <span class="{"ok" if recon.get("consistent") else "bad"}">{"consistent" if recon.get("consistent") else "mismatch" if recon.get("action") == "compared" else "skipped"}</span>' if recon else "")
             + "</div>",
             "<h2>Scoreboard</h2><div class=grid>" + "".join(card(*c) for c in cards) + "</div>",
             "<h2>Cumulative net P&amp;L, quant vs AI (same observations, same marks)</h2><div class=chart>" + _chart(rows) + "</div>",
             "<h2>Candidate funnel</h2>" + _funnel(events)]
    if last.get("baseline"):
        b, a = last["baseline"]["payload"], last.get("ai_recommendation", {}).get("payload", {})
        r = last.get("risk_decision", {}).get("payload", {})
        parts.append("<h2>Last decision</h2><div class=grid>"
                     + card("Snapshot", b["snapshot_id"], "", last["data_snapshot"]["payload"]["ts"][:19] + " · feed " + last["data_snapshot"]["payload"]["feed"])
                     + card("Quant chose", b["choice"], "", ", ".join(b["reason_codes"][:3]))
                     + card("AI chose", a.get("choice", "—"), "", f"conf {_fmt(a.get('confidence'))} · " + ", ".join(a.get("reason_codes", [])[:3]))
                     + card("Governor", "APPROVED" if r.get("approved") else ("VETOED" if r else "no proposal"),
                            "ok" if r.get("approved") else "bad", ", ".join(r.get("failed", [])) or f"{len(r.get('checks', []))} checks passed")
                     + card("Alpaca", last.get("order_result", {}).get("payload", {}).get("status", "no order"), "",
                            last.get("order_result", {}).get("payload", {}).get("client_order_id", ""))
                     + "</div>")
        if r:
            parts.append("<details><summary>Governor checks for the last proposal</summary><div class=wrap><table><tr><th>check</th><th>ok</th><th>detail</th></tr>"
                         + "".join(f"<tr><td>{html.escape(c['check'])}</td><td class=\"{'ok' if c['ok'] else 'bad'}\">{'✓' if c['ok'] else '✗'}</td><td><code>{html.escape(str(c['detail']))}</code></td></tr>" for c in r.get("checks", []))
                         + "</table></div></details>")
    parts.append("<h2>Decision ledger — every paired observation</h2>" + _decisions(events, rows))
    if recon and recon.get("action") == "compared":
        parts.append("<h2>Broker reconciliation (official Alpaca CLI, independent of the SDK write path)</h2><div class=wrap><table><tr><th>symbol</th><th>ledger qty</th><th>broker qty</th></tr>"
                     + "".join(f"<tr><td><code>{html.escape(s)}</code></td><td>{recon['ledger_open_legs'].get(s, 0)}</td><td>{recon['broker_option_positions'].get(s, 0)}</td></tr>"
                               for s in sorted(set(recon["ledger_open_legs"]) | set(recon["broker_option_positions"])))
                     + "</table></div>")
    parts.append("<h2>Claims — what may be said, and how to reproduce it</h2><div class=wrap><table><tr><th>claim</th><th>value</th><th>status</th><th>evidence</th><th>source sha256</th><th>reproduce</th></tr>")
    for c in manifest["claims"]:
        parts.append(f"<tr><td>{html.escape(c['label'])}</td><td>{_fmt(c['displayed_value'])}</td><td>{c['status']}</td><td>{c['evidence_state']}</td>"
                     f"<td><code>{c['source_sha256'][:16]}…</code></td><td><code>{html.escape(c['reproduction_command'])}</code></td></tr>")
    parts.append("</table></div>")
    parts.append("<h2>Recent events (hash-chained)</h2><div class=wrap><table><tr><th>ts</th><th>kind</th><th>run</th><th>hash</th><th>previous</th></tr>")
    for e in events[-30:]:
        parts.append(f"<tr><td>{html.escape(e['ts'][:19])}</td><td>{e['kind']}</td><td><code>{html.escape(e['run_id'])}</code></td><td><code>{e['event_hash'][:16]}…</code></td><td><code>{e['previous_event_hash'][:16]}…</code></td></tr>")
    parts.append("</table></div>")
    parts.append('<p class=lead>Reproduce: <code>pip install -e . && argus replay</code> (credential-free) or <code>argus score --ledger runs/paper/events.jsonl</code>. '
                 'Source: <a href="https://github.com/wibo/argus" style="color:var(--q)">github.com/wibo/argus</a>. Paper trading only; not investment advice.</p>')
    parts.append(f'<script type="application/json" id="score">{json.dumps({k: v for k, v in score.items() if k != "rows"})}</script></main></body></html>')
    return "\n".join(parts)


def export(path: Path, score: dict, manifest: dict, ledger: Ledger) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(score, manifest, ledger), encoding="utf-8")
