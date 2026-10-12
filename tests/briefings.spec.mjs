/**
 * Contract tests for the briefing loop (`recordBriefing` / `confirmBriefing` /
 * `briefingGaps` + the `smart_brief` / `smart_brief_confirm` tools).
 *
 * The briefing loop is what makes a phase gate mean "the user understood this
 * draft" instead of "the file was written": the digest is bound to the artifact's
 * sha256, only the real answer to a short card opens the gate, and any artifact
 * rewrite silently invalidates what was confirmed. The named cases below are the
 * acceptance contract's C1 list — each one exists because a plausible wrong
 * implementation would pass without it.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  artifactSections,
  briefingGaps,
  briefingStatusOf,
  confirmBriefing,
  createTask,
  missingBriefingSections,
  readBriefingRound,
  readState,
  recordArtifact,
  recordBriefing,
  recordBriefingFailure,
  reworkTo,
  taskDir,
  taskStatus,
  writeState,
} from '../lib/state.mjs'
import { BRIEF_CONFIRM, briefingText, GATE_PASS, reviewReply } from './seams.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let loadCount = 0

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-briefings-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const HAND = { provider: 'deepseek', model: 'flash' }

/** A prompt-aware tool-layer harness with per-card dispatching answers. */
async function load(config, seams = {}) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: [], dispose: 0, ask: [], reply: [] }
  const services = {
    subagents: seams.subagents === undefined
      ? {
          start: async (provider, request) => {
            calls.start.push({ provider, request })
            const text = typeof seams.output === 'function'
              ? seams.output(request)
              : (seams.output ?? reviewReply(request))
            calls.reply.push(text)
            return {
              id: `child-${calls.start.length}`,
              localAgent: undefined,
              result: Promise.resolve({ output: [{ type: 'text', text }], stopReason: 'completed' }),
              dispose: async () => { calls.dispose += 1 },
            }
          },
        }
      : seams.subagents,
    userQuestions: seams.userQuestions === undefined
      ? {
          ask: async question => {
            calls.ask.push(question)
            const card = question.questions[0]
            return { answers: [{ id: card.id, selected: [card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : GATE_PASS], custom: '' }] }
          },
        }
      : seams.userQuestions,
  }
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition) },
    systemPrompt: { section: () => () => {} },
    commands: { register: () => () => {} },
    get: name => (seams.drop?.includes(name) ? undefined : services[name]),
  }
  mod.apply(ctx, { allowGlobalRoot: true, handRoute: HAND, requireConsult: false, ...config })
  return { tools, calls }
}

/** Does the briefing gap block the (already open) gate? — A5's pre-ask check. */
function gateGapsBriefing(rootDir, id) {
  return briefingGaps(rootDir, readState(rootDir, id), 'brainstorm').length > 0
}

const exec = (session = {}) => ({ signal: new AbortController().signal, agent: { session } })
const call = (tools, name, args, session) => tools.get(name).execute(args, exec(session))

/** Direct state-layer walk: begin → artifact → (optional) briefing round. */
function seedState(root, title = 'briefings') {
  const { id } = createTask(root, { title })
  return id
}

// ── A1 / C1-5 / C1-6: completeness is a coverage check, not a length check ────

test('missingBriefingSections is literal coverage: every section named, fences skipped', () => {
  const draft = '# 计划\n\n## 1. 目标\n\n## 2. 步骤\n\n```\n## fake\n```\n\n## 3. 风险\n'
  // fence 里的 `## fake` 不是小节（C1-6）。
  assert.deepEqual(artifactSections(draft), ['1. 目标', '2. 步骤', '3. 风险'])
  assert.deepEqual(missingBriefingSections(draft, '覆盖章节：1. 目标、2. 步骤、3. 风险'), [])
  // 只缺点一节：再长的正文也补不上（命名反例：长度不是完整性证明）。
  assert.deepEqual(missingBriefingSections(draft, `覆盖章节：1. 目标、2. 步骤\n${'x'.repeat(2000)}`), ['section "3. 风险"'])
  // 产物没有小节 ⇒ 改查三个关键词。
  const flat = '# 脑暴\n- draft'
  assert.deepEqual(missingBriefingSections(flat, '结论 风险 未决'), [])
  assert.deepEqual(missingBriefingSections(flat, '结论 风险'), ['keyword "未决"'])
  assert.deepEqual(missingBriefingSections(flat, ''), ['briefing body is empty', 'keyword "结论"', 'keyword "风险"', 'keyword "未决"'])
})

