/**
 * Contract tests for the S2 half of smart mode: the hand-model consult and the
 * user gates (`smart_consult`, `smart_gate`).
 *
 * Both tools reach official capability seams — `subagents` for the review and
 * `userQuestions` for the confirmation — so the interesting assertions are about
 * what the tools do *before* and *after* those seams: the route they pin, the
 * preconditions they refuse on, and what they record. The seams are stubbed, so
 * no LLM and no profile are involved.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readConsult, readState, reworkBudget } from '../lib/state.mjs'
import { BRIEF_CONFIRM, GATE_PASS, reviewReply } from './seams.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let loadCount = 0

/** Scratch root outside the repo. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-gates-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const BRAIN = { provider: 'deepseek', model: 'pro' }
const HAND = { provider: 'deepseek', model: 'flash', reasoningEffort: 'low' }

/**
 * `subagents.start()` 的**真契约** run 句柄（形状对齐 `dsh-subagent-in-process-driver`）：
 * 产出在 `await run.result` 的 `{ output: blocks, stopReason }` 里，孩子跑完要 `dispose()`
 * 释放。mock 曾返回 `{ output }`（错形状），"把整个句柄当结果"的契约 bug 因此一直绿。
 */
function handRun(text, calls) {
  return {
    id: `child-${calls.start.length}`,
    localAgent: undefined,
    result: Promise.resolve({ output: [{ type: 'text', text: typeof text === 'function' ? text(calls.start.at(-1).request) : text }], stopReason: 'completed' }),
    dispose: async () => { calls.dispose += 1 },
  }
}

/** Gate cards only: proof that no gate question was ever put to the user. */
const gateCards = asked => asked.map(item => item.questions?.[0] ?? item).filter(card => card.id.startsWith('smart-gate-'))

/** Briefing confirm cards (the per-artifact short card). */
const briefCards = asked => asked.map(item => item.questions?.[0] ?? item).filter(card => card.id.startsWith('smart-brief-'))

/** Spawns whose label says which tool asked (auto-brief changed the spawn counts). */
const spawnsOf = (calls, prefix) => calls.start.filter(item => item.request.label.startsWith(prefix))

/**
 * An ask stub that answers **by card**（B1）：briefing 卡必答「确认」，门卡答 `label`。
 * 只答一个固定标签的桩在新流程下会把 briefing 确认卡也答成门的答案。
 */
const answer = label => ({
  ask: async question => {
    const card = question.questions[0]
    const picked = card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : label
    return { answers: [{ id: card.id, selected: [picked], custom: '用户备注' }] }
  },
})

/**
 * Apply the plugin with stub capability seams.
 * @returns tools plus the call recorders.
 */
async function load(config, seams = {}) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: [], dispose: 0, ask: [] }
  const services = {
    subagents: seams.subagents === undefined
      ? { start: async (provider, request) => { calls.start.push({ provider, request }); return handRun(reviewReply, calls) } }
      : seams.subagents,
    userQuestions: seams.userQuestions === undefined
      ? {
          ask: async question => {
            calls.ask.push(question)
            const card = question.questions[0]
            return { answers: [{ id: card.id, selected: [card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : GATE_PASS] }] }
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
  // 测试里的行 rootDir 是显式声明的「压掉工作区根」（见 state.mjs presetTaskRoot）。
  mod.apply(ctx, { allowGlobalRoot: true, ...config })
  return { tools, calls }
}

const exec = (session = {}) => ({ signal: new AbortController().signal, agent: { session } })
const call = (tools, name, args, session) => tools.get(name).execute(args, exec(session))

/** begin → artifact → briefing 确认（开门），到「用户站在门前」为止。 */
async function seed(tools, session, phase = 'brainstorm') {
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'gated task', goal: 'ship it' }, session))
  await call(tools, 'smart_artifact', { phase, markdown: `# ${phase}\n- draft` }, session)
  // 缝被拆掉的用例（无路由 / 无 subagents）里自动 briefing 会失败 —— 那些用例要的只是
  // 「产物在盘上」，确认失败照实放过；要开门的用例自己的断言会把它抓出来。
  await call(tools, 'smart_brief_confirm', {}, session).catch(() => {})
  return begun.taskId
}

