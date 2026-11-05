import React, { useState } from 'react';
import { AppState } from '../services/api.js';
import { CabinetEntry } from '../types.js';
import { Icon, Bell, Chevron } from '../ui/icons.js';
import { nfi, ago } from '../ui/format.js';
import { HELPERS, HELPER_ORDER } from '../ui/helpers.js';
import { LOGO_WHITE } from '../constants/logos.js';
import { BAND_BG, RoundActions, NRow, Band, NChev } from './Nordea.js';

interface Props {
  state: AppState;
  onFrame: (what: string) => void;
  onOpenHelper: (helperId: string) => void;
  onOpenConversation: (id: string) => void;
  onDeleteChat?: (id: string) => void;
  onDeleteAllChats?: () => void;
  onOpenPage: (page: string) => void;
  onOpenUsers: () => void;
  onConfirm: (e: CabinetEntry) => void;
  onWrong: (e: CabinetEntry) => void;
  onArchive: (e: CabinetEntry) => void;
  onKeep: (e: CabinetEntry) => void;
  /** Information flow: where your information goes, updates from the Nordea side, your next meeting. */
  extra?: React.ReactNode;
  extraCount?: number;
}

/** Things Nordea noticed that wait for the customer, and old goals that look out of date. */
export function feedItems(entries: CabinetEntry[]) {
  return entries.filter((e) => (e.source === 'nordea' && !e.reviewed && e.status === 'active') || e.status === 'stale');
}

export const HomeHeader: React.FC<{ state: AppState; feedCount: number; onFrame: (w: string) => void; onAsk: () => void; onUsers: () => void; onBell: () => void }> = ({ state, feedCount, onFrame, onAsk, onUsers, onBell }) => (
  <header className="nhead" style={{ backgroundImage: BAND_BG }}>
    <div className="nhead-top">
      <span className="concept-tag">Concept · fictional data</span>
      <span className="nh-right">
        <button className="nh-bell" onClick={onBell} aria-label={`Notifications${feedCount ? ': ' + feedCount : ''}`}>
          <span className="bell">
            <Bell />
            {feedCount > 0 && <i>{feedCount}</i>}
          </span>
        </button>
        <button className={`avatar a-${state.user.persona}`} onClick={onUsers} aria-label="Switch demo customer">
          {state.user.name[0]}
        </button>
      </span>
    </div>
    <img className="nlogo c" src={LOGO_WHITE} alt="Nordea" />
    <p className="nwelcome">Welcome, {state.user.name}!</p>
    {/* Pay, Scan invoice and Transfer belong to the existing Nordea app. "Ask Abel" is what this concept adds. */}
    {/* Abel first: a bar that opens the chat. Pay, Scan invoice and Transfer belong to the existing Nordea app. */}
    <button className="ask-bar" onClick={onAsk}>
      <Icon name="spark" />
      <span>Ask Abel anything…</span>
      <i className="live-dot" aria-hidden="true" />
    </button>
    <RoundActions
      actions={[
        { icon: 'pay', label: 'Pay', onClick: () => onFrame('Payments') },
        { icon: 'scan', label: 'Scan invoice', onClick: () => onFrame('Scanning invoices') },
        { icon: 'transfer', label: 'Transfer', onClick: () => onFrame('Transfers') },
      ]}
    />
  </header>
);

