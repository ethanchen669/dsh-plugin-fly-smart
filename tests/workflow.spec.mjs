/**
 * 工作流策略（v1 / optimized）的契约测试。
 *
 * 优化动机：一次完整任务里，review 子代理被派了太多次 —— 每个设计阶段既有一份自动
 * briefing，又有一次独立 consult。其中 **brainstorm 的 consult 是纯开销**：那时还没有
 * 可执行的东西可审，而用户对候选方案的判断由 G1 的对话与确认卡完成。
 *
 * 所以 optimized 工作流做两件事，且**只对显式选择它的任务生效**：
 *   1. brainstorm 不再要求独立 consult；
 *   2. brainstorm 的要点由 brain 自己写（`smart_artifact` 的 `briefing` 参数），
 *      记成 `brain/session` 来源，**不派 review 子代理**。
 *
 * 两条纪律在这里被钉住：
 *   - 旧任务（无 `workflow` 字段）永远按 v1 跑，行配置改动不会让在途任务换语义；
 *   - brain 自写的要点走**同一条**完整性检查，且来源必须如实标注（不能伪装成独立评审）。
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
import {
  CONSULT_PHASES,
  WORKFLOWS,
  confirmBriefing,
  consultPhasesFor,
  createTask,
  gateGaps,
  readState,
  recordArtifact,
  recordBriefing,
  recordConsult,
  resolveConfig,
  taskStatus,
} from '../lib/state.mjs'
import { BRIEF_CONFIRM, GATE_PASS, reviewReply } from './seams.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let loadCount = 0

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-workflow-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const HAND = { provider: 'deepseek', model: 'flash' }

/** Minimal tool-layer harness: counts spawns and dispatches card answers by id. */
async function load(config) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: [], ask: [] }
  const services = {
    subagents: {
      start: async (provider, request) => {
        calls.start.push({ provider, request })
        const text = reviewReply(request)
        return {
          id: `child-${calls.start.length}`,
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text }], stopReason: 'completed' }),
          dispose: async () => {},
        }
      },
    },
    userQuestions: {
      ask: async question => {
        calls.ask.push(question)
        const card = question.questions[0]
        return { answers: [{ id: card.id, selected: [card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : GATE_PASS], custom: '' }] }
      },
    },
  }
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition) },
    systemPrompt: { section: () => () => {} },
    commands: { register: () => () => {} },
    get: name => services[name],
  }
  mod.apply(ctx, { allowGlobalRoot: true, handRoute: HAND, requireConsult: true, ...config })
  return { tools, calls }
}

/** 状态层：记一轮要点并确认（测试只关心"门该不该开"）。 */
function brief(root, id, phase, body = '结论 风险 未决') {
  recordBriefing(root, id, phase, { provider: 'stub', model: 'review', source: 'preset', body })
  return confirmBriefing(root, id, phase, 'confirm', {})
}

const exec = (session = {}) => ({ signal: new AbortController().signal, agent: { session } })
const call = (tools, name, args, session) => tools.get(name).execute(args, exec(session))

// ── 配置面 ───────────────────────────────────────────────────────────────────

test('workflow defaults to v1, accepts optimized, and rejects anything else', () => {
  assert.deepEqual(WORKFLOWS, ['v1', 'optimized'])
  assert.equal(resolveConfig({}).workflow, 'v1')
  assert.equal(resolveConfig({ workflow: 'optimized' }).workflow, 'optimized')
  assert.equal(resolveConfig({ workflow: ' Optimized ' }).workflow, 'optimized')
  assert.throws(() => resolveConfig({ workflow: 'fast' }), /workflow must be one of v1, optimized/u)
  // 未知版本的危险是在闸门上放宽；这里先钉住"未知 ⇒ v1"的兜底。
  assert.deepEqual(consultPhasesFor({}), CONSULT_PHASES.v1)
  assert.deepEqual(consultPhasesFor({ workflow: 'nonsense' }), CONSULT_PHASES.v1)
  assert.deepEqual(consultPhasesFor({ workflow: 'optimized' }), ['design', 'plan', 'acceptance'])
})

