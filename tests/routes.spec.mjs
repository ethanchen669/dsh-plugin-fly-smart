/**
 * Contract tests for the route configuration: how the model pair reaches the tools.
 *
 * The pair is edited in the `fly.smart` right-drawer page, whose host row writes a
 * mirror file that this agent-plane plugin reads **lazily, per call**. What is
 * asserted here is everything that makes "saved" and "in effect" the same word:
 *
 *   1. **The three resolvers are orthogonal** — `resolveTaskRoot(session)` (where a
 *      new task goes: preset row → session workspace → legacy), `resolveLegacyRoot()`
 *      (fixed) and `resolveMirrorPath()` (fixed) cannot be derived from each other.
 *      v1 derived the mirror from the task root; with a per-workspace root that
 *      would have split the configuration across workspaces (acceptance.md Y2).
 *   2. **The ladder** — preset row > `sessions[<id>]` > `default` > a loud refusal.
 *   3. **The lazy read** — a mirror written *after* `apply()` is used by the very
 *      next `smart_consult`, with no re-mount (acceptance.md S2b-1, A/B#2).
 *   4. **The guards** — a row `rootDir` without `allowGlobalRoot` is refused, and a
 *      session with no `header.cwd` is loud rather than guessed from `process.cwd()`.
 *
 * Every scratch directory is outside the repo, `HOME` is a scratch home and the
 * mirror is an explicit scratch path (`tests/scratch-home.mjs`), so the developer's
 * real `~/.dsh-fly/` is neither read nor written.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  candidateTaskRoots,
  currentHandRoute,
  isUsableSessionId,
  locateTask,
  parseRouteValue,
  presetTaskRoot,
  readMirrorLayers,
  readRoutesMirror,
  resolveConfig,
  resolveLegacyRoot,
  resolveMirrorPath,
  resolveTaskRoot,
  workspaceTaskRoot,
} from '../lib/state.mjs'
import { SCRATCH_MIRROR } from './scratch-home.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 面板（`dsh-plugin-fly-smart-panel`）与工具**分属两个包、两种布局** ⇒ 按候选解析。 */
function resolvePanelRoutes() {
  const candidates = [
    join(packageRoot, '..', 'dsh-plugin-fly-smart-panel', 'routes.mjs'),                                  // 同仓 packages/ 下（monorepo）
    join(packageRoot, '..', '..', 'dsh-fly', 'packages', 'dsh-plugin-fly-smart-panel', 'routes.mjs'),      // 本包已抽成独立仓，面板仍在 dsh-fly
    ...(process.env.FLY_PLUGINS_DIR === undefined ? [] : [join(process.env.FLY_PLUGINS_DIR, 'dsh-plugin-fly-smart-panel', 'routes.mjs')]),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  // 不软跳过：路由契约是两个平面共用的承重面，找不到就得大声（AGENTS.md §1.2）。
  throw new Error(`找不到面板的 routes.mjs —— 两个平面共用这份路由契约。试过：${candidates.join(' / ')}`)
}
const panelRoutes = await import(pathToFileURL(resolvePanelRoutes()).href)
let loadCount = 0

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-routes-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Write a mirror document (v2, legacy, or deliberately broken). */
function mirror(path, document) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof document === 'string' ? document : `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

/** The v2 document the panel writes for one session. */
function v2({ sessionId = 'session-1', hand = 'openai/gpt-5.1-codex', def = 'deepseek/flash' } = {}) {
  return {
    version: 2,
    ...def === null ? {} : { default: { hand: def, at: '2026-09-30T12:00:00.000Z' } },
    ...hand === null ? {} : { sessions: { [sessionId]: { hand, at: '2026-09-30T12:05:00.000Z' } } },
    ...def === null ? {} : { hand: def },
  }
}

/**
 * `subagents.start()` 的真契约 run 句柄（形状对齐 `dsh-subagent-in-process-driver`）：
 * 产出在 `await run.result` 的 `{ output, stopReason }` 里，孩子跑完要 `dispose()`。
 */
function handRun(text, calls) {
  return {
    id: `child-${calls.start.length}`,
    localAgent: undefined,
    result: Promise.resolve({ output: [{ type: 'text', text }], stopReason: 'completed' }),
    dispose: async () => { calls.dispose += 1 },
  }
}

async function load(config) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'index.js')).href}?t=${++loadCount}`)
  const tools = new Map()
  const calls = { start: [], dispose: 0, ask: [] }
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition) },
    systemPrompt: { section: () => () => {} },
    commands: { register: () => () => {} },
    get: name => ({
      subagents: { start: async (provider, request) => { calls.start.push({ provider, request }); return handRun('# 评审', calls) } },
      userQuestions: { ask: async question => { calls.ask.push(question); return { answers: [{ id: question.questions[0].id, selected: ['通过，进入下一阶段'] }] } } },
    })[name],
  }
  mod.apply(ctx, { allowGlobalRoot: true, ...config })
  return { tools, calls }
}

