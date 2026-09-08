import { validateMarketConstruction, validContractTerms, type MarketSnapshot, type StrategyState } from "./options";
import { readWorkspaceDraft } from "./workspace-draft";
import { createPosition, projectPosition, recordClose, recordCloseVoid, recordPriceCorrection, type CloseRequest, type CloseVoid, type PriceCorrection, type PositionRecord } from "./position-lifecycle";
import { projectPositionLots, upgradePositionLots, recordLotTransaction, recordLotPriceCorrection, recordLotOpeningPriceCorrection, recordLotCloseVoid, recordExpiryResolution, recordExpiryVoid, type ExpiryResolution, type ExpiryVoid, type OpeningPriceCorrection, type PositionLots, type LotTransaction } from "./position-lots";

export interface SavedStrategySummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  tracking?: SavedTracking;
}

export interface SavedTracking {
  underlying: string | null;
  status: 'open' | 'closed' | 'not-tracked' | 'unavailable';
  remainingLots: number | null;
  optionContracts: number | null;
  signedShares: number | null;
  grossRealizedPnl: number | null;
  allowance: number | null;
  netClosedPnl: number | null;
  asOf: string | null;
}

export interface SavedStrategy<P extends PositionRecord | PositionLots = PositionRecord | PositionLots> extends SavedStrategySummary {
  state: StrategyState;
  snapshot: MarketSnapshot | null;
  lifecycle: P | null;
}

export class SavedStoreError extends Error {
  constructor(public code: "not_found" | "conflict" | "invalid_request", public status: 400 | 404 | 409) {
    super(code);
  }
}

type Row = SavedStrategySummary & { state_json: string; snapshot_json: string | null; lifecycle_json: string | null };
const summaryColumns = "id, title, revision, created_at AS createdAt, updated_at AS updatedAt";
const columns = `${summaryColumns}, state_json, snapshot_json, lifecycle_json`;
const encodeCursor = ({ updatedAt, id }: Pick<SavedStrategySummary, 'updatedAt' | 'id'>) => btoa(JSON.stringify({ updatedAt, id })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function readCursor(cursor: string) {
  try {
    if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error();
    const value = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (!value || Object.keys(value).sort().join() !== 'id,updatedAt' || typeof value.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt) || new Date(value.updatedAt).toISOString() !== value.updatedAt || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) || encodeCursor(value) !== cursor) throw new Error();
    return value as Pick<SavedStrategySummary, 'updatedAt' | 'id'>;
  } catch { throw new SavedStoreError('invalid_request', 400); }
}
const decode = ({ state_json, snapshot_json, lifecycle_json, ...summary }: Row): SavedStrategy => {
  const state = JSON.parse(state_json), lifecycle = lifecycle_json === null ? null : JSON.parse(lifecycle_json);
  if (lifecycle_json !== null) {
    if (lifecycle?.schemaVersion === 2) projectPositionLots(lifecycle);
    else projectPosition(lifecycle);
    if (JSON.stringify(lifecycle.schemaVersion === 2 ? lifecycle.legacy.initial : lifecycle.initial) !== JSON.stringify(state)) throw new Error("Saved lifecycle basis mismatch");
  }
  const snapshot = snapshot_json ? JSON.parse(snapshot_json) : null;
  validateCashExpiryBasis(state, snapshot, lifecycle);
  return { ...summary, state, snapshot, lifecycle };
};

function validateCashExpiryBasis(state: StrategyState, snapshot: MarketSnapshot | null, lifecycle: SavedStrategy['lifecycle']) {
  if (lifecycle?.schemaVersion !== 2 || !lifecycle.expiryResolutions?.some(event => event.outcome === 'cash-settlement')) return;
  if (state.underlying !== 'XSP' || state.underlyingKind !== 'cash-index' || state.valuationModel !== 'european-bsm-v1' || !snapshot || snapshot.underlying !== 'XSP' || snapshot.underlyingKind !== 'cash-index' || !snapshot.contractTerms || !validContractTerms(snapshot) || snapshot.contractTerms.exerciseStyle !== 'European' || snapshot.contractTerms.settlement !== 'cash' || snapshot.contractTerms.settlementSession !== 'PM' || snapshot.contractTerms.multiplier !== 100) throw new Error('Cash expiry requires recorded European PM cash contract terms');
}

