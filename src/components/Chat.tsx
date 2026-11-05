import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatMessage, CabinetEntry, MessageCard, Share } from '../types.js';
import { Icon, BotAvatar, Chevron } from '../ui/icons.js';
import { eur, eurP, dayMonth, monthShort } from '../ui/format.js';
import { HELPERS } from '../ui/helpers.js';
import { documentUrl } from '../services/api.js';
import type { ImportBody, DocInfo } from '../services/api.js';

// Shrink a photo before sending: the model gets at most 1600 px, the chat keeps a small thumbnail.
function shrink(file: Blob, max: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo')); };
    img.src = url;
  });
}
const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read that file'));
    fr.readAsDataURL(file);
  });
}

interface Props {
  open: boolean;
  helperId: string;
  userName: string;
  messages: ChatMessage[];
  waiting: boolean;
  /** Client-measured send-to-arrival time per agent reply id (absent after a reload). */
  timings?: Record<string, { ms: number; late: boolean }>;
  entries: CabinetEntry[];
  shares: Share[];
  onClose: () => void;
  onNew: () => void;
  onSend: (text: string) => void;
  onAction: (messageId: string, action: string, payload?: Record<string, unknown>) => void;
  onUndo: (token: string) => void;
  onOpenPage: (page: string) => void;
  onOpenHelper: (id: string) => void;
  onRevoke: (shareId: string) => void;
  onImport: (body: ImportBody) => void;
  onToast: (message: string) => void;
  onEditEntry: (id: string) => void;
  userId: string;
  documents: DocInfo[];
  onDeleteDoc: (id: string) => void;
  /** Items shared with Nordea (information flow), and how to change that from a saved note. */
  sharedIds?: string[];
  onShare?: (entryId: string, shared: boolean) => void;
}

/** "15 000 €" never splits over two lines in a bubble. */
const keepNumbers = (t: string) => String(t || '').replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u202f').replace(/(\d) €/g, '$1\u00a0€');
type Item = { who: 'me' | 'bot'; key: string; node: React.ReactNode; rich?: boolean; after?: React.ReactNode };

