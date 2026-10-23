/**
 * Unit tests for the smart-mode phase machine (`lib/state.mjs`).
 *
 * The machine is where the design's two load-bearing rules live — phase order is
 * checked in code, and nothing advances until a gate is passed — so it is tested
 * directly, without cordis and without a profile. Every scratch directory is
 * created outside the repository (`mkdtempSync(tmpdir())`), per AGENTS.md §1.3.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PLAN_DRAFT } from './seams.mjs'
import './scratch-home.mjs'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DESIGN_PHASES,
  GATE_AFTER,
  PROMOTION_MANIFEST,
  artifactSections,
  briefingGaps,
  briefingStatusOf,
  confirmBriefing,
  missingBriefingSections,
  promoteDeliverables,
  readBriefingRound,
  readManifest,
  createTask,
  defaultTaskId,
  localDateStamp,
  gateGaps,
  listTasks,
  openDecisions,
  recordBriefing,
  recordBriefingFailure,
  recordDecisions,
  passGate,
  readArtifact,
  readState,
  recordArtifact,
  reworkBudget,
  recordVerification,
  removeTask,
  resolveConfig,
  resolveBrainstormEffort,
  finishTask,
  reworkTo,
  taskDir,
  taskStatus,
  writeState,
  assertFinalReviewRoute,
  escalatedEffort,
  planContractGaps,
  recordRuling,
  rulingsFromReport,
} from '../lib/state.mjs'

/** Scratch root outside the repo, removed when the test ends. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Record the consult a design phase needs before its gate can close (S2 writes
 * this from `smart_consult`; here it is injected to test the precondition). */
function consult(root, id, phase) {
  const state = readState(root, id)
  state.consults[phase] = { at: new Date().toISOString(), body: 'stub review' }
  return writeState(root, state)
}

/**
 * Generate a briefing round for the phase and confirm it — the new gate-opening
 * path (acceptance A5: only `confirmBriefing('confirm')` opens a gate).
 */
function brief(root, id, phase, body = '结论：可执行。风险：缺回滚点。未决：无。') {
  recordBriefing(root, id, phase, { provider: 'stub', model: 'review', source: 'preset', body })
  return confirmBriefing(root, id, phase, 'confirm', {})
}

test('brainstorm depth maps to a supported reasoning effort', () => {
  assert.equal(resolveBrainstormEffort('light', ['low']).reasoningEffort, 'low')
  assert.equal(resolveBrainstormEffort('balanced', ['low']).reasoningEffort, 'low')
  assert.equal(resolveBrainstormEffort('deep', ['high']).reasoningEffort, 'high')
  assert.equal(resolveBrainstormEffort('exhaustive', ['max']).reasoningEffort, 'max')
  assert.throws(() => resolveBrainstormEffort('exhaustive', ['none']), /no compatible reasoning effort/u)
  assert.throws(() => resolveBrainstormEffort('invalid'), /brainstormDepth/u)
})
test('resolveConfig applies defaults and rejects malformed rows', () => {
  const config = resolveConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.maxRework, 5)
  assert.equal(config.requireConsult, true)
  assert.equal(config.brainRoute, undefined)
  assert.equal(config.handRoute, undefined)

  assert.equal(resolveConfig({ enabled: false }).enabled, false)
  assert.equal(resolveConfig({ requireConsult: false }).requireConsult, false)
  assert.deepEqual(
    resolveConfig({ brainRoute: { provider: 'deepseek', model: 'pro', reasoningEffort: 'high' } }).brainRoute,
    { provider: 'deepseek', model: 'pro', reasoningEffort: 'high' },
  )
  // 路由是两条任意路由：不同 provider 也可以，不做白名单。
  assert.deepEqual(resolveConfig({ handRoute: { provider: 'other', model: 'flash' } }).handRoute, { provider: 'other', model: 'flash' })

  assert.throws(() => resolveConfig({ brainRoute: { provider: 'deepseek' } }), /brainRoute\.model/u)
  assert.throws(() => resolveConfig({ handRoute: 'flash' }), /handRoute must be an object/u)
  assert.throws(() => resolveConfig({ brainRoute: { provider: '', model: 'x' } }), /brainRoute\.provider/u)
  assert.throws(() => resolveConfig({ maxRework: -1 }), /maxRework/u)
  assert.throws(() => resolveConfig({ maxRework: 1.5 }), /maxRework/u)
  // 额度是**每阶段**的：一个阶段反复迭代不该把后面阶段的预算吃掉（老语义是整任务一个总数）。
  const spent = {
    history: [{ to: 'design' }, { to: 'design' }, { to: 'design' }, { to: 'plan' }],
    reworkGrants: [],
  }
  assert.deepEqual(reworkBudget(spent, 'design', 3), { phase: 'design', used: 3, cap: 3, grants: 0, maxRework: 3 })
  assert.deepEqual(reworkBudget(spent, 'plan', 3), { phase: 'plan', used: 1, cap: 3, grants: 0, maxRework: 3 })
  // 人加额 = 再买一个预算；模型自己不能加（grantRework 只被门调用）。
  assert.deepEqual(
    reworkBudget({ ...spent, reworkGrants: [{ phase: 'design' }] }, 'design', 3),
    { phase: 'design', used: 3, cap: 6, grants: 1, maxRework: 3 },
  )
  assert.throws(() => resolveConfig({ rootDir: '' }), /rootDir/u)
})

