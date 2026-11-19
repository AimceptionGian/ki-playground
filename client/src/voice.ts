import type { Scene } from './scene';

let ctx: AudioContext | null = null;
const unlock = () => { try { ctx ??= new AudioContext(); void ctx.resume(); } catch { /* kein Ton */ } };
if (typeof window !== 'undefined') for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, unlock, { passive: true });

/** Spielt die Sprache eines Agenten räumlich ab: leiser mit Abstand zur Kamera, Lage links/rechts im Bild. */
export async function playVoice(scene: Scene | null, id: string, url: string, rate: number) {
  if (!ctx || ctx.state !== 'running' || !scene) return; // vor der ersten Eingabe sperrt der Browser Ton
  const pos = scene.audioPos(id);
  const gain = pos ? Math.max(0.04, Math.min(1, 40 / Math.max(pos.dist, 1))) : 0.3;
  try {
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = pos?.pan ?? 0;
    src.connect(g).connect(pan).connect(ctx.destination);
    src.start();
  } catch { /* Datei weg oder nicht dekodierbar: stumm */ }
}
