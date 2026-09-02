"""Alpaca gateway: the only code that talks to the broker. Paper mode only.

The real gateway wraps official ``alpaca-py``. ``FakeGateway`` serves the same
interface from a fixture dict for tests and credential-free replay.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Protocol

OCC_RE = re.compile(r"^(?P<root>[A-Z]{1,6})(?P<ymd>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")


def parse_occ(symbol: str) -> dict:
    m = OCC_RE.match(symbol)
    if not m:
        raise ValueError(f"not an OCC option symbol: {symbol}")
    return {
        "root": m["root"],
        "expiry": f"20{m['ymd'][0:2]}-{m['ymd'][2:4]}-{m['ymd'][4:6]}",
        "type": "call" if m["cp"] == "C" else "put",
        "strike": int(m["strike"]) / 1000.0,
    }


class Gateway(Protocol):
    mode: str

    def account(self) -> dict: ...
    def daily_closes(self, symbol: str, n: int) -> list[float]: ...
    def latest_stock_price(self, symbol: str) -> float: ...
    def option_chain(self, symbol: str, exp_gte: date, exp_lte: date, strike_gte: float, strike_lte: float) -> dict: ...
    def latest_option_quotes(self, symbols: list[str]) -> dict: ...
    def submit_mleg(self, legs: list[dict], qty: int, limit_price: float, client_order_id: str) -> dict: ...
    def order_by_client_id(self, client_order_id: str) -> dict | None: ...
    def positions(self) -> list[dict]: ...


class AlpacaGateway:
    """Official SDK wrapper. ``paper=True`` is hardcoded; there is no live path."""

    mode = "paper"

    def __init__(self, api_key: str, secret_key: str, options_feed: str = "indicative"):
        from alpaca.trading.client import TradingClient
        from alpaca.data.historical.option import OptionHistoricalDataClient
        from alpaca.data.historical.stock import StockHistoricalDataClient

        if not api_key or not secret_key:
            raise RuntimeError("Alpaca credentials missing")
        self.trading = TradingClient(api_key, secret_key, paper=True)
        self.options = OptionHistoricalDataClient(api_key, secret_key)
        self.stocks = StockHistoricalDataClient(api_key, secret_key)
        self.options_feed = options_feed

    def account(self) -> dict:
        a = self.trading.get_account()
        return {
            "account_number": a.account_number,
            "status": str(a.status),
            "equity": float(a.equity),
            "cash": float(a.cash),
            "options_buying_power": float(a.options_buying_power or 0),
            "options_trading_level": int(a.options_trading_level or 0),
            "trading_blocked": bool(a.trading_blocked),
            "paper": True,
        }

    def daily_closes(self, symbol: str, n: int) -> list[float]:
        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame

        start = datetime.now(timezone.utc) - timedelta(days=int(n * 1.8) + 10)
        bars = self.stocks.get_stock_bars(StockBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Day, start=start))
        rows = bars.data.get(symbol, []) if hasattr(bars, "data") else bars[symbol]
        closes = [float(b.close) for b in rows]
        return closes[-n:]

    def latest_stock_price(self, symbol: str) -> float:
        from alpaca.data.requests import StockLatestTradeRequest

        t = self.stocks.get_stock_latest_trade(StockLatestTradeRequest(symbol_or_symbols=symbol))
        return float(t[symbol].price)

    def option_chain(self, symbol: str, exp_gte: date, exp_lte: date, strike_gte: float, strike_lte: float) -> dict:
        from alpaca.data.requests import OptionChainRequest
        from alpaca.data.enums import OptionsFeed

        feed = OptionsFeed.INDICATIVE if self.options_feed == "indicative" else OptionsFeed.OPRA
        snaps = self.options.get_option_chain(OptionChainRequest(
            underlying_symbol=symbol, feed=feed,
            expiration_date_gte=exp_gte, expiration_date_lte=exp_lte,
            strike_price_gte=strike_gte, strike_price_lte=strike_lte,
        ))
        out = {}
        for occ, s in snaps.items():
            q = s.latest_quote
            if q is None or q.bid_price is None or q.ask_price is None:
                continue
            meta = parse_occ(occ)
            out[occ] = {
                "bid": float(q.bid_price), "ask": float(q.ask_price),
                "iv": float(s.implied_volatility) if s.implied_volatility is not None else None,
                "delta": float(s.greeks.delta) if s.greeks is not None and s.greeks.delta is not None else None,
                "quote_ts": q.timestamp.isoformat() if q.timestamp else None,
                **meta,
            }
        return out

    def latest_option_quotes(self, symbols: list[str]) -> dict:
        from alpaca.data.requests import OptionLatestQuoteRequest
        from alpaca.data.enums import OptionsFeed

        if not symbols:
            return {}
        feed = OptionsFeed.INDICATIVE if self.options_feed == "indicative" else OptionsFeed.OPRA
        quotes = self.options.get_option_latest_quote(OptionLatestQuoteRequest(symbol_or_symbols=symbols, feed=feed))
        return {occ: {"bid": float(q.bid_price), "ask": float(q.ask_price), "quote_ts": q.timestamp.isoformat() if q.timestamp else None}
                for occ, q in quotes.items()}

    def submit_mleg(self, legs: list[dict], qty: int, limit_price: float, client_order_id: str) -> dict:
        from alpaca.trading.requests import LimitOrderRequest, OptionLegRequest
        from alpaca.trading.enums import OrderClass, OrderSide, PositionIntent, TimeInForce

        side_map = {"buy": OrderSide.BUY, "sell": OrderSide.SELL}
        intent_map = {
            "buy_to_open": PositionIntent.BUY_TO_OPEN, "sell_to_open": PositionIntent.SELL_TO_OPEN,
            "buy_to_close": PositionIntent.BUY_TO_CLOSE, "sell_to_close": PositionIntent.SELL_TO_CLOSE,
        }
        req = LimitOrderRequest(
            qty=qty, limit_price=round(limit_price, 2), order_class=OrderClass.MLEG,
            time_in_force=TimeInForce.DAY, client_order_id=client_order_id,
            legs=[OptionLegRequest(symbol=l["symbol"], ratio_qty=1, side=side_map[l["side"]],
                                   position_intent=intent_map[l["position_intent"]]) for l in legs],
        )
        o = self.trading.submit_order(req)
        return _order_dict(o)

    def order_by_client_id(self, client_order_id: str) -> dict | None:
        try:
            return _order_dict(self.trading.get_order_by_client_id(client_order_id))
        except Exception:  # noqa: BLE001 - SDK raises APIError for unknown ids
            return None

    def positions(self) -> list[dict]:
        return [{"symbol": p.symbol, "qty": float(p.qty), "asset_class": str(p.asset_class),
                 "avg_entry_price": float(p.avg_entry_price), "market_value": float(p.market_value or 0)}
                for p in self.trading.get_all_positions()]


def _order_dict(o) -> dict:
    return {
        "id": str(o.id), "client_order_id": o.client_order_id, "status": str(o.status.value if hasattr(o.status, "value") else o.status),
        "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None,
        "filled_at": o.filled_at.isoformat() if o.filled_at else None,
        "filled_avg_price": float(o.filled_avg_price) if o.filled_avg_price else None,
        "qty": float(o.qty) if o.qty else None, "filled_qty": float(o.filled_qty) if o.filled_qty else None,
        "legs": [{"symbol": l.symbol, "side": str(l.side.value if hasattr(l.side, "value") else l.side),
                  "filled_avg_price": float(l.filled_avg_price) if l.filled_avg_price else None} for l in (o.legs or [])],
    }


class FakeGateway:
    """Fixture-backed gateway with identical interface. Fills every order at its limit."""

    mode = "fake"

    def __init__(self, fixture: dict):
        self.fixture = fixture
        self.orders: dict[str, dict] = {}
        self._positions: list[dict] = list(fixture.get("positions", []))
        self.marks_active = False  # replay flips this after the decision so later quotes come from fixture["marks"]

    def account(self) -> dict:
        return dict(self.fixture["account"])

    def daily_closes(self, symbol: str, n: int) -> list[float]:
        return list(self.fixture["closes"][symbol])[-n:]

    def latest_stock_price(self, symbol: str) -> float:
        return float(self.fixture["spot"][symbol])

    def option_chain(self, symbol: str, exp_gte: date, exp_lte: date, strike_gte: float, strike_lte: float) -> dict:
        out = {}
        for occ, row in self.fixture["chains"][symbol].items():
            exp = date.fromisoformat(row["expiry"])
            if exp_gte <= exp <= exp_lte and strike_gte <= row["strike"] <= strike_lte:
                out[occ] = dict(row)
        return out

    def latest_option_quotes(self, symbols: list[str]) -> dict:
        marks = self.fixture.get("marks", {}) if self.marks_active else {}
        out = {}
        for s in symbols:
            if s in marks:
                out[s] = dict(marks[s])
            else:
                for chain in self.fixture["chains"].values():
                    if s in chain:
                        out[s] = {"bid": chain[s]["bid"], "ask": chain[s]["ask"], "quote_ts": chain[s].get("quote_ts")}
        return out

    def submit_mleg(self, legs: list[dict], qty: int, limit_price: float, client_order_id: str) -> dict:
        if client_order_id in self.orders:
            raise RuntimeError("duplicate client_order_id")
        order = {
            "id": f"fake-{len(self.orders) + 1}", "client_order_id": client_order_id, "status": "filled",
            "submitted_at": datetime.now(timezone.utc).isoformat(), "filled_at": datetime.now(timezone.utc).isoformat(),
            "filled_avg_price": limit_price, "qty": qty, "filled_qty": qty,
            "legs": [{"symbol": l["symbol"], "side": l["side"], "filled_avg_price": None} for l in legs],
        }
        self.orders[client_order_id] = order
        for l in legs:  # keep a crude position book so duplicate-leg gates can be tested
            if l["position_intent"].endswith("to_open"):
                self._positions.append({"symbol": l["symbol"], "qty": qty if l["side"] == "buy" else -qty, "asset_class": "us_option",
                                        "avg_entry_price": limit_price, "market_value": 0.0})
            else:
                self._positions = [p for p in self._positions if p["symbol"] != l["symbol"]]
        return order

    def order_by_client_id(self, client_order_id: str) -> dict | None:
        return self.orders.get(client_order_id)

    def positions(self) -> list[dict]:
        return list(self._positions)