test('createTask seeds the first design phase and a safe id', t => {
  const root = scratch(t)
  const state = createTask(root, { title: 'Fix the widget', goal: 'widget works' })
  assert.equal(state.phase, 'brainstorm')
  assert.equal(state.awaitingGate, null)
  assert.deepEqual(state.gates, [])
  // id = **本地日期** + ASCII slug。（2026-10-12 起：时间戳那半由 UTC `YYYYMMDD-HHmmss`
  // 换成 locale `YYYY-MM-DD`；丢掉时分秒后必须有同日去重，见下面两行。）
  assert.match(state.id, /^\d{4}-\d{2}-\d{2}-fix-the-widget$/u)
  // 「本地」不是「UTC」：构造一个**本地**刚过午夜的时刻 —— 用 `toISOString()` 取日期时，
  // 东八区会退回前一天。（机器时区恰好是 UTC 时两边都过：这是一条**有时**能看见差异的尺子，
  // 如实说明，不假装它永远有效。）
  assert.equal(localDateStamp(new Date(2026, 0, 2, 0, 30)), '2026-01-02')
  assert.equal(defaultTaskId('Fix the widget', new Date(2026, 0, 2, 0, 30)), '2026-01-02-fix-the-widget')
  // 中文标题没有 ASCII 段 ⇒ id 就是日期本身；同一天再开一个必须自动加序号（不许当场 already exists）。
  const first = createTask(root, { title: '修一下拖拽' })
  assert.match(first.id, /^\d{4}-\d{2}-\d{2}$/u)
  const second = createTask(root, { title: '再修一个' })
  assert.equal(second.id, `${first.id}-2`)

  assert.throws(() => createTask(root, { title: 'again', taskId: first.id }), /already exists/u)
  assert.equal(readState(root, state.id)?.title, 'Fix the widget')

  assert.throws(() => createTask(root, { title: '  ' }), /non-empty `title`/u)
  assert.throws(() => createTask(root, { title: 'again', taskId: state.id }), /already exists/u)
  // 路径穿越必须被挡住（任务 id 直接进路径）。
  assert.throws(() => createTask(root, { title: 'evil', taskId: '../escape' }), /unsafe task id/u)
  assert.throws(() => createTask(root, { title: 'evil', taskId: '..' }), /unsafe task id/u)
  assert.throws(() => taskDir(root, 'a/b'), /unsafe task id/u)
})

test('recordArtifact enforces phase order; only briefing confirmation opens the gate', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'task' })

  assert.throws(() => recordArtifact(root, id, 'design', '# design'), /is in phase "brainstorm"/u)
  assert.throws(() => recordArtifact(root, id, 'nonsense', '# x'), /not an artifact phase/u)
  assert.throws(() => recordArtifact(root, id, 'brainstorm', '   '), /non-empty markdown/u)
  assert.throws(() => recordArtifact(root, 'missing', 'brainstorm', '# x'), /no such task/u)

  const state = recordArtifact(root, id, 'brainstorm', '# 脑暴\n- 方案 A\n- 方案 B')
  // 落盘不开门（acceptance A5）：门是"用户看懂了"的证明，不是"文件写完了"的证明。
  assert.equal(state.awaitingGate, null)
  assert.equal(state.phase, 'brainstorm')
  assert.equal(typeof state.artifacts.brainstorm.sha256, 'string')
  // briefing 确认才是开门路径。
  assert.equal(brief(root, id, 'brainstorm').awaitingGate, 'G1')
  // 门开着 + 当前轮已确认且 fresh ⇒ 稿子冻结，不许再写。
  assert.throws(() => recordArtifact(root, id, 'brainstorm', '# again'), /waiting on gate G1/u)
  assert.equal(readArtifact(root, id, 'brainstorm'), '# 脑暴\n- 方案 A\n- 方案 B\n')
  assert.equal(readArtifact(root, id, 'design'), null)
})

test('passGate refuses to close a gate whose contract is unmet', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'task' })
  recordArtifact(root, id, 'brainstorm', '# 脑暴')

  assert.throws(() => passGate(root, id, 'G2'), /not waiting on gate G2/u)
  // 门还没开（briefing 未确认）——"过不了门"先撞的是这一条。
  assert.throws(() => passGate(root, id, 'G1', {}, { requireConsult: true }), /no gate open/u)
  brief(root, id, 'brainstorm')
  // requireConsult 默认开：没有 consult 记录就过不了门。
  assert.throws(() => passGate(root, id, 'G1', {}, { requireConsult: true }), /missing consult record for "brainstorm"/u)
  const state = readState(root, id)
  assert.deepEqual(gateGaps(root, state, { requireConsult: true }), ['missing consult record for "brainstorm" (requireConsult)'])
  assert.deepEqual(gateGaps(root, state, { requireConsult: false }), [])

  consult(root, id, 'brainstorm')
  const passed = passGate(root, id, 'G1', { by: 'user', note: '同意' }, { requireConsult: true })
  assert.equal(passed.phase, 'design')
  assert.equal(passed.awaitingGate, null)
  assert.equal(passed.gates.length, 1)
  assert.equal(passed.gates[0].by, 'user')
  assert.throws(() => passGate(root, id, 'G1', {}, { requireConsult: true }), /no gate open/u)
})

