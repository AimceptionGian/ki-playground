import { useCallback, useEffect, useRef, useState } from 'react';
import { Scene, type Snap } from './scene';
import { AgentPanel } from './AgentPanel';
import { playVoice, hushVoice } from './voice';
import { Bubbles, Notes, type Note } from './Overlays';

export interface AgentInfo {
  id: string; name: string; color: string; token: string;
  runner: 'extern' | 'api' | 'claude';
  baseUrl: string; model: string; hasKey: boolean;
  beginPrompt: string; continuePrompt: string; sessionMinutes: number;
  running: boolean;
  usage: Usage | null;
  parents?: { id: string; name: string }[];
}
const STAGE_LABEL: Record<string, string> = { child: 'Kind', adult: 'erwachsen', old: 'alt' };
const OFFSPRING_LABEL: Record<string, string> = { parent: 'wie die Eltern', extern: 'ohne Runner (extern)', api: 'eigener Endpunkt (per API)', claude: 'Claude Code' };
export interface Usage { input: number; cacheRead: number; cacheWrite: number; output: number; cost: number }
export interface LogEntry { wall: number; time: number; kind: string; text: string }

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

// Hunger, Durst, Langeweile: hoch = schlecht. Freude, Gesundheit, Energie: hoch = gut.
const NEED_BARS: { label: string; bad: boolean; color: string }[] = [
  { label: 'Hunger', bad: true, color: '#e0a03a' },
  { label: 'Durst', bad: true, color: '#4aa3df' },
  { label: 'Langeweile', bad: true, color: '#a58bd6' },
  { label: 'Freude', bad: false, color: '#f4d35e' },
  { label: 'Gesundheit', bad: false, color: '#6fd08c' },
  { label: 'Energie', bad: false, color: '#5ad1c8' },
];
function NeedBars({ n }: { n: number[] }) {
  return (
    <span className="needs">
      {NEED_BARS.map((d, i) => (
        <span key={d.label} className="need" title={`${d.label}: ${Math.round(n[i] * 100)} %`}>
          <i style={{ width: `${Math.round(n[i] * 100)}%`, background: d.bad && n[i] >= 0.8 ? '#e5534b' : d.color }} />
        </span>
      ))}
    </span>
  );
}

export const RUNNER_LABEL = { extern: 'Extern (API / MCP)', api: 'Modell über Endpunkt', claude: 'Claude Code' } as const;
const STATE_LABEL: Record<string, string> = { wait: 'wartet', think: 'überlegt', away: 'abwesend' };
const STATE_TIP: Record<string, string> = {
  wait: 'Steht in einem Wait – bereit, dass die Zeit weiterläuft',
  think: 'Überlegt – die Welt wartet auf diesen Agenten',
  away: 'Hat sich zu lange nicht gerührt – die Welt wartet nicht mehr auf ihn',
};
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const COLORS = ['#b6e23a', '#ff8a5c', '#5cc8ff', '#f4d35e', '#d78bff', '#ff6f91'];

const short = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n));
const full = (n: number) => n.toLocaleString('de-CH');

function UsageLine({ u }: { u: Usage }) {
  const read = u.input + u.cacheRead + u.cacheWrite;
  const tip = [
    `neu: ${full(u.input + u.cacheWrite)} Tokens – erstmals vom Modell gelesen`,
    `  davon in den Cache geschrieben: ${full(u.cacheWrite)}`,
    `Cache: ${full(u.cacheRead)} Tokens – bereits bekannter Kontext, bei jeder Anfrage erneut mitgeschickt (rund ein Zehntel des Preises)`,
    `aus: ${full(u.output)} Tokens – vom Modell geschrieben`,
    `Summe gelesen: ${full(read)} Tokens`,
    u.cost > 0 ? `Kosten laut Claude Code: ${u.cost.toFixed(2)} USD (abgeschlossene Läufe)` : '',
  ].filter(Boolean).join('\n');
  return <small className="usage" title={tip}>{short(u.input + u.cacheWrite)} neu · {short(u.cacheRead)} Cache · {short(u.output)} aus</small>;
}

