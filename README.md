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
- **Effektspalte (FX).** Ein Effekt pro Zeile, als Kürzel mit Stufe 1–3 wie
  im Tracker, im Editor in Klartext: `EC` Echo-Wurf ins Delay, `DL` spielt die
  Zeile ¼/½/¾ später (Flams, Groove), `VL` leiser (Ghost Notes); für die 303
  zusätzlich `GT` Notenlänge, `FL` Filter-Kick nur für diese Note und `AR`
  Arpeggio innerhalb der Zeile (Dreiklang, Quinte, Oktave). Die FX-Taste
  neben den Noten oder ein Tipp in die FX-Spalte öffnet die Effekt-Tasten.
- **Gesten.** Tippen wählt, doppelt tippen setzt den letzten Wert der Spur,
  nach links wischen löscht. BPM zieht man mit dem Daumen hoch oder runter. Im
  Spurfokus transponiert ein Wisch hoch/runter auf einer Note sie in der
  Tonleiter (bei Drums wechselt die Stimme); eine Geste ist ein
  Rückgängig-Schritt.
- **Bereiche.** Lange drücken markiert eine Zelle, ein Tipp auf eine zweite
  zieht das Rechteck über Zeilen und Spuren auf. Die Leiste unten kopiert,
  fügt ein (auch in anderen Patterns; was eine Spur nicht spielen kann, bleibt
  weg), leert, schiebt um eine Zeile, transponiert (Ton, Oktave) und füllt:
  jede, jede 2., jede 4., Offbeat oder euklidisch 3/8, 5/8, 7/16, jeweils mit
  dem zuletzt geschriebenen Wert der Spur.
- **Würfeln.** ⋯ → „303-Linie würfeln“ schreibt eine neue Linie in der Tonart
  (eine halbtaktige Phrase und ihre Antwort, mit Akzenten, Slides und
  Oktavsprüngen), „Drums würfeln“ neue Techno-Drums. Rückgängig holt den alten
  Stand zurück.
- **Klang.** Die Regler der 303 (Cutoff, Resonanz, Env Mod, Decay, Akzent,
  Drive, Raum), drei 303-Stimmen mit Säge/Rechteck-Schalter, drei Drum-Kits,
  Tempo, Swing und Tonart.
- **Live.** Die Ansicht zum Spielen: ein großes Filter-Feld (Cutoff quer,
  Resonanz hoch), das den 303-Filter sofort und stufenlos bewegt, auch mitten in
  einer Note; Env Mod und Decay; ein DJ-Filter (Tiefpass/Hochpass), der beim
  Loslassen zurückfedert; Mutes, die am nächsten Takt schalten; und
  Break → Drop: Halten nimmt die Kick raus und lässt einen Hochpass über zwei
  Takte steigen, Loslassen bringt den Drop am nächsten Takt. Eine Geste im
  Filter-Feld ist ein Rückgängig-Schritt.
- **Patterns.** Acht Patterns mit 16 oder 32 Zeilen. Während der Wiedergabe
  im Loop wechselt ein angetipptes Pattern am Ende des laufenden.
- **Song.** Die Song-Liste reiht Patterns aneinander (bis zu 64 Einträge): Die
  Tasten 1–8 schreiben in den gewählten Eintrag oder hängen ans Ende an,
  „wiederholen“ verdoppelt einen Eintrag, nach links wischen löscht, und
  „ab hier“ spielt den Song vom gewählten Eintrag. Oben schaltet Play zwischen
  **LOOP** (das gezeigte Pattern) und **SONG** (die Liste, am Ende wieder von
  vorn) um.
- **Aufnahme.** REC in der Live-Ansicht nimmt auf, was du hörst, samt Filter,
  Mutes und Breaks (bis zu 10 Minuten, oben läuft die Zeit mit). Danach lässt
  sich die Aufnahme anhören, als WAV speichern oder über Android teilen.
- **Ansichten.** Muster, Song, Klang und Live liegen unten unter dem Daumen.
- **Projekte.** Beliebig viele Projekte (⋯ → Projekt): neu mit Start-Groove
  oder leer, umbenennen, duplizieren, löschen, als `.track303.json`-Datei
  sichern und auf einem anderen Handy wieder öffnen. Jede Änderung landet
  sofort im `localStorage`, mit der vorherigen Fassung als Sicherung; die App
  bittet Chrome, den Speicher dauerhaft zu behalten. Rückgängig/Wiederholen
  gilt für die laufende Sitzung.
- **Song als WAV.** Die Song-Ansicht rendert den ganzen Song einmal durch,
  schneller als Echtzeit (in 2-Sekunden-Stücken wie Kittys Export), mit
  denselben Klängen wie live.
- **Auch auf dem iPhone.** iOS schaltet Web Audio stumm, solange der
  Lautlos-Schalter an ist. Track303 meldet seinen Ton beim ersten Tipp als
  Wiedergabe an (Safari 17+) bzw. lässt auf älteren iPhones ein stummes
  Audio-Element mitlaufen, so klingt es wie eine Musik-App.
- **Robust am Handy.** Nimmt ein Anruf oder eine andere App den Ton weg,
  stoppt Track303 sauber und sagt es (eine laufende Aufnahme wird bis dahin
  gesichert). Der Playhead leuchtet, wenn eine Zeile zu hören ist: Die
  Ausgabe-Latenz des Geräts (bei Bluetooth deutlich mehr) wird eingerechnet.

## Als App

Track303 lässt sich in Chrome auf Android installieren (Menü ⋯ → „Als App
installieren“ oder Chromes eigenes Menü). Die App startet dann vom Homescreen
im eigenen Fenster ohne Adressleiste und läuft nach dem ersten Besuch auch
offline: Ein Service Worker (`sw-template.js`, beim Build zu `sw.js` mit der
Dateiliste des Releases) hält Seite, Bundles und Icons auf dem Handy. Online
kommt die Seite immer frisch vom Server; liegt eine neue Version bereit, bietet
Track303 „Neu laden“ an. Die Sicherheitsrichtlinie der Seite muss dafür
`manifest-src 'self'` erlauben.

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