test('smart_brief refuses without an artifact and throws on incomplete coverage, writing no round', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'coverage' }, session))

  // 产物不存在 ⇒ 抛错（A2 第一档）。
  await assert.rejects(call(tools, 'smart_brief', {}, session), /write brainstorm\.md before briefing it/u)

  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴\n\n## 1. 目标\n\n## 2. 步骤' }, session)
  // 自动 briefing 用的是合规章程；手动那一次把回复换成**缺一节**的（缺哪节必须点名）。
  const { tools: strictTools } = await load({ rootDir }, {
    output: request => (request.prompt[0].text.includes('briefing') ? '覆盖章节：1. 目标\n结论 风险 未决' : '# 产出'),
  })
  await assert.rejects(
    call(strictTools, 'smart_brief', { taskId: begun.taskId }, session),
    /does not cover the artifact.*2\. 步骤/u,
  )
  assert.equal(readState(rootDir, begun.taskId).briefings.brainstorm.current, 1, 'only the complete auto round is recorded')
  // 失败标记要落（A10）：面板要说得出「生成失败」。
  assert.ok(readState(rootDir, begun.taskId).briefings.brainstorm.lastError.includes('2. 步骤'))
})

test('review-child failure returns briefingFailed and keeps the artifact untouched', async t => {
  const rootDir = scratch(t)
  const broken = {
    subagents: {
      start: async () => {
        throw new Error('subagent registry service (`subagents`) is unavailable')
      },
    },
  }
  const { tools } = await load({ rootDir }, broken)
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'seam down' }, session))
  // 自动路径把生成失败转成 briefingFailed（A2 第四档）：产物照常落盘。
  const out = JSON.parse(await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session))
  assert.equal(out.briefingFailed, true)
  assert.equal(readState(rootDir, begun.taskId).artifacts.brainstorm.file, 'brainstorm.md')
  // 手动重试同一条路：也是返回（不是抛）—— 可重试的失败不炸流程。
  const retried = JSON.parse(await call(tools, 'smart_brief', {}, session))
  assert.equal(retried.briefingFailed, true)
  assert.match(retried.nextStep, /retry with smart_brief/u)
})

// ── C1-1 / C1-2: sha binding is about bytes on disk ──────────────────────────

test('a same-length rewrite invalidates the confirmation (stale), and out-of-band edits cannot smuggle an old sha', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nAAAA')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  confirmBriefing(rootDir, id, 'brainstorm', 'confirm', {})
  assert.equal(readState(rootDir, id).awaitingGate, 'G1')

  // C1-1：**同长改写**（AAAA→BBBB，字节数不变）—— 只比 bytes 的实现会以为没变。
  // 走带外改写（模型绕开工具直接写盘），字节数与原文完全一致。
  writeFileSync(join(taskDir(rootDir, id), 'brainstorm.md'), '# 脑暴\nBBBB', 'utf8')
  const gaps = briefingGaps(rootDir, readState(rootDir, id), 'brainstorm')
  assert.deepEqual(gaps, ['briefing round 1 of "brainstorm" is stale — brainstorm.md changed after it was generated'])
  // 门开着但 briefing stale ⇒ 门同样被 A5 四态挡住（过门前的检查）。
  assert.ok(gateGapsBriefing(rootDir, id), 'the open gate must be blocked by the stale briefing too')

  // stale 的轮是重生成的合法起点（A8 允许），新一轮按**新磁盘**算 sha。
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  assert.equal(readState(rootDir, id).briefings.brainstorm.rounds.length, 2)
  // C1-2：再带外改一次 —— 第 2 轮的确认必须被拒（重读磁盘，不信调用方的旧 sha）。
  writeFileSync(join(taskDir(rootDir, id), 'brainstorm.md'), '# 脑暴\nCCCC', 'utf8')
  assert.throws(() => confirmBriefing(rootDir, id, 'brainstorm', 'confirm', { round: 2 }), /stale/u)
  // 非当前轮照旧拒（C1-4 的另一半在这里也有真实场景）。
  assert.throws(() => confirmBriefing(rootDir, id, 'brainstorm', 'confirm', { round: 1 }), /not the current one|already answered/u)
})