function clock(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [meta, setMeta] = useState({ time: 0, paused: true, speed: 1, resetIn: null as number | null, hold: [] as string[], states: {} as Record<string, string | null>, intents: {} as Record<string, string>, needs: {} as Record<string, number[]>, life: {} as Record<string, { g: string; ag: number }> });
  const [lockstep, setLockstep] = useState(false);
  const [hardness, setHardness] = useState(1);
  const [lifespan, setLifespan] = useState(120);
  const [offspring, setOffspring] = useState('parent');
  const [info, setInfo] = useState('');
  const [hearRange, setHearRange] = useState(30);
  const [resetMin, setResetMin] = useState(60);
  const [rockShape, setRockShape] = useState('block');
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [adding, setAdding] = useState(false);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const logSubs = useRef(new Set<(id: string, e: LogEntry) => void>());
  const noteSubs = useRef(new Set<(n: Note) => void>());

  const load = useCallback(async () => {
    const s = await api('/api/state');
    setAgents(s.agents);
    setBaseUrl(s.baseUrl);
    setResetMin(s.world.resetIntervalMin);
    setRockShape(s.world.rockShape);
    setLockstep(!!s.world.lockstep);
    setHearRange(s.world.hearRange ?? 30);
    setHardness(s.world.hardness ?? 1);
    setLifespan(s.world.lifespanMin ?? 120);
    setOffspring(s.world.offspring?.runner ?? 'parent');
    scene.current?.setStatics(s.statics);
  }, []);

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try { setError(''); await fn(); } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    scene.current = new Scene(host.current!);
    load().catch((e) => setError(e.message));
    let ws: WebSocket | null = null;
    let closed = false;
    let lastKey = '';
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => { setOnline(true); load().catch(() => {}); };
      ws.onclose = () => { setOnline(false); if (!closed) setTimeout(connect, 1000); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'snap') {
          scene.current?.apply(m as Snap);
          const states: Record<string, string | null> = {};
          const intents: Record<string, string> = {};
          const needs: Record<string, number[]> = {};
          const life: Record<string, { g: string; ag: number }> = {};
          for (const a of m.agents) { states[a.id] = a.st ?? null; if (a.in) intents[a.id] = a.in; if (a.n) needs[a.id] = a.n; if (a.g) life[a.id] = { g: a.g, ag: a.ag ?? 0 }; }
          const key = `${Math.floor(m.time)}|${m.paused}|${m.speed}|${m.resetIn}|${(m.hold || []).join()}|${JSON.stringify(states)}|${JSON.stringify(intents)}|${JSON.stringify(life)}`;
          if (key !== lastKey) { lastKey = key; setMeta({ time: m.time, paused: m.paused, speed: m.speed, resetIn: m.resetIn, hold: m.hold || [], states, intents, needs, life }); }
        } else if (m.t === 'agents') load().catch(() => {});
        else if (m.t === 'death') { setInfo(`✝ ${m.name} ist gestorben (${m.cause}, ${Math.round(m.age_min)} min alt)`); setTimeout(() => setInfo(''), 8000); }
        else if (m.t === 'voice') playVoice(scene.current, m.id, m.url, m.rate, m.seq);
        else if (m.t === 'hush') hushVoice(m.id, m.seq);
        else if (m.t === 'log') logSubs.current.forEach((f) => f(m.id, m.entry));
        else if (m.t === 'usage') setAgents((list) => list.map((a) => (a.id === m.id ? { ...a, usage: m.usage } : a)));
        else if (m.t === 'note') noteSubs.current.forEach((f) => f(m));
      };
    };
    connect();
    return () => { closed = true; ws?.close(); scene.current?.dispose(); scene.current = null; };
  }, [load]);

  useEffect(() => { if (scene.current) scene.current.follow = follow ? selected : null; }, [follow, selected]);

  const control = (body: object) => guard(() => api('/api/control', 'POST', body));
  const sel = agents.find((a) => a.id === selected) || null;
  const fresh = meta.time === 0 && meta.paused;

  return (
    <div className="app">
      <div className="stage" ref={host} />

      <Bubbles scene={scene} agents={agents} logSubs={logSubs.current} />
      <Notes agents={agents} noteSubs={noteSubs.current} onOpen={setSelected} />

      <header className="title">
        <span>SIMULATION</span>
        <span className="dim"> · {!online ? 'KEINE VERBINDUNG' : fresh ? 'BEREIT' : meta.paused ? 'PAUSIERT' : meta.hold.length ? `STEHT · ${meta.hold.join(', ').toUpperCase()} ÜBERLEGT` : `LÄUFT ${meta.speed}×`}</span>
      </header>

      <aside className="panel left">
        <div className="panel-head">
          <h2>Agenten</h2>
          <button className="ghost" onClick={() => setAdding((v) => !v)}>{adding ? 'Abbrechen' : '+ Neu'}</button>
        </div>
        {adding && <NewAgent count={agents.length} onDone={(id) => { setAdding(false); if (id) setSelected(id); }} onError={setError} />}
        {agents.length === 0 && !adding && <p className="hint">Noch niemand auf der Insel. Leg einen Agenten an, bearbeite seine Dateien und starte dann die Simulation.</p>}
        <ul className="agents">
          {agents.map((a) => (
            <li key={a.id} className={a.id === selected ? 'on' : ''} onClick={() => setSelected(a.id === selected ? null : a.id)}>
              <i style={{ background: a.color }} />
              <div>
                <b>{a.name}</b>
                <small>{RUNNER_LABEL[a.runner]}{a.model ? ` · ${a.model}` : ''}</small>
                {meta.life[a.id] && (
                  <small className="life" title={a.parents?.length ? `Kind von ${a.parents.map((p) => p.name).join(' und ')}` : 'Gründer der Insel'}>
                    {STAGE_LABEL[meta.life[a.id].g]} · {meta.life[a.id].ag} min{a.parents?.length ? ` · von ${a.parents.map((p) => p.name).join(' & ')}` : ''}
                  </small>
                )}
                {meta.intents[a.id] && <small className="intent" title="Plan, den der Körper gerade abarbeitet">→ {meta.intents[a.id]}</small>}
                {meta.needs[a.id] && <NeedBars n={meta.needs[a.id]} />}
                {a.usage && <UsageLine u={a.usage} />}
              </div>
              {meta.states[a.id] && !meta.paused
                ? <em className={meta.states[a.id]!} title={STATE_TIP[meta.states[a.id]!]}>{STATE_LABEL[meta.states[a.id]!]}</em>
                : a.runner !== 'extern' && <em className={a.running ? 'live' : ''}>{a.running ? 'aktiv' : 'aus'}</em>}
            </li>
          ))}
        </ul>
        {sel && (
          <label className="check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Kamera folgt {sel.name}
          </label>
        )}
      </aside>

      {sel && <AgentPanel key={sel.id} agent={sel} baseUrl={baseUrl} logSubs={logSubs.current} onClose={() => setSelected(null)} onError={setError} />}

      <footer className="bar">
        <button className="primary" onClick={() => control({ paused: !meta.paused })}>
          {fresh ? '▶ Start' : meta.paused ? '▶ Weiter' : '❚❚ Pause'}
        </button>
        <div className="seg" role="group" aria-label="Tempo">
          {SPEEDS.map((s) => (
            <button key={s} className={meta.speed === s ? 'on' : ''} onClick={() => control({ speed: s })}>{s}×</button>
          ))}
        </div>
        <div className="time">
          <b>{clock(meta.time)}</b>
          <small>Weltzeit</small>
        </div>
        <div className="time">
          <b>{meta.resetIn === null ? '—' : clock(meta.resetIn)}</b>
          <small>bis Welt-Reset</small>
        </div>
        <label className="num">
          <input type="number" min={0} value={resetMin} onChange={(e) => setResetMin(Number(e.target.value))} onBlur={() => control({ resetIntervalMin: resetMin })} />
          <small>Reset alle … min (0 = nie)</small>
        </label>
        <label className="num">
          <input type="number" min={0} value={hearRange} onChange={(e) => setHearRange(Number(e.target.value))} onBlur={() => control({ hearRange })} />
          <small>Hörweite (0 = überall)</small>
        </label>
        <label className="num">
          <select value={lockstep ? '1' : '0'} onChange={(e) => { setLockstep(e.target.value === '1'); control({ lockstep: e.target.value === '1' }); }}>
            <option value="0">Echtzeit</option>
            <option value="1">Wenn alle warten</option>
          </select>
          <small>Zeit läuft</small>
        </label>
        <label className="num">
          <select value={rockShape} onChange={(e) => { setRockShape(e.target.value); control({ rockShape: e.target.value }); }}>
            <option value="block">Block</option>
            <option value="ball">Kugel, rollt</option>
          </select>
          <small>Form des Felsens</small>
        </label>
        <label className="num">
          <input type="number" min={0.1} max={5} step={0.1} value={hardness} onChange={(e) => setHardness(Number(e.target.value))} onBlur={() => control({ hardness })} />
          <small>Härte (1 = normal)</small>
        </label>
        <label className="num">
          <input type="number" min={10} value={lifespan} onChange={(e) => setLifespan(Number(e.target.value))} onBlur={async () => {
            const s = await api('/api/state').catch(() => null);
            const before = s?.world.lifespanMin ?? lifespan;
            if (lifespan === before) return;
            // kürzer heisst: wer schon älter ist, stirbt sofort, und das lässt sich nicht rückgängig machen
            if (lifespan < before && !confirm(`Lebensdauer von ${before} auf ${lifespan} min senken? Wer schon älter ist als sein neues Höchstalter, stirbt sofort.`)) { setLifespan(before); return; }
            control({ lifespanMin: lifespan });
          }} />
          <small>Lebensdauer min (±20 %)</small>
        </label>
        <label className="num">
          <select value={offspring} onChange={(e) => { setOffspring(e.target.value); control({ offspring: { runner: e.target.value } }); }}>
            {Object.entries(OFFSPRING_LABEL).filter(([k]) => k !== 'api' || offspring === 'api').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <small>Runner der Kinder</small>
        </label>
        <button className="ghost" onClick={() => confirm('Welt jetzt zurücksetzen? Objekte und Körper gehen auf Anfang, die Dateien der Agenten bleiben.') && guard(() => api('/api/reset', 'POST'))}>Welt zurücksetzen</button>
      </footer>

      {error && <div className="toast" onClick={() => setError('')}>{error}</div>}
      {info && !error && <div className="toast info" onClick={() => setInfo('')}>{info}</div>}
    </div>
  );
}

