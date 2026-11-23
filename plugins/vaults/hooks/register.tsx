import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput } from 'claude-code'

import type { CardView, PanelCard, Vault, VaultCheck, VaultConfig } from '../types'

const PANE = 'vaults'
const CONFIG = '.claude-vault.json'

const unguarded = atom({ plugin: 'vaults', key: 'unguarded' } as const, [], { shape: 'unguarded-1' })
const current = atom({ plugin: 'vaults', key: 'current' } as const, null, { shape: 'current-1' })
const checks = atom({ plugin: 'vaults', key: 'checks' } as const, {}, { shape: 'checks-1' })
const views = atom({ plugin: 'vaults', key: 'views' } as const, {}, { shape: 'views-1' })
const brainOff = atom({ plugin: 'vaults', key: 'brainOff' } as const, false, { shape: 'brainOff-1' })

let home = ''
let known: Vault[] = []
/** The boot files of the brain vaults, read at session start: root → text. */
let boots: Record<string, string> = {}

// ---- paths --------------------------------------------------------------------------------------------------

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
const short = (path: string) => (home !== '' && isUnder(path, home) ? `~${path.slice(home.length)}` : path)

/** An absolute, tidied path: relative ones against `base`, `~` against home. */
const resolve = (path: string, base: string) => {
  const raw = path.startsWith('~/') ? `${home}/${path.slice(2)}` : path.startsWith('/') ? path : `${base}/${path}`
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

const vaultOf = (path: string) => known.find(v => isUnder(path, v.root))

// ---- the registry: every vault's own .claude-vault.json, the roots remembered across sessions -----------------

const loadVault = async ($: EngineInterface, root: string): Promise<Vault | undefined> => {
  const text = await $.fs.read(`${root}/${CONFIG}`).catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const config = JSON.parse(text) as VaultConfig
    return typeof config.name === 'string' ? { root, config } : undefined
  } catch {
    return undefined
  }
}

const rememberedRoots = async ($: EngineInterface) => {
  const stored = await $.store.get('roots')
  return Array.isArray(stored) ? stored.filter((r): r is string => typeof r === 'string') : []
}

/** Loads every remembered vault, plus the one the working directory is in (found by walking up to its config). */
const loadAll = async ($: EngineInterface, cwd: string) => {
  const roots = new Set(await rememberedRoots($))
  for (let dir = cwd; dir !== '/' && dir !== ''; dir = dir.slice(0, dir.lastIndexOf('/')) || '/') {
    if (await $.fs.exists(`${dir}/${CONFIG}`)) {
      roots.add(dir)
      break
    }
  }
  const loaded = await Promise.all([...roots].map(root => loadVault($, root)))
  known = loaded.filter((v): v is Vault => v !== undefined)
  await $.store.set('roots', known.map(v => v.root))
}

const played = async ($: EngineInterface, vault: Vault) => {
  const stored = await $.store.get(`played:${vault.root}`)
  return Array.isArray(stored) ? stored.filter((n): n is number => typeof n === 'number') : (vault.config.guard?.byMission?.played ?? [])
}

// ---- the spoiler guard --------------------------------------------------------------------------------------

const protectedOf = (vault: Vault) => (vault.config.guard?.protected ?? []).map(p => resolve(p, vault.root))
const missionDirOf = (vault: Vault) => {
  const dir = vault.config.guard?.byMission?.dir
  return dir ? resolve(dir, vault.root) : undefined
}
const isGuarded = (vault: Vault) => vault.config.guard !== undefined

/** Why the main loop may not read this path, or undefined when it may. */
const whyProtected = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  const vault = known.find(v => isGuarded(v) && (isUnder(path, v.root) || protectedOf(v).some(p => isUnder(path, p))))
  if (!vault || (await read($, unguarded)).includes(vault.root)) return undefined
  if (protectedOf(vault).some(dir => isUnder(path, dir))) return `Spielleiterwissen von ${vault.config.name}`
  const missions = missionDirOf(vault)
  if (!missions || !isUnder(path, missions)) return undefined
  if (!path.endsWith('.md')) return `Spielleiterwissen von ${vault.config.name}`
  const field = vault.config.guard?.byMission?.field ?? 'mission_number'
  const text = await $.fs.read(path).catch(() => '')
  const mission = Number(new RegExp(`^${field}:\\s*(\\d+)`, 'm').exec(text)?.[1] ?? NaN)
  return (await played($, vault)).includes(mission) ? undefined : `eine noch nicht gespielte Mission von ${vault.config.name}`
}

