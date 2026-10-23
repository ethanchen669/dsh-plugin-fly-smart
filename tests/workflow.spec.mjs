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
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CONSULT_PHASES,
  WORKFLOWS,
  listTasks,
  taskDir,
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
import { BRIEF_CONFIRM, childService, GATE_PASS, reviewReply, PLAN_DRAFT } from './seams.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let loadCount = 0

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-workflow-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const HAND = { provider: 'deepseek', model: 'flash' }
const REVIEW = { provider: 'deepseek', model: 'pro' }

/** Minimal tool-layer harness: counts spawns and dispatches card answers by id. */
async function load(config, { output } = {}) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: [], ask: [] }
  const services = {
    subagents: childService(async (provider, request) => {
        calls.start.push({ provider, request })
        const text = typeof output === 'function' ? output(request) : reviewReply(request)
        return {
          id: `child-${calls.start.length}`,
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text }], stopReason: 'completed' }),
          dispose: async () => {},
      }
    }),
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
  mod.apply(ctx, { allowGlobalRoot: true, handRoute: HAND, reviewRoute: REVIEW, requireConsult: true, ...config })
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
  mod.apply(ctx, { rootDir, allowGlobalRoot: true, handRoute: HAND, reviewRoute: REVIEW, requireConsult: true })
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
  // optimized 的 design 走 bundle：一次 child 同时出要点与 consult（标签也如实说 bundle）。
  assert.match(calls.start.at(-1).request.label, /smart bundle · design/u)
})

// ── optimized: plan + acceptance 是一对 ─────────────────────────────────────

test('optimized plan records plan.md and acceptance.md together, and G3 hands over to execution', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'pair' }, session))
  const id = begun.taskId

  // brainstorm（inline）→ G1 → design（bundle）
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)

  // 缺伴随正文 ⇒ 明确拒绝（这一相位就是"计划+验收一起写"）
  await assert.rejects(call(tools, 'smart_artifact', { phase: 'plan', markdown: '# 计划' }, session), /acceptanceMarkdown/u)

  const paired = JSON.parse(await call(tools, 'smart_artifact', {
    phase: 'plan',
    markdown: PLAN_DRAFT,
    acceptanceMarkdown: '# 验收设计\n\n## A1 检查',
  }, session))
  assert.equal(paired.pairedWith, 'acceptance.md')
  assert.equal(paired.recorded, 'plan')
  // 一份 review child 同时出要点与 consult（bundle），所以两段都在返回里。
  assert.equal(typeof paired.briefing, 'string')
  assert.equal(typeof paired.consult, 'string')

  const state = readState(rootDir, id)
  assert.equal(state.artifacts.plan.companion, 'acceptance.md')
  assert.equal(state.consulted === undefined, true) // state 上不存这个字段
  assert.equal(typeof state.consults.plan, 'object')
  assert.equal(state.reviewBundles.plan.artifactSha256, state.artifacts.plan.sha256)

  await call(tools, 'smart_brief_confirm', {}, session)
  // G3 通过**直接进执行**：optimized 没有 G4，也没有 acceptance 相位。
  const gated = JSON.parse(await call(tools, 'smart_gate', {}, session))
  assert.equal(gated.nextPhase, 'executing')
  assert.equal(readState(rootDir, id).phase, 'executing')
  assert.equal(readState(rootDir, id).awaitingGate, null)
  assert.doesNotThrow(() => readState(rootDir, id))
})

test('a pair with an empty half writes neither file', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'atomic pair' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await assert.rejects(
    call(tools, 'smart_artifact', { phase: 'plan', markdown: PLAN_DRAFT, acceptanceMarkdown: '   ' }, session),
    /acceptanceMarkdown|acceptance body must be non-empty/u,
  )
  // 一份都没落盘 —— 不能留"计划写了、验收没写"的中间态。
  const dir = taskDir(rootDir, begun.taskId)
  assert.equal(existsSync(join(dir, 'acceptance.md')), false)
  assert.equal(existsSync(join(dir, 'plan.md')), false)
})

