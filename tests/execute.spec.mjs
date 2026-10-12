/**
 * Contract tests for the S3 half of smart mode: execution, evidence, rework and
 * archive (`smart_execute`, `smart_verify`, `smart_rework`, `smart_finish`).
 *
 * The seams are stubbed; what is asserted is what the tools do around them —
 * namely that execution cannot start before gate G4, that the executor runs on
 * the pinned hand route with the session's capabilities, that evidence gathering
 * is read-only in code, and that archiving cannot paper over an open gate.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readArtifact, readState } from '../lib/state.mjs'
import { BRIEF_CONFIRM, briefingText, GATE_PASS } from './seams.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let loadCount = 0

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-exec-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const HAND = { provider: 'deepseek', model: 'flash' }
const BRAIN = { provider: 'deepseek', model: 'pro' }

/**
 * `subagents.start()` 的**真契约** run 句柄（形状对齐 `dsh-subagent-in-process-driver`）：
 * 产出在 `await run.result` 的 `{ output: blocks, stopReason }` 里，孩子跑完要 `dispose()`
 * 释放。mock 曾返回 `{ output }`（错形状），于是"把整个句柄当结果"的契约 bug 一直测不出来 ——
 * mock 形状必须和上游逐字段对齐，否则绿的是错的契约。
 */
function handRun(text, calls, request) {
  return {
    id: `child-${calls.start.length}`,
    localAgent: undefined,
    result: Promise.resolve({ output: [{ type: 'text', text: typeof text === 'function' ? text(request) : text }], stopReason: 'completed' }),
    dispose: async () => { calls.dispose += 1 },
  }
}

/** Spawns whose label says which tool asked (auto-brief adds extra children). */
const spawnsOf = (calls, prefix) => calls.start.filter(item => item.request.label.startsWith(prefix))

async function load(config, output = '# 手模型产出\n- 步骤 1 ok', extraTools = {}) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: [], dispose: 0, ask: [] }
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition), ...extraTools },
    systemPrompt: { section: () => () => {} },
    commands: { register: () => () => {} },
    get: name => ({
      // briefing prompt ⇒ 完整合规的摘要；其它（execute/verify）⇒ 固定产出。
      subagents: {
        start: async (provider, request) => {
          calls.start.push({ provider, request })
          const text = request.prompt[0].text.includes('briefing')
            ? briefingText(request.prompt[0].text)
            : output
          return handRun(text, calls, request)
        },
      },
      userQuestions: {
        ask: async question => {
          calls.ask.push(question)
          const card = question.questions[0]
          return { answers: [{ id: card.id, selected: [card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : GATE_PASS] }] }
        },
      },
    })[name],
  }
  // 测试里的行 rootDir 是显式声明的「压掉工作区根」（见 state.mjs presetTaskRoot）。
  mod.apply(ctx, { allowGlobalRoot: true, ...config })
  return { tools, calls }
}

const exec = (session = {}) => ({ signal: new AbortController().signal, agent: { session } })
const call = (tools, name, args, session) => tools.get(name).execute(args, exec(session))

/** Write each design artifact, confirm its briefing, pass its gate — 到 `executing`. */
async function approveDesign(tools, session) {
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'exec task', goal: 'make it real' }, session))
  for (const phase of ['brainstorm', 'design', 'plan', 'acceptance']) {
    await call(tools, 'smart_artifact', { phase, markdown: `# ${phase}` }, session)
    await call(tools, 'smart_brief_confirm', {}, session)
    await call(tools, 'smart_gate', {}, session)
  }
  return begun.taskId
}

test('execution cannot start before gate G4', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, handRoute: HAND, brainRoute: BRAIN, requireConsult: false, maxRework: 3 })
  const session = {}
  await call(tools, 'smart_begin', { title: 'early' }, session)
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  await assert.rejects(call(tools, 'smart_execute', {}, session), /execution starts only after gate G4 passes/u)
  assert.equal(spawnsOf(calls, 'smart execute').length, 0)
})