test('the whole design walk needs four gates and four consults', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'walk' })
  const seen = []
  for (const [index, phase] of DESIGN_PHASES.entries()) {
    recordArtifact(root, id, phase, phase === 'plan' ? PLAN_DRAFT : `# ${phase}`)
    assert.equal(readState(root, id).awaitingGate, null)
    assert.equal(brief(root, id, phase).awaitingGate, `G${index + 1}`)
    consult(root, id, phase)
    const passed = passGate(root, id, `G${index + 1}`, { by: 'user' }, { requireConsult: true })
    seen.push(passed.phase)
  }
  // G4 过后就进执行阶段 —— 这正是"设计完成即授权执行"。
  assert.equal(seen.at(-1), 'executing')
  assert.equal(readState(root, id).phase, 'executing')
  assert.equal(readState(root, id).gates.length, 4)
})

test('a draft with 需要你裁决 does not open its gate, and only the user can clear it', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'decisions' })
  const draft = '# 脑暴\n\n## 1. 事实基线\n\n## 6. 需要你裁决（G1）\n1. 先做 A 还是先做 B？\n2. 脱敏口径同意吗？\n'

  // 解析器本身：小节标题含这几个字就算未决，清单项数报出来（钝规则，见 DECISION_MARKER 注释）。
  assert.deepEqual(openDecisions(draft), { items: 2, headings: ['6. 需要你裁决（G1）'] })
  assert.deepEqual(openDecisions('# 脑暴\n\n## 6. 已裁决（G1）\n1. → 用户：先做 B\n'), { items: 0, headings: [] })
  assert.deepEqual(openDecisions(null), { items: 0, headings: [] })

  const state = recordArtifact(root, id, 'brainstorm', draft)
  // 门**没开**：产物里还有只有用户能定的问题。
  assert.equal(state.awaitingGate, null)
  assert.deepEqual(state.pendingDecisions, { headings: ['6. 需要你裁决（G1）'], items: 2 })
  assert.equal(state.phase, 'brainstorm')
  // 门没开时允许重写产物 —— 这正是"把答案并进去"的回路；开门后再写会被拒（前面那条 spec）。
  assert.throws(() => passGate(root, id, 'G1', {}, { requireConsult: false }), /not waiting on gate G1/u)
  // 裁决落账：原文进 state.decisions，分轮次；记录本身**不**开门（还得并回产物）。
  const decided = recordDecisions(root, id, 'brainstorm', [
    { question: '先做 A 还是先做 B？', options: ['先做 B', '先做 A'], multiSelect: false, selected: ['先做 B'], custom: '' },
    { question: '脱敏口径同意吗？', options: ['同意'], multiSelect: false, selected: [], custom: '只留结构，不留真值' },
  ], { by: 'user' })
  assert.equal(decided.decisions.brainstorm.length, 1)
  assert.equal(decided.decisions.brainstorm[0].entries[1].custom, '只留结构，不留真值')
  assert.equal(decided.decisions.brainstorm[0].by, 'user')
  assert.equal(decided.awaitingGate, null)
  // 第二轮：再问一次不该覆盖上一轮（审计要能看到用户改过主意）。
  recordDecisions(root, id, 'brainstorm', [{ question: '再确认？', selected: ['是'], custom: '' }])
  assert.equal(readState(root, id).decisions.brainstorm.length, 2)
  assert.throws(() => recordDecisions(root, id, 'executing', [{ question: 'x', selected: [], custom: '' }]), /does not take decisions/u)
  assert.throws(() => recordDecisions(root, id, 'brainstorm', []), /at least one question/u)

  // 并回产物 → briefing 确认后才开门。
  const rewritten = recordArtifact(root, id, 'brainstorm', '# 脑暴\n\n## 6. 已裁决（G1）\n1. → 用户：先做 B\n2. → 用户：只留结构\n')
  assert.equal(rewritten.awaitingGate, null)
  assert.equal(rewritten.pendingDecisions, undefined)
  consult(root, id, 'brainstorm')
  assert.equal(brief(root, id, 'brainstorm').awaitingGate, 'G1')
  assert.deepEqual(gateGaps(root, readState(root, id), { requireConsult: true }), [])
  // 第二层防线：模型绕开工具、直接拿 fs 把未决小节写回文件 —— 过门时重读产物，照样挡住。
  writeFileSync(join(taskDir(root, id), 'brainstorm.md'), draft, 'utf8')
  assert.deepEqual(gateGaps(root, readState(root, id), { requireConsult: true }), [
    'briefing round 1 of "brainstorm" is stale — brainstorm.md changed after it was generated',
    'brainstorm.md still has 2 unanswered decision(s) under "6. 需要你裁决（G1）" — put the questions to the user (smart_decide) and fold the answers into the artifact first',
  ])
  assert.throws(() => passGate(root, id, 'G1', { by: 'user' }, { requireConsult: true }), /2 unanswered decision\(s\)/u)
  // 在途任务（旧状态：门早已开着 + 产物带未决小节）必须能走完同一个回路 —— 否则"把裁决并回
  // 产物"对历史任务就是死路：问完裁决却写不回去。判据取自产物自己。
  writeState(root, { ...readState(root, id), awaitingGate: 'G1' })
  assert.equal(recordArtifact(root, id, 'brainstorm', draft).awaitingGate, null)
  // 门开着但 briefing 未确认/stale ⇒ 重写放行；落盘后门收起（新一轮 briefing 起点）。
  writeFileSync(join(taskDir(root, id), 'brainstorm.md'), draft, 'utf8')
  writeState(root, { ...readState(root, id), awaitingGate: 'G1' })
  assert.equal(recordArtifact(root, id, 'brainstorm', '# 脑暴\n\n## 6. 已裁决（G1）\n1. → 用户：先做 B\n2. → 用户：只留结构\n').awaitingGate, null)
  // 新稿 briefing 确认后门再开，才过得了。
  consult(root, id, 'brainstorm')
  assert.equal(brief(root, id, 'brainstorm').awaitingGate, 'G1')
  assert.equal(passGate(root, id, 'G1', { by: 'user' }, { requireConsult: true }).phase, 'design')
})

