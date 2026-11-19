import RAPIER from '@dimforge/rapier3d-compat';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface StaticPart {
  name: string;
  center: Vec3;
  size: Vec3;
  ground?: boolean;
}

type ObjKind = 'cube' | 'rock' | 'ring';

interface Obj {
  id: number;
  name: string;
  kind: ObjKind;
  body: RAPIER.RigidBody;
  size: Vec3;
  color: string;
  heldBy: string | null;
  lost: boolean;
  spawned: boolean; // true = entstand durch Fels-Aufprall, verschwindet beim Reset
  initPos: Vec3;
  prevVel: Vec3;
}

interface Body {
  id: string;
  name: string;
  color: string;
  body: RAPIER.RigidBody;
  target: Vec3 | null;
  yaw: number;
  holding: Obj | null;
  grounded: boolean;
  spawn: Vec3;
  waits: number; // offene Wait-Aufrufe dieses Agenten
  lastAct: number; // Echtzeit der letzten Regung (0 = hat sich nie gemeldet)
  driven: boolean; // wird vom Server angetrieben (Runner läuft)
  move: 'idle' | 'moving' | 'arrived' | 'blocked';
  block: { by: string | null; obstacle_top_y?: number; height_above_feet?: number } | null;
  mv: [number, number]; // aktuelle Bodengeschwindigkeit (Beschleunigen/Abbremsen)
  bestD: number; // kleinster bisher erreichter Abstand zum Ziel
  stuck: number; // Sekunden ohne Fortschritt am Boden
  events: Record<string, unknown>[]; // was seit der letzten Beobachtung passiert ist
  heard: { time: number; from: string; text: string }[]; // was dieser Agent gehört oder selbst gesagt hat
  plan: Plan | null; // was der Körper gerade selbständig abarbeitet
  lookYaw: number | null; // wohin der Körper schaut, wenn er nicht läuft
  auto: boolean; // schlendert im Leerlauf von selbst
  idle: number; // Sekunden ohne Plan
  nextLook: number; // Weltzeit, zu der er sich im Leerlauf wieder umschaut
  needs: Needs;
  urgent: { hunger: boolean; thirst: boolean }; // schon als dringend gemeldet
  cheer: number; // kurzer Freudenschub durch Reden und Spielen, klingt ab
  autoCool: number; // Weltzeit, vor der der Körper keinen neuen Eigenplan startet
  healthLow: boolean; // schon als gefährlich gemeldet
  grief: number; // Trauer nach einem Tod, klingt langsam ab
  // Lebenszyklus
  age: number; // gelebte Sekunden Weltzeit
  lifeFactor: number; // Streuung des Höchstalters (0.8 bis 1.2)
  parents: { id: string; name: string }[];
  stage: Stage;
  offer: { to: string; until: number } | null; // Angebot, gemeinsam ein Kind zu bekommen
  nextBirthAge: number; // Alter, ab dem wieder ein Kind möglich ist
  dead: string | null; // Todesursache; der Körper wird am Ende des Schritts entfernt
}

export type Stage = 'child' | 'adult' | 'old';
export interface BodyOpts { age?: number; nextBirthAge?: number; lifeFactor?: number; parents?: { id: string; name: string }[]; pos?: Vec3 }

export interface Needs { hunger: number; thirst: number; boredom: number; joy: number; health: number }

/** Beerenbusch oder Teich: ortsfeste Quelle für Nahrung und Wasser. */
interface Source {
  id: number;
  name: string;
  kind: 'bush' | 'pond';
  pos: Vec3;
  radius: number; // Teich: Radius, Busch: Grösse
  berries: number;
  max: number;
  regrow: number; // Sekunden bis zur nächsten Beere (ohne Härte)
  timer: number;
}

/** Ein Schritt eines Plans. Welche Felder zählen, hängt vom Typ ab (siehe STEP_TYPES). */
export interface Step {
  type: string;
  position?: Vec3;
  name?: string;
  at?: string;
  text?: string;
  seconds?: number;
  radius?: number;
  distance?: number;
  direction?: Vec3;
  speed?: number;
  rotation?: Vec3;
}

interface Plan {
  id: number;
  intent: string;
  steps: Step[];
  idx: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  auto?: boolean; // vom Körper selbst gewählt (Leerlauf), nicht vom Geist
  error?: string;
  sub: Record<string, any>; // Zustand des laufenden Schritts
}

export const STEP_TYPES = ['goto', 'follow', 'pickup', 'place', 'throw', 'jump', 'say', 'look', 'wait', 'wander', 'eat', 'drink'] as const;
const MAX_STEPS = 20;
// Bedürfnisse: Anstieg pro Sekunde Weltzeit (bei Härte 1)
const HUNGER_RATE = 1 / 600;
const THIRST_RATE = 1 / 360;
const BORED_RATE = 1 / 300;
const URGENT = 0.8;
const BERRY_FOOD = 0.3; // so viel Hunger stillt eine Beere
const EAT_EVERY = 0.8; // Sekunden pro Beere
const DRINK_RATE = 0.4; // Durst, der pro Sekunde sinkt
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// Lebenszyklus: Anteile am Höchstalter
const CHILD_END = 0.15;
const OLD_START = 0.75;
const FOUNDER_AGE = 0.25; // Agenten aus der Weboberfläche kommen erwachsen zur Welt
const BIRTH_COOLDOWN = 600; // Sekunden Weltzeit zwischen zwei Kindern
const OFFER_TIME = 60; // so lange gilt ein Angebot zur Fortpflanzung
const MATE_RANGE = 4;
const STAGE_WORD: Record<Stage, string> = { child: 'Kind', adult: 'erwachsen', old: 'alt' };
const TURN_SPEED = 9; // rad/s
const ACCEL = 28; // m/s² beim Anlaufen
const DECEL = 40; // m/s² beim Abbremsen
const MAX_JUMP_UP = 2.3; // so hoch kommt ein Sprung über die Füsse

const DT = 1 / 60;
const GRAVITY = -20;
const WALK_SPEED = 6;
const JUMP_SPEED = 10;
const REACH = 3.5;
const MAX_THROW = 25;
const MAX_CUBES = 48;
const P_HALF = 0.5; // Kapsel: halbe Zylinderhöhe
const P_RAD = 0.4;
const P_FOOT = P_HALF + P_RAD;

// Die Insel: Boden (Oberkante y=0) und erhöhte Plattformen.
export const STATICS: StaticPart[] = [
  { name: 'Ground', center: [0, -2, 0], size: [90, 4, 70], ground: true },
  { name: 'GroundNorth', center: [-10, -2, -40], size: [50, 4, 12], ground: true },
  { name: 'GroundEast', center: [48, -2, 5], size: [10, 4, 40], ground: true },
  { name: 'GroundSouth', center: [10, -2, 39], size: [40, 4, 10], ground: true },
  { name: 'GroundWest', center: [-48, -2, -8], size: [8, 4, 30], ground: true },

  { name: 'LowStep', center: [-22, 1, -12], size: [16, 2, 10] },
  { name: 'Ridge', center: [-26, 2, -18], size: [22, 4, 6] },
  { name: 'PeakBase', center: [-34, 3, -20], size: [6, 6, 6] },
  { name: 'Peak', center: [-35, 5, -21], size: [4, 10, 4] },
  { name: 'LongMesa', center: [-20, 1, 2], size: [14, 2, 5] },
  { name: 'SmallPlateau', center: [2, 0.5, -14], size: [7, 1, 5] },

  { name: 'EastStep', center: [18, 1, -6], size: [6, 2, 5] },
  { name: 'EastMesa', center: [26, 2, -8], size: [8, 4, 8] },
  { name: 'SpireBase', center: [32, 3.5, -9], size: [6, 7, 6] },
  { name: 'SpireShoulder', center: [34, 5, -12], size: [4, 10, 4] },
  { name: 'Spire', center: [36, 8, -9], size: [3, 16, 3] },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const clampIsland = (n: number, lim: number) => Math.max(-lim, Math.min(lim, n));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const v3 = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const rv3 = (v: { x: number; y: number; z: number }): Vec3 => [r2(v.x), r2(v.y), r2(v.z)];

function eulerDegToQuat(e: Vec3): { x: number; y: number; z: number; w: number } {
  const [x, y, z] = e.map((d) => ((d || 0) * Math.PI) / 360);
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

function asVec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length < 3 || v.slice(0, 3).some((n) => typeof n !== 'number' || !isFinite(n))) {
    throw new Error(`${what} muss ein Array aus drei Zahlen sein: [x, y, z]`);
  }
  return [v[0], v[1], v[2]];
}

export class World {
  private rw!: RAPIER.World;
  private objs: Obj[] = [];
  private staticBodies: { handle: number; part: StaticPart }[] = [];
  private bodies = new Map<string, Body>();
  private nextId = 1;
  private debt = 0;
  private waiters: { until: number; resolve: (interrupted: string | false) => void; id?: string }[] = [];
  private nextPlanId = 1;
  private released = false;
  private runWaiters: (() => void)[] = [];
  private rockCooldown = 0;
  private lastReset = 0;
  private sources: Source[] = [];

