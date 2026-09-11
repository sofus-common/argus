import { americanGreeks, americanPrice } from "./american-price.ts";

export const MAX_OPTION_LEGS = 8;
export const MAX_OPTION_EXPIRIES = 4;
export const MAX_CHAIN_CONTRACTS = 200;

export type TemplateId =
  | keyof typeof INVERSE_TEMPLATES
  | "call-diagonal"
  | "put-diagonal"
  | "call-butterfly"
  | "put-butterfly"
  | "short-call"
  | "short-put"
  | "short-straddle"
  | "short-strangle"
  | "long-call"
  | "long-put"
  | "bull-call"
  | "bear-put"
  | "bull-put"
  | "bear-call"
  | "long-straddle"
  | "long-strangle"
  | "iron-butterfly"
  | "iron-condor"
  | "call-calendar"
  | "put-calendar"
  | "covered-call"
  | "protective-put"
  | "collar";

export interface OptionLeg {
  id: string;
  contractId: string;
  side: "long" | "short";
  type: "call" | "put";
  contracts: number;
  strike: number;
  expiry: string;
  entryPrice: number;
  iv: number;
  multiplier: number;
}

export type PricingBasis = "mid" | "natural";

export type ChartRange = { min: number; max: number };

export function isChartRange(value: unknown): value is ChartRange {
  if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return false;
  const range = value as ChartRange;
  return Object.hasOwn(range, "min") && Object.hasOwn(range, "max") && finite(range.min) && finite(range.max) && range.min > 0 && range.min < range.max && range.max <= 1_000_000;
}

export interface MarketContract {
  contractId: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  multiplier: 100;
  bid: number;
  ask: number;
  iv: number;
  quoteAsOf: string;
  sourceTimes?: { bid: string; ask: string; iv: string };
  volume?: number;
  openInterest?: number;
}

export interface MarketSnapshot {
  imported?: true;
  underlyingKind?: "cash-index";
  contractTerms?: { exerciseStyle: "American"; settlement: "physical-shares"; sharesPerContract: 100; settlementSession: "PM" } | { exerciseStyle: "European"; settlement: "cash"; multiplier: 100; settlementSession: "PM" };
  underlying: string;
  strikeCenter?: number;
  historical?: true;
  id: string;
  source: "Tastytrade";
  captureSource?: "DXLink";
  spotSourceTimes?: { bid: string; ask: string };
  indexSourceTime?: string;
  retrievedAt: string;
  spot: number;
  spotAsOf: string;
  availableExpiries: string[];
  contracts: MarketContract[];
}

export interface StrategyState {
  thesis?: { text: string; targetSpot: number | null; targetDate: string | null };
  underlyingKind?: "cash-index";
  valuationModel?: "european-bsm-v1" | "american-crr-1024-v1";
  id: string;
  version: number;
  name: string;
  underlying: string;
  spot: number;
  valuationTimestamp: string;
  rate: number;
  dividendYield: number;
  scenarioDate: string;
  scenarioSpot: number;
  ivShift: number;
  expiryIvShifts?: Array<{ expiry: string; ivShift: number }>;
  legs: OptionLeg[];
  excludedLegIds?: string[];
  stock?: { shares: number; entryPrice: number };
  feeAllowance?: number;
  pricing?: { mode: "market"; snapshotId: string; basis: PricingBasis; historical?: true; entryMode?: "fixed" };
}

export interface StrategyMetrics {
  entryLabel: "Debit" | "Credit";
  entryAmount: number;
  entryAccounting: { grossEntryCashFlow: number; costAllowance: number; netEntryCashFlowAfterAllowance: number; convention: string };
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  mode: "expiration" | "first-expiry" | "spot";
  modeledLow: number;
  modeledHigh: number;
  sampledRange: { kind: "sampled-model-range"; date: string; spotMin: number; spotMax: number; pointCount: number; low: PayoffPoint; high: PayoffPoint };
  scenarioPnl: number;
  conditionalTail?: { date: string; model: NonNullable<StrategyState["valuationModel"]>; zeroSpotPnl: number | null; slope: number | null; intercept: number | null; outcome: "loss-unbounded" | "profit-unbounded" | "finite-limit" | "numerically-unresolved"; basis: string };
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
}

export const TEMPLATES: ReadonlyArray<{ id: TemplateId; name: string }> = [
  { id: "inverse-iron-butterfly", name: "Inverse Iron Butterfly" },
  { id: "inverse-iron-condor", name: "Inverse Iron Condor" },
  { id: "short-call-butterfly", name: "Short Call Butterfly" },
  { id: "short-put-butterfly", name: "Short Put Butterfly" },
  { id: "call-diagonal", name: "Long Call Diagonal" },
  { id: "put-diagonal", name: "Long Put Diagonal" },
  { id: "call-butterfly", name: "Long Call Butterfly" },
  { id: "put-butterfly", name: "Long Put Butterfly" },
  { id: "short-call", name: "Short Call" },
  { id: "short-put", name: "Short Put" },
  { id: "short-straddle", name: "Short Straddle" },
  { id: "short-strangle", name: "Short Strangle" },
  { id: "long-call", name: "Long Call" },
  { id: "long-put", name: "Long Put" },
  { id: "bull-call", name: "Bull Call Spread" },
  { id: "bear-put", name: "Bear Put Spread" },
  { id: "bull-put", name: "Bull Put Spread" },
  { id: "bear-call", name: "Bear Call Spread" },
  { id: "long-straddle", name: "Long Straddle" },
  { id: "long-strangle", name: "Long Strangle" },
  { id: "iron-butterfly", name: "Iron Butterfly" },
  { id: "iron-condor", name: "Iron Condor" },
  { id: "call-calendar", name: "Call Calendar" },
  { id: "put-calendar", name: "Put Calendar" },
  { id: "covered-call", name: "Covered Call" },
  { id: "protective-put", name: "Protective Put" },
  { id: "collar", name: "Collar" },
];

const DAY_MS = 86_400_000;
const INVERSE_TEMPLATES = {
  "inverse-iron-butterfly": "iron-butterfly",
  "inverse-iron-condor": "iron-condor",
  "short-call-butterfly": "call-butterfly",
  "short-put-butterfly": "put-butterfly",
} as const;
const YEAR_MS = 365 * DAY_MS;
const NEAR_EXPIRY = "2026-09-11T20:00:00.000Z";
const FAR_EXPIRY = "2026-09-18T20:00:00.000Z";

export const SAMPLE_EXPIRIES = [NEAR_EXPIRY, FAR_EXPIRY] as const;
export const LAB_SAMPLE_EXPIRIES: readonly string[] = [
  ...SAMPLE_EXPIRIES,
  ...['2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30',
    '2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18',
    '2027-01-08', '2027-01-15', '2027-01-22', '2027-02-05', '2027-02-12', '2027-02-19',
    '2027-03-05', '2027-03-12', '2027-03-19'].map(date => `${date}T20:00:00.000Z`),
];
export const SAMPLE_STRIKES = Array.from({ length: 41 }, (_, index) => 80 + index);

export function sampleContractId(type: OptionLeg["type"], strike: number, expiry: string): string {
  const date = expiry.slice(2, 10).replaceAll("-", "");
  const strikeCode = String(Math.round(strike * 1_000)).padStart(8, "0");
  return `SPY${date}${type === "call" ? "C" : "P"}${strikeCode}`;
}

const SAMPLE_CONTRACTS = new Set(
  LAB_SAMPLE_EXPIRIES.flatMap((expiry) => SAMPLE_STRIKES.flatMap((strike) => [
    sampleContractId("call", strike, expiry),
    sampleContractId("put", strike, expiry),
  ])),
);

function leg(
  id: string,
  side: OptionLeg["side"],
  type: OptionLeg["type"],
  strike: number,
  entryPrice: number,
  expiry = FAR_EXPIRY,
  contracts = 1,
): OptionLeg {
  return {
    id,
    contractId: sampleContractId(type, strike, expiry),
    side,
    type,
    contracts,
    strike,
    expiry,
    entryPrice,
    iv: 0.22,
    multiplier: 100,
  };
}

export function createStrategy(templateId: TemplateId): StrategyState {
  const definition = TEMPLATES.find((template) => template.id === templateId);
  if (!definition) throw new Error(`Unknown template: ${templateId}`);

  if (templateId in INVERSE_TEMPLATES) {
    const base = createStrategy(INVERSE_TEMPLATES[templateId as keyof typeof INVERSE_TEMPLATES]);
    return { ...base, id: templateId, name: definition.name, legs: base.legs.map(item => ({ ...item, side: item.side === "long" ? "short" : "long", id: item.id.startsWith("long-") ? item.id.replace("long-", "short-") : item.id.startsWith("short-") ? item.id.replace("short-", "long-") : item.id })) };
  }
  const templates: Record<Exclude<TemplateId, keyof typeof INVERSE_TEMPLATES>, OptionLeg[]> = {
    "call-diagonal": [leg("near-call", "short", "call", 103, 0.8, NEAR_EXPIRY), leg("far-call", "long", "call", 98, 3.8)],
    "put-diagonal": [leg("near-put", "short", "put", 97, 0.8, NEAR_EXPIRY), leg("far-put", "long", "put", 102, 3.9)],
    "call-butterfly": [leg("low-call", "long", "call", 95, 6), leg("body-call", "short", "call", 100, 2.5, FAR_EXPIRY, 2), leg("high-call", "long", "call", 105, 0.8)],
    "put-butterfly": [leg("low-put", "long", "put", 95, 0.8), leg("body-put", "short", "put", 100, 2.3, FAR_EXPIRY, 2), leg("high-put", "long", "put", 105, 5.6)],
    "short-call": [leg("call", "short", "call", 100, 2.5)],
    "short-put": [leg("put", "short", "put", 100, 2.3)],
    "short-straddle": [leg("call", "short", "call", 100, 2.5), leg("put", "short", "put", 100, 2.3)],
    "short-strangle": [leg("call", "short", "call", 103, 1.4), leg("put", "short", "put", 97, 1.5)],
    "covered-call": [leg("call", "short", "call", 105, 2)],
    "protective-put": [leg("put", "long", "put", 95, 3)],
    "collar": [leg("put", "long", "put", 95, 3), leg("call", "short", "call", 105, 2)],
    "long-call": [leg("call", "long", "call", 100, 2.5)],
    "long-put": [leg("put", "long", "put", 100, 2.3)],
    "bull-call": [leg("long-call", "long", "call", 98, 3.8), leg("short-call", "short", "call", 103, 1.4)],
    "bear-put": [leg("long-put", "long", "put", 102, 3.9), leg("short-put", "short", "put", 97, 1.5)],
    "bull-put": [leg("short-put", "short", "put", 102, 3.9), leg("long-put", "long", "put", 97, 1.5)],
    "bear-call": [leg("short-call", "short", "call", 98, 3.8), leg("long-call", "long", "call", 103, 1.4)],
    "long-straddle": [leg("call", "long", "call", 100, 2.5), leg("put", "long", "put", 100, 2.3)],
    "long-strangle": [leg("call", "long", "call", 103, 1.4), leg("put", "long", "put", 97, 1.5)],
    "iron-butterfly": [
      leg("long-put", "long", "put", 95, 0.8),
      leg("short-put", "short", "put", 100, 2.3),
      leg("short-call", "short", "call", 100, 2.5),
      leg("long-call", "long", "call", 105, 0.8),
    ],
    "iron-condor": [
      leg("long-put", "long", "put", 94, 0.5),
      leg("short-put", "short", "put", 97, 1.5),
      leg("short-call", "short", "call", 103, 1.4),
      leg("long-call", "long", "call", 106, 0.5),
    ],
    "call-calendar": [
      leg("near-call", "short", "call", 100, 1.5, NEAR_EXPIRY),
      leg("far-call", "long", "call", 100, 3.0),
    ],
    "put-calendar": [
      leg("near-put", "short", "put", 100, 1.4, NEAR_EXPIRY),
      leg("far-put", "long", "put", 100, 2.8),
    ],
  };

  return {
    id: templateId,
    valuationModel: "european-bsm-v1",
    version: 1,
    name: definition.name,
    underlying: "SPY",
    spot: 100,
    valuationTimestamp: "2026-09-01T20:00:00.000Z",
    rate: 0.04,
    dividendYield: 0.012,
    scenarioDate: "2026-09-01T20:00:00.000Z",
    scenarioSpot: 100,
    ivShift: 0,
    legs: templates[templateId as keyof typeof templates].map((item) => ({ ...item })),
    ...(["covered-call", "protective-put", "collar"].includes(templateId) ? { stock: { shares: 100, entryPrice: 100 } } : {}),
  };
}

export function marketLeg(contract: MarketContract, side: OptionLeg["side"], contracts = 1, id = contract.contractId, basis: PricingBasis = "mid", prior?: OptionLeg): OptionLeg {
  return {
    id, contractId: contract.contractId, side, type: contract.type, contracts,
    strike: contract.strike, expiry: contract.expiry, iv: contract.iv, multiplier: contract.multiplier,
    entryPrice: prior?.contractId === contract.contractId && prior.side === side ? prior.entryPrice : rounded(basis === "natural" ? side === "long" ? contract.ask : contract.bid : (contract.bid + contract.ask) / 2),
  };
}

export function translateStrikes(state: StrategyState, anchorId: string, requestedStrike: number, snapshot?: MarketSnapshot, step?: -1 | 1): StrategyState {
  if (!Number.isFinite(requestedStrike) || (step !== undefined && step !== -1 && step !== 1)) throw new Error("Invalid strike translation request");
  if (state.pricing && !snapshot) throw new Error("A matching market snapshot is required to move strikes");
  const errors = state.pricing ? validateMarketStrategy(state, snapshot!) : validateStrategy(state);
  if (errors.length) throw new Error(errors.join("; "));
  const anchor = state.legs.find(leg => leg.id === anchorId);
  if (!anchor) throw new Error("Strike translation anchor is not in this strategy");
  const grids = state.legs.map(leg => new Map<number, MarketContract | undefined>(state.pricing
    ? snapshot!.contracts.filter(contract => contract.type === leg.type && contract.expiry === leg.expiry).map(contract => [Math.round(contract.strike * 1000), contract])
    : SAMPLE_STRIKES.map(strike => [strike * 1000, undefined])));
  const anchorIndex = state.legs.indexOf(anchor), anchorStrike = Math.round(anchor.strike * 1000);
  const offsets = [...grids[anchorIndex].keys()].map(strike => strike - anchorStrike)
    .filter(offset => state.legs.every((leg, index) => grids[index].has(Math.round(leg.strike * 1000) + offset)))
    .sort((a, b) => a - b);
  const targetOffset = requestedStrike * 1000 - anchorStrike;
  const offset = step === 1 ? offsets.find(value => value > 0)
    : step === -1 ? [...offsets].reverse().find(value => value < 0)
      : offsets.reduce((best, value) => Math.abs(value - targetOffset) < Math.abs(best - targetOffset) ? value : best, offsets[0]);
  if (offset === undefined || offset === 0) return state;
  if (state.pricing?.entryMode === "fixed") throw new Error("Held positions with fixed entry costs cannot move strikes; use a hypothetical strategy instead");
  const next = { ...state, legs: state.legs.map((leg, index) => {
    const strike = (Math.round(leg.strike * 1000) + offset) / 1000;
    return state.pricing
      ? marketLeg(grids[index].get(Math.round(strike * 1000))!, leg.side, leg.contracts, leg.id, state.pricing.basis)
      : { ...leg, strike, contractId: sampleContractId(leg.type, strike, leg.expiry) };
  }) };
  const nextErrors = state.pricing ? validateMarketStrategy(next, snapshot!) : validateStrategy(next);
  if (nextErrors.length) throw new Error(nextErrors.join("; "));
  return next;
}