test('G5 needs both the execution report and the review', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'walk' })
  for (const [index, phase] of DESIGN_PHASES.entries()) {
    recordArtifact(root, id, phase, phase === 'plan' ? PLAN_DRAFT : `# ${phase}`)
    brief(root, id, phase)
    consult(root, id, phase)
    passGate(root, id, `G${index + 1}`, {}, { requireConsult: true })
  }
  recordArtifact(root, id, 'executing', '# 执行报告\n- 步骤 1 ok')
  // G2 裁决①：执行报告落盘后停在 executing，确认后才进 reviewing。
  assert.equal(readState(root, id).phase, 'executing')
  assert.equal(readState(root, id).awaitingGate, null)
  const reportConfirmed = brief(root, id, 'executing')
  assert.equal(reportConfirmed.phase, 'reviewing')
  assert.equal(reportConfirmed.awaitingGate, null)
  recordArtifact(root, id, 'reviewing', '# 验收\n- 通过')
  assert.equal(readState(root, id).awaitingGate, null)
  assert.equal(brief(root, id, 'reviewing').awaitingGate, 'G5')
  assert.deepEqual(gateGaps(root, readState(root, id), { requireConsult: true }), [])
  const done = passGate(root, id, 'G5', { by: 'user' }, { requireConsult: true })
  assert.equal(done.phase, 'done')
  assert.equal(taskStatus(root, id).next, 'task complete — archive it with smart_finish')
})

test('G5 reports the artifact that is still missing', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'walk' })
  for (const [index, phase] of DESIGN_PHASES.entries()) {
    recordArtifact(root, id, phase, phase === 'plan' ? PLAN_DRAFT : `# ${phase}`)
    brief(root, id, phase)
    passGate(root, id, `G${index + 1}`, {}, { requireConsult: false })
  }
  recordArtifact(root, id, 'executing', '# 执行报告')
  brief(root, id, 'executing')
  recordArtifact(root, id, 'reviewing', '# 验收')
  brief(root, id, 'reviewing')
  const state = readState(root, id)
  // 执行报告已写时只缺 review；这里把 review 挪走来证明缺口是逐项报的。
  delete state.artifacts.reviewing
  writeState(root, state)
  assert.deepEqual(gateGaps(root, readState(root, id), { requireConsult: true }), ['missing review.md'])
})

test('writes are atomic and leave no temp files behind', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'atomic' })
  recordArtifact(root, id, 'brainstorm', '# 脑暴')
  const dir = taskDir(root, id)
  const leftovers = readdirSync(dir).filter(name => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
  // state.json 任何时候都必须是完整 JSON —— 半截状态是最危险的那种"看起来成功"。
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')))
})

