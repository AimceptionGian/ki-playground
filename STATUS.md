# Status

_Stand: 2026-11-19 21:45_

## Ziel
Stefans KI Playground zu eigenem Ableger umbauen: Bots wirken lebendig (flüssiges Handeln, Bedürfnisse,
Altern/Kinder/Tod, hörbare Stimmen). Plan und Reihenfolge: [SPEC.md](SPEC.md).

## Entschieden
- Fork `AimceptionGian/ki-playground` (öffentlich); `origin` = Fork, `stefan` = Original, nie dorthin pushen
- Körper/Geist-Trennung: Modell schickt Pläne (`act`), Server führt sie mit Reflexen aus (jev geprüft: passt nicht, ist pro Entscheidung ein Modellaufruf)
- Stimmen später mit Piper lokal; Bevölkerung über Alterung und Welt-Härte statt fester Obergrenze

## Stand
- Erledigt: Windows-Start von Claude Code (`46102bc`), SPEC (`b0…` siehe git log), Schritt 1 Körper und Geist (`831ce98`): `server/world.ts` Abschnitt „Pläne", `server/tools.ts`, `server/templates.ts` (API.md)
- Geprüft: Integrationstest mit 22 Prüfungen gegen Testserver (Port 4799, eigener `DATA_DIR`), alle grün; Review-Subagent gegen SPEC, 4 Funde behoben
- Ungeprüft: echter Lauf mit Claude-Code-Agent – Agent starten, schauen, ob er `Act` mit mehreren Schritten nutzt und währenddessen weiterdenkt
- Ungeprüft: Absichtszeile in der Agentenliste im Browser (nur Typecheck)

## Nächster Schritt
1. SPEC.md Schritt 2 „Bedürfnisse": Hunger/Durst/Langeweile/Freude/Gesundheit pro Body in `server/world.ts`, Beerenbüsche + Teich als Objekte, Schritte `eat`/`drink`, Leerlauf (`idleBody`) nach Bedürfnissen, Balken im Client

Empfohlenes Modell: sonnet (Umsetzung nach Spec und bestehendem Plan-Muster)

## Achtung
- Testserver nach Tests per PID beenden (`Get-NetTCPConnection -LocalPort 4799`): TaskStop beendet den Node-Kindprozess nicht, ein alter Server hielt den Port und täuschte Fehlschläge vor
- `proc.kill('SIGSTOP')` (Pausieren von Claude-Code-Agenten) wirkt unter Windows nicht – Nebenbefund, nicht behoben
- Prüfungen: `.claude/checks.json` (nur Typecheck); Testskript liegt nur im Scratchpad, nicht im Repo