test('recordBriefing recomputes the sha from disk, never trusting the caller', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nAAAA')
  // 带外改产物后，按旧内容生成的 round 依然是**新磁盘**的 sha —— 记录时刻重读。
  writeFileSync(join(taskDir(rootDir, id), 'brainstorm.md'), '# 脑暴\nBBBB', 'utf8')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  const round = readState(rootDir, id).briefings.brainstorm.rounds[0]
  assert.equal(typeof round.artifactSha256, 'string')
  assert.notEqual(round.artifactSha256, readState(rootDir, id).artifacts.brainstorm.sha256, 'the artifact changed out of band after landing')
  assert.deepEqual(briefingGaps(rootDir, readState(rootDir, id), 'brainstorm'), ['briefing round 1 of "brainstorm" is not confirmed (answer smart_brief_confirm first)'])
})

// ── C1-3: the round body is re-read from disk ────────────────────────────────

test('a truncated round file is a gap (briefingGaps re-reads the body)', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  const round = readState(rootDir, id).briefings.brainstorm.rounds[0]
  truncateSync(join(taskDir(rootDir, id), round.file), 0)
  assert.deepEqual(briefingGaps(rootDir, readState(rootDir, id), 'brainstorm'), [
    `briefing round 1 of "brainstorm" is empty on disk (${round.file})`,
  ])
  assert.equal(readBriefingRound(rootDir, id, 'brainstorm', 1), '')
})

// ── C1-4: only the current, unanswered round may be answered ─────────────────

test('confirmBriefing rejects non-current rounds and double answers', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nAAAA')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nBBBB')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  // 用户看的是第 1 轮的卡，回答落到第 2 轮上是不允许的。
  assert.throws(() => confirmBriefing(rootDir, id, 'brainstorm', 'confirm', { round: 1 }), /is not the current one/u)
  confirmBriefing(rootDir, id, 'brainstorm', 'confirm', { round: 2 })
  // 二次确认 —— 答过的轮不许再答。
  assert.throws(() => confirmBriefing(rootDir, id, 'brainstorm', 'confirm', { round: 2 }), /already answered/u)
  assert.equal(readState(rootDir, id).awaitingGate, 'G1')
})

// ── C1-7: rework loop — old briefing goes stale, new round + re-confirm ───────

test('a rework rewrite needs a fresh briefing round and a fresh confirmation', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'rework loop' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴\nV1' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  assert.equal(readState(rootDir, begun.taskId).awaitingGate, 'G1')
  reworkTo(rootDir, begun.taskId, 'brainstorm', '方向不对', { maxRework: 5 })

  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴\nV2' }, session)
  const state = readState(rootDir, begun.taskId)
  // 旧轮（V1 的）留着不覆盖（A6），但它 stale —— 新一轮才是确认对象。
  assert.equal(state.briefings.brainstorm.rounds.length, 2)
  assert.equal(briefingGaps(rootDir, state, 'brainstorm').length, 1)
  await call(tools, 'smart_brief_confirm', {}, session)
  assert.equal(readState(rootDir, begun.taskId).awaitingGate, 'G1')
  assert.ok(calls.ask.every(item => item.questions[0].id.startsWith('smart-brief-')))
})

// ── C1-9: executing confirm advances; reviewing confirm opens G5 ─────────────