test('the index tracks tasks and removeTask cleans both places', t => {
  const root = scratch(t)
  const first = createTask(root, { title: 'first' })
  const second = createTask(root, { title: 'second' })
  recordArtifact(root, first.id, 'brainstorm', '# 脑暴')
  const rows = listTasks(root)
  assert.deepEqual(rows.map(row => row.id), [first.id, second.id])
  // 索引行带 briefing 格（acceptance A10）：只落产物还没生成 briefing 时照实报 none。
  assert.deepEqual(rows[0].briefing, { status: 'none', at: null, route: null })
  recordBriefing(root, first.id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  assert.equal(listTasks(root)[0].briefing.status, 'awaiting-user')
  assert.equal(listTasks(root)[0].briefing.route, 'stub/review')
  confirmBriefing(root, first.id, 'brainstorm', 'confirm', {})
  assert.equal(listTasks(root)[0].awaitingGate, 'G1')
  assert.equal(listTasks(root)[0].briefing.status, 'confirmed')

  removeTask(root, first.id)
  assert.deepEqual(listTasks(root).map(row => row.id), [second.id])
  assert.equal(readState(root, first.id), null)
})

test('taskStatus reports evidence, rework history and archive state', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'status depth' })
  for (const [index, phase] of DESIGN_PHASES.entries()) {
    recordArtifact(root, id, phase, phase === 'plan' ? PLAN_DRAFT : `# ${phase}`)
    brief(root, id, phase)
    passGate(root, id, `G${index + 1}`, {}, { requireConsult: false })
  }
  recordArtifact(root, id, 'executing', '# 执行报告')
  // 指引要跟着工具面走：执行报告落盘 → 先过报告的 briefing，确认后 → 才是取证。
  assert.match(taskStatus(root, id).next, /smart_brief_confirm/u)
  brief(root, id, 'executing')
  assert.match(taskStatus(root, id).next, /gather evidence with smart_verify/u)
  recordVerification(root, id, { provider: 'deepseek', model: 'flash', body: '# 证据\n- A：PASS' })
  assert.match(taskStatus(root, id).next, /write your verdict as review\.md/u)
  // 换一个视角（评审记录）后，状态里应当能看见证据与返工轨迹，而不是只有阶段名。
  const status = taskStatus(root, id)
  assert.equal(status.verifications.length, 1)
  assert.equal(status.verifications[0].route, 'deepseek/flash')
  assert.match(status.verifications[0].file, /^verify\//u)
  assert.deepEqual(status.reworkedFrom, [])

  recordArtifact(root, id, 'reviewing', '# 验收\n- A 不通过')
  reworkTo(root, id, 'plan', '验收不通过')
  const after = taskStatus(root, id)
  assert.deepEqual(after.reworkedFrom.map(entry => [entry.from, entry.to]), [['reviewing', 'plan']])
  assert.equal(after.reworkCount, 1)

  // 归档是终态的一部分，必须在状态里可见。
  for (const phase of ['plan', 'acceptance']) {
    recordArtifact(root, id, phase, phase === 'plan' ? PLAN_DRAFT : `# ${phase}`)
    brief(root, id, phase)
    passGate(root, id, GATE_AFTER[phase], {}, { requireConsult: false })
  }
  recordArtifact(root, id, 'executing', '# 再执行')
  brief(root, id, 'executing')
  recordArtifact(root, id, 'reviewing', '# 再验收')
  brief(root, id, 'reviewing')
  passGate(root, id, 'G5', {}, { requireConsult: false })
  // 归档现在要把交付副本写进工作区：state.spec 直接给一个显式 workspace。
  finishTask(root, id, '# 收尾', { workspace: scratch(t), workspaceSource: 'args.workspace' })
  const archived = taskStatus(root, id)
  assert.equal(archived.phase, 'done')
  assert.equal(archived.summary, 'summary.md')
  assert.ok(typeof archived.archivedAt === 'string' && archived.archivedAt.length > 0)
})

test('taskStatus narrates the next required action', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: 'narrate' })
  assert.match(taskStatus(root, id).next, /write brainstorm\.md/u)
  recordArtifact(root, id, 'brainstorm', '# 脑暴')
  // 落盘后的下一步是 briefing（生成→对话→确认），不是直接奔门。
  assert.match(taskStatus(root, id).next, /smart_brief_confirm/u)
  brief(root, id, 'brainstorm')
  assert.match(taskStatus(root, id).next, /missing consult record/u)
  assert.match(taskStatus(root, id).next, /confirm gate G1/u)
  consult(root, id, 'brainstorm')
  assert.match(taskStatus(root, id).next, /confirm gate G1/u)
  assert.throws(() => taskStatus(root, 'nope'), /no such task/u)
})

/**
 * Walk a fresh task to the only state `finishTask` accepts: past gate G5.
 *
 * The gates are closed with `requireConsult: false` because these tests are about
 * the delivery copy, not about the consult contract the tools spec owns.
 */
function walkToG5(root, id) {
  for (const [index, phase] of DESIGN_PHASES.entries()) {
    recordArtifact(root, id, phase, phase === 'plan' ? PLAN_DRAFT : `# ${phase}`)
    brief(root, id, phase)
    passGate(root, id, `G${index + 1}`, {}, { requireConsult: false })
  }
  recordArtifact(root, id, 'executing', '# 执行报告\n')
  brief(root, id, 'executing')
  recordVerification(root, id, { provider: 'deepseek', model: 'flash', body: '# 证据\n' })
  recordArtifact(root, id, 'reviewing', '# 验收\n')
  brief(root, id, 'reviewing')
  passGate(root, id, 'G5', {}, { requireConsult: false })
}

