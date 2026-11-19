// Redetest: Wer zuerst spricht, hat das Wort; wer reinreden will, muss es bewusst tun (interrupt).
// Läuft ohne Server: nur die Welt. Start: npm run test:speech
import { World } from '../server/world.ts';

const w: any = await World.create();
w.setPaused(false);
w.hearRange = 15;
const hushed: [string, number][] = [];
const said: [string, number][] = [];
w.onHush = (id: string, seq: number) => hushed.push([id, seq]);
w.onSay = (id: string, _t: string, seq: number) => said.push([id, seq]);

const place = (id: string, x: number, z: number) => {
  w.addBody(id, id.toUpperCase(), '#f00');
  w.bodies.get(id).body.setTranslation({ x, y: 0.95, z }, true);
};
place('a', 0, 10); place('b', 2, 10); place('c', 40, 10); place('d', 1, 12); // c ausser Hörweite, d hört zu
const run = (sec: number) => { for (let i = 0; i < sec * 60; i++) w.tick(1 / 60); };
const events = (id: string, type: string) => w.bodies.get(id).events.filter((e: any) => e.type === type);
run(0.5);

let failed = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && info ? ' – ' + info : ''}`);
};

// 0) Zuhören: Beginn sofort merken, Inhalt erst am Ende hören; ein wait endet erst dann
{
  let woke: string | false | null = null;
  w.waitSim(30, 'd').then((r: string | false) => { woke = r; });
  const r = w.say('a', 'Ich sage jetzt einen Satz, der eine Weile dauert.');
  const flush = () => new Promise((res) => setTimeout(res, 0));
  check('Zuhörer merkt den Beginn sofort (speaking_started)', events('d', 'speaking_started').some((e: any) => e.from === 'A' && e.seconds > 1));
  check('…aber hört den Inhalt noch nicht', events('d', 'heard').length === 0);
  run(r.seconds / 2); await flush();
  check('wait endet nicht schon beim Beginn', woke === null, String(woke));
  run(r.seconds / 2 + 0.1); await flush();
  check('am Ende: Inhalt gehört', events('d', 'heard').some((e: any) => e.from === 'A' && e.text.startsWith('Ich sage') && !e.cut));
  check('am Ende: wait endet (speech)', woke === 'speech', String(woke));
  for (const id of ['a', 'b', 'd']) w.bodies.get(id).events.length = 0;
}

// 1) A spricht, B in der Nähe will auch: B schweigt
const ra = w.say('a', 'Hallo zusammen, ich erzähle euch jetzt etwas über den Teich.');
const rb = w.say('b', 'Ich auch!');
check('A darf sprechen', ra.ok === true, JSON.stringify(ra));
check('B schweigt, weil A zuerst war', rb.ok === false && rb.stopped === true && rb.speaking === 'A', JSON.stringify(rb));

// 2) C ausser Hörweite darf gleichzeitig reden
const rc = w.say('c', 'Hier hinten ist es ruhig.');
check('C ausser Hörweite darf gleichzeitig reden', rc.ok === true, JSON.stringify(rc));

// 3) B fällt bewusst ins Wort: A verstummt (Ton wird angehalten) und erfährt es
run(1); // A hat schon ein paar Wörter gesagt
const seqA = said.filter(([id]) => id === 'a').at(-1)![1];
const rb2 = w.say('b', 'Moment, das stimmt nicht!', true);
check('B darf mit interrupt reinreden', rb2.ok === true && rb2.interrupted === 'A', JSON.stringify(rb2));
check('A verstummt (Ton angehalten)', hushed.some(([id, s]) => id === 'a' && s === seqA) && w.speechCut('a', seqA), JSON.stringify(hushed));
check('A bekommt Event interrupted', events('a', 'interrupted').some((e: any) => e.by === 'B'));
const cut = events('d', 'heard').find((e: any) => e.from === 'A' && e.cut);
check('Zuhörer hört von A nur den Anfang (cut)', !!cut && cut.text.endsWith('…') && cut.text.length < 'Hallo zusammen, ich erzähle euch jetzt etwas über den Teich.'.length, JSON.stringify(cut));

// 4) Nach dem Ende von Bs Satz darf A wieder
run(4);
check('A hört, dass B unterbricht (am Ende von Bs Satz)', events('a', 'heard').some((e: any) => e.from === 'B' && e.interrupting === 'A'));
check('nach Bs Satz darf A wieder', w.say('a', 'Na gut.').ok === true);

// 5) say-Schritt im Plan, während jemand spricht: fällt weg, Plan läuft weiter, Geist erfährt es
run(2);
w.say('a', 'Jetzt rede ich wieder eine ganze Weile, bitte nicht unterbrechen.');
w.act('b', { steps: [{ type: 'say', text: 'Darf ich?' }, { type: 'wait', seconds: 1 }] });
run(1.5);
const b = w.bodies.get('b');
check('say-Schritt fällt weg (kept_silent)', events('b', 'kept_silent').some((e: any) => e.because === 'A'));
check('Plan läuft danach weiter bis fertig', b.plan.status === 'done', b.plan.status);

// 6) say-Schritt mit interrupt im Plan: redet rein
w.say('a', 'Und noch etwas, das recht lange dauert, damit ich sicher noch rede.');
w.act('b', { steps: [{ type: 'say', text: 'Stopp!', interrupt: true }] });
check('say-Schritt mit interrupt redet rein', w.bodies.get('a').speaking === null && b.speaking?.text === 'Stopp!');

// 7) beide wollen im selben Augenblick: genau einer spricht
run(5);
for (const id of ['a', 'b']) w.bodies.get(id).events.length = 0;
w.act('a', { steps: [{ type: 'wait', seconds: 0.5 }, { type: 'say', text: 'Gleichzeitig A' }] });
w.act('b', { steps: [{ type: 'wait', seconds: 0.5 }, { type: 'say', text: 'Gleichzeitig B' }] });
run(1);
const spoke = ['a', 'b'].filter((id) => (w.bodies.get(id).speaking?.until ?? 0) > w.simTime);
const silent = ['a', 'b'].filter((id) => events(id, 'kept_silent').length);
check('gleichzeitig: genau einer spricht, der andere schweigt', spoke.length === 1 && silent.length === 1 && spoke[0] !== silent[0], `spricht ${spoke}, schweigt ${silent}`);

console.log(failed ? `\n${failed} Prüfungen gescheitert.` : '\nAlle Prüfungen bestanden.');
process.exit(failed ? 1 : 0);
