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
}

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
  private bodies = new Map<string, Body>();
  private nextId = 1;
  private debt = 0;
  private waiters: { until: number; resolve: () => void }[] = [];
  private runWaiters: (() => void)[] = [];
  private rockCooldown = 0;
  private lastReset = 0;

  simTime = 0;
  paused = true;
  speed = 1;
  resetIntervalMin = 60;
  resetCount = 0;
  chat: { time: number; from: string; text: string }[] = [];
  onReset: (() => void) | null = null;

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
      this.rw.createCollider(
        RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2).setFriction(0.8),
        b,
      );
    }
    this.spawnObjects();
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
      this.rw.createCollider(RAPIER.ColliderDesc.ball(0.7).setFriction(0.9).setRestitution(0.2).setDensity(3), body);
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

  // ---------- Körper der Agenten ----------

  addBody(id: string, name: string, color: string) {
    if (this.bodies.has(id)) return;
    const idx = this.bodies.size;
    const spawn: Vec3 = [(idx % 4) * 2.5 - 2, 1.2, 14 + Math.floor(idx / 4) * 2.5];
    const body = this.rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(...spawn).lockRotations().setCcdEnabled(true),
    );
    this.rw.createCollider(RAPIER.ColliderDesc.capsule(P_HALF, P_RAD).setFriction(0).setDensity(1.2), body);
    this.bodies.set(id, { id, name, color, body, target: null, yaw: 0, holding: null, grounded: false, spawn });
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

  // ---------- Befehle ----------

  moveTo(id: string, position: unknown) {
    const b = this.need(id);
    b.target = asVec3(position, 'position');
    return { ok: true, target: b.target };
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
    b.target = null;
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
      const shape = o.kind === 'cube' ? new RAPIER.Cuboid(0.47, 0.47, 0.47) : new RAPIER.Ball(0.66);
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
    const speed = Math.max(0, Math.min(MAX_THROW, Number(data?.speed) || 0));
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
    this.chat.push({ time: r2(this.simTime), from: b.name, text: t });
    if (this.chat.length > 50) this.chat.shift();
    return { ok: true };
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
    this.debt += Math.min(realDt, 0.1) * this.speed;
    let steps = 0;
    while (this.debt >= DT && steps < 40) {
      this.step();
      this.debt -= DT;
      steps++;
    }
    if (steps === 40) this.debt = 0;
  }

  private step() {
    for (const b of this.bodies.values()) this.driveBody(b);
    for (const o of this.objs) if (!o.heldBy && !o.lost) o.prevVel = v3(o.body.linvel());
    this.rw.step();
    this.simTime += DT;
    this.rockCooldown -= DT;

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
      if (b.body.translation().y < -15) this.respawn(b);
    }

    if (this.waiters.length) {
      const due = this.waiters.filter((w) => w.until <= this.simTime);
      if (due.length) {
        this.waiters = this.waiters.filter((w) => w.until > this.simTime);
        due.forEach((w) => w.resolve());
      }
    }
    if (this.resetIntervalMin > 0 && this.simTime - this.lastReset >= this.resetIntervalMin * 60) this.reset();
  }

  private driveBody(b: Body) {
    const p = b.body.translation();
    const v = b.body.linvel();
    b.grounded = v.y <= 0.5 && this.groundBelow(b);
    let vx = b.grounded ? 0 : v.x;
    let vz = b.grounded ? 0 : v.z;
    if (b.target) {
      const dx = b.target[0] - p.x;
      const dz = b.target[2] - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        b.target = null;
        vx = 0; vz = 0;
      } else {
        const s = Math.min(WALK_SPEED, d / DT);
        vx = (dx / d) * s;
        vz = (dz / d) * s;
        b.yaw = Math.atan2(dx, dz);
      }
    }
    b.body.setLinvel({ x: vx, y: v.y, z: vz }, true);
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
      this.respawn(b);
    }
    for (const o of this.objs) this.rw.removeRigidBody(o.body);
    this.objs = [];
    this.spawnObjects();
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
  waitSim(seconds: number): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ until: this.simTime + seconds, resolve }));
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
        shape: o.kind === 'cube' ? 'block' : o.kind === 'rock' ? 'ball' : 'ring',
        anchored: false,
        position: holder ? [r2(t.x), r2(t.y + 1.7), r2(t.z)] : rv3(t),
        size: o.size,
        rotation: [r2(q.x), r2(q.y), r2(q.z), r2(q.w)],
        color: o.color,
        ...(holder ? { held_by: holder.name } : {}),
      });
    }
    for (const other of this.bodies.values()) {
      if (other.id === id) continue;
      entities.push({
        name: other.name, entity_type: 'agent', shape: 'capsule', anchored: false,
        position: rv3(other.body.translation()), size: [P_RAD * 2, (P_HALF + P_RAD) * 2, P_RAD * 2],
        color: other.color, holding: other.holding?.name ?? null,
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
      },
      chat: this.chat.slice(-10),
      entities,
    };
  }

  /** Kompakter Zustand für die 3D-Ansicht. */
  snapshot() {
    const agents = [...this.bodies.values()].map((b) => {
      const p = b.body.translation();
      return { id: b.id, name: b.name, color: b.color, p: [r2(p.x), r2(p.y - P_FOOT), r2(p.z)], yaw: r2(b.yaw), holding: b.holding?.id ?? null, moving: !!b.target, grounded: b.grounded };
    });
    const objs = this.objs.filter((o) => !o.lost).map((o) => {
      const holder = o.heldBy ? this.bodies.get(o.heldBy) : null;
      const t = holder ? holder.body.translation() : o.body.translation();
      const q = o.body.rotation();
      return {
        id: o.id, kind: o.kind, name: o.name,
        p: holder ? [r2(t.x), r2(t.y + 1.7), r2(t.z)] : [r2(t.x), r2(t.y), r2(t.z)],
        q: [r2(q.x), r2(q.y), r2(q.z), r2(q.w)],
      };
    });
    return {
      t: 'snap', time: r2(this.simTime), paused: this.paused, speed: this.speed,
      resetIn: this.nextResetIn === null ? null : Math.round(this.nextResetIn), resetCount: this.resetCount,
      agents, objs,
    };
  }
}