test('the task records its own workflow, and old tasks stay v1', t => {
  const root = scratch(t)
  const optimized = createTask(root, { title: 'opt' }, { workflow: 'optimized' })
  const legacy = createTask(root, { title: 'legacy' })
  assert.equal(readState(root, optimized.id).workflow, 'optimized')
  assert.equal(readState(root, legacy.id).workflow, undefined)
  assert.equal(taskStatus(root, optimized.id).workflow, 'optimized')
  // 没有字段的旧任务按 v1 报告，而不是报告"未知"。
  assert.equal(taskStatus(root, legacy.id).workflow, 'v1')
})

// ── 闸门面：consult 只在需要它的阶段是必填 ───────────────────────────────────

test('optimized: brainstorm needs no consult, design still does', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'gate' }, { workflow: 'optimized' })
  recordArtifact(root, id, 'brainstorm', '# 脑暴\n结论 风险 未决')
  brief(root, id, 'brainstorm')

  const state = readState(root, id)
  assert.equal(state.awaitingGate, 'G1')
  // G1 的缺口里**没有** consult 这一条（其余检查照旧）。
  assert.deepEqual(gateGaps(root, state, { requireConsult: true }), [])

  // 过门后 design 阶段仍旧必须有独立 consult —— 优化不能把可执行性审查一起省掉。
  const passed = JSON.parse(JSON.stringify(state))
  passed.phase = 'design'
  passed.awaitingGate = 'G2'
  passed.artifacts.design = { file: 'design.md', bytes: 1, at: new Date().toISOString(), sha256: 'x' }
  assert.deepEqual(
    gateGaps(root, passed, { requireConsult: true }).filter(gap => /consult/u.test(gap)),
    ['missing consult record for "design" (requireConsult)'],
  )
})

test('v1: brainstorm still needs its consult', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'v1' })
  recordArtifact(root, id, 'brainstorm', '# 脑暴\n结论 风险 未决')
  brief(root, id, 'brainstorm')
  const state = readState(root, id)
  assert.deepEqual(
    gateGaps(root, state, { requireConsult: true }),
    ['missing consult record for "brainstorm" (requireConsult)'],
  )
})

// ── 工具面：optimized brainstorm 不派子代理，要点由 brain 写 ─────────────────

test('optimized brainstorm spawns no review child and asks the brain for the digest', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'no review' }, session))
  assert.equal(readState(rootDir, begun.taskId).workflow, 'optimized')

  const recorded = JSON.parse(await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴\n\n## 1. 目标\n\n## 2. 选项' }, session))
  // 关键证据：这一路一次子代理都没起。
  assert.equal(calls.start.length, 0, 'optimized brainstorm must not spawn the review route')
  assert.equal(recorded.briefingRequired, true)
  assert.match(recorded.nextStep, /briefing/u)
  assert.equal(recorded.awaitingGate, null, 'no briefing yet ⇒ no gate')

  // brain 交要点（同一份 markdown 再落一次盘）。
  const digest = '覆盖章节：1. 目标、2. 选项\n\n结论：两个方向都可做。\n风险：第二个方向依赖外部服务。\n未决：无。'
  const again = JSON.parse(await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴\n\n## 1. 目标\n\n## 2. 选项', briefing: digest }, session))
  assert.equal(calls.start.length, 0, 'inline digest must not spawn either')
  assert.equal(again.briefingRound, 1)
  const round = readState(rootDir, begun.taskId).briefings.brainstorm.rounds[0]
  // 来源必须如实：brain 自写 ≠ 独立评审。
  assert.equal(round.source, 'brain/session')
  assert.equal(round.provider, null)
  assert.equal(round.model, null)
  // 面板/状态里的路由显示为"无"，不是 "null/null"。
  assert.equal(taskStatus(rootDir, begun.taskId).briefings.brainstorm.route, null)

  // 确认卡照旧：只有卡的真实应答开门。
  const confirmed = JSON.parse(await call(tools, 'smart_brief_confirm', {}, session))
  assert.equal(confirmed.briefingDecision, 'confirm')
  assert.equal(confirmed.awaitingGate, 'G1')
  assert.equal(calls.ask.length, 1)
})

