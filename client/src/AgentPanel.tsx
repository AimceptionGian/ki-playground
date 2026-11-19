import { useEffect, useRef, useState } from 'react';
import { api, RunnerFields, type AgentInfo, type LogEntry } from './App';

type Tab = 'files' | 'log' | 'settings' | 'connect';
interface Props {
  agent: AgentInfo;
  baseUrl: string;
  logSubs: Set<(id: string, e: LogEntry) => void>;
  onClose: () => void;
  onError: (m: string) => void;
}

// Position des Panels: null = rechts angedockt. Gilt für alle Agenten und bleibt über Neuladen erhalten.
type Pos = { x: number; y: number } | null;
const POS_KEY = 'agentPanelPos';
function loadPos(): Pos {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { return null; }
}
function savePos(p: Pos) {
  try { p ? localStorage.setItem(POS_KEY, JSON.stringify(p)) : localStorage.removeItem(POS_KEY); } catch { /* privater Modus */ }
}

export function AgentPanel({ agent, baseUrl, logSubs, onClose, onError }: Props) {
  const [tab, setTab] = useState<Tab>('files');
  const [pos, setPos] = useState<Pos>(loadPos);
  const [dragging, setDragging] = useState(false);
  const el = useRef<HTMLElement>(null);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || !el.current) return;
    const r = el.current.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let last: Pos = null;
    const move = (ev: PointerEvent) => {
      last = {
        x: Math.max(8 - r.width + 120, Math.min(innerWidth - 120, ev.clientX - dx)),
        y: Math.max(8, Math.min(innerHeight - 48, ev.clientY - dy)),
      };
      setPos(last);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      setDragging(false);
      if (last) savePos(last);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    setDragging(true);
    e.preventDefault();
  };
  const dock = () => { setPos(null); savePos(null); };
  const toggle = async () => {
    try { await api(`/api/agents/${agent.id}/run`, 'POST', { on: !agent.running }); } catch (e: any) { onError(e.message); }
  };
  return (
    <aside ref={el} className={`panel right${pos ? ' floating' : ''}${dragging ? ' dragging' : ''}`} style={pos ? { left: pos.x, top: pos.y } : undefined}>
      <div className="panel-head grip" onPointerDown={startDrag} onDoubleClick={dock} title="Ziehen zum Verschieben, Doppelklick dockt wieder rechts an">
        <h2><i style={{ background: agent.color }} />{agent.name}</h2>
        <div className="row">
          {agent.runner !== 'extern' && (
            <button className={agent.running ? 'ghost' : 'primary'} onClick={toggle}>{agent.running ? 'Agent stoppen' : 'Agent starten'}</button>
          )}
          {pos && <button className="ghost" onClick={dock} title="Wieder rechts andocken">⇥</button>}
          <button className="ghost" onClick={onClose} aria-label="Schliessen">✕</button>
        </div>
      </div>
      <nav className="tabs">
        {([['files', 'Dateien'], ['log', 'Protokoll'], ['settings', 'Einstellungen'], ['connect', 'Verbindung']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {tab === 'files' && <Files agent={agent} onError={onError} />}
      {tab === 'log' && <Log agent={agent} logSubs={logSubs} />}
      {tab === 'settings' && <Settings agent={agent} onClose={onClose} onError={onError} />}
      {tab === 'connect' && <Connect agent={agent} baseUrl={baseUrl} />}
    </aside>
  );
}

function Files({ agent, onError }: { agent: AgentInfo; onError: (m: string) => void }) {
  const [files, setFiles] = useState<{ path: string; size: number; mtime: number }[]>([]);
  const [path, setPath] = useState('SOUL.md');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState<string | null>(null); // null = keine ungespeicherte Änderung
  const [raw, setRaw] = useState(false);
  const dirty = useRef(false);
  dirty.current = draft !== null;

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const list = await api(`/api/agents/${agent.id}/files`);
        if (stop) return;
        setFiles(list);
        if (!dirty.current && list.some((f: any) => f.path === path)) {
          const f = await api(`/api/agents/${agent.id}/file?path=${encodeURIComponent(path)}`);
          if (!stop && !dirty.current) setContent(f.content);
        }
      } catch { /* Server kurz weg – nächster Versuch folgt */ }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(iv); };
  }, [agent.id, path]);

  const open = (p: string) => {
    if (draft !== null && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    setDraft(null); setContent(''); setRaw(false); setPath(p);
  };
  const save = async () => {
    try {
      await api(`/api/agents/${agent.id}/file`, 'PUT', { path, content: draft });
      setContent(draft!); setDraft(null);
    } catch (e: any) { onError(e.message); }
  };
  const pretty = path.endsWith('.jsonl') && !raw && draft === null;

  return (
    <div className="files">
      <ul className="filelist">
        {files.map((f) => (
          <li key={f.path} className={f.path === path ? 'on' : ''} onClick={() => open(f.path)}>
            <span>{f.path}</span>
            <small>{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} kB`}</small>
          </li>
        ))}
      </ul>
      <div className="file-head">
        <code>{path}</code>
        <div className="row">
          {path.endsWith('.jsonl') && draft === null && <button className="ghost" onClick={() => setRaw((v) => !v)}>{raw ? 'Als Tagebuch' : 'Roh bearbeiten'}</button>}
          {draft !== null && <button className="ghost" onClick={() => setDraft(null)}>Verwerfen</button>}
          <button className="primary" disabled={draft === null} onClick={save}>Speichern</button>
        </div>
      </div>
      {pretty ? <Diary text={content} /> : (
        <textarea spellCheck={false} value={draft ?? content} onChange={(e) => setDraft(e.target.value)} />
      )}
    </div>
  );
}

function Diary({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return <p className="hint pad">Noch keine Einträge. Das Tagebuch füllt sich, sobald der Agent etwas erlebt und aufschreibt.</p>;
  return (
    <div className="diary">
      {lines.map((l, i) => {
        let e: any = null;
        try { e = JSON.parse(l); } catch { /* keine gültige Zeile – roh zeigen */ }
        if (!e || typeof e !== 'object') return <pre key={i}>{l}</pre>;
        const { timestamp, summary, detail, ...rest } = e;
        return (
          <article key={i}>
            <small>{String(timestamp ?? `#${i + 1}`)}</small>
            <b>{String(summary ?? '')}</b>
            {detail !== undefined && <p>{typeof detail === 'string' ? detail : JSON.stringify(detail)}</p>}
            {Object.keys(rest).length > 0 && <pre>{JSON.stringify(rest)}</pre>}
          </article>
        );
      }).reverse()}
    </div>
  );
}

