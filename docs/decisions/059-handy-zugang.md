# 059 — Handy-Zugang

**Status:** angenommen · **Datum:** 2026-11-10

## Kontext

Robin will die Sessions vom Handy aus verfolgen und beantworten. Die Agenten laufen auf dem PC (Claude-Kommandozeile, Git, Dateien), die Daten liegen in der SQLite-Datenbank der App. Eine zweite Datenhaltung auf dem Handy liefe auseinander.

## Optionen

- **(a) Native App mit Tauri Mobile** verworfen: Sie braucht dieselbe Fernsteuerung wie (b) und dazu den Android- bzw. iOS-Build.
- **(b) Die laufende App bietet eine Handy-Ansicht über HTTP an, das Handy ist nur Fernbedienung** gewählt.
- **(c) Die ganze Desktop-Oberfläche über eine Transportschicht statt `invoke` ins Netz stellen** verworfen: 129 Befehle, viele davon an Fenster und Dateidialoge gebunden, und das Layout passt nicht aufs Handy.

## Entscheidung

- `src-tauri/src/mobile/` startet einen HTTP-Server auf `127.0.0.1:47800`. Er liefert die gebauten Seiten aus dem Asset-Resolver der App (`/` = `mobile.html`).
- Eine kleine JSON-API ruft dieselben Registry-Methoden wie die Tauri-Befehle auf: `GET /api/projects`, `/api/sessions`, `/api/chat?session=&before=&limit=` sowie `POST /api/send`, `/api/answer`, `/api/pause`, `/api/resume`. Fehler kommen als `CommandError` mit Status 409.
- `GET /api/events` reicht `chat://entry`, `session://changed` und `project://changed` als Server-Sent Events weiter. So bleibt das Handy synchron, ohne eigene Datenhaltung.
- Anmeldung mit dem Schlüssel aus `~/.verwalter/handy-schluessel.txt` (beim ersten Start erzeugt), entweder per Link `…/mobile.html#k=<Schlüssel>` oder über ein Eingabefeld. `POST /api/login` setzt das Cookie `verwalter_handy` (`HttpOnly`, `Secure`, `SameSite=Strict`, ein Jahr). Die Seiten selbst sind ohne Cookie abrufbar, weil der Browser das Manifest ohne Cookie lädt.
- POST verlangt `application/json`. Damit kann eine fremde Seite nur nach einer Vorabfrage senden, und die beantwortet der Server nie.
- Ins Tailnet kommt der Server nur über `tailscale serve`, das TLS davorsetzt. Ohne diesen Schritt ist er nur auf dem PC erreichbar.
- Oberfläche: `mobile.html` und `src/mobile/` als zweiter Einstieg in Vite. Sie nutzt Tokens, Status-Texte, `Markdown`, die Rückfrage-Logik (`questionDraft`) und den Chat-Lader (`createChatLoader`, jetzt mit Transport als Parameter) des Desktops mit.
- Bricht der Ereignisstrom ab, baut die Seite ihn nach 3 s neu auf und lädt Listen und Verlauf neu, weil `EventSource` nach einer Antwort ungleich 200 aufgibt.

## Konsequenzen

- Hält eine zweite laufende App den Port, startet der Handy-Zugang nicht. Der Rest der App läuft weiter.
- Im Dev-Lauf liest der Asset-Resolver `dist/` von der Platte. Deshalb lehnt der Server Namen mit `..`, `\` oder `:` ab. Mit Hot Reload: `http://localhost:1420/mobile.html`, `/api` leitet Vite an den Core weiter.
- Das Cookie trägt den Schlüssel selbst. Cookies trennen nicht nach Port, also sieht jeder andere Dienst unter demselben `ts.net`-Namen es auch.
- Anhänge, Changes, Artefakte und neue Vorhaben gibt es auf dem Handy nicht. Wer das braucht, erweitert die API um die passende Registry-Methode.
- Einrichten im Tailnet (einmal, auf dem PC): `tailscale serve --bg --https=8445 http://127.0.0.1:47800`. Danach `https://<rechner>.<tailnet>.ts.net:8445/mobile.html#k=<Schlüssel>` auf dem Handy öffnen und zum Startbildschirm hinzufügen.
