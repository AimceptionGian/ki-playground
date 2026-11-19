# Status

_Stand: 2026-11-19 23:15_

## Ziel
Stefans KI Playground zu eigenem Ableger umbauen: Bots wirken lebendig (flüssiges Handeln, Bedürfnisse,
Altern/Kinder/Tod, hörbare Stimmen). Plan und Reihenfolge: [SPEC.md](SPEC.md).

## Entschieden
- Fork `AimceptionGian/ki-playground` (öffentlich); `origin` = Fork, `stefan` = Original, nie dorthin pushen
- Körper/Geist-Trennung: Modell schickt Pläne (`act`), Server führt sie mit Reflexen aus
- Eigenpläne des Körpers (`plan.auto`) wecken den Geist nicht und zählen nicht als „wartet"
- Nach `plan_done`/`plan_failed` des Geistes 10 s Vortritt (`MIND_GRACE`), erst dann Eigenplan; Event trägt
  `needs` (Hunger/Durst ≥ 0.4 als Wort) und `body` (Ankündigung, wenn ≥ 0.55) – gegen „Körper kämpft mit Geist"
- Lebenszyklus: Stufen relativ zum eigenen Höchstalter (Kind < 15 %, alt ≥ 75 %); Gründer starten bei 25 %
- Kinder nur optisch kleiner; SOUL.md des Kindes = Absätze beider Eltern gemischt
- Ids aus `data/graveyard/` werden nie wiederverwendet
- Bewegung: Server beschleunigt (`ACCEL`/`DECEL`, `Body.mv`); Client leitet Geh-Phase aus Tempo ab, Snapshot trägt `ly`
- Stimmen: Piper lokal im venv `data/piper/venv`, Modelle `data/piper/models` (thorsten-medium, eva_k-x_low; gitignored);
  Stimme stabil aus Hash der Id, Kinder Rate ×1.3, Alte ×0.94; Tonhöhe = Abspielrate im Browser; ohne Piper stumm
- Stimmen zweisprachig: Sprache pro Äusserung mit `tinyld` (de/en, unklar = de); englische Modelle en_US-amy/ryan-medium
  (gleicher Platz je Sprache: eva_k↔amy, thorsten↔ryan); Piper mit `PYTHONUTF8=1`, sonst kaputte Umlaute (cp1252)
- Sitzungsstart: SEMANTIC_MEMORY.md und die letzten 15 Erinnerungen stehen direkt im Start-Prompt (`startPrompt` in runner.ts)
- Bevölkerung über Alterung und Härte statt Obergrenze
- Schlaf = natürliches Leeren des Kontexts: Traum-Lauf ordnet das Gedächtnis, danach frische Sitzung (Gians Idee)

## Stand
- Erledigt: Schritte 1–5 (Stimmen: `58232eb`; `server/voice.ts`, `client/src/voice.ts`, Event `{t:'voice'}`, `/voices` statisch)
- Geprüft: Typecheck; `Voices.say` erzeugt echte WAV mit Piper (Skript im Scratchpad)
- Geprüft: HTTP-Auslieferung `/voices/…` (200, audio/wav)
- Ungeprüft: Wiedergabe im Browser (Ton erst nach erstem Klick/Taste; Lautstärke 40/Abstand
  zur Kamera) – `PORT=4799 npm run dev`, Agent `say` auslösen, Ton hören
- Ungeprüft: Browser-Darstellung Schritt 4 (Wippen, Kopf dreht zum Ziel, Idle-Atmen)
- Ungeprüft: echter Lauf mit Claude-Code-Agenten (`Act`/`eat`/`drink`/`Reproduce`, Tod → `claude.exe` endet, Grab)
- Offen: Runner „eigener Endpunkt" nur per API; kein Friedhof in der Oberfläche; kein Stumm-Schalter in der UI
- Erledigt: Denktempo Option A – Claude-Runner schlank über MCP (Reaktion ~1–2 s statt 3.6–6.2 s), siehe
  [docs/geist-tempo.md](docs/geist-tempo.md); Weltregeln gemeinsam in `templates.ts` (`worldRules()`, `apiMd()`)
