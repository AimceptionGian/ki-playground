import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { World, STATICS } from './world.ts';
import { AgentStore, DATA_ROOT, type Agent } from './agents.ts';
import { Runners } from './runner.ts';
import { TOOLS, runTool, normalizeAction } from './tools.ts';

const PORT = Number(process.env.PORT) || 4710;
const BASE = `http://localhost:${PORT}`;

const world = await World.create();
const store = new AgentStore(BASE);
const runners = new Runners(world, store);
for (const a of store.agents) world.addBody(a.id, a.name, a.color);

// Welt-Einstellungen überdauern einen Neustart
const SETTINGS = path.join(DATA_ROOT, 'settings.json');
try {
  const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  if (typeof s.resetIntervalMin === 'number') world.resetIntervalMin = s.resetIntervalMin;
  if (s.rockShape === 'ball' || s.rockShape === 'block') world.setRockShape(s.rockShape);
  if (typeof s.lockstep === 'boolean') world.lockstep = s.lockstep;
  if (typeof s.hearRange === 'number') world.hearRange = s.hearRange;
} catch { /* noch keine gespeichert */ }
const saveSettings = () => fs.writeFileSync(SETTINGS, JSON.stringify({ resetIntervalMin: world.resetIntervalMin, rockShape: world.rockShape, lockstep: world.lockstep, hearRange: world.hearRange }, null, 2));

const app = express();
app.use(express.json({ limit: '4mb' }));
const server = http.createServer(app);

// ---------- Live-Verbindung zur Weboberfläche ----------

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});
const broadcast = (msg: unknown) => {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
};
wss.on('connection', (ws) => ws.send(JSON.stringify(world.snapshot())));
store.onLog = (id, entry) => broadcast({ t: 'log', id, entry });
store.onNote = (id, path, text, isNew) => broadcast({ t: 'note', id, path, text, isNew });
setInterval(() => store.scan(), 1000);
runners.onChange = () => broadcast({ t: 'agents' });
store.onUsage = (id, usage) => broadcast({ t: 'usage', id, usage });
world.onReset = () => broadcast({ t: 'reset' });

let last = performance.now();
let frame = 0;
setInterval(() => {
  const now = performance.now();
  world.tick((now - last) / 1000);
  last = now;
  frame++;
  // 20 Bilder pro Sekunde, im Pausenzustand nur gelegentlich
  if (frame % (world.paused ? 30 : 3) === 0) broadcast(world.snapshot());
}, 1000 / 60);

// ---------- Steuerung (Weboberfläche) ----------

const pub = (a: Agent) => ({ ...a, apiKey: undefined, hasKey: !!a.apiKey, running: runners.isRunning(a.id), usage: store.getUsage(a.id) });
const wrap = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
};

app.get('/api/state', wrap(() => ({
  agents: store.agents.map(pub),
  statics: STATICS,
  world: { paused: world.paused, speed: world.speed, resetIntervalMin: world.resetIntervalMin, rockShape: world.rockShape, lockstep: world.lockstep, hearRange: world.hearRange, time: world.simTime },
  baseUrl: BASE,
})));

app.post('/api/control', wrap((req) => {
  const { paused, speed, resetIntervalMin, rockShape, lockstep, hearRange } = req.body || {};
  if (typeof hearRange === 'number' && hearRange >= 0) { world.hearRange = hearRange; saveSettings(); broadcast({ t: 'agents' }); }
  if (typeof lockstep === 'boolean') { world.lockstep = lockstep; saveSettings(); broadcast({ t: 'agents' }); }
  if (rockShape === 'block' || rockShape === 'ball') { world.setRockShape(rockShape); saveSettings(); broadcast({ t: 'agents' }); }
  if (typeof speed === 'number') world.speed = Math.max(0.1, Math.min(16, speed));
  if (typeof resetIntervalMin === 'number') { world.resetIntervalMin = Math.max(0, resetIntervalMin); saveSettings(); }
  if (typeof paused === 'boolean') {
    world.setPaused(paused);
    runners.setPaused(paused);
  }
  broadcast(world.snapshot());
}));

app.post('/api/reset', wrap(() => { world.reset(); broadcast(world.snapshot()); }));

app.post('/api/agents', wrap((req) => {
  const a = store.create(req.body || {});
  world.addBody(a.id, a.name, a.color);
  broadcast({ t: 'agents' });
  return pub(a);
}));

