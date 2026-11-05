// Client calls for the information flow (customer ↔ Nordea's agent ↔ adviser). See src/server/adviserFlow.ts.
import type { CabinetEntryType } from '../types.js';

export type SuggestBy = 'adviser' | 'nordea_agent' | 'recorder';
export interface Suggestion {
  id: string; by: SuggestBy; byLabel: string; type: CabinetEntryType; title: string; detail: string; reason: string;
  replacesId?: string; replacesTitle?: string; createdAt: string; status: 'waiting' | 'accepted' | 'edited' | 'deleted'; decidedAt?: string; finalTitle?: string;
}
export interface DraftNote { type: CabinetEntryType; title: string; detail: string; checked: boolean }
export interface Meeting {
  status: 'booked' | 'live' | 'ended'; when: string; topic: string;
  request?: { question: string; need: string; entryId?: string; status: 'asked' | 'once' | 'always' | 'declined'; at: string };
  draft: DraftNote[]; draftSent: boolean; agentChecked: boolean;
}
export interface FlowState {
  adviser: { name: string; role: string };
  meeting: Meeting;
  suggestions: Suggestion[];
  reads: Record<string, { at: string; who: string; purpose: string }[]>;
  shareActive: boolean;
  sharedIds: string[];
  hiddenIds: string[];
}
export interface AdviserView {
  adviser: { name: string; role: string };
  customer: { id: string; name: string; age?: number };
  shareActive: boolean;
  notes: { id: string; type: CabinetEntryType; title: string; detail: string; from: string }[];
  hiddenCount: number;
  meeting: Meeting;
  shownItem?: { title: string; detail: string };
  suggestions: Suggestion[];
  log: { at: string; who: string; purpose: string; count: number }[];
}

async function j<T>(r: Response): Promise<T> {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error || 'That didn’t work');
  return d as T;
}
const post = <T,>(url: string, body: Record<string, unknown>) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => j<T>(r));

export const fetchFlow = (userId: string) => fetch(`/api/flow?userId=${encodeURIComponent(userId)}`).then((r) => j<FlowState>(r));
export const fetchAdviserView = (userId: string) => fetch(`/api/flow/adviser?userId=${encodeURIComponent(userId)}`).then((r) => j<AdviserView>(r));
export const shareEntry = (userId: string, entryId: string, shared: boolean) => post<FlowState>('/api/flow/share', { userId, entryId, shared });
export const decideSuggestion = (userId: string, id: string, decision: 'accept' | 'delete', edits?: { title: string; detail: string }) =>
  post<FlowState>('/api/flow/decide', { userId, id, decision, ...(edits || {}) });
export const suggest = (userId: string, s: { by: SuggestBy; type?: CabinetEntryType; title: string; detail: string; replacesId?: string; reason?: string }) =>
  post<FlowState>('/api/flow/suggest', { userId, ...s });
export const prepMeeting = (userId: string) => post<{ ok: boolean; read: number }>('/api/flow/prep', { userId });
export const meetingAction = (userId: string, action: 'start' | 'end') => post<FlowState>('/api/flow/meeting', { userId, action });
export const askInMeeting = (userId: string, question: string, need: string) => post<FlowState>('/api/flow/request', { userId, question, need });
export const answerRequest = (userId: string, answer: 'once' | 'always' | 'no', entryId?: string) => post<FlowState>('/api/flow/answer', { userId, answer, entryId });
export const sendDraft = (userId: string, draft: DraftNote[]) => post<FlowState>('/api/flow/draft', { userId, draft });
export const agentCheck = (userId: string) => post<FlowState>('/api/flow/agent-check', { userId });
export const demoSetup = (userId: string) => post<FlowState>('/api/flow/demo-setup', { userId });
export const resetFlow = (userId: string) => post<FlowState>('/api/flow/reset', { userId });