const exec = (session = {}) => ({ signal: new AbortController().signal, agent: { session } })
const call = (tools, name, args, session) => tools.get(name).execute(args, exec(session))

async function armTask(tools, session) {
  const begun = JSON.parse(await call(tools, 'smart_begin', { title: 'route task' }, session))
  await call(tools, 'smart_artifact', { phase: 'brainstorm', markdown: '# 脑暴' }, session)
  return begun
}

test('parseRouteValue accepts the settings form and the preset shape alike', () => {
  assert.deepEqual(parseRouteValue('deepseek/deepseek-chat'), { provider: 'deepseek', model: 'deepseek-chat' })
  // 思考深度是可选的第三种写法：provider/model@effort。
  assert.deepEqual(parseRouteValue('deepseek/pro@high'), { provider: 'deepseek', model: 'pro', reasoningEffort: 'high' })
  assert.deepEqual(parseRouteValue({ provider: 'a', model: 'b' }), { provider: 'a', model: 'b' })
  // 模型名里带斜杠也要活：只切第一个分隔符。
  assert.deepEqual(parseRouteValue('openai/org/model'), { provider: 'openai', model: 'org/model' })
  for (const bad of ['', '   ', 'no-slash', '/model', 'provider/', undefined, null, 7, [], {}]) {
    assert.equal(parseRouteValue(bad), undefined, `${JSON.stringify(bad)} must not parse into a route`)
  }
})

test('the three resolvers are orthogonal — the mirror is NOT derived from the task root', t => {
  // 纯函数面：三个函数各自只看自己那一份输入。
  assert.equal(resolveLegacyRoot(), join(process.env.HOME, '.dsh-fly', 'smart'))
  assert.equal(resolveMirrorPath(process.env), SCRATCH_MIRROR, 'the env override is the mirror path')
  assert.equal(resolveMirrorPath({}), join(process.env.HOME, '.dsh-fly', 'smart-routes.json'), 'no env → the fixed default')
  assert.equal(resolveMirrorPath({ DSH_FLY_SMART_ROUTES: 'rel/mirror.json' }), resolve('rel/mirror.json'))

  // 工作区根由 session.header.cwd 决定；两个不同的工作区拿到两个任务根……
  const one = workspaceTaskRoot({ header: { cwd: '/tmp/ws-one' } })
  const two = workspaceTaskRoot({ header: { cwd: '/tmp/ws-two' } })
  assert.equal(one.root, join('/tmp/ws-one', '.dsh-fly', 'smart'))
  assert.equal(two.root, join('/tmp/ws-two', '.dsh-fly', 'smart'))
  assert.notEqual(one.root, two.root)
  // ……但镜像路径**不随任务根变化**：这正是 v1 的 bug（两边各算 dirname(rootDir)）。
  assert.equal(resolveMirrorPath({}), resolveMirrorPath({}))
  assert.equal(resolveMirrorPath({}).includes(one.root), false)
  assert.equal(resolveMirrorPath({}).includes(two.root), false)
  // header.cwd 缺失 → 没有工作区（而不是猜一个）。
  assert.equal(workspaceTaskRoot({ header: {} }), null)
  assert.equal(workspaceTaskRoot({}), null)
  assert.equal(workspaceTaskRoot({ header: { cwd: 'relative/path' } }), null, 'a relative cwd is not a workspace')
})