  simTime = 0;
  paused = true;
  speed = 1;
  resetIntervalMin = 60;
  /** Form des Felsens: kantiger Block (bleibt liegen) oder Kugel (rollt). */
  rockShape: 'block' | 'ball' = 'block';
  /** Wartemodus: Die Zeit läuft nur, solange alle beteiligten Agenten in einem Wait stehen. */
  /** Wie weit Gesprochenes zu hören ist, in Einheiten. 0 = überall. */
  hearRange = 30;
  /** Härte der Welt: schnellerer Hunger und Durst, langsameres Nachwachsen der Nahrung. */
  hardness = 1;
  lockstep = false;
  /** Überlegt ein Agent länger als so viele Sekunden (Echtzeit), läuft die Welt ohne ihn weiter. */
  thinkTimeout = 60;
  resetCount = 0;
  chat: { time: number; from: string; text: string }[] = [];
  onReset: (() => void) | null = null;
  /** Höchstalter in Minuten Weltzeit (je Agent ±20 %). */
  lifespanMin = 120;
  /** Zwei Agenten bekommen ein Kind: legt Agent und Arbeitsordner an und ruft addBody auf. */
  onBirth: ((a: string, b: string, pos: Vec3) => { id: string; name: string }) | null = null;
  /** Ein Agent ist gestorben; sein Körper ist schon entfernt. */
  onDeath: ((id: string, info: { name: string; cause: string; age_min: number }) => void) | null = null;
  /** Jemand hat etwas gesagt (auch aus einem Plan heraus). */
  onSay: ((id: string, text: string) => void) | null = null;

  static async create(): Promise<World> {
    await RAPIER.init();
    const w = new World();
    w.build();
    return w;
  }

