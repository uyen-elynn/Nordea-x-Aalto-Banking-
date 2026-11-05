// Customer side of the information flow:
//   You → Abel → Context Cabinet → Nordea's agent → your adviser
// plus updates from the Nordea side that wait for the customer (Accept / Edit / Delete).
import React, { useEffect, useState } from 'react';
import type { AppState } from '../services/api.js';
import type { FlowState, Suggestion } from '../services/flowApi.js';
import type { CabinetEntry } from '../types.js';
import { Icon } from '../ui/icons.js';
import { ago } from '../ui/format.js';
import { Band, DetailHead, NRow, Toggle } from './Nordea.js';

/** Shared with Nordea: Nordea's agent and the adviser may use it. */
export const isSharedEntry = (e: CabinetEntry) => !e.private && e.readableBy?.adviser !== false;
const usable = (e: CabinetEntry) => e.status !== 'archived' && e.status !== 'disputed' && !(e.source === 'nordea' && !e.reviewed);

// ---------------- The path, as five stops ----------------
const STOPS = [
  { label: 'You', icon: 'person', side: 'you' },
  { label: 'Abel', icon: 'spark', side: '' },
  { label: 'Cabinet', icon: 'cab', side: '' },
  { label: "Nordea's agent", icon: 'shield', side: 'bank' },
  { label: 'Adviser', icon: 'contact', side: 'bank' },
];
export const FlowTrace: React.FC<{ shared: boolean; adviser?: string; note?: string }> = ({ shared, adviser = 'Adviser', note }) => {
  const upTo = shared ? 4 : 2;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t: number[] = [];
    for (let i = 0; i <= upTo; i++) t.push(window.setTimeout(() => setShown(i), 200 * i));
    return () => t.forEach(clearTimeout);
  }, [upTo]);
  const stops = STOPS.map((s, i) => (i === 4 ? { ...s, label: adviser } : s));
  return (
    <div>
      <div className="trace" role="img" aria-label={shared ? `Travels from you to Abel, your cabinet, Nordea's agent and ${adviser}` : 'Stays in your cabinet. Nordea cannot see it.'}>
        {stops.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <span className={`tline${i <= shown ? ' on' : ''}`} />}
            <span className={`tnode ${s.side}${i <= shown ? ' on' : ''}${!shared && i > 2 ? ' stop' : ''}`}>
              <span className="tdot"><Icon name={!shared && i > 2 ? 'shield' : s.icon} /></span>
              <span className="tlab">{s.label}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
      {note && <p className="trace-note">{note}</p>}
    </div>
  );
};

export const SharePill: React.FC<{ shared: boolean }> = ({ shared }) =>
  shared ? <span className="spill shared">Shared with Nordea</span> : <span className="spill private">Only you</span>;

