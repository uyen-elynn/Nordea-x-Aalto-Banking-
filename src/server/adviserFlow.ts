// Adviser flow: how the customer's information reaches Nordea's agent and the adviser, and how
// updates from the Nordea side come back to the customer to accept, edit or delete.
//
//   Customer → Abel → Context Cabinet → Nordea's agent → adviser (Kalle)
//
// Sharing per item uses the cabinet's own fields: an item is shared with Nordea when it is not
// private and readableBy.adviser is not false. Every adviser read goes through the access gateway
// (or is logged like one), so it shows up in the customer's "Who used it".
//
// Suggestions, the meeting and the recorder draft are demo state kept in memory: they reset when the
// server restarts or with POST /api/flow/reset. Accepted suggestions become real cabinet entries.
import type { Express, Request, Response } from 'express';
import { db } from './db.js';
import { hasActiveShare, previewCabinetForAgent, readCabinetThroughGateway } from './accessGateway.js';
import { loadBus } from './arch/store/busStore.js';
import { decideProposal } from './arch/orchestrator.js';
import type { AccessLogEntry, CabinetEntry, CabinetEntryType } from '../types.js';

export type SuggestBy = 'adviser' | 'nordea_agent' | 'recorder';
export interface Suggestion {
  id: string;
  userId: string;
  by: SuggestBy;
  type: CabinetEntryType;
  title: string;
  detail: string;
  reason: string;
  /** Set when the suggestion changes an existing item instead of adding a new one. */
  replacesId?: string;
  replacesTitle?: string;
  createdAt: string;
  status: 'waiting' | 'accepted' | 'edited' | 'deleted';
  decidedAt?: string;
  finalTitle?: string;
}
export interface MeetingRequest { question: string; need: string; entryId?: string; status: 'asked' | 'once' | 'always' | 'declined'; at: string }
export interface DraftNote { type: CabinetEntryType; title: string; detail: string; checked: boolean }
export interface Meeting {
  status: 'booked' | 'live' | 'ended';
  when: string;
  topic: string;
  request?: MeetingRequest;
  /** Items shown "for this meeting only": restored when the meeting ends. */
  once: { id: string; private: boolean; adviser?: boolean }[];
  draft: DraftNote[];
  draftSent: boolean;
  agentChecked: boolean;
}

export const ADVISER = { name: 'Kalle', role: 'Private banker' };
const BY_LABEL: Record<SuggestBy, string> = {
  adviser: `${ADVISER.name}, your private banker`,
  nordea_agent: "Nordea's agent",
  recorder: `Meeting notes · AI recorder, checked by ${ADVISER.name}`,
};

const flows = new Map<string, { suggestions: Suggestion[]; meeting: Meeting }>();
const newId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

function flowOf(userId: string) {
  let f = flows.get(userId);
  if (!f) {
    f = { suggestions: [], meeting: { status: 'booked', when: 'Thu 6 Nov, 09:30–10:00', topic: 'Flat, wedding and travel plans', once: [], draft: [], draftSent: false, agentChecked: false } };
    flows.set(userId, f);
  }
  return f;
}

/** Shared with Nordea: Nordea's agent and the adviser may use it (during an active meeting share). */
export const isShared = (e: CabinetEntry) => !e.private && e.readableBy?.adviser !== false;
const usable = (e: CabinetEntry) => e.status !== 'archived' && e.status !== 'disputed' && !(e.source === 'nordea' && !e.reviewed);

function logRead(userId: string, entries: CabinetEntry[], who: string, purpose: string) {
  const log: AccessLogEntry = {
    id: newId('log'), timestamp: now(), userId, agentId: 'adviser', agentName: who, purpose,
    itemsReadCount: entries.length, blockedCount: 0, allowedItems: entries.map((e) => e.title), allowedIds: entries.map((e) => e.id), blockedReasons: [],
  };
  db.addAccessLogEntry(log);
}