function titleValue(title: string) {
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) throw new SavedStoreError("invalid_request", 400);
  return title.trim();
}

function revisionValue(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new SavedStoreError("invalid_request", 400);
  return revision;
}

export function savedPosition(record: SavedStrategy) {
  validateCashExpiryBasis(record.state, record.snapshot, record.lifecycle);
  if (record.state.pricing) {
    const snapshot = record.snapshot?.underlying === undefined && record.state.underlying === "SPY" && record.snapshot ? { ...record.snapshot, underlying: "SPY" } : record.snapshot;
    if (!snapshot || validateMarketConstruction(record.state, snapshot).length) throw new Error("Invalid saved market basis");
  }
  return record.lifecycle ?? createPosition(record.state);
}

function trackingSummary(row: Row): SavedStrategySummary {
  const { state_json: _state, snapshot_json: _snapshot, lifecycle_json: _lifecycle, ...summary } = row;
  const tracking: SavedTracking = { underlying: null, status: 'unavailable', remainingLots: null, optionContracts: null, signedShares: null, grossRealizedPnl: null, allowance: null, netClosedPnl: null, asOf: null };
  try {
    const record = decode(row);
    readWorkspaceDraft(JSON.stringify({ schemaVersion: 1, state: record.state, snapshot: record.snapshot, title: record.title, thesis: '', composer: '', savedAt: record.updatedAt }));
    if (!record.state.pricing || record.state.pricing.entryMode !== 'fixed') return { ...summary, tracking: { ...tracking, underlying: record.state.underlying, status: 'not-tracked' } };
    const saved = savedPosition(record), projection = projectPositionLots(saved.schemaVersion === 2 ? saved : upgradePositionLots(saved));
    const optionContracts = projection.lots.reduce((sum, lot) => sum + (lot.asset.kind === 'option' ? lot.quantity : 0), 0);
    const signedShares = projection.lots.reduce((sum, lot) => sum + (lot.asset.kind === 'stock' ? lot.quantity * (lot.side === 'long' ? 1 : -1) : 0), 0);
    if (!Number.isSafeInteger(optionContracts) || !Number.isSafeInteger(signedShares)) throw new Error('Tracking quantity exceeds numerical range');
    return { ...summary, tracking: { underlying: record.state.underlying, status: projection.status, remainingLots: projection.lots.length, optionContracts, signedShares, grossRealizedPnl: projection.grossRealizedPnl, allowance: projection.allowance, netClosedPnl: projection.netClosedPnl, asOf: projection.asOf } };
  } catch { return { ...summary, tracking }; }
}

