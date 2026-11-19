// Bewegungstest: Kommt der Körper per goto auf Stufen, die er im Sprung schaffen sollte – und springt er nicht unnötig?
// Läuft ohne Server: nur die Welt (Physik), mit fester Schrittweite. Start: npm run test:moves
//
// Regressionstest für den Fehler „Sprung senkrecht, Landung vor der Stufe“ (keine Steuerung in der Luft, 0/9).
import { World } from '../server/world.ts';

type Case = { name: string; start: [number, number, number]; goal: [number, number, number]; top: number; jumps?: number };

// start/goal: Füsse; top: Höhe der Oberfläche, auf der er am Ende stehen muss; jumps: genau so viele Sprünge erwartet
const CASES: Case[] = [
  { name: 'LowStep von Süden', start: [-22, 0, -2], goal: [-22, 2, -10], top: 2 },
  { name: 'LowStep schräg', start: [-12, 0, -2], goal: [-20, 2, -10], top: 2 },
  { name: 'LowStep von Osten', start: [-10, 0, -12], goal: [-18, 2, -12], top: 2 },
  { name: 'EastStep von Süden', start: [18, 0, 2], goal: [18, 2, -6], top: 2 },
  { name: 'EastStep von Westen', start: [10, 0, -6], goal: [18, 2, -6], top: 2 },
  { name: 'EastMesa über die Lücke', start: [17, 2, -6], goal: [26, 4, -8], top: 4 },
  { name: 'Ridge von LowStep', start: [-22, 2, -10], goal: [-22, 4, -18], top: 4 },
  { name: 'SmallPlateau (1 hoch)', start: [4.5, 0, -6], goal: [4.5, 1, -15], top: 1 }, // neben Rock_1 in der Mitte
  { name: 'LongMesa von Süden', start: [-20, 0, 8], goal: [-20, 2, 2], top: 2 },
  { name: 'flach laufen', start: [0, 0, 10], goal: [0, 0, 25], top: 0, jumps: 0 },
  { name: 'Stufe hinunter', start: [-22, 2, -10], goal: [-22, 0, -4], top: 0, jumps: 0 },
];

const LIMIT = 20; // Sekunden Weltzeit pro Fall
const STEP = 1 / 60;

const w: any = await World.create();
w.setPaused(false);
let failed = 0;
for (const c of CASES) {
  for (const id of [...w.bodies.keys()]) w.removeBody(id);
  w.addBody('t', 'T', '#f00');
  const b = w.bodies.get('t');
  b.needs.energy = 1; b.needs.hunger = 0; b.needs.thirst = 0;
  b.body.setTranslation({ x: c.start[0], y: c.start[1] + 0.95, z: c.start[2] }, true);
  for (let i = 0; i < 30; i++) w.tick(STEP);
  w.act('t', { steps: [{ type: 'goto', position: c.goal }] });
  let jumps = 0, wasGrounded = true, t = 0;
  for (; t < LIMIT / STEP && b.plan.status === 'running'; t++) {
    w.tick(STEP);
    if (wasGrounded && !b.grounded && b.body.linvel().y > 3) jumps++;
    wasGrounded = b.grounded;
  }
  // der Plan gilt als erledigt, sobald er waagrecht am Ziel ist – evtl. noch in der Luft: erst landen lassen
  for (let i = 0; i < 60; i++) w.tick(STEP);
  const feet = b.body.translation().y - 0.9;
  const problems: string[] = [];
  if (b.plan.status !== 'done') problems.push(`Plan ${b.plan.status}${b.plan.error ? `: ${b.plan.error}` : ''}`);
  if (Math.abs(feet - c.top) > 0.5) problems.push(`steht auf ${feet.toFixed(2)} statt ${c.top}`);
  if (c.jumps !== undefined && jumps !== c.jumps) problems.push(`${jumps} Sprünge statt ${c.jumps}`);
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.name.padEnd(26)} ${(t * STEP).toFixed(1)} s, ${jumps} Sprünge${problems.length ? ' – ' + problems.join('; ') : ''}`);
}
console.log(failed ? `\n${failed} von ${CASES.length} Fällen gescheitert.` : `\nAlle ${CASES.length} Fälle bestanden.`);
process.exit(failed ? 1 : 0);