test('optimized v1-untouched: standard tasks still walk plan → acceptance → executing', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir })
  const session = {}
  await call(tools, 'smart_begin', { title: 'v1 walk' }, session)
  for (const phase of ['brainstorm', 'design', 'plan']) {
    await call(tools, 'smart_artifact', { phase, markdown: phase === 'plan' ? PLAN_DRAFT : `# ${phase}` }, session)
    await call(tools, 'smart_brief_confirm', {}, session)
    await call(tools, 'smart_consult', {}, session)
    await call(tools, 'smart_gate', {}, session)
  }
  // v1 的 G3 之后仍然是 acceptance（新相位），不是 executing。
  const tasks = listTasks(rootDir)
  assert.equal(tasks.length, 1)
  assert.equal(readState(rootDir, tasks[0].id).phase, 'acceptance')
})

// ── review bundle：一次 child 出两段；consult 复用不再 spawn ────────────────

test('one bundle child records both halves, and smart_consult reuses it without spawning', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  await call(tools, 'smart_begin', { title: 'bundle' }, session)
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)

  const before = calls.start.length
  const recorded = JSON.parse(await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session))
  assert.equal(calls.start.length, before + 1, 'one child for briefing + consult')
  assert.equal(recorded.consult.length > 0, true)

  // consult 命中 bundle：零额外 spawn，且把同一份评审还给模型。
  const hit = JSON.parse(await call(tools, 'smart_consult', {}, session))
  assert.equal(hit.bundleHit, true)
  assert.equal(calls.start.length, before + 1, 'bundle hit must not spawn')
  assert.equal(hit.review.length > 0, true)

  const status = JSON.parse(await call(tools, 'smart_status', {}, session))
  // 真实计数：design 那一段只记**一次** review 调用（不是 briefing + consult 的两次）。
  assert.equal(status.metrics.reviewSpawns, 1)
  // 两轮要点：brainstorm 的 inline（brain 写）+ design 的 bundle（review 写）。
  assert.equal(status.metrics.briefings, 2)
  assert.equal(status.metrics.brainRounds, 1)
  assert.equal(status.metrics.consults, 1)
})

test('a stale bundle forces a fresh child (freshness is by artifact sha)', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  await call(tools, 'smart_begin', { title: 'stale bundle' }, session)
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计 v1' }, session)
  const afterFirst = calls.start.length
  // 改稿（briefing 变 stale、门仍关着 ⇒ 允许重写）→ bundle 必须重跑。
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计 v2' }, session)
  assert.equal(calls.start.length, afterFirst + 1, 'rewriting the artifact must invalidate the bundle')
  const again = JSON.parse(await call(tools, 'smart_consult', {}, session))
  assert.equal(again.bundleHit, true, 'the new bundle answers the consult')
  assert.equal(calls.start.length, afterFirst + 1)
})

test('a malformed bundle fails closed: no consult, no round, retry works', async t => {
  const rootDir = scratch(t)
  let malformed = true
  const { tools, calls } = await load({ rootDir, workflow: 'optimized' }, {
    output: request => (request.prompt[0].text.includes('=== BRIEFING ===') && malformed
      ? '只有一段评审，没有分隔标记'
      : (request.prompt[0].text.includes('=== BRIEFING ===')
        ? `=== BRIEFING ===\n覆盖章节：全文\n结论 风险 未决\n=== CONSULT ===\n缺回滚点\n`
        : 'x')),
  })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'malformed' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)

  const bad = JSON.parse(await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session))
  assert.equal(bad.briefingFailed, true)
  const state = readState(rootDir, begun.taskId)
  // fail closed：consult 一行都没写、要点没有轮、门不开。
  assert.equal(state.consults.design, undefined)
  assert.equal(state.briefings.design?.rounds?.length ?? 0, 0)
  assert.equal(state.awaitingGate, null)

  malformed = false
  const retried = JSON.parse(await call(tools, 'smart_brief', {}, session))
  assert.equal(retried.briefed, true)
  assert.equal(typeof readState(rootDir, begun.taskId).consults.design, 'object')
})