export const Chat: React.FC<Props> = (p) => {
  const h = HELPERS[p.helperId] || HELPERS.abel;
  const [text, setText] = useState('');
  const [attOpen, setAttOpen] = useState(false);
  // "Keep a copy": off by default, so Abel reads a file once and it's gone.
  const [keepCopy, setKeepCopy] = useState(false);
  const [usedOpen, setUsedOpen] = useState<string | null>(null);
  const [impShow, setImpShow] = useState<string | null>(null);
  const [impSel, setImpSel] = useState<Record<string, boolean[]>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const camFallbackRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const seen = useRef<Set<string>>(new Set());
  // Technical details only for the team (More → Show technical details). Customers never see them.
  const readDebug = () => { try { return localStorage.getItem('abel-debug') === '1'; } catch { return false; } };
  const [debug, setDebug] = useState(readDebug);
  useEffect(() => {
    const f = () => setDebug(readDebug());
    window.addEventListener('abel-debug', f);
    return () => window.removeEventListener('abel-debug', f);
  }, []);

  useLayoutEffect(() => {
    const b = bodyRef.current;
    if (b) b.scrollTo({ top: b.scrollHeight, behavior: seen.current.size ? 'smooth' : 'auto' });
  }, [p.messages.length, p.waiting, p.open, usedOpen, impShow]);
  useEffect(() => {
    setUsedOpen(null);
    setImpShow(null);
  }, [p.helperId]);
  useEffect(() => () => stopCamera(), []);
  // Attach the camera stream once the camera view is on screen.
  useEffect(() => {
    const v = videoRef.current;
    if (camOpen && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [camOpen]);
  useEffect(() => {
    if (!p.open) { stopCamera(); setAttOpen(false); }
  }, [p.open]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOpen(false);
  }
  async function openCamera() {
    setAttOpen(false);
    if (!navigator.mediaDevices?.getUserMedia) { camFallbackRef.current?.click(); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = st;
      setCamOpen(true);
    } catch {
      p.onToast('Camera access was blocked. You can pick a photo instead.');
      imgRef.current?.click();
    }
  }
  async function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { p.onToast('The camera is still starting. Try again in a second.'); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    stopCamera();
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.9));
    sendPhoto(blob, 'Photo');
  }
  async function sendPhoto(file: Blob, name: string) {
    try {
      const [big, thumb] = await Promise.all([shrink(file, 1600, 0.85), shrink(file, 240, 0.7)]);
      p.onImport({ fileBase64: b64(big), mimeType: 'image/jpeg', fileName: name, thumb, keep: keepCopy });
    } catch (e: any) {
      p.onToast(e?.message || 'Could not open that photo');
    }
  }
  async function sendDoc(f: File) {
    if (f.size > 8 * 1024 * 1024) { p.onToast('That file is too big. Try one under 8 MB.'); return; }
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      p.onImport({ fileBase64: b64(await readAsDataUrl(f)), mimeType: 'application/pdf', fileName: f.name, keep: keepCopy });
    } else if (/\.xlsx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      p.onImport({ fileBase64: b64(await readAsDataUrl(f)), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: f.name, keep: keepCopy });
    } else if (/\.xls$/i.test(f.name)) {
      p.onToast('Old .xls files can’t be read. Save it as .xlsx or .csv and try again.');
    } else if (/\.(md|markdown|txt|csv)$/i.test(f.name) || f.type.startsWith('text/')) {
      p.onImport({ text: await f.text(), fileName: f.name, keep: keepCopy });
    } else if (f.type.startsWith('image/')) {
      sendPhoto(f, f.name);
    } else {
      p.onToast('I can read PDFs, photos, Excel (.xlsx), CSV and text files.');
    }
  }
  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { p.onToast('Voice isn’t available in this browser. Try Chrome, or type instead.'); return; }
    if (recRef.current) { recRef.current.stop(); return; }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setText((finalText + interim).trim());
    };
    rec.onerror = (e: any) => p.onToast(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it, or type instead.' : 'I didn’t catch that. Try again, or type instead.');
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      if (finalText.trim()) send(finalText);
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { recRef.current = null; setListening(false); }
  }

  // The message box grows with the text (up to about 6 lines, then it scrolls inside), like WhatsApp.
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  React.useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    el.style.overflowY = el.scrollHeight > 150 ? 'auto' : 'hidden';
  }, [text, p.open]);

  if (!p.open) return null;

  const send = (t: string) => {
    const v = t.trim();
    if (!v || p.waiting) return;
    setText('');
    p.onSend(v);
  };

  const byId = (id: string) => p.entries.find((e) => e.id === id);
  // The stamp under a reply names the actual answering source (model+provider / scripted /
  // scripted-error) and the document it was based on; separately, what the model says it used.
  // The model's list is its own report, so it's labelled that way, not as proof.
  const usedLine = (m: ChatMessage) => {
    const es = (m.usedEntryIds || []).map(byId).filter((e): e is CabinetEntry => !!e && e.status !== 'archived');
    const sup = m.supplied;
    if (!sup && !es.length) return null;
    const open = usedOpen === m.id;
    const docStamp = sup ? `from your document: ${sup.notes} ${sup.notes === 1 ? 'note' : 'notes'}${sup.accountData ? ' + account data' : ''}` : '';
    const sourceStamp = !sup || !sup.source
      ? `Abel could see ${sup?.notes ?? 0} ${(sup?.notes ?? 0) === 1 ? 'note' : 'notes'}${sup?.accountData ? ' + account data' : ''}`
      : sup.source === 'model'
        ? `Abel's AI answered${sup.provider ? ` · ${sup.provider}` : ''} · ${docStamp}`
        : sup.source === 'scripted-error'
          ? `Scripted answer after an AI error · ${docStamp}`
          : `Scripted answer · ${docStamp}`;
    // Order: question category, client-measured elapsed time, the actual answerer, the round plan.
    const tm = p.timings?.[m.id];
    const el = tm ? `${(tm.ms / 1000).toFixed(tm.ms < 10000 ? 1 : 0)} s client-measured${tm.late ? ', picked up late' : ''}` : '';
    const planStamp = sup?.plan ? `round plan: cm ${sup.plan.cm}, nordea ${sup.plan.nordea}${sup.plan.provider ? ` on ${sup.plan.provider}` : ''}` : '';
    const head = [el, sup?.category].filter(Boolean).join(' · '); // elapsed first, then the exact category
    const label = sup
      ? [head, sourceStamp, planStamp].filter(Boolean).join(' · ')
      : `Abel says it used ${es.length} ${es.length === 1 ? 'thing' : 'things'}`;
    return (
      <>
        <button className="used-l" onClick={() => setUsedOpen(open ? null : m.id)} aria-expanded={open}>
          <span className="ud">{es.slice(0, 3).map((e) => <i key={e.id} className={e.source === 'nordea' ? 'bank' : 'you'} />)}</span>
          {label}
          <Chevron rotate={open ? -90 : 90} size={14} />
        </button>
        {open && (
          <div className="used-list">
            {sup && (
              <p className="used-note">
                Abel was given {sup.notes} {sup.notes === 1 ? 'note' : 'notes'} you approved{sup.accountData ? ' and your demo account data (balances, salary, spending; fictional)' : ''}. Nothing else: not your kept files, and nothing you declined or removed.
              </p>
            )}
            {es.length > 0 && <p className="used-note"><b>Abel says it used:</b> (its own report, not a proof)</p>}
            {es.map((e) => (
              <div className="used-i" key={e.id}>
                <span className={`dotc ${e.source === 'nordea' ? 'bank' : 'you'}`} />
                <span className="used-t"><b>{e.title}</b><span>{e.source === 'nordea' ? 'Nordea noticed · you confirmed' : e.source === 'document' ? 'From a document you imported' : 'You told Abel'}</span></span>
                <button className="btn link" onClick={() => p.onEditEntry(e.id)}>Edit</button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const cardNode = (m: ChatMessage, c: MessageCard, ci: number): React.ReactNode => {
    const d = c.data || {};
    const open = !m.resolved;
    const act = (a: string, payload?: Record<string, unknown>) => p.onAction(m.id, a, payload);
    switch (c.type) {
      case 'offer':
        return (
          <div className="offer">
            <div className="of-h"><span className="of-logo" style={{ background: d.color }}>{d.initials}</span><span className="of-n"><b>{d.name}</b><span>{d.kind} · fictional partner</span></span><span className="of-tag">Partner offer</span></div>
            <div className="of-b"><b>{d.headline}</b></div>
            <div className="of-fee"><Icon name="shield" /><span>{d.feeText}</span></div>
            {open && (
              <>
                <div className="of-act"><button className="btn primary" onClick={() => act('offer_show')}>{d.cta}</button><button className="btn" onClick={() => act('offer_no')}>No thanks</button></div>
                <div className="of-foot"><button className="btn link" onClick={() => p.onOpenHelper('person')}>{d.alternative}</button><button className="btn link muted" onClick={() => act('offer_off')}>Turn off partner offers</button></div>
              </>
            )}
          </div>
        );
      case 'offer_list': {
        const bought = m.resolved?.startsWith('bought:') ? Number(m.resolved.slice(7)) : null;
        return (
          <div className="offer list">
            <div className="of-h sm"><span className="of-logo" style={{ background: d.color }}>{d.initials}</span><span className="of-n"><b>{d.name}</b><span>Partner offer · fictional</span></span></div>
            {(d.items || []).map((it: any, j: number) => (
              <div className={`of-row${bought === j ? ' bought' : ''}`} key={j}>
                <div className="of-rt"><span><b>{it.title}</b><span>{it.sub}</span></span><b className="of-p">{eurP(it.price)}{it.per || ''}</b></div>
                {bought == null ? (
                  <div className="of-ra"><button className="btn small" onClick={() => act('offer_view', { index: j })}>{d.view}</button><button className="btn small primary" onClick={() => act('offer_buy', { index: j })}>{d.buy}</button></div>
                ) : bought === j ? (
                  <span className="of-done">✓ You {d.verb} this</span>
                ) : null}
              </div>
            ))}
            <div className="of-fee"><Icon name="shield" /><span>{d.feeText}</span></div>
          </div>
        );
      }
      case 'confirm_plan':
        return (
          <div className="offer">
            <div className="of-h sm"><span className="of-logo" style={{ background: 'var(--brand)' }}><Icon name="cycle" /></span><span className="of-n"><b>{c.title}</b><span>Please confirm</span></span></div>
            <div className="of-row"><div className="of-rt"><span><b>Amount</b></span><b className="of-p">{eur(d.amount)} every month</b></div></div>
            <div className="of-row"><div className="of-rt"><span><b>From</b></span><span>{d.from}</span></div></div>
            <div className="of-row"><div className="of-rt"><span><b>To</b></span><span>{d.to}</span></div></div>
            <div className="of-row"><div className="of-rt"><span><b>Starts</b></span><span>{dayMonth(d.starts)}</span></div></div>
            <div className="of-fee"><Icon name="shield" /><span>{d.earns}</span></div>
            {open && <div className="of-act" style={{ paddingBottom: 12 }}><button className="btn primary" onClick={() => act('plan_confirm')}>Yes, set it up</button><button className="btn" onClick={() => act('plan_cancel')}>Cancel</button></div>}
          </div>
        );
      case 'confirm_save':
        return (
          <div className="offer">
            <div className="of-b" style={{ paddingTop: 14 }}><b>🔒 {d.draft?.title}</b></div>
            <div className="of-fee"><Icon name="shield" /><span>{c.body}</span></div>
            {open && <div className="of-act" style={{ paddingBottom: 12 }}><button className="btn primary" onClick={() => act('save_private')}>Save privately</button><button className="btn" onClick={() => act('save_no')}>Don’t save it</button></div>}
          </div>
        );
      case 'handoff':
        return (
          <div className="rc">
            <b className="rc-t">Ready! {c.title} would receive:</b>
            <div className="legend small"><span className="from you">You told us</span><span className="from bank">Nordea noticed</span></div>
            <ul className="rc-l">
              {(d.gets || []).slice(0, 6).map((g: any, k: number) => <li key={k}><span className={`dotc ${g.source === 'nordea' ? 'bank' : 'you'}`} />{g.title}</li>)}
              {(d.gets || []).length > 6 && <li className="more-l">…and {d.gets.length - 6} more</li>}
            </ul>
            {d.heldBack > 0 && <p className="rc-n">{d.heldBack} held back: not approved, private or not checked yet.</p>}
            <span className="earns no">{d.earns}</span>
            <p className="rc-n share-n"><Icon name="cal" /><span>{d.share}</span></p>
            {open && <div className="of-act" style={{ padding: '4px 0 0' }}><button className="btn primary" onClick={() => act('handoff_connect')}>Connect me</button><button className="btn" onClick={() => act('handoff_no')}>Not now</button></div>}
          </div>
        );
      case 'import': {
        const items: any[] = d.items || [];
        const sel = impSel[m.id] || items.map((x) => !!x.on);
        const n = sel.filter(Boolean).length;
        return (
          <div className="imp">
            {items.map((x, j) => (
              <button key={j} className={`imp-i${sel[j] ? ' on' : ''}`} disabled={!open} aria-pressed={sel[j]} onClick={() => setImpSel({ ...impSel, [m.id]: sel.map((v, k) => (k === j ? !v : v)) })}>
                <span className="imp-ck" aria-hidden="true">{sel[j] && <Icon name="check" />}</span>
                <span className="imp-t"><b>{x.sensitive ? '🔒 ' : ''}{x.title}</b>{x.detail && <span>{x.detail}</span>}{x.target && <span>{eur(x.target.amount)} by {monthShort(String(x.target.date).slice(0, 7))}</span>}{x.note && <span className="imp-note">{x.note}</span>}{x.quote && <q>{x.quote}</q>}</span>
              </button>
            ))}
            {impShow === m.id && d.transcript && <div className="imp-src">{String(d.transcript).split('\n').map((l: string, k: number) => { const [w, ...rest] = l.split(': '); return <p key={k}><b>{w}:</b> {rest.join(': ')}</p>; })}</div>}
            {open && <div className="of-act"><button className="btn primary" disabled={!n} onClick={() => act('import_save', { selected: sel.map((v, k) => (v ? k : -1)).filter((k) => k >= 0) })}>Save {n} {n === 1 ? 'thing' : 'things'}</button><button className="btn" onClick={() => act('import_no')}>Not now</button></div>}
            {d.transcript && <div className="of-foot"><button className="btn link" onClick={() => setImpShow(impShow === m.id ? null : m.id)}>{impShow === m.id ? 'Hide the conversation' : 'Show the conversation'}</button></div>}
          </div>
        );
      }
      case 'duplicate': {
        const ex = d.existing || {};
        const dr = d.draft || {};
        const tgt = (t: any) => (t ? `${eur(t.amount)} by ${monthShort(t.date.slice(0, 7))}` : '');
        return (
          <div className="offer">
            <div className="of-h sm"><span className="of-logo" style={{ background: 'var(--brand)' }}><Icon name="cab" /></span><span className="of-n"><b>{c.title}</b><span>Please choose</span></span></div>
            <div className="of-row"><div className="of-rt"><span><b>Abel knows</b><span>{ex.title}{ex.target ? ` · ${tgt(ex.target)}` : ex.detail ? ` · ${ex.detail}` : ''}</span></span></div></div>
            <div className="of-row"><div className="of-rt"><span><b>You just said</b><span>{dr.title}{dr.target ? ` · ${tgt(dr.target)}` : dr.detail ? ` · ${dr.detail}` : ''}</span></span></div></div>
            <div className="of-fee"><Icon name="shield" /><span>{d.how === 'conflict' ? 'Updating keeps the old version in its history, and you can undo it.' : 'Nothing is saved until you choose.'}</span></div>
            {open && (
              <div className="of-act stack3" style={{ paddingBottom: 12 }}>
                <button className="btn primary" onClick={() => act('dup_update')}>Update “{ex.title}”</button>
                <button className="btn" onClick={() => act('dup_both')}>Keep both</button>
                <button className="btn quiet" onClick={() => act('dup_keep')}>Leave it as it is</button>
              </div>
            )}
          </div>
        );
      }
      case 'info': {
        if (d.shareId) {
          const s = p.shares.find((x) => x.id === d.shareId);
          if (!s) return null;
          return s.revoked ? <span>Sharing stopped. The adviser can’t see what Abel knows any more.</span> : <span>🔗 Shared once with your adviser, until {dayMonth(s.until)}. <button className="btn link" onClick={() => p.onRevoke(s.id)}>Stop sharing now</button></span>;
        }
        if (d.link) return <button className="btn small" onClick={() => p.onOpenPage(d.link)}>{d.label}</button>;
        return null;
      }
      default:
        return null;
    }
  };

  // Build the list of bubbles (grouped like a messenger).
  const items: Item[] = [];
  const [g1, g2] = h.greet(p.userName);
  items.push({ who: 'bot', key: 'g1' + p.helperId, node: g1 }, { who: 'bot', key: 'g2' + p.helperId, node: g2 });
  const latestAgentId = [...p.messages].reverse().find((m) => m.sender === 'agent' && (m.supplied || m.usedEntryIds?.length))?.id;
  p.messages.forEach((m) => {
    if (m.sender === 'user') {
      if (m.attachment) {
        const at = m.attachment;
        const doc = at.documentId ? p.documents.find((x) => x.id === at.documentId) : undefined;
        const label = at.kind === 'pdf' ? 'PDF' : at.kind === 'image' ? 'Photo' : at.kind === 'sheet' ? 'Spreadsheet' : 'Text file';
        // Kept: preview + open + delete. Not kept: just the name, nothing of the file is stored.
        const keptLine = doc ? (
          <span className="att-kept">
            <span>Kept until {dayMonth(doc.expiresAt.slice(0, 10))}</span>
            <a href={documentUrl(p.userId, doc.id)} target="_blank" rel="noopener">Open</a>
            <button className="btn link" onClick={() => p.onDeleteDoc(doc.id)}>Delete</button>
          </span>
        ) : (
          <span className="att-kept muted">{at.documentId || at.deleted ? 'Copy deleted' : 'Not kept · Abel read it once'}</span>
        );
        items.push({
          who: 'me',
          key: m.id,
          node: doc && at.kind === 'image' && at.thumb ? (
            <img className="att-img" src={at.thumb} alt="Photo you sent" />
          ) : (
            <span className="att-file"><Icon name={at.kind === 'image' ? 'image' : 'file'} /><span><b>{at.name}</b><span>{label}</span></span></span>
          ),
          after: keptLine,
        });
        return;
      }
      items.push({ who: 'me', key: m.id, node: keepNumbers(m.text) });
      return;
    }
    const parts = keepNumbers(String(m.text || '')).split(/\n{2,}/).filter(Boolean);
    const cards = (m.cards || []).map((c, ci) => ({ c, ci, node: cardNode(m, c, ci) })).filter((x) => x.node);
    const inlineInfo = cards.filter((x) => x.c.type === 'info');
    const richCards = cards.filter((x) => x.c.type !== 'info');
    parts.forEach((t, n) => {
      const last = n === parts.length - 1;
      items.push({
        who: 'bot',
        key: `${m.id}-t${n}`,
        node: (
          <>
            <span className="pre">{t}</span>
            {last && (m.notes || []).map((nt, k) => (
              <span className="noted" key={k}>{nt.text} {nt.undoToken && <button className="btn link" onClick={() => p.onUndo(nt.undoToken!)}>Undo</button>}
                {nt.entryId && p.onShare && p.entries.some((e) => e.id === nt.entryId) && (p.sharedIds || []).includes(nt.entryId)
                  ? <>· Shared with Nordea <button className="btn link" onClick={() => p.onShare!(nt.entryId!, false)}>Keep it only mine</button></>
                  : nt.entryId && p.onShare && p.entries.some((e) => e.id === nt.entryId) ? <>· Only you <button className="btn link" onClick={() => p.onShare!(nt.entryId!, true)}>Share with Nordea</button></> : null}</span>
            ))}
            {last && inlineInfo.map((x) => <span className="noted" key={x.ci}>{x.node}</span>)}
          </>
        ),
      });
    });
    richCards.forEach((x) => items.push({ who: 'bot', key: `${m.id}-c${x.ci}`, node: x.node, rich: true }));
    if (m.answeredBy === 'bank_code') items.push({ who: 'bot', key: `${m.id}-bank`, node: <span className="bank-note">Quick answer from your account data · Abel’s AI is taking a short break</span> });
    if (m.errorInfo && debug) items.push({ who: 'bot', key: `${m.id}-err`, node: <span className="err-info">Technical detail: {m.errorInfo}</span> });
    const lastBot = [...items].reverse().find((it) => it.who === 'bot');
    // The answer stamp only under Abel's latest reply, so it isn't repeated down the whole chat.
    if (lastBot && m.id === latestAgentId) lastBot.after = usedLine(m);
    if (m.resolved && !m.resolved.startsWith('bought:')) items.push({ who: 'me', key: `${m.id}-r`, node: m.resolved });
  });

  const last = p.messages[p.messages.length - 1];
  const pills = !p.waiting && last && last.sender === 'agent' && !last.resolved && last.suggestions?.length ? last.suggestions : !p.messages.length ? h.chips.map((c) => c[1]) : null;
  const pillLabel = (s: string) => (!p.messages.length ? h.chips.find((c) => c[1] === s)?.[0] || s : s);

  return (
    <section className={`chat ${h.cls}`} role="dialog" aria-label={`Chat with ${h.name}`}>
      <header className="chat-h">
        <span className="bot-av lg" aria-hidden="true"><Icon name={h.icon} /></span>
        <div className="chat-t">
          <b>{h.name}</b>
          <span id="chat-status"><i className={`live-dot inline${listening ? ' rec' : ''}`} />{listening ? 'Listening… tap the mic to stop' : p.waiting ? 'typing…' : `${h.sub} · online`}</span>
        </div>
        <button className="chat-ic" onClick={p.onNew} aria-label="Start a new conversation" title="New conversation">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" /></svg>
        </button>
        <button className="chat-ic" onClick={p.onClose} aria-label="Close chat" title="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>
      <div className="chat-body" id="chat-body" ref={bodyRef} aria-live="polite">
        <div className="chat-date"><span>Today</span></div>
        {items.map((it, n) => {
          const prev = items[n - 1], next = items[n + 1];
          const first = !prev || prev.who !== it.who, lastG = !next || next.who !== it.who;
          const pop = seen.current.has(it.key) ? '' : ' pop';
          seen.current.add(it.key);
          if (it.who === 'me') return <div key={it.key} className={`mrow me${pop}${first ? ' gstart' : ''}`}>{it.after ? <div className="mcol me"><div className="bub">{it.node}</div>{it.after}</div> : <div className="bub">{it.node}</div>}</div>;
          return (
            <div key={it.key} className={`mrow bot${pop}${first ? ' gstart' : ''}${it.rich ? ' wide' : ''}`}>
              {lastG ? <BotAvatar /> : <span className="av-sp" />}
              <div className="mcol">
                {first && <span className="mname">Abel</span>}
                <div className={it.rich ? 'rich' : 'bub'}>{it.node}</div>
                {it.after}
              </div>
            </div>
          );
        })}
        {p.waiting && (
          <div className="mrow bot pop gstart"><BotAvatar /><div className="mcol"><div className="bub typing" aria-label="Abel is typing"><i /><i /><i /></div></div></div>
        )}
        {pills && (
          <div className={`qr pop${p.waiting ? ' busy' : ''}`}>
            {pills.map((s) => <button key={s} className="qr-b" onClick={() => send(s)}>{pillLabel(s)}</button>)}
          </div>
        )}
      </div>
      {attOpen && (
        <>
          <div className="att-bg" onClick={() => setAttOpen(false)} />
          <div className="att-sheet" role="dialog" aria-label="Add to chat">
            <span className="att-grab" aria-hidden="true" />
            <b className="att-title">Add to chat</b>
            <div className="att-grid">
              <button className="att-t" onClick={openCamera}><span className="att-c"><Icon name="camera" size={22} /></span>Take a photo</button>
              <button className="att-t" onClick={() => { setAttOpen(false); imgRef.current?.click(); }}><span className="att-c"><Icon name="image" size={22} /></span>Photos</button>
              <button className="att-t" onClick={() => { setAttOpen(false); docRef.current?.click(); }}><span className="att-c"><Icon name="file" size={22} /></span>PDF or file</button>
              <button className="att-t" onClick={() => { setAttOpen(false); p.onImport({ sample: true }); }}><span className="att-c"><Icon name="contact" size={22} /></span>Sample chat</button>
            </div>
            <button className="keep-row" role="switch" aria-checked={keepCopy} onClick={() => setKeepCopy(!keepCopy)}>
              <span className="keep-t"><b>Keep a copy</b><span>{keepCopy ? 'Saved in Your documents for 30 days. Delete it any time.' : 'Off: Abel reads the file once, then it’s gone.'}</span></span>
              <span className={`tgl${keepCopy ? ' on' : ''}`} aria-hidden="true"><i /></span>
            </button>
            <p className="att-note"><Icon name="shield" size={16} /><span>Abel suggests what to remember from it. Nothing is saved without your OK. Use fictional documents only.</span></p>
          </div>
        </>
      )}
      {camOpen && (
        <div className="cam" role="dialog" aria-label="Take a photo">
          <video ref={videoRef} playsInline muted />
          <div className="cam-bar">
            <button className="cam-x" onClick={stopCamera} aria-label="Cancel"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            <button className="cam-shot" onClick={snap} aria-label="Take photo"><i /></button>
            <span className="cam-x" aria-hidden="true" />
          </div>
        </div>
      )}
      <div className="chat-in">
        <button className="chat-plus" type="button" onClick={() => setAttOpen(!attOpen)} aria-label="Add a photo or file" aria-expanded={attOpen}>
          <Icon name="plus" />
        </button>
        <label className="sr" htmlFor="ai-q">Message {h.name}</label>
        <textarea
          id="ai-q"
          ref={boxRef}
          rows={1}
          placeholder="Message…"
          autoComplete="off"
          enterKeyHint="send"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Like WhatsApp: on a computer Enter sends and Shift+Enter starts a new line;
            // on a phone Enter starts a new line and the arrow button sends.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button className={`chat-mic${listening ? ' rec' : ''}`} type="button" onClick={toggleMic} aria-label={listening ? 'Stop listening' : 'Talk instead of typing'}>
          <Icon name="mic" />
        </button>
        <button className="chat-send" type="button" onClick={() => send(text)} disabled={p.waiting} aria-label="Send">
          <Icon name="send" />
        </button>
        <input type="file" ref={docRef} accept=".pdf,.md,.markdown,.txt,.csv,.xlsx,application/pdf,text/markdown,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendDoc(f); }} />
        <input type="file" ref={imgRef} accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendPhoto(f, f.name); }} />
        <input type="file" ref={camFallbackRef} accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendPhoto(f, 'Photo'); }} />
      </div>
      <p className="chat-foot">Concept · fictional data · nothing saved without your OK</p>
    </section>
  );
};