/** Whether a search rooted here would reach a protected place of a guarded vault. */
const searchReaches = async ($: EngineInterface, root: string) => {
  const off = await read($, unguarded)
  return known.find(
    v =>
      isGuarded(v) &&
      !off.includes(v.root) &&
      [...protectedOf(v), ...[missionDirOf(v)].filter((d): d is string => !!d)].some(
        dir => isUnder(dir, root) || isUnder(root, dir),
      ),
  )
}

const deny = (what: string, why: string, vault?: Vault) => {
  const open = vault?.config.guard?.open ?? []
  return {
    deny:
      `vaults: ${what} ist ${why} (Spoiler-Schutz). Lass einen Agenten damit arbeiten und nur Zahlen melden` +
      (open.length > 0 ? `, oder suche gezielt in ${open.join(', ')}` : '') +
      `. Der Mensch kann den Schutz mit /vault spoiler aus für diese Sitzung lösen.`,
  }
}

const READ_VERBS = /\b(cat|head|tail|less|more|sed|awk|grep|rg|ag|bat|strings|diff|cut|sort|uniq|python3?|node|jq|xxd|od|find|ls|tree|git\s+(show|diff|log|grep|blame))\b/

/** The guard's answer for one call of the main loop: a denial, or undefined to let it run. */
const spoilerDenial = async ($: EngineInterface, e: ToolCallInput, cwd: string) => {
  const args = e as unknown as Record<string, unknown>
  const text = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const off = await read($, unguarded)
  const here = vaultOf(cwd)

  if (e.tool === 'Read') {
    const path = resolve(text('file_path') ?? '', cwd)
    const why = await whyProtected($, path)
    if (why) return deny(short(path), why, vaultOf(path))
  }

  if (e.tool === 'Grep' || e.tool === 'Glob') {
    const root = resolve(text('path') ?? '.', cwd)
    // Glob: the pattern's literal start narrows the root ("30-campaign/**" searches 30-campaign).
    const pattern = e.tool === 'Glob' ? (text('pattern') ?? '') : ''
    const prefix = pattern.split(/[*?[{]/)[0]?.replace(/\/[^/]*$/, '') ?? ''
    const target = prefix === '' ? root : resolve(prefix, root)
    if (target.endsWith('.md')) {
      const why = await whyProtected($, target)
      if (why) return deny(short(target), why, vaultOf(target))
    } else {
      const vault = await searchReaches($, target)
      if (vault) return deny(`eine Suche über ${short(target)}`, `ganz oder zum Teil Spielleiterwissen von ${vault.config.name}`, vault)
    }
  }

  if (e.tool === 'Bash') {
    const command = text('command') ?? ''
    // Appending to a protected file (`cat >> _meta/changelog.md <<EOF`) writes, it does not read.
    const reading = command.replace(/(?:>>?|\btee(?:\s+-a)?)\s*\S+/g, ' ')
    for (const vault of known.filter(v => isGuarded(v) && !off.includes(v.root))) {
      // Each vault guards only its own folders: a bare relative name ("90-gm", "_meta/proposals") counts only from a
      // session inside that vault; from anywhere else only a path that names the vault itself ("alpha/90-gm",
      // "~/vaults/alpha/90-gm", the absolute path) does.
      const isInside = isUnder(cwd, vault.root)
      const base = vault.root.split('/').at(-1) ?? vault.root
      const words = [...(vault.config.guard?.protected ?? []), vault.config.guard?.byMission?.dir ?? '']
        .filter(w => w !== '')
        .flatMap(w => {
          if (w.startsWith('~/') || w.startsWith('/')) return [w.replace(/^~\//, ''), resolve(w, vault.root)]
          return isInside ? [w] : [`${base}/${w}`]
        })
      if (READ_VERBS.test(reading) && words.some(w => reading.includes(w)))
        return deny('dieser Befehl', `ein Zugriff auf Spielleiterwissen von ${vault.config.name}`, vault)
    }
    // Where the command works: a leading `cd <dir> &&` or `git -C <dir>` moves it out of the session's folder.
    const moved = /^\s*cd\s+(["']?)([^\s"';&|]+)\1\s*(?:&&|;)/.exec(command)?.[2] ?? /\bgit\s+-C\s+(["']?)([^\s"';&|]+)\1/.exec(command)?.[2]
    const workDir = moved ? resolve(moved, cwd) : cwd
    if (here && isGuarded(here) && !off.includes(here.root) &&
      (isUnder(workDir, here.root) || command.includes(here.root) || command.includes(short(here.root)))
    ) {
      const open = here.config.guard?.open ?? []
      const namesOpen = open.some(o => command.includes(o))
      if (/\b(grep|rg)\b[^|;]*\s-\w*r/.test(command) && !namesOpen)
        return deny(`eine Suche über ganz ${here.config.name}`, 'zum Teil Spielleiterwissen', here)
      if (/\bgit\s+(diff|show|log\s[^|;]*-p)\b/.test(command) && !open.some(o => new RegExp(`\\s--\\s+.*${o}`).test(command)))
        return deny('dieser git-Befehl', `ein Blick in Spielleiter-Änderungen von ${here.config.name}`, here)
    }
  }

  // The Studio campaign is guarded by the session's own vault only (its switch alone turns it off); a session in no
  // vault, or in one without a Studio guard, keeps every vault's Studio guard.
  const sessionRoot = await read($, current)
  const session = known.find(v => v.root === sessionRoot)
  const studioOwners = session?.config.guard?.studio ? [session] : known
  for (const vault of studioOwners.filter(v => v.config.guard?.studio?.tool === e.tool && !off.includes(v.root))) {
    const safe = new Set(vault.config.guard?.studio?.safeLists ?? [])
    const isGet = args['action'] === undefined || args['action'] === 'get'
    const lists = Array.isArray(args['only']) ? (args['only'] as string[]) : []
    const isSafe = args['names'] !== undefined || (lists.length > 0 && lists.every(l => safe.has(l)))
    if (isGet && !isSafe) return deny('dieses volle Lesen der Studio-Kampagne', `Spielleiterwissen von ${vault.config.name}`, vault)
  }

  return undefined
}

// ---- the validate command -----------------------------------------------------------------------------------

const running = new Map<string, Promise<VaultCheck>>()

const validate = ($: EngineInterface, vault: Vault): Promise<VaultCheck> => {
  const argv = vault.config.validate
  if (!argv || argv.length === 0) return Promise.resolve({ at: '', summary: 'kein Prüfbefehl', isClean: true, lines: [] })
  const pending = running.get(vault.root)
  if (pending) return pending
  const job = (async () => {
    try {
      const ran = await $.process.run(argv, { cwd: vault.root, timeoutMs: 120_000 })
      const out = `${ran.stdout}\n${ran.stderr}`.split('\n').map(l => l.trimEnd()).filter(l => l !== '')
      const counted = out.findLast(l => /\b\d+ errors?\b/.test(l))
      const summary = counted ?? (out.at(-1) || `exit ${ran.exitCode}`)
      const counts = /(\d+) errors?(?:, (\d+) warnings?)?/.exec(summary)
      const isClean = ran.exitCode === 0 && (counts === null || (counts[1] === '0' && (counts[2] ?? '0') === '0'))
      const result: VaultCheck = {
        at: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        summary,
        isClean,
        lines: isClean ? [] : out.filter(l => l !== summary).slice(-20),
      }
      await update($, checks, all => ({ ...all, [vault.root]: result }))
      return result
    } finally {
      running.delete(vault.root)
    }
  })()
  running.set(vault.root, job)
  return job
}

/** The vault file a call changed, or undefined. */
const changedPath = (e: ToolCallInput, cwd: string) => {
  const args = e as unknown as Record<string, unknown>
  const text = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  if (e.tool === 'Write' || e.tool === 'Edit') return resolve(text('file_path'), cwd)
  if (e.tool === 'NotebookEdit') return resolve(text('notebook_path'), cwd)
  if (e.tool === 'Bash') {
    const command = text('command')
    const target = /(?:>>?|tee(?:\s+-a)?)\s+(\S+\.md)\b/.exec(command)?.[1]
    if (target) return resolve(target, cwd)
    if (/\bsed\s+-i\b/.test(command) && /\.md\b/.test(command)) return cwd
  }
  return undefined
}

// ---- the backup: a mirror and a dated git bundle per vault, then a check -------------------------------------

const DEFAULT_BACKUP = '/mnt/Backups/vaults'
const backupRoot = async ($: EngineInterface) => {
  const stored = await $.store.get('backupRoot')
  return typeof stored === 'string' ? stored : DEFAULT_BACKUP
}
const slugOf = (vault: Vault) => vault.root.split('/').at(-1) ?? 'vault'
const today = () => new Date().toISOString().slice(0, 10)
/** Local date and time to the minute, e.g. 2026-11-21-2032, the naming of the brain's own recipe. */
const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** Backs one vault up and checks the copy; resolves one line saying how it went. */
const backup = async ($: EngineInterface, vault: Vault): Promise<string> => {
  const base = await backupRoot($)
  if (!(await $.fs.exists(base))) return `${vault.config.name}: ${base} ist nicht erreichbar (NAS nicht eingehängt?)`
  const dest = `${base}/${slugOf(vault)}`
  const run = (argv: string[], timeoutMs = 600_000) => $.process.run(argv, { cwd: vault.root, timeoutMs })
  await run(['mkdir', '-p', `${dest}/mirror`, `${dest}/bundles`])

  const excludes = ['--exclude', '.obsidian/workspace*.json', '--exclude', '.trash/']
  const mirrored = await run(['rsync', '-rlt', '--delete', ...excludes, `${vault.root}/`, `${dest}/mirror/`])
  if (mirrored.exitCode !== 0) return `${vault.config.name}: Spiegel fehlgeschlagen (${mirrored.stderr.trim().split('\n').at(-1) ?? ''})`
  const drift = await run(['rsync', '-rltn', '--delete', '--itemize-changes', ...excludes, `${vault.root}/`, `${dest}/mirror/`])
  const differs = drift.stdout.split('\n').filter(l => l.trim() !== '').length
  if (differs > 0) return `${vault.config.name}: Spiegel weicht nach dem Kopieren in ${differs} Einträgen ab`

  let bundled = 'kein git'
  if (await $.fs.exists(`${vault.root}/.git`)) {
    // A new name per run (local time to the minute): a dated snapshot is never replaced.
    const file = `${dest}/bundles/${slugOf(vault)}-${stamp()}.bundle`
    if (await $.fs.exists(file)) return `${vault.config.name}: ${file.split('/').at(-1)} gibt es schon, nicht überschrieben (in einer Minute nochmal)`
    const made = await run(['git', 'bundle', 'create', file, '--all'])
    if (made.exitCode !== 0) return `${vault.config.name}: git-Bundle fehlgeschlagen (${made.stderr.trim().split('\n').at(-1) ?? ''})`
    const verified = await run(['git', 'bundle', 'verify', file])
    if (verified.exitCode !== 0) return `${vault.config.name}: git-Bundle lässt sich nicht prüfen`
    bundled = `Bundle ${file.split('/').at(-1)} geprüft`
  }
  await $.store.set(`backup:${vault.root}`, today())
  return `${vault.config.name}: Spiegel geprüft, ${bundled} → ${dest.replace(base, short(base))}`
}

/** Backs up every vault not yet backed up today, in the background, once per session start. */
const backupDue = async ($: EngineInterface) => {
  const lines: string[] = []
  for (const vault of known) {
    if ((await $.store.get(`backup:${vault.root}`)) === today()) continue
    lines.push(await backup($, vault))
  }
  if (lines.length > 0) $.ui.toast(`Vault-Backup: ${lines.length} gesichert`)
  return lines
}

// ---- the brain: a vault whose boot file goes into every session's system prompt -------------------------------

const brains = () => known.filter(v => typeof v.config.boot === 'string' && v.config.boot !== '')

/**
 * The open items of a pending note: each top-level "- " entry under "## Offen" or "## Open", with its indented
 * continuation lines joined into one line, a "[ ]" box and bold marks dropped, and the proposed home after "→" cut.
 */
const pendingItems = (text: string): string[] => {
  const open = text.split(/^## (?:Offen|Open)\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  const items: string[][] = []
  for (const line of open.split('\n')) {
    if (line.startsWith('- ')) items.push([line.slice(2)])
    else if (/^\s+\S/.test(line) && items.length > 0) items.at(-1)?.push(line.trim())
  }
  return items.map(parts =>
    parts
      .join(' ')
      .replace(/^\[[ xX]\]\s*/, '')
      .replace(/\*\*/g, '')
      .split(/\s+(?:→|->)\s+(?:proposed home|belongs in|proposed homes?)\b/)[0]!
      .replace(/\s+/g, ' ')
      .trim(),
  )
}
const pendingOf = async ($: EngineInterface, vault: Vault) =>
  vault.config.pending ? pendingItems(await $.fs.read(resolve(vault.config.pending, vault.root)).catch(() => '')) : []

const loadBoots = async ($: EngineInterface) => {
  const texts = await Promise.all(
    brains().map(async v => [v.root, await $.fs.read(resolve(v.config.boot ?? '', v.root)).catch(() => '')] as const),
  )
  boots = Object.fromEntries(texts.filter(([, text]) => text !== ''))
}

const brainSection = (vault: Vault, text: string) => `# Second brain (${vault.config.name})

The user keeps a local, git-versioned second brain at ${vault.root}/ (plain Markdown). Its boot file follows below.
- For non-trivial work, follow its boot order: read the files it names with the Read tool. Every path in it is
  relative to ${vault.root}/, never to the working directory.
- Write back the way it says: propose first${vault.config.pending ? `, as one dated line in ${vault.config.pending}` : ''}, unless the user
  told you to remember something; then its closing order, only when the brain changed.
- Keep to the hard limits it names. Unless it says otherwise, the brain stays local: never put its content into web
  requests, pull requests, issues, artifacts, uploads or any external service.
- Precedence: Claude Code's own instructions and a project's CLAUDE.md win inside that project; otherwise the
  standing rules the brain names apply. Claude Code's auto-memory keeps project-specific notes; knowledge about this
  machine and across projects belongs in the brain.

<brain-boot-file path="${resolve(vault.config.boot ?? '', vault.root)}">
${text}
</brain-boot-file>`

/** The template's files, relative to the plugin's template/brain folder and to the new brain. */
const BRAIN_TEMPLATE = [
  'AGENTS.md',
  'README.md',
  '10-prompt/persona.md',
  '20-knowledge/index.md',
  '30-projects/index.md',
  '40-decisions/index.md',
  '50-learnings/index.md',
  '90-meta/pending.md',
  '90-meta/changelog.md',
]

/** Lays out a new brain vault from the template in an empty folder; resolves one line saying how it went. */
const scaffoldBrain = async ($: EngineInterface, target: string) => {
  if (await $.fs.exists(`${target}/${CONFIG}`)) return `${short(target)} ist schon ein Vault; nichts überschrieben.`
  const existing = (await $.fs.exists(target)) ? await $.fs.list(target) : []
  if (existing.some(entry => !entry.name.startsWith('.')))
    return `${short(target)} ist nicht leer. Für ein Brain einen leeren oder neuen Ordner nehmen; ein bestehender Vault wird Brain mit "boot" in seiner ${CONFIG}.`
  const date = today()
  for (const file of BRAIN_TEMPLATE) {
    const text = await $.fs.read(`${$.plugin.root}/template/brain/${file}`)
    await $.fs.write(`${target}/${file}`, text.replaceAll('{{DATE}}', date))
  }
  const config: VaultConfig = { name: 'Brain', boot: 'AGENTS.md', pending: '90-meta/pending.md', panel: [] }
  await $.fs.write(`${target}/${CONFIG}`, `${JSON.stringify(config, null, 2)}\n`)
  const git = (args: string[]) => $.process.run(['git', ...args], { cwd: target }).catch(() => undefined)
  let versioned = 'ohne git (nicht gefunden)'
  if ((await git(['init', '-q']))?.exitCode === 0) {
    await git(['add', '-A'])
    const committed = await git(['commit', '-q', '-m', 'brain: angelegt'])
    versioned = committed?.exitCode === 0 ? 'mit git, erster Commit gemacht' : 'mit git; der erste Commit fehlt (git braucht Name und E-Mail)'
  }
  return `Brain angelegt in ${short(target)} (${BRAIN_TEMPLATE.length + 1} Dateien, ${versioned}). Es steht ab der nächsten Sitzung im Systemprompt; zuerst 10-prompt/persona.md mit deinen Regeln füllen.`
}

// ---- the pane's cards ---------------------------------------------------------------------------------------

const cells = (line: string) =>
  line
    .split('|')
    .slice(1, -1)
    .map(c => c.trim())
const plain = (s: string) =>
  s.replace(/\*\*/g, '').replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, a: string, _b, c: string | undefined) => c ?? a)

/** The rows of the first table after `heading` (or the note's first table), without its header. */
const tableRows = (text: string, heading?: string) => {
  const at = heading ? text.search(new RegExp(heading, 'm')) : 0
  if (at < 0) return []
  const lines = text.slice(at).split('\n')
  const start = lines.findIndex(l => l.startsWith('|'))
  if (start < 0) return []
  const rows: string[][] = []
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break
    if (/^\|[\s:|-]+\|$/.test(line)) continue
    rows.push(cells(line).map(plain))
  }
  return rows.slice(1)
}

const cardView = async ($: EngineInterface, vault: Vault, card: PanelCard): Promise<CardView> => {
  const text = await $.fs.read(resolve(card.file, vault.root)).catch(() => '')
  let title = card.title
  if (card.match) {
    const found = new RegExp(card.match, 'm').exec(text)?.[1]
    if (found) title += ` · ${plain(found.trim())}`
  }
  if (card.field) {
    const row = tableRows(text).find(r => r[0] === card.field)
    if (row?.[1]) title += ` · ${row[1]}`
  }
  if (card.table === undefined || card.table === false) return { title, lines: [] }

  const exclude = card.exclude ? new RegExp(card.exclude) : undefined
  let rows = tableRows(text, typeof card.table === 'string' ? card.table : undefined)
    .filter(r => !exclude || !r.some(c => exclude.test(c)))
    .filter(r => card.emptyColumn === undefined || (r[card.emptyColumn] ?? '') === '')
  if (card.last !== undefined) rows = rows.slice(-card.last)
  const columns = card.columns ?? [0, 1]
  const lines = rows.map(r => columns.map(i => r[i] ?? '').filter(c => c !== '').join(card.join ?? ': '))
  return { title, lines: lines.length > 0 ? lines : card.none ? [card.none] : [] }
}

const refresh = async ($: EngineInterface, vault: Vault) => {
  const cards = await Promise.all((vault.config.panel ?? []).map(card => cardView($, vault, card)))
  await update($, views, all => ({ ...all, [vault.root]: cards }))
}

// ---- the hooks ----------------------------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    await loadAll($, e.cwd)
    await $.command.register({
      name: 'vault',
      description:
        'Vaults: Stand; "/vault liste", "/vault neu <Pfad>", "/vault wechsel <Name>", "/vault panel", "/vault prüfen", "/vault backup", "/vault spoiler an|aus", "/vault gespielt <Mission>", "/vault brain [an|aus]", "/vault brain neu [Pfad]"',
    })

    const here = vaultOf(e.cwd)
    await update($, current, () => here?.root ?? null)
    await loadBoots($)
    await update($, brainOff, () => here?.config.brain === false)
    if (e.isInteractive && here?.config.brain !== false) {
      for (const brain of brains().filter(b => b.root in boots)) {
        const pending = await pendingOf($, brain)
        if (pending.length > 0) $.ui.toast(`${brain.config.name}: ${pending.length} offene Vorschläge (/vault brain)`)
      }
    }
    void backupDue($).catch(() => undefined)
    if (here) {
      await refresh($, here)
      void validate($, here).catch(() => undefined)
      if (e.isInteractive && (here.config.panel ?? []).length > 0) void $.ui.open({ id: PANE, title: here.config.name })
    }

    return next(e)
  })

  // The brain's boot file in the system prompt, one section per brain vault, unless this session leaves it out.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const own = composed.sections.filter(s => !s.id.startsWith('vaults:brain:'))
    if (await read($, brainOff)) return own.length === composed.sections.length ? composed : { sections: own }
    const added = brains()
      .filter(v => boots[v.root] !== undefined)
      .map(v => ({ id: `vaults:brain:${v.root}`, text: brainSection(v, boots[v.root] ?? ''), scope: 'session' as const }))
    return added.length === 0 && own.length === composed.sections.length ? composed : { sections: [...own, ...added] }
  })

  // One hook for every tool call: the spoiler guard before it (the main loop only: a subagent carries an agentId),
  // the vault's validate command after it when it changed a vault (main loop and agents alike).
  on('tool.call', async ($, e, next) => {
    if (known.length === 0) return next(e)
    const cwd = await $.session.cwd()
    if (e.agentId === undefined) {
      const denial = await spoilerDenial($, e, cwd)
      if (denial) return denial
    }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const path = changedPath(e, cwd)
    const vault = path ? vaultOf(path) : undefined
    if (!path || !vault || path.endsWith('/_meta/manifest.json')) return ran

    if ((await read($, current)) === vault.root) await refresh($, vault)
    const result = await validate($, vault)
    if (result.isClean) return ran
    $.ui.toast(`${vault.config.name}: ${result.summary}`)
    const note = `vaults: ${vault.config.name}, Prüfung nach dieser Änderung: ${result.summary}\n${result.lines.join('\n')}`
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'vaults: der Spoiler-Schutz ist hier fehlgeschlagen; lass einen Agenten damit arbeiten.' },
  )

  on('command.run', { command: 'vault' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(w => w !== '')
    const verb = (words[0] ?? '').toLowerCase()
    const rest = words.slice(1).join(' ')
    const cwd = await $.session.cwd()
    const root = await read($, current)
    const vault = known.find(v => v.root === root)

    if (verb === 'liste') {
      if (known.length === 0) return { text: `Keine Vaults bekannt. Ein Vault ist ein Ordner mit ${CONFIG}; /vault neu <Pfad> meldet ihn an.` }
      return {
        text: known
          .map(
            v =>
              `${v.root === root ? '▸' : ' '} ${v.config.name} (${short(v.root)})${v.config.boot ? ' · Brain' : ''}${isGuarded(v) ? ' · Spoiler-Schutz' : ''}${v.config.brain === false ? ' · ohne Brain' : ''}`,
          )
          .join('\n'),
      }
    }

    if (verb === 'neu') {
      const path = resolve(rest || '.', cwd)
      const loaded = await loadVault($, path)
      if (!loaded) {
        const name = path.split('/').at(-1) ?? 'Vault'
        const config: VaultConfig = { name, panel: [] }
        await $.fs.write(`${path}/${CONFIG}`, `${JSON.stringify(config, null, 2)}\n`)
      }
      await $.store.set('roots', [...new Set([...(await rememberedRoots($)), path])])
      await loadAll($, cwd)
      return {
        text: loaded
          ? `${loaded.config.name} (${short(path)}) ist angemeldet.`
          : `${short(path)} ist angemeldet, mit einer leeren ${CONFIG}: dort Name, Prüfbefehl, Schutz und Panel eintragen.`,
      }
    }

    if (verb === 'wechsel') {
      const target = known.find(v => v.config.name.toLowerCase() === rest.toLowerCase())
      if (!target) return { text: `Kein Vault namens „${rest}“. /vault liste zeigt alle.` }
      await update($, current, () => target.root)
      await refresh($, target)
      return { text: `Panel und /vault zeigen jetzt ${target.config.name}.` }
    }

    if (verb === 'backup') {
      if (known.length === 0) return { text: 'Keine Vaults bekannt.' }
      const lines: string[] = []
      for (const one of known) lines.push(await backup($, one))
      return { text: lines.join('\n') }
    }
    if (verb === 'backup-ziel' && rest !== '') {
      await $.store.set('backupRoot', resolve(rest, cwd))
      return { text: `Backups gehen jetzt nach ${resolve(rest, cwd)}.` }
    }

    if (verb === 'brain') {
      const sub = (words[1] ?? '').toLowerCase()
      if (sub === 'neu') {
        const target = resolve(words.slice(2).join(' ') || '~/brain', cwd)
        const said = await scaffoldBrain($, target)
        if (await $.fs.exists(`${target}/${CONFIG}`)) {
          await $.store.set('roots', [...new Set([...(await rememberedRoots($)), target])])
          await loadAll($, cwd)
          await loadBoots($)
        }
        return { text: said }
      }
      const all = brains()
      if (all.length === 0)
        return { text: `Kein Brain bekannt. "/vault brain neu [Pfad]" legt eins an; ein bestehender Vault wird Brain mit "boot": "AGENTS.md" in seiner ${CONFIG} (dann /vault neu <Pfad>).` }
      if (sub === 'an' || sub === 'aus') {
        await update($, brainOff, () => sub === 'aus')
        return { text: sub === 'an' ? 'Das Brain ist für diese Sitzung eingebunden (ab einem neuen Gesprächsfaden).' : 'Das Brain ist für diese Sitzung ausgeschaltet.' }
      }
      const isOff = await read($, brainOff)
      const lines: string[] = []
      for (const brain of all) {
        const run = (args: string[]) => $.process.run(['git', ...args], { cwd: brain.root }).catch(() => undefined)
        const [last, status, pending] = await Promise.all([run(['log', '-1', '--format=%h · %cr · %s']), run(['status', '--porcelain']), pendingOf($, brain)])
        const changed = status?.exitCode === 0 ? status.stdout.split('\n').filter(l => l.trim() !== '').length : undefined
        lines.push(
          `${brain.config.name} (${short(brain.root)}/): ${isOff || !(brain.root in boots) ? 'nicht eingebunden' : 'eingebunden'} in dieser Sitzung`,
          `Letzter Commit: ${last?.exitCode === 0 ? last.stdout.trim() || '—' : '—'}`,
          changed === undefined ? 'Kein git-Repository' : `Nicht committet: ${changed} ${changed === 1 ? 'Datei' : 'Dateien'}`,
          ...(brain.config.pending ? [`Offene Vorschläge (${brain.config.pending}): ${pending.length}`] : []),
          ...pending.map(item => `  • ${item.length > 110 ? `${item.slice(0, 107)}…` : item}`),
        )
      }
      const without = known.filter(v => v.config.brain === false)
      if (without.length > 0) lines.push(`Ohne Brain: ${without.map(v => v.config.name).join(', ')}`)
      return { text: lines.join('\n') }
    }

    if (!vault) return { text: 'Diese Sitzung liegt in keinem Vault. /vault liste, /vault wechsel <Name> oder /vault neu <Pfad>.' }

    if (verb === 'panel') {
      await refresh($, vault)
      const opened = await $.ui.open({ id: PANE, title: vault.config.name })
      return { text: opened.isPlaced ? `${vault.config.name}-Panel geöffnet.` : 'Das Panel wartet auf Platz im Terminal.' }
    }
    if (verb === 'spoiler' && (rest === 'an' || rest === 'aus')) {
      await update($, unguarded, list => (rest === 'aus' ? [...new Set([...list, vault.root])] : list.filter(r => r !== vault.root)))
      return { text: `Spoiler-Schutz für ${vault.config.name} ist ${rest === 'an' ? 'an' : 'für diese Sitzung aus'}.` }
    }
    if (verb === 'gespielt' && /^\d+$/.test(rest)) {
      const list = [...new Set([...(await played($, vault)), Number(rest)])].sort((a, b) => a - b)
      await $.store.set(`played:${vault.root}`, list)
      return { text: `${vault.config.name}: gespielte Missionen ${list.join(', ')}. Ihre Notizen sind jetzt lesbar.` }
    }
    if (verb === 'prüfen' || verb === 'pruefen') {
      const result = await validate($, vault)
      return { text: [result.summary, ...result.lines].join('\n') }
    }

    const git = await $.process.run(['git', 'status', '--porcelain'], { cwd: vault.root }).catch(() => undefined)
    const changed = git ? git.stdout.split('\n').filter(l => l.trim() !== '').length : undefined
    let open = 0
    if (vault.config.proposals) {
      const dir = resolve(vault.config.proposals, vault.root)
      for (const p of await $.fs.list(dir).catch(() => [])) {
        if (!p.name.endsWith('.md')) continue
        const text = await $.fs.read(`${dir}/${p.name}`).catch(() => '')
        if (/^status:\s*(proposal|open)\b/m.test(text)) open++
      }
    }
    const result = (await read($, checks))[vault.root] ?? (await validate($, vault))
    const missions = vault.config.guard?.byMission ? (await played($, vault)).join(', ') : undefined

    return {
      text: [
        `${vault.config.name} (${short(vault.root)})`,
        `Prüfung${result.at ? ` (${result.at})` : ''}: ${result.summary}`,
        changed === undefined ? 'Kein git-Repository' : `Nicht committet: ${changed} ${changed === 1 ? 'Datei' : 'Dateien'}`,
        ...(vault.config.proposals ? [`Offene Vorschläge: ${open} (Inhalte nur über einen Agenten)`] : []),
        ...(vault.config.boot ? [`Brain: offene Vorschläge ${(await pendingOf($, vault)).length} (/vault brain)`] : []),
        isGuarded(vault)
          ? `Spoiler-Schutz: ${(await read($, unguarded)).includes(vault.root) ? 'aus' : 'an'}${missions ? ` · gespielte Missionen: ${missions}` : ''}`
          : 'Kein Spoiler-Schutz',
        `Letztes Backup: ${String((await $.store.get(`backup:${vault.root}`)) ?? 'noch keins')} (${short(await backupRoot($))})`,
        ...(known.length > 1 ? [`Weitere Vaults: ${known.filter(v => v !== vault).map(v => v.config.name).join(', ')}`] : []),
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const root = await read($, current)
    const vault = known.find(v => v.root === root)
    if (!vault) return <Text dimColor>Kein Vault in dieser Sitzung · /vault liste</Text>
    const cards = (await read($, views))[vault.root]
    const result = (await read($, checks))[vault.root]
    const isOff = (await read($, unguarded)).includes(vault.root)
    if (!cards) return <Text dimColor>Lese {vault.config.name} …</Text>

    return (
      <Box flexDirection="column">
        {cards.map(card => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{card.title}</Text>
            {card.lines.map(line => (
              <Text>  {line}</Text>
            ))}
          </Box>
        ))}
        <Text dimColor={result?.isClean !== false} color={result?.isClean === false ? 'red' : undefined}>
          {result ? `Prüfung ${result.at}: ${result.summary}` : 'Prüfung läuft …'}
        </Text>
        {isGuarded(vault) && <Text dimColor>Spoiler-Schutz {isOff ? 'aus' : 'an'} · /vault</Text>}
      </Box>
    )
  })
}
