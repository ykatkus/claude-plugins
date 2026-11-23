import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/t'
const VAULT = `${HOME}/pnp`
const OTHER = `${HOME}/notes`

// Alpha's own .claude-vault.json, as far as the guard reads it; a second vault without a guard.
const ALPHA = JSON.stringify({
  name: 'Alpha',
  validate: ['python3', '_meta/scripts/validate.py'],
  guard: {
    protected: ['90-gm', '_meta/proposals', '_meta/changelog.md'],
    byMission: { dir: '30-campaign', field: 'mission_number', played: [1] },
    open: ['10-world', '20-mechanics', '40-state'],
    studio: { tool: 'mcp__plugin_dnd-studio_dnd-studio__campaign', safeLists: ['sessions', 'canon'] },
  },
  panel: [{ title: 'Kasse', file: '40-state/finances.md', match: '\\*\\*Balance:\\*\\*\\s*([^\\n(]+)' }],
})
const NOTES = JSON.stringify({ name: 'Notizen' })

// The engine's answers the mod needs: nothing sits beneath the plugin in a test.
const CLEAN = '156 notes checked, 0 errors, 0 warnings.\n'
const engine = (on: On, extra: Record<string, string> = {}, validate: () => string = () => CLEAN, cwd = VAULT) => {
  const files: Record<string, string> = {
    [`${VAULT}/.claude-vault.json`]: ALPHA,
    [`${OTHER}/.claude-vault.json`]: NOTES,
    [`${VAULT}/40-state/finances.md`]: '**Balance:** 50 Ak (after S-002).\n',
    ...extra,
  }
  mock.env(on, { HOME })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'vault' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] ?? '' } : { deny: 'missing' }))
  on('process.run', () => {
    const stdout = validate()
    return {
      value: {
        exitCode: /\b0 errors/.test(stdout) ? 0 : 1,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
}

type Starts = { session: { start: (input: { cwd: string; surface: null; isInteractive: boolean }) => Promise<unknown> } }
const start = ($: Starts, cwd = VAULT) => $.session.start({ cwd, surface: null, isInteractive: false })
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('the main loop may not read a GM note', async ($, on) => {
  engine(on)
  await start($)
  const ran = await $.tool.call({ tool: 'Read', file_path: `${VAULT}/90-gm/bane.md` })
  expect('deny' in ran && ran.deny).toMatch(/Spielleiterwissen von Alpha/)
})

test('a subagent may read it', async ($, on) => {
  engine(on)
  await start($)
  const ran = await $.tool.call({ tool: 'Read', file_path: `${VAULT}/90-gm/bane.md`, agentId: 'a1' })
  expect('deny' in ran ? ran.deny : undefined).toBeUndefined()
})

test('a note of a played mission may be read, an unplayed one may not', async ($, on) => {
  engine(on, {
    [`${VAULT}/30-campaign/opening/scene-01.md`]: '---\nmission_number: 1\n---\n',
    [`${VAULT}/30-campaign/mission-2/overview.md`]: '---\nmission_number: 2\n---\n',
  })
  await start($)
  const one = await $.tool.call({ tool: 'Read', file_path: '30-campaign/opening/scene-01.md' })
  const two = await $.tool.call({ tool: 'Read', file_path: '30-campaign/mission-2/overview.md' })
  expect('deny' in one ? one.deny : undefined).toBeUndefined()
  expect('deny' in two && two.deny).toMatch(/nicht gespielte Mission/)
})

test('a shell read of a GM folder is refused; a table note and an append are not', async ($, on) => {
  engine(on)
  await start($)
  const gm = await $.tool.call({ tool: 'Bash', command: 'cat 90-gm/bane.md' })
  const table = await $.tool.call({ tool: 'Bash', command: 'cat 40-state/ship.md' })
  const append = await $.tool.call({ tool: 'Bash', command: "cat >> _meta/changelog.md <<'EOF'\n| row |\nEOF" })
  expect('deny' in gm && gm.deny).toMatch(/Spoiler-Schutz/)
  expect('deny' in table ? table.deny : undefined).toBeUndefined()
  expect('deny' in append ? append.deny : undefined).toBeUndefined()
})

test('a search over the whole vault is refused, one in 40-state is not', async ($, on) => {
  engine(on)
  await start($)
  const all = await $.tool.call({ tool: 'Grep', pattern: 'Oskar' })
  const state = await $.tool.call({ tool: 'Grep', pattern: 'Rumpf', path: '40-state' })
  expect('deny' in all && all.deny).toMatch(/Suche/)
  expect('deny' in state ? state.deny : undefined).toBeUndefined()
})

test('a full read of the Studio campaign is refused, the sessions are not', async ($, on) => {
  engine(on)
  await start($)
  const full = await $.tool.call({ tool: 'mcp__plugin_dnd-studio_dnd-studio__campaign', action: 'get' })
  const sessions = await $.tool.call({
    tool: 'mcp__plugin_dnd-studio_dnd-studio__campaign',
    action: 'get',
    only: ['sessions'],
  })
  expect('deny' in full && full.deny).toMatch(/Studio-Kampagne/)
  expect('deny' in sessions ? sessions.deny : undefined).toBeUndefined()
})

test('the guard can be turned off for the session', async ($, on) => {
  engine(on)
  await start($)
  await $.command.run({ command: 'vault', args: 'spoiler aus', ...RUN })
  const ran = await $.tool.call({ tool: 'Read', file_path: `${VAULT}/90-gm/bane.md` })
  expect('deny' in ran ? ran.deny : undefined).toBeUndefined()
})

test('a change in the vault runs its validate command', async ($, on) => {
  let runs = 0
  engine(on, {}, () => {
    runs++
    return runs > 1 ? '156 notes checked, 1 errors, 0 warnings.\nbad link\n' : CLEAN
  })
  await start($)
  const before = runs
  const ran = await $.tool.call({ tool: 'Edit', file_path: `${VAULT}/40-state/ship.md`, old_string: 'a', new_string: 'b' })
  expect(runs).toBeGreaterThan(before)
  expect('context' in ran && ran.context?.join('\n')).toMatch(/Alpha.*1 errors/s)
})

// A second guarded vault that shares the Studio tool with the first.
const BETA = `${HOME}/beta`
const BETA_CONFIG = JSON.stringify({
  name: 'Beta',
  guard: {
    protected: ['90-spielleitung'],
    open: ['10-welt'],
    studio: { tool: 'mcp__plugin_dnd-studio_dnd-studio__campaign', safeLists: ['sessions', 'canon'] },
  },
})
const both = (on: On, cwd: string) => {
  engine(on, { [`${BETA}/.claude-vault.json`]: BETA_CONFIG }, () => CLEAN, cwd)
}
const STUDIO_GET = { tool: 'mcp__plugin_dnd-studio_dnd-studio__campaign', action: 'get' } as const

test("one vault's switch does not turn off another vault's Studio guard", async ($, on) => {
  both(on, BETA)
  await start($, BETA)
  await $.command.run({ command: 'vault', args: `neu ${VAULT}`, ...RUN })
  const before = await $.tool.call(STUDIO_GET)
  await $.command.run({ command: 'vault', args: 'spoiler aus', ...RUN })
  const after = await $.tool.call(STUDIO_GET)
  const alpha = await $.tool.call({ tool: 'Read', file_path: `${VAULT}/90-gm/bane.md` })
  expect('deny' in before && before.deny).toMatch(/Beta/)
  expect('deny' in after ? after.deny : undefined).toBeUndefined()
  expect('deny' in alpha && alpha.deny).toMatch(/Alpha/)
})

test("another vault's folder names do not block shell commands here", async ($, on) => {
  both(on, BETA)
  await start($, BETA)
  await $.command.run({ command: 'vault', args: `neu ${VAULT}`, ...RUN })
  const ownMeta = await $.tool.call({ tool: 'Bash', command: 'cat _meta/proposals/liste.md' })
  const own = await $.tool.call({ tool: 'Bash', command: 'cat 90-spielleitung/x.md' })
  const alpha = await $.tool.call({ tool: 'Bash', command: `cat ${VAULT}/90-gm/bane.md` })
  expect('deny' in ownMeta ? ownMeta.deny : undefined).toBeUndefined()
  expect('deny' in own && own.deny).toMatch(/Beta/)
  expect('deny' in alpha && alpha.deny).toMatch(/Alpha/)
})

test('a search or git command moved out of the vault is not judged by its guard', async ($, on) => {
  engine(on)
  await start($)
  const grepElsewhere = await $.tool.call({ tool: 'Bash', command: `cd ${HOME}/.claude && grep -rl vault .` })
  const gitElsewhere = await $.tool.call({ tool: 'Bash', command: `git -C ${HOME}/dev show HEAD:a.ts` })
  const grepHere = await $.tool.call({ tool: 'Bash', command: 'grep -rl Oskar .' })
  const grepBack = await $.tool.call({ tool: 'Bash', command: `cd /tmp && grep -rl Oskar ${VAULT}` })
  expect('deny' in grepElsewhere ? grepElsewhere.deny : undefined).toBeUndefined()
  expect('deny' in gitElsewhere ? gitElsewhere.deny : undefined).toBeUndefined()
  expect('deny' in grepHere && grepHere.deny).toMatch(/Suche/)
  expect('deny' in grepBack && grepBack.deny).toMatch(/Suche/)
})

test("turning Alpha's guard off leaves this vault's guard on", async ($, on) => {
  both(on, VAULT)
  await start($, VAULT)
  await $.command.run({ command: 'vault', args: `neu ${BETA}`, ...RUN })
  await $.command.run({ command: 'vault', args: 'spoiler aus', ...RUN })
  const alpha = await $.tool.call({ tool: 'Read', file_path: `${VAULT}/90-gm/bane.md` })
  const beta = await $.tool.call({ tool: 'Read', file_path: `${BETA}/90-spielleitung/x.md` })
  const studio = await $.tool.call(STUDIO_GET)
  expect('deny' in alpha ? alpha.deny : undefined).toBeUndefined()
  expect('deny' in beta && beta.deny).toMatch(/Beta/)
  expect('deny' in studio ? studio.deny : undefined).toBeUndefined()
})

test('the guard holds for a guarded vault from a session in another vault', async ($, on) => {
  engine(on, {}, () => CLEAN, OTHER)
  await start($, OTHER)
  const added = await $.command.run({ command: 'vault', args: `neu ${VAULT}`, ...RUN })
  const list = await $.command.run({ command: 'vault', args: 'liste', ...RUN })
  const ran = await $.tool.call({ tool: 'Read', file_path: `${VAULT}/90-gm/bane.md` })
  const own = await $.tool.call({ tool: 'Read', file_path: `${OTHER}/idee.md` })
  expect(added.text).toMatch(/Alpha/)
  expect(list.text).toMatch(/Notizen[\s\S]*Alpha|Alpha[\s\S]*Notizen/)
  expect('deny' in ran && ran.deny).toMatch(/Alpha/)
  expect('deny' in own ? own.deny : undefined).toBeUndefined()
})