test('smart_consult pins the hand route and records the review', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, brainRoute: BRAIN, handRoute: HAND })
  const session = {}
  const taskId = await seed(tools, session)

  // 草稿还没写就评审 → 大声拒绝，且不花子代理的钱。
  const bare = await load({ rootDir: scratch(t), handRoute: HAND })
  const bareSession = {}
  await call(bare.tools, 'smart_begin', { title: 'bare' }, bareSession)
  await assert.rejects(call(bare.tools, 'smart_consult', {}, bareSession), /write brainstorm\.md before asking for a review/u)
  assert.equal(bare.calls.start.length, 0)

  const out = JSON.parse(await call(tools, 'smart_consult', { question: '哪里会炸？' }, session))
  assert.equal(out.consulted, 'brainstorm')
  assert.equal(out.reviewer, 'deepseek/flash')

  // 路由钉死：子代理必须用 handRoute，且是自包含的 spawn（执行模型不需要整个设计过程）。
  // 自动 briefing 也在 spawn —— 按 label 挑出 consult 那一次来断（B4：计数断言全移）。
  const consultSpawn = spawnsOf(calls, 'smart consult').at(-1)
  assert.ok(consultSpawn, 'the consult child must have been spawned')
  assert.equal(consultSpawn.provider, 'spawn')
  assert.deepEqual(consultSpawn.request.agentOptions, HAND)
  assert.notDeepEqual(consultSpawn.request.agentOptions, BRAIN)
  const prompt = consultSpawn.request.prompt[0].text
  assert.match(prompt, /# brainstorm/u)
  assert.match(prompt, /哪里会炸？/u)

  const record = readConsult(rootDir, taskId, 'brainstorm')
  assert.equal(record.model, 'flash')
  // 正文必须是手模型一字不差的产出（曾把 run 句柄 JSON 化当正文录进去 —— A/B 的红点）。
  assert.equal(record.body, '手模型评审：缺回滚点。')
  // 孩子跑完必须释放（官方 settleRun 姿势：await result → dispose）—— 每个孩子一次。
  assert.equal(calls.dispose, calls.start.length, 'every spawned child must be released after its result')
})

test('smart_consult refuses without a configured route, naming the field it actually needs', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir })
  const session = {}
  await seed(tools, session)
  // consult 一定会要**评审**路由（它拿 hand 的评审当设计稿的审计，跟 `requireConsult` 无关），
  // 所以第一次拒绝点名 review。hand 自己那条阶梯与拒绝由 routes.spec.mjs 的
  // "the hand route ladder" 单测覆盖，不在这里重复。
  // 2026-10-10 修准：旧文案括号里那句 "(no hand model is configured for legacy …)" 让
  // `/no hand model is configured/` 在 review 路径上**也匹配** —— 那条断言量的是括号，不是行为。
  await assert.rejects(call(tools, 'smart_consult', {}, session), error => {
    assert.match(error.message, /no review model is configured/u)
    assert.match(error.message, /reviewRoute/u, `文案要给出任何 profile 都能走的行配置：${error.message}`)
    return true
  })
  assert.equal(calls.start.length, 0)
})

test('smart_consult fails loudly when the subagent seam is absent', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir, handRoute: HAND }, { drop: ['subagents'] })
  const session = {}
  await seed(tools, session)
  await assert.rejects(call(tools, 'smart_consult', {}, session), /subagent registry service \(`subagents`\) is unavailable/u)
})

test('a gate with unmet preconditions is never put to the user', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, handRoute: HAND, requireConsult: true })
  const session = {}
  await seed(tools, session)

  // requireConsult 开着、评审还没做 → 报错，并且**门卡从没弹过**（briefing 确认卡不算门卡）。
  await assert.rejects(call(tools, 'smart_gate', {}, session), /gate G1 is blocked — missing consult record/u)
  assert.equal(gateCards(calls.ask).length, 0)

  // 评审补上以后才会去问。
  await call(tools, 'smart_consult', {}, session)
  const passed = JSON.parse(await call(tools, 'smart_gate', { summary: '草稿在盘上' }, session))
  assert.equal(gateCards(calls.ask).length, 1)
  assert.equal(passed.decision, 'passed')
  assert.equal(passed.nextPhase, 'design')
  assert.equal(passed.gate, 'G1')
  // 问到的形状是官方 userQuestions.ask 的契约：header 标出 smart 与阶段，
  // options 用 label/description，用户的选择就是门的记录。
  const asked = gateCards(calls.ask).at(-1)
  assert.equal(asked.header, 'smart · brainstorm')
  assert.match(asked.question, /G1/u)
  assert.match(asked.question, /草稿在盘上/u)
  assert.deepEqual(asked.options.map(option => option.label[0]), ['通', '退', '终'])
  assert.equal(asked.multi_select, false)
  assert.equal(calls.ask.at(-1).signal.aborted, false)

  const state = readState(rootDir, passed.taskId)
  assert.equal(state.phase, 'design')
  assert.equal(state.gates.length, 1)
  assert.match(state.gates[0].note, /通过/u)
})