export function createMarketStrategy(requestedId: TemplateId, snapshot: MarketSnapshot, basis: PricingBasis = "mid"): StrategyState {
  const definition = TEMPLATES.find(template => template.id === requestedId);
  if (!definition) throw new Error(`Unknown template: ${requestedId}`);
  const reversed = requestedId in INVERSE_TEMPLATES;
  const templateId = reversed ? INVERSE_TEMPLATES[requestedId as keyof typeof INVERSE_TEMPLATES] : requestedId as Exclude<TemplateId, keyof typeof INVERSE_TEMPLATES>;
  const expiries = [...new Set(snapshot.contracts.map(contract => contract.expiry))].sort();
  const near = expiries[0];
  const far = expiries[1];
  const calendar = templateId.endsWith("calendar");
  const putStrikes = [...new Set(snapshot.contracts.filter(contract => contract.expiry === near && contract.type === "put").map(contract => contract.strike))].sort((a, b) => a - b);
  const callStrikes = new Set(snapshot.contracts.filter(contract => contract.expiry === near && contract.type === "call").map(contract => contract.strike));
  const types: OptionLeg["type"][] = templateId.includes("call") ? ["call"] : templateId.includes("put") ? ["put"] : ["call", "put"];
  const strikes = [...new Set(snapshot.contracts.filter(contract => contract.expiry === near).map(contract => contract.strike))]
    .filter(strike => types.every(type => snapshot.contracts.some(contract => contract.strike === strike && contract.type === type && contract.expiry === near)
      && (!calendar || snapshot.contracts.some(contract => contract.strike === strike && contract.type === type && contract.expiry === far))))
    .sort((a, b) => a - b);
  const butterfly = templateId === "call-butterfly" || templateId === "put-butterfly" || templateId === "iron-butterfly";
  if (butterfly) {
    const available = templateId === "iron-butterfly" ? callStrikes : new Set(strikes);
    let triple: number[] = [];
    for (const center of strikes) {
      const low = [...(templateId === "iron-butterfly" ? putStrikes : strikes)].reverse().find(strike => strike < center && available.has(Math.round((2 * center - strike) * 1000) / 1000));
      if (low === undefined) continue;
      const distance = Math.abs(center - snapshot.spot), bestDistance = Math.abs(triple[1] - snapshot.spot);
      if (!triple.length || distance < bestDistance || (distance === bestDistance && center - low < triple[1] - triple[0])) triple = [low, center, Math.round((2 * center - low) * 1000) / 1000];
    }
    strikes.splice(0, strikes.length, ...triple);
  }
  let sparseCondor: number[] | undefined;
  if (templateId === "iron-condor" && strikes.length < 5) {
    const calls = [...callStrikes].sort((a, b) => a - b);
    let distance = Infinity, gap = Infinity;
    for (let p = 1; p < putStrikes.length; p++) for (let c = 0; c < calls.length - 1; c++) {
      if (putStrikes[p] >= calls[c]) continue;
      const candidateDistance = Math.abs((putStrikes[p] + calls[c]) / 2 - snapshot.spot), candidateGap = calls[c] - putStrikes[p];
      if (candidateDistance < distance || (candidateDistance === distance && candidateGap < gap)) {
        sparseCondor = [putStrikes[p - 1], putStrikes[p], calls[c], calls[c + 1]];
        distance = candidateDistance; gap = candidateGap;
      }
    }
  }
  const wingPair = ["bull-call", "bear-call", "bull-put", "bear-put", "long-strangle", "short-strangle", "collar"].includes(templateId);
  let sparsePair: number[] | undefined;
  if (wingPair && strikes.length < 3) {
    const lows = types.length === 1 ? strikes : putStrikes;
    const highs = types.length === 1 ? strikes : [...callStrikes].sort((a, b) => a - b);
    let distance = Infinity, width = Infinity;
    for (const low of lows) for (const high of highs) {
      if (low >= high) continue;
      const candidateDistance = Math.abs((low + high) / 2 - snapshot.spot), candidateWidth = high - low;
      if (candidateDistance < distance || (candidateDistance === distance && candidateWidth < width)) {
        sparsePair = [low, high]; distance = candidateDistance; width = candidateWidth;
      }
    }
  }
  const radius = templateId === "iron-condor" ? 2 : butterfly || wingPair ? 1 : 0;
  if (!sparseCondor && !sparsePair && strikes.length < 2 * radius + 1) throw new Error(`${definition.name} unavailable in this quoted chain window`);
  const nearest = strikes.reduce((best, strike, index) => Math.abs(strike - snapshot.spot) < Math.abs(strikes[best] - snapshot.spot) ? index : best, 0);
  const atm = Math.max(radius, Math.min(strikes.length - radius - 1, nearest));
  const pick = (side: OptionLeg["side"], type: OptionLeg["type"], offset = 0, expiry = near, quantity = 1): OptionLeg => {
    const strike = sparseCondor ? sparseCondor[offset < 0 ? offset + 2 : offset + 1] : sparsePair ? sparsePair[offset < 0 ? 0 : 1] : strikes[atm + offset];
    const contract = snapshot.contracts.find(item => item.type === type && item.expiry === expiry && item.strike === strike);
    if (!contract) throw new Error(`${definition.name} unavailable in this quoted chain window`);
    return marketLeg(contract, reversed ? side === "long" ? "short" : "long" : side, quantity, contract.contractId, basis);
  };
  let legs: OptionLeg[];
  const diagonal = (type: OptionLeg["type"]): OptionLeg[] => {
    const pairs = snapshot.contracts.filter(contract => contract.type === type && contract.expiry === near).flatMap(short =>
      snapshot.contracts.filter(long => long.type === type && long.expiry === far && (type === "call" ? long.strike < short.strike : long.strike > short.strike)).map(long => ({ short, long })));
    pairs.sort((a, b) => Math.abs(a.short.strike - snapshot.spot) - Math.abs(b.short.strike - snapshot.spot) || Math.abs(a.short.strike - a.long.strike) - Math.abs(b.short.strike - b.long.strike) || a.short.strike - b.short.strike);
    if (!pairs.length) throw new Error(`${definition.name} unavailable in this quoted chain window`);
    return [marketLeg(pairs[0].short, "short", 1, pairs[0].short.contractId, basis), marketLeg(pairs[0].long, "long", 1, pairs[0].long.contractId, basis)];
  };
  switch (templateId) {
    case "call-diagonal": legs = diagonal("call"); break;
    case "put-diagonal": legs = diagonal("put"); break;
    case "call-butterfly": legs = [pick("long", "call", -1), pick("short", "call", 0, near, 2), pick("long", "call", 1)]; break;
    case "put-butterfly": legs = [pick("long", "put", -1), pick("short", "put", 0, near, 2), pick("long", "put", 1)]; break;
    case "short-call": legs = [pick("short", "call")]; break;
    case "short-put": legs = [pick("short", "put")]; break;
    case "short-straddle": legs = [pick("short", "call"), pick("short", "put")]; break;
    case "short-strangle": legs = [pick("short", "call", 1), pick("short", "put", -1)]; break;
    case "covered-call": legs = [pick("short", "call")]; break;
    case "protective-put": legs = [pick("long", "put")]; break;
    case "collar": legs = [pick("long", "put", -1), pick("short", "call", 1)]; break;
    case "long-call": legs = [pick("long", "call")]; break;
    case "long-put": legs = [pick("long", "put")]; break;
    case "bull-call": legs = [pick("long", "call", -1), pick("short", "call", 1)]; break;
    case "bear-call": legs = [pick("short", "call", -1), pick("long", "call", 1)]; break;
    case "bear-put": legs = [pick("long", "put", 1), pick("short", "put", -1)]; break;
    case "bull-put": legs = [pick("short", "put", 1), pick("long", "put", -1)]; break;
    case "long-straddle": legs = [pick("long", "call"), pick("long", "put")]; break;
    case "long-strangle": legs = [pick("long", "call", 1), pick("long", "put", -1)]; break;
    case "iron-butterfly": legs = [pick("long", "put", -1), pick("short", "put"), pick("short", "call"), pick("long", "call", 1)]; break;
    case "iron-condor": legs = [pick("long", "put", -2), pick("short", "put", -1), pick("short", "call", 1), pick("long", "call", 2)]; break;
    case "call-calendar": legs = [pick("short", "call"), pick("long", "call", 0, far)]; break;
    case "put-calendar": legs = [pick("short", "put"), pick("long", "put", 0, far)]; break;
  }
  const state: StrategyState = {
    valuationModel: "european-bsm-v1",
    ...(snapshot.underlyingKind ? { underlyingKind: snapshot.underlyingKind } : {}),
    id: requestedId, version: 1, name: definition.name, underlying: snapshot.underlying, spot: snapshot.spot,
    valuationTimestamp: snapshot.retrievedAt, rate: 0.04, dividendYield: 0.012,
    scenarioDate: snapshot.retrievedAt, scenarioSpot: snapshot.spot, ivShift: 0, legs,
    ...(["covered-call", "protective-put", "collar"].includes(templateId) ? { stock: { shares: 100, entryPrice: snapshot.spot } } : {}),
    pricing: { mode: "market", snapshotId: snapshot.id, basis, ...(snapshot.historical ? { historical: true as const } : {}) },
  };
  const errors = validateMarketStrategy(state, snapshot);
  if (errors.length) throw new Error(errors.join("; "));
  return state;
}

export function validateMarketStrategy(state: StrategyState, snapshot: MarketSnapshot): string[] {
  return validateMarketPosition(state, snapshot, validateStrategy(state));
}

export function validateMarketConstruction(state: StrategyState, snapshot: MarketSnapshot): string[] {
  return validateMarketPosition(state, snapshot, validateConstruction(state));
}

function validateMarketPosition(state: StrategyState, snapshot: MarketSnapshot, errors: string[]): string[] {
  if (state?.underlying !== snapshot.underlying) errors.push("market underlying must match the snapshot");
  if (state?.underlyingKind !== snapshot.underlyingKind || snapshot.underlyingKind === 'cash-index' && !validContractTerms(snapshot)) errors.push("market instrument kind and contract terms must match");
  if (!state || !state.pricing || state.pricing.mode !== "market") return [...errors, "market pricing metadata is required"];
  if (state.pricing.snapshotId !== snapshot.id) errors.push("market snapshot does not match; refresh required");
  if (state.pricing.historical !== snapshot.historical) errors.push("historical quote provenance does not match");
  if (state.spot !== snapshot.spot || state.valuationTimestamp !== snapshot.retrievedAt) errors.push("market spot and valuation must match the snapshot");
  if (!Array.isArray(state.legs)) return errors;
  for (const item of state.legs) {
    if (!item || typeof item !== "object") continue;
    const contract = snapshot.contracts.find(candidate => candidate.contractId === item.contractId);
    if (!contract) { errors.push(`${item.id}: contract is not in the market snapshot`); continue; }
    const expected = marketLeg(contract, item.side, item.contracts, item.id, state.pricing.basis);
    if (["type", "strike", "expiry", "multiplier", "iv", ...(state.pricing.entryMode === "fixed" ? [] : ["entryPrice"])].some(field => item[field as keyof OptionLeg] !== expected[field as keyof OptionLeg])) errors.push(`${item.id}: contract or pricing differs from the market snapshot`);
  }
  return errors;
}

export function validContractTerms(snapshot: MarketSnapshot): boolean {
  const terms = snapshot.contractTerms;
  if (snapshot.underlyingKind !== undefined && snapshot.underlyingKind !== "cash-index") return false;
  if (terms === undefined) return snapshot.underlyingKind === undefined;
  if (!terms || typeof terms !== "object" || Array.isArray(terms) || terms.settlementSession !== "PM") return false;
  return snapshot.underlyingKind === "cash-index"
    ? Object.keys(terms).sort().join() === "exerciseStyle,multiplier,settlement,settlementSession" && terms.exerciseStyle === "European" && terms.settlement === "cash" && terms.multiplier === 100
    : Object.keys(terms).sort().join() === "exerciseStyle,settlement,settlementSession,sharesPerContract" && terms.exerciseStyle === "American" && terms.settlement === "physical-shares" && terms.sharesPerContract === 100;
}

export function contractTermsFacts(snapshot?: MarketSnapshot) {
  if (snapshot?.imported) return { status: "unknown" as const, basis: "Imported file metadata is unverified; no provider-verified contract terms are available." };
  const terms = snapshot?.contractTerms;
  if (!snapshot || !terms || !validContractTerms(snapshot)) {
    return { status: "unknown" as const, basis: "Supported contract terms are unavailable; do not infer exercise style or settlement from the underlying symbol or valuation model." };
  }
  if (terms.settlement === "cash") return {
    ...terms, underlying: snapshot.underlying, status: "provider-verified-standard-window" as const,
    basis: "Recorded European PM cash-delivery contract checks with a 100 cash multiplier. Index values are not executable shares or official settlement values. No early exercise, physical assignment or automatic settlement cashflows are modeled. Historical terms are not a current provider check; broker exercise deadlines are unknown.",
  };
  return {
    exerciseStyle: terms.exerciseStyle, settlement: terms.settlement, sharesPerContract: terms.sharesPerContract, settlementSession: terms.settlementSession,
    underlying: snapshot!.underlying, status: "provider-verified-standard-window" as const,
    basis: "Recorded standard-chain share deliverable and representative call/put instrument checks per selected expiry; not inferred from the valuation model. Historical snapshots retain recorded terms, not a current corporate-action check. Assignment/exercise cashflows are not included in valuation or P/L; separate conditional gross strike cashflows may be supplied. Broker exercise deadlines are unknown.",
  };
}