test('executing confirmation moves the task to review; reviewing confirmation opens G5', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'two gates' }, session))
  const id = begun.taskId
  for (const phase of ['brainstorm', 'design', 'plan', 'acceptance']) {
    await call(tools, 'smart_artifact', { phase, markdown: `# ${phase}` }, session)
    await call(tools, 'smart_brief_confirm', {}, session)
    await call(tools, 'smart_gate', {}, session)
  }
  await call(tools, 'smart_artifact', { phase: 'executing', markdown: '# 执行报告' }, session)
  assert.equal(readState(rootDir, id).phase, 'executing')
  assert.equal(readState(rootDir, id).awaitingGate, null)
  const moved = JSON.parse(await call(tools, 'smart_brief_confirm', {}, session))
  assert.equal(moved.briefingDecision, 'confirm')
  assert.equal(moved.nextPhase, 'reviewing')
  assert.equal(moved.awaitingGate, null)

  await call(tools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收' }, session)
  const opened = JSON.parse(await call(tools, 'smart_brief_confirm', {}, session))
  assert.equal(opened.awaitingGate, 'G5')
})

// ── the briefing speaks to the USER, not to the next model ───────────────────
// （用户判词：「review 模型给的 briefing 组织语言不是面向用户的，仍像面向 brain 模型的
// 语言组织，造成沟通障碍」—— 钉在 prompt 契约上：面向人的语言 + 禁审计腔。）

test('the briefing prompt demands user-facing language and bans audit voice', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir })
  const session = {}
  await call(tools, 'smart_begin', { title: 'voice' }, session)
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  const prompt = calls.start.find(item => item.request.label.startsWith('smart brief')).request.prompt[0].text
  // 读者是用户（人），不是执行模型。
  assert.match(prompt, /The reader is the USER/u)
  assert.match(prompt, /user-facing language/u)
  // 内部行话（条款号/工具名/门名/计数）必须翻译成对决定的意义。
  assert.match(prompt, /Translate artifact-internal shorthand/u)
  // 明令禁止按内部标签组织成清单/审计腔。
  assert.match(prompt, /do NOT write in checklist\/audit voice/u)
  // 判词是 consult 的事，不进 briefing。
  assert.match(prompt, /verdict belongs in the consult record/u)
})

// ── the briefing child runs on the REVIEW route, not the executing route ─────
// （用户判词：「briefing 要用 review 模型出」—— 这条不钉，自动路径哪条路由都行得通。）

test('the briefing is generated on the review route, provenance recorded', async t => {
  const rootDir = scratch(t)
  const REVIEW = { provider: 'llm-mioffice', model: 'xiaomi/mimo-v2.6-pro', reasoningEffort: 'high' }
  const { tools, calls } = await load({ rootDir, reviewRoute: REVIEW })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'review route' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  const briefSpawn = calls.start.find(item => item.request.label.startsWith('smart brief'))
  assert.ok(briefSpawn, 'the briefing child must have been spawned')
  assert.deepEqual(briefSpawn.request.agentOptions, REVIEW, 'the briefing must run on the review route')
  assert.notDeepEqual(briefSpawn.request.agentOptions, HAND, 'not on the executing route')
  const round = readState(rootDir, begun.taskId).briefings.brainstorm.rounds[0]
  assert.equal(round.provider, 'llm-mioffice')
  assert.equal(round.model, 'xiaomi/mimo-v2.6-pro')
  assert.equal(round.source, 'preset')
})

// ── C1-10 / B5: the source is recorded, fallbacks are labelled ───────────────

test('the round records the route source, labelling hand fallbacks honestly', async t => {
  const rootDir = scratch(t)
  // 无 reviewRoute 时回落 handRoute，source 是 hand-fallback —— 记录要如实标注。
  const { tools, calls } = await load({ rootDir })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'source' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  const round = readState(rootDir, begun.taskId).briefings.brainstorm.rounds[0]
  assert.equal(round.source, 'hand-fallback')
  assert.equal(round.provider, 'deepseek')
  assert.equal(round.model, 'flash')
  const status = taskStatus(rootDir, begun.taskId)
  assert.equal(status.briefings.brainstorm.source, 'hand-fallback')
  assert.equal(status.briefings.brainstorm.route, 'deepseek/flash')
  // review 路由自己的 spawn 走的是 review 角色。
  assert.ok(calls.start[0].request.agentOptions)
})