test('smart_execute runs the pinned hand route and records the report', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, handRoute: HAND, brainRoute: BRAIN, requireConsult: false, maxRework: 3 })
  const session = {}
  const taskId = await approveDesign(tools, session)
  assert.equal(readState(rootDir, taskId).phase, 'executing')

  const out = JSON.parse(await call(tools, 'smart_execute', { instructions: '别动 /etc' }, session))
  assert.equal(out.executor, 'deepseek/flash')
  // G2 裁决①：执行报告停在 executing，等 briefing 确认才进 reviewing。
  assert.equal(out.nextPhase, 'executing')

  const started = spawnsOf(calls, 'smart execute').at(-1)
  assert.equal(started.provider, 'spawn')
  assert.deepEqual(started.request.agentOptions, HAND)
  // 执行子代理不该拿到工作流工具（它不能自己把门关了）。
  assert.ok(started.request.toolFilter.deny.includes('smart_gate'))
  // 但它拿到的是"会话同权"的干活能力：白名单里不砍 bash/read/write/edit。
  for (const capability of ['bash', 'read', 'write', 'edit']) {
    assert.ok(!started.request.toolFilter.deny.includes(capability), `${capability} must stay available to the executor`)
  }
  const prompt = started.request.prompt[0].text
  assert.match(prompt, /--- plan\.md ---/u)
  assert.match(prompt, /--- acceptance\.md/u)
  assert.match(prompt, /别动 \/etc/u)
  // 报告落盘 + 自动进验收阶段。正文必须是手模型一字不差的产出（A/B 红点）。
  assert.match(readArtifact(rootDir, taskId, 'executing'), /deepseek\/flash/u)
  assert.match(readArtifact(rootDir, taskId, 'executing'), /- 步骤 1 ok/u)
  assert.equal(calls.dispose, calls.start.length, 'every spawned child must be released after its result')
  assert.equal(readState(rootDir, taskId).phase, 'executing')
  // B3 重入闸：报告已落盘（还在 executing 停站时）就不许重跑 —— 否则第二份报告会覆盖第一份。
  await assert.rejects(call(tools, 'smart_execute', {}, session), /execution report of task .* is already on disk/u)
  // 报告的 briefing 确认后才进验收。
  await call(tools, 'smart_brief_confirm', {}, session)
  assert.equal(readState(rootDir, taskId).phase, 'reviewing')
})

test('evidence gathering is read-only in code and lands as a file', async t => {
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, handRoute: HAND, requireConsult: false, maxRework: 3 }, '# 证据\n- 验收项 A：PASS，`ls -l x`')
  const session = {}
  const taskId = await approveDesign(tools, session)
  await assert.rejects(call(tools, 'smart_verify', {}, session), /evidence is gathered in the review phase/u)

  await call(tools, 'smart_execute', {}, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  const out = JSON.parse(await call(tools, 'smart_verify', { focus: '只看 A' }, session))
  assert.equal(out.verified, true)
  assert.equal(out.verifier, 'deepseek/flash')

  const started = spawnsOf(calls, 'smart verify').at(-1)
  const deny = started.request.toolFilter.deny
  // 取证是代码级只读：写/改被禁掉，工作流工具同样禁掉。
  for (const forbidden of ['write', 'edit', 'smart_artifact', 'smart_gate']) assert.ok(deny.includes(forbidden), `${forbidden} must be denied`)
  assert.ok(!deny.includes('bash'), 'inspecting the world needs the shell')
  assert.match(started.request.prompt[0].text, /只看 A/u)

  const state = readState(rootDir, taskId)
  assert.equal(state.verifications.length, 1)
  assert.equal(state.phase, 'reviewing')
  // 证据是文件，不是一句承诺。
  assert.match(readFileSync(join(rootDir, 'tasks', taskId, state.verifications[0].file), 'utf8'), /PASS/u)
})

