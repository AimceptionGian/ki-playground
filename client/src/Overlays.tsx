import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Scene } from './scene';
import type { AgentInfo, LogEntry } from './App';

export interface Note { id: string; path: string; text: string; isNew: boolean }
type LogSubs = Set<(id: string, e: LogEntry) => void>;
type NoteSubs = Set<(n: Note) => void>;

const plain = (s: string) => s.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

/** Was ein Agent denkt oder sagt, als Sprechblase über seinem Kopf. */
export function Bubbles({ scene, agents, logSubs }: { scene: RefObject<Scene | null>; agents: AgentInfo[]; logSubs: LogSubs }) {
  const [bubbles, setBubbles] = useState<Record<string, { text: string; said: boolean; key: number }>>({});
  const els = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const timers = new Map<string, number>();
    const sub = (id: string, e: LogEntry) => {
      if (e.kind !== 'text' && e.kind !== 'say') return;
      const full = plain(e.text);
      if (!full) return;
      const text = full.length > 260 ? full.slice(0, 260) + ' …' : full;
      const key = e.wall + Math.random();
      setBubbles((b) => ({ ...b, [id]: { text, said: e.kind === 'say', key } }));
      clearTimeout(timers.get(id));
      timers.set(id, window.setTimeout(() => {
        setBubbles((b) => { if (b[id]?.key !== key) return b; const { [id]: _, ...rest } = b; return rest; });
      }, Math.max(5000, Math.min(14000, 2500 + text.length * 45))));
    };
    logSubs.add(sub);
    return () => { logSubs.delete(sub); timers.forEach((t) => clearTimeout(t)); };
  }, [logSubs]);

  useEffect(() => {
    let raf = 0;
    const GAP = 6;
    const lift: Record<string, number> = {}; // wie weit eine Blase gerade nach oben ausweicht
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const items: { id: string; el: HTMLDivElement; x: number; y: number; w: number; h: number }[] = [];
      for (const [id, el] of Object.entries(els.current)) {
        if (!el) { delete lift[id]; continue; }
        const p = scene.current?.project(id);
        el.style.visibility = p ? 'visible' : 'hidden';
        if (p) items.push({ id, el, x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight });
      }
      // Die unterste Blase bleibt an ihrem Agenten; jede weitere weicht nach oben aus, bis sie frei steht.
      items.sort((a, b) => b.y - a.y || a.id.localeCompare(b.id));
      const placed: { l: number; r: number; t: number; b: number }[] = [];
      for (const it of items) {
        const l = it.x - it.w / 2, r = it.x + it.w / 2;
        let bottom = it.y;
        for (let moved = true; moved; ) {
          moved = false;
          for (const q of placed) {
            if (l < q.r + GAP && r > q.l - GAP && bottom - it.h < q.b + GAP && bottom > q.t - GAP) { bottom = q.t - GAP; moved = true; }
          }
        }
        placed.push({ l, r, t: bottom - it.h, b: bottom });
        const target = it.y - bottom;
        const cur = (lift[it.id] = (lift[it.id] ?? target) + (target - (lift[it.id] ?? target)) * 0.2);
        it.el.style.transform = `translate(${it.x}px, ${it.y - cur}px) translate(-50%, -100%)`;
        const stem = it.el.lastElementChild as HTMLElement;
        stem.style.height = `${cur}px`;
        stem.style.opacity = cur > 3 ? '1' : '0';
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [scene]);

  return (
    <div className="bubbles">
      {Object.entries(bubbles).map(([id, b]) => {
        const a = agents.find((x) => x.id === id);
        if (!a) return null;
        return (
          <div key={id} ref={(el) => { els.current[id] = el; }} className="bubble-anchor" style={{ visibility: 'hidden' }}>
            <div key={b.key} className={`bubble ${b.said ? 'said' : ''}`} style={{ borderColor: a.color }}>{b.text}</div>
            <span className="stem" />
          </div>
        );
      })}
    </div>
  );
}

interface Shown extends Note { key: number }

/** Meldungen am Rand, sobald ein Agent etwas in seine Dateien schreibt. */
export function Notes({ agents, noteSubs, onOpen }: { agents: AgentInfo[]; noteSubs: NoteSubs; onOpen: (id: string) => void }) {
  const [notes, setNotes] = useState<Shown[]>([]);
  const timers = useRef(new Map<number, number>());

  const close = (key: number) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setNotes((n) => n.filter((x) => x.key !== key));
  };
  const arm = (key: number, ms: number) => {
    clearTimeout(timers.current.get(key));
    timers.current.set(key, window.setTimeout(() => close(key), ms));
  };

  useEffect(() => {
    let next = 1;
    const sub = (n: Note) => {
      const key = next++;
      setNotes((list) => {
        const drop = list.slice(0, Math.max(0, list.length - 3));
        drop.forEach((d) => { clearTimeout(timers.current.get(d.key)); timers.current.delete(d.key); });
        return [...list.slice(-3), { ...n, key }];
      });
      arm(key, 10_000);
    };
    noteSubs.add(sub);
    const t = timers.current;
    return () => { noteSubs.delete(sub); t.forEach((x) => clearTimeout(x)); };
  }, [noteSubs]);

  return (
    <div className="notes" aria-live="polite">
      {notes.map((n) => {
        const a = agents.find((x) => x.id === n.id);
        return (
          <article key={n.key} className="note" onMouseEnter={() => clearTimeout(timers.current.get(n.key))} onMouseLeave={() => arm(n.key, 4000)}>
            <header>
              <i style={{ background: a?.color || '#888' }} />
              <button className="link" onClick={() => onOpen(n.id)} title="Dateien dieses Agenten öffnen">
                <b>{a?.name || n.id}</b> {n.isNew ? 'legt an' : 'schreibt in'} <code>{n.path}</code>
              </button>
              <button className="x" onClick={() => close(n.key)} aria-label="Meldung schliessen">✕</button>
            </header>
            <p>{n.text}</p>
            <span className="life" />
          </article>
        );
      })}
    </div>
  );
}
