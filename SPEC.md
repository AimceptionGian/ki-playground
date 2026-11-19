# Umbau: Körper und Geist, Bedürfnisse, Lebenszyklus, Stimmen

Ableger von Stefans KI Playground. Ziel: Die Bots wirken lebendig. Sie handeln flüssig, haben Bedürfnisse,
altern, bekommen Kinder, sterben und sprechen hörbar.

## Leitidee: Körper handelt, Geist überlegt

Heute ist jeder Befehl ein Modellaufruf: Aktion, warten, Aktion, warten. Neu gibt es zwei Schichten,
wie beim Menschen: Man überlegt nicht, wie man die Hand hebt, man hebt sie. Man kann aber vorher überlegen.

| | Körper (Reflexe) | Geist (Modell) |
|---|---|---|
| läuft | auf dem Server, jeden Physikschritt | Claude Code oder Endpunkt, Sekunden pro Gedanke |
| entscheidet | *wie* etwas gemacht wird, sofort | *was* gemacht werden soll |
| Beispiel | hinlaufen, über Kante springen, ausweichen, aufheben, essen | „Ich hole Beeren und bringe sie Albo" |

- Der Geist schickt einen **Plan**: eine Liste von Schritten (`goto`, `follow`, `pickup`, `place`, `throw`,
  `jump`, `say`, `eat`, `drink`, `wander`, `wait`), dazu eine Absicht in einem Satz.
  Der Aufruf kehrt sofort zurück; der Körper arbeitet den Plan ab, **während der Geist weiterdenkt**.
- Ein neuer Plan ersetzt den alten (oder hängt an mit `append: true`).
- Die Beobachtung zeigt Fortschritt des Plans, Bedürfnisse und Ereignisse.
- Der Geist wird geweckt, wenn etwas Wichtiges passiert: Plan fertig oder gescheitert, jemand spricht ihn an,
  ein Bedürfnis wird dringend.
- **Leerlauf**: Ohne Plan entscheidet der Körper selbst nach Bedürfnissen (Utility-AI): bei Hunger zur
  nächsten Nahrung, bei Langeweile schlendern oder anderen zuschauen, sonst herumschauen. Nie steif stehen.
- Bisherige Befehle (`MoveTo`, `Pickup` …) bleiben als Plan mit einem Schritt erhalten.
- Reflexe: blockiert durch eine niedrige Kante → selbst springen; Objekt nicht in Reichweite → erst hinlaufen.

## Bedürfnisse

Werte von 0 bis 1, pro Bot, im Weltzustand.

| Bedürfnis | steigt durch | sinkt durch | Folge bei 1 |
|---|---|---|---|
| Hunger | Zeit, Bewegung | Essen (Beerenbüsche, wachsen nach) | verliert Gesundheit |
| Durst | Zeit, schneller als Hunger | Trinken (Teich/Quelle) | verliert Gesundheit, schneller |
| Langeweile | gleiche Gegend, nichts Neues | Neues sehen, Spielen, Reden | Freude sinkt |
| Freude | Gespräche, Spielen, Bauen, satt sein | Hunger, Durst, Langeweile, Tod eines Nahen | (Stimmung, beeinflusst Fortpflanzung) |

- Gesundheit 0 → Tod.
- Der Geist sieht Bedürfnisse als Zahl **und** als Wort („sehr durstig").
- Die Oberfläche zeigt Balken pro Bot.

## Lebenszyklus

- **Alter** in Weltzeit. Stufen: Kind, erwachsen, alt. Kinder sind kleiner und langsamer beim Werfen,
  Alte langsamer beim Laufen. Höchstalter mit Zufallsstreuung.
- **Fortpflanzung**: zwei Erwachsene nah beieinander, beide rufen `Reproduce` mit dem anderen (Zustimmung
  beider), genug Freude, nicht hungrig oder durstig, Abklingzeit. Das Kind:
  - bekommt einen neuen Arbeitsordner, eine aus den Farben der Eltern gemischte Farbe, eine Stimme aus der
    Familie der Eltern und eine `SOUL.md`, die aus denen der Eltern entsteht;
  - erscheint bei den Eltern, beide hören davon;
  - übernimmt standardmässig den Runner der Eltern (Welt-Einstellung, z. B. lokales Modell für Nachwuchs).
- **Tod**: Körper verschwindet, Runner stoppt, der Arbeitsordner wandert nach `data/graveyard/`.
  Wer in der Nähe ist, erfährt davon.
- **Bevölkerung** regelt sich über Alterung und **Härte** der Welt (Welt-Einstellung): Härte beschleunigt
  Hunger und Durst und bremst das Nachwachsen der Nahrung. Keine harte Obergrenze.

## Bewegung und Darstellung

- Beschleunigen und Abbremsen statt sofort Vollgas, Drehen mit begrenzter Geschwindigkeit.
- Im Browser: Interpolation über einen kleinen Puffer statt Sprüngen, Geh-Animation (Wippen, Beine/Arme),
  Kopf schaut zum Ziel oder zu dem, der spricht, Idle-Bewegungen.

## Stimmen (Piper, lokal)

- `say` erzeugt auf dem Server mit Piper eine WAV und liefert eine Adresse mit. Der Browser spielt sie
  räumlich ab (lauter, je näher die Kamera ist).
- Jeder Bot hat eine Stimme: deutsches Piper-Modell, Sprecher, Sprechtempo, Tonhöhe
  (Tonhöhe über die Abspielrate im Browser). Kinder: höher, Stimme aus der Familie.
- Ohne installiertes Piper bleibt alles stumm, nichts bricht.

## Reihenfolge

1. Körper und Geist (Fundament für alles andere)
2. Bedürfnisse, Nahrung, Wasser
3. Lebenszyklus
4. Bewegung und Darstellung
5. Stimmen

## Offen

- Wartemodus: Mit Plänen ist er weniger wichtig. Vorerst bleibt er, der Geist zählt als „wartet",
  solange sein Körper einen Plan abarbeitet.