test('gate answers drive pass / rework / cancel, and unknown answers change nothing', async t => {
  // ── 退回：产物进 history，阶段回退，reworkCount 加一
  {
    const rootDir = scratch(t)
    const { tools } = await load({ rootDir, handRoute: HAND, requireConsult: false }, { userQuestions: answer('退回本阶段重做') })
    const session = {}
    const taskId = await seed(tools, session)
    const out = JSON.parse(await call(tools, 'smart_gate', {}, session))
    assert.equal(out.decision, 'rework')
    assert.equal(out.backTo, 'brainstorm')
    assert.equal(out.reworkCount, 1)
    const state = readState(rootDir, taskId)
    assert.equal(state.phase, 'brainstorm')
    assert.deepEqual(Object.keys(state.artifacts), [])
    assert.equal(readdirSync(join(rootDir, 'tasks', taskId, 'history')).length, 1)
    // 历史里留着被否掉的版本 —— 返工的意义就是能看见被否了什么。
    assert.deepEqual(state.history.map(entry => entry.to), ['brainstorm'])
  }

  // ── 终止
  {
    const rootDir = scratch(t)
    const { tools } = await load({ rootDir, handRoute: HAND, requireConsult: false }, { userQuestions: answer('终止任务') })
    const session = {}
    const taskId = await seed(tools, session)
    const out = JSON.parse(await call(tools, 'smart_gate', {}, session))
    assert.equal(out.decision, 'cancelled')
    assert.equal(readState(rootDir, taskId).phase, 'cancelled')
  }

  // ── 认不出的答案：不许"看起来过门了"
  {
    const rootDir = scratch(t)
    const { tools } = await load({ rootDir, handRoute: HAND, requireConsult: false }, { userQuestions: answer('随便写点什么') })
    const session = {}
    const taskId = await seed(tools, session)
    await assert.rejects(call(tools, 'smart_gate', {}, session), /unrecognised gate answer/u)
    const state = readState(rootDir, taskId)
    assert.equal(state.phase, 'brainstorm')
    assert.equal(state.awaitingGate, 'G1')
    assert.deepEqual(state.gates, [])
  }
})

test('the rework budget is per phase, and running out asks the user instead of forcing a finish', async t => {
  const rootDir = scratch(t)
  const asked = []
  const { tools } = await load({ rootDir, handRoute: HAND, requireConsult: false, maxRework: 1 }, {
    // 用户就点门上「退回」那一项：第一轮是普通退回，额度耗尽后同一位子换成加额版 —— 两种
    // 走法都要能过，这正是"额度归零 ≠ 强制收尾"的可执行判据。
    userQuestions: {
      ask: async question => {
        const card = question.questions[0]
        asked.push(card)
        const label = card.id.startsWith('smart-brief-')
          ? BRIEF_CONFIRM
          : card.options.map(option => option.label).find(text => text.startsWith('退回'))
        return { answers: [{ id: card.id, selected: [label] }] }
      },
    },
  })
  const session = {}
  const taskId = await seed(tools, session)

  // 第一轮：额度 1，用掉之后计数与额度都该动（没有加额记录）。
  const first = JSON.parse(await call(tools, 'smart_gate', {}, session))
  assert.equal(first.decision, 'rework')
  assert.equal(first.grantedAnotherBudget, null)
  let state = readState(rootDir, taskId)
  assert.equal(state.reworkCount, 1)
  assert.deepEqual(state.reworkGrants, [])
  assert.deepEqual(reworkBudget(state, 'brainstorm', 1), { phase: 'brainstorm', used: 1, cap: 1, grants: 0, maxRework: 1 })

  // 第二轮：额度已尽 —— 卡上**照样有一项能退回**，且写明这是加额。
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 第二次重做' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  const second = JSON.parse(await call(tools, 'smart_gate', {}, session))
  const card = asked.at(-1)
  assert.match(card.question, /返工额度已用尽（1\/1）/u)
  const reworkOption = card.options.find(option => option.label.startsWith('退回'))
  assert.match(reworkOption.label, /额度已用尽 1\/1/u)
  assert.match(reworkOption.label, /同意再加 1 次/u)
  assert.equal(second.decision, 'rework')
  assert.equal(second.grantedAnotherBudget, 1)
  state = readState(rootDir, taskId)
  assert.equal(state.reworkCount, 2)
  assert.equal(state.reworkGrants.length, 1)
  assert.equal(state.reworkGrants[0].by, 'user')
  assert.equal(state.reworkGrants[0].phase, 'brainstorm')
  // 加额买到的是"再一个预算"，不是"无限"：cap 翻倍，第二轮用掉后同样超额。
  assert.deepEqual(reworkBudget(state, 'brainstorm', 1), { phase: 'brainstorm', used: 2, cap: 2, grants: 1, maxRework: 1 })

  // 每阶段各算各的：脑暴烧光两轮，设计阶段一分没动（这正是"整任务总预算"的老毛病）。
  assert.equal(reworkBudget(state, 'design', 1).used, 0)
  assert.equal(reworkBudget(state, 'design', 1).cap, 1)

  // 模型自己那条路（smart_rework）到顶照样断，而且要说清"该找谁"。
  await assert.rejects(
    call(tools, 'smart_rework', { backTo: 'brainstorm', reason: '我自己想再改一轮' }, session),
    /used its 2 rework\(s\) into "brainstorm".*the user decides at the gate/u,
  )
})

