# claude-plugins

Claude-Code-Mods von ykatkus.

## vaults

Mehrere Markdown-Vaults (z. B. Obsidian) in Claude Code. Jeder Vault beschreibt sich selbst in einer
`.claude-vault.json` im Wurzelordner:

- **Spoiler-Schutz je Vault:** geschützte Ordner liest nur ein Agent, nie die Hauptsitzung; `/vault spoiler aus`
  löst ihn für diese Sitzung und nur für diesen Vault.
- **Prüfbefehl:** läuft nach jeder Änderung im Vault (z. B. ein Validierungsskript).
- **Panel** mit Karten aus Notizen des Vaults, **Backup** (Spiegel und git-Bundle) in einen Ordner nach Wahl
  (`/vault backup-ziel <Pfad>`).

`/vault` zeigt den Stand; `/vault liste`, `neu <Pfad>`, `wechsel <Name>`, `panel`, `prüfen`, `backup`,
`spoiler an|aus`, `gespielt <Mission>`.

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
