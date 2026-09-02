"""Environment-only settings. No config files, no defaults that touch live trading."""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value == "" else value


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, no export, no quotes handling beyond strip."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    alpaca_api_key: str
    alpaca_secret_key: str
    openrouter_api_key: str
    data_dir: Path
    trial_id: str
    model: str
    underlyings: tuple[str, ...]
    dte_min: int
    dte_max: int
    spread_width: float
    target_delta: float
    max_spread_pct: float
    wedge_min: float
    trend_min: float
    risk_cap_pct: float
    start_equity: float
    profit_target: float
    stop_loss: float
    flatten_at: datetime
    options_feed: str
    commission_per_contract: float
    slippage_frac: float
    daily_ai_budget_usd: float
    prompt_version: str = "p1"
    schema_version: str = "s1"
    temperature: float = 0.0
    max_tokens: int = 400
    min_observations: int = 30
    auth_ttl_seconds: int = 60
    aggregate_risk_cap_pct: float = 0.05
    no_new_positions_minutes_before_flatten: int = 60
    max_close_attempts: int = 6
    target_short_delta: float = 0.30
    credit_wedge_max: float = -0.01
    allowed_structures: tuple[str, ...] = field(default=("bull_call_debit", "bear_put_debit", "bull_put_credit", "bear_call_credit"))

    @property
    def has_alpaca(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_secret_key)

    @property
    def has_openrouter(self) -> bool:
        return bool(self.openrouter_api_key)

    def contract(self) -> dict:
        """The experiment contract: everything that, if changed, creates a new trial."""
        d = asdict(self)
        for secret in ("alpaca_api_key", "alpaca_secret_key", "openrouter_api_key"):
            d.pop(secret)
        d["data_dir"] = str(self.data_dir)
        d["flatten_at"] = self.flatten_at.isoformat()
        return d


def load_settings(dotenv: Path | None = Path(".env")) -> Settings:
    if dotenv is not None:
        _load_dotenv(dotenv)
    flatten = datetime.fromisoformat(_env("ARGUS_FLATTEN_AT", "2026-09-03T19:30:00+00:00").replace("Z", "+00:00"))
    if flatten.tzinfo is None:
        flatten = flatten.replace(tzinfo=timezone.utc)
    return Settings(
        alpaca_api_key=_env("ALPACA_API_KEY", ""),
        alpaca_secret_key=_env("ALPACA_SECRET_KEY", ""),
        openrouter_api_key=_env("OPENROUTER_API_KEY", ""),
        data_dir=Path(_env("ARGUS_DATA_DIR", "runs")),
        trial_id=_env("ARGUS_TRIAL_ID", "same_information_v1"),
        model=_env("ARGUS_MODEL", "google/gemini-2.5-flash-lite"),
        underlyings=tuple(s.strip().upper() for s in _env("ARGUS_UNDERLYINGS", "SPY,QQQ").split(",") if s.strip()),
        dte_min=int(_env("ARGUS_DTE_MIN", "7")),
        dte_max=int(_env("ARGUS_DTE_MAX", "21")),
        spread_width=float(_env("ARGUS_SPREAD_WIDTH", "5")),
        target_delta=float(_env("ARGUS_TARGET_DELTA", "0.40")),
        max_spread_pct=float(_env("ARGUS_MAX_SPREAD_PCT", "0.08")),
        wedge_min=float(_env("ARGUS_WEDGE_MIN", "-0.10")),
        trend_min=float(_env("ARGUS_TREND_MIN", "0.005")),
        risk_cap_pct=float(_env("ARGUS_RISK_CAP_PCT", "0.01")),
        start_equity=float(_env("ARGUS_START_EQUITY", "100000")),
        profit_target=float(_env("ARGUS_PROFIT_TARGET", "0.5")),
        stop_loss=float(_env("ARGUS_STOP_LOSS", "0.5")),
        flatten_at=flatten,
        options_feed=_env("ARGUS_OPTIONS_FEED", "indicative"),
        commission_per_contract=float(_env("ARGUS_COMMISSION_PER_CONTRACT", "0.05")),
        slippage_frac=float(_env("ARGUS_SLIPPAGE_FRAC", "0.25")),
        daily_ai_budget_usd=float(_env("ARGUS_DAILY_AI_BUDGET_USD", "2.0")),
        aggregate_risk_cap_pct=float(_env("ARGUS_AGGREGATE_RISK_CAP_PCT", "0.05")),
        no_new_positions_minutes_before_flatten=int(_env("ARGUS_NO_NEW_MINUTES_BEFORE_FLATTEN", "60")),
        max_close_attempts=int(_env("ARGUS_MAX_CLOSE_ATTEMPTS", "6")),
        target_short_delta=float(_env("ARGUS_TARGET_SHORT_DELTA", "0.30")),
        credit_wedge_max=float(_env("ARGUS_CREDIT_WEDGE_MAX", "-0.01")),
        allowed_structures=tuple(x.strip() for x in _env("ARGUS_STRUCTURES", "bull_call_debit,bear_put_debit,bull_put_credit,bear_call_credit").split(",") if x.strip()),
    )