export function createSavedStore(db: D1Database) {
  async function get(owner: string, id: string) {
    const row = await db.prepare(`SELECT ${columns} FROM saved_strategies WHERE owner = ? AND id = ?`).bind(owner, id).first<Row>();
    if (!row) throw new SavedStoreError("not_found", 404);
    return decode(row);
  }
  async function conflict(owner: string, id: string): Promise<never> {
    await get(owner, id);
    throw new SavedStoreError("conflict", 409);
  }
  async function writeEvent(owner: string, id: string, revision: number, eventId: string, apply: (position: PositionRecord | PositionLots) => PositionRecord | PositionLots) {
    revisionValue(revision);
    const current = await get(owner, id);
    const append = (record: SavedStrategy) => {
      try { const next = apply(savedPosition(record)); validateCashExpiryBasis(record.state, record.snapshot, next); return next; }
      catch { throw new SavedStoreError("invalid_request", 400); }
    };
    const next = append(current);
    if (JSON.stringify(current.lifecycle) === JSON.stringify(next)) return current;
    if (current.revision !== revision || !Number.isSafeInteger(revision + 1)) throw new SavedStoreError("conflict", 409);
    const row = await db.prepare(`UPDATE saved_strategies SET lifecycle_json = ?, revision = revision + 1, updated_at = ? WHERE owner = ? AND id = ? AND revision = ? RETURNING ${columns}`)
      .bind(JSON.stringify(next), new Date().toISOString(), owner, id, revision).first<Row>();
    if (row) return decode(row);
    const latest = await get(owner, id);
    const position = latest.lifecycle, legacy = position?.schemaVersion === 2 ? position.legacy : position;
    if (legacy && [...legacy.closes, ...(legacy.priceCorrections ?? []), ...(legacy.closeVoids ?? []), ...(position?.schemaVersion === 2 ? [...position.transactions, ...(position.amendments ?? []), ...(position.expiryResolutions ?? []), ...(position.expiryVoids ?? [])] : [])].some(event => event.id === eventId)) {
      if (JSON.stringify(append(latest)) === JSON.stringify(latest.lifecycle)) return latest;
    }
    throw new SavedStoreError("conflict", 409);
  }
  return {
    async listPage(owner: string, cursor?: string) {
      const after = cursor === undefined ? null : readCursor(cursor);
      const statement = db.prepare(`SELECT ${columns} FROM saved_strategies WHERE owner = ?${after ? ' AND (updated_at < ? OR (updated_at = ? AND id > ?))' : ''} ORDER BY updated_at DESC, id ASC LIMIT 51`);
      const result = await (after ? statement.bind(owner, after.updatedAt, after.updatedAt, after.id) : statement.bind(owner)).all<Row>();
      const strategies = result.results.slice(0, 50).map(trackingSummary);
      return { strategies, nextCursor: result.results.length > 50 ? encodeCursor(strategies[49]) : null };
    },
    async list(owner: string) {
      const result = await db.prepare(`SELECT ${summaryColumns} FROM saved_strategies WHERE owner = ? ORDER BY updated_at DESC, id LIMIT 50`).bind(owner).all<SavedStrategySummary>();
      return result.results;
    },
    get,
    async importRecord(owner: string, value: unknown) {
      let state: StrategyState, snapshot: MarketSnapshot | null, lifecycle: SavedStrategy['lifecycle'], title: string;
      try {
        const body = value as { format: string; formatVersion: number; exportedAt: string; record: SavedStrategy };
        if (!body || Object.keys(body).sort().join() !== 'exportedAt,format,formatVersion,record' || body.format !== 'argus-saved-position' || body.formatVersion !== 1) throw new Error();
        const record = body.record;
        if (!record || Object.keys(record).sort().join() !== 'createdAt,id,lifecycle,revision,snapshot,state,title,updatedAt' || typeof record.id !== 'string' || !record.id || record.id.length > 200) throw new Error();
        revisionValue(record.revision); title = titleValue(record.title);
        for (const at of [body.exportedAt, record.createdAt, record.updatedAt]) if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) throw new Error();
        if (record.createdAt > record.updatedAt || record.updatedAt > body.exportedAt) throw new Error();
        const draft = readWorkspaceDraft(JSON.stringify({ schemaVersion: 1, state: record.state, snapshot: record.snapshot, title, thesis: '', composer: '', savedAt: body.exportedAt }));
        state = draft.state; snapshot = draft.snapshot; lifecycle = structuredClone(record.lifecycle);
        if (lifecycle !== null) {
          if (lifecycle.schemaVersion === 2) projectPositionLots(lifecycle); else projectPosition(lifecycle);
          if (JSON.stringify(lifecycle.schemaVersion === 2 ? lifecycle.legacy.initial : lifecycle.initial) !== JSON.stringify(record.state)) throw new Error();
        }
        if (snapshot) {
          snapshot = { ...snapshot, id: crypto.randomUUID(), historical: true, imported: true };
          state.pricing = { ...state.pricing!, snapshotId: snapshot.id, historical: true };
          if (validateMarketConstruction(state, snapshot).length) throw new Error();
        }
        if (lifecycle !== null) {
          if (lifecycle.schemaVersion === 2) { lifecycle.legacy.initial = structuredClone(state); projectPositionLots(lifecycle); }
          else { lifecycle.initial = structuredClone(state); projectPosition(lifecycle); }
        }
        validateCashExpiryBasis(state, snapshot, lifecycle);
      } catch { throw new SavedStoreError('invalid_request', 400); }
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const row = await db.prepare(`INSERT INTO saved_strategies (id, owner, title, state_json, snapshot_json, lifecycle_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING ${columns}`)
        .bind(id, owner, title, JSON.stringify(state), snapshot ? JSON.stringify(snapshot) : null, lifecycle ? JSON.stringify(lifecycle) : null, now, now).first<Row>();
      if (!row) throw new Error('Import failed');
      return decode(row);
    },
    async create(owner: string, title: string, state: StrategyState, snapshot?: MarketSnapshot) {
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const row = await db.prepare(`INSERT INTO saved_strategies (id, owner, title, state_json, snapshot_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) RETURNING ${columns}`)
        .bind(id, owner, titleValue(title), JSON.stringify(state), snapshot ? JSON.stringify(snapshot) : null, now, now).first<Row>();
      if (!row) throw new Error("Save failed");
      return decode(row);
    },
    async update(owner: string, id: string, revision: number, title: string, state: StrategyState, snapshot?: MarketSnapshot) {
      const row = await db.prepare(`UPDATE saved_strategies SET title = ?, state_json = ?, snapshot_json = ?, revision = revision + 1, updated_at = ? WHERE owner = ? AND id = ? AND revision = ? AND lifecycle_json IS NULL RETURNING ${columns}`)
        .bind(titleValue(title), JSON.stringify(state), snapshot ? JSON.stringify(snapshot) : null, new Date().toISOString(), owner, id, revisionValue(revision)).first<Row>();
      return row ? decode(row) : conflict(owner, id);
    },
    async close(owner: string, id: string, revision: number, request: CloseRequest) {
      return writeEvent(owner, id, revision, request?.id, position => {
        if (position.schemaVersion === 1) return recordClose(position, request);
        if (!position.legacy.closes.some(event => event.id === request?.id) || JSON.stringify(recordClose(position.legacy, request)) !== JSON.stringify(position.legacy)) throw new Error("New closes require explicit lot allocation");
        return position;
      });
    },
    async correctPrice(owner: string, id: string, revision: number, request: PriceCorrection) {
      return writeEvent(owner, id, revision, request?.id, position => {
        if (position.schemaVersion === 1) return recordPriceCorrection(position, request);
        if (position.legacy.priceCorrections?.some(event => event.id === request?.id)) {
          recordPriceCorrection(position.legacy, request);
          return position;
        }
        return recordLotPriceCorrection(position, request);
      });
    },
    async correctOpeningPrice(owner: string, id: string, revision: number, request: OpeningPriceCorrection) {
      return writeEvent(owner, id, revision, request?.id, position => recordLotOpeningPriceCorrection(position.schemaVersion === 2 ? position : upgradePositionLots(position), request));
    },
    async voidClose(owner: string, id: string, revision: number, request: CloseVoid) {
      return writeEvent(owner, id, revision, request?.id, position => {
        if (position.schemaVersion === 1) return recordCloseVoid(position, request);
        if (position.legacy.closeVoids?.some(event => event.id === request?.id)) {
          recordCloseVoid(position.legacy, request);
          return position;
        }
        return recordLotCloseVoid(position, request);
      });
    },
    async transact(owner: string, id: string, revision: number, request: LotTransaction) {
      return writeEvent(owner, id, revision, request?.id, position => recordLotTransaction(position.schemaVersion === 2 ? position : upgradePositionLots(position), request));
    },
    async resolveExpiry(owner: string, id: string, revision: number, request: ExpiryResolution) {
      return writeEvent(owner, id, revision, request?.id, position => recordExpiryResolution(position.schemaVersion === 2 ? position : upgradePositionLots(position), request));
    },
    async voidExpiry(owner: string, id: string, revision: number, request: ExpiryVoid) {
      return writeEvent(owner, id, revision, request?.id, position => recordExpiryVoid(position.schemaVersion === 2 ? position : upgradePositionLots(position), request));
    },
    async remove(owner: string, id: string, revision: number) {
      const row = await db.prepare("DELETE FROM saved_strategies WHERE owner = ? AND id = ? AND revision = ? RETURNING id")
        .bind(owner, id, revisionValue(revision)).first<{ id: string }>();
      if (!row) await conflict(owner, id);
    },
  };
}
