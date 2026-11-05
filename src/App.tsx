import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneFrame } from './components/PhoneFrame.js';
import { PersonaPickerModal } from './components/PersonaPickerModal.js';
import { AddGoalModal } from './components/AddGoalModal.js';
import { HomePage } from './components/HomePage.js';
import { KnowsPage, PrivacyPage, AutopilotPage, RewardsPage, RedeemSheet, ContactPage, MorePage, DeleteDocSheet, ConfirmSheet } from './components/Pages.js';
import { Chat } from './components/Chat.js';
import { Icon } from './ui/icons.js';
import { FlowHomeCard, FlowSuggestions, FlowPage, MeetingCard, MeetingPrepPage, MeetingOverlay, EditSuggestionSheet } from './components/FlowParts.js';
import { AdviserDesk } from './components/AdviserDesk.js';
import { FlowState, Suggestion, fetchFlow, shareEntry, decideSuggestion, answerRequest } from './services/flowApi.js';
import { CabinetEntry, ChatMessage, PersonaId, User } from './types.js';
import {
  AppState,
  fetchState,
  fetchUsers,
  updateCabinetEntry,
  deleteCabinetEntry,
  undoCabinetAction,
  updateUserViewMode,
  resetDatabase,
  reloadData,
  sendChat,
  doAction,
  setOffersOff,
  revokeShare,
  importChat,
  confirmObservation,
  fetchConversationMessages,
  ImportBody,
  Reward,
  fetchRewards,
  redeemReward,
  deleteDocument,
  deleteChats,
  deleteChat,
} from './services/api.js';

type Page = 'home' | 'knows' | 'rewards' | 'contact' | 'more' | 'privacy' | 'autopilot' | 'flow' | 'prep';

function initialDark() {
  try {
    // Only a choice the customer made in More → Dark mode counts. (Older versions saved the editor's dark setting.)
    localStorage.removeItem('abel-theme');
    const saved = localStorage.getItem('abel-theme-choice');
    if (saved) return saved === 'dark';
  } catch { /* storage may be blocked */ }
  // Light by default, like the Nordea app. Dark only when the customer switches it on (More → Dark mode).
  // (AI Studio's dark editor would otherwise make the preview start dark.)
  return false;
}

