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
- Bevölkerung über Alterung und Härte statt Obergrenze

## Stand
- Erledigt: Schritte 1–5 (Stimmen: `58232eb`; `server/voice.ts`, `client/src/voice.ts`, Event `{t:'voice'}`, `/voices` statisch)
- Geprüft: Typecheck; `Voices.say` erzeugt echte WAV mit Piper (Skript im Scratchpad)
- Geprüft: HTTP-Auslieferung `/voices/…` (200, audio/wav)
- Ungeprüft: Wiedergabe im Browser (Ton erst nach erstem Klick/Taste; Lautstärke 40/Abstand
  zur Kamera) – `PORT=4799 npm run dev`, Agent `say` auslösen, Ton hören
- Ungeprüft: Browser-Darstellung Schritt 4 (Wippen, Kopf dreht zum Ziel, Idle-Atmen)
- Ungeprüft: echter Lauf mit Claude-Code-Agenten (`Act`/`eat`/`drink`/`Reproduce`, Tod → `claude.exe` endet, Grab)
- Offen: Runner „eigener Endpunkt" nur per API; kein Friedhof in der Oberfläche; kein Stumm-Schalter in der UI
- Offen: Geist denkt langsam (jede Aktion = Bash/curl-Runde, `claude.exe` startet pro Lauf neu mit `--continue`);
  Ideen: Modell fest auf Haiku/Sonnet, Tools per MCP statt curl, längere Pläne anregen

## Nächster Schritt
1. Browser-Test (siehe „Ungeprüft") mit zwei Agenten durchführen; Fehler beheben. Danach Nebenpunkte aus „Offen"
   (Stumm-Schalter, Friedhof-Ansicht) oder neue Ziele mit Gian klären. SPEC-Reihenfolge ist abgeschlossen.

Empfohlenes Modell: sonnet (Testen und kleine Korrekturen)

## Achtung
- Dateien haben CRLF: Patch-Skripte müssen `\r\n` normalisieren (Edit-Tool geht)
- Testserver nur per PID beenden; Auto-Mode-Classifier blockiert Stop-Process/Headless-Browser → Gian bitten
- Unter Windows wirft `proc.kill('SIGCONT'/'SIGSTOP')`; Pause von Claude-Runnern wirkt nicht – Nebenbefund
- Prüfungen: `.claude/checks.json` (nur Typecheck); Testskripte nur im Scratchpad, `.mts` mit `file:///`-Import
- Heredocs mit Umlauten in Git Bash fragil: Skriptdatei nutzen
