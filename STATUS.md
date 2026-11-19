# Status

_Stand: 2026-11-19 22:10_

## Ziel
Stefans KI Playground zu eigenem Ableger umbauen: Bots wirken lebendig (flüssiges Handeln, Bedürfnisse,
Altern/Kinder/Tod, hörbare Stimmen). Plan und Reihenfolge: [SPEC.md](SPEC.md).

## Entschieden
- Fork `AimceptionGian/ki-playground` (öffentlich); `origin` = Fork, `stefan` = Original, nie dorthin pushen
- Körper/Geist-Trennung: Modell schickt Pläne (`act`), Server führt sie mit Reflexen aus
- Eigenpläne des Körpers (`plan.auto`) wecken den Geist nicht und zählen nicht als „wartet"
- Lebenszyklus: Stufen relativ zum eigenen Höchstalter (Kind < 15 %, alt ≥ 75 %); Gründer starten bei 25 %
- Kinder nur optisch kleiner (Kollider gleich); SOUL.md des Kindes = Absätze beider Eltern zufällig gemischt,
  Geburtsabschnitt zwischen `<!-- geburt -->` wird nicht weitervererbt
- Kind-Runner startet bei „wie die Eltern" nur, wenn ein Elternteil-Runner läuft; Familie erfährt Tod auch ausser Hörweite
- Ids aus `data/graveyard/` werden nie wiederverwendet (Protokoll/Verbrauch/Familie hängen an der Id)
- Stimmen später mit Piper lokal; Bevölkerung über Alterung und Härte statt Obergrenze

## Stand
- Erledigt: Schritt 1 (`831ce98`), Schritt 2 (`49ee060`), Schritt 3 Lebenszyklus (`17d9b52`):
  `world.ts` (`tickLife`, `reproduce`, `kill`, `lifeInfo`, Events `stage`/`reproduce_request`/`birth`/`death`/`health_low`),
  `agents.ts` (`createChild`, `bury`, `setAges`), `index.ts` (`onBirth`/`onDeath`, Einstellungen `lifespanMin`/`offspring`),
  Tool `reproduce`, API.md-Abschnitt „Leben", Client: Stufe/Alter/Eltern, Regler Härte/Lebensdauer/Runner der Kinder
- Geprüft: Typecheck; HTTP-Test (Geburt, Zustimmung, Abklingzeit, Tod durch Alter, Grab, Token ungültig, Alter gespeichert),
  World-Test (Gesundheit 0 → Tod), Grab trotz sperrendem Prozess, Browser-Screenshot (headless Edge) – alles grün;
  Review-Subagent gegen SPEC: 4 Funde behoben (Runner-Stopp unter Windows, Id-Wiederverwendung, Abklingzeit über Neustart, Bestätigung beim Senken der Lebensdauer)
- Ungeprüft: echter Lauf mit Claude-Code-Agenten – zwei Agenten starten, beobachten, ob sie `Act`/`eat`/`drink`/`Reproduce`
  nutzen und ob beim Tod `claude.exe` endet und der Ordner im Grab landet
- Offen: Runner der Kinder „eigener Endpunkt" nur per API (`/api/control {offspring:{runner:'api',baseUrl,model,apiKey}}`); kein Friedhof in der Oberfläche

## Nächster Schritt
1. SPEC.md Schritt 4 „Bewegung und Darstellung": Beschleunigen/Abbremsen in `driveBody`, Interpolationspuffer und
   Geh-Animation (Wippen), Kopf schaut zum Ziel/Sprecher, Idle-Bewegungen in `client/src/scene.ts`

Empfohlenes Modell: sonnet (Umsetzung nach Spec in zwei bekannten Dateien)

## Achtung
- Testserver per PID beenden (`Get-NetTCPConnection -LocalPort 4799`): TaskStop beendet den Node-Kindprozess nicht
- Unter Windows wirft `proc.kill('SIGCONT'/'SIGSTOP')` (ERR_UNKNOWN_SIGNAL); Pause von Claude-Runnern wirkt deshalb nicht – Nebenbefund, offen
- Prüfungen: `.claude/checks.json` (nur Typecheck); Testskripte nur im Scratchpad, als `.mts` mit `file:///`-Import
- Bash-Heredocs mit Python/Umlauten scheitern in Git Bash: Edit-Tool oder Skriptdatei nutzen
- Browser-Prüfung ohne Browser-Tool: `msedge.exe --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=<Pfad> <URL>` (Pfad mit Backslash)