export function calculateConditionalAssignment(state: StrategyState, snapshot?: MarketSnapshot) {
  const assignmentTerms = contractTermsFacts(snapshot);
  const events = snapshot && !snapshot.historical && assignmentTerms.status === "provider-verified-standard-window" && assignmentTerms.settlement === "physical-shares" && validateMarketStrategy(state, snapshot).length === 0
    ? state.legs.map(leg => {
      const shareChange = (leg.type === "call" ? 1 : -1) * (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier;
      const resultingShares = (state.stock?.shares ?? 0) + shareChange, grossStrikeCashflow = -shareChange * leg.strike;
      if (!Number.isSafeInteger(shareChange) || !Number.isSafeInteger(resultingShares) || !Number.isFinite(grossStrikeCashflow)) throw new Error("Conditional assignment arithmetic unavailable");
      return { leg, shareChange, resultingShares, grossStrikeCashflow, remainingOptionLegIds: state.legs.filter(other => other.id !== leg.id).map(other => other.id) };
    }) : null;
  const scenarios = events?.filter(event => event.leg.side === "short").map(({ leg, ...outcome }) => ({ assignedLegId: leg.id, assignedContracts: leg.contracts, ...outcome })) ?? null;
  const exerciseScenarios = events?.filter(event => event.leg.side === "long").map(({ leg, ...outcome }) => ({ exercisedLegId: leg.id, exercisedContracts: leg.contracts, ...outcome })) ?? null;
  return {
    status: scenarios === null ? "unavailable" : "conditional",
    basis: "Separate hypothetical full assignment of each short leg from the ORIGINAL inventory under recorded verified American physical-share snapshot terms, not current corporate-action verification. Before assignment the original options remain; afterward the assigned leg no longer exists, resulting shares and listed options remain. No automatic long exercise or cumulative assignment. Gross strike cashflow is not P/L, buying power, total account cash or cost basis; excludes option premiums, fees, dividend and financing cashflows. No assignment probability, timing or broker action is implied. Partial assignments are not represented. Unavailable for unknown or historical terms. No position is changed.",
    exerciseBasis: "Separate hypothetical full exercise of each long leg from the ORIGINAL inventory, not an exercise recommendation or prediction. The exercised option is removed; all other options remain. Independent of short assignment: do not combine rows or assume matched events. Same verified-term restrictions and gross cashflow exclusions as assignment. No automatic exercise, broker action, partial exercise or position change is modeled.",
    beforeShares: state.stock?.shares ?? 0, beforeOptionLegIds: state.legs.map(leg => leg.id), scenarios, exerciseScenarios,
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function quoteValuation(state: StrategyState, snapshot: MarketSnapshot) {
  const errors = validateMarketStrategy(state, snapshot);
  if (errors.length) throw new Error(errors.join("; "));
  const contracts = state.legs.map(item => snapshot.contracts.find(contract => contract.contractId === item.contractId)!);
  const dates = contracts.map(contract => Date.parse(contract.quoteAsOf));
  if (state.stock) dates.push(Date.parse(snapshot.spotAsOf));
  if (dates.some(date => !Number.isFinite(date))) throw new Error("Invalid quote timestamp");
  const value = state.legs.reduce((sum, item, index) => {
    const contract = contracts[index];
    if (!finite(contract.bid) || !finite(contract.ask) || contract.bid < 0 || contract.ask <= 0 || contract.ask < contract.bid) throw new Error("Invalid quote");
    const price = state.pricing!.basis === "mid" ? (contract.bid + contract.ask) / 2 : item.side === "long" ? contract.bid : contract.ask;
    return sum + price * (item.side === "long" ? 1 : -1) * item.contracts * item.multiplier;
  }, (state.stock?.shares ?? 0) * snapshot.spot);
  const entry = entryCost(state);
  const optionSpreadLegs = state.legs.map((leg, index) => ({ legId: leg.id, contractId: leg.contractId, side: leg.side, contracts: leg.contracts, multiplier: leg.multiplier, bid: contracts[index].bid, ask: contracts[index].ask, quoteAsOf: contracts[index].quoteAsOf, positionWidthUsd: rounded((contracts[index].ask - contracts[index].bid) * leg.contracts * leg.multiplier) }));
  const optionQuotedSpreadWidth = rounded(optionSpreadLegs.reduce((sum, leg) => sum + leg.positionWidthUsd, 0));
  return {
    optionSpreadLegs, optionQuotedSpreadWidth, optionMidToNaturalDifference: rounded(optionQuotedSpreadWidth / 2),
    optionSpreadBasis: "Sum of dated option ask-minus-bid widths times quantity and multiplier, without long/short netting. Half-width is midpoint minus natural liquidation value on these same leg quotes. Excludes stock, held costs and allowances. Not realized cost, expected slippage, a complex-order quote, available size, liquidity score or fill probability.",
    signedEntry: rounded(entry), signedLiquidationValue: rounded(value), ...(state.feeAllowance !== undefined ? { feeAllowance: state.feeAllowance } : {}), pnl: rounded(value - entry - (state.feeAllowance ?? 0)),
    basis: (state.pricing!.basis === "mid" ? "Midpoint liquidation estimate; not a fill, before unmodeled costs." : "Natural liquidation estimate: sell longs at bid / buy shorts at ask; not a fill, before unmodeled costs.") + (state.stock ? " Options only use that quote basis; stock uses a dated underlying spot mark, not an executable bid/ask. No dividends, financing, borrow or assignment cashflows." : ""),
    ...(state.stock ? { signedStockValue: rounded(state.stock.shares * snapshot.spot) } : {}),
    oldestQuoteAt: new Date(Math.min(...dates)).toISOString(), newestQuoteAt: new Date(Math.max(...dates)).toISOString(), historical: snapshot.historical === true,
  };
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const day = value.slice(0, 10), parsedDay = Date.parse(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsedDay) || new Date(parsedDay).toISOString().slice(0, 10) !== day) return Number.NaN;
  return Date.parse(value);
}

export function effectiveIv(state: StrategyState, leg: Pick<OptionLeg, "iv" | "expiry">): number {
  return leg.iv + state.ivShift + (Array.isArray(state.expiryIvShifts) ? state.expiryIvShifts.find(shift => shift?.expiry === leg.expiry)?.ivShift ?? 0 : 0);
}

export function pruneExpiryIvShifts(state: StrategyState): StrategyState {
  if (!state.expiryIvShifts?.length) return state;
  const retained = state.expiryIvShifts.filter(shift => state.legs.some(leg => leg.expiry === shift.expiry));
  return retained.length === state.expiryIvShifts.length ? state : { ...state, expiryIvShifts: retained };
}

export function validateStrategy(state: StrategyState): string[] {
  return validatePosition(state, false);
}

export function validateConstruction(state: StrategyState): string[] {
  return validatePosition(state, true);
}

export function projectAnalysisPosition(state: StrategyState): StrategyState | null {
  const errors = validateConstruction(state);
  if (errors.length) throw new Error(errors.join("; "));
  const { excludedLegIds = [], ...position } = structuredClone(state);
  position.legs = position.legs.filter(leg => !excludedLegIds.includes(leg.id));
  if (!position.legs.length && !position.stock) return null;
  const projected = pruneExpiryIvShifts(position);
  assertValid(projected);
  return projected;
}

export function mergeAnalysisProposal(state: StrategyState, proposal: StrategyState): StrategyState {
  proposal = { ...proposal, thesis: state.thesis ? { ...state.thesis } : undefined };
  const included = projectAnalysisPosition(state);
  if (!included) throw new Error("Include holdings before proposing changes");
  assertValid(proposal);
  if (proposal.underlyingKind !== state.underlyingKind) throw new Error("Proposal cannot change instrument kind");
  if (proposal.id !== state.id || proposal.version !== state.version + 1) throw new Error("Proposal identity or version mismatch");
  const excluded = state.legs.filter(leg => state.excludedLegIds?.includes(leg.id));
  if (!excluded.length) return structuredClone(proposal);
  if (state.pricing?.entryMode === "fixed" && proposal.pricing && proposal.pricing.entryMode === undefined) proposal = { ...proposal, pricing: { ...proposal.pricing, entryMode: "fixed" } };
  if (proposal.underlying !== state.underlying || proposal.valuationTimestamp !== state.valuationTimestamp || proposal.spot !== state.spot || JSON.stringify(proposal.pricing) !== JSON.stringify(state.pricing)) throw new Error("Proposal cannot change retained inventory pricing context");
  if (proposal.legs.some(leg => excluded.some(retained => retained.id === leg.id))) throw new Error("Proposal cannot reuse excluded leg IDs");
  const next = structuredClone(proposal);
  next.excludedLegIds = [...state.excludedLegIds!];
  next.legs = state.legs.flatMap(leg => {
    const retained = excluded.find(item => item.id === leg.id) ?? next.legs.find(item => item.id === leg.id);
    return retained ? [structuredClone(retained)] : [];
  }).concat(next.legs.filter(leg => !state.legs.some(item => item.id === leg.id)));
  const retainedShifts = state.expiryIvShifts?.filter(shift => excluded.some(leg => leg.expiry === shift.expiry) && !proposal.legs.some(leg => leg.expiry === shift.expiry)) ?? [];
  if (retainedShifts.length) next.expiryIvShifts = [...(next.expiryIvShifts ?? []), ...structuredClone(retainedShifts)];
  const errors = validateConstruction(next);
  if (errors.length) throw new Error(errors.join("; "));
  return next;
}

function validatePosition(state: StrategyState, construction: boolean): string[] {
  const errors: string[] = [];
  if (!state || typeof state !== "object") return ["strategy must be an object"];
  if (state.thesis !== undefined) {
    const thesis = state.thesis;
    if (!thesis || typeof thesis !== 'object' || Array.isArray(thesis) || Object.keys(thesis).sort().join() !== 'targetDate,targetSpot,text' || typeof thesis.text !== 'string' || thesis.text.length > 12000 || (thesis.targetSpot !== null && (!finite(thesis.targetSpot) || thesis.targetSpot < .001 || thesis.targetSpot > 1_000_000)) || (thesis.targetDate !== null && (typeof thesis.targetDate !== 'string' || !Number.isFinite(Date.parse(thesis.targetDate)) || new Date(thesis.targetDate).toISOString() !== thesis.targetDate))) errors.push('Invalid position thesis');
  }
  if (state.underlyingKind !== undefined && state.underlyingKind !== "cash-index") errors.push("unsupported underlying kind");
  if (state.underlyingKind === "cash-index" && (state.valuationModel !== "european-bsm-v1" || state.stock !== undefined)) errors.push("cash-index positions require European valuation and cannot hold shares");
  if (state.valuationModel !== undefined && state.valuationModel !== "european-bsm-v1" && state.valuationModel !== "american-crr-1024-v1") errors.push("unsupported valuation model");
  if (state.feeAllowance !== undefined && (!finite(state.feeAllowance) || state.feeAllowance < 0)) errors.push("cost allowance must be finite and non-negative");
  const market = state.pricing?.mode === "market";
  if (state.pricing !== undefined && (!market || typeof state.pricing.snapshotId !== "string" || !state.pricing.snapshotId || !["mid", "natural"].includes(state.pricing.basis))) errors.push("invalid market pricing metadata");
  if (state.pricing?.entryMode !== undefined && state.pricing.entryMode !== "fixed") errors.push("invalid entry mode");
  if (typeof state.id !== "string" || !state.id || typeof state.name !== "string" || !state.name) errors.push("strategy id and name are required");
  if (!Number.isInteger(state.version) || state.version < 1) errors.push("version must be a positive integer");
  if (market ? typeof state.underlying !== "string" || !/^[A-Z]{1,6}$/.test(state.underlying) : state.underlying !== "SPY") errors.push(market ? "invalid market underlying" : "the replay-safe sample supports SPY only");
  if (!finite(state.spot) || state.spot <= 0) errors.push("spot must be positive and finite");
  if (!finite(state.scenarioSpot) || state.scenarioSpot <= 0) errors.push("scenario spot must be positive and finite");
  if (state.stock !== undefined) {
    const stock = state.stock;
    if (!stock || typeof stock !== "object" || Array.isArray(stock) || Object.keys(stock).length !== 2 || !Object.hasOwn(stock, "shares") || !Object.hasOwn(stock, "entryPrice") || !Number.isSafeInteger(stock.shares) || stock.shares === 0 || !finite(stock.entryPrice) || stock.entryPrice < 0 || !finite(stock.shares * stock.entryPrice) || !finite(stock.shares * state.spot) || !finite(stock.shares * state.scenarioSpot)) errors.push("stock must contain nonzero safe-integer shares and finite non-negative per-share entry cost with finite valuation");
  }
  if (!finite(state.rate) || !finite(state.dividendYield) || !finite(state.ivShift)) errors.push("rate, dividend yield, and IV shift must be finite");

  const valuation = timestamp(state.valuationTimestamp);
  const scenario = timestamp(state.scenarioDate);
  if (!Number.isFinite(valuation) || !Number.isFinite(scenario)) errors.push("valuation and scenario dates must be valid timestamps");
  if (Number.isFinite(valuation) && Number.isFinite(scenario) && scenario < valuation) errors.push("scenario date cannot precede valuation");

  if (!Array.isArray(state.legs) || (!construction && !state.legs.length && !state.stock) || state.legs.length > MAX_OPTION_LEGS) {
    errors.push(state.legs?.length > MAX_OPTION_LEGS ? "strategy must contain at most eight option legs" : "strategy must contain one to eight legs or a nonzero stock holding");
    return errors;
  }

  const excluded = state.excludedLegIds;
  if (excluded !== undefined && (!Array.isArray(excluded) || Array.from(excluded).some(id => typeof id !== "string" || !id || !state.legs.some(leg => leg?.id === id)) || new Set(excluded).size !== excluded.length)) errors.push("excluded leg ids must be unique existing leg ids");
  if (!construction && Array.isArray(excluded) && excluded.length) errors.push("project included holdings before pricing");
  const excludedIds = new Set(Array.isArray(excluded) ? excluded : []);
  const ids = new Set<string>();
  if (state.expiryIvShifts !== undefined) {
    const shifts = state.expiryIvShifts;
    if (!Array.isArray(shifts) || shifts.length > MAX_OPTION_EXPIRIES || shifts.some(shift => !shift || typeof shift !== "object" || Object.keys(shift).sort().join() !== "expiry,ivShift" || typeof shift.expiry !== "string" || !Number.isFinite(Date.parse(shift.expiry)) || new Date(shift.expiry).toISOString() !== shift.expiry || !state.legs.some(leg => leg?.expiry === shift.expiry) || !finite(shift.ivShift) || Math.abs(shift.ivShift) > 10) || new Set(shifts.map(shift => shift.expiry)).size !== shifts.length) errors.push("expiry IV shifts must have unique canonical current expiries and finite shifts within ten volatility units");
  }
  const contractIds = new Set<string>();
  const expiries = new Set<string>();
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of state.legs) {
    if (!item || typeof item !== "object") {
      errors.push("each leg must be an object");
      continue;
    }
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) errors.push("leg ids must be present and unique");
    ids.add(item.id);
    if (!item.contractId || contractIds.has(item.contractId)) errors.push("contract ids must be present and unique");
    contractIds.add(item.contractId);
    if (market) {
      const identity = typeof item.contractId === "string" && typeof state.underlying === "string" && item.contractId.slice(0, 6) === state.underlying.padEnd(6) ? /^(\d{6})([CP])(\d{8})$/.exec(item.contractId.slice(6)) : null;
      if (!identity || typeof item.expiry !== "string" || identity[1] !== item.expiry.slice(2, 10).replaceAll("-", "") || identity[2] !== (item.type === "call" ? "C" : "P") || Number(identity[3]) / 1000 !== item.strike) errors.push(`${item.id}: invalid market contract identity`);
    } else if (!SAMPLE_STRIKES.includes(item.strike) || !LAB_SAMPLE_EXPIRIES.includes(item.expiry) || !SAMPLE_CONTRACTS.has(item.contractId) || item.contractId !== sampleContractId(item.type, item.strike, item.expiry)) errors.push(`${item.id}: contract is not in the replay-safe sample catalog`);
    if (item.side !== "long" && item.side !== "short") errors.push(`${item.id}: invalid side`);
    if (item.type !== "call" && item.type !== "put") errors.push(`${item.id}: invalid option type`);
    if (!Number.isSafeInteger(item.contracts) || item.contracts < 1) errors.push(`${item.id}: contracts must be a positive safe integer`);
    if (!finite(item.strike) || item.strike <= 0) errors.push(`${item.id}: strike must be positive and finite`);
    if (!finite(item.entryPrice) || item.entryPrice < 0) errors.push(`${item.id}: entry price must be non-negative and finite`);
    if (!finite(item.iv) || item.iv <= 0 || !finite(effectiveIv(state, item)) || effectiveIv(state, item) <= 0) errors.push(`${item.id}: shifted IV must be positive and finite`);
    if (item.multiplier !== 100) errors.push(`${item.id}: only standard 100-multiplier contracts are supported`);
    const expiry = timestamp(item.expiry);
    if (!Number.isFinite(expiry) || (Number.isFinite(valuation) && expiry <= valuation)) errors.push(`${item.id}: expiry must follow valuation`);
    else if (!construction || !excludedIds.has(item.id)) earliest = Math.min(earliest, expiry);
    expiries.add(item.expiry);
  }
  if (expiries.size > MAX_OPTION_EXPIRIES) errors.push("at most four expiries are supported");
  if (Number.isFinite(scenario) && scenario > earliest) errors.push("scenario date cannot follow the earliest expiry");
  if (!errors.length) {
    const gross = state.legs.reduce((total, item) => total + item.contracts * item.multiplier * (item.entryPrice + item.strike + state.spot + state.scenarioSpot),
      (state.feeAllowance ?? 0) + Math.abs(state.stock?.shares ?? 0) * ((state.stock?.entryPrice ?? 0) + state.spot + state.scenarioSpot));
    if (!finite(gross)) errors.push("aggregate position amounts exceed numerical range");
  }
  return errors;
}

