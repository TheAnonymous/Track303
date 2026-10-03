# Drittanbieterhinweise

## Kitty

Die Klangmodule in `src/sound/` (schlanke Web-Audio-Stimmen, Kanalzüge,
Master, Klang-Presets) sind aus Kitty übernommen und für Track303 angepasst.
Kitty steht unter derselben MIT-Lizenz wie Track303 (siehe `LICENSE`).

## Laufzeitbibliotheken

- [Klangwerk](https://github.com/TheAnonymous/Klangwerk), MIT-Lizenz
- [Vue](https://github.com/vuejs/core) 3.5.39, MIT-Lizenz

Die vollständigen Lizenztexte liegen den Paketen bei (`node_modules/klangwerk/LICENSE`,
`node_modules/vue/LICENSE`).

## Tone.js

Klangwerks `Param` und `klangwerk/tone` (dorthin sind Track303s schlanke
Knoten und Stimmen umgezogen) bauen die Teile von
[Tone.js](https://github.com/Tonejs/Tone.js) 15.5 nach, auf denen der Klang
von Track303 beruht (Gain, Panner, Delay, Kompressor, Limiter, Waveshaper,
Rauschen, Frequenz-Hüllkurve, Notenwerte, Automation). Tone.js steht unter der
MIT-Lizenz:

MIT License

Copyright (c) 2014-2025 Yotam Mann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
