import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SOUL, SEMANTIC, EPISODIC, BEGIN, CONTINUE, apiMd } from './templates.ts';

export type RunnerType = 'extern' | 'api' | 'claude';

export interface Agent {
  id: string;
  name: string;
  color: string;
  token: string;
  runner: RunnerType;
  baseUrl: string; // OpenAI-kompatibler Endpunkt (runner = api)
  apiKey: string;
  model: string;
  beginPrompt: string;
  continuePrompt: string;
  sessionMinutes: number; // Weltzeit, nach der der Kontext geleert wird
  // Lebenszyklus (fehlt bei älteren Agenten: dann erwachsen, ohne Eltern)
  age?: number; // gelebte Sekunden Weltzeit, wird regelmässig gespeichert
  lifeFactor?: number; // Streuung des Höchstalters (0.8 bis 1.2)
  parents?: { id: string; name: string }[];
  born?: string; // Datum der Geburt (nur Kinder)
  nextBirthAge?: number; // Abklingzeit nach einem Kind, überdauert einen Neustart
}

/** Welchen Runner bekommen Kinder? 'parent' = den eines Elternteils, sonst diesen. */
export interface Offspring {
  runner: 'parent' | RunnerType;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/** Summierter Tokenverbrauch eines Agenten über alle Sitzungen. */
export interface Usage {
  input: number; // neu gelesene Eingabe-Tokens
  cacheRead: number; // Eingabe aus dem Cache (deutlich günstiger)
  cacheWrite: number; // Eingabe, die in den Cache geschrieben wurde
  output: number;
  cost: number; // USD, soweit der Harness sie meldet
}

export interface LogEntry {
  wall: number;
  time: number;
  kind: 'text' | 'say' | 'tool' | 'result' | 'system' | 'error';
  text: string;
}

export const DATA_ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(import.meta.dirname, '..', 'data');
const ROOT = DATA_ROOT;
const FILE = path.join(ROOT, 'agents.json');
const WS = path.join(ROOT, 'workspaces');
const LOGS = path.join(ROOT, 'logs');
const USAGE = path.join(ROOT, 'usage.json');
const GRAVE = path.join(ROOT, 'graveyard');
const BIRTH_START = '<!-- geburt -->';
const BIRTH_END = '<!-- /geburt -->';

export class AgentStore {
  agents: Agent[] = [];
  private logs = new Map<string, LogEntry[]>();
  onLog: ((id: string, e: LogEntry) => void) | null = null;
  onUsage: ((id: string, u: Usage) => void) | null = null;
  private usage = new Map<string, Usage>();
  private usageTimer: NodeJS.Timeout | null = null;
  /** Meldet, was ein Agent gerade in eine seiner Dateien geschrieben hat. */
  onNote: ((id: string, path: string, text: string, isNew: boolean) => void) | null = null;
  private seen = new Map<string, Map<string, { mtime: number; content: string }>>();

  constructor(readonly baseUrl: string) {
    fs.mkdirSync(WS, { recursive: true });
    fs.mkdirSync(LOGS, { recursive: true });
    if (fs.existsSync(FILE)) this.agents = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    try { this.usage = new Map(Object.entries(JSON.parse(fs.readFileSync(USAGE, 'utf8')))); } catch { /* noch kein Verbrauch */ }
    for (const a of this.agents) this.ensureWorkspace(a);
  }

  private save() {
    fs.writeFileSync(FILE, JSON.stringify(this.agents, null, 2));
  }

  dir(a: Agent) {
    return path.join(WS, a.id);
  }

  private ensureWorkspace(a: Agent) {
    const d = this.dir(a);
    fs.mkdirSync(d, { recursive: true });
    const put = (name: string, content: string) => {
      const f = path.join(d, name);
      if (!fs.existsSync(f)) fs.writeFileSync(f, content);
    };
    put('SOUL.md', SOUL);
    put('SEMANTIC_MEMORY.md', SEMANTIC);
    put('EPISODIC_MEMORY.md', EPISODIC);
    put('EPISODIC_MEMORY.jsonl', '');
    // API.md enthält Token und Adresse und wird immer frisch geschrieben
    fs.writeFileSync(path.join(d, 'API.md'), apiMd(this.baseUrl, a.token));
    this.scanAgent(a, true);
  }