export const HomePage: React.FC<Props> = (p) => {
  const { state } = p;
  const [feedAll, setFeedAll] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  const [whyId, setWhyId] = useState<string | null>(null);
  const feed = feedItems(state.entries);
  const acc = state.accounts;
  const available = acc.current.balance + acc.savings.balance + (acc.carFund?.balance || 0);
  const carGoal = state.entries.find((e) => e.goalType === 'car' && e.status !== 'archived');

  const card = (e: CabinetEntry) =>
    e.status === 'stale' ? (
      <div className="card" key={e.id}>
        <span className="from you">Your goal</span>
        <div>
          <h3>Is “{e.title}” still a plan?</h3>
          <p>Its date has passed and no money has been added for a long time.</p>
        </div>
        <div className="btns">
          <button className="btn primary" onClick={() => p.onArchive(e)}>No, remove it</button>
          <button className="btn" onClick={() => p.onKeep(e)}>Yes, keep it</button>
        </div>
      </div>
    ) : (
      <div className="card" key={e.id}>
        <span className="from bank">Nordea noticed</span>
        <div>
          <h3>{e.title}</h3>
          <p>{e.detail.replace(/\s*Is this right\?$/, '')}</p>
        </div>
        <div className="btns">
          <button className="btn primary" onClick={() => p.onConfirm(e)}>Confirm</button>
          <button className="btn" onClick={() => p.onWrong(e)}>That’s wrong</button>
          {e.why && <button className="btn quiet" onClick={() => setWhyId(whyId === e.id ? null : e.id)}>{whyId === e.id ? 'Hide' : 'How do we know?'}</button>}
        </div>
        {e.why && whyId === e.id && <p className="why">{e.why}</p>}
      </div>
    );

  const convs = state.conversations;
  const [histAll, setHistAll] = useState(false);

  return (
    <>
      <HomeHeader state={state} feedCount={feed.length + (p.extraCount || 0)} onFrame={p.onFrame} onAsk={() => p.onOpenHelper('abel')} onUsers={p.onOpenUsers} onBell={() => setFeedAll(true)} />
      <div className="nbody">
        {/* The existing Nordea app: shown so Abel sits in a familiar place. Tapping says so. */}
        <div className="ncard first">
          <button className="nrow2 head" onClick={() => p.onFrame('Payments')}>
            <span className="n-l">
              <span className="n-name b">Payments and e-invoices</span>
              <span className="n-sub"><i className="reddot" />Unconfirmed (2)</span>
            </span>
            <NChev />
          </button>
        </div>
        <div className="ncard">
          <button className="nrow2 head acc-toggle" onClick={() => setAccOpen(!accOpen)} aria-expanded={accOpen}>
            <span className="n-l">
              <span className="n-name b">Accounts and cards</span>
              <span className="n-sub">Available {nfi(available)}</span>
            </span>
            <span className="nchev" aria-hidden="true"><Chevron rotate={accOpen ? -90 : 90} /></span>
          </button>
          {accOpen && (
            <div className="acc-list">
              <NRow name="Current account" sub={acc.current.iban} amount={nfi(acc.current.balance)} onClick={() => p.onFrame('Accounts')} />
              <NRow name="Savings account" sub={acc.savings.iban} amount={nfi(acc.savings.balance)} onClick={() => p.onFrame('Accounts')} />
              {acc.carFund && carGoal && <NRow name="Car fund" sub={acc.carFund.iban} amount={nfi(acc.carFund.balance)} onClick={() => p.onFrame('Accounts')} />}
              <NRow name="Spent this month" sub="Current account" amount={nfi(state.spentThisMonth)} />
            </div>
          )}
        </div>

        {p.extra}

        {feed.length > 0 && (
          <>
            <Band left="From Abel" right={`${feed.length} for you`} />
            {feedAll ? feed.map(card) : card(feed[0])}
            {!feedAll && feed.length > 1 && (
              <button className="nshowall plain" onClick={() => setFeedAll(true)}>
                Show {feed.length - 1} more
              </button>
            )}
          </>
        )}

        <div className="ncard">
          <div className="nhead-row">
            <div>
              <h3>Abel can help with</h3>
            </div>
          </div>
          <div className="helpers in-card" role="list">
            {HELPER_ORDER.filter((k) => state.user.viewMode !== 'calm' || k === 'abel' || k === 'person').map((k) => {
              const h = HELPERS[k];
              return (
                <button key={k} className={`helper ${h.cls}`} role="listitem" onClick={() => (k === 'autopilot' ? p.onOpenPage('autopilot') : p.onOpenHelper(k))}>
                  <span className="h-glyph" aria-hidden="true"><Icon name={h.icon} /></span>
                  <span className="h-ico" aria-hidden="true"><Icon name={h.icon} /></span>
                  <span className="h-name">{h.card}</span>
                  <span className="h-line">{h.line}</span>
                  <span className="h-go" aria-hidden="true"><Icon name="arrow" /></span>
                </button>
              );
            })}
          </div>
        </div>

        <HistoryCard state={state} all={histAll} onToggle={() => setHistAll(!histAll)} onOpen={p.onOpenConversation} onDelete={p.onDeleteChat} onDeleteAll={p.onDeleteAllChats} />
        <p className="foot-note">Nothing is used without your OK.</p>
      </div>
    </>
  );
};

export const HistoryCard: React.FC<{ state: AppState; all: boolean; onToggle: () => void; onOpen: (id: string) => void; onDelete?: (id: string) => void; onDeleteAll?: () => void }> = ({ state, all, onToggle, onOpen, onDelete, onDeleteAll }) => {
  const list = state.conversations;
  const shown = all ? list : list.slice(0, 3);
  // No chats yet: no empty box (Abel's helpers and "Ask Abel" are right there).
  if (!list.length) return null;
  return (
    <div className="ncard">
      <div className="nhead-row"><h3>Recent chats</h3>{list.length > 1 && onDeleteAll && <button className="btn link small" onClick={onDeleteAll}>Delete all</button>}</div>
      {list.length ? (
        <>
          {shown.map((c) => {
            const h = HELPERS[c.helperId] || HELPERS.abel;
            return (
              <div key={c.id} className="hist-wrap">
                <button className="hist-row" onClick={() => onOpen(c.id)}>
                  <span className={`hist-ico ${h.cls}`} aria-hidden="true"><Icon name={h.icon} /></span>
                  <span className="hist-t">
                    <b>{c.title.slice(0, 60)}</b>
                    <span>{h.name}{c.snippet ? ' · ' + c.snippet.slice(0, 60) : ''}</span>
                  </span>
                  <span className="hist-when">{ago(c.updatedAt)}</span>
                  {!onDelete && <NChev />}
                </button>
                {onDelete && (
                  <button className="hist-del" onClick={() => onDelete(c.id)} aria-label={`Delete chat: ${c.title.slice(0, 40)}`} title="Delete this chat">
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </div>
            );
          })}
          {list.length > 3 && <button className="nshowall" onClick={onToggle}>{all ? 'Show less' : 'Show all'}</button>}
        </>
      ) : (
        <p className="hist-empty">Your chats with Abel will show up here.</p>
      )}
    </div>
  );
};