test('the preset row rootDir needs allowGlobalRoot, and it outranks the workspace', () => {
  assert.throws(() => presetTaskRoot({ rootDir: '/tmp/explicit' }), /allowGlobalRoot: true/u)
  assert.deepEqual(presetTaskRoot({ rootDir: '/tmp/explicit', allowGlobalRoot: true }), { root: '/tmp/explicit', source: 'preset' })
  assert.equal(presetTaskRoot({ allowGlobalRoot: true }), null)

  const session = { header: { cwd: '/tmp/ws' } }
  assert.deepEqual(resolveTaskRoot({ config: {}, session }), { root: join('/tmp/ws', '.dsh-fly', 'smart'), source: 'header.cwd' })
  // 判不出工作区 ⇒ **大声报错**，不静默落到全局老根（2026-10-02 定；此前这条断言钉的正是那句
  // 静默回落）。老根只剩"找任务"的读候选；写入口必须显式声明 —— 给会话一个真 cwd，或
  // preset 行 `rootDir` + `allowGlobalRoot`。错误文案要同时说清这两条，否则报错也没法自救。
  assert.throws(
    () => resolveTaskRoot({ config: {}, session: {} }),
    error => error instanceof Error
      && /no workspace/u.test(error.message)
      && /legacy root is read-only/u.test(error.message)
      && /allowGlobalRoot: true/u.test(error.message),
    '判不出工作区时要报错，并说清"老根只读"与显式声明的出路',
  )
  assert.equal(resolveTaskRoot({ config: { rootDir: '/tmp/explicit', allowGlobalRoot: true }, session }).root, '/tmp/explicit')
})

test('the candidate roots put the workspace first, legacy last, and keep the env a read-only candidate', () => {
  const session = { header: { cwd: '/tmp/ws' } }
  const env = { DSH_FLY_SMART_ROOT: '/tmp/from-env' }
  const { roots, primary } = candidateTaskRoots({ config: {}, env, session })
  assert.deepEqual(roots.map(entry => entry.source), ['env', 'header.cwd', 'legacy'])
  assert.equal(primary, '/tmp/from-env')
  // DSH_FLY_SMART_ROOT 只当读候选：写入根仍是工作区（acceptance.md M17）。
  assert.equal(resolveTaskRoot({ config: {}, session }).root, join('/tmp/ws', '.dsh-fly', 'smart'))
  // 没有 session 时工作区不出现，legacy 兜底。
  assert.deepEqual(candidateTaskRoots({ config: {}, env: {}, session: undefined }).roots.map(entry => entry.source), ['legacy'])
})

test('locate finds a task by what is on disk, workspace root winning over legacy', t => {
  const workspace = join(scratch(t), 'ws')
  const legacy = resolveLegacyRoot()
  const id = '20261001-000000-both'
  for (const root of [join(workspace, '.dsh-fly', 'smart'), legacy]) {
    mkdirSync(join(root, 'tasks', id), { recursive: true })
    writeFileSync(join(root, 'tasks', id, 'state.json'), JSON.stringify({ id, phase: 'design' }))
  }
  const candidates = [{ root: join(workspace, '.dsh-fly', 'smart'), source: 'header.cwd' }, { root: legacy, source: 'legacy' }]
  const found = locateTask(id, candidates)
  assert.equal(found.root, join(workspace, '.dsh-fly', 'smart'))
  assert.match(found.note, /exists in 2 roots/u)
  assert.equal(locateTask('nope-not-there', candidates), null)
  // 只有 legacy 有 → 仍然可读（老任务不因为迁移而消失）。
  const onlyLegacy = locateTask(id, [{ root: legacy, source: 'legacy' }])
  assert.equal(onlyLegacy.root, legacy)
})

test('the session-id table: impossible inputs refused, every engine-minted shape accepted', () => {
  const rejected = ['', '..', 'a/b', 'a\\b', `x${String.fromCharCode(0)}y`, 'x'.repeat(201), null, 7, undefined]
  for (const value of rejected) assert.equal(isUsableSessionId(value), false, `must refuse ${JSON.stringify(value)}`)
  const accepted = ['session-3f2a1c88-1f1e-4a1f-9f4d-2a4a1c881f1e', '3f2a1c88-1f1e-4a1f-9f4d-2a4a1c881f1e', 'session-7', 'my-custom-id', 'x'.repeat(200)]
  for (const value of accepted) assert.equal(isUsableSessionId(value), true, `must accept ${JSON.stringify(value)}`)

  // 跨包一致：面板半的校验器必须给出同一张表的结果（两个包各自实现，靠这条对拍）。
  for (const value of [...rejected, ...accepted]) {
    assert.equal(panelRoutes.isValidSessionId(value), isUsableSessionId(value), `panel/agent disagree on ${JSON.stringify(value)}`)
  }
})

