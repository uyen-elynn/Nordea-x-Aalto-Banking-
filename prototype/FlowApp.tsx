// Clickable prototype: how Lauri's information travels
//   You → Abel (your agent) → Context Cabinet → Nordea's agent → Kalle (private banker)
// and how updates from the Nordea side come back to Lauri to accept, edit or delete.
// Scripted data only. Reuses the main app's styles and building blocks without changing them.
import React, { useEffect, useRef, useState } from 'react';
import { PhoneFrame } from '../src/components/PhoneFrame.js';
import { BAND_BG, Band, DetailHead, NChev, NRow, RoundActions, Toggle } from '../src/components/Nordea.js';
import { Bell, BotAvatar, Icon } from '../src/ui/icons.js';
import { LOGO_WHITE } from '../src/constants/logos.js';

// ---------------- Data ----------------
type Who = 'you' | 'kalle' | 'agentN' | 'recorder';
type Kind = 'Goal' | 'Fact' | 'Preference' | 'Life event' | 'Note';
interface LogLine { when: string; text: string; side: 'you' | 'bank' }
interface Entry {
  id: string; kind: Kind; title: string; detail: string;
  addedBy: Who; via: string; shared: boolean; meetingOnly?: boolean;
  history: LogLine[]; reads: LogLine[];
}
interface Pending {
  id: string; kind: Kind; title: string; detail: string; by: Who; reason: string; when: string;
  targetId?: string; oldText?: string;
}
type Proposal = { kind: Kind; title: string; detail: string; targetId?: string; oldText?: string };
interface Msg { id: number; from: 'me' | 'bot'; text?: string; voice?: boolean; prop?: Proposal; decided?: 'shared' | 'private' | 'no' }

const WHO: Record<Who, { name: string; short: string; side: 'you' | 'bank' }> = {
  you: { name: 'You, via Abel', short: 'You', side: 'you' },
  kalle: { name: 'Kalle, your private banker', short: 'Kalle', side: 'bank' },
  agentN: { name: "Nordea's agent", short: "Nordea's agent", side: 'bank' },
  recorder: { name: 'Meeting notes · AI recorder, checked by Kalle', short: 'Meeting notes', side: 'bank' },
};
const ADVISER = 'Kalle';
const TODAY = 'Today';

const START_ENTRIES = (): Entry[] => [
  { id: 'wed', kind: 'Life event', title: 'Wedding with Mia in summer 2027', detail: 'Planning a small wedding in June 2027.', addedBy: 'you', via: 'chat', shared: true,
    history: [{ when: '12 Oct', text: 'Added by you in a chat with Abel', side: 'you' }, { when: '12 Oct', text: 'You chose: share with Nordea', side: 'you' }], reads: [] },
  { id: 'flat', kind: 'Goal', title: 'Flat deposit 30 000 € by April 2028', detail: 'Buying a flat in Espoo with Mia. 12 400 € saved so far.', addedBy: 'you', via: 'chat', shared: true,
    history: [{ when: '3 Sep', text: 'Added by you in a chat with Abel', side: 'you' }, { when: '3 Sep', text: 'You chose: share with Nordea', side: 'you' }], reads: [] },
  { id: 'japan', kind: 'Goal', title: 'Honeymoon in Japan, 4 000 €', detail: 'Trip in August 2027, right after the wedding.', addedBy: 'you', via: 'notes', shared: false,
    history: [{ when: '26 Oct', text: 'Added by you from your planning notes', side: 'you' }, { when: '26 Oct', text: 'You chose: only for you', side: 'you' }], reads: [] },
  { id: 'salary', kind: 'Fact', title: 'Net salary 3 900 € a month', detail: 'From your October payslip.', addedBy: 'you', via: 'payslip', shared: true,
    history: [{ when: '27 Oct', text: 'Added by you from a payslip you showed Abel', side: 'you' }], reads: [] },
  { id: 'buffer', kind: 'Preference', title: 'Keep at least 2 000 € in my current account', detail: 'A safety buffer you never want to go below.', addedBy: 'you', via: 'chat', shared: false,
    history: [{ when: '26 Oct', text: 'Added by you in a chat with Abel', side: 'you' }], reads: [] },
  { id: 'stocks', kind: 'Preference', title: 'No stocks before the flat is bought', detail: 'You prefer low-risk savings until then.', addedBy: 'you', via: 'chat', shared: true,
    history: [{ when: '26 Oct', text: 'Added by you in a chat with Abel', side: 'you' }], reads: [] },
];
const START_PENDING = (): Pending[] => [
  { id: 'p-car', kind: 'Fact', title: 'Your car loan ends in March 2027', detail: 'That frees up about 180 € a month from April 2027.', by: 'agentN',
    reason: 'Seen in your Nordea loan account.', when: 'Yesterday' },
];

const VOICE_TEXT = 'Mia and I decided the flat deposit should be 35 000 euros instead of 30 000. Still by April 2028.';

/** Abel turns what the customer said into one proposed cabinet entry (scripted for the prototype). */
function propose(text: string, entries: Entry[]): Proposal {
  const t = text.toLowerCase();
  const flat = entries.find((e) => e.id === 'flat');
  if (/(flat|deposit|apartment)/.test(t) && /35/.test(t) && flat)
    return { kind: 'Goal', title: 'Flat deposit 35 000 € by April 2028', detail: 'Raised from 30 000 €. Same date. 12 400 € saved so far.', targetId: 'flat', oldText: flat.title };
  if (/(mia).*(job)|new job/.test(t)) return { kind: 'Life event', title: 'Mia starts a new job in January 2027', detail: 'Her salary will be about 3 200 € a month.' };
  if (/car loan/.test(t)) return { kind: 'Fact', title: 'Car loan ends in March 2027', detail: 'Frees up about 180 € a month.' };
  if (/(raise|salary)/.test(t)) return { kind: 'Fact', title: 'Salary rises from January 2027', detail: 'Gross salary 6 250 € a month from 1 January.' };
  if (/(honeymoon|japan)/.test(t)) return { kind: 'Goal', title: 'Honeymoon in Japan, 4 000 €', detail: 'Trip in August 2027.' };
  const clean = text.trim().replace(/\s+/g, ' ');
  return { kind: 'Note', title: clean.length > 60 ? clean.slice(0, 57) + '…' : clean, detail: 'Saved as you said it.' };
}