  /** Vergleicht die Dateien aller Agenten mit dem letzten Stand und meldet Neues. */
  scan() {
    for (const a of this.agents) {
      try { this.scanAgent(a, false); } catch { /* Datei mitten im Schreiben – nächste Runde */ }
    }
  }

  private scanAgent(a: Agent, silent: boolean) {
    let known = this.seen.get(a.id);
    if (!known) this.seen.set(a.id, (known = new Map()));
    for (const f of this.listFiles(a)) {
      if (f.path === 'API.md' || f.size > 300_000) continue;
      const old = known.get(f.path);
      if (old && old.mtime === f.mtime) continue;
      const content = fs.readFileSync(path.join(this.dir(a), f.path), 'utf8');
      known.set(f.path, { mtime: f.mtime, content });
      if (silent || content === old?.content) continue;
      const text = describeChange(old?.content, content, f.path);
      if (text) this.onNote?.(a.id, f.path, text, !old);
    }
  }

  create(input: Partial<Agent>): Agent {
    const name = (input.name || '').trim() || `Eko${this.agents.length + 1}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    let id = slug;
    // auch Ids aus dem Grab nicht wiederverwenden: Protokoll, Verbrauch und Familie hängen an der Id
    const used = (x: string) => this.agents.some((a) => a.id === x) || fs.existsSync(path.join(WS, x)) || fs.existsSync(path.join(GRAVE, x));
    for (let i = 2; used(id); i++) id = `${slug}-${i}`;
    const a: Agent = {
      id,
      name,
      color: input.color || '#b6e23a',
      token: crypto.randomBytes(18).toString('base64url'),
      runner: input.runner || 'extern',
      baseUrl: input.baseUrl || '',
      apiKey: input.apiKey || '',
      model: input.model || '',
      beginPrompt: input.beginPrompt || BEGIN,
      continuePrompt: input.continuePrompt || CONTINUE,
      sessionMinutes: input.sessionMinutes ?? 60,
      lifeFactor: input.lifeFactor ?? 0.8 + Math.random() * 0.4,
      ...(input.age !== undefined ? { age: input.age } : {}),
      ...(input.parents ? { parents: input.parents } : {}),
      ...(input.born ? { born: input.born } : {}),
    };
    this.agents.push(a);
    this.ensureWorkspace(a);
    this.save();
    return a;
  }

  /** Legt das Kind zweier Agenten an: Name und Farbe gemischt, SOUL.md aus beiden, Runner nach Welt-Einstellung. */
  createChild(pa: Agent, pb: Agent, offspring: Offspring): Agent {
    // Vorbild für den Runner: wer selbst einen hat, sonst zufällig
    const both = [pa, pb].sort(() => Math.random() - 0.5);
    const tpl = both.find((x) => x.runner !== 'extern') ?? both[0];
    const run = offspring.runner === 'parent'
      ? { runner: tpl.runner, baseUrl: tpl.baseUrl, apiKey: tpl.apiKey, model: tpl.model }
      : { runner: offspring.runner, baseUrl: offspring.baseUrl || '', apiKey: offspring.apiKey || '', model: offspring.model || '' };
    const name = this.childName(pa.name, pb.name);
    const child = this.create({
      name, color: mixColor(pa.color, pb.color), ...run,
      beginPrompt: tpl.beginPrompt, continuePrompt: tpl.continuePrompt, sessionMinutes: tpl.sessionMinutes,
      age: 0, parents: [{ id: pa.id, name: pa.name }, { id: pb.id, name: pb.name }], born: new Date().toISOString(),
    });
    const soul = (a: Agent) => { try { return this.readFile(a, 'SOUL.md'); } catch { return SOUL; } };
    this.writeFile(child, 'SOUL.md', inheritSoul(name, pa.name, soul(pa), pb.name, soul(pb)), true);
    return child;
  }

  /** Erste Hälfte des einen Namens, zweite des anderen; eindeutig unter den Lebenden. */
  private childName(a: string, b: string): string {
    const letters = (s: string) => s.replace(/[^A-Za-zÀ-ÿ]/g, '') || 'Eko';
    const x = letters(a), y = letters(b);
    let base = (x.slice(0, Math.ceil(x.length / 2)) + y.slice(Math.floor(y.length / 2))).toLowerCase();
    if (base.length < 3) base += 'o';
    base = base[0].toUpperCase() + base.slice(1);
    const taken = new Set(this.agents.map((g) => g.name.toLowerCase()));
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}${i}`;
    return name;
  }