// ── C1-11 / A9: migration — a legacy gate-open task with no briefings ────────

test('a legacy task with an open gate and no briefings is blocked, asks nobody, and recovers via smart_brief', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'legacy' }, session))
  const id = begun.taskId
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  // 造一个迁移态：老版本的门开着、没有 briefings 字段。
  const legacy = readState(rootDir, id)
  delete legacy.briefings
  legacy.awaitingGate = 'G1'
  writeState(rootDir, legacy)

  await assert.rejects(call(tools, 'smart_gate', {}, session), /no gate is open|missing briefing/u)
  assert.equal(calls.ask.length, 0, 'no gate card is put to the user before the briefing is confirmed')
  // 同一代码路径补生成 + 确认 → 门正常开（没有迁移特例）。
  await call(tools, 'smart_brief', {}, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  assert.equal(readState(rootDir, id).awaitingGate, 'G1')
  await call(tools, 'smart_gate', {}, session)
  assert.equal(readState(rootDir, id).phase, 'design')
  assert.equal(calls.ask.length, 2, 'one briefing card + one gate card, nothing else')
})

// ── C1-13: revise closes the gate — no deadlock ──────────────────────────────

test('revise closes the gate so the artifact can be rewritten (no deadlock)', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nV1')
  // 迁移态（review 抓到的死角）：门开着、briefing 未确认 —— A8 之前的写守卫会把改稿
  // 顶死在这里（门开着一律拒），而 confirm 又要求先有 round，死锁。
  const legacy = readState(rootDir, id)
  legacy.awaitingGate = 'G1'
  delete legacy.briefings
  writeState(rootDir, legacy)

  // A8 允许补生成（未确认/无轮）……
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  // ……但用户要改稿：revise 必须关门（A7），否则改稿无路。
  confirmBriefing(rootDir, id, 'brainstorm', 'revise', { round: 1 })
  assert.equal(readState(rootDir, id).awaitingGate, null)
  // 门关了就能改稿 —— revise 的全部意义。
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nV2')
  const after = readState(rootDir, id)
  assert.equal(after.awaitingGate, null)
  // revise 落在它发生的那一轮上（审计）；新稿的轮是后来才有的。
  assert.equal(after.briefings.brainstorm.rounds.at(-1).decision, 'revise')
  // 新稿 → 新一轮 briefing → 确认 → 门再开：revise 不消耗返工额度。
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  const fresh = readState(rootDir, id).briefings.brainstorm.rounds.at(-1)
  assert.equal(fresh.decision, null)
  confirmBriefing(rootDir, id, 'brainstorm', 'confirm', {})
  assert.equal(readState(rootDir, id).awaitingGate, 'G1')
  assert.equal(readState(rootDir, id).reworkCount, 0)
})

// ── C1-14: the freeze guard has two faces ────────────────────────────────────

test('the freeze guard: confirmed+fresh refuses rewrites, unconfirmed/stale allows them', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nV1')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  confirmBriefing(rootDir, id, 'brainstorm', 'confirm', {})
  // 正面：confirmed + fresh + 门开 ⇒ 冻结。
  assert.throws(() => recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nV2'), /waiting on gate G1/u)
  // 反面：stale（带外改写）⇒ 放行，门收起。
  writeFileSync(join(taskDir(rootDir, id), 'brainstorm.md'), '# 脑暴\nV3', 'utf8')
  const rewritten = recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\nV4')
  assert.equal(rewritten.awaitingGate, null)
})

// ── A2 failure marker / A8 regeneration boundary ─────────────────────────────