/** Who on the Nordea side used each item, newest first (from the access log). */
function readsByEntry(userId: string) {
  const out: Record<string, { at: string; who: string; purpose: string }[]> = {};
  for (const l of db.getAccessLog(userId).filter((x) => x.agentId === 'adviser')) {
    for (const id of l.allowedIds || []) (out[id] ||= []).push({ at: l.timestamp, who: l.agentName, purpose: l.purpose });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

function ensureMeetingShare(userId: string) {
  if (hasActiveShare(userId, 'adviser')) return;
  const items = db.getCabinetEntries(userId).filter((e) => usable(e) && isShared(e)).map((e) => e.title);
  const until = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  db.addShare({ id: newId('share'), userId, agentId: 'adviser', items, createdAt: now(), until, revoked: false });
}

function setShared(userId: string, e: CabinetEntry, shared: boolean, how: string) {
  const rb = { ...e.readableBy, adviser: shared };
  // A private (sensitive) item that becomes shared with the adviser still stays away from offers.
  if (shared && e.private) rb.offers = false;
  db.updateCabinetEntry(e.id, shared ? { private: false, readableBy: rb } : { readableBy: rb }, { by: 'you', how });
}

/** Scripted recorder draft for the demo meeting (a real recorder would write this from the call). */
function recorderDraft(m: Meeting): DraftNote[] {
  const showed = m.request?.status === 'once' || m.request?.status === 'always';
  return [
    { type: 'fact', title: 'Save 550 € a month for the flat from January', detail: `Agreed in the meeting: up from 400 €, when the raise starts.${showed ? ' The travel budget fits next to it.' : ''}`, checked: false },
    { type: 'fact', title: 'Home loan pre-approval in spring 2027', detail: `${ADVISER.name} sends the application in March 2027.`, checked: false },
  ];
}

export function registerAdviserFlowRoutes(app: Express) {
  const uidOf = (req: Request) => String((req.method === 'GET' ? req.query.userId : req.body?.userId) || 'lauri');
  const customerView = (userId: string) => {
    const f = flowOf(userId);
    const entries = db.getCabinetEntries(userId).filter(usable);
    return {
      adviser: ADVISER,
      meeting: f.meeting,
      suggestions: f.suggestions.map((s) => ({ ...s, byLabel: BY_LABEL[s.by] })),
      reads: readsByEntry(userId),
      shareActive: hasActiveShare(userId, 'adviser'),
      sharedIds: entries.filter(isShared).map((e) => e.id),
      hiddenIds: entries.filter((e) => !isShared(e)).map((e) => e.id),
    };
  };
  const send = (res: Response, userId: string) => res.json(customerView(userId));

  // What the customer's app needs.
  app.get('/api/flow', (req, res) => send(res, uidOf(req)));

  // What the adviser sees: only shared items, and only while a meeting share is active.
  app.get('/api/flow/adviser', (req, res) => {
    const userId = uidOf(req);
    const user = db.getUser(userId);
    const f = flowOf(userId);
    const shareActive = hasActiveShare(userId, 'adviser');
    const allowed = shareActive ? previewCabinetForAgent(userId, 'adviser').allowed.filter(isShared) : [];
    const hidden = db.getCabinetEntries(userId).filter(usable).length - allowed.length;
    const req2 = f.meeting.request;
    const shown = req2?.entryId && (req2.status === 'once' || req2.status === 'always') ? db.getCabinetEntry(req2.entryId) : undefined;
    res.json({
      adviser: ADVISER,
      customer: user ? { id: user.id, name: user.name, age: user.age } : { id: userId, name: userId },
      shareActive,
      notes: allowed.map((e) => ({ id: e.id, type: e.type, title: e.title, detail: e.detail, from: e.source === 'nordea' ? 'Nordea' : 'Customer' })),
      hiddenCount: Math.max(0, hidden),
      meeting: f.meeting,
      shownItem: shown ? { title: shown.title, detail: shown.detail } : undefined,
      suggestions: f.suggestions.map((s) => ({ ...s, byLabel: BY_LABEL[s.by] })),
      log: db.getAccessLog(userId).filter((l) => l.agentId === 'adviser').slice(-8).reverse().map((l) => ({ at: l.timestamp, who: l.agentName, purpose: l.purpose, count: l.itemsReadCount })),
    });
  });

  // Customer: share an item with Nordea, or keep it only for themselves.
  app.post('/api/flow/share', (req, res) => {
    const userId = uidOf(req);
    const e = db.getCabinetEntry(String(req.body?.entryId));
    if (!e || e.userId !== userId) return res.status(404).json({ error: 'Item not found' });
    const shared = !!req.body?.shared;
    setShared(userId, e, shared, shared ? 'You shared it with Nordea' : 'You made it only yours');
    send(res, userId);
  });

  // Nordea side: suggest a new item or a change. It waits for the customer.
  app.post('/api/flow/suggest', (req, res) => {
    const userId = uidOf(req);
    const b = req.body || {};
    const by: SuggestBy = b.by === 'nordea_agent' || b.by === 'recorder' ? b.by : 'adviser';
    const title = String(b.title || '').trim().slice(0, 140);
    if (!title) return res.status(400).json({ error: 'A title is needed' });
    const target = b.replacesId ? db.getCabinetEntry(String(b.replacesId)) : undefined;
    const types: CabinetEntryType[] = ['goal', 'life_event', 'preference', 'fact', 'observation'];
    flowOf(userId).suggestions.unshift({
      id: newId('sug'), userId, by, type: types.includes(b.type) ? b.type : target?.type || 'fact', title, detail: String(b.detail || '').slice(0, 400),
      reason: String(b.reason || (by === 'adviser' ? `Written by ${ADVISER.name}.` : by === 'recorder' ? `Drafted by the AI meeting recorder. ${ADVISER.name} checked it before sending.` : 'Seen in your Nordea data.')).slice(0, 200),
      replacesId: target && target.userId === userId ? target.id : undefined, replacesTitle: target && target.userId === userId ? target.title : undefined,
      createdAt: now(), status: 'waiting',
    });
    send(res, userId);
  });

  // Customer: accept (optionally edited) or delete a suggestion. Only an accepted one reaches the cabinet.
  app.post('/api/flow/decide', (req, res) => {
    const userId = uidOf(req);
    const s = flowOf(userId).suggestions.find((x) => x.id === req.body?.id && x.status === 'waiting');
    if (!s) return res.status(404).json({ error: 'That update is no longer waiting' });
    if (req.body?.decision === 'delete') {
      Object.assign(s, { status: 'deleted', decidedAt: now() });
      return send(res, userId);
    }
    const title = String(req.body?.title || s.title).trim().slice(0, 140) || s.title;
    const detail = String(req.body?.detail ?? s.detail).slice(0, 400);
    const edited = title !== s.title || detail !== s.detail;
    const how = `Suggested by ${BY_LABEL[s.by]}. ${edited ? 'You edited and accepted it.' : 'You accepted it.'}`;
    const target = s.replacesId ? db.getCabinetEntry(s.replacesId) : undefined;
    if (target && target.userId === userId) {
      db.updateCabinetEntry(target.id, { title, detail, confirmedAt: now() }, { by: 'nordea', how });
    } else {
      const e: CabinetEntry = {
        id: newId('entry'), userId, type: s.type, title, detail, source: 'nordea', status: 'active', private: false,
        readableBy: { abel: true, offers: false, adviser: true },
        provenance: { channel: s.by === 'nordea_agent' ? 'system' : 'staff', detectedFrom: BY_LABEL[s.by] },
        why: s.reason, reviewed: true, goalType: s.type === 'goal' ? 'other' : undefined, confirmedAt: now(), createdAt: now(), updatedAt: now(),
      };
      db.addCabinetEntry(e, { by: 'nordea', how });
      // The app's review queue holds bank-side items until the customer consents. Accepting here IS that
      // consent, so the waiting write is decided now (the same path the app's own Confirm button uses).
      const waiting = loadBus(userId).messages.find((m) => m.type === 'propose' && m.status === 'pending'
        && (m.payload as { appWrite?: boolean; entry?: { id?: string } } | undefined)?.entry?.id === e.id);
      if (waiting) decideProposal(userId, waiting.id, true);
    }
    Object.assign(s, { status: edited ? 'edited' : 'accepted', decidedAt: now(), finalTitle: title });
    send(res, userId);
  });

  // Adviser: prepare the meeting. Nordea's agent writes notes from shared items, then Kalle reads them.
  app.post('/api/flow/prep', (req, res) => {
    const userId = uidOf(req);
    ensureMeetingShare(userId);
    const r = readCabinetThroughGateway(userId, 'adviser', "Nordea's agent: wrote pre-meeting notes");
    const shared = r.allowed.filter(isShared);
    if (shared.length) logRead(userId, shared, ADVISER.name, `${ADVISER.name}: read the notes to prepare your meeting`);
    res.json({ ok: true, read: shared.length });
  });

  // Meeting start / end. Ending restores items shown "for this meeting only" and drafts recorder notes.
  app.post('/api/flow/meeting', (req, res) => {
    const userId = uidOf(req);
    const m = flowOf(userId).meeting;
    if (req.body?.action === 'start') {
      ensureMeetingShare(userId);
      Object.assign(m, { status: 'live', request: undefined, draft: [], draftSent: false });
    } else if (req.body?.action === 'end' && m.status === 'live') {
      for (const o of m.once) {
        const e = db.getCabinetEntry(o.id);
        if (e) db.updateCabinetEntry(e.id, { private: o.private, readableBy: { ...e.readableBy, adviser: o.adviser ?? false } }, { by: 'you', how: 'Meeting ended: hidden from Nordea again' });
      }
      m.once = [];
      m.status = 'ended';
      m.draft = recorderDraft(m);
    }
    send(res, userId);
  });

  // Adviser, during the meeting: ask to see something the customer hasn't shared.
  app.post('/api/flow/request', (req, res) => {
    const userId = uidOf(req);
    const m = flowOf(userId).meeting;
    if (m.status !== 'live') return res.status(400).json({ error: 'Start the meeting first' });
    const need = String(req.body?.need || '').slice(0, 120);
    const question = String(req.body?.question || '').slice(0, 200);
    // Match the need against the customer's hidden items (the adviser never sees their titles).
    const words = need.toLowerCase().split(/[^a-zåäö0-9]+/).filter((w) => w.length > 3);
    const hidden = db.getCabinetEntries(userId).filter((e) => usable(e) && !isShared(e));
    const syn: Record<string, string[]> = { travel: ['trip', 'japan', 'holiday', 'honeymoon', 'travel'], honeymoon: ['trip', 'japan', 'honeymoon', 'travel'] };
    const keys = [...new Set(words.flatMap((w) => [w, ...(syn[w] || [])]))];
    const match = hidden.find((e) => keys.some((k) => `${e.title} ${e.detail} ${e.goalType || ''}`.toLowerCase().includes(k)));
    m.request = { question, need, entryId: match?.id, status: 'asked', at: now() };
    send(res, userId);
  });

  // Customer answers the adviser's request: this meeting only, from now on, or not now.
  app.post('/api/flow/answer', (req, res) => {
    const userId = uidOf(req);
    const m = flowOf(userId).meeting;
    if (!m.request || m.request.status !== 'asked') return res.status(400).json({ error: 'No question is waiting' });
    const answer = req.body?.answer;
    const e = db.getCabinetEntry(String(req.body?.entryId || m.request.entryId || ''));
    if (answer === 'no' || !e || e.userId !== userId) { m.request.status = 'declined'; return send(res, userId); }
    if (answer === 'once') {
      m.once.push({ id: e.id, private: e.private, adviser: e.readableBy?.adviser });
      setShared(userId, e, true, 'You showed it for this meeting only');
    } else {
      setShared(userId, e, true, 'You shared it with Nordea during the meeting');
    }
    m.request.entryId = e.id;
    m.request.status = answer === 'once' ? 'once' : 'always';
    logRead(userId, [e], ADVISER.name, `${ADVISER.name}: during your meeting, after you allowed it`);
    send(res, userId);
  });

  // Adviser: send the checked recorder notes to the customer.
  app.post('/api/flow/draft', (req, res) => {
    const userId = uidOf(req);
    const f = flowOf(userId);
    const notes: DraftNote[] = Array.isArray(req.body?.draft) ? req.body.draft : [];
    for (const n of notes.filter((x) => x && x.checked && String(x.title || '').trim())) {
      f.suggestions.unshift({ id: newId('sug'), userId, by: 'recorder', type: n.type || 'fact', title: String(n.title).slice(0, 140), detail: String(n.detail || '').slice(0, 400),
        reason: `Drafted by the AI meeting recorder. ${ADVISER.name} checked it before sending.`, createdAt: now(), status: 'waiting' });
    }
    f.meeting.draft = [];
    f.meeting.draftSent = true;
    send(res, userId);
  });

  // Nordea's agent checks the bank data and suggests an update (scripted for the demo customer).
  app.post('/api/flow/agent-check', (req, res) => {
    const userId = uidOf(req);
    const f = flowOf(userId);
    if (!f.suggestions.some((s) => s.by === 'nordea_agent' && s.status === 'waiting')) {
      f.suggestions.unshift({ id: newId('sug'), userId, by: 'nordea_agent', type: 'fact', title: 'Salary rises to 6 250 € gross from January',
        detail: 'Plus a 1 200 € bonus on 20 December 2026.', reason: 'Read from the payslip your employer sends to Nordea.', createdAt: now(), status: 'waiting' });
    }
    f.meeting.agentChecked = true;
    send(res, userId);
  });

  // Demo: Lauri keeps the travel goal to herself, so the meeting can show a live request.
  app.post('/api/flow/demo-setup', (req, res) => {
    const userId = uidOf(req);
    const travel = db.getCabinetEntries(userId).find((e) => usable(e) && /japan|trip|travel|honeymoon/i.test(`${e.title} ${e.goalType || ''}`));
    if (travel && isShared(travel)) setShared(userId, travel, false, 'You made it only yours');
    send(res, userId);
  });

  // Demo: start the story again (restores anything shown for one meeting).
  app.post('/api/flow/reset', (req, res) => {
    const userId = uidOf(req);
    const f = flows.get(userId);
    for (const o of f?.meeting.once || []) {
      const e = db.getCabinetEntry(o.id);
      if (e) db.updateCabinetEntry(e.id, { private: o.private, readableBy: { ...e.readableBy, adviser: o.adviser ?? false } }, { by: 'you', how: 'Demo reset' });
    }
    flows.delete(userId);
    send(res, userId);
  });
}