test('rework from an optimized task archives plan.md and its acceptance companion together', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'rework pair' }, session))
  const id = begun.taskId
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'plan', markdown: PLAN_DRAFT, acceptanceMarkdown: '# 验收' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_execute', {}, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_verify', {}, session)
  await call(tools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收结论' }, session)

  const rewound = JSON.parse(await call(tools, 'smart_rework', { reason: '验收不过', backTo: 'plan' }, session))
  assert.equal(rewound.phase, 'plan')
  assert.equal(readState(rootDir, id).artifacts.plan, undefined)
  // 两份都进了 history：留一份孤儿 acceptance.md 会被下一次落盘当成"已经是这一轮的产物"。
  const dir = taskDir(rootDir, id)
  assert.equal(existsSync(join(dir, 'plan.md')), false)
  assert.equal(existsSync(join(dir, 'acceptance.md')), false)
  const history = readdirSync(join(dir, 'history'))
  assert.equal(history.some(name => name.endsWith('-plan.md')), true)
  assert.equal(history.some(name => name.endsWith('-acceptance.md')), true)
})

// ── 新宿主的补偿控制：子会话不能驱动工作流 ──────────────────────────────────

test('a subagent child cannot drive the workflow (the current host no longer restricts its tools)', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir })
  // 子会话自报血缘（真实字段：SessionHeader.origin / delegationDepth）。
  const child = { header: { origin: 'subagent', delegationDepth: 1 } }
  await assert.rejects(call(tools, 'smart_begin', { title: 'nope' }, child), /subagent child/u)
  await assert.rejects(call(tools, 'smart_status', {}, child), /subagent child/u)
  // 只带 depth 的也算（老日志里 origin 可能缺）。
  await assert.rejects(call(tools, 'smart_begin', { title: 'nope' }, { header: { delegationDepth: 2 } }), /subagent child/u)
  // 顶层会话照常（用户 fork 出来的会话 parentSession 有值、但 origin 不是 subagent）。
  const top = { header: { parentSession: 'sess-parent', delegationDepth: 0 } }
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'top level' }, top))
  assert.equal(typeof begun.taskId, 'string')
})

// ── S3 收口：裁决必须在收尾总结里露面 ────────────────────────────────────────

test('a task with rulings cannot close without the summary covering them', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir, workflow: 'optimized' })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: '带裁决的任务' }, session))
  const id = begun.taskId
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴', briefing: '结论 风险 未决' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'design', markdown: '# 设计' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'plan', markdown: PLAN_DRAFT, acceptanceMarkdown: '# 验收' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_execute', {}, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_verify', {}, session)
  await call(tools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收结论' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)

  // 记一条模型自主裁决（它替用户定的事）。
  await call(tools, 'smart_ruling', { decision: '用 rename 而非 move', why: '跨设备 move 会丢权限位', costIfWrong: '权限位丢失，需手工重设' }, session)
  await call(tools, 'smart_gate', {}, session)   // G5 过了才能收尾

  // 收尾总结一个字不提裁决 ⇒ 拒绝，且点名要覆盖。
  const workspace = mkdtempSync(join(tmpdir(), 'smart-ws-'))
  const err = await call(tools, 'smart_finish', { summary: '做完了，一切正常。', workspace }, session).then(() => null, error => error)
  assert.ok(err !== null, '有裁决却只字不提的收尾总结必须被拒')
  assert.match(err.message, /ruling/iu)
  assert.match(err.message, /what you decided/iu)

  // 覆盖到就放行。
  const ok = JSON.parse(await call(tools, 'smart_finish', {
    workspace,
    summary: '做完了。\n\n## 裁决\n- **用 rename 而非 move** — 跨设备 move 会丢权限位 — 若错，权限位丢失需手工重设。',
  }, session))
  assert.equal(ok.archived, true)
})