test('promoteDeliverables writes exactly the delivery surface, per-file shasums included', t => {
  const root = scratch(t)
  const workspace = scratch(t)
  const { id } = createTask(root, { title: '交付副本' })
  const dir = taskDir(root, id)
  const bodies = {
    'brainstorm.md': '# 脑暴\n',
    'design.md': '# 设计\n',
    'plan.md': '# 计划\n',
    'acceptance.md': '# 验收设计\n',
    'execution-report.md': '# 执行\n',
    'review.md': '# 评审\n',
    'summary.md': '# 收尾\n',
  }
  for (const [file, body] of Object.entries(bodies)) writeFileSync(join(dir, file), body)
  // The three things that must NOT ship: review prose, raw evidence, superseded drafts.
  for (const hidden of ['consult', 'verify', 'history']) {
    mkdirSync(join(dir, hidden), { recursive: true })
    writeFileSync(join(dir, hidden, 'secret.md'), '手模型原文\n')
  }

  const result = promoteDeliverables({
    taskDir: dir,
    workspace,
    state: { id, title: '交付副本', goal: '把交付面落进仓库', archivedAt: '2026-10-02T00:00:00.000Z' },
  })
  const target = join(workspace, 'docs', 'smart', id)
  assert.equal(result.target, target)
  assert.deepEqual(
    readdirSync(target).sort(),
    [...Object.keys(bodies), 'README.md', PROMOTION_MANIFEST].sort(),
  )

  // 逐文件 shasum：清单里的值 == 交付面上的字节 == 隐藏树的源文件。
  const manifest = readManifest(target)
  for (const [file, body] of Object.entries(bodies)) {
    const digest = createHash('sha256').update(readFileSync(join(target, file))).digest('hex')
    assert.equal(digest, createHash('sha256').update(body).digest('hex'), `${file} must be byte-identical`)
    assert.equal(manifest.shasums[file], digest, `${file} must be listed with its own digest`)
  }
  assert.equal(manifest.taskId, id)
  assert.deepEqual(manifest.files.sort(), [...Object.keys(bodies), 'README.md'].sort())

  // README：只相对路径，且明说这里是只读副本。
  const readme = readFileSync(join(target, 'README.md'), 'utf8')
  assert.equal(readme.includes('/Users/'), false, 'a delivered document must not name the producing machine')
  assert.match(readme, /只读交付副本/u)
  assert.match(readme, /重新 `smart_finish`/u)
  assert.equal(result.written.length, 8)
})

test('a user file in the delivery path refuses the promotion and is left untouched', t => {
  const root = scratch(t)
  const workspace = scratch(t)
  const { id } = createTask(root, { title: '用户文件' })
  const dir = taskDir(root, id)
  writeFileSync(join(dir, 'plan.md'), '# 我的计划\n')
  const target = join(workspace, 'docs', 'smart', id)
  mkdirSync(target, { recursive: true })
  // 用户自己的文件（没有本机提升清单）：绝不许被覆盖。
  writeFileSync(join(target, 'plan.md'), '# 用户手写的计划\n')
  const before = readFileSync(join(target, 'plan.md'))

  assert.throws(
    () => promoteDeliverables({ taskDir: dir, workspace, state: { id, title: '用户文件', goal: 'g' } }),
    error => {
      assert.match(error.message, /拒绝覆盖用户文件/u)
      assert.ok(error.message.includes(`docs/smart/${id}/plan.md`), `冲突要列出来：${error.message}`)
      assert.deepEqual(error.written, [], 'nothing was written before the refusal')
      return true
    },
  )
  assert.deepEqual(readFileSync(join(target, 'plan.md')), before)
  assert.equal(existsSync(join(target, PROMOTION_MANIFEST)), false)
})

test('a retry may clean up this machine own half-written promotion, but never another task copy', t => {
  const root = scratch(t)
  const workspace = scratch(t)
  const { id } = createTask(root, { title: '重试' })
  const dir = taskDir(root, id)
  writeFileSync(join(dir, 'plan.md'), '# 计划 v2\n')
  const target = join(workspace, 'docs', 'smart', id)
  mkdirSync(target, { recursive: true })

  // 上一次提升的半成品：plan.md 已落位，清单也写了（是我们自己写的）。
  writeFileSync(join(target, 'plan.md'), '# 计划 v1（半成品）\n')
  writeFileSync(join(target, PROMOTION_MANIFEST), `${JSON.stringify({
    taskId: id, title: '重试', promotedAt: '2026-10-02T00:00:00.000Z', files: ['plan.md'], shasums: {},
  })}\n`)

  const retried = promoteDeliverables({ taskDir: dir, workspace, state: { id, title: '重试', goal: 'g' } })
  assert.equal(retried.written.includes(`docs/smart/${id}/plan.md`), true)
  assert.equal(readFileSync(join(target, 'plan.md'), 'utf8'), '# 计划 v2\n', 'a retry may overwrite its own half-written file')

  // 另一个任务的清单不算"我们的"：同名文件回到"用户文件"待遇。
  writeFileSync(join(target, PROMOTION_MANIFEST), `${JSON.stringify({
    taskId: '20260101-000000-someone-else', title: '别人', promotedAt: '2026-10-02T00:00:00.000Z', files: ['plan.md'], shasums: {},
  })}\n`)
  assert.throws(
    () => promoteDeliverables({ taskDir: dir, workspace, state: { id, title: '重试', goal: 'g' } }),
    /拒绝覆盖用户文件/u,
  )
})

