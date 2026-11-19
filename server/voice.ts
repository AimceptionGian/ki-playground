import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { detect } from 'tinyld';
import { DATA_ROOT } from './agents.ts';

/**
 * Stimmen mit Piper (lokal). Ohne Piper oder ohne Modell bleibt alles stumm und nichts bricht.
 * Suche: PIPER_BIN (sonst `data/piper/venv/Scripts/piper.exe`, sonst `piper` im PATH),
 * Modelle: alle `*.onnx` in PIPER_MODELS (sonst `data/piper/models`), Sprache aus `language.family` im JSON.
 * Jede Äusserung wird auf Deutsch oder Englisch erkannt (tinyld) und mit einem Modell dieser Sprache gesprochen.
 * Ein Bot behält über Sprachen hinweg seinen Platz: Modelle je Sprache nach Dateiname sortiert, Platz = Hash der Id
 * (eva_k ↔ amy weiblich, thorsten ↔ ryan männlich).
 */
const PIPER_DIR = path.join(DATA_ROOT, 'piper');
const MODELS = process.env.PIPER_MODELS || path.join(PIPER_DIR, 'models');
const OUT = path.join(DATA_ROOT, 'voices');
const MAX_QUEUE = 6;
const KEEP_MS = 10 * 60_000;

export type Stage = 'child' | 'adult' | 'old';
export interface Voice { model: string; speaker: number | null; length: number; rate: number }
export interface Spoken { url: string; rate: number }

const hash = (s: string) => crypto.createHash('sha1').update(s).digest().readUInt32BE(0);

export class Voices {
  readonly dir = OUT;
  private bin: string | null = null;
  private models: { file: string; speakers: number; lang: string }[] = [];
  private queue: (() => Promise<void>)[] = [];
  private busy = false;
  private warned = false;
  private seq = 0;

  constructor() {
    fs.mkdirSync(OUT, { recursive: true });
    this.bin = this.findBin();
    this.models = this.findModels();
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  get ready() { return !!this.bin && this.models.length > 0; }

  private findBin(): string | null {
    const cands = [process.env.PIPER_BIN, path.join(PIPER_DIR, 'venv', 'Scripts', 'piper.exe'), path.join(PIPER_DIR, 'venv', 'bin', 'piper'), path.join(PIPER_DIR, 'piper.exe')];
    for (const c of cands) if (c && fs.existsSync(c)) return c;
    return process.env.PIPER_BIN ? null : 'piper'; // PATH: Existenz zeigt erst der Start
  }

  private findModels() {
    try {
      return fs.readdirSync(MODELS).filter((f) => f.endsWith('.onnx')).sort().map((f) => {
        let speakers = 1;
        let lang = f.slice(0, 2).toLowerCase(); // ohne Metadaten: aus dem Dateinamen (de_DE-…)
        try {
          const j = JSON.parse(fs.readFileSync(path.join(MODELS, f + '.json'), 'utf8'));
          speakers = j.num_speakers || 1;
          lang = j.language?.family || lang;
        } catch { /* ohne Metadaten: ein Sprecher */ }
        return { file: path.join(MODELS, f), speakers, lang };
      });
    } catch { return []; }
  }

  /** Stimme eines Bots, stabil aus der Id; Kinder höher, Alte etwas tiefer. */
  voiceFor(id: string, stage: Stage, lang = 'de'): Voice | null {
    if (!this.models.length) return null;
    const h = hash(id);
    const own = this.models.filter((m) => m.lang === lang);
    const de = this.models.filter((m) => m.lang === 'de');
    const list = own.length ? own : de.length ? de : this.models;
    const m = list[h % list.length];
    const speaker = m.speakers > 1 ? (h >>> 8) % m.speakers : null;
    const length = 0.9 + ((h >>> 16) % 25) / 100; // Sprechtempo 0.90–1.14
    const base = 0.9 + ((h >>> 20) % 21) / 100; // Tonlage 0.90–1.10
    const rate = stage === 'child' ? base * 1.3 : stage === 'old' ? base * 0.94 : base;
    return { model: m.file, speaker, length, rate: Math.round(rate * 100) / 100 };
  }

  /** Erzeugt die WAV im Hintergrund und ruft danach `done` auf. Stumm, wenn Piper fehlt. */
  say(id: string, text: string, stage: Stage, done: (s: Spoken) => void) {
    const v = this.voiceFor(id, stage, this.langOf(text));
    if (!v || !this.bin) return;
    if (this.queue.length >= MAX_QUEUE) return;
    this.queue.push(async () => {
      const name = `${Date.now().toString(36)}-${(this.seq++).toString(36)}.wav`;
      if (await this.run(v, text, path.join(OUT, name))) done({ url: `/voices/${name}`, rate: v.rate });
    });
    void this.pump();
  }

  /** Deutsch oder Englisch? Unklar (z. B. „Okay!“) zählt als Deutsch. */
  private langOf(text: string): string {
    if (!this.models.some((m) => m.lang === 'en')) return 'de';
    try { return detect(text, { only: ['de', 'en'] }) || 'de'; } catch { return 'de'; }
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try { for (let job = this.queue.shift(); job; job = this.queue.shift()) await job(); } finally { this.busy = false; }
  }

  private run(v: Voice, text: string, out: string): Promise<boolean> {
    return new Promise((resolve) => {
      const args = ['-m', v.model, '-f', out, '--length-scale', String(v.length)];
      if (v.speaker !== null) args.push('-s', String(v.speaker));
      let p;
      // Piper ist Python: unter Windows läse es stdin sonst als cp1252, und aus „ü“ würde „Ã¼“
      const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
      try { p = spawn(this.bin!, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, env }); } catch { return resolve(this.fail('Start fehlgeschlagen')); }
      let err = '';
      p.stderr.on('data', (d) => { if (err.length < 400) err += d; });
      p.on('error', (e) => resolve(this.fail(e.message)));
      p.on('close', (code) => resolve(code === 0 && fs.existsSync(out) ? true : this.fail(err.trim() || `Exit ${code}`)));
      p.stdin.on('error', () => {});
      p.stdin.end(text.replace(/\s+/g, ' ').trim() + '\n');
      setTimeout(() => p.kill(), 30_000).unref();
    });
  }

  private fail(why: string) {
    if (!this.warned) { this.warned = true; console.warn(`[Stimmen] Piper nicht nutzbar (${why}); bleibt stumm.`); }
    return false;
  }

  private cleanup() {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(OUT)) {
        const p = path.join(OUT, f);
        if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.unlinkSync(p);
      }
    } catch { /* egal */ }
  }
}
