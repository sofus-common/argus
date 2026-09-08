import type { StrategyState } from './options'

export type StrikeDrag = { pointerId: number; source: StrategyState; next: StrategyState; id: string; group: boolean; startX: number; strike: number }
type DragEvent =
  | { kind: 'start'; drag: StrikeDrag; primary: boolean; button: number }
  | { kind: 'preview'; pointerId: number; next: StrategyState }
  | { kind: 'end'; pointerId: number; cancel?: boolean }

export function canMoveStrikeDrag(drag: StrikeDrag | null, pointerId: number, source: StrategyState, readOnly = false): boolean {
  return !!drag && drag.pointerId === pointerId && drag.source === source && !readOnly
}

export function strikeDrag(drag: StrikeDrag | null, event: DragEvent, source: StrategyState, readOnly = false): { drag: StrikeDrag | null; commit?: { source: StrategyState; next: StrategyState } } {
  if (event.kind === 'start') return { drag: !drag && event.primary && event.button === 0 && event.drag.source === source && !readOnly ? event.drag : drag }
  if (!drag || drag.pointerId !== event.pointerId) return { drag }
  const admitted = canMoveStrikeDrag(drag, event.pointerId, source, readOnly)
  if (event.kind === 'preview') return { drag: admitted ? { ...drag, next: event.next } : drag }
  return { drag: null, ...(!event.cancel && admitted && drag.next !== drag.source ? { commit: { source: drag.source, next: drag.next } } : {}) }
}