test('a read-only delivery target keeps the task unarchived and is retryable', t => {
  const root = scratch(t)
  const workspace = scratch(t)
  const { id } = createTask(root, { title: '只读目标' })
  walkToG5(root, id)
  const target = join(workspace, 'docs', 'smart', id)
  mkdirSync(target, { recursive: true })
  chmodSync(target, 0o500)
  t.after(() => {
    try {
      chmodSync(target, 0o700)
    } catch {
      // 目录可能已被清掉：清理失败不该让测试失败。
    }
  })

  assert.throws(
    () => finishTask(root, id, '# 收尾', { workspace, workspaceSource: 'args.workspace' }),
    error => {
      assert.match(error.message, /归档提升失败/u)
      assert.match(error.message, /可重试/u)
      assert.equal(Array.isArray(error.written), true)
      assert.equal(error.target, target)
      return true
    },
  )
  const stuck = readState(root, id)
  assert.equal(stuck.archivedAt, undefined, 'a failed promotion must not mark the task archived')
  assert.equal(stuck.delivery, undefined)
  // 收尾总结已经落隐藏树：修好之后重试不必重写正文。
  assert.equal(readFileSync(join(taskDir(root, id), 'summary.md'), 'utf8'), '# 收尾\n')

  chmodSync(target, 0o700)
  const done = finishTask(root, id, '# 收尾', { workspace, workspaceSource: 'args.workspace' })
  assert.equal(typeof done.archivedAt, 'string')
  assert.equal(done.delivery.dir, join('docs', 'smart', id))
  assert.equal(existsSync(join(target, 'README.md')), true, 'the retry completes the promotion')
})

// ── 计划文档契约（S2）：Interfaces / Global Constraints / Review Focus ─────────

test('planContractGaps names exactly what a plan.md is missing', t => {
  // 空 / 只有分组步骤：三块全缺，逐条点名（模型只读消息就能补齐）。
  assert.deepEqual(planContractGaps(''), ['plan.md is empty'])
  const bare = planContractGaps('# 计划\n## 步骤\n- [ ] a\n## 回滚点')
  assert.equal(bare.length, 5, `裸计划该报 5 项：${bare.join(' | ')}`)
  for (const want of ['Global Constraints', 'Review Focus', 'Interfaces', 'Consumes', 'Produces']) {
    assert.ok(bare.some(item => item.includes(want)), `缺口要点名 ${want}：${bare.join(' | ')}`)
  }
  // 齐全 ⇒ 不报。
  assert.deepEqual(planContractGaps(PLAN_DRAFT), [])
})

test('Interfaces must appear once per task, not once per document', t => {
  // 一个实现者只看得到自己的任务 —— 只在一处写 Interfaces 而有 3 个任务，
  // 另外两个任务的实现者仍然不知道邻居的名字与类型。
  const oneForThree = [
    '# p', '## Global Constraints', '- x', '## Review Focus', '- y',
    '### Task 1: a', '**Interfaces:**', '- Consumes: a', '- Produces: b',
    '### Task 2: b', '### Task 3: c',
  ].join('\n')
  const gaps = planContractGaps(oneForThree)
  assert.equal(gaps.length, 1, gaps.join(' | '))
  assert.match(gaps[0], /found 1, need 3/u)
  // 补齐两份就过。
  const ok = oneForThree.replace('### Task 2: b', '### Task 2: b\n**Interfaces:**\n- Consumes: b\n- Produces: c')
    .replace('### Task 3: c', '### Task 3: c\n**Interfaces:**\n- Consumes: c\n- Produces: d')
  assert.deepEqual(planContractGaps(ok), [])
})

test('a fenced fake section does not count as the real one', t => {
  // 代码块里的 `## Global Constraints` 不是小节（artifactSections 是 fence-aware）。
  const fake = '# p\n```md\n## Global Constraints\n```\n## Review Focus\n### Task 1\n**Interfaces:**\n- Consumes: a\n- Produces: b'
  const gaps = planContractGaps(fake)
  assert.equal(gaps.length, 1, gaps.join(' | '))
  assert.match(gaps[0], /Global Constraints/u)
})

// ── S3：模型自主裁决（Rulings）────────────────────────────────────────────────