function assertValid(state: StrategyState): void {
  const errors = validateStrategy(state);
  if (errors.length) throw new Error(errors.join("; "));
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const polynomial = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const positive = 1 - normalPdf(absolute) * polynomial;
  return value >= 0 ? positive : 1 - positive;
}

interface LegValue {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

function intrinsic(item: OptionLeg, spot: number): LegValue {
  const raw = item.type === "call" ? spot - item.strike : item.strike - spot;
  const delta = item.type === "call"
    ? spot > item.strike ? 1 : spot < item.strike ? 0 : 0.5
    : spot < item.strike ? -1 : spot > item.strike ? 0 : -0.5;
  return { price: Math.max(0, raw), delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
}

function priceLeg(state: StrategyState, item: OptionLeg, spot: number, at: number): LegValue;
function priceLeg(state: StrategyState, item: OptionLeg, spot: number, at: number, priceOnly: true): Pick<LegValue, "price">;
function priceLeg(state: StrategyState, item: OptionLeg, spot: number, at: number, priceOnly = false): Pick<LegValue, "price"> | LegValue {
  const expiry = Date.parse(item.expiry);
  if (at >= expiry) return intrinsic(item, spot);

  const years = (expiry - at) / YEAR_MS;
  const volatility = effectiveIv(state, item);
  if (state.valuationModel === "american-crr-1024-v1") return priceOnly
    ? { price: americanPrice(item.type, spot, item.strike, years, state.rate, state.dividendYield, volatility, 1024) }
    : americanGreeks(item.type, spot, item.strike, years, state.rate, state.dividendYield, volatility, 1024);
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(spot / item.strike) + (state.rate - state.dividendYield + 0.5 * volatility * volatility) * years) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  const discountedSpot = spot * Math.exp(-state.dividendYield * years);
  const discountedStrike = item.strike * Math.exp(-state.rate * years);
  const price = item.type === "call"
    ? discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2)
    : discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
  if (priceOnly) return { price };
  const density = normalPdf(d1);
  const commonTheta = -(discountedSpot * density * volatility) / (2 * rootTime);

  if (item.type === "call") {
    return {
      price,
      delta: Math.exp(-state.dividendYield * years) * normalCdf(d1),
      gamma: spot === 0 ? 0 : Math.exp(-state.dividendYield * years) * density / (spot * volatility * rootTime),
      theta: (commonTheta - state.rate * discountedStrike * normalCdf(d2) + state.dividendYield * discountedSpot * normalCdf(d1)) / 365,
      vega: discountedSpot * density * rootTime / 100,
      rho: discountedStrike * normalCdf(d2) * years / 100,
    };
  }
  return {
    price,
    delta: Math.exp(-state.dividendYield * years) * (normalCdf(d1) - 1),
    gamma: spot === 0 ? 0 : Math.exp(-state.dividendYield * years) * density / (spot * volatility * rootTime),
    theta: (commonTheta + state.rate * discountedStrike * normalCdf(-d2) - state.dividendYield * discountedSpot * normalCdf(-d1)) / 365,
    vega: discountedSpot * density * rootTime / 100,
    rho: -discountedStrike * normalCdf(-d2) * years / 100,
  };
}

function entryCost(state: StrategyState): number {
  return state.legs.reduce((total, item) => total + (item.side === "long" ? 1 : -1) * item.entryPrice * item.contracts * item.multiplier, (state.stock?.shares ?? 0) * (state.stock?.entryPrice ?? 0));
}

export type PnlDisplayMode = "pnl" | "position-value" | "risk-percent";

export function pnlDisplayBasis(state: StrategyState, mode: PnlDisplayMode): { label: string; unit: "USD" | "%"; scale: number; offset: number; denominator: number | null } | null {
  assertValid(state);
  if (mode === "pnl") return { label: "P/L", unit: "USD", scale: 1, offset: 0, denominator: null };
  if (mode === "position-value") return { label: "Position value", unit: "USD", scale: 1, offset: entryCost(state) + (state.feeAllowance ?? 0), denominator: null };
  if (state.legs.length && new Set(state.legs.map(leg => leg.expiry)).size !== 1) return null;
  const loss = exactExpiration(state).maxLoss;
  return loss !== null && loss > 0 ? { label: "P/L / max loss", unit: "%", scale: 100 / loss, offset: 0, denominator: loss } : null;
}

function strategyAt(state: StrategyState, spot: number, at: number): { value: number; pnl: number; delta: number; gamma: number; theta: number; vega: number; rho: number } {
  const entry = entryCost(state);
  let value = (state.stock?.shares ?? 0) * spot;
  let delta = state.stock?.shares ?? 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  let rho = 0;
  for (const item of state.legs) {
    const priced = priceLeg(state, item, spot, at);
    const signedContracts = (item.side === "long" ? 1 : -1) * item.contracts * item.multiplier;
    value += priced.price * signedContracts;
    delta += priced.delta * signedContracts;
    gamma += priced.gamma * signedContracts;
    theta += priced.theta * signedContracts;
    vega += priced.vega * signedContracts;
    rho += priced.rho * signedContracts;
  }
  return { value, pnl: value - entry - (state.feeAllowance ?? 0), delta, gamma, theta, vega, rho };
}

function firstExpiry(state: StrategyState): number {
  return Math.min(...state.legs.map((item) => Date.parse(item.expiry)));
}

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new Error("calculation exceeds numerical range");
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(8));
}

export function evaluateScenario(state: StrategyState) {
  assertValid(state);
  const scenario = strategyAt(state, state.scenarioSpot, Date.parse(state.scenarioDate));
  return {
    pnl: rounded(scenario.pnl),
    delta: rounded(scenario.delta),
    gamma: rounded(scenario.gamma),
    theta: rounded(scenario.theta),
    vega: rounded(scenario.vega),
    rho: rounded(scenario.rho),
  };
}

function strategyValue(state: StrategyState, spot: number, at: number): number {
  return state.legs.reduce((total, item) => total + priceLeg(state, item, spot, at, true).price * ((item.side === "long" ? 1 : -1) * item.contracts * item.multiplier), (state.stock?.shares ?? 0) * spot);
}

export function payoffSeries(state: StrategyState, min: number, max: number, steps: number, at?: number): PayoffPoint[] {
  const { spots, date } = scenarioGrid(state, min, max, steps, at);
  const entry = entryCost(state);
  return spots.map(spot => {
    const value = strategyValue(state, spot, date);
    return { spot: rounded(spot), pnl: rounded(value - entry - (state.feeAllowance ?? 0)) };
  });
}

function scenarioGrid(state: StrategyState, min: number, max: number, steps: number, at?: number) {
  assertValid(state);
  if (!finite(min) || !finite(max) || min < 0 || max <= min) throw new Error("payoff range must be finite, non-negative, and increasing");
  if (!Number.isInteger(steps) || steps < 1 || steps > 10_000) throw new Error("steps must be an integer from 1 to 10000");
  if (at === undefined) at = state.legs.length ? firstExpiry(state) : Date.parse(state.scenarioDate);
  if (!finite(at) || at < Date.parse(state.valuationTimestamp) || (state.legs.length > 0 && at > firstExpiry(state))) throw new Error("payoff date must be between valuation and first expiry");
  return { date: at, spots: Array.from({ length: steps + 1 }, (_, index) => min + ((max - min) * index) / steps) };
}

export function scenarioSeries(state: StrategyState, min: number, max: number, steps: number, at?: number) {
  const { spots, date } = scenarioGrid(state, min, max, steps, at);
  return spots.map(spot => {
    const scenario = strategyAt(state, spot, date);
    return {
      spot: rounded(spot), pnl: rounded(scenario.pnl), delta: rounded(scenario.delta),
      gamma: rounded(scenario.gamma), theta: rounded(scenario.theta), vega: rounded(scenario.vega), rho: rounded(scenario.rho),
    };
  });
}

