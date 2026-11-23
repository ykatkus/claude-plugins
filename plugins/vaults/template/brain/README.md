# Mein Second Brain

Was der KI-Assistent über diesen Rechner, meine Projekte und meine Arbeitsweise wissen soll, als einfache
Markdown-Dateien in git. Die Regeln für den Assistenten stehen in `AGENTS.md`; das Plugin `vaults` legt sie in jede
Claude-Code-Sitzung (eingestellt in `.claude-vault.json`, Feld `boot`).

- Eigene Regeln und Vorlieben: `10-prompt/persona.md`
- Was der Assistent vorschlägt, sich zu merken: `90-meta/pending.md` (Ja oder Nein sagen, dann trägt er es ein)
- Stand: `/vault brain` in Claude Code; `/vault brain aus` lässt es für eine Sitzung weg
- Ein Vault, der kein Brain bekommen soll, trägt `"brain": false` in seine `.claude-vault.json` ein.

Lässt sich in Obsidian oder jedem anderen Markdown-Editor öffnen.