test('the mirror and route parsing agree across packages after resolution', t => {
  // 常量相等是恒真的废断言（M16）；要断的是**解析后的路径相等**，包括相对值。
  for (const env of [{}, { DSH_FLY_SMART_ROUTES: SCRATCH_MIRROR }, { DSH_FLY_SMART_ROUTES: 'rel/dir/mirror.json' }, { DSH_FLY_SMART_ROUTES: './x/../y/mirror.json' }]) {
    assert.equal(resolveMirrorPath(env), panelRoutes.resolveMirrorPath(env), `mirror path differs for ${JSON.stringify(env)}`)
  }
  // 锁基目录跟着镜像走，且不在真实 ~/.dsh-fly 里（M1）。
  assert.equal(panelRoutes.mirrorLockPath(SCRATCH_MIRROR), join(dirname(SCRATCH_MIRROR), 'locks', 'smart-routes.json.lock'))
  assert.equal(panelRoutes.mirrorLockPath(SCRATCH_MIRROR).startsWith(dirname(SCRATCH_MIRROR)), true)

  const table = ['deepseek/deepseek-chat', 'deepseek/pro@high', 'openai/org/model', 'no-slash', '/model', 'provider/', '', '  ', 'a/b@', 'a/b@x']
  for (const value of table) {
    assert.deepEqual(panelRoutes.parseRouteString(value), parseRouteValue(value), `parse disagreement on ${JSON.stringify(value)}`)
  }
})

test('the hand route ladder: preset row → session → default → loud refusal', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fly-smart-ladder-')), 'ladder.json')
  mirror(path, v2({ sessionId: 'session-1', hand: 'openai/gpt-5.1-codex', def: 'deepseek/flash' }))

  assert.deepEqual(currentHandRoute({ config: { handRoute: { provider: 'p', model: 'm' } }, session: { id: 'session-1' }, mirrorPath: path }), {
    route: { provider: 'p', model: 'm' }, source: 'preset',
  })
  assert.deepEqual(currentHandRoute({ config: {}, session: { id: 'session-1' }, mirrorPath: path }), {
    route: { provider: 'openai', model: 'gpt-5.1-codex' }, source: 'session',
  })
  assert.deepEqual(currentHandRoute({ config: {}, session: { id: 'session-9' }, mirrorPath: path }), {
    route: { provider: 'deepseek', model: 'flash' }, source: 'default',
  })
  // 空会话对象（整套 spec 到处都是这种 session）→ 落 default，绝不因为"没 id"而抛。
  assert.deepEqual(currentHandRoute({ config: {}, session: {}, mirrorPath: path }), {
    route: { provider: 'deepseek', model: 'flash' }, source: 'default',
  })
  // 非法 session id → 同样落 default（A5 守卫）。
  assert.equal(currentHandRoute({ config: {}, session: { id: '../../etc' }, mirrorPath: path }).source, 'default')

  mirror(path, { version: 2 })
  assert.equal(currentHandRoute({ config: {}, session: {}, mirrorPath: path }), null)
})

test('the legacy v1 mirror still reads (top-level hand/brain), and v2 wins the default layer', t => {
  const path = join(scratch(t), 'legacy.json')
  mirror(path, { brain: 'llm-mioffice/xiaomi/mimo-v2.6-pro', hand: 'llm-mioffice/deepseek/deepseek-flash', at: '2026-09-30T12:58:00.000Z' })
  assert.deepEqual(readRoutesMirror(path), {
    brain: { provider: 'llm-mioffice', model: 'xiaomi/mimo-v2.6-pro' },
    hand: { provider: 'llm-mioffice', model: 'deepseek/deepseek-flash' },
  })
  assert.equal(readMirrorLayers(path).version, 1)

  // v2 的 default 与顶层 legacy 同时存在 → v2 优先。
  mirror(path, { version: 2, default: { hand: 'a/b', at: null }, hand: 'c/d' })
  assert.deepEqual(readMirrorLayers(path).default, { provider: 'a', model: 'b' })

  mirror(path, '{ this is not json')
  assert.deepEqual(readRoutesMirror(path), {})
  assert.equal(readMirrorLayers(path).exists, false)
})