- Ungeprüft: Runner „api" nutzt `worldRules()` noch nicht (System-Prompt ohne Weltregeln) – Nebenbefund
- Erledigt: Energie, Schlaf und Träumen (Gedächtnis ordnen im Schlaf, danach frischer Kontext), siehe docs/geist-tempo.md
- Ungeprüft: Schlafpose im Browser (liegt auf dem Rücken, Augen zu, Energie-Balken)
- Erledigt: Gedächtnis im Start-Prompt (Test: erstes `act` nach 1.6 s, keine Leserunden mehr)
- Erledigt: Umlaute (Phoneme geprüft: „Grüsse“ → ɡ r ʏ s ə) und Englisch (eigene Stimme, WAV erzeugt)
- Ungeprüft: englische Stimmen im Browser anhören
- Erledigt: Anleitung strenger: tagsüber nichts aufschreiben, nur im Traum (templates.ts; bestehende SOUL.md der Agenten
  sagen noch „pflege sie, während du lebst" – nur neue Agenten bekommen den neuen Text)
- Erledigt: Sprünge. Ursache: in der Luft keine Steuerung → an der Wand Vorwärtstempo 0, Sprung senkrecht, Landung davor
  (0/9 Stufen geschafft). Fix: Luftsteuerung Richtung Ziel (`AIR_ACCEL`), Reflex „Stufe voraus → im Lauf abspringen"
  (`stepAhead`), Reflex „Kante voraus und Ziel höher → abspringen" (`edgeAhead`, z. B. Lücke EastStep→EastMesa).
  Prüfskript im Scratchpad (`jumps.mts`): 11/11 inkl. flach/hinunter ohne Sprung; Stufen in ~1.7 s statt 2.4 s
- Erledigt: Tests im Projekt: `npm test` (= `tests/moves.ts` + `tests/speech.ts`), auch in `.claude/checks.json`
- Erledigt: Reden nacheinander. Wer zuerst spricht, hat das Wort (Dauer ≈ 0.5 s + Zeichen/14); in Hörweite eines
  Sprechenden schweigt man (`say` → `stopped` mit `remaining_s`; say-Schritt → Event `kept_silent`, Plan läuft weiter).
  Reinreden nur bewusst mit `interrupt: true`: der andere verstummt (Event `interrupted`, Ton per `{t:'hush'}` angehalten,
  noch nicht erzeugter Ton wird verworfen). Echter Lauf (Uno/Duo, 2 min): kein Durcheinander, keiner hat reingeredet
- Offen: Gesprächsrhythmus. `heard` kommt am Anfang einer Äusserung → Zuhörer antwortet, während der andere noch spricht
  (9 Abweisungen in 2 min, Pausen bis 16 s). Idee: `heard` erst am Ende der Äusserung zustellen/wecken
- Offen: C langlebiger Prozess gegen ~2.7 s Neustart

## Nächster Schritt
1. Browser-Test (siehe „Ungeprüft") mit zwei Agenten durchführen; Fehler beheben. Danach Nebenpunkte aus „Offen"
   (Stumm-Schalter, Friedhof-Ansicht) oder neue Ziele mit Gian klären. SPEC-Reihenfolge ist abgeschlossen.

Empfohlenes Modell: sonnet (Testen und kleine Korrekturen)

## Achtung
- Dateien haben CRLF: Patch-Skripte müssen `\r\n` normalisieren (Edit-Tool geht)
- Testserver nur per PID beenden; Auto-Mode-Classifier blockiert Stop-Process/Headless-Browser → Gian bitten
- Unter Windows wirft `proc.kill('SIGCONT'/'SIGSTOP')`; Pause von Claude-Runnern wirkt nicht – Nebenbefund
- Prüfungen: `.claude/checks.json` (Typecheck + `npm test`); Wegwerf-Skripte im Scratchpad (`.mts` mit `file:///`-Import),
  dauerhafte Tests in `tests/` (laufen ohne Server direkt gegen `World`)
- Heredocs mit Umlauten in Git Bash fragil: Skriptdatei nutzen