test('an inline digest missing a section is refused (same completeness rule as review)', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'incomplete' }, session))
  const markdown = '# 脑暴\n\n## 1. 目标\n\n## 2. 选项'
  // 自动路径（A2）：缺节不冒泡成工具错误，而是落失败标记并如实报告缺哪一节 ——
  // 产物保留、要点可重试；但**绝不写轮**，所以门不会开。
  const out = JSON.parse(await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown, briefing: '覆盖章节：1. 目标\n结论 风险 未决' }, session))
  assert.equal(out.briefingFailed, true)
  assert.match(out.briefingError, /does not cover the artifact.*2\. 选项/u)
  assert.equal(readState(rootDir, begun.taskId).briefings.brainstorm?.rounds?.length ?? 0, 0)
  assert.equal(readState(rootDir, begun.taskId).awaitingGate, null)
  assert.equal(calls.start.length, 0)
})

// ── 效率的可见度量：派生 spawn 估算 ─────────────────────────────────────────

test('spawnEstimate counts child calls, not briefing rounds (inline rounds are free)', t => {
  const root = scratch(t)
  const optimized = createTask(root, { title: 'spend-opt' }, { workflow: 'optimized' })
  recordArtifact(root, optimized.id, 'brainstorm', '# 脑暴')
  recordBriefing(root, optimized.id, 'brainstorm', { provider: null, model: null, source: 'brain/session', body: '结论 风险 未决' })
  confirmBriefing(root, optimized.id, 'brainstorm', 'confirm', {})
  // 回归（2026-10-13）：早先这里把"轮次"当"调用"数，于是 brain 自写的那一轮被算成 1 次
  // review 调用 —— 正好抹掉这套优化要证明的东西。现在 inline 单独报，total 只数真起的 child。
  assert.deepEqual(taskStatus(root, optimized.id).spawns, { review: 0, hand: 0, inline: 1, total: 0 })

  const v1 = createTask(root, { title: 'spend-v1' })
  recordArtifact(root, v1.id, 'brainstorm', '# 脑暴')
  recordBriefing(root, v1.id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  confirmBriefing(root, v1.id, 'brainstorm', 'confirm', {})
  // v1 同一位置：review 起的那一轮就算 1 次。
  assert.deepEqual(taskStatus(root, v1.id).spawns, { review: 1, hand: 0, inline: 0, total: 1 })
  // consult 另起一次 child（这里用状态层记账，等价于一次 review 调用）。
  recordConsult(root, v1.id, 'brainstorm', { provider: 'stub', model: 'review', body: '缺回滚点' })
  assert.equal(taskStatus(root, v1.id).spawns.total, 2)
})

test('the discipline text names the ADR-lite contract and the optimized brainstorm', async t => {
  const rootDir = scratch(t)
  const views = []
  const commands = []
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition) },
    systemPrompt: { section: view => { views.push(view); return () => {} } },
    commands: { register: command => { commands.push(command) } },
    get: () => undefined,
  }
  mod.apply(ctx, { rootDir, allowGlobalRoot: true, handRoute: HAND, requireConsult: true })
  // 纪律节只在 /smart on 之后发声（模式开关由命令 handler 置位，smart_begin 不置位）。
  const session = {}
  const command = commands[0]
  command.handler({ agent: { session, steer: () => {} }, rawInput: '', attachments: [] })
  const text = views[0].text({ agent: { session } })
  // 决策记录写在做出决定的阶段，而不是还在探索的阶段。
  assert.match(text, /ADR-lite/u)
  assert.match(text, /decision table/u)
  // optimized 的 brainstorm 来源如实标注。
  assert.match(text, /brain\/session/u)
})

// ── 回归：v1 的自动 review briefing 没被改坏 ────────────────────────────────

test('v1 brainstorm still auto-generates its briefing on the review route', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'v1 brief' }, session))
  const recorded = JSON.parse(await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session))
  assert.equal(calls.start.length, 1, 'v1 keeps the review briefing call')
  assert.equal(typeof recorded.briefing, 'string')
  const round = readState(rootDir, begun.taskId).briefings.brainstorm.rounds[0]
  assert.notEqual(round.source, 'brain/session')
  assert.equal(round.provider, HAND.provider)
})

test('a later phase under optimized still uses the review route', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  await call(tools, 'smart_begin', { title: 'design phase' }, session)
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_consult', {}, session)
  await call(tools, 'smart_gate', {}, session)
  const before = calls.start.length
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session)
  assert.equal(calls.start.length, before + 1, 'design still gets a review briefing')
  assert.match(calls.start.at(-1).request.label, /smart brief · design/u)
})