export function scenarioCurve(state: StrategyState, min: number, max: number, metric: keyof ReturnType<typeof evaluateScenario>, at = Date.parse(state.scenarioDate)) {
  if (state.valuationModel === "american-crr-1024-v1" && metric !== "pnl") {
    const { spots, date } = scenarioGrid(state, min, max, 160, at);
    const valueAt = (spot: number) => rounded(state.legs.reduce((total, leg) => total + americanGreeks(leg.type, spot, leg.strike, Math.max(0, Date.parse(leg.expiry) - date) / YEAR_MS, state.rate, state.dividendYield, effectiveIv(state, leg), 1024, metric) * (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier, metric === "delta" ? state.stock?.shares ?? 0 : 0));
    const samples = new Map(spots.map(spot => [rounded(spot), valueAt(spot)]));
    for (const spot of new Set([state.scenarioSpot, ...state.legs.map(leg => leg.strike)])) if (spot > 0 && spot >= min && spot <= max) samples.set(spot, valueAt(spot));
    return [...samples].sort(([left], [right]) => left - right).map(([spot, value]) => ({ spot, value }));
  }
  const samples = new Map(metric === "pnl" ? payoffSeries(state, min, max, 160, at).map(point => [point.spot, point.pnl]) : scenarioSeries(state, min, max, 160, at).map(point => [point.spot, point[metric]]));
  for (const spot of new Set([state.scenarioSpot, ...state.legs.map(leg => leg.strike)])) {
    if (spot > 0 && spot >= min && spot <= max) samples.set(spot, evaluateScenario({ ...state, scenarioSpot: spot, scenarioDate: new Date(at).toISOString() })[metric]);
  }
  return [...samples].sort(([left], [right]) => left - right).map(([spot, value]) => ({ spot, value }));
}

export function scenarioHeatmap(state: StrategyState, range?: ChartRange) {
  assertValid(state);
  if (!state.legs.length) throw new Error("Stock-only heatmap unavailable: no option expiry horizon.");
  if (range !== undefined && !isChartRange(range)) throw new Error("Invalid chart range");
  const min = range?.min ?? Math.min(state.spot * .76, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const max = range?.max ?? Math.max(state.spot * 1.24, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const start = Date.parse(state.valuationTimestamp), end = firstExpiry(state);
  return Array.from({ length: 18 }, (_, row) => {
    const date = new Date(start + (end - start) * row / 17).toISOString();
    if (range) return Array.from({ length: 44 }, (_, col) => {
      const spot = col === 43 ? max : min + (max - min) * col / 43;
      return { spot, date, pnl: rounded(strategyValue(state, spot, Date.parse(date)) - entryCost(state) - (state.feeAllowance ?? 0)) };
    });
    return payoffSeries(state, min, max, 43, Date.parse(date)).map(({ pnl }, col) => ({ spot: min + (max - min) * col / 43, date, pnl }));
  }).flat();
}

export function scenarioSpots(state: StrategyState, range?: ChartRange) {
  assertValid(state);
  if (range !== undefined && !isChartRange(range)) throw new Error("Invalid chart range");
  const anchors = [state.spot, state.scenarioSpot, ...state.legs.map(leg => leg.strike)];
  const min = range?.min ?? Math.min(state.spot - state.spot / 10, ...anchors);
  const max = range?.max ?? Math.max(Math.min(Number.MAX_VALUE, state.spot + state.spot / 10), ...anchors);
  return [...new Set([...Array.from({ length: 11 }, (_, index) => range && index === 10 ? max : min + (max - min) * (index / 10)), ...anchors.filter(spot => spot >= min && spot <= max)])].sort((a, b) => a - b);
}

export function scenarioTable(state: StrategyState, range?: ChartRange) {
  return scenarioSpots(state, range).map(spot => ({ spot, ...evaluateScenario({ ...state, scenarioSpot: spot }) }));
}

export function scenarioSpotAttribution(state: StrategyState, range?: ChartRange) {
  const spots = scenarioSpots(state, range);
  const at = Date.parse(state.scenarioDate);
  const baselineValue = strategyValue(state, state.scenarioSpot, at);
  return {
    baseline: { spot: state.scenarioSpot, date: state.scenarioDate, ivShift: state.ivShift, ...(state.expiryIvShifts?.length ? { expiryIvShifts: structuredClone(state.expiryIvShifts) } : {}) },
    basis: "Modeled spot-only P/L change from selected scenario. Same position, date, IV, rates and held costs. Stock plus option repricing contributions reconcile to total, subject to rounding. Not realized returns, market-causal attribution, delta-times-move approximation or guaranteed hedge protection.",
    rows: spots.map(spot => {
      const pnlChange = rounded(strategyValue(state, spot, at) - baselineValue);
      const stockChange = rounded((state.stock?.shares ?? 0) * (spot - state.scenarioSpot));
      return { spot, pnlChange, stockChange, optionChange: rounded(pnlChange - stockChange) };
    }),
  };
}

function expirationValue(state: StrategyState, spot: number): number {
  return state.legs.reduce((value, leg) => value + intrinsic(leg, spot).price * ((leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier), (state.stock?.shares ?? 0) * spot);
}

function exactExpiration(state: StrategyState): { maxProfit: number | null; maxLoss: number | null; breakevens: number[] } {
  const entry = entryCost(state);
  const strikes = [...new Set(state.legs.map((item) => item.strike))].sort((a, b) => a - b);
  const points = [0, ...strikes];
  const values = points.map((spot) => expirationValue(state, spot) - entry - (state.feeAllowance ?? 0));
  const roots: number[] = [];
  const addRoot = (root: number) => {
    if (root >= 0 && !roots.some((value) => Math.abs(value - root) < 1e-7)) roots.push(rounded(root));
  };

  for (let index = 0; index < points.length; index += 1) {
    if (Math.abs(values[index]) < 1e-8) addRoot(points[index]);
    if (index === points.length - 1 || values[index] * values[index + 1] >= 0) continue;
    const root = points[index] - values[index] * (points[index + 1] - points[index]) / (values[index + 1] - values[index]);
    addRoot(root);
  }

  const lastSpot = points.at(-1)!;
  const lastValue = values.at(-1)!;
  const tailSlope = state.legs.reduce(
    (total, item) => total + (item.type === "call" ? (item.side === "long" ? 1 : -1) * item.contracts * item.multiplier : 0),
    state.stock?.shares ?? 0,
  );
  if (Math.abs(tailSlope) > 1e-12) {
    const root = lastSpot - lastValue / tailSlope;
    if (root >= lastSpot) addRoot(root);
  }

  const finiteMax = Math.max(...values);
  const finiteMin = Math.min(...values);
  return {
    maxProfit: tailSlope > 0 ? null : rounded(Math.max(0, finiteMax)),
    maxLoss: tailSlope < 0 ? null : rounded(Math.max(0, -finiteMin)),
    breakevens: roots.sort((a, b) => a - b),
  };
}

export function expirationProbability(state: StrategyState, range?: { lower: number; upper: number }, volatilityReference?: Pick<MarketContract, "iv" | "contractId" | "expiry">) {
  assertValid(state);
  return probabilityFromValidatedState(state, range, volatilityReference);
}

function probabilityFromValidatedState(state: StrategyState, range?: { lower: number; upper: number }, volatilityReference?: Pick<MarketContract, "iv" | "contractId" | "expiry">) {
  if (range && (!finite(range.lower) || !finite(range.upper) || range.lower <= 0 || range.upper <= range.lower)) throw new Error("Price range must have positive finite increasing bounds.");
  if (!state.legs.length) return { probability: null, reason: "Stock-only probability unavailable: no option expiry or volatility reference.", spot: state.scenarioSpot, from: state.scenarioDate, expiry: null, feeAllowance: state.feeAllowance ?? 0, volatility: null, volatilityContractId: null, rate: state.rate, dividendYield: state.dividendYield, basis: "Stock marked at selected scenario spot; no terminal distribution or expiry is inferred.", priceRange: null };
  let priceRange: { lower: number; upper: number; below: number; between: number; above: number } | null = null;
  const reference = volatilityReference ?? [...state.legs].sort((a, b) => Math.abs(a.strike - state.scenarioSpot) - Math.abs(b.strike - state.scenarioSpot) || a.contractId.localeCompare(b.contractId))[0];
  const volatility = effectiveIv(state, reference);
  const expiry = firstExpiry(state);
  if (volatilityReference && (!finite(volatility) || volatility <= 0 || typeof reference.contractId !== "string" || !reference.contractId || Date.parse(reference.expiry) !== expiry)) throw new Error("Invalid probability volatility reference");
  const years = (expiry - Date.parse(state.scenarioDate)) / YEAR_MS;
  const assumptions = {
    spot: state.scenarioSpot, from: state.scenarioDate, expiry: reference.expiry,
    feeAllowance: state.feeAllowance ?? 0,
    volatility, volatilityContractId: reference.contractId, rate: state.rate, dividendYield: state.dividendYield,
    basis: `Conditional risk-neutral lognormal model from selected scenario to common expiry. ${volatilityReference ? "Shared quoted-window reference IV" : "Nearest-strike leg IV"} plus global and matching expiry shifts; ties use contract ID. Constant volatility/rate/yield; no smile, jumps, discrete dividends or assignment. Supplied flat cost allowance is deducted; actual broker fees are not estimated. Positive intact-position P/L against held/estimated entry costs, not a forecast, historical win rate, touch probability or trading edge.`,
  };
  const result = (probability: number | null, reason: string | null = null) => ({ probability, reason, ...assumptions, priceRange });
  if (state.legs.some(leg => Date.parse(leg.expiry) !== expiry)) return result(null, "Mixed-expiry probability is not calculated.");
  const entry = entryCost(state);
  if (years === 0) {
    if (range) priceRange = { ...range, below: Number(state.scenarioSpot < range.lower), between: Number(state.scenarioSpot >= range.lower && state.scenarioSpot <= range.upper), above: Number(state.scenarioSpot > range.upper) };
    return result(expirationValue(state, state.scenarioSpot) - entry - (state.feeAllowance ?? 0) > 0 ? 1 : 0);
  }
  const deviation = volatility * Math.sqrt(years);
  const drift = (state.rate - state.dividendYield - volatility * volatility / 2) * years;
  if (!Number.isFinite(deviation) || !Number.isFinite(drift) || deviation <= 0) return result(null, "Distribution inputs exceed the numerical range.");
  const cdf = (spot: number) => spot <= 0 ? 0 : spot === Infinity ? 1 : normalCdf((Math.log(spot) - Math.log(state.scenarioSpot) - drift) / deviation);
  if (range) {
    const below = cdf(range.lower), throughUpper = cdf(range.upper);
    priceRange = { ...range, below, between: Math.max(0, throughUpper - below), above: 1 - throughUpper };
  }
  const points = [0, ...new Set(state.legs.map(leg => leg.strike))].sort((a, b) => a - b);
  let probability = 0;
  for (let index = 0; index < points.length; index++) {
    let lower = points[index], upper = points[index + 1] ?? Infinity;
    const pnl = expirationValue(state, lower) - entry - (state.feeAllowance ?? 0);
    const slope = state.legs.reduce((total, leg) => total + (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier * (leg.type === "call" ? Number(lower >= leg.strike) : -Number(lower < leg.strike)), state.stock?.shares ?? 0);
    if (!Number.isFinite(pnl) || !Number.isFinite(slope)) return result(null, "Payoff exceeds the numerical range.");
    if (slope === 0) { if (pnl <= 0) continue; }
    else {
      const root = lower - pnl / slope;
      if (slope > 0) lower = Math.max(lower, root);
      else upper = Math.min(upper, root);
    }
    if (upper > lower) probability += cdf(upper) - cdf(lower);
  }
  return result(Math.max(0, Math.min(1, probability)));
}

export function expirationDistribution(state: StrategyState) {
  const facts = expirationProbability(state);
  const empty = (reason: string | null, pointMass: number | null = null) => ({ points: [] as { spot: number; density: number }[], omittedMass: null as number | null, pointMass, reason });
  if (facts.reason || facts.expiry === null || facts.volatility === null) return empty(facts.reason);
  const years = (Date.parse(facts.expiry) - Date.parse(facts.from)) / YEAR_MS;
  if (years === 0) return empty(null, facts.spot);
  const deviation = facts.volatility * Math.sqrt(years);
  const mean = Math.log(facts.spot) + (facts.rate - facts.dividendYield - facts.volatility ** 2 / 2) * years;
  const lowZ = Math.min(-4, -deviation);
  const low = Math.exp(mean + lowZ * deviation), high = Math.exp(mean + 4 * deviation);
  if (!(low > 0) || !Number.isFinite(high) || high <= low) return empty("Distribution curve exceeds the numerical range.");
  // ponytail: 257 log-spaced samples plus exact mode; adaptive rendering if extreme skew needs finer geometry.
  const zValues = [...new Set([...Array.from({ length: 257 }, (_, index) => lowZ + (4 - lowZ) * index / 256), -deviation, 0])].sort((a, b) => a - b);
  const points = zValues.map(z => {
    const logSpot = mean + z * deviation;
    return { spot: Math.exp(logSpot), density: Math.exp(-z * z / 2 - Math.log(2 * Math.PI) / 2 - logSpot - Math.log(deviation)) };
  });
  if (points.some(point => !Number.isFinite(point.density)) || !points.some(point => point.density > 0)) return empty("Distribution density exceeds the numerical range.");
  return { points, omittedMass: normalCdf(lowZ) + normalCdf(-4), pointMass: null, reason: null };
}

export function scenarioFacts(state: StrategyState) {
  assertValid(state);
  const at = Date.parse(state.scenarioDate);
  const later = state.legs.length ? Math.min(at + DAY_MS, firstExpiry(state)) : at;
  const current = strategyAt(state, state.scenarioSpot, at);
  const future = later > at ? strategyAt(state, state.scenarioSpot, later) : null;
  const intrinsicValue = state.legs.reduce((sum, item) => sum + intrinsic(item, state.scenarioSpot).price * (item.side === "long" ? 1 : -1) * item.contracts * item.multiplier, 0);
  const stockValue = (state.stock?.shares ?? 0) * state.scenarioSpot;
  return {
    date: state.scenarioDate,
    valuationModel: state.valuationModel ?? "european-bsm-v1",
    spot: state.scenarioSpot,
    basis: !state.legs.length ? "Stock-only mark at the selected scenario spot. P/L subtracts held entry cost and the supplied allowance once; no option expiry, dividend, financing, borrow or assignment cashflows are modeled." : (state.valuationModel === "american-crr-1024-v1"
      ? "American CRR 1024-step model at the scenario date/spot/IV with continuous dividend yield; not entry cost or an executable quote. Early-exercise valuation does not model assignment, discrete dividends or lifecycle cashflows."
      : "European model at the scenario date/spot/IV; not entry cost or an executable quote. Model value minus intrinsic can be negative under European carry assumptions.") + " Within the selected model, at fixed contract terms, scenario spot/date, effective IV, rate and yield, option valuation has no historical price-path input. Position P/L additionally uses signed quantities, held entry costs and the allowance. Missing mixed-expiry extrema are an engine limitation, not evidence of path dependence or mathematical impossibility.",
    valuation: {
      signedEntryEstimate: rounded(entryCost(state)),
      ...(state.feeAllowance !== undefined ? { feeAllowance: state.feeAllowance } : {}),
      signedModelValue: rounded(current.value),
      signedIntrinsicValue: rounded(intrinsicValue),
      signedModelResidual: rounded(current.value - stockValue - intrinsicValue),
      ...(state.stock ? { signedStockValue: rounded(stockValue), stockBasis: "Held per-share cost assumption, not a verified fill. Stock marked at scenario spot; no dividend, financing, borrow or assignment cashflows." } : {}),
      modelPnl: rounded(current.pnl),
      entryBasis: state.pricing?.entryMode === "fixed" ? "User-held entry costs; not broker-verified fills or tax basis." : state.pricing?.mode === "market"
        ? state.pricing.basis === "natural" ? "Natural estimate: buy at ask / sell at bid; not a fill." : "Midpoint quote entry estimate; not a fill."
        : "Sample/manual entry estimate; not a fill.",
    },
    legs: state.legs.map(item => {
      const priced = priceLeg(state, item, state.scenarioSpot, at);
      const value = priced.price;
      const signedContracts = (item.side === "long" ? 1 : -1) * item.contracts * item.multiplier;
      const intrinsicValue = intrinsic(item, state.scenarioSpot).price;
      return {
        legId: item.id,
        greeks: {
          delta: rounded(priced.delta * signedContracts),
          gamma: rounded(priced.gamma * signedContracts),
          theta: rounded(priced.theta * signedContracts),
          vega: rounded(priced.vega * signedContracts),
          rho: rounded(priced.rho * signedContracts),
        },
        moneyness: state.scenarioSpot === item.strike ? "at-the-money" : intrinsicValue > 0 ? "in-the-money" : "out-of-the-money",
        modelValuePerShare: rounded(value),
        intrinsicPerShare: rounded(intrinsicValue),
        modelValueMinusIntrinsicPerShare: rounded(value - intrinsicValue),
        modelResidualFractionOfModelValue: value === 0 ? null : rounded((value - intrinsicValue) / value),
      };
    }),
    timeStep: future ? {
      date: new Date(later).toISOString(),
      calendarDays: (later - at) / DAY_MS,
      pnl: rounded(future.pnl),
      changeInValue: rounded(future.pnl - current.pnl),
      thetaAtStart: rounded(current.theta),
      thetaAtEnd: rounded(future.theta),
      assumptions: "Full model repricing with spot, IV, rate and yield unchanged. Capped at first expiry; not a realized forecast or constant theta times days.",
    } : null,
  };
}

export function calculateStrategy(state: StrategyState): StrategyMetrics {
  const scenario = evaluateScenario(state);
  const expiries = new Set(state.legs.map((item) => item.expiry));
  const mode = !state.legs.length ? "spot" : expiries.size === 1 ? "expiration" : "first-expiry";
  const entry = entryCost(state);
  const strikes = state.legs.map((item) => item.strike);
  const domainMin = Math.max(0, Math.min(state.spot, ...strikes) * 0.5);
  const domainMax = Math.max(state.spot, ...strikes) * 1.5;
  const modeled = payoffSeries(state, domainMin, domainMax, 200);
  const low = modeled.reduce((a, b) => b.pnl < a.pnl ? b : a);
  const high = modeled.reduce((a, b) => b.pnl > a.pnl ? b : a);
  const exact = mode !== "first-expiry" ? exactExpiration(state) : null;

  return {
    entryLabel: entry >= 0 ? "Debit" : "Credit",
    entryAmount: rounded(Math.abs(entry)),
    entryAccounting: {
      grossEntryCashFlow: rounded(-entry),
      costAllowance: rounded(state.feeAllowance ?? 0),
      netEntryCashFlowAfterAllowance: rounded(-entry - (state.feeAllowance ?? 0)),
      convention: "USD; positive means cash received, negative means cash paid. Gross entry excludes the supplied cost allowance; net subtracts it once. Allowance is a modeled deduction, not a verified fill or broker fee.",
    },
    maxProfit: exact?.maxProfit ?? null,
    maxLoss: exact?.maxLoss ?? null,
    breakevens: exact?.breakevens ?? [],
    delta: scenario.delta,
    gamma: scenario.gamma,
    theta: scenario.theta,
    vega: scenario.vega,
    rho: scenario.rho,
    mode,
    modeledLow: low.pnl,
    modeledHigh: high.pnl,
    sampledRange: { kind: "sampled-model-range", date: mode === "spot" ? state.scenarioDate : new Date(firstExpiry(state)).toISOString(), spotMin: domainMin, spotMax: domainMax, pointCount: modeled.length, low, high },
    scenarioPnl: scenario.pnl,
    ...(mode === "first-expiry" ? { conditionalTail: firstExpiryTail(state) } : {}),
  };
}

function firstExpiryContext(state: StrategyState, input: { min: number; max: number; tolerance: number; maxEvaluations: number }) {
  assertValid(state);
  if (!input || !finite(input.min) || input.min < 0 || !finite(input.max) || input.max <= input.min || !finite(input.tolerance) || input.tolerance <= 0 || !Number.isInteger(input.maxEvaluations) || input.maxEvaluations < 2 || input.maxEvaluations > 1024) throw new Error("Invalid first-expiry range request");
  const quantities = state.legs.map(leg => (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier);
  if (!quantities.every(Number.isSafeInteger) || !Number.isSafeInteger(quantities.reduce((sum, quantity) => sum + Math.abs(quantity), Math.abs(state.stock?.shares ?? 0)))) throw new Error("Unsafe first-expiry range quantities");
  const at = firstExpiry(state), cost = entryCost(state) + (state.feeAllowance ?? 0), shares = state.stock?.shares ?? 0;
  const anchors = [...new Set([input.min, input.max, ...state.legs.map(leg => leg.strike).filter(strike => strike > input.min && strike < input.max)])].sort((a, b) => a - b);
  if (anchors.length > input.maxEvaluations || !finite(cost)) throw new Error("First-expiry range budget or costs invalid");
  type Point = { spot: number; pnl: number; prices: number[] };
  const cache = new Map<number, Point>();
  const point = (spot: number) => {
    const cached = cache.get(spot);
    if (cached) return cached;
    const prices = state.legs.map(leg => priceLeg(state, leg, spot, at, true).price);
    const pnl = prices.reduce((sum, price, i) => sum + quantities[i] * price, shares * spot - cost);
    if (![...prices, pnl].every(Number.isFinite)) throw new Error("First-expiry range outside numerical domain");
    const value = { spot, pnl, prices };
    cache.set(spot, value);
    return value;
  };
  const points = anchors.map(point);
  const interval = (a: Point, b: Point, previous?: Point, next?: Point) => {
    let lowA = shares * a.spot - cost, lowB = shares * b.spot - cost;
    let highA = lowA, highB = lowB;
    state.legs.forEach((leg, i) => {
      const left = quantities[i] * a.prices[i], right = quantities[i] * b.prices[i];
      const expired = Date.parse(leg.expiry) <= at;
      let supportA = Math.min(a.prices[i], b.prices[i]), supportB = supportA;
      if (!expired) {
        const support = (candidateA: number, candidateB: number) => {
          if (![candidateA, candidateB].every(Number.isFinite)) throw new Error("First-expiry range outside numerical domain");
          if (candidateA / 2 + candidateB / 2 > supportA / 2 + supportB / 2) { supportA = candidateA; supportB = candidateB; }
        };
        if (previous) support(a.prices[i], a.prices[i] + (a.prices[i] - previous.prices[i]) / (a.spot - previous.spot) * (b.spot - a.spot));
        if (next) support(b.prices[i] - (next.prices[i] - b.prices[i]) / (next.spot - b.spot) * (b.spot - a.spot), b.prices[i]);
      }
      lowA += expired || quantities[i] < 0 ? left : quantities[i] * supportA;
      lowB += expired || quantities[i] < 0 ? right : quantities[i] * supportB;
      highA += expired || quantities[i] > 0 ? left : quantities[i] * supportA;
      highB += expired || quantities[i] > 0 ? right : quantities[i] * supportB;
    });
    if (![lowA, lowB, highA, highB].every(Number.isFinite)) throw new Error("First-expiry range outside numerical domain");
    return { a, b, lower: Math.min(lowA, lowB, a.pnl, b.pnl), upper: Math.max(highA, highB, a.pnl, b.pnl), interiorExcluded: lowA >= 0 && lowB >= 0 && (lowA > 0 || lowB > 0) || highA <= 0 && highB <= 0 && (highA < 0 || highB < 0) };
  };
  return { at, cache, point, points, interval };
}

export function firstExpiryRange(state: StrategyState, input: { min: number; max: number; tolerance: number; maxEvaluations: number }) {
  const { at, cache, point, points, interval } = firstExpiryContext(state, input);
  let minimum = points.reduce((best, value) => value.pnl < best.pnl ? value : best);
  let maximum = points.reduce((best, value) => value.pnl > best.pnl ? value : best);
  let lower = 0, upper = 0;
  while (true) {
    const intervals = points.slice(1).map((value, i) => interval(points[i], value, points[i - 1], points[i + 2]));
    lower = Math.min(...intervals.map(value => value.lower), minimum.pnl);
    upper = Math.max(...intervals.map(value => value.upper), maximum.pnl);
    if (minimum.pnl - lower <= input.tolerance && upper - maximum.pnl <= input.tolerance || cache.size >= input.maxEvaluations) break;
    let selected = -1, threat = -Infinity;
    intervals.forEach((value, i) => {
      const midpoint = value.a.spot + (value.b.spot - value.a.spot) / 2;
      const gap = Math.max(minimum.pnl - value.lower, value.upper - maximum.pnl);
      if (midpoint > value.a.spot && midpoint < value.b.spot && gap > threat) { selected = i; threat = gap; }
    });
    if (selected < 0) throw new Error("First-expiry range exceeds numerical spot resolution");
    const current = intervals[selected];
    const midpoint = point(current.a.spot + (current.b.spot - current.a.spot) / 2);
    if (midpoint.pnl < minimum.pnl) minimum = midpoint;
    if (midpoint.pnl > maximum.pnl) maximum = midpoint;
    points.splice(selected + 1, 0, midpoint);
  }
  return {
    date: new Date(at).toISOString(), spotMin: input.min, spotMax: input.max, tolerance: input.tolerance, evaluations: cache.size,
    status: minimum.pnl - lower <= input.tolerance && upper - maximum.pnl <= input.tolerance ? "tolerance-met" as const : "budget-exhausted" as const,
    minimum: { lower, upper: minimum.pnl, at: { spot: minimum.spot, pnl: minimum.pnl } },
    maximum: { lower: maximum.pnl, upper, at: { spot: maximum.spot, pnl: maximum.pnl } },
    basis: "Conditional intact-position first-expiry P/L on the stated finite spot domain with fixed effective IV, rate and continuous yield. Signed per-leg monotonic endpoint and convex secant enclosures; tolerance measures the remaining search gap, excluding pricing approximation and floating-point roundoff. Not certified numerical bounds, out-of-domain extrema, lifetime risk, assignment, settlement or executable liquidation. Includes signed stock, held entry costs and supplied allowance once.",
  };
}

export function firstExpiryBreakevens(state: StrategyState, input: { min: number; max: number; spotTolerance: number; maxEvaluations: number }) {
  const { at, cache, point, points, interval } = firstExpiryContext(state, { ...input, tolerance: input?.spotTolerance });
  type Band = { lower: number; upper: number; lowerPnl: number; upperPnl: number; kind: "sign-changing" | "unresolved" };
  let candidates: Band[] = [];
  while (true) {
    const leaves = points.slice(1).map((value, i) => ({ ...interval(points[i], value, points[i - 1], points[i + 2]), index: i }))
      .filter(value => value.lower <= 0 && value.upper >= 0 && !value.interiorExcluded);
    candidates = [];
    for (const leaf of leaves) {
      const previous = candidates.at(-1);
      if (previous && previous.upper === leaf.a.spot) { previous.upper = leaf.b.spot; previous.upperPnl = leaf.b.pnl; }
      else candidates.push({ lower: leaf.a.spot, upper: leaf.b.spot, lowerPnl: leaf.a.pnl, upperPnl: leaf.b.pnl, kind: "unresolved" });
    }
    for (const band of candidates) if (band.lowerPnl < 0 && band.upperPnl > 0 || band.lowerPnl > 0 && band.upperPnl < 0) band.kind = "sign-changing";
    const wide = candidates.filter(band => band.upper - band.lower > input.spotTolerance);
    if (!wide.length || cache.size >= input.maxEvaluations) break;
    let selected: typeof leaves[number] | undefined;
    for (const leaf of leaves) {
      const middle = leaf.a.spot + (leaf.b.spot - leaf.a.spot) / 2;
      if (middle > leaf.a.spot && middle < leaf.b.spot && wide.some(band => leaf.a.spot >= band.lower && leaf.b.spot <= band.upper)
        && (!selected || leaf.b.spot - leaf.a.spot > selected.b.spot - selected.a.spot)) selected = leaf;
    }
    if (!selected) throw new Error("First-expiry breakevens exceed numerical spot resolution");
    points.splice(selected.index + 1, 0, point(selected.a.spot + (selected.b.spot - selected.a.spot) / 2));
  }
  return {
    date: new Date(at).toISOString(), spotMin: input.min, spotMax: input.max, spotTolerance: input.spotTolerance, evaluations: cache.size,
    status: candidates.every(band => band.upper - band.lower <= input.spotTolerance) ? "spot-tolerance-met" as const : "budget-exhausted" as const,
    evaluatedZeros: points.filter(value => value.pnl === 0).map(value => value.spot), candidates,
    basis: "Conditional intact-position first-expiry numerical breakeven candidates only within the stated spot domain, with fixed effective IV, model, rate and continuous yield. Signed stock, held entry costs and allowance are included once. Sign-changing bands do not establish root uniqueness; unresolved bands may contain crossings, tangencies, flat zero regions or no root. Evaluated zeros are numerical samples, not certified exact roots. Spot tolerance limits merged candidate width, not pricing error. Not certified root isolation or complete mathematical root counts: pricing approximation and floating-point roundoff are excluded. No out-of-domain, lifetime, assignment, settlement or execution claims.",
  };
}

function firstExpiryTail(state: StrategyState): NonNullable<StrategyMetrics["conditionalTail"]> {
  const at = firstExpiry(state), model = state.valuationModel ?? "european-bsm-v1";
  const carry = model === "american-crr-1024-v1" ? Math.min(0, state.dividendYield) : state.dividendYield;
  let baseSlope = state.stock?.shares ?? 0;
  const futureCalls = new Map<number, number>();
  let safeQuantities = true;
  let intercept = -entryCost(state) - (state.feeAllowance ?? 0);
  for (const leg of state.legs) {
    const quantity = (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier;
    safeQuantities &&= Number.isSafeInteger(quantity);
    if (leg.type !== "call") continue;
    const expiry = Date.parse(leg.expiry), years = (expiry - at) / YEAR_MS, future = expiry > at;
    baseSlope += quantity;
    if (future) futureCalls.set(expiry, (futureCalls.get(expiry) ?? 0) + quantity);
    safeQuantities &&= Number.isSafeInteger(baseSlope) && (!future || Number.isSafeInteger(futureCalls.get(expiry)));
    const discount = !future || (model === "american-crr-1024-v1" && state.dividendYield > 0) ? 1
      : model === "american-crr-1024-v1" && state.dividendYield === 0 ? Math.exp(Math.min(0, -state.rate * years)) : Math.exp(-state.rate * years);
    intercept -= quantity * leg.strike * discount;
  }
  // Aggregate matching maturities before applying carry so exact offsets cancel.
  let correction = 0, correctionMagnitude = 0;
  for (const [expiry, quantity] of [...futureCalls].sort(([a], [b]) => a - b)) {
    const years = (expiry - at) / YEAR_MS;
    const term = quantity === 0 ? 0 : quantity * Math.expm1(-carry * years);
    correction += term;
    correctionMagnitude += Math.abs(term);
  }
  const slope = baseSlope + correction;
  const zeroSpotPnl = strategyValue(state, 0, at) - entryCost(state) - (state.feeAllowance ?? 0);
  const finiteLimit = baseSlope === 0 && (carry === 0 || [...futureCalls.values()].every(quantity => quantity === 0));
  const resolved = [slope, intercept, zeroSpotPnl].every(Number.isFinite) && safeQuantities
    && (finiteLimit || Math.abs(slope) > 8 * Number.EPSILON * (Math.abs(baseSlope) + correctionMagnitude));
  return {
    date: new Date(at).toISOString(), model,
    zeroSpotPnl: resolved ? rounded(zeroSpotPnl) : null,
    slope: resolved ? slope : null, intercept: resolved ? intercept : null,
    outcome: !resolved ? "numerically-unresolved" : finiteLimit ? "finite-limit" : slope < 0 ? "loss-unbounded" : "profit-unbounded",
    basis: "Conditional intact-position P/L at first expiry. Expiring options use intrinsic; surviving options use the selected model with fixed effective IV, rate and continuous yield. Upper-tail P/L approaches slope times spot plus intercept as spot tends to infinity; it need not describe practical prices. Zero-spot P/L is a separate endpoint. A finite upper-tail limit is not a maximum or a loss cap; interior extrema are not established. Includes signed shares, entry costs and supplied allowance once. Not lifetime risk, executable liquidation, discrete dividends, assignment or settlement cashflows.",
  };
}

export class CandidateSearchLimitError extends Error {
  constructor() { super("Candidate search exceeds 300,000 structures; narrow the quoted strike/expiry window"); }
}

export function firstExpirySpreadLossBound(state: StrategyState) {
  assertValid(state);
  const short = state.legs.find(leg => leg.side === 'short'), long = state.legs.find(leg => leg.side === 'long');
  if (state.stock !== undefined || state.excludedLegIds !== undefined || state.legs.length !== 2 || !short || !long || short.type !== long.type || short.contracts !== long.contracts || Date.parse(short.expiry) >= Date.parse(long.expiry) || !Number.isSafeInteger(long.contracts * long.multiplier)) throw new Error('Unsupported first-expiry spread bound');
  const american = state.valuationModel === 'american-crr-1024-v1';
  if (!american && long.type === 'call' && state.dividendYield > 0) throw new Error('Positive-yield European call spreads have unbounded first-expiry loss');
  const years = (Date.parse(long.expiry) - Date.parse(short.expiry)) / YEAR_MS;
  const exponent = american ? 0 : (Math.min(state.dividendYield, 0) - state.rate) * years;
  if (!finite(exponent)) throw new Error('First-expiry spread bound exceeds numerical range');
  const discountedStrike = long.strike * Math.exp(exponent);
  if (!finite(discountedStrike)) throw new Error('First-expiry spread bound exceeds numerical range');
  const width = Math.max(0, long.type === 'call' ? discountedStrike - short.strike : short.strike - discountedStrike);
  const loss = entryCost(state) + (state.feeAllowance ?? 0) + long.contracts * long.multiplier * width;
  if (!finite(loss)) throw new Error('First-expiry spread bound exceeds numerical range');
  return { kind: 'conservative-first-expiry' as const, amount: Math.max(0, loss), date: short.expiry,
    basis: `Conservative intact-position loss bound at short expiry from the ${american ? 'American long option intrinsic floor' : 'European long option discounted no-arbitrage floor with fixed rate and continuous yield'}, signed entry debit and allowance. Not an attained maximum, lifetime risk, margin, executable liquidation, assignment, funding or settlement cashflows. Later position management is outside this bound.` };
}

export const CANDIDATE_OPTION_FAMILIES = ['long-call', 'long-put', 'bull-call', 'bear-call', 'bull-put', 'bear-put', 'long-straddle', 'long-strangle', 'call-butterfly', 'put-butterfly', 'short-call-butterfly', 'short-put-butterfly', 'iron-butterfly', 'inverse-iron-butterfly', 'iron-condor', 'inverse-iron-condor'] as const;
export type CandidateOptionFamily = typeof CANDIDATE_OPTION_FAMILIES[number];
export type CandidateSearchDomain = { families: Array<CandidateOptionFamily | 'options' | 'covered-call' | 'protective-put' | 'collar' | 'call-calendar' | 'put-calendar' | 'call-diagonal' | 'put-diagonal'>; maxEntryOutlay: number; resultMode?: 'best-per-family'; expiry?: string };
export function candidateOptionFamily(legs: OptionLeg[]): CandidateOptionFamily | null {
  if (!Array.isArray(legs) || !legs.length || legs.length > 4 || legs.some(leg => !leg || !['call', 'put'].includes(leg.type) || !['long', 'short'].includes(leg.side) || !finite(leg.strike) || leg.strike <= 0 || leg.multiplier !== 100 || ![1, 2].includes(leg.contracts) || typeof leg.contractId !== 'string' || !leg.contractId || !Number.isFinite(Date.parse(leg.expiry))) || new Set(legs.map(leg => leg.contractId)).size !== legs.length || new Set(legs.map(leg => leg.expiry)).size !== 1) return null;
  const sorted = [...legs].sort((a, b) => a.strike - b.strike), [low, middle, high] = sorted;
  if (legs.length === 1) return low.side === 'long' && low.contracts === 1 ? `long-${low.type}` : null;
  if (legs.length === 3) return sorted.every(leg => leg.type === low.type) && low.strike < middle.strike && middle.strike < high.strike && Math.round(low.strike * 1000) + Math.round(high.strike * 1000) === 2 * Math.round(middle.strike * 1000) && low.contracts === 1 && middle.contracts === 2 && high.contracts === 1 && low.side === high.side && low.side !== middle.side ? `${low.side === 'short' ? 'short-' : ''}${low.type}-butterfly` : null;
  if (legs.some(leg => leg.contracts !== 1)) return null;
  if (legs.length === 2) {
    if (low.type === middle.type) return low.strike < middle.strike && low.side !== middle.side ? `${low.side === 'long' ? 'bull' : 'bear'}-${low.type}` : null;
    const put = legs.find(leg => leg.type === 'put')!, call = legs.find(leg => leg.type === 'call')!;
    return put.side === 'long' && call.side === 'long' && put.strike <= call.strike ? `long-${put.strike === call.strike ? 'straddle' : 'strangle'}` : null;
  }
  const puts = sorted.filter(leg => leg.type === 'put'), calls = sorted.filter(leg => leg.type === 'call');
  if (puts.length !== 2 || calls.length !== 2 || puts[0].strike >= puts[1].strike || calls[0].strike >= calls[1].strike || puts[1].strike > calls[0].strike || puts[0].side !== calls[1].side || puts[1].side !== calls[0].side || puts[0].side === puts[1].side) return null;
  return `${puts[0].side === 'short' ? 'inverse-' : ''}iron-${puts[1].strike === calls[0].strike ? 'butterfly' : 'condor'}`;
}
export function candidateStrategyFamily(state: StrategyState): Exclude<CandidateSearchDomain['families'][number], 'options'> | null {
  const legs = state.legs;
  if (!Array.isArray(legs) || !legs.length || legs.some(leg => !leg || !['call', 'put'].includes(leg.type) || !['long', 'short'].includes(leg.side) || !finite(leg.strike) || leg.strike <= 0 || leg.multiplier !== 100 || typeof leg.contractId !== 'string' || !leg.contractId || !Number.isFinite(Date.parse(leg.expiry)))) return null;
  const mixed = new Set(legs.map(leg => leg.expiry)).size > 1;
  if (!state.stock && !mixed) return candidateOptionFamily(legs);
  if (legs.some(leg => leg.contracts !== 1) || new Set(legs.map(leg => leg.contractId)).size !== legs.length) return null;
  if (mixed) {
    const short = legs.find(leg => leg.side === 'short'), long = legs.find(leg => leg.side === 'long');
    return !state.stock && legs.length === 2 && short && long && short.type === long.type && Date.parse(short.expiry) < Date.parse(long.expiry) ? `${short.type}-${short.strike === long.strike ? 'calendar' : 'diagonal'}` : null;
  }
  if (state.stock?.shares !== 100) return null;
  const put = legs.find(leg => leg.type === 'put' && leg.side === 'long'), call = legs.find(leg => leg.type === 'call' && leg.side === 'short');
  return legs.length === 1 && call ? 'covered-call' : legs.length === 1 && put ? 'protective-put' : legs.length === 2 && put && call && put.strike <= call.strike ? 'collar' : null;
}
export type CandidateSelection = { id: string; request: Parameters<typeof searchCandidates>[2]; domain?: CandidateSearchDomain };
export const COMPARISON_TOPICS = ['target-pnl', 'cost-basis', 'structure', 'delta', 'gamma', 'theta', 'vega', 'rho', 'loss-bound', 'probability', 'apply-status'] as const;
export type ComparisonIntent = {
  topics: Array<typeof COMPARISON_TOPICS[number]>;
  scope: 'supplied-comparison' | 'different-scenario' | 'action' | 'unclear';
  requestedScenario: null | { spot: number | null; date: string | null; ivShift: number | null };
};
export function parseComparisonIntent(value: unknown): ComparisonIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'requestedScenario,scope,topics') return null;
  const intent = value as ComparisonIntent;
  if (!['supplied-comparison', 'different-scenario', 'action', 'unclear'].includes(intent.scope) || !Array.isArray(intent.topics) || !intent.topics.length || intent.topics.length > 5 || new Set(intent.topics).size !== intent.topics.length || intent.topics.some(topic => !COMPARISON_TOPICS.includes(topic))) return null;
  const scenario = intent.requestedScenario;
  if (scenario !== null && (!scenario || typeof scenario !== 'object' || Array.isArray(scenario) || Object.keys(scenario).sort().join() !== 'date,ivShift,spot' || scenario.spot !== null && (!finite(scenario.spot) || scenario.spot <= 0 || scenario.spot > 1_000_000) || scenario.ivShift !== null && (!finite(scenario.ivShift) || Math.abs(scenario.ivShift) > 10) || scenario.date !== null && (typeof scenario.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scenario.date) || !finite(Date.parse(scenario.date)) || new Date(scenario.date).toISOString() !== scenario.date))) return null;
  return structuredClone(intent);
}
export function renderCandidateComparison(comparison: ReturnType<typeof compareSearchCandidate>, rawIntent: ComparisonIntent) {
  const intent = parseComparisonIntent(rawIntent);
  if (!intent) throw new Error('Invalid comparison intent');
  const reply = { text: '', assumptions: [] as string[], objections: [] as string[], suggested_prompts: [] as string[] };
  if (intent.scope === 'unclear') return { ...reply, text: 'Which part of the inspected comparison should I explain: target P/L, costs, structure, Greeks, loss bounds or Apply status?' };
  if (intent.scope === 'action') reply.objections.push('This read-only discussion cannot change holdings or carry out actions. The separate candidate Apply control only replaces the builder with the inspected candidate; it does not place an order.');
  const held = comparison.baseline.state, candidate = comparison.state, requested = intent.requestedScenario;
  if (intent.scope === 'different-scenario' || requested && (requested.spot !== null && requested.spot !== held.scenarioSpot || requested.date !== null && Date.parse(requested.date) !== Date.parse(held.scenarioDate) || requested.ivShift !== null && requested.ivShift !== held.ivShift)) return { ...reply, text: 'The supplied comparison does not answer that scenario request. A new calculation is required; these existing target metrics must not be substituted for it.' };
  const money = (amount: number) => `USD ${amount.toFixed(2)}`;
  const index = held.underlyingKind === 'cash-index';
  const spotUnit = index ? 'index point' : 'USD 1 underlying move';
  const lines = [`At ${index ? `${held.scenarioSpot} index points` : `${money(held.scenarioSpot)} per share`} on ${held.scenarioDate}:`];
  const structure = (state: StrategyState) => [...state.legs.map(leg => `${leg.side} ${leg.contracts} ${leg.type} ${leg.strike} exp ${leg.expiry.slice(0, 10)}`), ...(state.stock ? [`${state.stock.shares} shares`] : [])].join('; ');
  for (const topic of intent.topics) {
    if (topic === 'target-pnl') lines.push(`Conditional target P/L: held ${money(comparison.baseline.metrics.scenarioPnl)}; candidate ${money(comparison.metrics.scenarioPnl)}; candidate minus held ${money(comparison.metrics.scenarioPnl - comparison.baseline.metrics.scenarioPnl)}. Not realized returns.`);
    else if (topic === 'cost-basis') {
      lines.push(`Net entry cashflow after allowance: held ${money(comparison.baseline.metrics.entryAccounting.netEntryCashFlowAfterAllowance)} (${held.pricing?.entryMode === 'fixed' ? 'supplied fixed inputs' : 'quoted inputs'}); candidate ${money(comparison.metrics.entryAccounting.netEntryCashFlowAfterAllowance)} (${candidate.pricing!.basis} quoted estimates). Positive = received; negative = paid.`);
      reply.assumptions.push('Held entries and base/global/expiry IV shifts remain. Candidate entries/base IV use quotes; global shift remains, expiry IV shifts reset. Each allowance is deducted once. Entry outlay is not margin or maximum risk. Neither input mode proves execution.');
    } else if (topic === 'structure') lines.push(`Held: ${structure(held)}. Candidate: ${structure(candidate)}. Not a roll.`);
    else if (topic === 'loss-bound') {
      const bound = comparison.candidate.lossBound;
      lines.push(bound ? `Candidate conservative loss bound: ${money(bound.amount)} at short expiry ${bound.date}; not proof of an attained maximum. It does not establish a pre-expiry/lifetime cap.` : `Candidate intact-expiry maximum loss: ${comparison.metrics.maxLoss === null ? 'unbounded in this model' : money(comparison.metrics.maxLoss)}.`);
      lines.push(!held.legs.length ? 'The held stock-only position has no option expiry; no held intact-option-expiry bound is compared.' : comparison.baseline.metrics.mode === 'first-expiry' ? 'Held mixed-expiry maximum loss is not exact; missing certification establishes no breach or greater-loss possibility.' : `Held model maximum loss: ${comparison.baseline.metrics.maxLoss === null ? 'unbounded in this model' : money(comparison.baseline.metrics.maxLoss)}.`);
    } else if (topic === 'probability') {
      const probability = comparison.candidate.probability;
      if (probability.probability === null) lines.push('Mixed-expiry probability is unavailable. No forecast win rate or expected-return edge is established.');
      else {
        lines.push(`Candidate probability of positive intact-expiry P/L: ${(100 * probability.probability).toFixed(2)}%, from snapshot ${probability.from} at ${index ? `${probability.spot} index points` : money(probability.spot)} to ${probability.expiry}. This is not a held-target probability comparison.`);
        reply.assumptions.push('Candidate probability uses the shared nearest-spot quoted IV per expiry plus global IV shift: a risk-neutral lognormal model after its allowance, not a forecast win rate or expected-return edge. Held probability is not compared.');
      }
    }
    else if (topic === 'apply-status') lines.push('This comparison leaves holdings unchanged. Apply requires the explicit candidate control outside this discussion; it changes the builder, not a broker position.');
    else {
      const unit = { delta: `USD per ${spotUnit}`, gamma: `change in position delta per ${spotUnit}`, theta: 'USD per day', vega: 'USD per +1 volatility percentage point', rho: 'USD per +1 rate percentage point' }[topic];
      lines.push(`${topic[0].toUpperCase() + topic.slice(1)}: held ${comparison.baseline.metrics[topic].toFixed(4)}; candidate ${comparison.metrics[topic].toFixed(4)} (${unit}).`);
    }
  }
  reply.text = lines.join('\n');
  reply.assumptions.push('Included hypothetical positions only, under the selected pricing model. Local Greeks hold other inputs fixed. No fills, settlement, assignment, financing, margin or suitability conclusion.');
  return reply;
}
export function isCandidateSelection(value: unknown): value is CandidateSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as CandidateSelection;
  return Object.keys(selection).every(key => ['id', 'request', 'domain'].includes(key)) && typeof selection.id === 'string' && selection.id.length > 0 && selection.id.length <= 1024 && !!selection.request && typeof selection.request === 'object' && !Array.isArray(selection.request) && (selection.domain === undefined || !!selection.domain && typeof selection.domain === 'object' && !Array.isArray(selection.domain));
}
export function compareSearchCandidate(state: StrategyState, snapshot: MarketSnapshot, selection: CandidateSelection, now = Date.now()) {
  if (!isCandidateSelection(selection)) throw new Error('Invalid candidate selection');
  if (validateMarketConstruction(state, snapshot).length) throw new Error('Invalid candidate comparison baseline');
  const included = projectAnalysisPosition(state);
  if (!included) throw new Error('Include an option or shares before comparing candidates');
  state = included;
  const times = [snapshot.retrievedAt, snapshot.spotAsOf, ...Object.values(snapshot.spotSourceTimes ?? {}), ...(snapshot.indexSourceTime ? [snapshot.indexSourceTime] : []), ...snapshot.contracts.flatMap(c => [c.quoteAsOf, ...Object.values(c.sourceTimes ?? {})])];
  if (!finite(now) || snapshot.historical || times.some(value => { const time = Date.parse(value); return !finite(time) || time > now || now - time > 300_000; })) throw new Error('Fresh candidate quotes required');
  const result = searchCandidates(state, snapshot, selection.request, selection.domain);
  const selected = result.candidates.find(candidate => candidate.id === selection.id);
  if (!selected) throw new Error('Selected candidate is not in the validated search results');
  const baselineState = { ...structuredClone(state), scenarioSpot: selection.request.targetSpot, scenarioDate: selection.request.targetDate };
  if (state.legs.some(leg => Date.parse(selection.request.targetDate) > Date.parse(leg.expiry)) || validateMarketStrategy(baselineState, snapshot).length) throw new Error('Unsupported candidate comparison date or baseline');
  const classify = (amount: number | null): 'bounded' | 'unbounded' | 'not-exact' => selected.metrics.mode === 'first-expiry' ? 'not-exact' : amount === null ? 'unbounded' : 'bounded';
  return {
    state: selected.state, metrics: selected.metrics, baseline: { state: baselineState, metrics: calculateStrategy(baselineState) },
    lossClassification: classify(selected.metrics.maxLoss), profitClassification: classify(selected.metrics.maxProfit), additionalShareCost: 0, removedLegIds: [] as string[],
    candidate: { ...structuredClone(selection), ...(selected.lossBound ? { lossBound: selected.lossBound } : {}), probability: selected.probability, coverage: result.coverage, assumptions: result.assumptions, probabilityBasis: result.probabilityBasis },
    assumptions: 'Hypothetical new-position comparison, not a trade, roll, recommendation or workspace proposal. The included held baseline preserves entry costs, base IV, global and expiry IV shifts, quantities and allowance; only target spot and date change. The independently reconstructed candidate uses dated quote entries and quote IV, the captured global IV shift, zero expiry IV shifts and the requested candidate allowance. Different cost and volatility bases are intentional, not realized returns. No exit proceeds, assignment, settlement, financing or margin cashflows. Mixed-expiry risk is not exact; any candidate loss bound is conservative at short expiry only, not lifetime risk.',
  };
}
export function balancedCandidateScore(returnOnRisk: number, probability: number, chanceWeight: number): number {
  if (!finite(returnOnRisk) || !finite(probability) || probability < 0 || probability > 1 || !Number.isInteger(chanceWeight) || chanceWeight < 0 || chanceWeight > 100) throw new Error('Invalid balanced candidate score inputs');
  if (chanceWeight === 0) return returnOnRisk;
  if (chanceWeight === 100) return probability;
  const weight = chanceWeight / 100;
  return (1 - weight) * (returnOnRisk / (1 + Math.abs(returnOnRisk))) + weight * (2 * probability - 1);
}
export function searchCandidates(context: StrategyState, snapshot: MarketSnapshot, input: { targetSpot: number; targetDate: string; maxLoss: number; feeAllowance: number; basis: PricingBasis; objective: "target-pnl" | "return-on-risk" | "expiry-probability" | "balanced"; chanceWeight?: number }, domain?: CandidateSearchDomain) {
  if (domain !== undefined && (!domain || Object.keys(domain).sort().join() !== [...(domain.expiry !== undefined ? ['expiry'] : []), 'families', 'maxEntryOutlay', ...(domain.resultMode === 'best-per-family' ? ['resultMode'] : [])].join() || !Array.isArray(domain.families) || !domain.families.length || new Set(domain.families).size !== domain.families.length || domain.families.some(family => ![...CANDIDATE_OPTION_FAMILIES, 'options', 'covered-call', 'protective-put', 'collar', 'call-calendar', 'put-calendar', 'call-diagonal', 'put-diagonal'].includes(family)) || !finite(domain.maxEntryOutlay) || domain.maxEntryOutlay < 0)) throw new Error('Invalid candidate search domain');
  const selected = (family: CandidateOptionFamily) => domain === undefined || domain.families.includes('options') || domain.families.includes(family);
  const options = CANDIDATE_OPTION_FAMILIES.some(selected);
  const verticalFamily = (long: MarketContract, short: MarketContract): CandidateOptionFamily => `${long.strike < short.strike ? 'bull' : 'bear'}-${long.type}`;
  if (context.underlyingKind === 'cash-index' && domain?.families.some(family => ['covered-call', 'protective-put', 'collar'].includes(family))) throw new Error('Cash-index discovery cannot include stock families');
  if (!input || Object.keys(input).sort().join() !== (input.objective === 'balanced' ? "basis,chanceWeight,feeAllowance,maxLoss,objective,targetDate,targetSpot" : "basis,feeAllowance,maxLoss,objective,targetDate,targetSpot") || input.objective === 'balanced' && (!Number.isInteger(input.chanceWeight) || input.chanceWeight! < 0 || input.chanceWeight! > 100) || !finite(input.targetSpot) || input.targetSpot <= 0 || input.targetSpot > 1_000_000 || !finite(input.maxLoss) || input.maxLoss <= 0 || !finite(input.feeAllowance) || input.feeAllowance < 0 || !["mid", "natural"].includes(input.basis) || !["target-pnl", "return-on-risk", "expiry-probability", "balanced"].includes(input.objective) || typeof input.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(input.targetDate) || !Number.isFinite(Date.parse(input.targetDate)) || new Date(input.targetDate).toISOString() !== (input.targetDate.includes(".") ? input.targetDate : input.targetDate.replace("Z", ".000Z")) || Date.parse(input.targetDate) < Date.parse(snapshot.retrievedAt)) throw new Error("Invalid candidate search request");
  if (snapshot.historical || snapshot.contracts.length > MAX_CHAIN_CONTRACTS || new Set(snapshot.contracts.map(c => c.contractId)).size !== snapshot.contracts.length || validateMarketStrategy(context, snapshot).length) throw new Error("Candidate snapshot unavailable or invalid");
  if (domain?.expiry !== undefined && (typeof domain.expiry !== 'string' || !snapshot.contracts.some(contract => contract.expiry === domain.expiry) || Date.parse(domain.expiry) < Date.parse(input.targetDate))) throw new Error('Invalid candidate search expiry');
  const mixed = domain?.families.some(family => family.endsWith('-calendar') || family.endsWith('-diagonal')) ?? false;
  if (mixed && (input.objective === 'expiry-probability' || input.objective === 'balanced')) throw new Error('Mixed-expiry discovery requires a target P/L objective');
  if (mixed && context.valuationModel !== 'american-crr-1024-v1' && context.dividendYield > 0 && domain!.families.some(family => family === 'call-calendar' || family === 'call-diagonal')) throw new Error('Positive-yield European call spreads have unbounded first-expiry loss');
  const contracts = [...snapshot.contracts].filter(c => Date.parse(c.expiry) >= Date.parse(input.targetDate)).sort((a, b) => a.contractId.localeCompare(b.contractId));
  const sameExpiryContracts = domain?.expiry ? contracts.filter(contract => contract.expiry === domain.expiry) : contracts;
  const base = (legs: OptionLeg[]): StrategyState => ({
    id: "candidate", version: context.version, name: "Quoted candidate", underlying: snapshot.underlying,
    ...(context.underlyingKind ? { underlyingKind: context.underlyingKind } : {}),
    valuationModel: context.valuationModel, spot: snapshot.spot, valuationTimestamp: snapshot.retrievedAt,
    rate: context.rate, dividendYield: context.dividendYield, ivShift: context.ivShift,
    scenarioSpot: input.targetSpot, scenarioDate: input.targetDate, feeAllowance: input.feeAllowance,
    pricing: { mode: "market", snapshotId: snapshot.id, basis: input.basis }, legs,
  });
  const longLegs = new Map<string, OptionLeg>();
  for (const contract of contracts) {
    if (!finite(contract.bid) || !finite(contract.ask) || contract.bid < 0 || contract.ask <= 0 || contract.ask < contract.bid || !Number.isFinite(Date.parse(contract.quoteAsOf))) throw new Error("Invalid candidate quote");
    const leg = marketLeg(contract, "long", 1, contract.contractId, input.basis), state = base([leg]);
    assertValid(state);
    longLegs.set(contract.contractId, leg);
  }
  const groups = [...new Set(sameExpiryContracts.map(c => c.expiry))].map(expiry => ({
    calls: contracts.filter(c => c.expiry === expiry && c.type === "call").sort((a, b) => a.strike - b.strike),
    puts: contracts.filter(c => c.expiry === expiry && c.type === "put").sort((a, b) => a.strike - b.strike),
  }));
  const equalWings = (a: MarketContract, b: MarketContract, c: MarketContract) => Math.round(a.strike * 1000) + Math.round(c.strike * 1000) === 2 * Math.round(b.strike * 1000);
  let planned = sameExpiryContracts.filter(contract => selected(`long-${contract.type}`)).length;
  if (options) for (const { calls, puts } of groups) {
    for (const put of puts) planned += calls.filter(call => put.strike <= call.strike && selected(`long-${put.strike === call.strike ? 'straddle' : 'strangle'}`)).length;
    for (const group of [calls, puts]) {
      for (const long of group) planned += group.filter(short => short.strike !== long.strike && selected(verticalFamily(long, short))).length;
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) for (let k = j + 1; k < group.length; k++) if (equalWings(group[i], group[j], group[k])) planned += Number(selected(`${group[i].type}-butterfly`)) + Number(selected(`short-${group[i].type}-butterfly`));
    }
    for (let q = 1; q < puts.length; q++) for (let c = 0; c < calls.length; c++) if (puts[q].strike <= calls[c].strike) {
      const family = puts[q].strike === calls[c].strike ? 'butterfly' : 'condor';
      planned += (Number(selected(`iron-${family}`)) + Number(selected(`inverse-iron-${family}`))) * q * (calls.length - c - 1);
    }
  }
  for (const { calls, puts } of groups) {
    if (domain?.families.includes('covered-call')) planned += calls.length;
    if (domain?.families.includes('protective-put')) planned += puts.length;
    if (domain?.families.includes('collar')) for (const put of puts) planned += calls.filter(call => put.strike <= call.strike).length;
  }
  const mixedPairs: Array<[MarketContract, MarketContract]> = [];
  if (mixed) for (const short of sameExpiryContracts) for (const long of contracts) if (short.type === long.type && Date.parse(short.expiry) < Date.parse(long.expiry) && domain!.families.includes(`${short.type}-${short.strike === long.strike ? 'calendar' : 'diagonal'}`)) mixedPairs.push([short, long]);
  planned += mixedPairs.length;
  // ponytail: bounded synchronous enumeration; partition search if larger windows become necessary.
  if (planned > 300_000) throw new CandidateSearchLimitError();
  const prices = new Map([...longLegs].map(([id, leg]) => [id, priceLeg(base([leg]), leg, input.targetSpot, Date.parse(input.targetDate), true).price]));
  const references = new Map(groups.map(({ calls, puts }) => {
    const reference = [...calls, ...puts].sort((a, b) => Math.abs(a.strike - snapshot.spot) - Math.abs(b.strike - snapshot.spot) || a.contractId.localeCompare(b.contractId))[0];
    return [reference.expiry, reference];
  }));
  const probabilityFor = (state: StrategyState) => probabilityFromValidatedState({ ...state, scenarioSpot: snapshot.spot, scenarioDate: snapshot.retrievedAt }, undefined, references.get(state.legs[0].expiry)!);
  const ranked: Array<{ id: string; state: StrategyState; score: number; pnl: number; lossBound?: ReturnType<typeof firstExpirySpreadLossBound> }> = [];
  const compare = (a: typeof ranked[number], b: typeof ranked[number]) => b.score - a.score || a.id.localeCompare(b.id);
  let evaluated = 0, eligible = 0, excludedRisk = 0, excludedBudget = 0, excludedCost = 0;
  const evaluate = (legs: OptionLeg[], stock = false, mixedExpiry = false) => {
    evaluated++;
    const state = base(legs);
    if (stock) state.stock = { shares: 100, entryPrice: snapshot.spot };
    const lossBound = mixedExpiry ? firstExpirySpreadLossBound(state) : undefined;
    const loss = lossBound ? lossBound.amount : exactExpiration(state).maxLoss;
    if (loss === null || loss <= 0) { excludedRisk++; return; }
    if (loss > input.maxLoss) { excludedBudget++; return; }
    if (domain && Math.max(0, entryCost(state) + input.feeAllowance) > domain.maxEntryOutlay) { excludedCost++; return; }
    const pnl = rounded(legs.reduce((sum, leg) => sum + prices.get(leg.contractId)! * (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier, stock ? 100 * input.targetSpot : 0) - entryCost(state) - input.feeAllowance);
    const score = input.objective === 'balanced' ? balancedCandidateScore(pnl / loss, probabilityFor(state).probability!, input.chanceWeight!) : input.objective === "expiry-probability" ? probabilityFor(state).probability : input.objective === "target-pnl" ? pnl : pnl / loss;
    if (!finite(pnl) || !finite(score)) throw new Error("Candidate numerical range exceeded");
    eligible++;
    const candidate = { id: (stock ? `stock:100@${snapshot.spot}|` : '') + legs.map(leg => `${leg.side}:${leg.contractId}${leg.contracts === 1 ? "" : `*${leg.contracts}`}`).join("|"), state, score, pnl, ...(lossBound ? { lossBound } : {}) };
    if (domain?.resultMode === 'best-per-family') {
      const family = candidateStrategyFamily(state);
      if (!family) throw new Error('Candidate family unavailable');
      const index = ranked.findIndex(item => candidateStrategyFamily(item.state) === family);
      if (index >= 0) {
        if (compare(candidate, ranked[index]) >= 0) return;
        ranked.splice(index, 1);
      }
    }
    ranked.push(candidate);
    ranked.sort(compare);
    if (domain?.resultMode !== 'best-per-family' && ranked.length > 5) ranked.pop();
  };
  if (options) for (const long of sameExpiryContracts) {
    const leg = longLegs.get(long.contractId)!;
    if (selected(`long-${long.type}`)) evaluate([leg]);
    for (const short of contracts) if (short.type === long.type && short.expiry === long.expiry && short.strike !== long.strike && selected(verticalFamily(long, short))) evaluate([leg, marketLeg(short, "short", 1, short.contractId, input.basis)]);
  }
  if (options) for (const { calls, puts } of groups) {
    for (const put of puts) for (const call of calls) if (put.strike <= call.strike && selected(`long-${put.strike === call.strike ? 'straddle' : 'strangle'}`)) evaluate([
      longLegs.get(put.contractId)!, longLegs.get(call.contractId)!,
    ]);
    for (const group of [calls, puts]) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) for (let k = j + 1; k < group.length; k++) {
      if (equalWings(group[i], group[j], group[k])) for (const side of ["long", "short"] as const) if (selected(`${side === 'short' ? 'short-' : ''}${group[i].type}-butterfly`)) evaluate([
        marketLeg(group[i], side, 1, group[i].contractId, input.basis),
        marketLeg(group[j], side === "long" ? "short" : "long", 2, group[j].contractId, input.basis),
        marketLeg(group[k], side, 1, group[k].contractId, input.basis),
      ]);
    }
    for (let p = 0; p < puts.length; p++) for (let q = p + 1; q < puts.length; q++) for (let c = 0; c < calls.length; c++) {
      if (puts[q].strike > calls[c].strike) continue;
      for (let d = c + 1; d < calls.length; d++) for (const side of ["long", "short"] as const) if (selected(`${side === 'short' ? 'inverse-' : ''}iron-${puts[q].strike === calls[c].strike ? 'butterfly' : 'condor'}`)) evaluate([
        marketLeg(puts[p], side, 1, puts[p].contractId, input.basis),
        marketLeg(puts[q], side === "long" ? "short" : "long", 1, puts[q].contractId, input.basis),
        marketLeg(calls[c], side === "long" ? "short" : "long", 1, calls[c].contractId, input.basis),
        marketLeg(calls[d], side, 1, calls[d].contractId, input.basis),
      ]);
    }
  }
  for (const { calls, puts } of groups) {
    if (domain?.families.includes('covered-call')) for (const call of calls) evaluate([marketLeg(call, 'short', 1, call.contractId, input.basis)], true);
    if (domain?.families.includes('protective-put')) for (const put of puts) evaluate([longLegs.get(put.contractId)!], true);
    if (domain?.families.includes('collar')) for (const put of puts) for (const call of calls) if (put.strike <= call.strike) evaluate([longLegs.get(put.contractId)!, marketLeg(call, 'short', 1, call.contractId, input.basis)], true);
  }
  for (const [short, long] of mixedPairs) evaluate([marketLeg(short, 'short', 1, short.contractId, input.basis), longLegs.get(long.contractId)!], false, true);
  return {
    snapshotId: snapshot.id, baseVersion: context.version, model: context.valuationModel ?? "european-bsm-v1", request: { ...input },
    coverage: "All quoted long calls/puts, same-expiry long straddles/strangles (put strike at or below call), verticals, equal-wing call/put butterflies (1:2:1) in both directions, and standard/inverse iron butterflies/condors including unequal wings in this window. Other legs use one contract each. No stock, arbitrary ratios, mixed-expiry or other families.",
    assumptions: "New positions at dated quote entries, not held-position adjustments or executable fills. Expiry-specific IV shifts reset to zero; global IV shift is retained. Conditional target model P/L, not expected return or trading edge. Loss budget applies to intact expiration payoff, not margin or assignment cashflows.",
    probabilityBasis: "Snapshot spot/time to each expiry, using one shared nearest-spot quoted contract IV per expiry (contract ID breaks ties), plus global IV shift. Risk-neutral lognormal positive intact-expiry P/L after allowance, not forecast win rate, expected return, touch or assignment probability. Different expiries have different horizons; high probability can accompany small gains and large losses.",
    planned, evaluated, eligible, excludedRisk, excludedBudget, excludedBeforeTarget: snapshot.contracts.length - contracts.length,
    ...(domain ? { domain: { families: [...domain.families], maxEntryOutlay: domain.maxEntryOutlay, ...(domain.resultMode ? { resultMode: domain.resultMode } : {}), ...(domain.expiry ? { expiry: domain.expiry } : {}) }, excludedCost,
      coverage: `Explicit families: ${domain.families.join(', ')}. ${domain.families.some(family => CANDIDATE_OPTION_FAMILIES.includes(family as CandidateOptionFamily)) ? 'Named option families select only those directional structures; options includes the full same-expiry catalog once. Butterflies have equal wings and 1:2:1 quantities; iron structures allow unequal wings.' : 'Options selects the existing same-expiry option-only catalog.'} Covered calls use 100 long shares plus one short call; protective puts use 100 long shares plus one long put; collars use 100 long shares plus one long put and one short call with put strike at or below call strike. Each structure uses one expiry from this quoted window. No mixed-expiry, arbitrary ratios or other stock quantities.`,
      assumptions: `New positions, not adjustments to held shares or executable fills. Stock entries use dated underlying snapshot spot ${snapshot.spot}; ${input.basis} applies to option entry estimates only. Entry outlay is max(0, signed stock and option entry cost plus allowance), capped at ${domain.maxEntryOutlay}; not margin or buying power. Expiry-specific IV shifts reset; global IV shift remains. Risk is intact expiration loss, not assignment cashflows; target model P/L is not expected return or trading edge.` } : {}),
    ...(mixed ? {
      coverage: `Explicit families: ${domain!.families.join(', ')}. Existing options and stock families retain their same-expiry domains. Selected calendars use equal strikes; diagonals use unequal strikes. Each mixed pair is one short earlier-expiry and one long later-expiry option of the same type, with target at or before short expiry. Only captured quotes are searched; no reverse calendars, ratios or mixed stock positions.`,
      assumptions: `Selected ${context.valuationModel === 'american-crr-1024-v1' ? 'American' : 'European'} valuation is retained. Mixed candidates use a conservative ${context.valuationModel === 'american-crr-1024-v1' ? 'intrinsic-floor' : 'discounted no-arbitrage floor (fixed rate and continuous yield)'} loss bound at short expiry, not exact maximum loss or lifetime risk. Same-expiry candidates retain exact intact-expiry loss. Return-on-risk divides conditional target P/L by the applicable positive loss amount; unlike risk measures and horizons must not be treated as equivalent. Net entry outlay includes dated share mark cost where selected, signed option quote entries and allowance once, floored at zero and capped at ${domain!.maxEntryOutlay}; not margin or buying power. Global IV shift remains; expiry shifts reset. No executable fills, assignment cashflows or expected-return claim.`,
      probabilityBasis: 'Mixed-expiry profit probability is unavailable. Same-expiry candidates retain snapshot-anchored risk-neutral lognormal probability; it is not a forecast win rate. Probability ranking is disabled when any mixed family is selected.' } : {}),
    ...(domain?.resultMode === 'best-per-family' ? { eligibleFamilies: ranked.length } : {}),
    candidates: ranked.map(({ id, state, score, lossBound }) => ({ id, state, score, metrics: calculateStrategy(state), probability: probabilityFor(state), ...(lossBound ? { lossBound } : {}) })),
  };
}
