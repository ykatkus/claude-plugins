# claude-plugins

Claude-Code-Mods von ykatkus.

## vaults

Mehrere Markdown-Vaults (z. B. Obsidian) in Claude Code. Jeder Vault beschreibt sich selbst in einer
`.claude-vault.json` im Wurzelordner:

- **Spoiler-Schutz je Vault:** geschützte Ordner liest nur ein Agent, nie die Hauptsitzung; `/vault spoiler aus`
  löst ihn für diese Sitzung und nur für diesen Vault.
- **Spielleiter-Modus:** lädt die Sitzung `pnp-spielleiter` oder `pnp-kampagne` (D&D Studio), liest die Hauptsitzung
  Spielleiterwissen, aber das Terminal verdeckt die Ergebnisse (auch mit ctrl+o): Wer mitspielt, sieht nichts.
  `/vault spielleitung an|aus` schaltet ihn von Hand; weitere Skills nennt `guard.gameMasterSkills`.
- **Prüfbefehl:** läuft nach jeder Änderung im Vault (z. B. ein Validierungsskript).
- **Panel** mit Karten aus Notizen des Vaults, **Backup** (Spiegel und git-Bundle) in einen Ordner nach Wahl
  (`/vault backup-ziel <Pfad>`).

- **Second Brain:** ein Vault mit `"boot": "AGENTS.md"` ist ein Brain. Seine Boot-Datei steht im Systemprompt
  jeder Sitzung, in welchem Ordner sie auch startet; seine offenen Vorschläge (`"pending"`) zeigt `/vault brain`.
  Ein Vault mit `"brain": false` bekommt es nicht.

`/vault` zeigt den Stand; `/vault liste`, `neu <Pfad>`, `wechsel <Name>`, `panel`, `prüfen`, `backup`,
`spoiler an|aus`, `spielleitung an|aus`, `gespielt <Mission>`, `brain [an|aus]`.

### Ein Brain anlegen

```
/vault brain neu ~/brain
```

legt in einem leeren Ordner ein Brain mit Startgerüst an (Regeln für den Assistenten, Wissen, Projekte,
Entscheidungen, offene Vorschläge), mit git. Danach `10-prompt/persona.md` mit den eigenen Regeln füllen und eine
neue Sitzung starten. Das Brain bleibt lokal; das Plugin lädt nichts hoch.

Ein bestehender Ordner wird Brain mit einer `.claude-vault.json` wie dieser, dann `/vault neu <Pfad>`:

```json
{ "name": "Brain", "boot": "AGENTS.md", "pending": "90-meta/pending.md" }
```

## Installieren

Im Terminal an der Eingabe von Claude Code:

```
/plugin install vaults --marketplace ykatkus/claude-plugins
```

Aus einer Shell:

```
claude plugin install vaults --marketplace ykatkus/claude-plugins
```

In der Desktop-App, wo `/plugin` nicht läuft: + neben dem Eingabefeld, dann Plugins, Add marketplace mit
`ykatkus/claude-plugins`, dann Add plugin.