// ---------------- Small pieces ----------------
const STOPS = [
  { key: 'you', label: 'You', icon: 'person', side: 'you' },
  { key: 'abel', label: 'Abel', icon: 'spark', side: '' },
  { key: 'cab', label: 'Cabinet', icon: 'cab', side: '' },
  { key: 'agent', label: "Nordea's agent", icon: 'shield', side: 'bank' },
  { key: 'adv', label: ADVISER, icon: 'contact', side: 'bank' },
];
/** The path one piece of information takes. upTo = last stop reached; a private item stops at the cabinet. */
const Trace: React.FC<{ upTo: number; note?: string; stopAfterCabinet?: boolean }> = ({ upTo, note, stopAfterCabinet }) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const ids: number[] = [];
    for (let i = 0; i <= upTo; i++) ids.push(window.setTimeout(() => setShown(i), 220 * i));
    return () => ids.forEach(clearTimeout);
  }, [upTo]);
  return (
    <div>
      <div className="trace" role="img" aria-label={`Path: ${STOPS.slice(0, upTo + 1).map((s) => s.label).join(' to ')}${stopAfterCabinet ? '. Stops at your cabinet.' : ''}`}>
        {STOPS.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <span className={`tline${i <= shown ? ' on' : ''}`} />}
            <span className={`tnode ${s.side}${i <= shown ? ' on' : ''}${stopAfterCabinet && i > 2 ? ' stop' : ''}`}>
              <span className="tdot"><Icon name={stopAfterCabinet && i > 2 ? 'shield' : s.icon} /></span>
              <span className="tlab">{s.label}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
      {note && <p className="trace-note">{note}</p>}
    </div>
  );
};

const SharePill: React.FC<{ e: Entry }> = ({ e }) =>
  e.shared ? <span className="spill shared">Shared with Nordea</span> : e.meetingOnly ? <span className="spill meeting">This meeting only</span> : <span className="spill private">Only you</span>;

const viaText = (e: Entry) => `${e.kind} · ${e.addedBy === 'you' ? 'Added by you' : 'Added by ' + WHO[e.addedBy].short}${e.via ? ', ' + (e.via === 'voice' ? 'by voice' : e.via === 'payslip' ? 'from a payslip' : e.via === 'notes' ? 'from notes' : e.via === 'meeting' ? 'after a meeting' : 'in chat') : ''}`;

// ---------------- App ----------------
type Tab = 'home' | 'cab' | 'rewards' | 'contact' | 'more';
type Page = null | 'flow' | 'prep' | { item: string };

