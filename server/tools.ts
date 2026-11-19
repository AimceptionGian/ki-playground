import { STEP_TYPES, type World } from './world.ts';
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
  { name: 'observe', description: 'Beobachte die Welt: dein Körper (mit laufendem Plan, Bedürfnissen und Alter), alle Objekte und Plattformen, der Chat.', parameters: { type: 'object', properties: {} } },
  {
    name: 'act',
    description: 'Gib deinem Körper einen Plan: Schritte, die er selbständig nacheinander ausführt. Kehrt sofort zurück; während der Körper handelt, kannst du weiterdenken. '
      + 'Er läuft selbst zu Objekten hin, springt über niedrige Hindernisse und zielt beim Werfen. Ein neuer Plan ersetzt den laufenden, append: true hängt an. '
      + 'Schritte: goto {position|name, radius?} · follow {name, distance?, seconds?} · pickup {name|position} · place {position, rotation?} · '
      + 'throw {at|position|direction, speed?} · jump · say {text} · look {name|position} · wait {seconds} · wander {radius?, seconds?} · eat {name?} (Beerenbusch) · drink {name?} (Teich) · sleep {seconds?}',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'Was du damit vorhast, in einem Satz.' },
        append: { type: 'boolean' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: [...STEP_TYPES] },
              position: vec, name: { type: 'string' }, at: { type: 'string' }, text: { type: 'string' },
              seconds: { type: 'number' }, radius: { type: 'number' }, distance: { type: 'number' },
              direction: vec, speed: { type: 'number' }, rotation: vec,
              interrupt: { type: 'boolean', description: 'say: absichtlich jemandem ins Wort fallen' },
            },
            required: ['type'],
          },
        },
      },
      required: ['steps'],
    },
  },
  { name: 'move_to', description: 'Kurzform für act mit einem goto: lauf zu einer Position [x, y, z]. Kehrt sofort zurück.', parameters: { type: 'object', properties: { position: vec }, required: ['position'] } },
  { name: 'jump', description: 'Spring. Geht nur mit Bodenkontakt.', parameters: { type: 'object', properties: {} } },
  { name: 'stop', description: 'Bleib stehen und brich den laufenden Plan ab.', parameters: { type: 'object', properties: {} } },
  { name: 'pickup', description: 'Nimm ein Objekt auf: das nächste zur Position oder das mit dem Namen. Ist es weiter weg, läufst du erst hin.', parameters: { type: 'object', properties: { position: vec, name: { type: 'string' } } } },
  { name: 'place', description: 'Setz das gehaltene Objekt an eine Position; ist sie weiter weg, läufst du erst hin. rotation in Grad [rx, ry, rz], optional.', parameters: { type: 'object', properties: { position: vec, rotation: vec }, required: ['position'] } },
  { name: 'throw', description: 'Wirf das gehaltene Objekt in eine Richtung [x, y, z] mit einer Geschwindigkeit.', parameters: { type: 'object', properties: { direction: vec, speed: { type: 'number' } }, required: ['direction', 'speed'] } },
  { name: 'say', description: 'Sag etwas. Wer in Hörweite ist, hört es. Spricht gerade jemand in deiner Nähe, schweigst du (stopped) – ausser du fällst ihm absichtlich ins Wort (interrupt: true).', parameters: { type: 'object', properties: { text: { type: 'string' }, interrupt: { type: 'boolean' } }, required: ['text'] } },
  { name: 'wait', description: 'Warte einige Sekunden Weltzeit (höchstens 30) und beobachte dich danach. Endet vorzeitig, wenn jemand in Hörweite spricht oder dein Plan fertig ist oder scheitert.', parameters: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
  { name: 'reproduce', description: 'Bekomm ein Kind mit jemandem, der nah bei dir steht (höchstens 4 Einheiten). Beide müssen es wollen: Beide rufen reproduce mit dem Namen des anderen auf, innerhalb von 60 Sekunden. Beide müssen erwachsen, froh genug und nicht hungrig oder durstig sein.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_files', description: 'Liste die Dateien in deinem Arbeitsordner.', parameters: { type: 'object', properties: {} }, files: true },
  { name: 'read_file', description: 'Lies eine Datei aus deinem Arbeitsordner.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, files: true },
  { name: 'write_file', description: 'Schreib eine Datei in deinem Arbeitsordner (ersetzt den Inhalt).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, files: true },
  { name: 'append_file', description: 'Häng Text ans Ende einer Datei in deinem Arbeitsordner.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, files: true },
];

const ALIAS: Record<string, string> = { act: 'act', plan: 'act', moveto: 'move_to', move: 'move_to', throw: 'throw', pickup: 'pickup', place: 'place', jump: 'jump', stop: 'stop', say: 'say', wait: 'wait', observe: 'observe', reproduce: 'reproduce' };

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
      case 'act': result = world.act(agent.id, args); break;
      // die alten Einzelbefehle sind Pläne mit einem Schritt und bekommen so dieselben Reflexe
      case 'move_to': result = world.act(agent.id, { steps: [{ type: 'goto', position: args.position }] }); break;
      // Springen und Werfen geschehen sofort und lassen ein laufendes Ziel stehen (Sprung über die Kante, Wurf im Lauf)
      case 'jump': result = world.jump(agent.id); break;
      case 'throw': result = world.throwObj(agent.id, args); break;
      // Aufheben: in Reichweite sofort, sonst als Plan mit Hinlaufen
      case 'pickup': {
        const now = world.pickup(agent.id, args);
        result = now.ok || !/Reichweite/.test(now.error || '') ? now : world.act(agent.id, { steps: [{ type: 'pickup', name: args.name, position: args.position }] });
        break;
      }
      case 'place': result = world.act(agent.id, { steps: [{ type: 'place', position: args.position, rotation: args.rotation }] }); break;
      case 'stop': result = world.stop(agent.id); break;
      case 'say': result = world.say(agent.id, args.text, args.interrupt === true); break;
      case 'reproduce': result = world.reproduce(agent.id, args); break;
      case 'wait': {
        const s = Math.max(0, Math.min(30, Number(args.seconds) || 0));
        const start = world.simTime;
        const interrupted = await world.waitSim(s, agent.id);
        result = { ok: true, waited: Math.round((world.simTime - start) * 100) / 100, ...(interrupted ? { interrupted_by: interrupted } : {}) };
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