  /** Tod: aus der Liste nehmen, Arbeitsordner nach data/graveyard/ verschieben. */
  bury(id: string, info: Record<string, unknown>) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return;
    this.remove(id);
    this.seen.delete(id);
    const from = this.dir(a);
    fs.mkdirSync(GRAVE, { recursive: true });
    let to = path.join(GRAVE, a.id);
    for (let i = 2; fs.existsSync(to); i++) to = path.join(GRAVE, `${a.id}-${i}`);
    const record = { id: a.id, name: a.name, color: a.color, parents: a.parents ?? [], born: a.born ?? null, died: new Date().toISOString(), ...info };
    // Unter Windows hält ein eben beendeter Claude-Code-Prozess den Ordner noch kurz fest
    const attempt = (n: number) => {
      try {
        fs.renameSync(from, to);
        fs.writeFileSync(path.join(to, 'GRAB.json'), JSON.stringify(record, null, 2));
        fs.rmSync(path.join(to, 'API.md'), { force: true }); // enthält das alte Token
      } catch (e: any) {
        if (n < 30 && fs.existsSync(from)) setTimeout(() => attempt(n + 1), 1000);
        else console.error(`Arbeitsordner von ${a.name} liess sich nicht ins Grab verschieben: ${e?.message || e}`);
      }
    };
    attempt(0);
  }

  /** Übernimmt das Alter aus der Welt und speichert, wenn sich etwas getan hat. */
  setAges(ages: Record<string, { age: number; nextBirthAge: number }>) {
    let changed = false;
    for (const a of this.agents) {
      const v = ages[a.id];
      if (!v) continue;
      if (Math.abs((a.age ?? -1e9) - v.age) >= 1) { a.age = Math.round(v.age * 10) / 10; changed = true; }
      if (v.nextBirthAge > 0 && a.nextBirthAge !== v.nextBirthAge) { a.nextBirthAge = Math.round(v.nextBirthAge); changed = true; }
    }
    if (changed) this.save();
  }

  update(id: string, patch: Partial<Agent>): Agent {
    const a = this.get(id);
    const allowed: (keyof Agent)[] = ['name', 'color', 'runner', 'baseUrl', 'apiKey', 'model', 'beginPrompt', 'continuePrompt', 'sessionMinutes'];
    for (const k of allowed) if (patch[k] !== undefined) (a as any)[k] = patch[k];
    this.save();
    return a;
  }

  /** Entfernt den Agenten aus der Liste. Der Arbeitsordner bleibt auf der Platte liegen. */
  remove(id: string) {
    this.agents = this.agents.filter((a) => a.id !== id);
    this.save();
  }

  get(id: string): Agent {
    const a = this.agents.find((x) => x.id === id);
    if (!a) throw new Error('Agent nicht gefunden');
    return a;
  }

  byToken(token: string | undefined): Agent | undefined {
    return token ? this.agents.find((a) => a.token === token) : undefined;
  }

  // ---------- Dateien ----------

  private safe(a: Agent, rel: string): string {
    const root = this.dir(a);
    const f = path.resolve(root, rel);
    if (f !== root && !f.startsWith(root + path.sep)) throw new Error('Pfad liegt ausserhalb des Arbeitsordners');
    return f;
  }

