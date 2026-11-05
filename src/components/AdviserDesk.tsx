// The adviser's side (Kalle, private banker), shown beside the customer's phone.
// Kalle sees only what the customer shared, asks before seeing anything else, and every update he
// (or Nordea's agent, or the AI meeting recorder) makes waits for the customer to accept.
import React, { useEffect, useState } from 'react';
import { AdviserView, DraftNote, agentCheck, askInMeeting, demoSetup, fetchAdviserView, meetingAction, prepMeeting, resetFlow, sendDraft, suggest } from '../services/flowApi.js';
import { Icon } from '../ui/icons.js';
import { ago } from '../ui/format.js';

const TYPE: Record<string, string> = { goal: 'Goal', life_event: 'Life event', preference: 'Preference', fact: 'Fact', observation: 'Noticed', blind_spot: 'Note' };
const STATUS: Record<string, { t: string; c: string }> = {
  waiting: { t: 'Waiting for the customer', c: 'wait' }, accepted: { t: 'Accepted', c: 'ok' }, edited: { t: 'Edited, then accepted', c: 'ok' }, deleted: { t: 'Deleted by the customer', c: 'no' },
};

export const AdviserDesk: React.FC<{ userId: string; tick: number; onChanged: () => void }> = ({ userId, tick, onChanged }) => {
  const [v, setV] = useState<AdviserView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('Can we afford the honeymoon and the flat at the same time?');
  const [need, setNeed] = useState('Travel or honeymoon budget');
  const [note, setNote] = useState<{ title: string; detail: string; replacesId?: string; replacesTitle?: string } | null>(null);
  const [draft, setDraft] = useState<DraftNote[]>([]);

  const load = () => fetchAdviserView(userId).then((d) => { setV(d); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [userId, tick]);
  useEffect(() => { if (v?.meeting.draft.length && !draft.length && !v.meeting.draftSent) setDraft(v.meeting.draft); }, [v?.meeting.draft]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); await load(); onChanged(); } catch (e: any) { setErr(e?.message || 'That didn’t work'); } finally { setBusy(false); }
  };
  if (!v) return <aside className="desk" aria-label="Adviser workspace"><p className="desk-p">{err || 'Loading the adviser view…'}</p></aside>;

  const m = v.meeting;
  const name = v.customer.name;
  const sent = v.suggestions;

  return (
    <aside className="desk" aria-label="Adviser workspace">
      <header className="desk-h">
        <span className="desk-brand">Adviser workspace</span>
        <span className="desk-me"><span className="avatar" style={{ background: '#2A39C4', width: 28, height: 28, fontSize: 13 }}>{v.adviser.name[0]}</span>{v.adviser.name} · {v.adviser.role}</span>
      </header>
      <div className="desk-body">
        <section className="desk-sec">
          <div className="desk-row">
            <div>
              <h2>{name}</h2>
              <p className="desk-p">Meeting {m.when} · {m.topic}</p>
            </div>
            <span className={`desk-chip ${m.status}`}>{m.status === 'live' ? 'Live' : m.status === 'ended' ? 'Ended' : 'Booked'}</span>
          </div>
        </section>

        <section className="desk-sec">
          <div className="desk-row"><h3>1 · Before the meeting</h3>
            <button className="btn small primary" disabled={busy} onClick={() => run(() => prepMeeting(userId))}>Prepare with Nordea's agent</button>
          </div>
          {!v.shareActive ? (
            <p className="desk-p">Nothing to read yet. Preparing opens the sharing {name} agreed to when booking, and reads only shared items.</p>
          ) : (
            <>
              <p className="desk-p"><b>Pre-meeting notes</b> from {v.notes.length} items {name} shared. {v.hiddenCount > 0 && <>{v.hiddenCount} more {v.hiddenCount === 1 ? 'item is' : 'items are'} private: you can't see {v.hiddenCount === 1 ? 'it' : 'them'}, not even the title.</>}</p>
              <ul className="desk-notes">
                {v.notes.map((n) => (
                  <li key={n.id}>
                    <span className="desk-type">{TYPE[n.type] || n.type}</span>
                    <span className="desk-nt"><b>{n.title}</b>{n.detail && <span>{n.detail}</span>}</span>
                    <button className="btn link small" onClick={() => setNote({ title: n.title, detail: n.detail, replacesId: n.id, replacesTitle: n.title })}>Suggest a change</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="desk-sec">
          <div className="desk-row"><h3>2 · During the meeting</h3>
            {m.status === 'live'
              ? <button className="btn small" disabled={busy} onClick={() => run(() => meetingAction(userId, 'end'))}>End meeting</button>
              : <button className="btn small primary" disabled={busy || m.status === 'ended'} onClick={() => run(() => meetingAction(userId, 'start'))}>Start meeting</button>}
          </div>
          {m.status === 'live' ? (
            <>
              <p className="desk-p">{name} asks something new? Ask to see an item they keep private. They decide on their phone.</p>
              <label className="pf-l" htmlFor="desk-q">Their question</label>
              <input id="desk-q" className="pf-in" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="pf-l" htmlFor="desk-need">What you need to see</label>
              <input id="desk-need" className="pf-in" value={need} onChange={(e) => setNeed(e.target.value)} />
              <button className="btn small primary" style={{ marginTop: 8 }} disabled={busy || !need.trim() || m.request?.status === 'asked'} onClick={() => run(() => askInMeeting(userId, q, need))}>Ask {name}</button>
              {m.request && (
                <div className={`desk-req ${m.request.status}`}>
                  {m.request.status === 'asked' && <>Waiting for {name} to decide…</>}
                  {m.request.status === 'declined' && <>{name} said not now. Answer with what is shared.</>}
                  {(m.request.status === 'once' || m.request.status === 'always') && v.shownItem && (
                    <><b>{name} showed it {m.request.status === 'once' ? 'for this meeting only' : 'from now on'}:</b> {v.shownItem.title}{v.shownItem.detail ? ` · ${v.shownItem.detail}` : ''}</>
                  )}
                </div>
              )}
            </>
          ) : <p className="desk-p">{m.status === 'ended' ? 'The meeting has ended. Items shown for that meeting only are hidden again.' : `Start the meeting when ${name} joins. The AI recorder drafts notes for you to check.`}</p>}
        </section>

        <section className="desk-sec">
          <h3>3 · After the meeting: check the recorder's notes</h3>
          {draft.length && !m.draftSent ? (
            <>
              <p className="desk-p">Drafted by the AI meeting recorder. Correct them, tick the ones that are right, then send. {name} accepts, edits or deletes each one.</p>
              {draft.map((d, i) => (
                <div className="desk-draft" key={i}>
                  <label className="desk-check"><input type="checkbox" checked={d.checked} onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, checked: e.target.checked } : x)))} /> Checked</label>
                  <input className="pf-in" aria-label={`Note ${i + 1} title`} value={d.title} onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                  <textarea className="pf-in" aria-label={`Note ${i + 1} details`} value={d.detail} onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, detail: e.target.value } : x)))} />
                </div>
              ))}
              <button className="btn small primary" disabled={busy || !draft.some((d) => d.checked)} onClick={() => run(async () => { await sendDraft(userId, draft); setDraft([]); })}>Send checked notes to {name}</button>
            </>
          ) : <p className="desk-p">{m.draftSent ? `Sent. ${name} decides on each note below.` : 'Notes appear here when the meeting ends.'}</p>}
        </section>

        <section className="desk-sec">
          <div className="desk-row"><h3>Add a note for {name}</h3>
            {!note && <button className="btn small" onClick={() => setNote({ title: '', detail: '' })}>New note</button>}
          </div>
          {note && (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => { await suggest(userId, { by: 'adviser', title: note.title, detail: note.detail, replacesId: note.replacesId }); setNote(null); }); }}>
              {note.replacesTitle && <p className="desk-p">Suggests a change to “{note.replacesTitle}”.</p>}
              <label className="pf-l" htmlFor="desk-nt">Title</label>
              <input id="desk-nt" className="pf-in" value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} />
              <label className="pf-l" htmlFor="desk-nd">Details</label>
              <textarea id="desk-nd" className="pf-in" value={note.detail} onChange={(e) => setNote({ ...note, detail: e.target.value })} />
              <div className="btns" style={{ marginTop: 8 }}>
                <button className="btn small primary" type="submit" disabled={busy || !note.title.trim()}>Send to {name}</button>
                <button className="btn small" type="button" onClick={() => setNote(null)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="desk-row" style={{ marginTop: 10 }}>
            <p className="desk-p" style={{ margin: 0 }}>Nordea's agent can check the bank data for changes.</p>
            <button className="btn small" disabled={busy} onClick={() => run(() => agentCheck(userId))}>Run agent check</button>
          </div>
        </section>

        <section className="desk-sec">
          <h3>Sent to {name}</h3>
          {sent.length ? (
            <ul className="desk-sent">
              {sent.map((s) => (
                <li key={s.id}>
                  <span className="desk-nt"><b>{s.finalTitle || s.title}</b><span>{s.byLabel.split(' · ')[0]} · {ago(s.createdAt)}</span></span>
                  <span className={`desk-st ${STATUS[s.status].c}`}>{STATUS[s.status].t}</span>
                </li>
              ))}
            </ul>
          ) : <p className="desk-p">Nothing sent yet.</p>}
        </section>

        <section className="desk-sec">
          <h3>Your reads, as {name} sees them</h3>
          {v.log.length ? (
            <ul className="desk-log">{v.log.map((l, i) => <li key={i}><span>{l.purpose}</span><span>{l.count} {l.count === 1 ? 'item' : 'items'} · {ago(l.at)}</span></li>)}</ul>
          ) : <p className="desk-p">No reads yet. Each one shows up in {name}'s app under “Who used it”.</p>}
        </section>

        <section className="desk-sec desk-demo">
          <h3><Icon name="sliders" size={16} /> Demo controls</h3>
          <div className="btns">
            <button className="btn small" disabled={busy} onClick={() => run(() => demoSetup(userId))}>{name} keeps the travel goal private</button>
            <button className="btn small quiet" disabled={busy} onClick={() => run(async () => { await resetFlow(userId); setDraft([]); setNote(null); })}>Reset the story</button>
          </div>
        </section>
        {err && <p className="desk-p" style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
    </aside>
  );
};