test('a failure marker lands without a round, and regeneration never clobbers a fresh confirmation', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴')
  recordBriefingFailure(rootDir, id, 'brainstorm', new Error('model timeout'))
  const failed = readState(rootDir, id).briefings.brainstorm
  assert.equal(failed.rounds.length, 0, 'a failure writes no round body')
  assert.equal(briefingStatusOf(failed, readState(rootDir, id).artifacts.brainstorm.sha256), 'failed')
  assert.match(failed.lastError, /model timeout/u)

  // 重生成把失败标记推到过去（strict 时间比较），状态回到正常轨道。
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  confirmBriefing(rootDir, id, 'brainstorm', 'confirm', {})
  // A8：门开着 + 已确认 + fresh ⇒ 不许重生成把用户的确认悄悄清掉。
  assert.throws(
    () => recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' }),
    /confirmed and current/u,
  )
})

// ── A7: open decisions block the confirmation itself ─────────────────────────

test('confirmBriefing re-checks open decisions and refuses', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴\n\n## 需要你裁决（G1）\n1. A 还是 B？\n')
  recordBriefing(rootDir, id, 'brainstorm', { provider: 'stub', model: 'review', source: 'preset', body: '结论 风险 未决' })
  assert.throws(() => confirmBriefing(rootDir, id, 'brainstorm', 'confirm', {}), /unanswered decision/u)
  assert.equal(readState(rootDir, id).awaitingGate, null)
})

// ── the confirm card is where the decision comes from (A4, mutation 3) ───────

test('smart_brief_confirm takes no decision argument: forged confirms change nothing', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir }, {
    userQuestions: {
      ask: async question => {
        calls.ask.push(question)
        // 用户答的是「需要修改」—— 即使调用方试图用参数伪造 confirm。
        return { answers: [{ id: question.questions[0].id, selected: ['需要修改'], custom: '' }] }
      },
    },
  })
  const session = {}
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'forged' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  const out = JSON.parse(await call(tools, 'smart_brief_confirm', { decision: 'confirm', confirm: true }, session))
  assert.equal(out.briefingDecision, 'revise')
  assert.equal(readState(rootDir, begun.taskId).awaitingGate, null, 'a forged confirm must not open the gate')
  // 卡的形状：短、三选项、kind 分派（A4）。
  const card = calls.ask.at(-1).questions[0]
  assert.equal(card.question.length <= 300, true)
  assert.deepEqual(card.options.map(option => option.label), ['确认，进入门禁', '需要修改', '终止任务'])
  assert.equal(card.multi_select, false)
  // 认不出的应答 ⇒ 抛错且不落账（沿用门的教训）。
  await assert.rejects(
    call(tools, 'smart_brief_confirm', {}, session),
    /unrecognised briefing answer|already answered|stale/u,
  )
})

// ── A10 doc check: the stale two-model wording is gone (Chinese legacy hints stay) ──

test('the three-model wording replaced the stale two-model phrasing', async () => {
  const read = async file => (await import('node:fs')).readFileSync(file, 'utf8')
  const indexJs = await read(join(packageRoot, 'tools', 'index.js'))
  // 设计文档（`dsh-fly/docs/smart-mode-design.md`）住在**宿主仓** ⇒ 那条「文档同步」的断言在宿主的
  // `scripts/verify-smart-integration.mjs` 里；本仓只断自己交付的字节。
  // ASCII 串零残留（旧称指路用中文「双模型」，不含这个 ASCII 串）。
  assert.equal(indexJs.includes('two-model'), false, 'index.js still says two-model')
  assert.equal(indexJs.includes('two models'), false, 'index.js still says two models')
  // briefing-first 的纪律写进了系统提示（B6）。
  assert.match(indexJs, /smart_brief_confirm/u)
  assert.match(indexJs, /Discipline \(the tools enforce the mechanical parts/u)
})

// ── taskStatus / nextAction ordering (B3) ────────────────────────────────────

test('nextAction points at the briefing before anything else once an artifact lands', async t => {
  const rootDir = scratch(t)
  const id = seedState(rootDir)
  recordArtifact(rootDir, id, 'brainstorm', '# 脑暴')
  assert.match(taskStatus(rootDir, id).next, /smart_brief_confirm/u)
  // briefing 未确认时，门不为它而开（ask=0 是 C2-2 的证据面）。
  assert.match(taskStatus(rootDir, id).next, /present the briefing|generate the briefing/u)
})