test('the hand route comes from the mirror when the row config has none, and is read lazily', async t => {
  const rootDir = join(scratch(t), 'smart')
  const session = { id: 'session-lazy-1', header: { cwd: scratch(t) } }
  // 第一次：镜像里是 gpt-5.1-codex。
  mirror(SCRATCH_MIRROR, v2({ sessionId: session.id, hand: 'openai/gpt-5.1-codex' }))
  const { tools, calls } = await load({ rootDir, requireConsult: true })
  const begun = await armTask(tools, session)
  await call(tools, 'smart_consult', { question: '能用吗' }, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'openai', model: 'gpt-5.1-codex' })

  // 不重跑 apply()：页面把本会话的路由改成 mimo —— 下一次 consult 必须用新值。
  mirror(SCRATCH_MIRROR, v2({ sessionId: session.id, hand: 'llm-mioffice/xiaomi/mimo-v2.6-pro@high' }))
  await call(tools, 'smart_consult', {}, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'llm-mioffice', model: 'xiaomi/mimo-v2.6-pro', reasoningEffort: 'high' })

  // 再改 default（本会话那一层被清掉）：下一次 consult 跟 default 走，仍然不重挂载。
  mirror(SCRATCH_MIRROR, v2({ sessionId: 'some-other-session', hand: 'openai/x', def: 'deepseek/new-flash' }))
  await call(tools, 'smart_consult', {}, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'deepseek', model: 'new-flash' })

  assert.equal(begun.taskId.length > 0, true)
})

test('the row config outranks the mirror, and neither means a loud refusal', async t => {
  const rootDir = join(scratch(t), 'smart')
  mirror(SCRATCH_MIRROR, v2({ sessionId: 'session-row', hand: 'openai/gpt-5.1-codex' }))
  const { tools, calls } = await load({ rootDir, handRoute: { provider: 'deepseek', model: 'flash' }, requireConsult: true })
  const session = { id: 'session-row' }
  await armTask(tools, session)
  await call(tools, 'smart_consult', {}, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'deepseek', model: 'flash' })

  // 没镜像、没行配置：调用时必须大声说清去哪儿配对，而不是静默用父模型。
  mirror(SCRATCH_MIRROR, { version: 2 })
  const bare = join(scratch(t), 'smart')
  const { tools: bareTools, calls: bareCalls } = await load({ rootDir: bare, requireConsult: true })
  const bareSession = {}
  await armTask(bareTools, bareSession)
  await assert.rejects(call(bareTools, 'smart_consult', {}, bareSession), /no review model is configured/u)
  assert.equal(bareCalls.start.length, 0)

  // 报错文案必须可移植（2026-10-10）：先给**任何 profile 都有**的行配置（reviewRoute），
  // 再提我们的右抽屉 —— 这一行会随"模式包"装进没有 Fly 工作台的官方 profile。镜像绝对路径照给。
  // 为什么点名 review 而不是 hand：本用例 `requireConsult: true`，这次调用要的先就是评审路由
  // （旧文案括号里那句 "no hand model is configured" 曾让这里对着 hand 断言却假绿）。
  await assert.rejects(call(bareTools, 'smart_consult', {}, bareSession), error => {
    assert.match(error.message, /reviewRoute/u, `文案必须先给行配置这条任何 profile 都能走的路：${error.message}`)
    assert.match(error.message, /右抽屉/u)
    assert.ok(
      error.message.indexOf('reviewRoute') < error.message.indexOf('右抽屉'),
      `行配置要排在面板之前（装了别人的 profile 时没有那个抽屉）：${error.message}`,
    )
    assert.ok(error.message.includes(SCRATCH_MIRROR), `the message must name the absolute mirror path: ${error.message}`)
    return true
  })
})

