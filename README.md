# ⚽ Bolzplatz – einfaches 3D-Fußballspiel

Läuft direkt im Browser (PC, Handy, Tablet) und lässt sich als App auf den Startbildschirm installieren (PWA). Kein Server, kein Build-Schritt, keine Installation nötig.

## Funktionen
- **Spielmodus:** gegen den Computer (Leicht/Mittel/Schwer) oder 2 Spieler lokal, Teamgröße 1 gegen 1 bis 11 gegen 11, Spielzeit 2/5/10 Minuten.
- **Training:** Torschuss, Dribbeln (Hütchen-Parcours auf Zeit), Elfmeter, Freistoß mit/ohne Mauer, Eckball.
- **Kamera:** hinter dem ballführenden Spieler, Draufsicht bei Anstoß und Abstoß. Alternativ „Hinter meinem Team“ oder TV-Kamera.
- **Regeln:** Tor, Einwurf, Ecke, Abstoß (kein Abseits, keine Fouls).
- **Steuerung:** Tastatur, Touch-Buttons, Gamecontroller. Legende im Spiel mit `H` oder dem „?“-Button.
- **Sounds:** werden live per Web Audio erzeugt (keine Audiodateien, keine Lizenzfragen).

## Lokal starten
Die Dateien müssen über einen Webserver laufen (wegen JavaScript-Modulen), z. B. `python3 -m http.server` im Ordner und dann `http://localhost:8000` öffnen. Online reicht GitHub Pages.

## Aufbau
- `index.html`, `css/style.css` – Seite und Aussehen
- `js/game.js` – Spiellogik, Physik, Computergegner, Training, Kamera
- `js/world.js` – 3D-Grafik (Three.js)
- `js/input.js` – Tastatur, Touch, Controller
- `js/audio.js` – Sounds
- `js/main.js` – Menüs, Legende, HUD
- `sw.js`, `manifest.webmanifest`, `icons/` – App-Installation und Offline-Betrieb
- `vendor/three.module.min.js` – Three.js r170 (MIT-Lizenz, siehe `vendor/three-LICENSE.txt`)

Nach Änderungen an Dateien in `sw.js` die Versionsnummer (`bolzplatz-v1`) erhöhen.
