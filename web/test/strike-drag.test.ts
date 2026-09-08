import { describe, expect, it } from 'vitest'
import { createStrategy } from '../src/options'
import { canMoveStrikeDrag, strikeDrag, type StrikeDrag } from '../src/strike-drag'

describe('strike gesture ownership', () => {
  const source = createStrategy('bull-call')
  const next = { ...source, version: source.version + 1 }
  const initial: StrikeDrag = { pointerId: 1, source, next: source, id: source.legs[0].id, group: true, startX: 100, strike: source.legs[0].strike }
  const moved = { ...initial, next }

  it('admits one primary left-button gesture and preserves its baseline', () => {
    expect(strikeDrag(null, { kind: 'start', drag: initial, primary: true, button: 0 }, source).drag).toBe(initial)
    for (const [primary, button] of [[false, 0], [true, 2]] as const) {
      expect(strikeDrag(null, { kind: 'start', drag: initial, primary, button }, source).drag).toBeNull()
    }
    expect(strikeDrag(moved, { kind: 'start', drag: { ...initial, pointerId: 2 }, primary: true, button: 0 }, source).drag).toBe(moved)
  })

  it('allows only the owning pointer and exact current source to move', () => {
    expect(canMoveStrikeDrag(moved, 1, source)).toBe(true)
    expect(canMoveStrikeDrag(moved, 2, source)).toBe(false)
    expect(canMoveStrikeDrag(moved, 1, { ...source })).toBe(false)
    expect(canMoveStrikeDrag(moved, 1, source, true)).toBe(false)
    expect(canMoveStrikeDrag(null, 1, source)).toBe(false)
  })

  it('ignores another pointer preview, release and cancellation', () => {
    for (const event of [{ kind: 'preview', pointerId: 2, next: source }, { kind: 'end', pointerId: 2 }, { kind: 'end', pointerId: 2, cancel: true }] as const) {
      expect(strikeDrag(moved, event, source)).toEqual({ drag: moved })
    }
  })

  it('updates local preview and emits exactly one commit on owning release', () => {
    const preview = strikeDrag(initial, { kind: 'preview', pointerId: 1, next }, source)
    expect(preview.drag?.next).toBe(next)
    expect(initial.next).toBe(source)
    expect(strikeDrag(preview.drag, { kind: 'end', pointerId: 1 }, source)).toEqual({ drag: null, commit: { source, next } })
    expect(strikeDrag(null, { kind: 'end', pointerId: 1 }, source)).toEqual({ drag: null })
  })

  it('cancellation discards the preview without a commit', () => {
    expect(strikeDrag(moved, { kind: 'end', pointerId: 1, cancel: true }, source)).toEqual({ drag: null })
  })

  it('unchanged or rejected preview releases without a commit', () => {
    expect(strikeDrag(initial, { kind: 'end', pointerId: 1 }, source)).toEqual({ drag: null })
    const rejected = strikeDrag(moved, { kind: 'preview', pointerId: 1, next: source }, source)
    expect(strikeDrag(rejected.drag, { kind: 'end', pointerId: 1 }, source)).toEqual({ drag: null })
  })

  it('stale baseline or read-only transition cannot preview or commit', () => {
    for (const [current, readOnly] of [[{ ...source }, false], [source, true]] as const) {
      expect(strikeDrag(moved, { kind: 'preview', pointerId: 1, next }, current, readOnly).drag).toBe(moved)
      expect(strikeDrag(moved, { kind: 'end', pointerId: 1 }, current, readOnly)).toEqual({ drag: null })
      expect(strikeDrag(null, { kind: 'start', drag: initial, primary: true, button: 0 }, current, readOnly)).toEqual({ drag: null })
    }
  })
})
