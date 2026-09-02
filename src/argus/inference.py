"""Bounded OpenRouter adapter: one strict-schema selection call per cycle.

The model sees the same numeric packet as the quant control. It returns a
candidate_id or "abstain", a confidence, and reason codes. It cannot invent
or alter a trade: any choice outside the packet's candidate IDs is recorded
as a refusal and treated as abstention.
"""

from __future__ import annotations

import json
import time

import requests

from .ledger import canonical, sha256

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are the AI arm of a paired options experiment. You receive a frozen numeric decision packet: "
    "defined-risk vertical spreads on liquid ETFs (kind 'debit' = you pay entry_mid > 0 and profit if the spread "
    "widens toward width; kind 'credit' = you receive -entry_mid > 0 and profit if the spread decays toward zero; "
    "max_loss_total is the fixed worst case). Features per candidate: anchor_delta, iv (annualized implied vol of "
    "the anchor leg), rv20 (20-day realized vol), wedge = rv20 - iv (negative means options are rich relative to "
    "realized moves, which favours selling premium; positive favours buying), iv_term_slope (far minus near ATM IV), "
    "spread_pct (quoted bid-ask of the spread as a fraction of |mid|; execution cost), ret20 (20-day underlying "
    "return), dte. Exits: profit target and stop loss as fractions of |entry_mid|, "
    "or forced flatten at flatten_at. Choose exactly one candidate_id from the packet, or 'abstain' if no "
    "candidate is worth its cost. You cannot change strikes, expiry, quantity, or structure. "
    "Respond only with the JSON object required by the schema."
)

RESPONSE_SCHEMA = {
    "name": "argus_selection",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "choice": {"type": "string", "description": "candidate_id from the packet, or 'abstain'"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason_codes": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        },
        "required": ["choice", "confidence", "reason_codes"],
        "additionalProperties": False,
    },
}


def build_request(packet: dict, settings) -> dict:
    return {
        "model": settings.model,
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": canonical(packet)},
        ],
        "response_format": {"type": "json_schema", "json_schema": RESPONSE_SCHEMA},
        "provider": {"allow_fallbacks": False, "data_collection": "deny", "zdr": True, "require_parameters": True},
        "usage": {"include": True},
    }


def bound_choice(raw: dict, packet: dict) -> tuple[str, list[str]]:
    """Enforce that the AI can only pick an existing candidate or abstain."""
    ids = {c["candidate_id"] for c in packet["candidates"]}
    choice = str(raw.get("choice", "abstain"))
    if choice == "abstain":
        return "abstain", []
    if choice in ids:
        return choice, []
    return "abstain", [f"refused_out_of_set_choice:{choice[:24]}"]


def select(packet: dict, settings, recorded: dict | None = None, session=None) -> dict:
    """Return the AI arm's choice record. ``recorded`` replays a stored raw response."""
    base = {
        "arm": "ai", "model": settings.model, "prompt_version": settings.prompt_version,
        "schema_version": settings.schema_version, "temperature": settings.temperature,
        "packet_hash": packet["packet_hash"], "trial_id": settings.trial_id,
    }
    if recorded is not None:
        raw = recorded.get("parsed") or {}
        choice, notes = bound_choice(raw, packet)
        return {**base, "choice": choice, "confidence": raw.get("confidence"),
                "reason_codes": list(raw.get("reason_codes", [])) + notes,
                "provider": recorded.get("provider"), "tokens": recorded.get("tokens"),
                "cost_usd": recorded.get("cost_usd", 0.0), "latency_ms": recorded.get("latency_ms"),
                "source": "recorded", "raw_response_sha256": recorded.get("raw_response_sha256")}
    if not settings.has_openrouter:
        return {**base, "choice": "abstain", "confidence": None, "reason_codes": ["no_openrouter_credentials"],
                "provider": None, "tokens": None, "cost_usd": 0.0, "latency_ms": None, "source": "unavailable"}

    body = build_request(packet, settings)
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}", "Content-Type": "application/json",
               "HTTP-Referer": "https://github.com/wibo/argus", "X-Title": "ARGUS"}
    t0 = time.perf_counter()
    http = session or requests
    try:
        resp = http.post(OPENROUTER_URL, headers=headers, data=json.dumps(body), timeout=60)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        raw = json.loads(content)
        usage = data.get("usage", {})
        choice, notes = bound_choice(raw, packet)
        return {**base, "choice": choice, "confidence": raw.get("confidence"),
                "reason_codes": list(raw.get("reason_codes", []))[:5] + notes,
                "provider": data.get("provider"), "tokens": {"prompt": usage.get("prompt_tokens"), "completion": usage.get("completion_tokens")},
                "cost_usd": float(usage.get("cost") or 0.0), "latency_ms": latency_ms, "source": "live",
                "raw_response_sha256": sha256(content), "recorded": {"parsed": raw, "provider": data.get("provider"),
                                                                     "tokens": {"prompt": usage.get("prompt_tokens"), "completion": usage.get("completion_tokens")},
                                                                     "cost_usd": float(usage.get("cost") or 0.0), "latency_ms": latency_ms,
                                                                     "raw_response_sha256": sha256(content)}}
    except Exception as exc:  # noqa: BLE001 - any failure is a recorded abstention, never a retry with a different model
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {**base, "choice": "abstain", "confidence": None, "reason_codes": [f"inference_error:{type(exc).__name__}"],
                "provider": None, "tokens": None, "cost_usd": 0.0, "latency_ms": latency_ms, "source": "error"}