test('a task in the workspace root is written there, and state records where the workspace came from', async t => {
  const workspace = scratch(t)
  const session = { id: 'session-ws', header: { cwd: workspace } }
  const { tools } = await load({})
  const begun = await armTask(tools, session)
  const rootDir = join(workspace, '.dsh-fly', 'smart')
  assert.equal(begun.rootDir, rootDir)
  assert.equal(begun.rootSource, 'header.cwd')
  const state = JSON.parse(readFileSync(join(rootDir, 'tasks', begun.taskId, 'state.json'), 'utf8'))
  assert.equal(state.workspace, workspace)
  assert.equal(state.workspaceSource, 'session.header.cwd')
  // 绝不落进仓库根（process.cwd() 兜底是明令禁止的）。
  assert.equal(existsSync(join(process.cwd(), '.dsh-fly', 'smart', 'tasks', begun.taskId)), false)
  assert.equal(relative(process.cwd(), rootDir).startsWith('..'), true)
})

test('a legacy-only task is readable, continuable and finishable from a workspace session', async t => {
  const workspace = scratch(t)
  const legacyRoot = resolveLegacyRoot()
  const id = '20261001-000000-legacy-only'
  // 造一个"没有 workspace 字段"的老任务：这就是迁移前的真实形状。
  mkdirSync(join(legacyRoot, 'tasks', id), { recursive: true })
  writeFileSync(join(legacyRoot, 'tasks', id, 'state.json'), `${JSON.stringify({
    id,
    title: 'legacy task',
    goal: 'be readable',
    phase: 'done',
    awaitingGate: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    artifacts: { brainstorm: { file: 'brainstorm.md', bytes: 6, at: '2026-10-01T00:00:00.000Z' } },
    consults: {},
    gates: [],
    reworkCount: 0,
    history: [],
  }, null, 2)}\n`, 'utf8')
  writeFileSync(join(legacyRoot, 'tasks', id, 'brainstorm.md'), '# 脑暴\n', 'utf8')

  const session = { id: 'session-legacy', header: { cwd: workspace } }
  const { tools } = await load({})
  const status = JSON.parse(await call(tools, 'smart_status', { taskId: id }, session))
  assert.equal(status.taskId, id)
  assert.equal(status.rootDir, legacyRoot, 'a legacy-only task is read from the legacy root')

  const finished = JSON.parse(await call(tools, 'smart_finish', { taskId: id, summary: '# 收尾（legacy）' }, session))
  assert.equal(finished.archived, true)
  // legacy 任务提升到**调用者**工作区（acceptance.md Y5）。
  assert.equal(existsSync(join(workspace, 'docs', 'smart', id, 'README.md')), true)
  assert.equal(JSON.parse(readFileSync(join(legacyRoot, 'tasks', id, 'state.json'), 'utf8')).workspace, workspace)
})

test('a session with no usable cwd is loud instead of filing into the legacy root', async () => {
  const { tools } = await load({})
  const session = { id: 'session-nocwd', header: {} }
  // 判不出工作区 ⇒ 工具调用**直接报错**（2026-10-02 起；此前是"有意"回退到老根，见本文件
  // 的另一条断言）。三条底线一起断：① 报错，且文案给出显式声明的出路；② 不落老根（那是
  // 跨工作区、无人认领的任务）；③ 绝不落仓库根（`process.cwd()` 兜底是禁的）。
  const error = await call(tools, 'smart_begin', { title: 'no cwd', taskId: 'no-cwd-task' }, session)
    .then(() => null, reason => reason)
  assert.ok(error !== null, '判不出工作区时必须报错，而不是静默回退')
  assert.match(String(error?.message ?? error), /allowGlobalRoot: true/u)
  assert.equal(existsSync(join(resolveLegacyRoot(), 'tasks', 'no-cwd-task')), false, '不该落进老根')
  assert.equal(existsSync(join(process.cwd(), 'tasks', 'no-cwd-task')), false, '不该落进仓库根')
})

test('the resolved row config carries allowGlobalRoot through (no silent workspace override)', () => {
  assert.equal(resolveConfig({}).allowGlobalRoot, false)
  assert.equal(resolveConfig({ allowGlobalRoot: true }).allowGlobalRoot, true)
  assert.throws(() => resolveConfig({ allowGlobalRoot: 'yes' }), /allowGlobalRoot must be a boolean/u)
})
