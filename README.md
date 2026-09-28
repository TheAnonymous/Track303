# Track303

Track303 ist ein Acid-Techno-Tracker fürs Handy. Er ist von Grund auf für den
Daumen im Hochformat gebaut und läuft vollständig im Browser, ohne Konto,
Backend, Samples oder externe Requests. Zielgerät ist Chrome auf Android.

**[Track303 öffnen](https://musik.jodie-oesterling.de/Track303/)**

## So funktioniert es

- **Zeit läuft nach unten, Spuren sind Spalten.** Vier Spuren passen
  nebeneinander: BD (Kick), SD (Snare, Clap, Tom), HH (Hi-Hat zu/offen) und
  die 303.
- **Übersicht und Spurfokus.** Die Übersicht zeigt nur Noten. Ein Tipp auf den
  Spurkopf zoomt die Spur auf volle Breite mit allen Spalten: Note, Akzent `!`,
  Slide `~`, Chance und Wiederholungen.
- **Daumen-Editor.** Unten liegen die sieben Töne der Tonart (falsche Töne gibt
  es nicht), Oktave, Akzent, Slide, Löschen, Zeilen-Navigation und die
  Schrittweite, um die der Cursor nach jeder Eingabe weiterspringt.
- **Gesten.** Tippen wählt, doppelt tippen setzt den letzten Wert der Spur,
  nach links wischen löscht. BPM zieht man mit dem Daumen hoch oder runter.
- **Klang.** Die Regler der 303 (Cutoff, Resonanz, Env Mod, Decay, Akzent,
  Drive, Raum), drei 303-Stimmen, drei Drum-Kits, Tempo, Swing und Tonart.
- **Live.** Die Ansicht zum Spielen: ein großes Filter-Feld (Cutoff quer,
  Resonanz hoch), das den 303-Filter sofort und stufenlos bewegt, auch mitten in
  einer Note; Env Mod und Decay; ein DJ-Filter (Tiefpass/Hochpass), der beim
  Loslassen zurückfedert; Mutes, die am nächsten Takt schalten; und
  Break → Drop: Halten nimmt die Kick raus und lässt einen Hochpass über zwei
  Takte steigen, Loslassen bringt den Drop am nächsten Takt. Eine Geste im
  Filter-Feld ist ein Rückgängig-Schritt.
- **Patterns.** Acht Patterns mit 16 oder 32 Zeilen. Während der Wiedergabe
  wechselt ein angetipptes Pattern am Ende des laufenden.
- **Speichern.** Jede Änderung landet sofort im `localStorage`, mit der
  vorherigen Fassung als Sicherung. Rückgängig/Wiederholen gilt für die
  laufende Sitzung.

## Klang

Die Drum- und 303-Stimmen, die Kanalzüge und der Master stammen aus
[Kitty](https://musik.jodie-oesterling.de/Kitty/) (`src/sound/`), dort als
schlanke Web-Audio-Stimmen ausgearbeitet. Track303 spielt sie zeilengenau.
Die Kick bekommt einen hörbaren Klick-Anteil, damit sie auf
Handy-Lautsprechern nicht verschwindet. Der Audio-Kontext entsteht beim ersten
Tippen mit `latencyHint: "balanced"`: Ein etwas größerer Puffer verhindert
Knackser auf Handys, und einen Tracker programmiert man, statt ihn live
einzuspielen.

## Entwickeln

Voraussetzungen sind exakt Node.js 24.15.0 und npm 12.0.0; beides legt
[`mise.toml`](mise.toml) fest (`mise install`).

```bash
npm ci
npm run dev
```

Die Entwicklungsseite liegt unter `http://localhost:5173/Track303/`. Die
vollständige lokale Abnahme (Lint, Typecheck, Unit-Tests, Build und
Playwright-Tests in Pixel-7-Emulation gegen den Build unter der
Produktions-CSP):

```bash
npm run verify
```

Der E2E-Lauf rendert den Start-Groove außerdem offline, prüft jede Spur auf
Hörbarkeit und Übersteuerung und zählt die Audio-Knoten.

## Veröffentlichen

Track303 wird zusammen mit Groovebox und Kitty über die Musik-Werkstatt-Skripte
im Server-Infra-Repository gebaut und ausgeliefert (`scripts/musik-build.sh`,
`scripts/musik-deploy.sh`). Ausgeliefert wird nur, was auf `main` committet ist.

## Lizenz

MIT, siehe [LICENSE](LICENSE) und [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