export default function FlowApp() {
  const [entries, setEntries] = useState<Entry[]>(START_ENTRIES);
  const [pending, setPending] = useState<Pending[]>(START_PENDING);
  const [tab, setTab] = useState<Tab>('home');
  const [page, setPage] = useState<Page>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [rec, setRec] = useState(false);
  const [typing, setTyping] = useState(false);
  const [meeting, setMeeting] = useState<null | { stage: number }>(null);
  const [edit, setEdit] = useState<null | { mode: 'entry' | 'pending' | 'prop'; id: string | number; title: string; detail: string; shared: boolean }>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [openStep, setOpenStep] = useState<number | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const recTimer = useRef<number | null>(null);
  const msgId = useRef(1);

  useEffect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { screenRef.current?.scrollTo(0, 0); }, [tab, page]);
  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight); }, [msgs, typing, chatOpen]);

  const mark = (k: string) => setDone((d) => ({ ...d, [k]: true }));
  const go = (t: Tab) => { setTab(t); setPage(null); };
  const sharedCount = entries.filter((e) => e.shared).length;

  // ----- Chat with Abel -----
  const openChat = (voice = false) => {
    setChatOpen(true);
    if (!msgs.length) setMsgs([{ id: msgId.current++, from: 'bot', text: `Hi Lauri. Tell me what's new, by typing or by voice. I'll suggest a short note for your Context Cabinet, and nothing is saved until you say so.` }]);
    if (voice) window.setTimeout(startVoice, 450);
  };
  const send = (text: string, voice = false) => {
    if (!text.trim()) return;
    const p = propose(text, entries);
    setMsgs((m) => [...m, { id: msgId.current++, from: 'me', text, voice }]);
    setDraft('');
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m,
        { id: msgId.current++, from: 'bot', text: p.targetId ? 'Got it. That changes a goal you already have. Here is the update I would make:' : 'Got it. Here is the note I would add:' },
        { id: msgId.current++, from: 'bot', prop: p }]);
    }, 900);
  };
  const startVoice = () => {
    if (rec) return;
    setRec(true); setDraft('');
    const words = VOICE_TEXT.split(' ');
    let i = 0;
    recTimer.current = window.setInterval(() => {
      i++;
      setDraft(words.slice(0, i).join(' '));
      if (i >= words.length) stopVoice(true);
    }, 190);
  };
  const stopVoice = (sendIt: boolean) => {
    if (recTimer.current) clearInterval(recTimer.current);
    recTimer.current = null;
    setRec(false);
    if (sendIt) { send(VOICE_TEXT, true); mark('voice'); }
  };
  const decide = (m: Msg, how: 'shared' | 'private' | 'no', override?: { title: string; detail: string }) => {
    setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, decided: how, prop: override && x.prop ? { ...x.prop, ...override } : x.prop } : x)));
    if (how === 'no' || !m.prop) { setToast('Not saved. Abel forgets it.'); return; }
    const p = { ...m.prop, ...(override || {}) };
    const line: LogLine = { when: TODAY, text: how === 'shared' ? 'You chose: share with Nordea' : 'You chose: only for you', side: 'you' };
    if (p.targetId) {
      setEntries((es) => es.map((e) => (e.id === p.targetId ? { ...e, title: p.title, detail: p.detail, shared: how === 'shared', via: m.voice ? 'voice' : 'chat',
        history: [...e.history, { when: TODAY, text: `Changed by you${m.voice ? ' by voice' : ''}: "${p.oldText}" → "${p.title}"`, side: 'you' }, line] } : e)));
    } else {
      const id = 'e' + Date.now();
      setEntries((es) => [{ id, kind: p.kind, title: p.title, detail: p.detail, addedBy: 'you', via: m.voice ? 'voice' : 'chat', shared: how === 'shared',
        history: [{ when: TODAY, text: `Added by you${m.voice ? ' by voice' : ''} in a chat with Abel`, side: 'you' }, line], reads: [] }, ...es]);
    }
    setToast(how === 'shared' ? `Saved and shared. ${ADVISER} can use it.` : 'Saved in your cabinet. Only you can see it.');
  };

  // ----- Updates from the Nordea side -----
  const accept = (p: Pending, override?: { title: string; detail: string }) => {
    const q = { ...p, ...(override || {}) };
    const line: LogLine = { when: TODAY, text: `Suggested by ${WHO[p.by].name}. ${override ? 'You edited and accepted it.' : 'You accepted it.'}`, side: 'bank' };
    if (q.targetId) {
      setEntries((es) => es.map((e) => (e.id === q.targetId ? { ...e, title: q.title, detail: q.detail, history: [...e.history, line] } : e)));
    } else {
      setEntries((es) => [{ id: 'e' + Date.now(), kind: q.kind, title: q.title, detail: q.detail, addedBy: p.by, via: p.by === 'recorder' || p.by === 'kalle' ? 'meeting' : '', shared: true, history: [line], reads: [] }, ...es]);
    }
    setPending((ps) => ps.filter((x) => x.id !== p.id));
    setToast(`Added to your cabinet. ${WHO[p.by].short} is told you accepted.`);
  };
  const reject = (p: Pending) => {
    setPending((ps) => ps.filter((x) => x.id !== p.id));
    setToast(`Deleted. It was never added, and ${WHO[p.by].short} is told.`);
  };

  // ----- Cabinet edits -----
  const saveEdit = () => {
    if (!edit) return;
    if (edit.mode === 'entry') {
      setEntries((es) => es.map((e) => (e.id === edit.id ? { ...e, title: edit.title, detail: edit.detail, shared: edit.shared,
        history: [...e.history, { when: TODAY, text: 'Edited by you' + (edit.shared !== e.shared ? (edit.shared ? ' · now shared with Nordea' : ' · now only for you') : ''), side: 'you' }] } : e)));
      setToast('Saved. Nordea sees the new version only if it is shared.');
    } else if (edit.mode === 'pending') {
      const p = pending.find((x) => x.id === edit.id);
      if (p) accept(p, { title: edit.title, detail: edit.detail });
    } else {
      const m = msgs.find((x) => x.id === edit.id);
      if (m) decide(m, edit.shared ? 'shared' : 'private', { title: edit.title, detail: edit.detail });
    }
    setEdit(null);
  };
  const setShared = (id: string, shared: boolean) => {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, shared, meetingOnly: false, history: [...e.history, { when: TODAY, text: shared ? 'You chose: share with Nordea' : 'You stopped sharing it with Nordea', side: 'you' }] } : e)));
    setToast(shared ? 'Shared with Nordea.' : `Not shared any more. ${ADVISER} and Nordea's agent can't see it.`);
  };
  const remove = (id: string) => {
    setEntries((es) => es.filter((e) => e.id !== id));
    setPage(null);
    setToast('Deleted from your cabinet, also for Nordea.');
  };

  // ----- Demo story steps -----
  const prepMeeting = () => {
    setEntries((es) => es.map((e) => (e.shared ? { ...e, reads: [...e.reads,
      { when: TODAY + ' 16:02', text: "Nordea's agent used it to write pre-meeting notes", side: 'bank' },
      { when: TODAY + ' 16:10', text: `${ADVISER} read it to prepare your meeting`, side: 'bank' }] } : e)));
    mark('prep');
    setToast(`${ADVISER} opened your ${sharedCount} shared items to prepare. Each read is logged.`);
  };
  const startMeeting = () => { setChatOpen(false); setMeeting({ stage: 0 }); mark('meet');
    window.setTimeout(() => setMeeting((m) => (m && m.stage === 0 ? { stage: 1 } : m)), 2600); };
  const meetingAnswer = (how: 'once' | 'always' | 'no') => {
    if (how !== 'no') setEntries((es) => es.map((e) => (e.id === 'japan' ? { ...e, shared: how === 'always' || e.shared, meetingOnly: how === 'once',
      reads: [...e.reads, { when: TODAY + ' (meeting)', text: `${ADVISER} saw it during your meeting, after you allowed it`, side: 'bank' }],
      history: [...e.history, { when: TODAY, text: how === 'always' ? 'You chose: share with Nordea' : 'You showed it for this meeting only', side: 'you' }] } : e)));
    setMeeting({ stage: how === 'no' ? 3 : 2 });
  };
  const endMeeting = () => {
    setMeeting(null);
    setEntries((es) => es.map((e) => (e.meetingOnly ? { ...e, meetingOnly: false, history: [...e.history, { when: TODAY, text: 'Meeting ended. Hidden from Nordea again.', side: 'you' }] } : e)));
    setPage(null); setTab('cab');
    window.setTimeout(notesArrive, 1200);
  };
  const notesArrive = () => {
    setPending((ps) => [
      { id: 'p-save', kind: 'Goal', title: 'Save 550 € a month for the flat from January', detail: 'Agreed in the meeting: up from 400 €, when your raise starts.', by: 'recorder',
        reason: `Drafted by the AI meeting recorder. ${ADVISER} checked it before sending.`, when: TODAY },
      { id: 'p-loan', kind: 'Note', title: 'Home loan pre-approval in spring 2027', detail: `${ADVISER} will send the application in March 2027.`, by: 'kalle',
        reason: `Written by ${ADVISER} after your meeting.`, when: TODAY },
      ...ps.filter((p) => p.id !== 'p-save' && p.id !== 'p-loan')]);
    mark('notes');
    setToast(`${ADVISER} sent 2 updates from your meeting. They wait for you.`);
  };
  const agentSuggests = () => {
    setPending((ps) => [{ id: 'p-raise', kind: 'Fact', title: 'Salary rises to 6 250 € gross from January', detail: 'Plus a 1 200 € bonus on 20 December 2026.', by: 'agentN',
      reason: 'Read from the payslip your employer sends to Nordea.', when: TODAY }, ...ps.filter((p) => p.id !== 'p-raise')]);
    mark('agent');
    setToast("Nordea's agent suggested an update. Nothing changes until you accept.");
  };
  const reset = () => {
    setEntries(START_ENTRIES()); setPending(START_PENDING()); setMsgs([]); setDraft(''); setDone({}); setMeeting(null);
    setChatOpen(false); setPage(null); setTab('home'); setRec(false); if (recTimer.current) clearInterval(recTimer.current);
    setToast('Demo reset.');
  };

  // ---------------- Pages ----------------
  const pendingCard = (p: Pending) => (
    <div className="card upd" key={p.id}>
      <span className={`who ${WHO[p.by].side}`}>{WHO[p.by].name}</span>
      <div>
        <h3>{p.title}</h3>
        <p>{p.detail}</p>
      </div>
      <span className="meta">{p.reason} · {p.when}</span>
      <div className="btns">
        <button className="btn primary" onClick={() => accept(p)}>Accept</button>
        <button className="btn" onClick={() => setEdit({ mode: 'pending', id: p.id, title: p.title, detail: p.detail, shared: true })}>Edit</button>
        <button className="btn quiet" onClick={() => reject(p)}>Delete</button>
      </div>
    </div>
  );

  const home = (
    <>
      <header className="nhead" style={{ backgroundImage: BAND_BG }}>
        <div className="nhead-top">
          <span className="concept-tag">Concept · fictional data</span>
          <span className="nh-right">
            <button className="nh-bell" onClick={() => go('cab')} aria-label={`Updates waiting: ${pending.length}`}>
              <span className="bell"><Bell />{pending.length > 0 && <i>{pending.length}</i>}</span>
            </button>
            <span className="avatar a-lauri" aria-hidden="true">L</span>
          </span>
        </div>
        <img className="nlogo c" src={LOGO_WHITE} alt="Nordea" />
        <p className="nwelcome">Welcome, Lauri!</p>
        <button className="ask-bar" onClick={() => openChat()}>
          <Icon name="spark" /><span>Ask Abel anything…</span><i className="live-dot" aria-hidden="true" />
        </button>
        <RoundActions actions={[
          { icon: 'mic', label: 'Tell Abel by voice', onClick: () => openChat(true) },
          { icon: 'cab', label: 'Context Cabinet', onClick: () => go('cab') },
          { icon: 'cal', label: 'My meeting', onClick: () => go('contact') },
        ]} />
      </header>
      <div className="nbody">
        <div className="ncard">
          <button className="nrow2 head" onClick={() => setPage('flow')}>
            <span className="n-l">
              <span className="n-name b">Where your information goes</span>
              <span className="n-sub">You decide what reaches Nordea</span>
            </span>
            <NChev />
          </button>
          <div style={{ padding: '4px 16px 16px' }}>
            <Trace upTo={4} note={`${entries.length} items in your cabinet · ${sharedCount} shared with Nordea`} />
          </div>
        </div>
        {pending.length > 0 && (
          <>
            <Band left="Waiting for you" right={<span className="band-note">Not added until you accept</span>} />
            {pendingCard(pending[0])}
            {pending.length > 1 && <button className="nshowall plain" onClick={() => go('cab')}>See {pending.length - 1} more</button>}
          </>
        )}
        <div className="ncard">
          <NRow name={<b style={{ fontWeight: 700, fontSize: 17 }}>Your next meeting</b>} sub={`Thu 6 Nov, 09:30 · ${ADVISER}, private banker`} onClick={() => go('contact')} />
        </div>
        <div className="ncard">
          <div className="nhead-row"><h3>Accounts and cards</h3></div>
          <NRow name="Current account" sub="FI00 1234 5600 0007 85" amount="2 487,20" />
          <NRow name="Savings account" sub="Flat savings" amount="12 400,00" />
        </div>
        <p className="foot-note">Nothing is used without your OK.</p>
      </div>
    </>
  );

  const waitingList = pending.length > 0 && (
    <>
      <Band left="Waiting for you" right={<span className="band-note">Not added until you accept</span>} />
      {pending.map(pendingCard)}
    </>
  );
  const entryRow = (e: Entry) => (
    <button className="nrow2" key={e.id} onClick={() => setPage({ item: e.id })}>
      <span className="n-l">
        <span className="n-name"><span className={`dotc ${WHO[e.addedBy].side}`} />{e.title}</span>
        <span className="n-sub">{viaText(e)}</span>
      </span>
      <SharePill e={e} />
      <NChev />
    </button>
  );
  const shared = entries.filter((e) => e.shared);
  const priv = entries.filter((e) => !e.shared);
  const cabinet = (
    <>
      <header className="nhead detail kn-head" style={{ backgroundImage: BAND_BG }}>
        <div className="dh-top">
          <span className="dh-back" />
          <b>Context Cabinet</b>
          <button className="dh-side" onClick={() => setPage('flow')}><Icon name="shield" />Who sees it</button>
        </div>
        <div className="kn-sum">
          <div><b>{entries.length}</b><span>In your cabinet</span></div>
          <div className={pending.length ? 'hl' : ''}><b>{pending.length}</b><span>Waiting for you</span></div>
          <div><b>{shared.length}</b><span>Shared</span></div>
        </div>
        <RoundActions actions={[
          { icon: 'spark', label: 'Tell Abel', onClick: () => openChat() },
          { icon: 'mic', label: 'Speak to Abel', onClick: () => openChat(true) },
          { icon: 'arrow', label: 'How it flows', onClick: () => setPage('flow') },
        ]} />
      </header>
      <div className="nbody">
        {waitingList}
        <Band left="Shared with Nordea" right={<span className="band-note">{ADVISER} and Nordea's agent can use these</span>} />
        <div className="ncard flat">{shared.length ? shared.map(entryRow) : <p className="log-empty" style={{ paddingTop: 14 }}>Nothing shared yet.</p>}</div>
        <Band left="Only you" right={<span className="band-note">Nordea can't see these</span>} />
        <div className="ncard flat">{priv.length ? priv.map(entryRow) : <p className="log-empty" style={{ paddingTop: 14 }}>Everything is shared.</p>}</div>
        <p className="foot-note">Tap an item to edit it, stop sharing it or see who used it.</p>
      </div>
    </>
  );

  const flowPage = (
    <>
      <DetailHead title="Where your information goes" sub="From you to your adviser, and back to you" onBack={() => setPage(null)} />
      <div className="nbody">
        <div className="ncard">
          <div className="flow">
            {[
              { cls: 'you', icon: 'person', t: 'You', s: 'Tell Abel by voice, chat, photos or files.', c: 'Your words, your documents',
                more: ['Speak or type in your own words', 'Show a payslip, notes or a bill', 'Nothing is kept unless you say so'] },
              { cls: '', icon: 'spark', t: 'Abel, your agent', s: 'Turns it into a short note and asks you first.', c: 'Works only for you',
                more: ['Suggests one clear note, e.g. "Flat deposit 35 000 €"', 'You can save it, edit it or say no', 'You choose: only for you, or shared with Nordea'] },
              { cls: 'gate', icon: 'cab', t: 'Your Context Cabinet', s: 'Only what you accepted. You can edit, unshare or delete any time.', c: `${entries.length} items · ${sharedCount} shared · ${entries.length - sharedCount} only you`,
                more: ['Each item shows who added it and when', 'Each read by Nordea is logged', 'Unshare an item and Nordea loses access at once'] },
              { cls: 'bank', icon: 'shield', t: "Nordea's agent", s: 'Reads shared items only, and prepares them for your adviser.', c: 'Never sees "Only you" items',
                more: ['Writes pre-meeting notes', 'Finds the facts your adviser needs', 'Can suggest updates, which come to you first'] },
              { cls: 'bank', icon: 'contact', t: `${ADVISER}, your private banker`, s: 'Uses it to prepare, advise and answer you during meetings.', c: 'Asks you before seeing anything else',
                more: ['Pre-meeting notes and research', 'Advice that fits your plans', 'During a meeting, asks to see an item you have not shared'] },
            ].map((s, i) => (
              <button key={s.t} className={`fstep ${s.cls}${openStep === i ? ' open' : ''}`} onClick={() => setOpenStep(openStep === i ? null : i)} aria-expanded={openStep === i}>
                <span className="fic"><Icon name={s.icon} /></span>
                <span>
                  <b>{s.t}</b>
                  <span className="fsub">{s.s}</span>
                  <span className="fcount">{s.c}</span>
                </span>
                {openStep === i && <ul className="fmore">{s.more.map((m) => <li key={m}>{m}</li>)}</ul>}
              </button>
            ))}
          </div>
          <div className="back-loop">
            <Icon name="cycle" size={20} />
            <span><b>Updates come back to you.</b> {ADVISER}, Nordea's agent or the meeting recorder can suggest a change. You see who suggested it, then accept, edit or delete it. Nothing is added without you.</span>
          </div>
        </div>
        <div className="ncard">
          <div className="nhead-row"><h3>What Nordea uses it for</h3></div>
          <div className="uses">
            <div className="use"><b>Before a meeting</b><span>Notes so you don't repeat yourself</span></div>
            <div className="use"><b>Research</b><span>Options that fit your goals</span></div>
            <div className="use"><b>Advice</b><span>Based on what you shared</span></div>
            <div className="use"><b>During a meeting</b><span>Quick answers to new questions</span></div>
          </div>
        </div>
      </div>
    </>
  );

  const itemPage = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return flowPage;
    return (
      <>
        <DetailHead title={e.kind} big={undefined} sub={undefined} onBack={() => setPage(null)} />
        <div className="nbody">
          <div className="ncard">
            <div className="nhead-row"><h3>{e.title}</h3></div>
            <p className="det-p">{e.detail}<br /><span className={`who ${WHO[e.addedBy].side}`} style={{ marginTop: 8 }}>{WHO[e.addedBy].name}</span></p>
            <div className="nrow2 static">
              <span className="n-l"><span className="n-name">Share with Nordea</span><span className="n-sub">{e.shared ? `${ADVISER} and Nordea's agent can use it` : 'Only you can see it'}</span></span>
              <Toggle on={e.shared} onChange={() => setShared(e.id, !e.shared)} label="Share with Nordea" />
            </div>
            <div style={{ padding: '6px 16px 14px' }}>
              <Trace upTo={e.shared ? 4 : 2} stopAfterCabinet={!e.shared} note={e.shared ? 'Travels to Nordea\'s agent and your adviser.' : 'Stays in your cabinet. Nordea can ask, and you decide.'} />
            </div>
            <div className="det-act">
              <button className="btn primary" onClick={() => setEdit({ mode: 'entry', id: e.id, title: e.title, detail: e.detail, shared: e.shared })}>Edit</button>
              <button className="btn" onClick={() => remove(e.id)}><Icon name="trash" size={16} />Delete</button>
            </div>
          </div>
          <div className="ncard">
            <div className="nhead-row"><h3>Who used it</h3></div>
            {e.reads.length ? <ul className="log">{e.reads.map((r, i) => <li key={i} className={r.side}>{r.text}<span>{r.when}</span></li>)}</ul>
              : <p className="log-empty">No one at Nordea has used it yet.</p>}
          </div>
          <div className="ncard">
            <div className="nhead-row"><h3>History</h3></div>
            <ul className="log">{e.history.map((r, i) => <li key={i} className={r.side}>{r.text}<span>{r.when}</span></li>)}</ul>
          </div>
        </div>
      </>
    );
  };

  const contact = (
    <>
      <DetailHead title="Contact" sub="How can we help you today?" />
      <div className="nbody">
        <div className="ncard">
          <div className="nhead-row"><h3>Your private banker</h3></div>
          <div className="nrow2 static">
            <span className="avatar a-lauri" style={{ background: '#2A39C4' }} aria-hidden="true">K</span>
            <span className="n-l"><span className="n-name">{ADVISER} Private Banker</span><span className="n-sub">Sees only what you share</span></span>
          </div>
        </div>
        <div className="ncard">
          <div className="nhead-row"><h3>Upcoming meeting</h3></div>
          <div className="nrow2 static">
            <span className="n-l"><span className="n-name b">Thu 6 Nov, 09:30–10:00</span><span className="n-sub">Online · Flat, wedding and honeymoon plans</span></span>
          </div>
          <NRow name="What Kalle will see" sub={`${shared.length} shared items and the notes made from them`} onClick={() => setPage('prep')} />
          <div style={{ padding: '4px 16px 16px' }}><button className="btn primary block" onClick={startMeeting}>Join meeting</button></div>
        </div>
        <div className="ncard">
          <NRow name={<><Icon name="spark" />Chat with Abel</>} sub="Replies instantly" onClick={() => openChat()} />
          <NRow name={<><Icon name="cal" />Book an online meeting</>} sub="Pick a time" onClick={() => setToast('Booking is part of the Nordea app.')} />
        </div>
      </div>
    </>
  );

  const prep = (
    <>
      <DetailHead title="What Kalle will see" sub="For your meeting on Thu 6 Nov" onBack={() => setPage(null)} />
      <div className="nbody">
        <div className="card">
          <span className="who bank">Pre-meeting notes · written by Nordea's agent</span>
          <ul className="log" style={{ padding: 0 }}>
            {shared.map((e) => <li key={e.id} className="bank">{e.title}</li>)}
          </ul>
          <p className="hint">Made only from your shared items. {ADVISER} reads these before the meeting.</p>
        </div>
        <Band left="Not shared" right={<span className="band-note">{ADVISER} can't see these</span>} />
        <div className="ncard flat">
          {priv.map((e) => (
            <div className="nrow2 static" key={e.id}>
              <span className="n-l"><span className="n-name">{e.title}</span><span className="n-sub">{e.kind}</span></span>
              <button className="btn small" onClick={() => setShared(e.id, true)}>Share</button>
            </div>
          ))}
          {!priv.length && <p className="log-empty" style={{ paddingTop: 14 }}>You share everything.</p>}
        </div>
        <p className="foot-note">During the meeting, {ADVISER} can ask to see one of these. You decide then.</p>
      </div>
    </>
  );

  const stub = (title: string) => (
    <>
      <DetailHead title={title} />
      <div className="nbody"><div className="card"><h3>Not part of this prototype</h3><p>This prototype shows how your information flows to Nordea. {title} works as in the main app.</p>
        <button className="btn primary" onClick={() => go('home')}>Back to Home</button></div></div>
    </>
  );

  let content: React.ReactNode;
  if (page === 'flow') content = flowPage;
  else if (page === 'prep') content = prep;
  else if (page && typeof page === 'object') content = itemPage(page.item);
  else content = tab === 'home' ? home : tab === 'cab' ? cabinet : tab === 'contact' ? contact : stub(tab === 'rewards' ? 'Rewards' : 'More');

  const navBtn = (k: Tab, icon: string, label: string) => (
    <button role="tab" aria-selected={tab === k} onClick={() => go(k)}>
      <span className="navi"><Icon name={icon} size={22} />{k === 'cab' && pending.length > 0 && <i className="badge-n">{pending.length}</i>}</span>
      <span>{label}</span>
    </button>
  );

  // ---------------- Overlays ----------------
  const chat = chatOpen && (
    <div className="chat opening" role="dialog" aria-label="Chat with Abel">
      <div className="chat-h">
        <span className="bot-av lg"><Icon name="spark" /></span>
        <span className="chat-t"><b>Abel</b><span><i className="live-dot inline" />Your agent · works only for you</span></span>
        <button className="chat-ic" onClick={() => { stopVoice(false); setChatOpen(false); }} aria-label="Close chat"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </div>
      <div className="chat-body" ref={chatRef}>
        <div className="chat-date">Today</div>
        {msgs.map((m, i) => {
          const start = i === 0 || msgs[i - 1].from !== m.from;
          if (m.from === 'me') return (
            <div key={m.id} className={`mrow me pop${start ? ' gstart' : ''}`}>
              <div className="mcol me"><div className="bub">{m.voice && <Icon name="mic" size={14} />} {m.text}</div>{m.voice && <span className="mmeta">Spoken · turned into text</span>}</div>
            </div>
          );
          return (
            <div key={m.id} className={`mrow bot pop${start ? ' gstart' : ''}${m.prop ? ' wide' : ''}`}>
              {start ? <BotAvatar /> : <span className="av-sp" />}
              <div className="mcol">
                {m.text && <div className="bub">{m.text}</div>}
                {m.prop && (!m.decided ? (
                  <div className="prop">
                    <h4>Save to your Context Cabinet?</h4>
                    <div className="p-entry">
                      <span className="kicker" style={{ fontSize: 12.5 }}>{m.prop.kind}{m.prop.targetId ? ' · update' : ' · new'}</span>
                      {m.prop.oldText && <span><s>{m.prop.oldText}</s></span>}
                      <b>{m.prop.title}</b>
                      <span>{m.prop.detail}</span>
                    </div>
                    <div className="btns stack">
                      <button className="btn primary" onClick={() => decide(m, 'shared')}>Save and share with Nordea</button>
                      <button className="btn" onClick={() => decide(m, 'private')}>Save, only for me</button>
                    </div>
                    <div className="btns">
                      <button className="btn link" onClick={() => setEdit({ mode: 'prop', id: m.id, title: m.prop!.title, detail: m.prop!.detail, shared: true })}>Edit first</button>
                      <button className="btn link" style={{ color: 'var(--muted)' }} onClick={() => decide(m, 'no')}>Don't save</button>
                    </div>
                  </div>
                ) : (
                  <div className="prop done">
                    <b style={{ fontSize: 14.5 }}>{m.decided === 'no' ? 'Not saved' : m.decided === 'shared' ? 'Saved and shared with Nordea' : 'Saved, only for you'}</b>
                    {m.decided !== 'no' && <Trace upTo={m.decided === 'shared' ? 4 : 2} stopAfterCabinet={m.decided === 'private'}
                      note={m.decided === 'shared' ? `${ADVISER} will see it in your pre-meeting notes.` : 'Nordea will not see it. You can share it later.'} />}
                    {m.decided !== 'no' && <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setChatOpen(false); go('cab'); }}>Open your cabinet</button>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {typing && <div className="mrow bot gstart"><BotAvatar /><div className="mcol"><div className="bub typing"><i /><i /><i /></div></div></div>}
        {!msgs.some((m) => m.from === 'me') && !rec && (
          <div className="qr">
            <button className="qr-b" onClick={() => startVoice()}>Say it by voice</button>
            <button className="qr-b" onClick={() => send("Mia's new job starts in January 2027.")}>Mia has a new job</button>
            <button className="qr-b" onClick={() => send('My car loan ends in March 2027.')}>My car loan ends</button>
          </div>
        )}
      </div>
      {rec && <div className="voice-hint"><i />Listening… tap the mic to stop</div>}
      <form className="chat-in" onSubmit={(ev) => { ev.preventDefault(); send(draft); }}>
        <label className="sr" htmlFor="pf-msg">Message Abel</label>
        <textarea id="pf-msg" rows={1} value={draft} placeholder="Message…" onChange={(ev) => setDraft(ev.target.value)} readOnly={rec}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(draft); } }} />
        <button type="button" className={`chat-mic${rec ? ' rec' : ''}`} onClick={() => (rec ? stopVoice(true) : startVoice())} aria-label={rec ? 'Stop and send' : 'Talk instead of typing'}><Icon name="mic" /></button>
        <button type="submit" className="chat-send" disabled={!draft.trim() || rec} aria-label="Send"><Icon name="send" /></button>
      </form>
      <p className="chat-foot">Prototype · scripted replies · nothing saved without your OK</p>
    </div>
  );

  const japan = entries.find((e) => e.id === 'japan');
  const meet = meeting && (
    <div className="meet" role="dialog" aria-label={`Meeting with ${ADVISER}`}>
      <div className="meet-v">
        <div className="meet-top"><span className="meet-rec"><i />Recording for notes · you agreed</span><span>09:34</span></div>
        <div className="meet-av" style={{ background: '#2A39C4' }}>K</div>
        <span className="meet-name">{ADVISER}, private banker</span>
        <span className="meet-me">L</span>
      </div>
      <div className="meet-body">
        <p className="cap"><b>You:</b> Can Mia and I afford the honeymoon and the flat at the same time?</p>
        {meeting.stage === 0 && <p className="cap"><b>{ADVISER}:</b> Good question. Let me check what you've shared…</p>}
        {meeting.stage >= 1 && (
          <>
            <p className="cap"><b>{ADVISER}:</b> I can see the flat goal, but I need the honeymoon budget to answer.</p>
            {meeting.stage === 1 && japan && (
              <div className="card req">
                <span className="who bank">{ADVISER} asks to see 1 item</span>
                <div><h3>{japan.title}</h3><p>Not shared now. {ADVISER} needs it to answer your question.</p></div>
                <div className="btns stack">
                  <button className="btn primary" onClick={() => meetingAnswer('once')}>Show for this meeting only</button>
                  <button className="btn" onClick={() => meetingAnswer('always')}>Share from now on</button>
                  <button className="btn quiet" onClick={() => meetingAnswer('no')}>Not now</button>
                </div>
              </div>
            )}
            {meeting.stage === 1 && !japan && <p className="cap">The honeymoon item was deleted, so {ADVISER} answers without it.</p>}
          </>
        )}
        {meeting.stage === 2 && (
          <>
            <div className="card"><span className="who you">You allowed it</span><Trace upTo={4} note="Logged in your cabinet under “Who used it”." /></div>
            <p className="cap"><b>{ADVISER}:</b> Yes. With the honeymoon in August 2027 you still reach 35 000 € by April 2028 if you save 550 € a month from January, when your raise starts.</p>
          </>
        )}
        {meeting.stage === 3 && <p className="cap"><b>{ADVISER}:</b> No problem. Roughly: keep the trip under 4 000 € and save about 550 € a month from January. We can look closer next time.</p>}
        {meeting.stage >= 2 && <p className="hint">The AI recorder drafts notes. {ADVISER} checks them, then they come to you to accept.</p>}
      </div>
      <div className="meet-bar">
        <button className="meet-btn" aria-label="Microphone"><Icon name="mic" /></button>
        <button className="meet-btn" aria-label="Camera"><Icon name="camera" /></button>
        <button className="meet-btn end" onClick={endMeeting}>End meeting</button>
      </div>
    </div>
  );

  const sheet = edit && (
    <div className="cf-bg" onClick={(ev) => { if (ev.target === ev.currentTarget) setEdit(null); }}>
      <form className="cf-sheet" onSubmit={(ev) => { ev.preventDefault(); saveEdit(); }}>
        <h3>{edit.mode === 'pending' ? 'Edit, then accept' : edit.mode === 'prop' ? 'Edit before saving' : 'Edit item'}</h3>
        <label className="pf-l" htmlFor="pf-title">Title</label>
        <input id="pf-title" className="pf-in" value={edit.title} onChange={(ev) => setEdit({ ...edit, title: ev.target.value })} />
        <label className="pf-l" htmlFor="pf-detail">Details</label>
        <textarea id="pf-detail" className="pf-in" value={edit.detail} onChange={(ev) => setEdit({ ...edit, detail: ev.target.value })} />
        {edit.mode !== 'pending' && (
          <div className="share-row">
            <span className="t"><b>Share with Nordea</b><span>{edit.shared ? `${ADVISER} and Nordea's agent can use it` : 'Only you can see it'}</span></span>
            <Toggle on={edit.shared} onChange={() => setEdit({ ...edit, shared: !edit.shared })} label="Share with Nordea" />
          </div>
        )}
        <div className="btns">
          <button type="submit" className="btn primary" disabled={!edit.title.trim()}>{edit.mode === 'pending' ? 'Accept' : 'Save'}</button>
          <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
        </div>
      </form>
    </div>
  );

  // ---------------- Demo steps (beside the phone) ----------------
  const steps: { k: string; t: string; s: string; run: () => void }[] = [
    { k: 'voice', t: 'Tell Abel by voice', s: 'Lauri says the flat deposit goes up to 35 000 €. Abel asks before saving.', run: () => { setMeeting(null); openChat(true); } },
    { k: 'cab', t: 'Look in the Context Cabinet', s: 'Shared vs only you. Tap an item to see its path and log.', run: () => { setChatOpen(false); setMeeting(null); go('cab'); mark('cab'); } },
    { k: 'prep', t: `${ADVISER} prepares the meeting`, s: "Nordea's agent writes notes from shared items. Each read is logged.", run: prepMeeting },
    { k: 'meet', t: 'Meeting: a sudden question', s: `${ADVISER} asks to see a private item. Lauri decides.`, run: startMeeting },
    { k: 'notes', t: 'After the meeting', s: `Recorder notes, checked by ${ADVISER}, arrive for Accept / Edit / Delete.`, run: () => { setMeeting(null); notesArrive(); setChatOpen(false); go('cab'); } },
    { k: 'agent', t: "Nordea's agent suggests an update", s: 'A raise seen in bank data. Waits for Lauri.', run: () => { agentSuggests(); setChatOpen(false); setMeeting(null); go('home'); } },
  ];

  return (
    <div>
      <div className="stage-top">
        <span className="stage-t"><b>Abel</b> · Information flow prototype</span>
        <button className="theme-chip" onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
          <Icon name={dark ? 'sun' : 'moon'} size={16} />{dark ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="stagewrap">
        <PhoneFrame
          screenRef={screenRef}
          statusBarTheme={chatOpen ? 'light' : 'brand'}
          bottom={
            <nav className="nav nav5" role="tablist">
              {navBtn('home', 'home', 'Home')}
              {navBtn('cab', 'cab', 'Cabinet')}
              {navBtn('rewards', 'star', 'Rewards')}
              {navBtn('contact', 'contact', 'Contact')}
              {navBtn('more', 'more', 'More')}
            </nav>
          }
          overlay={<>{chat}{meet}{sheet}{toast && <div className="toast" role="status">{toast}</div>}</>}
        >
          {content}
        </PhoneFrame>
        <aside className="nordea" aria-label="Demo steps">
          <span className="n-tag">Demo steps</span>
          <h2>How Lauri's information travels</h2>
          <p>Click a step, or use the app freely. Scripted data, no AI.</p>
          <div className="legend-flow">
            <span className="who you">Green: from Lauri</span>
            <span className="who bank">Orange: from Nordea (agent, adviser, recorder)</span>
          </div>
          <div className="steps">
            {steps.map((s, i) => (
              <button key={s.k} className={`step${done[s.k] ? ' done' : ''}`} onClick={s.run}>
                <span className="n">{done[s.k] ? '✓' : i + 1}</span>
                <span className="t"><b>{s.t}</b><span>{s.s}</span></span>
              </button>
            ))}
          </div>
          <button className="btn small pane-reset" onClick={reset}>Reset demo</button>
        </aside>
      </div>
      <p className="foot">Student concept · fictional data · prototype of the information flow</p>
    </div>
  );
}
