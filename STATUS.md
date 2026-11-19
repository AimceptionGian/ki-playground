# Status

_Stand: 2026-11-19 22:50_

## Ziel
Stefans KI Playground zu eigenem Ableger umbauen: Bots wirken lebendig (flüssiges Handeln, Bedürfnisse,
Altern/Kinder/Tod, hörbare Stimmen). Plan und Reihenfolge: [SPEC.md](SPEC.md).

## Entschieden
- Fork `AimceptionGian/ki-playground` (öffentlich); `origin` = Fork, `stefan` = Original, nie dorthin pushen
- Körper/Geist-Trennung: Modell schickt Pläne (`act`), Server führt sie mit Reflexen aus
- Eigenpläne des Körpers (`plan.auto`) wecken den Geist nicht und zählen nicht als „wartet"
- Lebenszyklus: Stufen relativ zum eigenen Höchstalter (Kind < 15 %, alt ≥ 75 %); Gründer starten bei 25 %
- Kinder nur optisch kleiner; SOUL.md des Kindes = Absätze beider Eltern gemischt
- Ids aus `data/graveyard/` werden nie wiederverwendet
- Bewegung: Server beschleunigt (`ACCEL` 28, `DECEL` 40 m/s², Bremsweg vor dem Ziel, `Body.mv`); Client leitet Geh-Phase aus gezeigtem Tempo ab, Snapshot trägt `ly` (Blickrichtung) für den Kopf
- Stimmen später mit Piper lokal; Bevölkerung über Alterung und Härte statt Obergrenze

## Stand
- Erledigt: Schritte 1–3 (`831ce98`, `49ee060`, `17d9b52`), Schritt 4 Bewegung und Darstellung (`6860d10`):
  `driveBody` in `server/world.ts`, Kopf-Gruppe/Wippen/Atmen/Umsehen in `client/src/scene.ts`
- Geprüft: Typecheck; World-Test (Anlaufen 0,5→6 m/s, Ankunft bei 9,98 von 10 m, Plan `done`)
- Ungeprüft: Browser-Darstellung von Schritt 4 (Headless-Edge-Screenshot wurde vom Auto-Mode-Classifier verweigert) –
  Server mit `PORT=4799 npm run dev`, im Browser zwei Agenten laufen lassen: Wippen, Kopf dreht zum Ziel, Stillstand atmet
- Ungeprüft: echter Lauf mit Claude-Code-Agenten (`Act`/`eat`/`drink`/`Reproduce`, Tod → `claude.exe` endet, Grab)
- Offen: Runner „eigener Endpunkt" nur per API; kein Friedhof in der Oberfläche

## Nächster Schritt
1. Browser-Darstellung von Schritt 4 kurz ansehen (siehe „Ungeprüft"), dann SPEC.md Schritt 5 „Stimmen (Piper, lokal)"
   beginnen: Piper installiert? `say` erzeugt WAV + Adresse, Browser spielt räumlich ab, ohne Piper stumm

Empfohlenes Modell: sonnet (Umsetzung nach Spec)

## Achtung
- Dateien haben CRLF: Python/Node-Skripte zum Patchen müssen `\r\n` normalisieren (Edit-Tool geht)
- Testserver per PID beenden (`Get-NetTCPConnection -LocalPort 4799`)
- Unter Windows wirft `proc.kill('SIGCONT'/'SIGSTOP')`; Pause von Claude-Runnern wirkt nicht – Nebenbefund
- Prüfungen: `.claude/checks.json` (nur Typecheck); Testskripte nur im Scratchpad, `.mts` mit `file:///`-Import
- Heredocs mit Umlauten in Git Bash fragil: Skriptdatei nutzen
