"""Independent offline oracle. Install QuantLib==1.43 into web/node_modules/.quantlib-oracle."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "node_modules/.quantlib-oracle"))
import QuantLib as ql


def calculate(kind, spot, strike, days, rate, dividend, vol, grid, european=False):
    today = ql.Date(5, 9, 2026)
    ql.Settings.instance().evaluationDate = today
    dc = ql.Actual365Fixed()
    rate_quote, vol_quote = ql.SimpleQuote(rate), ql.SimpleQuote(vol)
    process = ql.BlackScholesMertonProcess(
        ql.QuoteHandle(ql.SimpleQuote(spot)),
        ql.YieldTermStructureHandle(ql.FlatForward(today, dividend, dc, ql.Continuous)),
        ql.YieldTermStructureHandle(ql.FlatForward(today, ql.QuoteHandle(rate_quote), dc, ql.Continuous)),
        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), ql.QuoteHandle(vol_quote), dc)),
    )
    exercise = ql.EuropeanExercise(today + days) if european else ql.AmericanExercise(today, today + days)
    option = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Put if kind == "put" else ql.Option.Call, strike), exercise)
    option.setPricingEngine(ql.AnalyticEuropeanEngine(process) if european else ql.FdBlackScholesVanillaEngine(process, grid, grid, 2, ql.FdmSchemeDesc.Douglas()))
    if european:
        return dict(price=option.NPV(), delta=option.delta(), gamma=option.gamma(), theta=option.theta() / 365, vega=option.vega() / 100, rho=option.rho() / 100)
    result = dict(price=option.NPV(), delta=option.delta(), gamma=option.gamma(), forwardTheta=option.theta() / 365)
    intrinsic = max(0, strike - spot if kind == "put" else spot - strike)
    assert result["price"] > intrinsic + .00001, "PDE theta oracle requires continuation"
    result["theta"] = (rate * result["price"] - (rate - dividend) * spot * result["delta"] - .5 * vol * vol * spot * spot * result["gamma"]) / 365
    for name, quote, value in [("vega", vol_quote, vol), ("rho", rate_quote, rate)]:
        quote.setValue(value + .0001)
        upper = option.NPV()
        quote.setValue(value - .0001)
        lower = option.NPV()
        quote.setValue(value)
        result[name] = (upper - lower) / .02
    return result


if __name__ == "__main__":
    assert ql.__version__ == "1.43"
    for kind, rate in (("call", .04), ("call", .04155), ("put", -.04), ("put", -.04155)):
        case = (kind, 100, 100, 365, rate, 0, .0013)
        print(json.dumps(dict(version=ql.__version__, inputs=case, engine="AnalyticEuropean", **calculate(*case, None, european=True))), flush=True)
    boundary_case = ("put", 95, 100, 7, .05, 0, .2)
    for case in [("put", 100, 100, 365, .05, .05, .25), ("put", 90, 100, 365, .05, 0, .2), ("put", 100, 100, 7, .05, 0, .2), ("call", 100, 100, 365, .03, .08, .25), ("put", 100, 100, 365, -.01, .02, .2), ("put", 100, 100, 1, .05, 0, .2), ("call", 100, 100, 1, .05, 0, .2), ("put", 100, 100, 730, .03, .08, .8), ("call", 90, 100, 30, .03, .08, .25), boundary_case]:
        results = []
        for grid in ((800, 1600, 3200) if case == boundary_case else (400, 800, 1600)):
            results.append(calculate(*case, grid))
            print(json.dumps(dict(version=ql.__version__, inputs=case, grid=grid, **results[-1])), flush=True)
        limits = dict(price=.001, delta=.00005, gamma=.000003, theta=.000003, vega=.00003, rho=.0002)
        if case == boundary_case:
            limits.update(price=.00001, rho=.000002)
        for key, limit in limits.items():
            assert abs(results[-1][key] - results[-2][key]) < limit, (case, key, "FD refinement unstable")
