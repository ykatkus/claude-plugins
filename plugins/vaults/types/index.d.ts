/** One card of a vault's panel, read from one note of the vault (all optional but `title` and `file`). */
export type PanelCard = {
  title: string
  /** The note, relative to the vault. */
  file: string
  /** A regular expression; its first group is shown after the title ("Nachtfalter · 40 %"). */
  match?: string
  /** A two-column table's key: its value is shown after the title. */
  field?: string
  /** A table to list: true for the note's first table, or the heading (a regular expression) it follows. */
  table?: boolean | string
  /** Which columns of each row to show (0-based), joined by `join`. */
  columns?: number[]
  join?: string
  /** Only the last n rows. */
  last?: number
  /** Leave out rows any cell of which matches this regular expression. */
  exclude?: string
  /** Leave out rows whose column n is not empty (an open tab: "settled" still empty). */
  emptyColumn?: number
  /** Shown when the table has no rows. */
  none?: string
}

/** What a vault's .claude-vault.json says. */
export type VaultConfig = {
  name: string
  /** The command run in the vault root after each change, e.g. ["python3", "_meta/scripts/validate.py"]. */
  validate?: string[]
  guard?: {
    /** Paths the main loop never reads (relative to the vault, or ~/...). */
    protected?: string[]
    /** A folder whose notes open once their mission is played. */
    byMission?: { dir: string; field: string; played: number[] }
    /** Folders a search may always go into. */
    open?: string[]
    /** An MCP tool whose full reads are refused, and the lists that may be read. */
    studio?: { tool: string; safeLists: string[] }
  }
  /** A folder of proposals: the status counts only, never the content. */
  proposals?: string
  panel?: PanelCard[]
  /**
   * The vault is a second brain: this note (its boot file, e.g. "AGENTS.md") goes into the system prompt of every
   * session, in whatever folder it starts, except in a vault that says `brain: false`.
   */
  boot?: string
  /** The brain's open proposals: a note whose "## Offen" (or "## Open") list /vault brain and the start show. */
  pending?: string
  /** false: sessions in this vault get no brain (a vault whose own rules forbid instructions from outside it). */
  brain?: boolean
}

/** A vault the plugin knows: its root and its config. */
export type Vault = { root: string; config: VaultConfig }

/** The last run of a vault's validate command. */
export type VaultCheck = { at: string; summary: string; isClean: boolean; lines: string[] }

/** What the pane shows: one entry per card. */
export type CardView = { title: string; lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    vaults: {
      /** The roots whose guard is off in this session. */
      unguarded: Shaped<string[]>
      /** The vault the session works in (the pane's), by root, or null. */
      current: Shaped<string | null>
      checks: Shaped<Record<string, VaultCheck>>
      views: Shaped<Record<string, CardView[]>>
      /** Whether the brain is left out of this session (/vault brain aus, or a vault with brain: false). */
      brainOff: Shaped<boolean>
    }
  }
}