test('recordRuling refuses a ruling that cannot be reviewed later', t => {
  const root = scratch(t)
  const { id } = createTask(root, { title: '裁决' })
  // 三段缺一不可：只写决定不写代价 ⇒ 事后没法判断该不该回滚。
  for (const bad of [
    { decision: '', why: 'x', costIfWrong: 'y' },
    { decision: 'x', why: '', costIfWrong: 'y' },
    { decision: 'x', why: 'y', costIfWrong: '' },
  ]) {
    assert.throws(() => recordRuling(root, id, bad), /needs/u, JSON.stringify(bad))
  }
  const state = recordRuling(root, id, { decision: '用 rename 而非 move', why: '跨设备 move 会丢权限位', costIfWrong: '权限位丢失，需手工重设' })
  assert.equal(state.rulings.length, 1)
  assert.equal(state.rulings[0].by, 'model')
  assert.equal(state.rulings[0].phase, state.phase)
  // hand 的裁决要如实标注来源。
  const again = recordRuling(root, id, { decision: 'b', why: 'c', costIfWrong: 'd', by: 'hand' })
  assert.equal(again.rulings.at(-1).by, 'hand')
})

test('rulingsFromReport keeps three-part rulings and drops the rest, counting what it dropped', t => {
  const report = [
    '# 执行报告', '',
    '## 步骤', '- [x] a', '',
    '## Rulings',
    '- **用 rename 而非 move** — 跨设备 move 会丢权限位 — 权限位丢失需手工重设',
    '- 只有决定没有别的',
    '- **x** — y — z',
    '## 遗留',
  ].join('\n')
  const { rulings, skipped } = rulingsFromReport(report)
  assert.equal(rulings.length, 2, JSON.stringify(rulings))
  assert.equal(skipped, 1, '拆不出三段的要照实计数（宁可少记，不记不存在的裁决）')
  assert.equal(rulings[0].decision, '用 rename 而非 move')
  // 没有 Rulings 小节 ⇒ 空手而归，不报错。
  assert.deepEqual(rulingsFromReport('# 报告\n## 步骤'), { rulings: [], skipped: 0 })
})

// ── S4：模型分级收窄 —— 终审不许回落 / 返工升档 ────────────────────────────────

test('the final review refuses a fallback route and names what to configure', t => {
  // 回落链最坏会跑到执行者用的那条上 —— 自己审自己。
  for (const ok of ['preset', 'session', 'default']) assert.doesNotThrow(() => assertFinalReviewRoute(ok))
  for (const bad of ['hand-fallback', 'session-fallback', 'default-fallback', undefined, null]) {
    assert.throws(() => assertFinalReviewRoute(bad), /refuses a fallback route/u, String(bad))
  }
  // 报错要说清该配什么（模型只读它就知道下一步）。
  const err = (() => { try { assertFinalReviewRoute('hand-fallback'); return null } catch (e) { return e } })()
  assert.match(err.message, /reviewRoute/u)
})

test('escalatedEffort only escalates after a real rework, and never invents an effort', t => {
  const route = { provider: 'p', model: 'm', reasoningEffort: 'low' }
  // 第一次写（0）/ 第一次返工（1）：不动。
  for (const attempts of [0, 1]) {
    const out = escalatedEffort(route, attempts, ['low', 'medium', 'high'])
    assert.equal(out.escalated, false)
    assert.deepEqual(out.route, route)
  }
  // 第二次返工起：提到该模型支持的**最高档**。
  const up = escalatedEffort(route, 2, ['low', 'medium', 'high'])
  assert.equal(up.escalated, true)
  assert.equal(up.route.reasoningEffort, 'high')
  assert.equal(up.route.provider, 'p', '只动 effort，不动路由本身')
  // 查不到档位表 ⇒ 原样返回并如实标注 escalated: false（不猜、不造档位名）。
  for (const supported of [undefined, [], ['low']]) {
    const out = escalatedEffort(route, 3, supported)
    assert.equal(out.escalated, false, JSON.stringify(supported))
    assert.deepEqual(out.route, route)
  }
})

test('a briefing round records whether the review ran escalated, and at which attempt', t => {
  // 用户有权知道这一轮评审**比上一轮更用力**，以及为什么（返工到第几稿）。
  const root = scratch(t)
  const { id } = createTask(root, { title: '升档留痕' })
  recordArtifact(root, id, 'brainstorm', '# 脑暴')
  const next = recordBriefing(root, id, 'brainstorm', {
    provider: 'deepseek', model: 'flash', source: 'preset',
    escalated: true, attempts: 2, body: '结论 风险 未决',
  })
  const round = next.briefings.brainstorm.rounds.at(-1)
  assert.equal(round.escalated, true)
  assert.equal(round.attempts, 2)
  // 不升档时如实记 false/0 —— 不能是 undefined（那会让人以为"没查"）。
  recordArtifact(root, id, 'brainstorm', '# 脑暴 v2')
  const again = recordBriefing(root, id, 'brainstorm', { provider: 'deepseek', model: 'flash', body: '结论 风险 未决' })
  const round2 = again.briefings.brainstorm.rounds.at(-1)
  assert.equal(round2.escalated, false)
  assert.equal(round2.attempts, 0)
})
