import { useEffect, useId, useRef, useState } from 'react'
import { TEMPLATES, type TemplateId } from './options'

const groups: Record<string, readonly TemplateId[]> = {
  Directional: ['long-call', 'long-put'],
  Verticals: ['bull-call', 'bear-put', 'bull-put', 'bear-call'],
  Volatility: ['long-straddle', 'long-strangle', 'inverse-iron-butterfly', 'inverse-iron-condor', 'short-call-butterfly', 'short-put-butterfly'],
  Neutral: ['iron-butterfly', 'call-butterfly', 'put-butterfly', 'iron-condor'],
  Time: ['call-calendar', 'put-calendar', 'call-diagonal', 'put-diagonal'],
  'Stock / cash backed': ['covered-call', 'short-put', 'protective-put', 'collar'],
  'Uncovered short': ['short-call', 'short-straddle', 'short-strangle'],
}
const supported: readonly TemplateId[] = ['long-call', 'bull-call', 'bull-put', 'covered-call', 'short-put', 'call-butterfly']
const label = (id: TemplateId) => id === 'short-put' ? 'Cash-secured put' : TEMPLATES.find(template => template.id === id)!.name

export function LabStrategyPicker({ onSelect, onClose, market = false }: { market?: boolean; onSelect: (id: TemplateId) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [selected, setSelected] = useState<TemplateId | null>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  const visible = Object.entries(groups).filter(([name]) => category === 'All' || name === category)
    .map(([name, ids]) => ({ name, ids: ids.filter(id => `${label(id)} ${name}`.toLowerCase().includes(query.trim().toLowerCase())) }))
    .filter(group => group.ids.length)
  const count = visible.reduce((total, group) => total + group.ids.length, 0)

  return <dialog ref={dialog} className="lsp-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="lsp-header"><div><span className="lsp-eyebrow">STRATEGY LIBRARY</span><h2 id={titleId}>Choose your structure</h2></div><button type="button" onClick={onClose} aria-label="Close strategy library">Close</button></header>
    <p className="lsp-disclosure">{TEMPLATES.length} structures · {supported.length} interactive {market ? 'quoted' : 'sample'} templates. Other structures are available in the full app only.</p>
    <label className="lsp-search">Find a strategy<input type="search" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or family" /></label>
    <div className="lsp-categories" aria-label="Strategy categories">{['All', ...Object.keys(groups)].map(name => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
    <p className="lsp-count" role="status">{count} {count === 1 ? 'structure' : 'structures'} shown</p>
    <div className="lsp-results">{visible.map(group => <section className="lsp-group" key={group.name} aria-label={group.name}><h3>{group.name}</h3><div className="lsp-grid">{group.ids.map(id => <button className="lsp-template" type="button" key={id} disabled={!supported.includes(id)} aria-pressed={selected === id} onClick={() => setSelected(id)}><strong>{label(id)}</strong><small>{supported.includes(id) ? market ? 'Quoted template' : 'Sample template' : 'Full app only'}</small></button>)}</div></section>)}{!count && <p>No matching strategies. Try another name or category.</p>}</div>
    <footer className="lsp-footer"><div><strong>{selected ? label(selected) : 'Select a template'}</strong><p>Using a strategy replaces legs, shares and entry assumptions. Your thesis stays unchanged.</p></div><button className="lsp-apply" type="button" disabled={!selected} onClick={() => { if (selected && supported.includes(selected)) onSelect(selected) }}>Use strategy</button></footer>
  </dialog>
}
