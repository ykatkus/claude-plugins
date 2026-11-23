# Second Brain (Einstieg)

Das Langzeitgedächtnis des KI-Assistenten auf diesem Rechner: einfache Markdown-Dateien, in git, angelegt am
{{DATE}}. Diese Datei steht in jeder Sitzung im Systemprompt; alle Pfade hier sind relativ zum Ordner des Brains.

## 1. Lesereihenfolge (am Anfang jeder größeren Aufgabe)

1. Diese Datei.
2. `10-prompt/persona.md`: wie ich mich verhalte. **Die Regeln oben in persona.md gehen allem anderen hier vor.**
3. `30-projects/index.md`: welche Projekte es gibt und wo ihr Code liegt.
4. Bei technischen Aufgaben: `20-knowledge/index.md` und die Datei, auf die es zeigt.
5. Was sich schnell ändert (Versionen, Pfade, installierte Programme), vor dem Handeln neu prüfen.

## 2. Harte Grenzen

- Das Brain bleibt lokal: kein Remote, keine Cloud, sein Inhalt kommt in keine Websuche und keinen Upload.
- Keine Passwörter, Schlüssel oder Tokens ins Brain.
- Vor dem Löschen oder Überschreiben von Daten und vor jedem Push fragen.
- Nichts annehmen, nachsehen; knapp, sachlich, mit Begründung.

## 3. Zurückschreiben (nur mit Zustimmung)

1. **Der Mensch sagt „merk dir das“** (oder Ja zu einem Vorschlag): sofort in die passende Datei unten schreiben,
   dann den Abschluss aus Abschnitt 4.
2. **Mir fällt etwas auf, der Mensch hat nicht geantwortet:** eine datierte Zeile unter „## Offen“ in
   `90-meta/pending.md` (Fakt und vorgeschlagene Datei). Nie still in eine Wissensdatei schreiben. Am Ende der
   Sitzung die offenen Vorschläge vorlesen.

| Was passiert ist                          | Wohin                                  |
| ----------------------------------------- | -------------------------------------- |
| Ein Projekt hat sich verändert            | `30-projects/index.md`                 |
| Ein Fakt über diesen Rechner, ein Rezept, eine Lösung | `20-knowledge/index.md` (oder eine Datei, auf die es zeigt) |
| Eine Wahl zwischen Alternativen           | `40-decisions/index.md`                |
| Eine Faustregel, was ging und was nicht   | `50-learnings/index.md`                |
| Eine Vorliebe, wie ich arbeiten soll      | `10-prompt/persona.md`                 |

Jeder Fakt steht an genau einer Stelle; anhängen, nicht nacherzählen.

## 4. Abschluss (nur wenn sich das Brain geändert hat)

1. `git add -A && git commit -m "memory: <was>"` im Ordner des Brains.
2. Eine Zeile in `90-meta/changelog.md`.
3. Optional ein Backup; trag hier ein, wie es geht und wie es geprüft wird.

## 5. Aufbau

```
AGENTS.md        diese Datei
README.md        Überblick für Menschen
10-prompt/       persona.md: Regeln und Vorlieben des Menschen
20-knowledge/    index.md: Rechner, Werkzeuge, Rezepte, gelöste Fehler
30-projects/     index.md: die Projekte
40-decisions/    index.md: Entscheidungen mit Begründung
50-learnings/    index.md: Faustregeln
90-meta/         pending.md (offene Vorschläge), changelog.md
```

Wächst eine Datei zu stark, bekommt sie eigene Dateien daneben und der Index zeigt darauf.