test('at G5 the acceptance-failure option returns to the plan (it used to throw "unrecognised")', async t => {
  const rootDir = scratch(t)
  // 一路通过到 G5，然后在终门上选「验收不通过，退回计划（plan）重做」—— 这一项从 S2 起就在卡上，
  // 但应答分支按「退回」前缀匹配，它不以「退回」开头，于是用户一点就抛 unrecognised。
  const asked = []
  const { tools } = await load({ rootDir, handRoute: HAND, brainRoute: BRAIN, requireConsult: false }, {
    userQuestions: {
      ask: async question => {
        const card = question.questions[0]
        asked.push(card)
        const label = card.id === 'smart-gate-G5'
          ? card.options.map(option => option.label).find(text => text.startsWith('验收不通过'))
          : card.options[0].label
        return { answers: [{ id: card.id, selected: [label] }] }
      },
    },
  })
  const session = {}
  const taskId = await seed(tools, session)
  // 阶段顺序写产物（照 full design walk 的走法）：G1→design … G4→executing，再验收 → G5。
  // 每个产物落盘后都要确认 briefing 才开得了门（自动 briefing 的卡也进 asked）。
  for (const next of ['design', 'plan', 'acceptance']) {
    await call(tools, 'smart_gate', {}, session)
    await call(tools, 'smart_artifact', { phase: next, markdown: `# ${next}` }, session)
    await call(tools, 'smart_brief_confirm', {}, session)
  }
  await call(tools, 'smart_gate', {}, session)
  await call(tools, 'smart_artifact', { phase: 'executing', markdown: '# 执行报告' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)

  const out = JSON.parse(await call(tools, 'smart_gate', {}, session))
  const g5 = asked.find(card => card.id === 'smart-gate-G5')
  assert.ok(g5, 'G5 必须真的问过用户')
  assert.match(g5.options.map(option => option.label).find(text => text.startsWith('验收不通过')), /^验收不通过，退回计划（plan）重做$/u)
  assert.equal(out.decision, 'rework')
  assert.equal(out.backTo, 'plan')
  assert.equal(out.phase, 'plan')
  const state = readState(rootDir, taskId)
  assert.equal(state.phase, 'plan')
  assert.equal(state.awaitingGate, null)
  assert.equal(state.history.at(-1).to, 'plan')
  // 验收产物进了 history（不删），plan 及其后的产物被撤下重做。
  assert.ok(state.history.at(-1).archived.includes('reviewing'))
})

test('the full design walk passes four gates and hands over to execution', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, handRoute: HAND, brainRoute: BRAIN })
  const session = {}
  await seed(tools, session)
  const phases = []
  for (let index = 0; index < 4; index += 1) {
    await call(tools, 'smart_consult', {}, session)
    const out = JSON.parse(await call(tools, 'smart_gate', {}, session))
    phases.push(out.nextPhase)
    if (index < 3) {
      await call(tools, 'smart_artifact', { phase: phases.at(-1), markdown: `# ${phases.at(-1)}` }, session)
      await call(tools, 'smart_brief_confirm', {}, session)
    }
  }
  assert.deepEqual(phases, ['design', 'plan', 'acceptance', 'executing'])
  // 计数按卡/按 spawn 的**种类**数（B4）：4 张门卡 + 4 次 consult spawn，另有每产物一张
  // briefing 确认卡与一次自动 briefing spawn。
  assert.equal(gateCards(calls.ask).length, 4)
  assert.equal(spawnsOf(calls, 'smart consult').length, 4)

  // 执行报告 → 验收 → G5（G5 不需要 consult），最后归档。
  await call(tools, 'smart_artifact', { phase: 'executing', markdown: '# 执行报告' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  const done = JSON.parse(await call(tools, 'smart_gate', {}, session))
  assert.equal(done.nextPhase, 'done')
  assert.equal(gateCards(calls.ask).length, 5)
  assert.equal(readState(rootDir, done.taskId).phase, 'done')
})