test('the read-only list converges to what this deployment actually has', async t => {
  // 只暴露 `subagent_fork` 的部署（本仓闭包就是）：老名单里的 `subagent` /
  // `subagent_codex` / `subagent_claude_code` 不存在，而上游 `tools.restrict()` 对不存在的
  // 名字**直接抛错**，于是 `smart_verify` 在那种部署上第一步就死。收敛后只剩本部署真有的名字。
  const rootDir = scratch(t)
  const known = new Set(['read', 'bash', 'grep', 'write', 'edit', 'subagent_fork', ...['smart_begin', 'smart_artifact', 'smart_consult', 'smart_decide', 'smart_gate', 'smart_execute', 'smart_verify', 'smart_rework', 'smart_finish', 'smart_brief', 'smart_brief_confirm']])
  const { tools, calls } = await load({ rootDir, handRoute: HAND, requireConsult: false, maxRework: 3 }, undefined, { view: () => ({ restrictableNames: known }) })
  const session = {}
  await approveDesign(tools, session)
  await call(tools, 'smart_execute', {}, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_verify', {}, session)

  const deny = spawnsOf(calls, 'smart verify').at(-1).request.toolFilter.deny
  for (const name of deny) assert.ok(known.has(name), `${name} 不在本部署的视图里 —— tools.restrict() 会整条抛错`)
  for (const name of ['subagent', 'subagent_codex', 'subagent_claude_code']) assert.ok(!deny.includes(name), `${name} 本部署没有，不该留在名单里`)
  // 收敛只丢"部署相关的"：必备项（写文件的 + 智能工具面）一个不丢，否则证据面会变成可写。
  for (const name of ['write', 'edit', 'smart_artifact', 'smart_gate']) assert.ok(deny.includes(name), `${name} 是必备项，不许被收敛掉`)
  assert.ok(deny.includes('subagent_fork'), '本部署真有的后端仍然要禁')
})

test('an untrustworthy view falls back to the full list instead of denying nothing', async t => {
  // 视图里连 `write` 都没有 ⇒ 这个视图不可信（不是"本部署没有 write 工具"）⇒ 退回全名单。
  // 反面：若这里收敛成 `deny: []`，证据面就悄悄变成可写了。
  const rootDir = scratch(t)
  const { tools, calls } = await load({ rootDir, handRoute: HAND, requireConsult: false, maxRework: 3 }, undefined, { view: () => ({ restrictableNames: new Set(['bash']) }) })
  const session = {}
  await approveDesign(tools, session)
  await call(tools, 'smart_execute', {}, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_verify', {}, session)

  const deny = spawnsOf(calls, 'smart verify').at(-1).request.toolFilter.deny
  for (const name of ['write', 'edit', 'smart_artifact', 'subagent']) assert.ok(deny.includes(name), `${name} 必须在全名单里`)
})

test('smart_rework archives the superseded artifacts and needs a reason', async t => {
  const rootDir = scratch(t)
  const { tools } = await load({ rootDir, handRoute: HAND, requireConsult: false, maxRework: 1 })
  const session = {}
  const taskId = await approveDesign(tools, session)
  await call(tools, 'smart_execute', {}, session)

  await assert.rejects(call(tools, 'smart_rework', {}, session), /needs a reason/u)
  const out = JSON.parse(await call(tools, 'smart_rework', { reason: '验收不通过：回滚没测', backTo: 'plan' }, session))
  assert.equal(out.reworkCount, 1)
  assert.equal(out.backTo, 'plan')
  const state = readState(rootDir, taskId)
  assert.equal(state.phase, 'plan')
  assert.deepEqual(Object.keys(state.artifacts), ['brainstorm', 'design'])
  // 被否掉的版本进 history，不删 —— 返工的价值就在于能看见否了什么。
  const archived = readdirSync(join(rootDir, 'tasks', taskId, 'history'))
  assert.ok(archived.some(name => name.endsWith('plan.md')))
  await assert.rejects(call(tools, 'smart_rework', { reason: '再来一次' }, session), /used its 1 rework\(s\) into "plan"/u)
})

test('smart_finish only archives a task past G5, promotes the delivery copy, and needs a workspace', async t => {
  const rootDir = scratch(t)
  // 调用会话的工作目录 = 交付副本的落点（session.header.cwd，不是 process.cwd()）。
  const workspace = scratch(t)
  const { tools } = await load({ rootDir, handRoute: HAND, requireConsult: false, maxRework: 3 })
  const session = { header: { cwd: workspace } }
  const taskId = await approveDesign(tools, session)
  await call(tools, 'smart_execute', {}, session)
  await assert.rejects(call(tools, 'smart_finish', { summary: '提前收工' }, session), /only a task past gate G5/u)

  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_verify', {}, session)
  await call(tools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收\n- A 通过' }, session)
  await call(tools, 'smart_brief_confirm', {}, session)
  await call(tools, 'smart_gate', {}, session)
  assert.equal(readState(rootDir, taskId).phase, 'done')

  const out = JSON.parse(await call(tools, 'smart_finish', { summary: '# 收尾\n- 交付：A' }, session))
  assert.equal(out.archived, true)
  assert.match(readFileSync(join(rootDir, 'tasks', taskId, 'summary.md'), 'utf8'), /交付/u)
  // 交付副本落在调用者工作区，且只有交付面那几件（consult/ 与 verify/ 留隐藏树）。
  const delivery = join(workspace, 'docs', 'smart', taskId)
  assert.ok(existsSync(join(delivery, 'README.md')))
  assert.deepEqual(readdirSync(delivery).filter(name => name.endsWith('.md')).sort(), ['README.md', 'acceptance.md', 'brainstorm.md', 'design.md', 'execution-report.md', 'plan.md', 'review.md', 'summary.md'])
  assert.equal(readdirSync(delivery).includes('consult'), false)
  assert.equal(readdirSync(delivery).includes('verify'), false)
  assert.equal(/\/Users\//u.test(readFileSync(join(delivery, 'README.md'), 'utf8')), false, 'README 不许写绝对路径')
  await assert.rejects(call(tools, 'smart_finish', { summary: '再来' }, session), /already archived/u)

  // 工作区取不到 → 大声报错，且绝不静默用 process.cwd() 兜底。
  const bare = scratch(t)
  const { tools: bareTools } = await load({ rootDir: bare, handRoute: HAND, requireConsult: false, maxRework: 3 })
  const bareSession = { header: {} }
  const bareId = await approveDesign(bareTools, bareSession)
  await call(bareTools, 'smart_execute', {}, bareSession)
  await call(bareTools, 'smart_brief_confirm', {}, bareSession)
  await call(bareTools, 'smart_verify', {}, bareSession)
  await call(bareTools, 'smart_artifact', { phase: 'reviewing', markdown: '# 验收' }, bareSession)
  await call(bareTools, 'smart_brief_confirm', {}, bareSession)
  await call(bareTools, 'smart_gate', {}, bareSession)
  await assert.rejects(call(bareTools, 'smart_finish', { summary: '# 收尾' }, bareSession), /无法归档.*header\.cwd|workspace/u)
  assert.equal(readState(bare, bareId).archivedAt, undefined, '提升失败/无工作区时不许标 archived')
  assert.equal(existsSync(join(process.cwd(), 'docs', 'smart', bareId)), false, '禁 process.cwd() 兜底')
})