  private build() {
    this.rw = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.rw.timestep = DT;
    for (const s of STATICS) {
      const b = this.rw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...s.center));
      this.staticBodies.push({ handle: b.handle, part: s });
      this.rw.createCollider(
        RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2).setFriction(0.8),
        b,
      );
    }
    this.spawnObjects();
    this.spawnSources();
  }

  private spawnSources() {
    this.sources = [];
    const bush = (pos: Vec3) => this.sources.push({ id: this.nextId++, name: `Bush_${this.sources.length + 1}`, kind: 'bush', pos, radius: 1, berries: 5, max: 5, regrow: 45, timer: 0 });
    bush([-14, 0, 22]); bush([20, 0, 16]); bush([-30, 0, 14]); bush([30, 0, 26]); bush([-4, 0, -26]);
    this.sources.push({ id: this.nextId++, name: 'Pond_1', kind: 'pond', pos: [12, 0, -26], radius: 3.2, berries: 0, max: 0, regrow: 0, timer: 0 });
  }

  private spawnObjects() {
    // zwölf Würfel als loser Haufen nahe dem Startpunkt
    let i = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        this.addObj('cube', `Cube_${++i}`, [-8 + col * 1.4, 0.5, 8 + row * 1.4], false);
      }
    }
    this.addObj('rock', 'Rock_1', [2, 1.8, -14], false);
    this.addObj('ring', 'Ring_1', [6, 0.3, 24], false);
  }

  private addObj(kind: ObjKind, name: string, pos: Vec3, spawned: boolean): Obj {
    const body = this.rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(...pos).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.4),
    );
    let size: Vec3;
    let color: string;
    if (kind === 'cube') {
      size = [1, 1, 1];
      color = '#b9c0c9';
      this.rw.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setFriction(0.9).setRestitution(0.05).setDensity(1), body);
    } else if (kind === 'rock') {
      size = [1.4, 1.4, 1.4];
      color = '#2a3644';
      this.rw.createCollider(this.rockCollider(), body);
    } else {
      size = [2.8, 0.36, 2.8];
      color = '#e8eef5';
      const R = 1.2;
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        this.rw.createCollider(
          RAPIER.ColliderDesc.cuboid(0.34, 0.16, 0.18)
            .setTranslation(Math.cos(a) * R, 0, Math.sin(a) * R)
            .setRotation(eulerDegToQuat([0, (-a * 180) / Math.PI + 90, 0]))
            .setFriction(0.7)
            .setDensity(0.6),
          body,
        );
      }
    }
    const o: Obj = { id: this.nextId++, name, kind, body, size, color, heldBy: null, lost: false, spawned, initPos: pos, prevVel: [0, 0, 0] };
    this.objs.push(o);
    return o;
  }

  private rockCollider() {
    // beide Formen wiegen etwa gleich viel
    return this.rockShape === 'ball'
      ? RAPIER.ColliderDesc.ball(0.7).setFriction(0.9).setRestitution(0.2).setDensity(3)
      : RAPIER.ColliderDesc.cuboid(0.7, 0.7, 0.7).setFriction(0.9).setRestitution(0.1).setDensity(1.6);
  }

  /** Tauscht die Form des Felsens an Ort und Stelle. */
  setRockShape(shape: 'block' | 'ball') {
    if (shape === this.rockShape) return;
    this.rockShape = shape;
    for (const o of this.objs) {
      if (o.kind !== 'rock') continue;
      for (let i = o.body.numColliders() - 1; i >= 0; i--) this.rw.removeCollider(o.body.collider(i), true);
      this.rw.createCollider(this.rockCollider(), o.body);
      if (!o.heldBy && !o.lost) {
        const t = o.body.translation();
        o.body.setTranslation({ x: t.x, y: t.y + 0.05, z: t.z }, true);
      }
    }
  }

  // ---------- Körper der Agenten ----------

  addBody(id: string, name: string, color: string, opts: BodyOpts = {}) {
    if (this.bodies.has(id)) return;
    const idx = this.bodies.size;
    // spawn ist der Ort fürs Wiederauftauchen nach einem Sturz; Kinder erscheinen anfangs bei den Eltern
    const spawn: Vec3 = [(idx % 4) * 2.5 - 2, 1.2, 14 + Math.floor(idx / 4) * 2.5];
    const body = this.rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(...(opts.pos ?? spawn)).lockRotations().setCcdEnabled(true),
    );
    this.rw.createCollider(RAPIER.ColliderDesc.capsule(P_HALF, P_RAD).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setDensity(1.2), body);
    this.bodies.set(id, { id, name, color, body, target: null, yaw: 0, holding: null, grounded: false, spawn, waits: 0, lastAct: 0, driven: false, move: 'idle', block: null, mv: [0, 0], bestD: Infinity, stuck: 0, events: [], heard: [], plan: null, lookYaw: null, auto: false, idle: 0, nextLook: 0, needs: { hunger: 0.2, thirst: 0.2, boredom: 0, joy: 0.7, health: 1 }, urgent: { hunger: false, thirst: false }, cheer: 0, autoCool: 0, healthLow: false, grief: 0,
      age: 0, lifeFactor: opts.lifeFactor ?? 1, parents: opts.parents ?? [], stage: 'adult', offer: null, nextBirthAge: opts.nextBirthAge ?? 0, dead: null });
    const b = this.bodies.get(id)!;
    b.age = opts.age ?? FOUNDER_AGE * this.lifespan(b);
    b.stage = this.stageOf(b);
    if (b.stage === 'child') b.needs.joy = 0.8;
  }

  // ---------- Lebenszyklus ----------

  private lifespan(b: Body) {
    return this.lifespanMin * 60 * b.lifeFactor;
  }

  private stageOf(b: Body): Stage {
    const f = b.age / this.lifespan(b);
    return f < CHILD_END ? 'child' : f < OLD_START ? 'adult' : 'old';
  }

  /** Grösse für die Darstellung: Kinder wachsen bis zum Erwachsenwerden. */
  private scaleOf(b: Body): number {
    if (b.stage === 'child') return 0.55 + 0.45 * (b.age / this.lifespan(b) / CHILD_END);
    return b.stage === 'old' ? 0.94 : 1;
  }

  /** Alter aller Körper in Sekunden, zum Speichern. */
  stageOf_(id: string): Stage { return this.bodies.get(id)?.stage ?? 'adult'; }

  ages(): Record<string, { age: number; nextBirthAge: number }> {
    return Object.fromEntries([...this.bodies.values()].map((b) => [b.id, { age: b.age, nextBirthAge: b.nextBirthAge }]));
  }

  private tickLife(b: Body) {
    b.age += DT;
    const st = this.stageOf(b);
    if (st !== b.stage) {
      b.stage = st;
      b.events.push({ time: r2(this.simTime), type: 'stage', stage: st, word: STAGE_WORD[st] });
    }
    if (!b.dead && b.age >= this.lifespan(b)) b.dead = 'Altersschwäche';
    if (b.offer && b.offer.until < this.simTime) b.offer = null;
  }

  /** Warum b (noch) kein Kind bekommen kann, oder null. */
  private mateProblem(b: Body, self: boolean): string | null {
    const who = self ? 'Du bist' : `${b.name} ist`;
    if (b.stage === 'child') return `${who} noch ein Kind.`;
    if (b.stage === 'old') return `${who} zu alt.`;
    if (b.age < b.nextBirthAge) return `${self ? 'Du hattest' : `${b.name} hatte`} erst ein Kind; wieder möglich in ${Math.ceil((b.nextBirthAge - b.age) / 60)} min.`;
    if (b.needs.hunger >= 0.6) return `${who} zu hungrig.`;
    if (b.needs.thirst >= 0.6) return `${who} zu durstig.`;
    if (b.needs.joy < 0.5) return `${who} nicht froh genug (Freude ${r2(b.needs.joy)}, nötig 0.5).`;
    return null;
  }

  /** Fortpflanzung braucht die Zustimmung beider: Beide rufen reproduce mit dem anderen auf. */
  reproduce(id: string, data: { name?: unknown }) {
    const b = this.need(id);
    const name = String(data?.name ?? '').trim();
    if (!name) return { ok: false, error: 'name fehlt: Mit wem möchtest du ein Kind?' };
    const o = [...this.bodies.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!o) return { ok: false, error: `"${name}" gibt es nicht.` };
    if (o === b) return { ok: false, error: 'Dafür braucht es zwei.' };
    const pa = b.body.translation(), pb = o.body.translation();
    const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
    if (dist > MATE_RANGE) return { ok: false, error: `${o.name} ist zu weit weg (${r2(dist)}, höchstens ${MATE_RANGE}). Geht näher zusammen.` };
    const mine = this.mateProblem(b, true);
    if (mine) return { ok: false, error: mine };
    if (o.stage !== 'adult') return { ok: false, error: this.mateProblem(o, false)! };
    if (o.offer?.to !== b.id || o.offer.until < this.simTime) {
      b.offer = { to: o.id, until: this.simTime + OFFER_TIME };
      o.events.push({ time: r2(this.simTime), type: 'reproduce_request', from: b.name, expires_in: OFFER_TIME });
      this.interruptWaits(o, 'reproduce_request');
      return { ok: true, waiting_for: o.name, expires_in: OFFER_TIME, hint: `${o.name} muss innerhalb von ${OFFER_TIME} Sekunden ebenfalls Reproduce mit dir aufrufen.` };
    }
    // beide wollen: jetzt zählt auch der Zustand des anderen
    const theirs = this.mateProblem(o, false);
    if (theirs) return { ok: false, error: theirs };
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    const len = Math.hypot(dx, dz) || 1;
    const mid: Vec3 = [(pa.x + pb.x) / 2, Math.max(pa.y, pb.y), (pa.z + pb.z) / 2];
    // neben die Eltern statt zwischen sie, falls dort Boden ist
    const side: Vec3 = [mid[0] - (dz / len) * 1.3, mid[1] + 0.2, mid[2] + (dx / len) * 1.3];
    const pos: Vec3 = this.safeGround(b, side[0], side[2]) ? side : [mid[0], mid[1] + 1.8, mid[2]];
    let child: { id: string; name: string } | undefined;
    try { child = this.onBirth?.(b.id, o.id, pos); } catch (e: any) { return { ok: false, error: `Geburt gescheitert: ${e?.message || e}` }; }
    if (!child) return { ok: false, error: 'In dieser Welt können keine Kinder entstehen.' };
    b.offer = null;
    o.offer = null;
    for (const x of [b, o]) {
      x.nextBirthAge = x.age + BIRTH_COOLDOWN;
      x.needs.hunger = clamp01(x.needs.hunger + 0.2); // ein Kind kostet Kraft
      x.cheer = Math.min(1, x.cheer + 0.5);
    }
    const t = r2(this.simTime);
    b.events.push({ time: t, type: 'birth', child: child.name, partner: o.name });
    o.events.push({ time: t, type: 'birth', child: child.name, partner: b.name });
    this.interruptWaits(o, 'birth');
    return { ok: true, child: child.name };
  }

  /** Entfernt einen gestorbenen Körper und sagt es denen, die es erfahren. */
  private kill(b: Body) {
    const cause = b.dead!;
    const p = b.body.translation();
    const at = { x: p.x, y: p.y, z: p.z };
    const info = { name: b.name, cause, age_min: r2(b.age / 60) };
    if (b.plan?.status === 'running') b.plan.status = 'cancelled';
    this.interruptWaits(b, 'death');
    this.removeBody(b.id);
    const t = r2(this.simTime);
    for (const o of this.bodies.values()) {
      if (o.offer?.to === b.id) o.offer = null;
      const q = o.body.translation();
      const dist = Math.hypot(q.x - at.x, q.y - at.y, q.z - at.z);
      // Familie erfährt es überall, alle anderen nur in Hörweite
      const relation = o.parents.some((x) => x.id === b.id) ? 'Elternteil' : b.parents.some((x) => x.id === o.id) ? 'Kind' : null;
      if (!relation && this.hearRange > 0 && dist > this.hearRange) continue;
      o.events.push({ time: t, type: 'death', name: b.name, cause, age_min: info.age_min, distance: r2(dist), ...(relation ? { relation } : {}) });
      o.grief = Math.min(1, o.grief + (relation ? 0.6 : 0.15));
      this.interruptWaits(o, 'death');
    }
    this.onDeath?.(b.id, info);
  }

  removeBody(id: string) {
    const b = this.bodies.get(id);
    if (!b) return;
    if (b.holding) this.release(b, v3(b.body.translation()), null, [0, 0, 0]);
    this.rw.removeRigidBody(b.body);
    this.bodies.delete(id);
  }

  updateBody(id: string, name: string, color: string) {
    const b = this.bodies.get(id);
    if (b) { b.name = name; b.color = color; }
  }

  private need(id: string): Body {
    const b = this.bodies.get(id);
    if (!b) throw new Error('Agent hat keinen Körper in der Welt');
    return b;
  }

  // ---------- Wartemodus ----------

  /** Der Agent hat sich gerade gerührt (irgendein Aufruf). */
  touch(id: string) {
    const b = this.bodies.get(id);
    if (b) b.lastAct = performance.now();
  }

  setDriven(id: string, on: boolean) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.driven = on;
    if (on) b.lastAct = performance.now();
  }

  /** wait = steht in einem Wait · think = überlegt, die Welt wartet auf ihn · away = zu lange still, zählt nicht mit */
  private stateOf(b: Body, now: number): 'wait' | 'think' | 'away' | null {
    // solange der Körper einen Plan abarbeitet, hält der Geist die Welt nicht auf
    if (b.waits > 0 || (b.plan?.status === 'running' && !b.plan.auto)) return 'wait';
    if (b.lastAct === 0) return b.driven ? 'think' : null;
    return now - b.lastAct < this.thinkTimeout * 1000 ? 'think' : b.driven || now - b.lastAct < 600_000 ? 'away' : null;
  }

  /** Namen der Agenten, auf die die Welt im Wartemodus gerade wartet. */
  holders(): string[] {
    if (!this.lockstep) return [];
    const now = performance.now();
    return [...this.bodies.values()].filter((b) => this.stateOf(b, now) === 'think').map((b) => b.name);
  }

  // ---------- Befehle ----------

  private setTarget(b: Body, t: Vec3) {
    b.target = t;
    b.move = 'moving';
    b.block = null;
    b.bestD = Infinity;
    b.stuck = 0;
  }

  jump(id: string) {
    const b = this.need(id);
    if (!b.grounded) return { ok: false, error: 'Nicht am Boden – Springen geht nur mit Bodenkontakt.' };
    const v = b.body.linvel();
    b.body.setLinvel({ x: v.x, y: JUMP_SPEED, z: v.z }, true);
    b.grounded = false;
    return { ok: true };
  }

  stop(id: string) {
    const b = this.need(id);
    if (b.plan?.status === 'running') b.plan.status = 'cancelled';
    b.auto = false;
    b.autoCool = this.simTime + 20;
    b.target = null;
    b.move = 'idle';
    b.block = null;
    return { ok: true };
  }

  pickup(id: string, data: { position?: unknown; name?: string }) {
    const b = this.need(id);
    if (b.holding) return { ok: false, error: `Du hältst bereits ${b.holding.name}.` };
    const p = b.body.translation();
    const near = data?.position ? asVec3(data.position, 'position') : v3(p);
    let best: Obj | null = null;
    let bestD = Infinity;
    for (const o of this.objs) {
      if (o.heldBy || o.lost) continue;
      const t = o.body.translation();
      const reach = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      if (reach > REACH) continue;
      if (data?.name) {
        if (o.name === data.name) { best = o; break; }
        continue;
      }
      const d = Math.hypot(t.x - near[0], t.y - near[1], t.z - near[2]);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return { ok: false, error: `Kein Objekt in Reichweite (${REACH} Einheiten um dich).` };
    best.heldBy = id;
    best.body.setEnabled(false);
    b.holding = best;
    return { ok: true, holding: best.name };
  }

  place(id: string, data: { position?: unknown; rotation?: unknown }) {
    const b = this.need(id);
    if (!b.holding) return { ok: false, error: 'Du hältst nichts.' };
    const pos = asVec3(data?.position, 'position');
    const p = b.body.translation();
    const d = Math.hypot(pos[0] - p.x, pos[1] - p.y, pos[2] - p.z);
    if (d > REACH + 1.5) return { ok: false, error: `Zu weit weg (${r2(d)} > ${REACH + 1.5}). Geh näher heran.` };
    const rot = data?.rotation ? eulerDegToQuat(asVec3(data.rotation, 'rotation')) : { x: 0, y: 0, z: 0, w: 1 };
    const o = b.holding;
    if (o.kind !== 'ring') {
      const shape = o.kind === 'cube' ? new RAPIER.Cuboid(0.47, 0.47, 0.47) : this.rockShape === 'ball' ? new RAPIER.Ball(0.66) : new RAPIER.Cuboid(0.66, 0.66, 0.66);
      const hit = this.rw.intersectionWithShape({ x: pos[0], y: pos[1], z: pos[2] }, rot, shape);
      if (hit) return { ok: false, error: 'Platz ist belegt – dort ist bereits etwas.' };
    }
    this.release(b, pos, rot, [0, 0, 0]);
    return { ok: true, placed: o.name, position: pos };
  }

  throwObj(id: string, data: { direction?: unknown; speed?: unknown }) {
    const b = this.need(id);
    if (!b.holding) return { ok: false, error: 'Du hältst nichts.' };
    const dir = asVec3(data?.direction, 'direction');
    const len = Math.hypot(...dir);
    if (len < 1e-6) return { ok: false, error: 'direction darf nicht [0,0,0] sein.' };
    const max = b.stage === 'child' ? MAX_THROW * 0.5 : MAX_THROW;
    const speed = Math.max(0, Math.min(max, Number(data?.speed) || 0));
    const n: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    const p = b.body.translation();
    const pv = b.body.linvel();
    const o = b.holding;
    const from: Vec3 = [p.x + n[0] * 0.6, p.y + 1.7, p.z + n[2] * 0.6];
    // der Wurf erbt die Geschwindigkeit des Körpers
    const vel: Vec3 = [n[0] * speed + pv.x, n[1] * speed + pv.y, n[2] * speed + pv.z];
    this.release(b, from, null, vel);
    return { ok: true, thrown: o.name, speed };
  }

  say(id: string, text: unknown) {
    const b = this.need(id);
    const t = String(text ?? '').slice(0, 500);
    if (!t) return { ok: false, error: 'text fehlt' };
    const msg = { time: r2(this.simTime), from: b.name, text: t };
    this.onSay?.(id, t);
    this.chat.push(msg);
    if (this.chat.length > 50) this.chat.shift();
    b.heard.push(msg);
    this.social(b);
    const p = b.body.translation();
    const heardBy: string[] = [];
    for (const o of this.bodies.values()) {
      if (o === b) continue;
      const q = o.body.translation();
      const dist = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (this.hearRange > 0 && dist > this.hearRange) continue;
      o.heard.push(msg);
      if (o.heard.length > 30) o.heard.shift();
      o.events.push({ time: msg.time, type: 'heard', from: b.name, text: t, distance: r2(dist) });
      heardBy.push(o.name);
      this.social(o);
      this.interruptWaits(o, 'speech');
    }
    if (b.heard.length > 30) b.heard.shift();
    return { ok: true, heard_by: heardBy };
  }

  /** Wer wartet, wird geweckt: jemand spricht ihn an, oder sein Plan ist fertig. */
  private interruptWaits(b: Body, reason: string) {
    if (!b.waits) return;
    const mine = this.waiters.filter((w) => w.id === b.id);
    this.waiters = this.waiters.filter((w) => w.id !== b.id);
    b.waits = 0;
    b.lastAct = performance.now();
    this.released = true;
    mine.forEach((w) => w.resolve(reason));
  }

  // ---------- Pläne: der Körper handelt, der Geist überlegt ----------

  /** Prüft einen Plan, bevor er den laufenden ersetzt. Wirft mit verständlicher Meldung. */
  private checkSteps(raw: unknown): Step[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('steps muss eine nicht-leere Liste von Schritten sein.');
    if (raw.length > MAX_STEPS) throw new Error(`Höchstens ${MAX_STEPS} Schritte pro Plan.`);
    return raw.map((s: any, i) => {
      const at = `Schritt ${i + 1}`;
      const type = String(s?.type || '').toLowerCase();
      if (!(STEP_TYPES as readonly string[]).includes(type)) throw new Error(`${at}: unbekannter Typ "${s?.type}". Erlaubt: ${STEP_TYPES.join(', ')}.`);
      const out: Step = { type };
      // null zählt wie weggelassen (manche Modelle füllen optionale Felder damit)
      if (s.position != null) out.position = asVec3(s.position, `${at}: position`);
      if (s.direction != null) out.direction = asVec3(s.direction, `${at}: direction`);
      if (s.rotation != null) out.rotation = asVec3(s.rotation, `${at}: rotation`);
      for (const k of ['name', 'at', 'text'] as const) if (s[k] != null && s[k] !== '') out[k] = String(s[k]);
      for (const k of ['seconds', 'radius', 'distance', 'speed'] as const) {
        if (s[k] == null) continue;
        const n = Number(s[k]);
        if (!isFinite(n) || n < 0) throw new Error(`${at}: ${k} muss eine Zahl ≥ 0 sein.`);
        out[k] = n;
      }
      const need = (ok: boolean, what: string) => { if (!ok) throw new Error(`${at} (${type}) braucht ${what}.`); };
      if (type === 'goto' || type === 'look') need(!!(out.position || out.name), 'position oder name');
      if (type === 'follow') need(!!out.name, 'name');
      if (type === 'place') need(!!out.position, 'position');
      if (type === 'throw') need(!!(out.direction || out.at || out.position), 'direction, at oder position');
      if (type === 'say') need(!!out.text, 'text');
      if (type === 'wait') need(out.seconds !== undefined, 'seconds');
      if (type === 'eat' && out.name && !this.sources.some((x) => x.kind === 'bush' && x.name.toLowerCase() === out.name!.toLowerCase())) throw new Error(`${at} (eat): "${out.name}" ist kein Beerenbusch.`);
      if (type === 'drink' && out.name && !this.sources.some((x) => x.kind === 'pond' && x.name.toLowerCase() === out.name!.toLowerCase())) throw new Error(`${at} (drink): "${out.name}" ist kein Teich.`);
      return out;
    });
  }

  /** Gibt dem Körper einen Plan. Kehrt sofort zurück; sofort mögliche Schritte sind dann schon erledigt. */
  act(id: string, data: { intent?: unknown; steps?: unknown; append?: unknown }) {
    const b = this.need(id);
    const steps = this.checkSteps(data?.steps);
    const intent = String(data?.intent ?? '').slice(0, 200);
    if (data?.append && b.plan?.status === 'running' && !b.plan.auto) {
      if (b.plan.steps.length - b.plan.idx + steps.length > MAX_STEPS) throw new Error(`Höchstens ${MAX_STEPS} offene Schritte.`);
      b.plan.steps.push(...steps);
      if (intent) b.plan.intent = intent;
    } else {
      if (b.plan?.status === 'running') b.plan.status = 'cancelled';
      b.auto = false;
      b.target = null;
      b.move = 'idle';
      b.plan = { id: this.nextPlanId++, intent, steps, idx: 0, status: 'running', sub: {} };
      this.advance(b);
    }
    const plan = this.planInfo(b);
    return plan?.status === 'failed' ? { ok: false, error: plan.error, plan } : { ok: true, plan };
  }

  private describe(s: Step): string {
    const where = s.name ?? s.at ?? (s.position ? `[${s.position.join(', ')}]` : '');
    return [s.type, where, s.text ? `"${s.text.slice(0, 40)}"` : '', s.seconds !== undefined ? `${s.seconds}s` : ''].filter(Boolean).join(' ');
  }

  private planInfo(b: Body) {
    const p = b.plan;
    if (!p) return null;
    const cur = p.steps[Math.min(p.idx, p.steps.length - 1)];
    return {
      id: p.id, intent: p.intent, status: p.status, ...(p.auto ? { auto: true } : {}),
      step: Math.min(p.idx + 1, p.steps.length), of: p.steps.length,
      current: this.describe(cur),
      ...(p.error ? { error: p.error } : {}),
    };
  }

  private finish(b: Body, status: 'done' | 'failed', error?: string) {
    const p = b.plan!;
    p.status = status;
    if (error) p.error = error;
    b.target = null;
    if (b.move === 'moving' || b.move === 'blocked') b.move = 'idle';
    b.idle = 0;
    if (p.auto) { b.autoCool = this.simTime + (status === 'failed' ? 15 : 3); return; }
    // im Wartemodus ist der Agent ab jetzt wieder am Zug: den laufenden Zeitschub hier beenden
    this.released = true;
    b.events.push({ time: r2(this.simTime), type: status === 'done' ? 'plan_done' : 'plan_failed', plan_id: p.id, intent: p.intent, ...(error ? { step: p.idx + 1, error } : {}) });
    this.interruptWaits(b, status === 'done' ? 'plan_done' : 'plan_failed');
  }

  /** Arbeitet den Plan ab, solange Schritte sofort fertig werden. */
  private advance(b: Body) {
    for (let guard = 0; guard < MAX_STEPS + 1; guard++) {
      const p = b.plan;
      if (!p || p.status !== 'running') return;
      const s = p.steps[p.idx];
      if (!p.sub.t0 && p.sub.t0 !== 0) p.sub.t0 = this.simTime;
      let r: 'done' | 'running' | { fail: string };
      try { r = this.runStep(b, s, p.sub); } catch (e: any) { r = { fail: e?.message || String(e) }; }
      if (r === 'running') return;
      if (r !== 'done') return this.finish(b, 'failed', r.fail);
      p.idx++;
      p.sub = {};
      if (p.idx >= p.steps.length) return this.finish(b, 'done');
    }
  }

  /** Position eines benannten Dings: Objekt, Agent oder Plattform (Oberkante). */
  private locate(name: string): Vec3 | null {
    const n = name.toLowerCase();
    const o = this.objs.find((x) => !x.lost && x.name.toLowerCase() === n);
    if (o) {
      const holder = o.heldBy ? this.bodies.get(o.heldBy) : null;
      return v3((holder ?? o).body.translation());
    }
    const src = this.sources.find((x) => x.name.toLowerCase() === n);
    if (src) return src.pos;
    const other = [...this.bodies.values()].find((x) => x.name.toLowerCase() === n);
    if (other) return v3(other.body.translation());
    const st = STATICS.find((x) => x.name.toLowerCase() === n);
    if (st) return [st.center[0], st.center[1] + st.size[1] / 2, st.center[2]];
    return null;
  }

  /** Läuft zu pos, bis der waagrechte Abstand ≤ radius ist. Springt selbst über niedrige Hindernisse. */
  private walkTo(b: Body, ws: Record<string, any>, pos: Vec3, radius: number): 'done' | 'running' | { fail: string } {
    ws.t0 ??= this.simTime;
    const p = b.body.translation();
    const d = Math.hypot(pos[0] - p.x, pos[2] - p.z);
    if (d <= radius) {
      b.target = null;
      b.move = 'arrived';
      return 'done';
    }
    // bewegliche Ziele nachführen, ohne die Hinderniserkennung bei jedem Schritt zurückzusetzen
    if (!b.target || Math.hypot(b.target[0] - pos[0], b.target[2] - pos[2]) > 0.5) {
      const keep = b.target ? { bestD: b.bestD, stuck: b.stuck, move: b.move, block: b.block } : null;
      this.setTarget(b, pos);
      if (keep && keep.move === 'blocked') Object.assign(b, keep);
    }
    if (b.move === 'blocked') {
      const h = b.block?.height_above_feet;
      ws.jumps ??= 0;
      if (b.grounded && ws.jumps < 3 && (h === undefined || h <= MAX_JUMP_UP)) {
        this.jump(b.id);
        ws.jumps++;
        b.move = 'moving';
        b.stuck = 0;
        b.bestD = Infinity;
      } else if (b.stuck > 2.5) {
        return { fail: `Weg blockiert${b.block?.by ? ` von ${b.block.by}` : ''}${h !== undefined ? ` (${h} über deinen Füssen)` : ''}.` };
      }
    }
    if (this.simTime - ws.t0 > 90) return { fail: 'Ziel nach 90 Sekunden nicht erreicht.' };
    return 'running';
  }

  private runStep(b: Body, s: Step, st: Record<string, any>): 'done' | 'running' | { fail: string } {
    const elapsed = this.simTime - st.t0;
    const where = (key: 'name' | 'at' = 'name'): Vec3 | { fail: string } => {
      const n = s[key];
      if (n) return this.locate(n) ?? { fail: `"${n}" gibt es nicht (mehr).` };
      return s.position!;
    };
    switch (s.type) {
      case 'goto': {
        const pos = where();
        if (!Array.isArray(pos)) return pos;
        return this.walkTo(b, st, pos, s.radius ?? (s.name ? 1.6 : 0.3));
      }
      case 'follow': {
        if (elapsed >= (s.seconds ?? 20)) { b.target = null; return 'done'; }
        const pos = where();
        if (!Array.isArray(pos)) return pos;
        st.ws ??= {};
        const w = this.walkTo(b, st.ws, pos, s.distance ?? 2);
        if (typeof w === 'object') return w;
        if (w === 'done') { st.ws = {}; this.lookAt(b, pos); }
        return 'running';
      }
      case 'pickup': {
        if (b.holding) return { fail: `Du hältst bereits ${b.holding.name}.` };
        let o: Obj | undefined;
        if (s.name) o = this.objs.find((x) => !x.lost && x.name.toLowerCase() === s.name!.toLowerCase());
        else {
          const near = s.position ?? v3(b.body.translation());
          let best = Infinity;
          for (const x of this.objs) {
            if (x.lost || x.heldBy) continue;
            const t = x.body.translation();
            const d = Math.hypot(t.x - near[0], t.y - near[1], t.z - near[2]);
            if (d < best) { best = d; o = x; }
          }
        }
        if (!o) return { fail: s.name ? `"${s.name}" gibt es nicht (mehr).` : 'Kein freies Objekt zu finden.' };
        if (o.heldBy) return { fail: `${o.name} hält gerade ${this.bodies.get(o.heldBy)?.name ?? 'jemand'}.` };
        const t = o.body.translation();
        const p = b.body.translation();
        if (Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) > REACH - 0.3) {
          const w = this.walkTo(b, st, v3(t), REACH - 1.2);
          if (w !== 'done') return w;
        }
        b.target = null;
        const r = this.pickup(b.id, { name: o.name });
        return r.ok ? 'done' : { fail: r.error! };
      }
      case 'place': {
        if (!b.holding) return { fail: 'Du hältst nichts.' };
        const pos = s.position!;
        const p = b.body.translation();
        if (Math.hypot(pos[0] - p.x, pos[1] - p.y, pos[2] - p.z) > REACH + 1) {
          const w = this.walkTo(b, st, pos, REACH - 1);
          if (w !== 'done') return w;
        }
        b.target = null;
        const r = this.place(b.id, { position: pos, rotation: s.rotation });
        return r.ok ? 'done' : { fail: r.error! };
      }
      case 'throw': {
        if (!b.holding) return { fail: 'Du hältst nichts.' };
        let dir = s.direction;
        let speed = s.speed;
        if (!dir) {
          const tgt = where('at');
          if (!Array.isArray(tgt)) return tgt;
          const p = b.body.translation();
          const dx = tgt[0] - p.x, dz = tgt[2] - p.z;
          const h = Math.max(0.5, Math.hypot(dx, dz));
          // flacher Bogen (rund 27°); Tempo so, dass er etwa dort landet
          dir = [dx, h * 0.5 + Math.max(0, tgt[1] - p.y), dz];
          speed ??= Math.min(MAX_THROW, Math.sqrt(h * -GRAVITY * 1.25) + 0.5);
          this.lookAt(b, tgt);
        }
        const r = this.throwObj(b.id, { direction: dir, speed: speed ?? 12 });
        return r.ok ? 'done' : { fail: r.error! };
      }
      case 'jump': {
        if (b.grounded) { this.jump(b.id); return 'done'; }
        return elapsed > 2 ? { fail: 'Nicht am Boden – Springen geht nur mit Bodenkontakt.' } : 'running';
      }
      case 'say': {
        const r = this.say(b.id, s.text);
        return r.ok ? 'done' : { fail: r.error! };
      }
      case 'look': {
        const pos = where();
        if (!Array.isArray(pos)) return pos;
        this.lookAt(b, pos);
        return 'done';
      }
      case 'eat': {
        // der Busch wird einmal gewählt und dann beibehalten
        st.src ??= (s.name ? this.sources.find((x) => x.name.toLowerCase() === s.name!.toLowerCase()) : this.nearestSource(b, 'bush', true))?.id;
        const src: Source | undefined = this.sources.find((x) => x.id === st.src);
        if (!src) return { fail: s.name ? `"${s.name}" gibt es nicht.` : 'Kein Beerenbusch mit Beeren zu finden.' };
        if (!st.eating) {
          if (src.berries <= 0) return { fail: `${src.name} hat keine Beeren mehr.` };
          const p = b.body.translation();
          if (Math.hypot(src.pos[0] - p.x, src.pos[2] - p.z) > 2.2) {
            st.ws ??= {};
            const w = this.walkTo(b, st.ws, src.pos, 1.6);
            if (w !== 'done') return w;
          }
          st.eating = true; st.next = this.simTime; st.n = 0;
          b.target = null;
          this.lookAt(b, src.pos);
        }
        if (this.simTime >= st.next) {
          if (src.berries <= 0) return st.n > 0 ? 'done' : { fail: `${src.name} hat keine Beeren mehr.` };
          src.berries--;
          st.n++;
          b.needs.hunger = clamp01(b.needs.hunger - BERRY_FOOD);
          b.cheer = Math.min(1, b.cheer + 0.05);
          st.next = this.simTime + EAT_EVERY;
          if (b.needs.hunger <= 0.1) return 'done';
        }
        return 'running';
      }
      case 'drink': {
        const src = s.name ? this.sources.find((x) => x.name.toLowerCase() === s.name!.toLowerCase()) : this.nearestSource(b, 'pond', false);
        if (!src) return { fail: s.name ? `"${s.name}" gibt es nicht.` : 'Kein Teich zu finden.' };
        if (!st.drinking) {
          const p = b.body.translation();
          if (Math.hypot(src.pos[0] - p.x, src.pos[2] - p.z) > src.radius + 1.2) {
            st.ws ??= {};
            const w = this.walkTo(b, st.ws, src.pos, src.radius + 0.8);
            if (w !== 'done') return w;
          }
          st.drinking = true;
          b.target = null;
          this.lookAt(b, src.pos);
        }
        b.needs.thirst = clamp01(b.needs.thirst - DRINK_RATE * DT);
        return b.needs.thirst <= 0.03 ? 'done' : 'running';
      }
      case 'wait':
        return elapsed >= Math.min(60, s.seconds!) ? 'done' : 'running';
      case 'wander': {
        if (elapsed >= (s.seconds ?? 20)) { b.target = null; return 'done'; }
        st.center ??= v3(b.body.translation());
        if (st.pauseUntil > this.simTime) return 'running';
        if (!st.goal) {
          const r = s.radius ?? 6;
          const a = Math.random() * Math.PI * 2;
          const d = r * Math.sqrt(Math.random());
          const g: Vec3 = [clampIsland(st.center[0] + Math.cos(a) * d, 42), st.center[1], clampIsland(st.center[2] + Math.sin(a) * d, 32)];
          if (!this.safeGround(b, g[0], g[2])) return 'running'; // nächsten Physikschritt neu würfeln
          st.goal = g;
          st.ws = {};
        }
        const w = this.walkTo(b, st.ws, st.goal, 0.5);
        if (w !== 'running') { st.goal = null; b.target = null; st.pauseUntil = this.simTime + 0.5 + Math.random() * 2; }
        return 'running';
      }
    }
    return { fail: `Unbekannter Schritt: ${s.type}` };
  }

  private nearestSource(b: Body, kind: Source['kind'], needBerries: boolean): Source | undefined {
    const p = b.body.translation();
    let best: Source | undefined;
    let bd = Infinity;
    for (const x of this.sources) {
      if (x.kind !== kind || (needBerries && x.berries <= 0)) continue;
      const d = Math.hypot(x.pos[0] - p.x, x.pos[2] - p.z);
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }

  /** Reden und Zuhören vertreiben Langeweile und machen froh. */
  private social(b: Body) {
    b.needs.boredom = clamp01(b.needs.boredom - 0.12);
    b.cheer = Math.min(1, b.cheer + 0.15);
  }

  /** Wörter für den Geist: eine Zahl von 0 bis 1 allein sagt wenig. */
  private word(kind: 'hunger' | 'thirst' | 'boredom' | 'joy' | 'health', v: number): string {
    const scale: Record<string, string[]> = {
      hunger: ['satt', 'nicht hungrig', 'etwas hungrig', 'hungrig', 'sehr hungrig', 'am Verhungern'],
      thirst: ['nicht durstig', 'kaum durstig', 'etwas durstig', 'durstig', 'sehr durstig', 'am Verdursten'],
      boredom: ['angeregt', 'beschäftigt', 'etwas gelangweilt', 'gelangweilt', 'sehr gelangweilt', 'verzweifelt gelangweilt'],
      joy: ['niedergeschlagen', 'bedrückt', 'gedämpft', 'zufrieden', 'froh', 'überglücklich'],
      // Gesundheit: 1 = gesund, daher umgekehrt gelesen
      health: ['dem Tod nah', 'schwer angeschlagen', 'angeschlagen', 'leicht angeschlagen', 'gesund', 'kerngesund'],
    };
    return scale[kind][Math.min(5, Math.floor(v * 5.99))];
  }

  private needsInfo(b: Body) {
    const out: Record<string, { value: number; word: string }> = {};
    for (const k of ['hunger', 'thirst', 'boredom', 'joy', 'health'] as const) out[k] = { value: r2(b.needs[k]), word: this.word(k, b.needs[k]) };
    return out;
  }

  /** Bedürfnisse laufen mit der Weltzeit: Hunger und Durst steigen, Langeweile bei Stillstand, Gesundheit leidet. */
  private tickNeeds(b: Body) {
    const n = b.needs;
    const hard = this.hardness;
    const v = b.body.linvel();
    const walking = b.grounded && Math.hypot(v.x, v.z) > 0.5;
    n.hunger = clamp01(n.hunger + HUNGER_RATE * hard * (walking ? 1.5 : 1) * DT);
    n.thirst = clamp01(n.thirst + THIRST_RATE * hard * (walking ? 1.3 : 1) * DT);
    // Langeweile sinkt, wenn man sich bewegt (Neues sieht), steigt sonst
    n.boredom = clamp01(n.boredom + (walking ? -BORED_RATE * 1.2 : BORED_RATE) * DT);
    b.cheer = Math.max(0, b.cheer - DT / 60);
    b.grief = Math.max(0, b.grief - DT / 600);
    const target = clamp01(0.85 - 0.5 * n.hunger - 0.5 * n.thirst - 0.4 * n.boredom + b.cheer * 0.4 - b.grief * 0.6);
    n.joy = clamp01(n.joy + (target - n.joy) * Math.min(1, DT * 0.1));
    if (n.boredom >= 1) n.joy = Math.max(0, n.joy - 0.1 * DT);
    let dmg = 0;
    if (n.hunger >= 1) dmg += 0.01;
    if (n.thirst >= 1) dmg += 0.02;
    if (dmg) n.health = clamp01(n.health - dmg * DT);
    else if (n.hunger < 0.7 && n.thirst < 0.7) n.health = clamp01(n.health + 0.005 * DT);
    for (const k of ['hunger', 'thirst'] as const) {
      if (!b.urgent[k] && n[k] >= URGENT) {
        b.urgent[k] = true;
        b.events.push({ time: r2(this.simTime), type: 'need_urgent', need: k, word: this.word(k, n[k]) });
        this.interruptWaits(b, 'need_urgent');
      } else if (b.urgent[k] && n[k] < 0.6) b.urgent[k] = false;
    }
    if (!b.healthLow && n.health < 0.3) {
      b.healthLow = true;
      b.events.push({ time: r2(this.simTime), type: 'health_low', word: this.word('health', n.health) });
      this.interruptWaits(b, 'health_low');
    } else if (b.healthLow && n.health > 0.45) b.healthLow = false;
    if (n.health <= 0 && !b.dead) b.dead = n.thirst >= 1 ? 'verdurstet' : n.hunger >= 1 ? 'verhungert' : 'erschöpft';
  }

  private tickSources() {
    for (const s of this.sources) {
      if (s.kind !== 'bush' || s.berries >= s.max) { s.timer = 0; continue; }
      s.timer += DT;
      if (s.timer >= s.regrow * this.hardness) { s.berries++; s.timer = 0; }
    }
  }

  /** Liegt bei (x, z) Boden auf etwa gleicher Höhe wie die Füsse – und auf dem Weg dorthin keine Kante? */
  private safeGround(b: Body, x: number, z: number): boolean {
    const p = b.body.translation();
    const feet = p.y - P_FOOT;
    const n = Math.max(1, Math.ceil(Math.hypot(x - p.x, z - p.z) / 0.5));
    for (let i = 1; i <= n; i++) {
      const sx = p.x + ((x - p.x) * i) / n, sz = p.z + ((z - p.z) * i) / n;
      const hit = this.rw.castRay(new RAPIER.Ray({ x: sx, y: feet + 0.6, z: sz }, { x: 0, y: -1, z: 0 }), 1.2, true, undefined, undefined, undefined, b.body);
      if (!hit || Math.abs(feet + 0.6 - hit.timeOfImpact - feet) > 0.4) return false;
    }
    return true;
  }

  private lookAt(b: Body, pos: Vec3) {
    const p = b.body.translation();
    if (Math.hypot(pos[0] - p.x, pos[2] - p.z) > 0.05) b.lookYaw = Math.atan2(pos[0] - p.x, pos[2] - p.z);
  }

  /** Ohne Plan steht der Körper nicht steif da: er schaut sich um und schlendert ab und zu. */
  private idleBody(b: Body) {
    b.idle += DT;
    if (this.simTime >= b.autoCool && !b.auto && !b.target) {
      const n = b.needs;
      let steps: Step[] | null = null;
      let why = '';
      if (n.thirst >= 0.55 && n.thirst >= n.hunger && this.nearestSource(b, 'pond', false)) { steps = [{ type: 'drink' }]; why = 'trinken'; }
      else if (n.hunger >= 0.55 && this.nearestSource(b, 'bush', true)) { steps = [{ type: 'eat' }]; why = 'essen'; }
      else if (n.boredom >= 0.7) { steps = [{ type: 'wander', radius: 12, seconds: 15 }]; why = 'umherschlendern'; }
      if (steps) {
        b.plan = { id: this.nextPlanId++, intent: `(von selbst) ${why}`, steps, idx: 0, status: 'running', auto: true, sub: {} };
        b.autoCool = this.simTime + 3;
        this.advance(b);
        return;
      }
    }
    if (b.auto) {
      if (!b.target || b.move === 'blocked') { b.auto = false; b.target = null; b.move = 'idle'; }
      return;
    }
    if (b.target || this.simTime < b.nextLook) return;
    b.nextLook = this.simTime + 2 + Math.random() * 4;
    const p = b.body.translation();
    let near: Body | null = null;
    let best = 10;
    for (const o of this.bodies.values()) {
      if (o === b) continue;
      const q = o.body.translation();
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < best) { best = d; near = o; }
    }
    const a = Math.random() * Math.PI * 2;
    const d = 1.5 + Math.random() * 2;
    const goal: Vec3 = [clampIsland(p.x + Math.cos(a) * d, 42), p.y, clampIsland(p.z + Math.sin(a) * d, 32)];
    if (b.idle > 12 && b.grounded && Math.random() < 0.35 && this.safeGround(b, goal[0], goal[2])) {
      this.setTarget(b, goal);
      b.auto = true;
      b.idle = 4;
    } else if (near && Math.random() < 0.6) this.lookAt(b, v3(near.body.translation()));
    else b.lookYaw = b.yaw + (Math.random() - 0.5) * 2.4;
  }

  private release(b: Body, pos: Vec3, rot: { x: number; y: number; z: number; w: number } | null, vel: Vec3) {
    const o = b.holding!;
    o.body.setEnabled(true);
    o.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    if (rot) o.body.setRotation(rot, true);
    o.body.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
    o.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    o.prevVel = vel;
    o.heldBy = null;
    b.holding = null;
  }

  // ---------- Zeit ----------

  /** Wird mit der echten verstrichenen Zeit aufgerufen; rechnet je nach Tempo mehrere Schritte. */
  tick(realDt: number) {
    if (this.paused) return;
    if (this.holders().length) { this.debt = 0; return; }
    this.debt += Math.min(realDt, 0.1) * this.speed;
    let steps = 0;
    this.released = false;
    while (this.debt >= DT && steps < 40) {
      this.step();
      this.debt -= DT;
      steps++;
      // im Wartemodus endet der Schub genau dort, wo ein Agent wieder an der Reihe ist
      if (this.lockstep && this.released) { this.debt = 0; break; }
    }
    if (steps === 40) this.debt = 0;
  }

  private step() {
    for (const b of this.bodies.values()) {
      this.tickLife(b);
      this.tickNeeds(b);
      if (b.plan?.status === 'running') this.advance(b);
      else this.idleBody(b);
      this.driveBody(b);
    }
    for (const o of this.objs) if (!o.heldBy && !o.lost) o.prevVel = v3(o.body.linvel());
    this.rw.step();
    this.simTime += DT;
    this.rockCooldown -= DT;
    this.tickSources();

    for (const o of this.objs) {
      if (o.heldBy || o.lost) continue;
      const t = o.body.translation();
      if (t.y < -15) {
        o.lost = true;
        o.body.setEnabled(false);
        continue;
      }
      if (o.kind === 'rock' && this.rockCooldown <= 0) {
        const v = o.body.linvel();
        const dv = Math.hypot(v.x - o.prevVel[0], v.y - o.prevVel[1], v.z - o.prevVel[2]);
        if (dv > 9) this.rockImpact(o, dv);
      }
    }
    for (const b of this.bodies.values()) {
      if (b.body.translation().y < -15) {
        if (b.plan?.status === 'running') this.finish(b, 'failed', 'Von der Insel gefallen.');
        this.respawn(b);
        b.events.push({ time: r2(this.simTime), type: 'fell_off_world', respawned_at: b.spawn });
      }
    }
    for (const b of [...this.bodies.values()]) if (b.dead) this.kill(b);

    if (this.waiters.length) {
      const due = this.waiters.filter((w) => w.until <= this.simTime);
      if (due.length) {
        this.waiters = this.waiters.filter((w) => w.until > this.simTime);
        const now = performance.now();
        for (const w of due) {
          const b = w.id ? this.bodies.get(w.id) : undefined;
          if (b) { b.waits = Math.max(0, b.waits - 1); b.lastAct = now; this.released = true; }
          w.resolve(false);
        }
      }
    }
    if (this.resetIntervalMin > 0 && this.simTime - this.lastReset >= this.resetIntervalMin * 60) this.reset();
  }

  private driveBody(b: Body) {
    const p = b.body.translation();
    const v = b.body.linvel();
    b.grounded = v.y <= 0.5 && this.groundBelow(b);
    let vx = 0, vz = 0; // Wunschgeschwindigkeit am Boden
    let arrived = false;
    if (b.target) {
      const dx = b.target[0] - p.x;
      const dz = b.target[2] - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        b.target = null;
        b.move = 'arrived';
        b.block = null;
        arrived = true;
      } else {
        // Kommt der Körper am Boden nicht mehr näher, steht etwas im Weg. Das Ziel bleibt gesetzt,
        // damit ein Sprung ihn weiter in dieselbe Richtung trägt.
        if (d < b.bestD - 0.02) {
          b.bestD = d;
          b.stuck = 0;
          if (b.move === 'blocked') { b.move = 'moving'; b.block = null; }
        } else if (b.grounded) {
          b.stuck += DT;
          if (b.stuck > 0.5 && b.move !== 'blocked') {
            b.move = 'blocked';
            b.block = this.obstacleAhead(b, dx / d, dz / d);
            b.events.push({ time: r2(this.simTime), type: 'blocked', ...b.block });
          }
        }
        const walk = b.stage === 'old' ? WALK_SPEED * 0.7 : WALK_SPEED;
        const s = Math.min(b.auto ? walk * 0.35 : walk, Math.sqrt(2 * DECEL * d * 0.8), d / DT);
        vx = (dx / d) * s;
        vz = (dz / d) * s;
        b.lookYaw = Math.atan2(dx, dz);
      }
    }
    // drehen mit begrenzter Geschwindigkeit statt schlagartig
    if (b.lookYaw !== null) {
      const diff = wrapAngle(b.lookYaw - b.yaw);
      const max = TURN_SPEED * DT;
      b.yaw = wrapAngle(b.yaw + Math.max(-max, Math.min(max, diff)));
    }
    if (b.grounded) {
      // Geschwindigkeit nähert sich dem Wunsch mit begrenzter Beschleunigung
      const ex = vx - b.mv[0], ez = vz - b.mv[1];
      const e = Math.hypot(ex, ez);
      const braking = Math.hypot(vx, vz) < Math.hypot(b.mv[0], b.mv[1]);
      const step = (braking ? DECEL : ACCEL) * DT;
      if (arrived) { b.mv[0] *= 0.5; b.mv[1] *= 0.5; }
      else if (e <= step) { b.mv[0] = vx; b.mv[1] = vz; }
      else { b.mv[0] += (ex / e) * step; b.mv[1] += (ez / e) * step; }
      b.body.setLinvel({ x: b.mv[0], y: v.y, z: b.mv[1] }, true);
    } else {
      b.mv[0] = v.x; b.mv[1] = v.z;
    }
  }

  /** Was steht in Laufrichtung direkt vor dem Körper? */
  private obstacleAhead(b: Body, nx: number, nz: number): Body['block'] {
    const p = b.body.translation();
    const feet = p.y - P_FOOT;
    for (const h of [feet + 0.25, p.y, p.y + P_FOOT - 0.1]) {
      const hit = this.rw.castRay(new RAPIER.Ray({ x: p.x, y: h, z: p.z }, { x: nx, y: 0, z: nz }), 1.6, true, undefined, undefined, undefined, b.body);
      const handle = hit?.collider.parent()?.handle;
      if (handle === undefined) continue;
      const st = this.staticBodies.find((x) => x.handle === handle);
      let name: string | null = null;
      let top = 0;
      if (st) { name = st.part.name; top = st.part.center[1] + st.part.size[1] / 2; }
      const o = this.objs.find((x) => x.body.handle === handle);
      if (o) { name = o.name; top = o.body.translation().y + o.size[1] / 2; }
      const other = [...this.bodies.values()].find((x) => x.body.handle === handle);
      if (other) { name = other.name; top = other.body.translation().y + P_FOOT; }
      if (name) return { by: name, obstacle_top_y: r2(top), height_above_feet: r2(top - feet) };
    }
    return { by: null };
  }

  private groundBelow(b: Body): boolean {
    const p = b.body.translation();
    const offs = [[0, 0], [0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28]];
    for (const [ox, oz] of offs) {
      const ray = new RAPIER.Ray({ x: p.x + ox, y: p.y, z: p.z + oz }, { x: 0, y: -1, z: 0 });
      const hit = this.rw.castRay(ray, P_FOOT + 0.12, true, undefined, undefined, undefined, b.body);
      if (hit) return true;
    }
    return false;
  }

  private respawn(b: Body) {
    b.target = null;
    b.move = 'idle';
    b.block = null;
    b.body.setTranslation({ x: b.spawn[0], y: b.spawn[1], z: b.spawn[2] }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  private rockImpact(rock: Obj, dv: number) {
    const cubes = this.objs.filter((o) => o.kind === 'cube' && !o.lost).length;
    const n = Math.min(3, Math.floor(dv / 9), MAX_CUBES - cubes);
    if (n <= 0) return;
    this.rockCooldown = 0.6;
    const t = rock.body.translation();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const num = this.objs.filter((o) => o.kind === 'cube').length + 1;
      const o = this.addObj('cube', `Cube_${num}`, [t.x + Math.cos(a) * 1.6, t.y + 1.2 + i * 1.1, t.z + Math.sin(a) * 1.6], true);
      o.body.setLinvel({ x: Math.cos(a) * 3, y: 4, z: Math.sin(a) * 3 }, true);
    }
  }

  /** Setzt alle Objekte und Körper auf den Anfangszustand zurück. Die Dateien der Agenten bleiben. */
  reset() {
    for (const b of this.bodies.values()) {
      b.holding = null;
      if (b.plan?.status === 'running') b.plan.status = 'cancelled';
      b.auto = false;
      b.offer = null;
      this.respawn(b);
      b.events.push({ time: r2(this.simTime), type: 'world_reset' });
    }
    for (const o of this.objs) this.rw.removeRigidBody(o.body);
    this.objs = [];
    this.spawnObjects();
    for (const s of this.sources) { s.berries = s.max; s.timer = 0; }
    this.lastReset = this.simTime;
    this.resetCount++;
    this.onReset?.();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) {
      const w = this.runWaiters;
      this.runWaiters = [];
      w.forEach((r) => r());
    }
  }

  /** Wartet, bis die Simulation läuft. Liefert false, wenn sie nach timeoutMs noch pausiert ist. */
  whenRunning(timeoutMs = 0): Promise<boolean> {
    if (!this.paused) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const fin = (v: boolean) => { if (!done) { done = true; resolve(v); } };
      this.runWaiters.push(() => fin(true));
      if (timeoutMs > 0) setTimeout(() => fin(false), timeoutMs);
    });
  }

  /** Wartet eine Spanne in Simulationszeit (läuft bei Pause nicht weiter). */
  /** Liefert den Grund, wenn das Warten vorzeitig endete (speech, plan_done, plan_failed), sonst false. */
  waitSim(seconds: number, id?: string): Promise<string | false> {
    const b = id ? this.bodies.get(id) : undefined;
    if (b) b.waits++;
    return new Promise((resolve) => this.waiters.push({ until: this.simTime + seconds, resolve, id: b ? id : undefined }));
  }

  get nextResetIn(): number | null {
    return this.resetIntervalMin > 0 ? this.resetIntervalMin * 60 - (this.simTime - this.lastReset) : null;
  }

  // ---------- Ausgabe ----------

  /** Beobachtung für einen Agenten – reiner Text/JSON, keine Bilder. */
  observe(id: string) {
    const b = this.need(id);
    const p = b.body.translation();
    const entities: any[] = STATICS.map((s) => ({
      name: s.name, entity_type: 'part', shape: 'block', anchored: true,
      position: s.center, size: s.size,
      top_y: r2(s.center[1] + s.size[1] / 2),
    }));
    for (const o of this.objs) {
      if (o.lost) continue;
      const holder = o.heldBy ? this.bodies.get(o.heldBy) : null;
      const t = holder ? holder.body.translation() : o.body.translation();
      const q = o.body.rotation();
      entities.push({
        name: o.name, entity_type: o.kind,
        shape: o.kind === 'cube' ? 'block' : o.kind === 'rock' ? this.rockShape : 'ring',
        anchored: false,
        position: holder ? [r2(t.x), r2(t.y + 1.7), r2(t.z)] : rv3(t),
        size: o.size,
        rotation: [r2(q.x), r2(q.y), r2(q.z), r2(q.w)],
        color: o.color,
        ...(holder ? { held_by: holder.name } : {}),
      });
    }
    for (const s of this.sources) {
      entities.push(s.kind === 'bush'
        ? { name: s.name, entity_type: 'berry_bush', anchored: true, position: s.pos, berries: s.berries, max_berries: s.max }
        : { name: s.name, entity_type: 'pond', anchored: true, position: s.pos, radius: s.radius });
    }
    for (const other of this.bodies.values()) {
      if (other.id === id) continue;
      entities.push({
        name: other.name, entity_type: 'agent', shape: 'capsule', anchored: false,
        position: rv3(other.body.translation()), size: [P_RAD * 2, (P_HALF + P_RAD) * 2, P_RAD * 2],
        color: other.color, holding: other.holding?.name ?? null, stage: other.stage,
      });
    }
    return {
      time: r2(this.simTime),
      next_world_reset_in: this.nextResetIn === null ? null : r2(this.nextResetIn),
      self: {
        name: b.name,
        position: rv3(p),
        feet_y: r2(p.y - P_FOOT),
        velocity: rv3(b.body.linvel()),
        grounded: b.grounded,
        holding: b.holding?.name ?? null,
        move_target: b.target,
        move: { status: b.move, ...(b.target ? { target: b.target } : {}), ...(b.block || {}) },
        plan: this.planInfo(b),
        needs: this.needsInfo(b),
        life: this.lifeInfo(b),
        ...(b.auto ? { autopilot: 'schlendert ein paar Schritte' } : {}),
      },
      events: b.events.splice(0),
      chat: b.heard.slice(-10),
      entities,
    };
  }

  private lifeInfo(b: Body) {
    const children = [...this.bodies.values()].filter((x) => x.parents.some((p) => p.id === b.id)).map((x) => x.name);
    const offers = [...this.bodies.values()].filter((x) => x.offer?.to === b.id && x.offer.until >= this.simTime)
      .map((x) => ({ from: x.name, expires_in: r2(x.offer!.until - this.simTime) }));
    return {
      age_min: Math.round(b.age / 60), stage: b.stage, word: STAGE_WORD[b.stage],
      ...(b.parents.length ? { parents: b.parents.map((p) => p.name) } : {}),
      ...(children.length ? { children } : {}),
      ...(offers.length ? { reproduce_offers: offers } : {}),
      ...(b.offer && b.offer.until >= this.simTime ? { waiting_for: this.bodies.get(b.offer.to)?.name } : {}),
    };
  }

  /** Kompakter Zustand für die 3D-Ansicht. */
  snapshot() {
    const now = performance.now();
    const agents = [...this.bodies.values()].map((b) => {
      const p = b.body.translation();
      return { st: this.lockstep ? this.stateOf(b, now) : null, id: b.id, name: b.name, color: b.color, p: [r2(p.x), r2(p.y - P_FOOT), r2(p.z)], yaw: r2(b.yaw), ly: b.lookYaw === null ? undefined : r2(b.lookYaw), holding: b.holding?.id ?? null, moving: !!b.target, grounded: b.grounded, n: [r2(b.needs.hunger), r2(b.needs.thirst), r2(b.needs.boredom), r2(b.needs.joy), r2(b.needs.health)], g: b.stage, ag: Math.floor(b.age / 60), sc: r2(this.scaleOf(b)), in: b.plan?.status === 'running' ? b.plan.intent || b.plan.steps[b.plan.idx]?.type || '' : '' };
    });
    const objs = this.objs.filter((o) => !o.lost).map((o) => {
      const holder = o.heldBy ? this.bodies.get(o.heldBy) : null;
      const t = holder ? holder.body.translation() : o.body.translation();
      const q = o.body.rotation();
      return {
        id: o.id, kind: o.kind, name: o.name, ...(o.kind === 'rock' ? { s: this.rockShape } : {}),
        p: holder ? [r2(t.x), r2(t.y + 1.7), r2(t.z)] : [r2(t.x), r2(t.y), r2(t.z)],
        q: [r2(q.x), r2(q.y), r2(q.z), r2(q.w)],
      };
    });
    return {
      t: 'snap', time: r2(this.simTime), paused: this.paused, speed: this.speed, lock: this.lockstep, hold: this.holders(),
      resetIn: this.nextResetIn === null ? null : Math.round(this.nextResetIn), resetCount: this.resetCount,
      agents, objs,
      src: this.sources.map((s) => ({ id: s.id, k: s.kind, p: s.pos, r: s.radius, b: s.berries, m: s.max })),
    };
  }
}
