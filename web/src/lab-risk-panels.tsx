import { useMemo } from 'react'
import { AssignmentOutcomes, SnapshotAge } from './App'
import { contractTermsFacts, effectiveIv, evaluateScenario, expirationProbability, quoteValuation, type MarketSnapshot, type StrategyState } from './options'
import './lab-risk-panels.css'

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function LabRiskPanels({ position, scenario, snapshot }: { position: StrategyState; scenario: StrategyState; snapshot?: MarketSnapshot }) {
  const quote = useMemo(() => { try { return snapshot ? { value: quoteValuation(position, snapshot) } : null } catch (error) { return { error: error instanceof Error ? error.message : 'Quote valuation unavailable.' } } }, [position, snapshot])
  const modeled = useMemo(() => { try { return evaluateScenario(scenario) } catch { return null } }, [scenario])
  const chance = useMemo(() => { try { return expirationProbability(scenario) } catch { return null } }, [scenario])
  const terms = contractTermsFacts(snapshot)
  return <section className="lab-risk" aria-label="Execution and contract risks">
    <details>
      <summary>Execution <span>{quote?.value ? `Dated quote P/L ${money(quote.value.pnl)}` : 'Quote valuation unavailable'}</span></summary>
      {!snapshot ? <p>Sample mode: synthetic premiums are not market quotes. No liquidation estimate or quoted spread is available. Load a symbol for dated quote analysis.</p> : <>
        <SnapshotAge snapshot={snapshot} contracts={position.legs.map(leg => leg.contractId)} />
        {quote?.error && <p role="status">{quote.error}</p>}
        {quote?.value && <>
          <dl><div><dt>Dated quote P/L</dt><dd>{money(quote.value.pnl)}</dd></div><div><dt>Scenario-model P/L</dt><dd>{modeled ? money(modeled.pnl) : 'Unavailable'}</dd></div><div><dt>Model minus quote</dt><dd>{modeled ? money(modeled.pnl - quote.value.pnl) : 'Unavailable'}</dd></div></dl>
          <p>{quote.value.basis}</p>
          <p>Signed liquidation value {money(quote.value.signedLiquidationValue)} − signed entry {money(quote.value.signedEntry)} − flat allowance {money(quote.value.feeAllowance ?? 0)}. Entry costs are {position.pricing?.entryMode === 'fixed' ? 'held, not broker-confirmed fills' : 'estimated from quotes'}.</p>
          <p>Quote sources: {quote.value.oldestQuoteAt} to {quote.value.newestQuoteAt}.{position.stock && ` Stock marked at ${money(snapshot.spot)} from ${snapshot.spotAsOf}; not an executable stock bid/ask.`}</p>
          <details><summary>Option spread width <span>{money(quote.value.optionQuotedSpreadWidth)}</span></summary>
            <p>Midpoint minus natural liquidation value: {money(quote.value.optionMidToNaturalDifference)}.</p>
            <ul>{quote.value.optionSpreadLegs.map(leg => <li key={leg.legId}>{leg.contracts} × {leg.contractId}: bid {money(leg.bid)} / ask {money(leg.ask)} · position width {money(leg.positionWidthUsd)} · {leg.quoteAsOf}</li>)}</ul>
            <p>{quote.value.optionSpreadBasis}</p>
          </details>
        </>}
      </>}
      <p>Scenario: {scenario.scenarioDate} · spot {money(scenario.scenarioSpot)} · {scenario.valuationModel === 'american-crr-1024-v1' ? 'American CRR · 1,024 steps' : 'European BSM'} · rate {(scenario.rate * 100).toFixed(2)}% · continuous yield {(scenario.dividendYield * 100).toFixed(2)}%.</p>
      <p>Effective leg IV: {scenario.legs.map(leg => `${leg.side} ${leg.contracts} × $${leg.strike} ${leg.type}: ${(effectiveIv(scenario, leg) * 100).toFixed(2)}%`).join('; ') || 'No options'}.</p>
      <p>The difference mixes quote/model and scenario assumptions; it is not measured mispricing, executable edge or realized P/L. Both subtract entry costs and the supplied flat allowance, not actual broker fees.</p>
    </details>
    <details>
      <summary>Assignment &amp; contract terms <span>{terms.status === 'unknown' ? 'Terms unavailable' : `${terms.exerciseStyle} · ${terms.settlement}`}</span></summary>
      <p>{terms.basis}</p>
      <p>Expiry maximum loss does not cap temporary assignment cash or share exposure. The valuation model does not establish contract exercise or settlement terms.</p>
      <AssignmentOutcomes state={position} snapshot={snapshot} />
    </details>
    <details>
      <summary>Scenario → expiry chance of profit <span>{chance?.probability == null ? 'Unavailable' : `${(chance.probability * 100).toFixed(1)}%`} · conditional model</span></summary>
      {!chance ? <p>Probability unavailable for the current scenario.</p> : <>
        <p>{chance.reason ?? `Positive expiration P/L from $${chance.spot.toFixed(2)} at ${chance.from} to ${chance.expiry}.`}</p>
        <p>Distribution IV {chance.volatility === null ? 'unavailable' : `${(chance.volatility * 100).toFixed(2)}%`} · reference {chance.volatilityContractId ?? 'unavailable'} · rate {(chance.rate * 100).toFixed(2)}% · yield {(chance.dividendYield * 100).toFixed(2)}%.</p>
        <p>{chance.basis}</p>
      </>}
      <p>Not a forecast or historical win rate. Changing scenario spot, time or IV changes this conditional result; it is not a recommendation.</p>
    </details>
  </section>
}
