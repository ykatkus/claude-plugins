import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/t'
const BRAIN = `${HOME}/brain`
const PRIVATE = `${HOME}/welt`
const WORK = `${HOME}/code`

const files = (): Record<string, string> => ({
  [`${BRAIN}/.claude-vault.json`]: JSON.stringify({ name: 'Brain', boot: 'AGENTS.md', pending: '90-meta/pending.md' }),
  [`${BRAIN}/AGENTS.md`]: '# Boot\nLies zuerst persona.md.\n',
  [`${BRAIN}/90-meta/pending.md`]:
    '# Vorschläge\n\n## Offen\n\n- 2026-11-23 · etwas merken\n\n- **2026-11-22** — ein langer Eintrag,\n  der weitergeht\n  → proposed home `x.md`\n- [ ] 2026-11-21 mit Kästchen\n\n## Erledigt\n\n- alt\n',
  [`${PRIVATE}/.claude-vault.json`]: JSON.stringify({ name: 'Welt', brain: false }),
})

const engine = (on: On, cwd: string, disk: Record<string, string> = files()) => {
  const written: Record<string, string> = {}
  mock.env(on, { HOME })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'vault' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_, e) => ({ value: e.path in disk || e.path in written || Object.keys(disk).some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    if (e.path in written) return { value: written[e.path] ?? '' }
    if (e.path in disk) return { value: disk[e.path] ?? '' }
    if (e.path.includes('/template/brain/')) return { value: `vorlage {{DATE}} ${e.path.split('/template/brain/')[1]}` }
    return { deny: 'missing' }
  })
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'engine', scope: 'shared' as const }] }))
  return written
}

type Starts = { session: { start: (input: { cwd: string; surface: null; isInteractive: boolean }) => Promise<unknown> } }
const start = ($: Starts, cwd: string) => $.session.start({ cwd, surface: null, isInteractive: false })
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

const register = async ($: { command: { run: (i: never) => Promise<{ text?: string }> } }, path: string) =>
  ($.command.run as (i: unknown) => Promise<{ text?: string }>)({ command: 'vault', args: `neu ${path}`, ...RUN })

test('the brain goes into the system prompt of a session outside any vault', async ($, on) => {
  engine(on, WORK)
  await start($, WORK)
  await register($ as never, BRAIN)
  await start($, WORK)
  const composed = await $.prompt.compose(COMPOSE)
  const text = composed.sections.map(s => s.text).join('\n')
  expect(text).toMatch(/Lies zuerst persona\.md/)
  expect(text).toMatch(/engine/)
})

test('a vault with brain: false gets no brain', async ($, on) => {
  engine(on, PRIVATE)
  await start($, PRIVATE)
  await register($ as never, BRAIN)
  await start($, PRIVATE)
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(s => s.text).join('\n')).not.toMatch(/persona\.md/)
})

test('/vault brain aus leaves it out, /vault brain lists the open proposals', async ($, on) => {
  engine(on, WORK)
  await start($, WORK)
  await register($ as never, BRAIN)
  await start($, WORK)
  const status = await $.command.run({ command: 'vault', args: 'brain', ...RUN })
  await $.command.run({ command: 'vault', args: 'brain aus', ...RUN })
  const composed = await $.prompt.compose(COMPOSE)
  expect(status.text).toMatch(/Offene Vorschläge \(90-meta\/pending\.md\): 3/)
  expect(status.text).toMatch(/etwas merken/)
  expect(status.text).toMatch(/• 2026-11-22 — ein langer Eintrag, der weitergeht\n/)
  expect(status.text).toMatch(/• 2026-11-21 mit Kästchen/)
  expect(status.text).not.toMatch(/proposed home/)
  expect(status.text).not.toMatch(/alt/)
  expect(composed.sections.map(s => s.text).join('\n')).not.toMatch(/persona\.md/)
})

test('/vault brain neu lays out a brain vault from the template', async ($, on) => {
  const written = engine(on, WORK, {})
  await start($, WORK)
  const made = await $.command.run({ command: 'vault', args: `brain neu ${HOME}/neu`, ...RUN })
  expect(made.text).toMatch(/Brain angelegt/)
  expect(written[`${HOME}/neu/AGENTS.md`]).toMatch(/^vorlage \d{4}-\d{2}-\d{2} AGENTS\.md/)
  expect(JSON.parse(written[`${HOME}/neu/.claude-vault.json`] ?? '{}')).toMatchObject({ boot: 'AGENTS.md' })
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(s => s.text).join('\n')).toMatch(/vorlage/)
})
