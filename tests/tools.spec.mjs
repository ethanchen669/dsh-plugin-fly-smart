/**
 * Contract tests for the smart-mode tool surface (`index.js`).
 *
 * The tools are exercised against a stub `ctx` that records registrations — the
 * same convention the other Fly packages use — so the test pins the *tool
 * contract* (names, parameters, render, error behaviour) without booting a
 * profile. Filesystem work happens in a scratch dir outside the repo.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readState, resolveConfig } from '../lib/state.mjs'
import { BRIEF_CONFIRM, briefingText, GATE_PASS } from './seams.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Cache-busting counter (Date.now() can collide within a millisecond). */
let loadCount = 0

/** Apply the plugin against a recording `ctx` and hand back its tools. */
async function load(config) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: 0, ask: 0 }
  // 座位齐全：`inject` 里声明的三个服务都得在，否则 apply 会在读服务时抛
  //（真 cordis 的行为，见 tools 里那条 inject 断言）。能力缝（subagents / userQuestions）
  // 走 ctx.get，这里给最小桩：自动 briefing 会spawn，确认卡按 id 分派应答（B1）。
  mod.apply({
    tools: { register: definition => tools.set(definition.name, definition) },
    systemPrompt: { section: () => () => {} },
    commands: { register: () => () => {} },
    get: name => ({
      subagents: {
        start: async (provider, request) => {
          calls.start += 1
          return {
            id: `child-${calls.start}`,
            localAgent: undefined,
            result: Promise.resolve({
              output: [{ type: 'text', text: request.prompt[0].text.includes('briefing') ? briefingText(request.prompt[0].text) : '# 手模型产出' }],
              stopReason: 'completed',
            }),
            dispose: async () => {},
          }
        },
      },
      userQuestions: {
        ask: async question => {
          calls.ask += 1
          const card = question.questions[0]
          return { answers: [{ id: card.id, selected: [card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : GATE_PASS] }] }
        },
      },
    })[name],
  }, { allowGlobalRoot: true, ...config })
  return { mod, tools, calls }
}

/** Minimal execution context: a signal and an agent identity. */
const exec = (session = {}) => ({ signal: new AbortController().signal, agent: { session } })

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-tools-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the plugin registers exactly its tool surface', async () => {
  const { mod, tools } = await load({ rootDir: '/tmp/never-used' })
  assert.equal(mod.name, 'fly-smart')
  // 声明面必须覆盖**读到的每个服务**：cordis 4 对未声明的服务属性访问直接抛
  //（`cannot get property "systemPrompt" without inject`），而 apply 里的一抛会被
  // preset 的激活审计当成整棵挂载失败 —— 症状是会话根本组不起来，不是少个命令。
  // 按集合断：顺序不算契约，少一行则红。
  assert.deepEqual([...mod.inject].sort(), ['commands', 'systemPrompt', 'tools'])
  // S1 的三个 + S2 的评审与门。工具面就是工作流的全部入口，多一个少一个都要有人管。
  assert.deepEqual([...tools.keys()], ['smart_begin', 'smart_artifact', 'smart_consult', 'smart_decide', 'smart_brief', 'smart_brief_confirm', 'smart_gate', 'smart_execute', 'smart_verify', 'smart_rework', 'smart_finish', 'smart_status'])
  // A4 的防伪造面：确认工具的 schema **不含** decision/confirm 类参数 —— 确认只能来自
  // 卡片应答。变异（把 decision 改成读参数）会被这条钉住。
  assert.deepEqual(Object.keys(tools.get('smart_brief_confirm').parameters.properties), ['taskId'])
  assert.deepEqual(Object.keys(tools.get('smart_brief').parameters.properties), ['taskId'])
  for (const definition of tools.values()) {
    assert.equal(typeof definition.description, 'string')
    assert.equal(typeof definition.execute, 'function')
    assert.deepEqual(definition.output.render(null, 'x'), [{ type: 'text', text: 'x' }])
  }
  // 阶段顺序是**代码**行为：参数必须把 phase 收成枚举，模型没得选错。
  // defineTool 会把 parameters 规范成 JSON Schema（properties 下），断言按规范化后的形状写。
  assert.deepEqual(
    tools.get('smart_artifact').parameters.properties.phase.enum,
    ['brainstorm', 'design', 'plan', 'acceptance', 'executing', 'reviewing'],
  )
  // 裁决工具的契约：问题必填，选项是**对象**（与上游 ask_user_question 同形）—— 选项写字符串
  // 会在参数校验就被 ToolArgsError 挡下（真跑过：单测里传字符串当场红），所以形状要钉住。
  assert.deepEqual(tools.get('smart_decide').parameters.required, ['questions'])
  assert.equal(tools.get('smart_decide').parameters.properties.questions.items.properties.question.type, 'string')
  assert.equal(tools.get('smart_decide').parameters.properties.questions.items.properties.options.items.properties.label.type, 'string')
})