function NewAgent({ count, onDone, onError }: { count: number; onDone: (id?: string) => void; onError: (m: string) => void }) {
  const [name, setName] = useState(`Eko${count + 1}`);
  const [color, setColor] = useState(COLORS[count % COLORS.length]);
  const [runner, setRunner] = useState<AgentInfo['runner']>('claude');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const a = await api('/api/agents', 'POST', { name, color, runner, baseUrl, apiKey, model });
      onDone(a.id);
    } catch (err: any) { onError(err.message); }
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label className="grow">Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Farbe<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      </div>
      <RunnerFields {...{ runner, setRunner, baseUrl, setBaseUrl, apiKey, setApiKey, model, setModel }} />
      <button className="primary" type="submit">Anlegen</button>
    </form>
  );
}

export function RunnerFields(p: {
  runner: AgentInfo['runner']; setRunner: (r: AgentInfo['runner']) => void;
  baseUrl: string; setBaseUrl: (s: string) => void;
  apiKey: string; setApiKey: (s: string) => void; keyHint?: string;
  model: string; setModel: (s: string) => void;
}) {
  return (
    <>
      <label>Gesteuert von
        <select value={p.runner} onChange={(e) => p.setRunner(e.target.value as AgentInfo['runner'])}>
          <option value="claude">Claude Code (dein Harness, headless)</option>
          <option value="api">Modell über Endpunkt und Token</option>
          <option value="extern">Extern – verbindet sich selbst per API oder MCP</option>
        </select>
      </label>
      {p.runner === 'api' && (
        <>
          <label>Endpunkt (OpenAI-kompatibel)<input value={p.baseUrl} onChange={(e) => p.setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" /></label>
          <label>Token<input type="password" value={p.apiKey} onChange={(e) => p.setApiKey(e.target.value)} placeholder={p.keyHint || 'leer lassen, falls keiner nötig ist'} autoComplete="off" /></label>
        </>
      )}
      {p.runner !== 'extern' && (
        <label>Modell<input value={p.model} onChange={(e) => p.setModel(e.target.value)} placeholder={p.runner === 'claude' ? 'leer = Standard, z. B. sonnet' : 'z. B. llama3.3'} /></label>
      )}
    </>
  );
}
