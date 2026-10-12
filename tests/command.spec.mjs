/**
 * Contract tests for the S5/S6 half of smart mode: the workflow-discipline prompt
 * section and the `/smart` command.
 *
 * The tools alone are nine names in a registry; this is the part that tells the
 * session's model how to run the workflow, and the part the user actually types.
 * Both seats are stubbed (`systemPrompt.section`, `commands.register`), so the
 * assertions are about the contract: the seat's name/order, when the text is
 * returned, and what each command input does.
 *
 * The stub mirrors the *real* cordis shape the plugin now declares in `inject`
 * (`tools`, `commands`, `systemPrompt`). It deliberately does **not** paper over a
 * missing seat: reading `ctx.systemPrompt` without declaring it throws in cordis
 * 4 (`cannot get property "systemPrompt" without inject`), and because a preset
 * mounts as one composition that throw takes the whole preset down — the state
 * assertions below are worthless if the row cannot mount at all, so the inject
 * set is itself asserted in `tools.spec.mjs`.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let loadCount = 0

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-cmd-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Apply the plugin with the mode seats recorded instead of composed. */
async function load(config, { planMode } = {}) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${++loadCount}`)
  const seats = { views: [], commands: [], steered: [] }
  const ctx = {
    tools: { register: () => {} },
    systemPrompt: {
      section: view => { seats.views.push(view); return () => {} },
    },
    commands: { register: command => seats.commands.push(command) },
    get: name => (name === 'planMode' ? planMode : undefined),
  }
  // 测试里的行 rootDir 是显式声明的「压掉工作区根」（见 state.mjs presetTaskRoot）。
  mod.apply(ctx, { allowGlobalRoot: true, ...config })
  return { mod, seats }
}

const agent = () => ({ session: {}, steer: message => { agent.steered.push(message) } })

test('the discipline section is mounted once and stays silent until /smart on', async t => {
  const { seats } = await load({ rootDir: scratch(t) })
  assert.equal(seats.views.length, 1)
  const view = seats.views[0]
  // 座位名与序数都是契约：改了名字，模式纪律就会静默消失。
  assert.equal(view.name, 'fly-smart:policy')
  assert.equal(view.order, 550)

  const session = {}
  assert.equal(view.text({ agent: { session } }), '', 'off by default')
  assert.equal(view.text({}), '', 'no agent, no policy')

  const command = seats.commands[0]
  const on = command.handler({ agent: { session, steer: () => {} }, rawInput: '', attachments: [] })
  assert.equal(on.kind, 'success')
  assert.match(on.text, /Smart mode on/u)
  // 开了以后才把纪律交给模型，且纪律必须点名门与"不许自己当批准"。
  const text = view.text({ agent: { session } })
  assert.match(text, /smart_begin/u)
  assert.match(text, /smart_gate/u)
  assert.match(text, /Never treat your own judgement/u)
  assert.match(text, /Do not execute before the user passes gate G4/u)
})

test('/smart off leaves the mode and reports what stays on disk', async t => {
  const { seats } = await load({ rootDir: scratch(t) })
  const view = seats.views[0]
  const command = seats.commands[0]
  const session = {}
  command.handler({ agent: { session, steer: () => {} }, rawInput: '', attachments: [] })
  assert.notEqual(view.text({ agent: { session } }), '')

  const off = command.handler({ agent: { session, steer: () => {} }, rawInput: 'off', attachments: [] })
  assert.equal(off.kind, 'success')
  assert.equal(view.text({ agent: { session } }), '')
  // 已经关了再说 off：仍然是成功（命令要幂等），并说清楚。
  assert.match(command.handler({ agent: { session, steer: () => {} }, rawInput: 'off', attachments: [] }).text, /already off/u)
  // 带附件时不许 off —— 附件会被丢掉。
  assert.equal(command.handler({ agent: { session, steer: () => {} }, rawInput: 'off', attachments: [{ type: 'text', text: 'x' }] }).kind, 'error')
})

test('/smart <task> turns the mode on and hands the task to the agent', async t => {
  const { seats } = await load({ rootDir: scratch(t) })
  const command = seats.commands[0]
  const session = {}
  const steered = []
  const result = command.handler({
    agent: { session, steer: message => steered.push(message) },
    rawInput: '给登录页加限速',
    attachments: [{ type: 'file', path: 'x.md' }],
  })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Treating the message above as the task/u)
  // 用户的任务原样进会话，附件跟着走，不许被吞。
  assert.equal(steered.length, 1)
  assert.deepEqual(steered[0].content, [{ type: 'file', path: 'x.md' }, { type: 'text', text: '给登录页加限速' }])
  assert.deepEqual(steered[0].source, { kind: 'user' })
})

test('smart mode refuses to start while plan mode is active', async t => {
  const { seats } = await load({ rootDir: scratch(t) }, { planMode: { get: () => true } })
  const command = seats.commands[0]
  const refused = command.handler({ agent: { session: {}, steer: () => {} }, rawInput: '', attachments: [] })
  assert.equal(refused.kind, 'error')
  assert.match(refused.text, /Plan mode is active/u)

  // plan mode 关着就正常进（两个模式互斥，但不是死锁）。
  const { seats: free } = await load({ rootDir: scratch(t) }, { planMode: { get: () => ({ active: false }) } })
  assert.equal(free.commands[0].handler({ agent: { session: {}, steer: () => {} }, rawInput: '', attachments: [] }).kind, 'success')
  // plan-mode 服务不在场（别的 profile 没装）也不该挡住 smart。
  const { seats: absent } = await load({ rootDir: scratch(t) })
  assert.equal(absent.commands[0].handler({ agent: { session: {}, steer: () => {} }, rawInput: '', attachments: [] }).kind, 'success')
})

test('a disabled row mounts neither the section nor the command', async t => {
  const { seats } = await load({ rootDir: scratch(t), enabled: false })
  assert.deepEqual(seats.views, [])
  assert.deepEqual(seats.commands, [])
})

test('smart mode is session-level: on→off→on for one session leaves another alone', async t => {
  const { seats } = await load({ rootDir: scratch(t) })
  const view = seats.views[0]
  const command = seats.commands[0]
  const issue = (session, rawInput = '') => command.handler({
    agent: session === undefined ? { steer: () => {} } : { session, steer: () => {} },
    rawInput,
    attachments: [],
  })
  const sessionA = {}
  const sessionB = {}

  // Both start off.
  assert.equal(view.text({ agent: { session: sessionA } }), '')
  assert.equal(view.text({ agent: { session: sessionB } }), '')

  // A: on → off → on. The same session must be able to re-enter.
  assert.equal(issue(sessionA).kind, 'success')
  assert.notEqual(view.text({ agent: { session: sessionA } }), '')
  assert.equal(view.text({ agent: { session: sessionB } }), '', 'B is untouched by A turning on')
  assert.equal(issue(sessionA, 'off').kind, 'success')
  assert.equal(view.text({ agent: { session: sessionA } }), '')
  assert.equal(issue(sessionA).kind, 'success')
  assert.notEqual(view.text({ agent: { session: sessionA } }), '')
  assert.equal(view.text({ agent: { session: sessionB } }), '', 'B is untouched by A cycling')

  // B turning on does not disturb A, and both can be on at once (per-session state).
  assert.equal(issue(sessionB).kind, 'success')
  assert.notEqual(view.text({ agent: { session: sessionA } }), '')
  assert.notEqual(view.text({ agent: { session: sessionB } }), '')

  // `/smart off` on B leaves A on — the flag is keyed by session identity, not by name.
  assert.equal(issue(sessionB, 'off').kind, 'success')
  assert.equal(view.text({ agent: { session: sessionB } }), '')
  assert.notEqual(view.text({ agent: { session: sessionA } }), '')

  // An agent without a Session can never carry the flag: state cannot leak to
  // whatever session shows up next, and the section stays silent for it.
  assert.equal(issue(undefined).kind, 'success')
  assert.equal(view.text({ agent: {} }), '')
  assert.equal(view.text({}), '')
})