/** In an item's options: share with Nordea or not, its path, and who on the Nordea side used it. */
export const ShareBlock: React.FC<{ e: CabinetEntry; flow: FlowState | null; onShare: (e: CabinetEntry, shared: boolean) => void }> = ({ e, flow, onShare }) => {
  const shared = isSharedEntry(e);
  const adviser = flow?.adviser.name || 'your adviser';
  const reads = flow?.reads[e.id] || [];
  const [all, setAll] = useState(false);
  return (
    <div className="share-block">
      <div className="share-row">
        <span className="t"><b>Share with Nordea</b><span>{shared ? `Nordea's agent and ${adviser} can use it` : 'Only you and Abel can see it'}</span></span>
        <Toggle on={shared} onChange={() => onShare(e, !shared)} label={`Share “${e.title}” with Nordea`} />
      </div>
      <FlowTrace shared={shared} adviser={flow?.adviser.name} />
      <div className="used-by">
        <b>Who used it</b>
        {reads.length ? (
          <ul className="log">
            {(all ? reads : reads.slice(0, 3)).map((r, i) => <li key={i} className="bank">{r.purpose}<span>{ago(r.at)}</span></li>)}
          </ul>
        ) : <span className="hint">No one at Nordea has used it yet.</span>}
        {reads.length > 3 && <button className="btn link small" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${reads.length}`}</button>}
      </div>
    </div>
  );
};

// ---------------- Updates from the Nordea side ----------------
const sideOf = (_s: Suggestion) => 'bank';
export const SuggestionCard: React.FC<{ s: Suggestion; onAccept: () => void; onEdit: () => void; onDelete: () => void }> = ({ s, onAccept, onEdit, onDelete }) => (
  <div className="card upd">
    <span className={`who ${sideOf(s)}`}>{s.byLabel}</span>
    <div>
      <h3>{s.title}</h3>
      {s.detail && <p>{s.detail}</p>}
    </div>
    {s.replacesTitle && <span className="chg"><span>Changes your item</span><s>{s.replacesTitle}</s></span>}
    <span className="meta">{s.reason} · {ago(s.createdAt)}</span>
    <div className="btns">
      <button className="btn primary" onClick={onAccept}>Accept</button>
      <button className="btn" onClick={onEdit}>Edit</button>
      <button className="btn quiet" onClick={onDelete}>Delete</button>
    </div>
  </div>
);

export const FlowSuggestions: React.FC<{ flow: FlowState | null; onDecide: (s: Suggestion, d: 'accept' | 'delete') => void; onEdit: (s: Suggestion) => void; limit?: number; onMore?: () => void }> = ({ flow, onDecide, onEdit, limit, onMore }) => {
  const waiting = (flow?.suggestions || []).filter((s) => s.status === 'waiting');
  if (!waiting.length) return null;
  const shown = limit ? waiting.slice(0, limit) : waiting;
  return (
    <>
      <Band left={`From ${flow!.adviser.name} and Nordea`} right={<span className="band-note">Not added until you accept</span>} />
      {shown.map((s) => <SuggestionCard key={s.id} s={s} onAccept={() => onDecide(s, 'accept')} onEdit={() => onEdit(s)} onDelete={() => onDecide(s, 'delete')} />)}
      {limit && waiting.length > limit && onMore && <button className="nshowall plain" onClick={onMore}>See {waiting.length - limit} more</button>}
    </>
  );
};

export const EditSuggestionSheet: React.FC<{ s: Suggestion; onSave: (t: string, d: string) => void; onCancel: () => void }> = ({ s, onSave, onCancel }) => {
  const [t, setT] = useState(s.title);
  const [d, setD] = useState(s.detail);
  return (
    <div className="cf-bg" onClick={(ev) => { if (ev.target === ev.currentTarget) onCancel(); }}>
      <form className="cf-sheet" onSubmit={(ev) => { ev.preventDefault(); onSave(t.trim(), d); }}>
        <span className="who bank">{s.byLabel}</span>
        <h3>Edit, then accept</h3>
        <label className="pf-l" htmlFor="sug-title">Title</label>
        <input id="sug-title" className="pf-in" value={t} onChange={(ev) => setT(ev.target.value)} />
        <label className="pf-l" htmlFor="sug-detail">Details</label>
        <textarea id="sug-detail" className="pf-in" value={d} onChange={(ev) => setD(ev.target.value)} />
        <p className="hint">{s.by === 'nordea_agent' ? 'Nordea sees' : 'Your adviser sees'} that you edited it.</p>
        <div className="btns">
          <button type="submit" className="btn primary" disabled={!t.trim()}>Accept</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
};

// ---------------- Home ----------------
export const FlowHomeCard: React.FC<{ state: AppState; flow: FlowState | null; onOpenFlow: () => void; onOpenMeeting: () => void }> = ({ state, flow, onOpenFlow, onOpenMeeting }) => {
  const items = state.entries.filter(usable);
  const shared = items.filter(isSharedEntry).length;
  return (
    <>
      <div className="ncard">
        <button className="nrow2 head" onClick={onOpenFlow}>
          <span className="n-l">
            <span className="n-name b">Where your information goes</span>
            <span className="n-sub">You decide what reaches Nordea</span>
          </span>
          <span className="nchev" aria-hidden="true"><Icon name="chev" /></span>
        </button>
        <div style={{ padding: '4px 16px 16px' }}>
          <FlowTrace shared adviser={flow?.adviser.name} note={`${items.length} items in your cabinet · ${shared} shared with Nordea`} />
        </div>
      </div>
      {flow && (
        <div className="ncard">
          <NRow name={<b style={{ fontWeight: 700, fontSize: 17 }}>{flow.meeting.status === 'live' ? 'Your meeting is on now' : 'Your next meeting'}</b>}
            sub={`${flow.meeting.when} · ${flow.adviser.name}, ${flow.adviser.role.toLowerCase()}`} onClick={onOpenMeeting} />
        </div>
      )}
    </>
  );
};

// ---------------- Where your information goes ----------------
export const FlowPage: React.FC<{ state: AppState; flow: FlowState | null; onBack: () => void }> = ({ state, flow, onBack }) => {
  const [open, setOpen] = useState<number | null>(2);
  const items = state.entries.filter(usable);
  const shared = items.filter(isSharedEntry).length;
  const adviser = flow?.adviser.name || 'Your adviser';
  const steps = [
    { cls: 'you', icon: 'person', t: 'You', s: 'Tell Abel by voice, chat, photos or files.', c: 'Your words, your documents',
      more: ['Speak or type in your own words', 'Show a payslip, notes or a bill', 'Nothing is kept unless you say so'] },
    { cls: '', icon: 'spark', t: 'Abel, your agent', s: 'Turns it into a short note and asks you first.', c: 'Works only for you',
      more: ['Suggests one clear note, e.g. “Flat deposit 35 000 €”', 'You can save it, change it or say no', 'You choose: only for you, or shared with Nordea'] },
    { cls: 'gate', icon: 'cab', t: 'Your Context Cabinet', s: 'Only what you accepted. Edit, unshare or delete any time.', c: `${items.length} items · ${shared} shared · ${items.length - shared} only you`,
      more: ['Each item shows who added it and when', 'Each read by Nordea is logged under “Who used it”', 'Unshare an item and Nordea loses access at once'] },
    { cls: 'bank', icon: 'shield', t: "Nordea's agent", s: 'Reads shared items only, and prepares them for your adviser.', c: 'Never sees “Only you” items',
      more: ['Writes pre-meeting notes', 'Finds the facts your adviser needs', 'Can suggest updates, which come to you first'] },
    { cls: 'bank', icon: 'contact', t: `${adviser}, your ${flow?.adviser.role.toLowerCase() || 'adviser'}`, s: 'Uses it to prepare, advise and answer you during meetings.', c: 'Asks you before seeing anything else',
      more: ['Pre-meeting notes and research', 'Advice that fits your plans', 'During a meeting, asks to see an item you have not shared'] },
  ];
  return (
    <>
      <DetailHead title="Where your information goes" sub="From you to your adviser, and back to you" onBack={onBack} />
      <div className="nbody">
        <div className="ncard">
          <div className="flow">
            {steps.map((s, i) => (
              <button key={s.t} className={`fstep ${s.cls}${open === i ? ' open' : ''}`} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span className="fic"><Icon name={s.icon} /></span>
                <span>
                  <b>{s.t}</b>
                  <span className="fsub">{s.s}</span>
                  <span className="fcount">{s.c}</span>
                </span>
                {open === i && <ul className="fmore">{s.more.map((m) => <li key={m}>{m}</li>)}</ul>}
              </button>
            ))}
          </div>
          <div className="back-loop">
            <Icon name="cycle" size={20} />
            <span><b>Updates come back to you.</b> {adviser}, Nordea's agent or the meeting recorder can suggest a change. You see who suggested it, then accept, edit or delete it. Nothing is added without you.</span>
          </div>
        </div>
        <div className="ncard">
          <div className="nhead-row"><h3>What Nordea uses it for</h3></div>
          <div className="uses">
            <div className="use"><b>Before a meeting</b><span>Notes, so you don't repeat yourself</span></div>
            <div className="use"><b>Research</b><span>Options that fit your goals</span></div>
            <div className="use"><b>Advice</b><span>Based on what you shared</span></div>
            <div className="use"><b>During a meeting</b><span>Quick answers to new questions</span></div>
          </div>
        </div>
      </div>
    </>
  );
};

// ---------------- Contact: your banker and meeting ----------------
export const MeetingCard: React.FC<{ flow: FlowState | null; onPrep: () => void; onJoin: () => void }> = ({ flow, onPrep, onJoin }) => {
  if (!flow) return null;
  const m = flow.meeting;
  return (
    <div className="ncard">
      <div className="nhead-row"><h3>Your {flow.adviser.role.toLowerCase()}</h3></div>
      <div className="nrow2 static">
        <span className="avatar" style={{ background: '#2A39C4' }} aria-hidden="true">{flow.adviser.name[0]}</span>
        <span className="n-l"><span className="n-name">{flow.adviser.name}, {flow.adviser.role.toLowerCase()}</span><span className="n-sub">Sees only what you share</span></span>
      </div>
      <div className="nrow2 static">
        <span className="n-l">
          <span className="n-name b">{m.when}</span>
          <span className="n-sub">Online · {m.topic}{m.status === 'live' ? ' · on now' : m.status === 'ended' ? ' · ended' : ''}</span>
        </span>
      </div>
      <NRow name={`What ${flow.adviser.name} will see`} sub={`${flow.sharedIds.length} shared items, and the notes made from them`} onClick={onPrep} />
      {m.status !== 'ended' && (
        <div style={{ padding: '4px 16px 16px' }}>
          <button className="btn primary block" onClick={onJoin}>{m.status === 'live' ? 'Go to the meeting' : 'Join meeting'}</button>
        </div>
      )}
    </div>
  );
};

export const MeetingPrepPage: React.FC<{ state: AppState; flow: FlowState | null; onBack: () => void; onShare: (e: CabinetEntry, shared: boolean) => void }> = ({ state, flow, onBack, onShare }) => {
  const adviser = flow?.adviser.name || 'Your adviser';
  const items = state.entries.filter(usable);
  const shared = items.filter(isSharedEntry);
  const hidden = items.filter((e) => !isSharedEntry(e));
  return (
    <>
      <DetailHead title={`What ${adviser} will see`} sub={flow ? `For your meeting on ${flow.meeting.when.split(',')[0]}` : undefined} onBack={onBack} />
      <div className="nbody">
        <div className="card">
          <span className="who bank">Pre-meeting notes · written by Nordea's agent</span>
          {shared.length ? <ul className="log" style={{ padding: 0 }}>{shared.map((e) => <li key={e.id} className="bank">{e.title}</li>)}</ul> : <p>You haven't shared anything yet.</p>}
          <p className="hint">Made only from your shared items. {adviser} reads them before the meeting{flow?.shareActive ? '' : ', once the meeting sharing starts'}.</p>
        </div>
        <Band left="Not shared" right={<span className="band-note">{adviser} can't see these</span>} />
        <div className="ncard flat">
          {hidden.map((e) => (
            <div className="nrow2 static" key={e.id}>
              <span className="n-l"><span className="n-name">{e.title}</span><span className="n-sub">{e.detail}</span></span>
              <button className="btn small" onClick={() => onShare(e, true)}>Share</button>
            </div>
          ))}
          {!hidden.length && <p className="log-empty" style={{ paddingTop: 14 }}>You share everything.</p>}
        </div>
        <p className="foot-note">During the meeting, {adviser} can ask to see one of these. You decide then.</p>
      </div>
    </>
  );
};

// ---------------- The meeting, on the customer's phone ----------------
export const MeetingOverlay: React.FC<{ state: AppState; flow: FlowState; onAnswer: (a: 'once' | 'always' | 'no', entryId?: string) => void; onClose: () => void }> = ({ state, flow, onAnswer, onClose }) => {
  const r = flow.meeting.request;
  const adviser = flow.adviser.name;
  const asked = r?.entryId ? state.entries.find((e) => e.id === r.entryId) : undefined;
  const hidden = state.entries.filter((e) => usable(e) && !isSharedEntry(e));
  return (
    <div className="meet" role="dialog" aria-label={`Meeting with ${adviser}`}>
      <div className="meet-v">
        <div className="meet-top"><span className="meet-rec"><i />Recording for notes · you agreed</span><button className="meet-min" onClick={onClose}>Minimise</button></div>
        <div className="meet-av">{adviser[0]}</div>
        <span className="meet-name">{adviser}, {flow.adviser.role.toLowerCase()}</span>
        <span className="meet-me">{state.user.name[0]}</span>
      </div>
      <div className="meet-body">
        {!r && <p className="cap">You're in the meeting. {adviser} sees your shared items and the notes made from them.</p>}
        {r && <p className="cap"><b>You:</b> {r.question || 'A new question'}</p>}
        {r?.status === 'asked' && (
          <div className="card req">
            <span className="who bank">{adviser} asks to see 1 item</span>
            {asked ? (
              <>
                <div><h3>{asked.title}</h3><p>Not shared now. {adviser} needs it to answer you{r.need ? ` (${r.need.toLowerCase()})` : ''}.</p></div>
                <div className="btns stack">
                  <button className="btn primary" onClick={() => onAnswer('once', asked.id)}>Show for this meeting only</button>
                  <button className="btn" onClick={() => onAnswer('always', asked.id)}>Share from now on</button>
                  <button className="btn quiet" onClick={() => onAnswer('no')}>Not now</button>
                </div>
              </>
            ) : (
              <>
                <div><h3>{r.need || 'Something you keep to yourself'}</h3><p>{adviser} can't see your private items. Pick one to show for this meeting, or say no.</p></div>
                <div className="btns stack">
                  {hidden.slice(0, 4).map((e) => <button key={e.id} className="btn" onClick={() => onAnswer('once', e.id)}>Show “{e.title}”</button>)}
                  <button className="btn quiet" onClick={() => onAnswer('no')}>Not now</button>
                </div>
              </>
            )}
          </div>
        )}
        {(r?.status === 'once' || r?.status === 'always') && (
          <div className="card">
            <span className="who you">{r.status === 'once' ? 'You showed it for this meeting only' : 'You shared it from now on'}</span>
            <FlowTrace shared adviser={adviser} note={`${r.status === 'once' ? 'Hidden again when the meeting ends. ' : ''}Logged under “Who used it”.`} />
          </div>
        )}
        {r?.status === 'declined' && <p className="cap">You said not now. {adviser} answers with what you shared.</p>}
        <p className="hint">The AI recorder drafts notes. {adviser} checks them, then they come to you to accept.</p>
      </div>
      <div className="meet-bar">
        <span className="meet-btn" aria-hidden="true"><Icon name="mic" /></span>
        <span className="meet-btn" aria-hidden="true"><Icon name="camera" /></span>
        <button className="meet-btn end" onClick={onClose}>Back to the app</button>
      </div>
    </div>
  );
};