test('begin → artifact → status drives the machine per session', async t => {
  const { tools } = await load({ rootDir: scratch(t), enabled: true, requireConsult: true, handRoute: { provider: 'deepseek', model: 'flash' } })
  const session = {}
  const begun = JSON.parse(await tools.get('smart_begin').execute({ title: 'ship the widget', goal: '活干完' }, exec(session)))
  assert.equal(begun.phase, 'brainstorm')
  assert.equal(begun.awaitingGate, null)
  assert.match(begun.taskId, /-ship-the-widget$/u)
  // 中文标题不留汉字：目录名要躲开 macOS 的 NFD 归一化（同名字符串比较会失手），
  // 标题本身存在 state/index 里给工作台显示，id 只负责安全。
  const cn = JSON.parse(await tools.get('smart_begin').execute({ title: '中文任务' }, exec({})))
  assert.match(cn.taskId, /^\d{8}-\d{6}$/u)

  const recorded = JSON.parse(await tools.get('smart_artifact').execute({ phase: 'brainstorm', markdown: '# 脑暴' }, exec(session)))
  // 落盘不开门（A5）：自动 briefing 生成好，等用户在卡上确认。
  assert.equal(recorded.awaitingGate, null)
  assert.equal(recorded.briefingFailed, undefined)
  assert.deepEqual(recorded.gaps, ['no gate is open'])

  const confirmed = JSON.parse(await tools.get('smart_brief_confirm').execute({}, exec(session)))
  assert.equal(confirmed.briefingDecision, 'confirm')
  assert.equal(confirmed.awaitingGate, 'G1')
  // 过门条件未满足时，状态必须把缺口说出来，而不是"看起来能继续"。
  assert.deepEqual(confirmed.gaps, ['missing consult record for "brainstorm" (requireConsult)'])

  const status = JSON.parse(await tools.get('smart_status').execute({}, exec(session)))
  assert.equal(status.taskId, begun.taskId)
  assert.equal(status.awaitingGate, 'G1')
  assert.deepEqual(status.consults, [])

  await assert.rejects(
    tools.get('smart_artifact').execute({ phase: 'design', markdown: '# 设计' }, exec(session)),
    /is in phase "brainstorm"/u,
  )
})

test('sessions do not share an active task', async t => {
  const { tools } = await load({ rootDir: scratch(t) })
  const a = {}
  const b = {}
  const first = JSON.parse(await tools.get('smart_begin').execute({ title: 'session one' }, exec(a)))
  const second = JSON.parse(await tools.get('smart_begin').execute({ title: 'session two' }, exec(b)))
  assert.notEqual(first.taskId, second.taskId)

  // 每个会话只认自己的任务：B 的产物落进 B，A 的产物落进 A。
  await tools.get('smart_artifact').execute({ phase: 'brainstorm', markdown: '# 一' }, exec(a))
  const statusA = JSON.parse(await tools.get('smart_status').execute({}, exec(a)))
  const statusB = JSON.parse(await tools.get('smart_status').execute({}, exec(b)))
  assert.equal(statusA.taskId, first.taskId)
  assert.deepEqual(Object.keys(statusA.artifacts), ['brainstorm'])
  assert.equal(statusB.taskId, second.taskId)
  assert.deepEqual(statusB.artifacts, {})

  // 没有活动任务的会话不许"顺手"写进别人的任务 —— 只能显式带 taskId 或先 begin。
  await assert.rejects(
    tools.get('smart_artifact').execute({ phase: 'brainstorm', markdown: '# 偷写' }, exec({})),
    /no active task in this session/u,
  )
})

test('a row rootDir without allowGlobalRoot is refused, and with it the row root wins', async t => {
  // 回归两件事：
  //   1. `apply(ctx, { rootDir, ...resolveConfig({}) })` 会被 undefined 顶掉根目录，
  //      把测试任务写进用户真实 home（verify-smart 踩过一次）。显式根目录必须永远赢。
  //   2. 行 rootDir 必须显式承认它压掉了每个会话的工作区根（allowGlobalRoot）；少了它
  //      要在**挂载时**大声报错，而不是静默把产物写到没人看的地方（acceptance.md Y1）。
  const rootDir = scratch(t)
  const resolved = resolveConfig({ enabled: true, maxRework: 3, requireConsult: true })
  await assert.rejects(
    load({ ...resolved, rootDir }),
    /allowGlobalRoot: true/u,
    'a row rootDir without allowGlobalRoot must be refused at mount time',
  )

  const { tools } = await load({ ...resolved, rootDir, allowGlobalRoot: true })
  const begun = JSON.parse(await tools.get('smart_begin').execute({ title: 'root check' }, exec({})))
  assert.equal(readState(rootDir, begun.taskId)?.id, begun.taskId)
  assert.equal(begun.rootSource, 'preset')
  // 而且不许在真实 home 留下任何一份副本 —— 只读检查，不动用户目录。
  assert.equal(existsSync(join(homedir(), '.dsh-fly', 'smart', 'tasks', begun.taskId)), false)
})

test('an unknown task and a disabled row both fail loudly', async t => {
  const { tools } = await load({ rootDir: scratch(t) })
  await tools.get('smart_begin').execute({ title: 'known' }, exec({}))
  await assert.rejects(tools.get('smart_status').execute({ taskId: 'nope' }, exec({})), /no such task/u)

  const { tools: off } = await load({ rootDir: scratch(t), enabled: false })
  for (const name of ['smart_begin', 'smart_artifact', 'smart_consult', 'smart_brief', 'smart_brief_confirm', 'smart_gate', 'smart_execute', 'smart_verify', 'smart_rework', 'smart_finish', 'smart_status']) {
    await assert.rejects(off.get(name).execute({}, exec({})), /smart mode is disabled/u)
  }
})

test('status without an active task lists what exists instead of throwing', async t => {
  const { tools } = await load({ rootDir: scratch(t) })
  const first = JSON.parse(await tools.get('smart_begin').execute({ title: 'listed' }, exec({})))
  // 换一个"会话"后没有活动任务，但磁盘上有任务：应当列出索引供模型自己挑。
  const listed = JSON.parse(await tools.get('smart_status').execute({}, { signal: new AbortController().signal, agent: { session: { fresh: true } } }))
  assert.equal(listed.active, null)
  assert.deepEqual(listed.tasks.map(row => row.id), [first.taskId])
})