  listFiles(a: Agent): { path: string; size: number; mtime: number }[] {
    const root = this.dir(a);
    const out: { path: string; size: number; mtime: number }[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else {
          const st = fs.statSync(f);
          out.push({ path: path.relative(root, f), size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    walk(root);
    return out.sort((x, y) => x.path.localeCompare(y.path));
  }

  readFile(a: Agent, rel: string): string {
    const f = this.safe(a, rel);
    if (fs.statSync(f).size > 2_000_000) throw new Error('Datei ist zu gross zum Anzeigen');
    return fs.readFileSync(f, 'utf8');
  }

  /** silent = Änderung stammt von dir aus der Weboberfläche und soll keine Notiz-Meldung auslösen. */
  writeFile(a: Agent, rel: string, content: string, silent = false) {
    const f = this.safe(a, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
    if (silent) this.seen.get(a.id)?.set(path.relative(this.dir(a), f), { mtime: fs.statSync(f).mtimeMs, content });
  }

  appendFile(a: Agent, rel: string, content: string) {
    const f = this.safe(a, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, content.endsWith('\n') ? content : content + '\n');
  }

  // ---------- Verbrauch ----------

  getUsage(id: string): Usage | null {
    return this.usage.get(id) || null;
  }

  addUsage(id: string, d: Partial<Usage>) {
    const u = this.usage.get(id) || { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 };
    for (const k of Object.keys(u) as (keyof Usage)[]) u[k] = Math.max(0, u[k] + (Number(d[k]) || 0));
    this.usage.set(id, u);
    this.onUsage?.(id, u);
    this.usageTimer ??= setTimeout(() => { this.usageTimer = null; this.saveUsage(); }, 2000);
  }

  saveUsage() {
    fs.writeFileSync(USAGE, JSON.stringify(Object.fromEntries(this.usage), null, 2));
  }

  // ---------- Protokoll ----------

  log(id: string, time: number, kind: LogEntry['kind'], text: string) {
    const e: LogEntry = { wall: Date.now(), time: Math.round(time * 10) / 10, kind, text: text.length > 6000 ? text.slice(0, 6000) + ' …' : text };
    let l = this.logs.get(id);
    if (!l) this.logs.set(id, (l = []));
    l.push(e);
    if (l.length > 600) l.splice(0, l.length - 600);
    fs.appendFile(path.join(LOGS, `${id}.jsonl`), JSON.stringify(e) + '\n', () => {});
    this.onLog?.(id, e);
  }

  getLog(id: string): LogEntry[] {
    return this.logs.get(id) || [];
  }
}

/** Mittel der beiden Farben, leicht verschoben, damit Geschwister sich unterscheiden. */
function mixColor(a: string, b: string): string {
  const rgb = (c: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    const n = m ? parseInt(m[1], 16) : 0xb6e23a;
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.max(0, Math.min(255, Math.round((v + y[i]) / 2 + (Math.random() - 0.5) * 40))).toString(16).padStart(2, '0')).join('');
}

/**
 * SOUL.md des Kindes: Absätze beider Eltern, an jeder Stelle zufällig vom einen oder anderen
 * (wie beim Erbgut), davor ein kurzer Geburtsabschnitt. Der Abschnitt der Eltern wird nicht weitervererbt,
 * damit die Datei über Generationen nicht wächst.
 */
function inheritSoul(child: string, na: string, sa: string, nb: string, sb: string): string {
  const paras = (s: string) => s
    .replace(new RegExp(`${BIRTH_START}[\\s\\S]*?${BIRTH_END}`, 'g'), '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^# .*(\n|$)/, '').trim())
    .filter(Boolean);
  const A = paras(sa), B = paras(sb);
  const out: string[] = [];
  for (let i = 0; i < Math.max(A.length, B.length) && out.length < 14; i++) {
    const pick = A[i] !== undefined && B[i] !== undefined ? (Math.random() < 0.5 ? A[i] : B[i]) : Math.random() < 0.6 ? A[i] ?? B[i] : undefined;
    if (pick && !out.includes(pick)) out.push(pick);
  }
  return `# SOUL.md – Wer du bist

${BIRTH_START}
Du bist ${child}, das Kind von ${na} und ${nb}. Du wurdest auf dieser Insel geboren und bist noch klein;
was du kannst, lernst du erst. Was hier steht, hast du von deinen Eltern. Es ist ein Anfang, kein Gesetz.
${BIRTH_END}

${out.join('\n\n')}
`;
}

/** Was ist neu? Angehängter Text, sonst die Zeilen, die es vorher nicht gab. */
function describeChange(old: string | undefined, now: string, file: string): string {
  let added: string;
  if (old === undefined) added = now;
  else if (now.startsWith(old)) added = now.slice(old.length);
  else {
    const had = new Set(old.split('\n'));
    added = now.split('\n').filter((l) => l.trim() && !had.has(l)).join('\n');
    if (!added.trim()) return '(Zeilen entfernt)';
  }
  added = added.trim();
  if (file.endsWith('.jsonl')) {
    added = added.split('\n').map((l) => {
      try {
        const e = JSON.parse(l);
        if (e && typeof e === 'object' && e.summary) return [e.summary, typeof e.detail === 'string' ? e.detail : ''].filter(Boolean).join('\n');
      } catch { /* keine JSON-Zeile */ }
      return l;
    }).join('\n\n');
  }
  return added.length > 900 ? added.slice(0, 900) + ' …' : added;
}
