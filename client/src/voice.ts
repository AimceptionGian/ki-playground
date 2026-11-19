import type { Scene } from './scene';

let ctx: AudioContext | null = null;
const unlock = () => { try { ctx ??= new AudioContext(); void ctx.resume(); } catch { /* kein Ton */ } };
if (typeof window !== 'undefined') for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, unlock, { passive: true });

// was gerade pro Agent läuft, und bis zu welcher Äusserung abgebrochen wurde (ins Wort gefallen)
const playing = new Map<string, { src: AudioBufferSourceNode; seq: number }>();
const hushed = new Map<string, number>();

/** Spielt die Sprache eines Agenten räumlich ab: leiser mit Abstand zur Kamera, Lage links/rechts im Bild. */
export async function playVoice(scene: Scene | null, id: string, url: string, rate: number, seq = 0) {
  if (!ctx || ctx.state !== 'running' || !scene) return; // vor der ersten Eingabe sperrt der Browser Ton
  const pos = scene.audioPos(id);
  const gain = pos ? Math.max(0.04, Math.min(1, 40 / Math.max(pos.dist, 1))) : 0.3;
  try {
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    if (seq && seq <= (hushed.get(id) ?? 0)) return; // während des Ladens abgebrochen
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = pos?.pan ?? 0;
    src.connect(g).connect(pan).connect(ctx.destination);
    playing.get(id)?.src.stop(); // ein Agent spricht nie mit sich selbst durcheinander
    playing.set(id, { src, seq });
    src.onended = () => { if (playing.get(id)?.src === src) playing.delete(id); };
    src.start();
  } catch { /* Datei weg oder nicht dekodierbar: stumm */ }
}

/** Äusserung abgebrochen (jemand ist ins Wort gefallen): Ton sofort anhalten. */
export function hushVoice(id: string, seq: number) {
  hushed.set(id, Math.max(seq, hushed.get(id) ?? 0));
  const p = playing.get(id);
  if (p && p.seq <= seq) { try { p.src.stop(); } catch { /* schon zu Ende */ } playing.delete(id); }
}
