import type { World } from './world.ts';
import type { Agent, AgentStore } from './agents.ts';

const vec = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  files?: boolean;
}

/** Eine Werkzeugliste für alle Wege: eingebauter Runner, MCP und HTTP-API. */
export const TOOLS: ToolDef[] = [
  { name: 'observe', description: 'Beobachte die Welt: dein Körper, alle Objekte und Plattformen, der Chat.', parameters: { type: 'object', properties: {} } },
  { name: 'move_to', description: 'Lauf in gerader Linie zu einer Position [x, y, z]. Kehrt sofort zurück.', parameters: { type: 'object', properties: { position: vec }, required: ['position'] } },
  { name: 'jump', description: 'Spring. Geht nur mit Bodenkontakt.', parameters: { type: 'object', properties: {} } },
  { name: 'stop', description: 'Bleib stehen.', parameters: { type: 'object', properties: {} } },
  { name: 'pickup', description: 'Nimm ein Objekt in Reichweite auf: das nächste zur Position oder das mit dem Namen.', parameters: { type: 'object', properties: { position: vec, name: { type: 'string' } } } },
  { name: 'place', description: 'Setz das gehaltene Objekt an eine Position in deiner Nähe. rotation in Grad [rx, ry, rz], optional.', parameters: { type: 'object', properties: { position: vec, rotation: vec }, required: ['position'] } },
  { name: 'throw', description: 'Wirf das gehaltene Objekt in eine Richtung [x, y, z] mit einer Geschwindigkeit.', parameters: { type: 'object', properties: { direction: vec, speed: { type: 'number' } }, required: ['direction', 'speed'] } },
  { name: 'say', description: 'Sag etwas. Alle in der Welt hören es.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'wait', description: 'Warte einige Sekunden Weltzeit (höchstens 30) und beobachte dich danach.', parameters: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
  { name: 'list_files', description: 'Liste die Dateien in deinem Arbeitsordner.', parameters: { type: 'object', properties: {} }, files: true },
  { name: 'read_file', description: 'Lies eine Datei aus deinem Arbeitsordner.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, files: true },
  { name: 'write_file', description: 'Schreib eine Datei in deinem Arbeitsordner (ersetzt den Inhalt).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, files: true },
  { name: 'append_file', description: 'Häng Text ans Ende einer Datei in deinem Arbeitsordner.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, files: true },
];

const ALIAS: Record<string, string> = { moveto: 'move_to', move: 'move_to', throw: 'throw', pickup: 'pickup', place: 'place', jump: 'jump', stop: 'stop', say: 'say', wait: 'wait', observe: 'observe' };

export function normalizeAction(type: string): string {
  const k = String(type || '').toLowerCase().replace(/[^a-z_]/g, '');
  return ALIAS[k.replace(/_/g, '')] || k;
}

export async function runTool(world: World, store: AgentStore, agent: Agent, name: string, args: any): Promise<unknown> {
  args = args || {};
  world.touch(agent.id);
  try {
    switch (name) {
      case 'list_files': return store.listFiles(agent).map((f) => ({ path: f.path, size: f.size }));
      case 'read_file': return store.readFile(agent, String(args.path));
      case 'write_file': store.writeFile(agent, String(args.path), String(args.content ?? '')); return { ok: true };
      case 'append_file': store.appendFile(agent, String(args.path), String(args.content ?? '')); return { ok: true };
    }
    // Weltaktionen ruhen, solange die Simulation pausiert ist
    if (!(await world.whenRunning(20_000))) return { ok: false, paused: true, error: 'Die Simulation ist pausiert. Versuch es später wieder.' };
    if (name === 'observe') return world.observe(agent.id);
    let result: unknown;
    switch (name) {
      case 'move_to': result = world.moveTo(agent.id, args.position); break;
      case 'jump': result = world.jump(agent.id); break;
      case 'stop': result = world.stop(agent.id); break;
      case 'pickup': result = world.pickup(agent.id, args); break;
      case 'place': result = world.place(agent.id, args); break;
      case 'throw': result = world.throwObj(agent.id, args); break;
      case 'say':
        result = world.say(agent.id, args.text);
        if ((result as any).ok) store.log(agent.id, world.simTime, 'say', String(args.text).slice(0, 500));
        break;
      case 'wait': {
        const s = Math.max(0, Math.min(30, Number(args.seconds) || 0));
        await world.waitSim(s, agent.id);
        result = { ok: true, waited: s };
        break;
      }
      default: return { ok: false, error: `Unbekannte Aktion: ${name}` };
    }
    world.touch(agent.id);
    const o = world.observe(agent.id);
    return { result, time: o.time, self: o.self, ...(o.events.length ? { events: o.events } : {}) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
