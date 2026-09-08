// Canonical American CRR valuation with continuous dividend yield; no assignment cashflows.
function lattice(type: "call" | "put", spot: number, strike: number, years: number, rate: number, yieldRate: number, volatility: number, steps: number) {
  if (![spot, strike, years, rate, yieldRate, volatility].every(Number.isFinite) || spot < 0 || strike <= 0 || years < 0 || volatility <= 0 || !Number.isInteger(steps) || steps < 2 || steps > 4096 || (type !== "call" && type !== "put")) throw new Error("Invalid American pricing inputs");
  const sign = type === "call" ? 1 : -1;
  if (years === 0) return { price: Math.max(0, sign * (spot - strike)), delta: spot === strike ? sign / 2 : sign * (spot - strike) > 0 ? sign : 0, gamma: 0, immediate: false };
  if (spot === 0) {
    const price = type === "call" ? 0 : strike * Math.exp(Math.max(0, -rate * years));
    if (!Number.isFinite(price)) throw new Error("American lattice outside numerical domain");
    const delta = type === "call" ? 0 : rate > 0 ? -1 : rate < 0 ? -Math.exp(-yieldRate * years) : -Math.min(1, Math.exp(-yieldRate * years));
    return { price, delta, gamma: 0, immediate: type === "put" && rate > 0 };
  }
  const dt = years / steps, dx = volatility * Math.sqrt(dt);
  const probability = Math.expm1((rate - yieldRate) * dt + dx) / Math.expm1(2 * dx);
  const discount = Math.exp(-rate * dt), up = Math.exp(dx), ratio = up * up;
  let low = spot * Math.exp(-steps * dx);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isFinite(discount) || low <= 0 || !Number.isFinite(spot * Math.exp(steps * dx))) throw new Error("American lattice outside numerical domain");
  const values = new Float64Array(steps + 1);
  let nodeSpot = low;
  for (let j = 0; j <= steps; j++, nodeSpot *= ratio) values[j] = Math.max(0, sign * (nodeSpot - strike));
  let delta = 0, gamma = 0;
  let immediate = false;
  const secondLevelGamma = () => ((values[2] - values[1]) / (spot * (ratio - 1)) - (values[1] - values[0]) / (spot * (1 - 1 / ratio))) / (spot * (ratio - 1 / ratio) / 2);
  if (steps === 2) gamma = secondLevelGamma();
  for (let i = steps - 1; i >= 0; i--) {
    if (i === 0) immediate = sign * (spot - strike) > discount * ((1 - probability) * values[0] + probability * values[1]);
    low *= up;
    nodeSpot = low;
    for (let j = 0; j <= i; j++, nodeSpot *= ratio) values[j] = Math.max(0, sign * (nodeSpot - strike), discount * ((1 - probability) * values[j] + probability * values[j + 1]));
    if (i === 2) gamma = secondLevelGamma();
    if (i === 1) delta = (values[1] - values[0]) / (spot * (up - 1 / up));
  }
  if (!Number.isFinite(values[0])) throw new Error("American lattice outside numerical domain");
  return { price: Math.max(values[0], sign * (spot - strike)), delta: immediate ? sign : delta, gamma: immediate ? 0 : gamma, immediate };
}

export function americanPrice(type: "call" | "put", spot: number, strike: number, years: number, rate: number, yieldRate: number, volatility: number, steps: number): number {
  return lattice(type, spot, strike, years, rate, yieldRate, volatility, steps).price;
}

type Greek = "delta" | "gamma" | "theta" | "vega" | "rho";
type GreekValues = Omit<ReturnType<typeof lattice>, "immediate"> & { theta: number; vega: number; rho: number };

export function americanGreeks(type: "call" | "put", spot: number, strike: number, years: number, rate: number, yieldRate: number, volatility: number, steps: number): GreekValues;
export function americanGreeks(type: "call" | "put", spot: number, strike: number, years: number, rate: number, yieldRate: number, volatility: number, steps: number, metric: Greek): number;
export function americanGreeks(type: "call" | "put", spot: number, strike: number, years: number, rate: number, yieldRate: number, volatility: number, steps: number, metric?: Greek): GreekValues | number {
  if (metric !== undefined && !["delta", "gamma", "theta", "vega", "rho"].includes(metric)) throw new Error("Invalid American sensitivity");
  const { immediate, ...result } = lattice(type, spot, strike, years, rate, yieldRate, volatility, steps);
  if (years === 0 || immediate) {
    const values = { ...result, theta: 0, vega: 0, rho: 0 };
    return metric ? values[metric] : values;
  }
  if (spot === 0) {
    if (type === "put" && rate === 0) throw new Error("American put rho is undefined at zero spot and zero rate");
    const theta = type === "put" ? rate * result.price / 365 : 0;
    const rho = type === "put" ? -years * result.price / 100 : 0;
    if (![result.delta, theta, rho].every(Number.isFinite)) throw new Error("American sensitivities outside numerical domain");
    const values = { ...result, theta, vega: 0, rho };
    return metric ? values[metric] : values;
  }
  const stepScale = Math.sqrt(years / steps), carry = Math.abs(rate - yieldRate);
  const volBump = Math.min(.0001, volatility / 2, (volatility - carry * stepScale) / 2);
  const rateBump = Math.min(.0001, (volatility / stepScale - carry) / 2);
  if ((!metric || metric === "vega") && !(volBump > 0) || (!metric || metric === "rho") && !(rateBump > 0)) throw new Error("American sensitivities outside numerical domain");
  const price = (t: number, r: number, v: number) => americanPrice(type, spot, strike, t, r, yieldRate, v, steps);
  const theta = !metric || metric === "theta" ? (rate * result.price - (rate - yieldRate) * spot * result.delta - .5 * volatility * volatility * spot * spot * result.gamma) / 365 : 0;
  const vega = !metric || metric === "vega" ? (price(years, rate, volatility + volBump) - price(years, rate, volatility - volBump)) / (2 * volBump * 100) : 0;
  const rho = !metric || metric === "rho" ? (price(years, rate + rateBump, volatility) - price(years, rate - rateBump, volatility)) / (2 * rateBump * 100) : 0;
  if (![result.delta, result.gamma, theta, vega, rho].every(Number.isFinite)) throw new Error("American sensitivities outside numerical domain");
  const values = { ...result, theta, vega, rho };
  return metric ? values[metric] : values;
}