function Log({ agent, logSubs }: { agent: AgentInfo; logSubs: Set<(id: string, e: LogEntry) => void> }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    api(`/api/agents/${agent.id}/log`).then(setLog).catch(() => {});
    const sub = (id: string, e: LogEntry) => { if (id === agent.id) setLog((l) => [...l.slice(-599), e]); };
    logSubs.add(sub);
    return () => { logSubs.delete(sub); };
  }, [agent.id, logSubs]);
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [log]);
  return (
    <div className="log" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {log.length === 0 && <p className="hint pad">Noch nichts passiert. Hier erscheinen Gedanken, Aktionen und Ergebnisse des Agenten.</p>}
      {log.map((e, i) => (
        <div key={i} className={`entry ${e.kind}`}>
          <small>{Math.floor(e.time / 60)}:{String(Math.floor(e.time % 60)).padStart(2, '0')}</small>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

function Settings({ agent, onClose, onError }: { agent: AgentInfo; onClose: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(agent.name);
  const [color, setColor] = useState(agent.color);
  const [runner, setRunner] = useState(agent.runner);
  const [baseUrl, setBaseUrl] = useState(agent.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(agent.model);
  const [beginPrompt, setBegin] = useState(agent.beginPrompt);
  const [continuePrompt, setCont] = useState(agent.continuePrompt);
  const [sessionMinutes, setSession] = useState(agent.sessionMinutes);
  const [saved, setSaved] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/agents/${agent.id}`, 'PATCH', { name, color, runner, baseUrl, model, beginPrompt, continuePrompt, sessionMinutes, ...(apiKey ? { apiKey } : {}) });
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (err: any) { onError(err.message); }
  };
  const remove = async () => {
    if (!confirm(`${agent.name} von der Insel nehmen? Der Arbeitsordner bleibt unter data/workspaces/${agent.id} liegen.`)) return;
    try { await api(`/api/agents/${agent.id}`, 'DELETE'); onClose(); } catch (err: any) { onError(err.message); }
  };
  return (
    <form className="form scroll" onSubmit={save}>
      {agent.running && <p className="hint">Der Agent läuft. Änderungen an Modell und Prompts gelten ab dem nächsten Start.</p>}
      <div className="row">
        <label className="grow">Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Farbe<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      </div>
      <RunnerFields {...{ runner, setRunner, baseUrl, setBaseUrl, apiKey, setApiKey, model, setModel }} keyHint={agent.hasKey ? 'gespeichert – nur ausfüllen, um ihn zu ersetzen' : undefined} />
      <label>Erste Nachricht jeder Sitzung<textarea rows={2} value={beginPrompt} onChange={(e) => setBegin(e.target.value)} /></label>
      <label>Nachricht, wenn das Modell stehen bleibt<textarea rows={2} value={continuePrompt} onChange={(e) => setCont(e.target.value)} /></label>
      <label>Kontext leeren nach … Minuten Weltzeit<input type="number" min={1} value={sessionMinutes} onChange={(e) => setSession(Number(e.target.value))} /></label>
      <p className="hint">Wer der Agent ist, steht in <code>SOUL.md</code> im Reiter Dateien.</p>
      <div className="row spread">
        <button className="primary" type="submit">{saved ? 'Gespeichert' : 'Speichern'}</button>
        <button className="danger" type="button" onClick={remove}>Agent entfernen</button>
      </div>
    </form>
  );
}

function Connect({ agent, baseUrl }: { agent: AgentInfo; baseUrl: string }) {
  const curl = `curl -s ${baseUrl}/api/agent/observe -H "Authorization: Bearer ${agent.token}"`;
  const mcp = `claude mcp add --transport http insel-${agent.id} ${baseUrl}/mcp --header "Authorization: Bearer ${agent.token}"`;
  return (
    <div className="form scroll">
      <p className="hint">Jede KI, die HTTP oder MCP spricht, kann diesen Körper steuern. Die vollständige Beschreibung steht in <code>API.md</code> im Reiter Dateien.</p>
      <Copy label="Token" text={agent.token} />
      <Copy label="HTTP – beobachten" text={curl} />
      <Copy label="MCP – in Claude Code einbinden" text={mcp} />
      <Copy label="MCP-Adresse (Streamable HTTP)" text={`${baseUrl}/mcp`} />
    </div>
  );
}

function Copy({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <label>{label}
      <div className="copy">
        <code>{text}</code>
        <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}>{done ? 'Kopiert' : 'Kopieren'}</button>
      </div>
    </label>
  );
}