export default function App() {
  const [personaId, setPersonaId] = useState<PersonaId>('lauri');
  const [state, setState] = useState<AppState | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState<Page>('home');
  const [isDark, setIsDark] = useState(initialDark);
  const [toast, setToast] = useState<{ message: string; undoToken?: string } | null>(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The app ships with no data: until some is loaded (scripts/load_data.py) it shows "No data yet".
  const [noData, setNoData] = useState(false);
  const [checking, setChecking] = useState(false);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redeemAsk, setRedeemAsk] = useState<Reward | null>(null);
  const [delDocId, setDelDocId] = useState<string | null>(null);
  const [askDeleteChats, setAskDeleteChats] = useState(false);
  const [askDeleteChat, setAskDeleteChat] = useState<string | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  // Information flow: what reaches Nordea's agent and the adviser, and updates coming back.
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [flowTick, setFlowTick] = useState(0);
  const [showDesk, setShowDesk] = useState(true);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [editSug, setEditSug] = useState<Suggestion | null>(null);
  const lastMeeting = useRef<string | null>(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [helperId, setHelperId] = useState('abel');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [waiting, setWaiting] = useState(false);
  // Client-measured: send tap to reply arrival, per agent reply. In memory only - a reload shows nothing
  // (no invented history). `late` = the reply was picked up after the connection dropped or hung.
  const [timings, setTimings] = useState<Record<string, { ms: number; late: boolean }>>({});
  const pendingRef = useRef(0);
  // Which chat is on screen, so a late answer for another chat doesn't land here.
  const viewRef = useRef(0);

  const refresh = useCallback(async (id: string = personaId) => {
    try {
      setState(await fetchState(id));
      setError(null);
      setNoData(false);
    } catch (e: any) {
      if (e?.code === 'NO_DATA') {
        setState(null);
        setError(null);
        setNoData(true);
        return;
      }
      // Loaded data may not have this customer (e.g. no "lauri"): switch to the first one there is.
      if (e?.message === 'User not found') {
        const us = await fetchUsers().catch(() => [] as User[]);
        setUsers(us);
        if (us.length && us[0].id !== id) { setPersonaId(us[0].id as PersonaId); return; }
      }
      setError(e?.message || 'Could not load the app data');
    }
  }, [personaId]);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await reloadData();
      fetchUsers().then(setUsers).catch(() => {});
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not load the app data');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refresh(personaId);
    fetchUsers().then(setUsers).catch(() => {});
    fetchRewards().then(setRewards).catch(() => {});
  }, [personaId]);

  // The flow changes from both sides (the adviser screen and the phone), so it is read again every few seconds.
  const loadFlow = useCallback(() => fetchFlow(personaId).then(setFlow).catch(() => {}), [personaId]);
  useEffect(() => {
    loadFlow();
    const t = window.setInterval(() => { loadFlow(); setFlowTick((n) => n + 1); }, 3000);
    return () => window.clearInterval(t);
  }, [loadFlow]);
  useEffect(() => {
    const st = flow?.meeting.status || null;
    if (st === 'live' && lastMeeting.current !== 'live') setMeetingOpen(true);
    if (st !== 'live') setMeetingOpen(false);
    if (st === 'live' && flow?.meeting.request?.status === 'asked') setMeetingOpen(true);
    lastMeeting.current = st;
  }, [flow?.meeting.status, flow?.meeting.request?.status]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  const goPage = (p: Page) => {
    setPage(p);
    setChatOpen(false);
    screenRef.current?.scrollTo({ top: 0 });
  };

  // ---------- chat ----------
  const openHelper = (id: string) => {
    viewRef.current++;
    pendingRef.current = 0;
    setWaiting(false);
    setHelperId(id);
    setConversationId(null);
    setMessages([]);
    setChatOpen(true);
  };
  const openConversation = async (id: string) => {
    viewRef.current++;
    pendingRef.current = 0;
    setWaiting(false);
    const c = state?.conversations.find((x) => x.id === id);
    setHelperId(c?.helperId || 'abel');
    setConversationId(id);
    setMessages(await fetchConversationMessages(id));
    setChatOpen(true);
  };
  const appendFromServer = (convId: string, msgs: ChatMessage[], resolvedId?: string, resolvedText?: string) => {
    setConversationId(convId);
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const next = prev.map((m) => (m.id === resolvedId && resolvedText ? { ...m, resolved: resolvedText } : m));
      return [...next, ...msgs.filter((m) => !ids.has(m.id))];
    });
  };
  const send = async (text: string, opts?: { helperId: string; conversationId: string | null }) => {
    if (!state) return;
    const hId = opts ? opts.helperId : helperId;
    const cId = opts ? opts.conversationId : conversationId;
    const temp: ChatMessage = { id: 'tmp-' + Date.now(), userId: state.user.id, agentId: 'abel', channel: 'app', sender: 'user', text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, temp]);
    pendingRef.current++;
    setWaiting(true);
    const view = viewRef.current;
    const sentAt = performance.now();
    try {
      const res = await sendChat(state.user.id, cId, hId, text);
      const ms = Math.round(performance.now() - sentAt);
      if (view !== viewRef.current) { refresh(); return; } // the customer moved to another chat meanwhile (the reply is stored; reopening the chat shows it)
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      const reply = [...res.messages].reverse().find((m) => m.sender === 'agent');
      if (reply) setTimings((t) => ({ ...t, [reply.id]: { ms, late: !!res.late } }));
      appendFromServer(res.conversationId, res.messages);
      refresh();
    } catch (e: any) {
      if (view !== viewRef.current) return;
      setMessages((prev) => [...prev, { ...temp, id: 'err-' + Date.now(), sender: 'agent', text: 'Sorry, I didn’t get an answer. Could you try again?', errorInfo: e?.message || 'The request failed' }]);
    } finally {
      if (view === viewRef.current) { pendingRef.current = Math.max(0, pendingRef.current - 1); setWaiting(pendingRef.current > 0); }
    }
  };
  /** Open a helper and send a first message straight away. */
  const startChat = (id: string, text?: string) => {
    openHelper(id);
    if (text) send(text, { helperId: id, conversationId: null });
  };
  const act = async (messageId: string, action: string, payload?: Record<string, unknown>) => {
    if (!state || !conversationId) return;
    setWaiting(true);
    try {
      const res = await doAction(state.user.id, messageId, action, payload);
      // Re-read the conversation so the tapped card shows its final state.
      const fresh = await fetchConversationMessages(conversationId);
      setMessages(fresh);
      refresh();
      void res;
    } catch (e: any) {
      setToast({ message: e?.message || 'That didn’t work' });
    } finally {
      setWaiting(false);
    }
  };
  const doImport = async (body: ImportBody) => {
    if (!state) return;
    if (!chatOpen) {
      setHelperId('abel');
      setMessages([]);
      setChatOpen(true);
    }
    setWaiting(true);
    try {
      const res = await importChat(state.user.id, chatOpen ? conversationId : null, chatOpen ? helperId : 'abel', body);
      appendFromServer(res.conversationId, res.messages);
      refresh(); // a kept copy shows up in Your documents
    } catch (e: any) {
      setToast({ message: e?.message || 'Couldn’t read that file' });
    } finally {
      setWaiting(false);
    }
  };

  // ---------- your documents and chats ----------
  const removeDoc = async (alsoEntries: boolean) => {
    const id = delDocId;
    setDelDocId(null);
    if (!state || !id) return;
    try {
      const r = await deleteDocument(state.user.id, id, alsoEntries);
      setToast({ message: r.message });
      await refresh();
      if (chatOpen && conversationId) setMessages(await fetchConversationMessages(conversationId));
    } catch (e: any) {
      setToast({ message: e?.message || 'Couldn’t delete it. Try again.' });
    }
  };
  const removeChat = async () => {
    const id = askDeleteChat;
    setAskDeleteChat(null);
    if (!state || !id) return;
    try {
      const r = await deleteChat(state.user.id, id);
      if (conversationId === id) { viewRef.current++; setChatOpen(false); setConversationId(null); setMessages([]); }
      setToast({ message: r.message });
      refresh();
    } catch (e: any) {
      setToast({ message: e?.message || 'Couldn’t delete the chat. Try again.' });
    }
  };
  const removeChats = async () => {
    setAskDeleteChats(false);
    if (!state) return;
    try {
      const r = await deleteChats(state.user.id);
      viewRef.current++;
      setChatOpen(false);
      setConversationId(null);
      setMessages([]);
      setToast({ message: r.message });
      refresh();
    } catch (e: any) {
      setToast({ message: e?.message || 'Couldn’t delete your chats. Try again.' });
    }
  };

  // ---------- cabinet ----------
  const undo = async (token: string) => {
    try {
      const r = await undoCabinetAction(token);
      setToast({ message: `↩︎ ${r.message}` });
      refresh();
    } catch {
      setToast({ message: 'That can’t be undone any more' });
    }
  };
  const update = async (e: CabinetEntry, updates: Partial<CabinetEntry>) => {
    const r = await updateCabinetEntry(e.id, updates);
    setToast({ message: r.message, undoToken: r.undoToken });
    refresh();
  };
  const archive = async (e: CabinetEntry) => {
    const r = await deleteCabinetEntry(e.id);
    setToast({ message: 'Removed. It’s kept in your history.', undoToken: r.undoToken });
    refresh();
  };
  const confirm = async (e: CabinetEntry) => {
    const r = await confirmObservation(state!.user.id, e.id);
    // Confirming only confirms: you stay where you are. For a salary change Abel leaves a tip in Recent chats.
    setToast({ message: r.conversationId ? 'Thanks · +10 points · Abel left you a tip in Recent chats' : 'Thanks · +10 points' });
    await refresh();
  };

  // ---------- information flow ----------
  // The cabinet's own agents may finish a write a moment later, so the app reads again shortly after.
  const afterFlow = async (f: FlowState) => { setFlow(f); setFlowTick((n) => n + 1); await refresh(); window.setTimeout(() => refresh(), 1500); };
  const share = async (e: CabinetEntry, shared: boolean) => {
    try {
      await afterFlow(await shareEntry(state!.user.id, e.id, shared));
      setToast({ message: shared ? `Shared with Nordea. ${flow?.adviser.name || 'Your adviser'} can use it.` : 'Only yours now. Nordea can’t see it.' });
    } catch (err: any) { setToast({ message: err?.message || 'That didn’t work' }); }
  };
  const decide = async (s: Suggestion, d: 'accept' | 'delete', edits?: { title: string; detail: string }) => {
    try {
      await afterFlow(await decideSuggestion(state!.user.id, s.id, d, edits));
      const who = s.by === 'nordea_agent' ? 'Nordea' : flow?.adviser.name || 'Your adviser';
      setToast({ message: d === 'delete' ? `Deleted. It was never added, and ${who} sees that.` : `Added to your cabinet. ${who} sees that you ${edits ? 'edited and ' : ''}accepted it.` });
    } catch (err: any) { setToast({ message: err?.message || 'That didn’t work' }); }
  };
  const answer = async (a: 'once' | 'always' | 'no', entryId?: string) => {
    try { await afterFlow(await answerRequest(state!.user.id, a, entryId)); }
    catch (err: any) { setToast({ message: err?.message || 'That didn’t work' }); }
  };
  const flowTop = <FlowSuggestions flow={flow} onDecide={decide} onEdit={setEditSug} />;
  const waitingCount = (flow?.suggestions || []).filter((s) => s.status === 'waiting').length;

  if (error && !state) {
    return <div className="caption" style={{ padding: 40 }}>Couldn’t load the app: {error}</div>;
  }
  if (noData && !state) {
    return (
      <div className="caption" style={{ padding: 40, margin: '40px auto' }}>
        <p><b>No data yet</b></p>
        <p>There are no customers or transactions in the app. Load data with <code>scripts/load_data.py</code>, then check again.</p>
        <button className="btn primary" onClick={checkAgain} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
      </div>
    );
  }
  if (!state) {
    return <div className="caption" style={{ padding: 40 }}>Loading…</div>;
  }

  const isCalm = state.user.viewMode === 'calm';
  const tab = (k: Page, icon: string, label: string) => {
    const on = page === k || (k === 'more' && page === 'privacy') || (k === 'home' && page === 'autopilot');
    return (
      <button key={k} role="tab" aria-selected={on} onClick={() => goPage(k)}>
        <Icon name={icon} />
        <span>{label}</span>
      </button>
    );
  };

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    try { localStorage.setItem('abel-theme-choice', next ? 'dark' : 'light'); } catch { /* storage may be blocked */ }
  };
  const frame = (what: string) => setToast({ message: `${what} is part of the Nordea app. This concept adds Abel.` });

  return (
    <div className={isCalm ? 'calm' : ''}>
      <div className={`stage-top${showDesk ? ' wide' : ''}`}>
        <span className="stage-t"><b>Abel</b> · Nordea concept{!state.aiConnected && ' · AI not connected'}</span>
        <span className="stage-chips">
        <button className="theme-chip" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          <Icon name={isDark ? 'sun' : 'moon'} size={16} />
          {isDark ? 'Light' : 'Dark'}
        </button>
        <button className="theme-chip desk-toggle" aria-pressed={showDesk} onClick={() => setShowDesk(!showDesk)}>
          <Icon name="person" size={16} />{showDesk ? 'Hide adviser screen' : 'Show adviser screen'}
        </button>
        </span>
      </div>
      <div className="stagewrap">
        <PhoneFrame
          screenRef={screenRef}
          statusBarTheme={chatOpen ? 'light' : 'brand'}
          bottom={
            <nav className="nav nav5" role="tablist">
              {tab('home', 'home', 'Home')}
              {tab('knows', 'cab', 'Abel knows')}
              {tab('rewards', 'star', 'Rewards')}
              {tab('contact', 'contact', 'Contact')}
              {tab('more', 'more', 'More')}
            </nav>
          }
          overlay={
            <>
              <Chat
                open={chatOpen}
                helperId={helperId}
                userName={state.user.name}
                messages={messages}
                waiting={waiting}
                timings={timings}
                entries={state.entries}
                shares={state.shares}
                onClose={() => setChatOpen(false)}
                onNew={() => openHelper(helperId)}
                onSend={send}
                onAction={act}
                onUndo={undo}
                onOpenPage={(p) => goPage(p as Page)}
                onOpenHelper={openHelper}
                onRevoke={async (id) => { const r = await revokeShare(id); setToast({ message: r.message }); refresh(); }}
                onImport={doImport}
                onToast={(m) => setToast({ message: m })}
                onEditEntry={() => goPage('knows')}
                userId={state.user.id}
                documents={state.documents}
                onDeleteDoc={setDelDocId}
                sharedIds={flow?.sharedIds}
                onShare={(id, shared) => { const e = state.entries.find((x) => x.id === id); if (e) share(e, shared); }}
              />
              {flow && meetingOpen && flow.meeting.status === 'live' && (
                <MeetingOverlay state={state} flow={flow} onAnswer={answer} onClose={() => setMeetingOpen(false)} />
              )}
              {editSug && (
                <EditSuggestionSheet s={editSug} onCancel={() => setEditSug(null)} onSave={(t, d) => { const s = editSug; setEditSug(null); decide(s, 'accept', { title: t, detail: d }); }} />
              )}
              {delDocId && state.documents.find((d) => d.id === delDocId) && (
                <DeleteDocSheet doc={state.documents.find((d) => d.id === delDocId)!} onDelete={removeDoc} onCancel={() => setDelDocId(null)} />
              )}
              {askDeleteChat && (
                <ConfirmSheet
                  kicker="Recent chats"
                  title="Delete this chat?"
                  body="The messages in this chat are deleted for good. What Abel saved from it stays in “Abel knows”, and kept files stay in Your documents. You can delete those separately."
                  yes="Delete chat"
                  onYes={removeChat}
                  onNo={() => setAskDeleteChat(null)}
                />
              )}
              {askDeleteChats && (
                <ConfirmSheet
                  kicker="Your chats"
                  title="Delete all your chats?"
                  body="Every conversation with Abel and the helpers is deleted for good. What Abel knows and Your documents stay, and you can delete those separately."
                  yes="Delete my chats"
                  onYes={removeChats}
                  onNo={() => setAskDeleteChats(false)}
                />
              )}
              <PersonaPickerModal
                isOpen={usersOpen}
                onClose={() => setUsersOpen(false)}
                users={users}
                currentUserId={state.user.id}
                onSelectPersona={(p) => { setPersonaId(p); setUsersOpen(false); setChatOpen(false); setPage('home'); }}
                onResetDatabase={async () => { await resetDatabase(); setUsersOpen(false); setChatOpen(false); refresh(); setToast({ message: 'All data deleted' }); }}
              />
              <AddGoalModal
                isOpen={addGoalOpen}
                onClose={() => setAddGoalOpen(false)}
                userId={state.user.id}
                onGoalAdded={(e, undoToken) => { setToast({ message: `📌 Added “${e.title}”`, undoToken }); refresh(); }}
              />
              {redeemAsk && (
                <RedeemSheet
                  state={state}
                  reward={redeemAsk}
                  onNo={() => setRedeemAsk(null)}
                  onYes={async () => {
                    const r = redeemAsk;
                    setRedeemAsk(null);
                    try { const res = await redeemReward(state.user.id, r.id); setToast({ message: res.message }); refresh(); }
                    catch (e: any) { setToast({ message: e?.message || 'That didn’t work' }); }
                  }}
                />
              )}
              {toast && (
                <div className="toast" role="status">
                  <span>{toast.message}</span>
                  {toast.undoToken && (
                    <button className="btn link" style={{ color: '#F0C25A', marginLeft: 8 }} onClick={() => { undo(toast.undoToken!); setToast(null); }}>
                      Undo
                    </button>
                  )}
                </div>
              )}
            </>
          }
        >
          {page === 'home' && (
            <HomePage
              state={state}
              onFrame={frame}
              onOpenHelper={openHelper}
              onOpenConversation={openConversation}
              onOpenPage={(p) => goPage(p as Page)}
              onOpenUsers={() => setUsersOpen(true)}
              onConfirm={confirm}
              onDeleteChat={setAskDeleteChat}
              onDeleteAllChats={() => setAskDeleteChats(true)}
              onWrong={(e) => update(e, { status: 'disputed' })}
              onArchive={archive}
              onKeep={(e) => update(e, { status: 'active', confirmedAt: new Date().toISOString() })}
              extraCount={waitingCount}
              extra={<>
                <FlowHomeCard state={state} flow={flow} onOpenFlow={() => goPage('flow')} onOpenMeeting={() => (flow?.meeting.status === 'live' ? setMeetingOpen(true) : goPage('contact'))} />
                <FlowSuggestions flow={flow} onDecide={decide} onEdit={setEditSug} limit={1} onMore={() => goPage('knows')} />
              </>}
            />
          )}
          {page === 'knows' && (
            <KnowsPage
              state={state}
              onAddGoal={() => setAddGoalOpen(true)}
              onTellAbel={() => openHelper('abel')}
              onImport={() => doImport({ sample: true })}
              onPrivacy={() => goPage('privacy')}
              onAskAbout={(t) => startChat('abel', t)}
              onUpdate={update}
              onArchive={archive}
              onConfirm={confirm}
              onKeep={(e) => update(e, { status: 'active', confirmedAt: new Date().toISOString() })}
              onDeleteDoc={setDelDocId}
              flow={flow}
              flowTop={flowTop}
              onFlow={() => goPage('flow')}
              onShare={share}
            />
          )}
          {page === 'flow' && <FlowPage state={state} flow={flow} onBack={() => goPage('home')} />}
          {page === 'prep' && <MeetingPrepPage state={state} flow={flow} onBack={() => goPage('contact')} onShare={share} />}
          {page === 'privacy' && (
            <PrivacyPage
              state={state}
              onDocuments={() => { goPage('knows'); setTimeout(() => document.getElementById('your-docs')?.scrollIntoView({ behavior: 'smooth' }), 80); }}
              onDeleteChats={() => setAskDeleteChats(true)}
              onBack={() => goPage('knows')}
              onToggleOffers={async () => { await setOffersOff(state.user.id, !state.user.offersOff); setToast({ message: state.user.offersOff ? 'Partner offers are on' : 'Partner offers are off' }); refresh(); }}
              onRevoke={async (id) => { const r = await revokeShare(id); setToast({ message: r.message }); refresh(); }}
            />
          )}
          {page === 'autopilot' && (
            <AutopilotPage state={state} onBack={() => goPage('home')} onPlan={(t) => startChat('autopilot', t)} />
          )}
          {page === 'rewards' && <RewardsPage state={state} rewards={rewards} onAsk={() => openHelper('abel')} onUse={setRedeemAsk} onEarn={() => goPage('home')} />}
          {page === 'contact' && <ContactPage state={state} onHelper={openHelper} onOpenConversation={openConversation} onDeleteChat={setAskDeleteChat} onDeleteAllChats={() => setAskDeleteChats(true)}
            extra={<MeetingCard flow={flow} onPrep={() => goPage('prep')} onJoin={() => (flow?.meeting.status === 'live' ? setMeetingOpen(true) : setToast({ message: `${flow?.adviser.name || 'Your adviser'} starts the meeting. You'll see it here.` }))} />} />}
          {page === 'more' && (
            <MorePage
              state={state}
              isDark={isDark}
              onPage={(p) => goPage(p as Page)}
              onUsers={() => setUsersOpen(true)}
              onCalm={async () => { await updateUserViewMode(state.user.id, isCalm ? 'full' : 'calm'); refresh(); }}
              onDark={toggleTheme}
              onReset={async () => { if (!window.confirm('Delete all customers and their data? Load data again with scripts/load_data.py.')) return; await resetDatabase(); setChatOpen(false); refresh(); setToast({ message: 'All data deleted' }); }}
              onRefresh={() => refresh()}
            />
          )}
        </PhoneFrame>
        {showDesk && <AdviserDesk userId={state.user.id} tick={flowTick} onChanged={() => { loadFlow(); refresh(); }} />}
      </div>
      <p className="foot">Student concept · fictional data and partners</p>
    </div>
  );
}