app.patch('/api/agents/:id', wrap((req) => {
  const a = store.update(String(req.params.id), req.body || {});
  world.updateBody(a.id, a.name, a.color);
  broadcast({ t: 'agents' });
  return pub(a);
}));

app.delete('/api/agents/:id', wrap((req) => {
  runners.stop(String(req.params.id));
  world.removeBody(String(req.params.id));
  store.remove(String(req.params.id));
  broadcast({ t: 'agents' });
}));

app.post('/api/agents/:id/run', wrap((req) => {
  const a = store.get(String(req.params.id));
  if (req.body?.on) runners.start(a);
  else runners.stop(a.id);
}));

app.get('/api/agents/:id/files', wrap((req) => store.listFiles(store.get(String(req.params.id)))));
app.get('/api/agents/:id/file', wrap((req) => ({ content: store.readFile(store.get(String(req.params.id)), String(req.query.path)) })));
app.put('/api/agents/:id/file', wrap((req) => store.writeFile(store.get(String(req.params.id)), String(req.body.path), String(req.body.content ?? ''), true)));
app.get('/api/agents/:id/log', wrap((req) => store.getLog(String(req.params.id))));

// ---------- Schnittstelle für Agenten: HTTP ----------

function auth(req: express.Request): Agent | undefined {
  const h = req.headers.authorization || '';
  return store.byToken(h.startsWith('Bearer ') ? h.slice(7).trim() : (req.query.token as string | undefined));
}

app.get('/api/agent/observe', async (req, res) => {
  const a = auth(req);
  if (!a) return void res.status(401).json({ error: 'Token fehlt oder ist ungültig' });
  res.json(await runTool(world, store, a, 'observe', {}));
});

app.post('/api/agent/input', async (req, res) => {
  const a = auth(req);
  if (!a) return void res.status(401).json({ error: 'Token fehlt oder ist ungültig' });
  const name = normalizeAction(req.body?.type);
  if (!TOOLS.some((t) => t.name === name && !t.files)) return void res.status(400).json({ error: `Unbekannte Aktion: ${req.body?.type}` });
  if (a.runner === "extern") store.log(a.id, world.simTime, 'tool', `${name} ${JSON.stringify(req.body?.data ?? {})}`);
  res.json(await runTool(world, store, a, name, req.body?.data));
});

// ---------- Schnittstelle für Agenten: MCP (Streamable HTTP, zustandslos) ----------

app.post('/mcp', async (req, res) => {
  const a = auth(req);
  if (!a) return void res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Token fehlt oder ist ungültig' } });
  const { id, method, params } = req.body || {};
  if (id === undefined || id === null) return void res.status(202).end(); // Benachrichtigung
  const ok = (result: unknown) => res.json({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return void ok({
        protocolVersion: params?.protocolVersion || '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'ki-playground', version: '0.1.0' },
        instructions: `Du steuerst den Körper von "${a.name}" auf einer simulierten Insel. y zeigt nach oben. Beginne mit observe.`,
      });
    case 'ping':
      return void ok({});
    case 'tools/list':
      return void ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) });
    case 'tools/call': {
      const name = params?.name;
      if (a.runner === "extern") store.log(a.id, world.simTime, 'tool', `${name} ${JSON.stringify(params?.arguments ?? {})}`);
      const out = await runTool(world, store, a, name, params?.arguments);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      return void ok({ content: [{ type: 'text', text }], isError: (out as any)?.ok === false });
    }
    default:
      return void res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Methode nicht gefunden: ${method}` } });
  }
});
app.get('/mcp', (_req, res) => void res.status(405).end());

// ---------- Weboberfläche ----------

const vite = await createVite({
  configFile: false,
  root: path.resolve(import.meta.dirname, '..', 'client'),
  plugins: [react()],
  appType: 'spa',
  server: { middlewareMode: true, hmr: { server } },
});
app.use(vite.middlewares);

// Beim Beenden keine Agenten-Prozesse zurücklassen, die weiter Kontingent verbrauchen
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => { runners.stopAll(); store.saveUsage(); process.exit(0); });
}

server.listen(PORT, '127.0.0.1', () => console.log(`KI Playground läuft auf ${BASE}`));
