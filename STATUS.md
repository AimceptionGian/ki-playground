# Status

_Stand: 2026-11-19 22:30_

## Ziel
Stefans KI Playground zu eigenem Ableger umbauen: Bots wirken lebendig (flüssiges Handeln, Bedürfnisse,
Altern/Kinder/Tod, hörbare Stimmen). Plan und Reihenfolge: [SPEC.md](SPEC.md).

## Entschieden
- Fork `AimceptionGian/ki-playground` (öffentlich); `origin` = Fork, `stefan` = Original, nie dorthin pushen
- Körper/Geist-Trennung: Modell schickt Pläne (`act`), Server führt sie mit Reflexen aus
- Eigenpläne des Körpers (`plan.auto`, Leerlauf nach Bedürfnissen) wecken den Geist nicht und zählen nicht als „wartet"
- Stimmen später mit Piper lokal; Bevölkerung über Alterung und Welt-Härte statt fester Obergrenze

## Stand
- Erledigt: Schritt 1 Körper und Geist (`831ce98`); Schritt 2 Bedürfnisse: `server/world.ts` (Needs, Quellen `Bush_1..5`, `Pond_1`, Schritte `eat`/`drink`, `tickNeeds`, Eigenpläne in `idleBody`, Event `need_urgent`, `hardness`), `server/tools.ts`, API.md in `server/templates.ts`, Client: Bäume/Teich in `scene.ts`, Balken in `App.tsx`
- Geprüft: Typecheck; Skript gegen `World` direkt (Bedürfnisse steigen, eat, drink, Eigenplan, need_urgent, Gesundheit sinkt) alle grün; Review-Subagent gegen SPEC, Fund (eat wählte Busch pro Tick neu) behoben
- Ungeprüft: Anzeige im Browser (Büsche, Teich, Balken nur Typecheck); echter Lauf mit Claude-Code-Agent (nutzt er `Act`, `eat`, `drink`, reagiert er auf `need_urgent`?)
- Offen: Härte hat nur API (`/api/control {hardness}`), keinen Regler im Client; bei Gesundheit 0 nur Event `health_zero`, Tod kommt mit Schritt 3

## Nächster Schritt
1. SPEC.md Schritt 3 „Lebenszyklus": Alter, Stufen, `Reproduce`, Kind (Ordner, Farbe, SOUL.md), Tod (Ordner nach `data/graveyard/`, Runner stoppen), Gesundheit 0 → Tod. Vorher im Browser kurz prüfen, dass Büsche/Teich/Balken erscheinen

Empfohlenes Modell: opus (Lebenszyklus berührt Agentenverwaltung, Runner und Dateien: Design nötig)

## Achtung
- Testserver nach Tests per PID beenden (`Get-NetTCPConnection -LocalPort 4799`): TaskStop beendet den Node-Kindprozess nicht
- `proc.kill('SIGSTOP')` wirkt unter Windows nicht – Nebenbefund, nicht behoben
- Prüfungen: `.claude/checks.json` (nur Typecheck); Testskript liegt nur im Scratchpad. Skripte ausserhalb des Repos als `.mts` mit `file:///`-Import starten
- Python-Heredocs in Git Bash scheiterten einmal: Skript als Datei schreiben
