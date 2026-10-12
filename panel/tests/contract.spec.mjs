/**
 * Contract tests for the Fly smart workbench.
 *
 * The workbench has three contracts worth pinning, and they fail differently:
 *
 *   1. **The route/status table.** This is a read-only page over a directory the
 *      user owns, so "no data yet" (503 + the absolute path) must never look like
 *      "here are zero tasks" (200), and a task id must never reach a path join:
 *      400 for the id shape, 404 for an unknown id, 400 again for `..`.
 *   2. **The on-disk reader.** The phase → file map, the consult merge, the
 *      evidence merge and the route-drift comparison are pure functions over
 *      fixtures, so they can be pinned without a browser.
 *   3. **The built bundle.** It must load through the real module-loader contract,
 *      seat `fly.smart` in the drawer registry (order 40, after the four existing
 *      workbenches) and add no stylesheet of its own — presentation stays in the
 *      shell skin.
 *
 * Run: node --test panel/tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// 面板已并入 dsh-plugin-fly-smart：清单在**包根**，不再有面板自己的 package.json。
const manifest = JSON.parse(readFileSync(join(packageRoot, '..', 'package.json'), 'utf8'))
const HOST_ENTRY = join(packageRoot, '..', 'index.js')
const READER = join(packageRoot, 'reader.js')
const BUNDLE = join(packageRoot, '..', 'lib', 'client.js')

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const {
  Config,
  ENDPOINTS,
  answerSmartRequest,
  locateTask,
  mergeRowRoutes,
  readRoutesConfig,
  resolveRoots,
  resolveRootDir,
  writeRoutesConfig,
} = await import(pathToFileURL(HOST_ENTRY).href)
const reader = await import(pathToFileURL(READER).href)
const { readIndex, readTask } = reader
const { SCRATCH_MIRROR, REAL_MIRROR, REAL_MIRROR_BYTES } = await import('./scratch-home.mjs')

const FIXTURE_ID = '20260928-120000-smart-panel'
const HAND_ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }
/** Deliberately not the hand route: this is what the red warning exists for. */
const EXECUTED_ROUTE = { provider: 'openai', model: 'gpt-5.1-codex' }

/** A scratch smart root **outside the repo**, planted with one realistic task. */
function plantRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fly-smart-panel-fixture-'))
  const dir = join(root, 'tasks', FIXTURE_ID)
  for (const sub of ['consult', 'verify', 'history']) mkdirSync(join(dir, sub), { recursive: true })

  const artifacts = {
    'brainstorm.md': '# 脑暴\n\n目标与边界。\n',
    'design.md': '# 设计\n\n方案对比。\n',
    'plan.md': '# 计划\n\n1. 建包\n2. 接通路由\n',
    'acceptance.md': '# 验收设计\n\n- A1 面板能开出\n',
    'execution-report.md': `# 执行报告\n\n> 执行模型：${EXECUTED_ROUTE.provider}/${EXECUTED_ROUTE.model}\n\n全部步骤完成。\n`,
    'review.md': '# 评审\n\n结论：通过。\n',
  }
  for (const [file, text] of Object.entries(artifacts)) writeFileSync(join(dir, file), text, 'utf8')
  writeFileSync(join(dir, 'summary.md'), '# 收尾\n\n已交付。\n', 'utf8')

  const at = '2026-09-28T12:00:00.000Z'
  writeFileSync(join(dir, 'consult', 'brainstorm.json'), `${JSON.stringify({
    phase: 'brainstorm',
    at,
    provider: HAND_ROUTE.provider,
    model: HAND_ROUTE.model,
    question: '这个方向可行吗？',
    body: '可行，但先钉住数据源。',
  }, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'verify', '2026-09-28T13-00-00-000Z.md'), '# 证据\n\n- A1 通过：面板开出\n', 'utf8')
  writeFileSync(join(dir, 'history', '2026-09-28T12-30-00-000Z-plan.md'), '# 计划（旧版）\n', 'utf8')

  writeFileSync(join(dir, 'state.json'), `${JSON.stringify({
    id: FIXTURE_ID,
    title: 'smart 工作台页',
    goal: '把 smart 的磁盘事实画成右抽屉页',
    phase: 'reviewing',
    awaitingGate: 'G5',
    createdAt: at,
    updatedAt: '2026-09-28T13:00:00.000Z',
    artifacts: Object.fromEntries([
      ['brainstorm', { file: 'brainstorm.md', bytes: 20, at }],
      ['design', { file: 'design.md', bytes: 20, at }],
      ['plan', { file: 'plan.md', bytes: 20, at }],
      ['acceptance', { file: 'acceptance.md', bytes: 20, at }],
      ['executing', { file: 'execution-report.md', bytes: 60, at }],
      ['reviewing', { file: 'review.md', bytes: 20, at }],
    ]),
    consults: {
      brainstorm: { at, provider: HAND_ROUTE.provider, model: HAND_ROUTE.model, question: '这个方向可行吗？', file: 'consult/brainstorm.json' },
    },
    verifications: [{ at: '2026-09-28T13:00:00.000Z', file: 'verify/2026-09-28T13-00-00-000Z.md', provider: HAND_ROUTE.provider, model: HAND_ROUTE.model, acceptance: 'A1' }],
    gates: [
      { gate: 'G1', at, by: 'user', note: '同意' },
      { gate: 'G2', at, by: 'user', note: '同意' },
      { gate: 'G3', at, by: 'user', note: '同意' },
      { gate: 'G4', at, by: 'user', note: '可以执行' },
    ],
    reworkCount: 1,
    history: [{ at: '2026-09-28T12:30:00.000Z', from: 'plan', to: 'plan', reason: '计划漏了路由', archived: ['plan.md'] }],
  }, null, 2)}\n`, 'utf8')

  writeFileSync(join(root, 'index.json'), `${JSON.stringify({
    tasks: [{ id: FIXTURE_ID, title: 'smart 工作台页', phase: 'reviewing', awaitingGate: 'G5', updatedAt: '2026-09-28T13:00:00.000Z' }],
  }, null, 2)}\n`, 'utf8')
  return root
}

/** Minimal `ServerResponse`: status, headers, body. */
function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(text) { this.body = typeof text === 'string' ? text : '' },
  }
}

/**
 * A request the handler accepts: a real `Readable`, so POST bodies travel the same
 * `readBody()` path the carrier uses.
 */
function fakeRequest({ method = 'GET', url = '/fly/smart', headers = {}, body = null } = {}) {
  const req = new Readable({ read() {} })
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:1', ...headers }
  if (body !== null) {
    req.headers['content-length'] = String(Buffer.byteLength(body))
    req.push(body)
  }
  setImmediate(() => req.push(null))
  return req
}

/**
 * The handler's capabilities, exactly as `apply()` composes them.
 *
 * `root` goes in through the row config, which is the **explicit root** case
 * (verification / headless): the workbench lists that root and does not pretend to
 * know which workspace is asking.
 */
function makeDeps({ root, env = {}, sessionId = null, sessions = undefined, mirrorPath = SCRATCH_MIRROR, rowHand = '', write = true } = {}) {
  const rootsOf = sid => resolveRoots({ rawConfig: root === null ? {} : { rootDir: root }, env, sessionId: sid, sessions })
  return {
    roots: rootsOf,
    readRoutes: sid => readRoutesConfig({ mirrorPath, rowHand, sessionId: sid }),
    ...write ? { writeRoutes: ({ hand, scope, sessionId: sid }) => writeRoutesConfig({ mirrorPath, rowHand, hand, scope, sessionId: sid }) } : {},
    locate: (id, sid) => locateTask(id, rootsOf(sid).candidates),
    readIndex,
    readTask,
    log: () => undefined,
  }
}

/** Drive the exported handler exactly as the carrier does. */
async function call(deps, url, options = {}) {
  const res = fakeResponse()
  await answerSmartRequest(deps, fakeRequest({ url, ...options }), res)
  let json = null
  try {
    json = res.body === '' ? null : JSON.parse(res.body)
  } catch {
    json = null
  }
  return { status: res.status, headers: res.headers, body: res.body, json }
}

test('the manifest ships each file individually and declares a Loader row', () => {
  // 合并后**刻意不声明 exports**：bundle patch 的行名要用包内子路径
  // （`dsh-plugin-fly-smart/panel/index.js`），exports 映射会把它挡住。
  assert.equal(manifest.exports, undefined, 'exports 会挡住子路径行名')
  // A bare directory in `files` silently drops the contract for `pack:tar`.
  for (const entry of ['index.js', 'lib/state.mjs', 'lib/client.js', 'panel', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(entry), `files 少了 ${entry}`)
  }
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  const patch = readFileSync(join(packageRoot, '..', manifest.dsh.bundle.patch), 'utf8')
  assert.match(patch, /id: fly-smart-panel/u)
  assert.equal(patch.match(/^ {4}- id:/gmu)?.length, 1)
})

test('the host row claims the /fly/smart namespace and publishes its service', async () => {
  const root = plantRoot()
  try {
    const host = await import(pathToFileURL(HOST_ENTRY).href)
    assert.equal(host.name, 'fly-smart-panel')
    assert.deepEqual(host.inject, ['webServer'])

    const registered = []
    const provided = []
    host.apply({
      provide: (serviceName, value) => provided.push([serviceName, value]),
      effect: callback => callback(),
      webServer: { register: options => { registered.push(options); return () => {} } },
    }, { rootDir: root })

    assert.equal(registered.length, 1)
    assert.equal(registered[0].kind, 'prefix')
    assert.equal(registered[0].path, '/fly/smart')
    assert.equal(typeof registered[0].handler, 'function')
    assert.equal(provided.length, 1)
    assert.equal(provided[0][0], 'flySmartPanel')
    assert.equal(provided[0][1].rootDir, root)
    assert.equal(provided[0][1].task(FIXTURE_ID).state.phase, 'reviewing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the root endpoint self-describes and the auth-free table matches the handler', async () => {
  const root = plantRoot()
  try {
    const deps = makeDeps({ root })
    const res = await call(deps, '/fly/smart')
    assert.equal(res.status, 200)
    assert.equal(res.json.plugin, 'fly-smart-panel')
    assert.equal(res.json.root, root)
    assert.equal(res.json.exists, true)
    assert.equal(res.json.message, undefined, 'a root that exists carries no missing-root hint')
    // 自描述表必须带上这次新增的配置端点，否则「自描述」是在描述另一个产品（S1 条 5）。
    assert.deepEqual(res.json.endpoints.map(entry => entry.path), ['/fly/smart/tasks', '/fly/smart/task?id=<id>', '/fly/smart/routes'])
    assert.equal(res.json.endpoints.some(entry => entry.path.includes('artifact')), false, '/fly/smart/artifact 端点不存在，不许写进表里')
    assert.deepEqual(res.json.routeConfig, res.json.routes, 'routeConfig 与 GET /routes 是同一份（首屏省一次请求）')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the root endpoint is the page’s 200-only capability probe', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'fly-smart-probe-')), 'not-created-yet')
  try {
    const res = await call(makeDeps({ root: missing }), '/fly/smart')
    // Always a 200: the browser logs every non-2xx fetch, and "no smart tasks yet"
    // must not read as a fault. The data routes keep their 503.
    assert.equal(res.status, 200)
    assert.equal(res.json.exists, false)
    assert.match(res.json.message, /smart 任务目录不存在/u)
    assert.match(res.json.message, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))

    const tasks = await call(makeDeps({ root: missing }), '/fly/smart/tasks')
    assert.equal(tasks.status, 503)
    assert.equal(tasks.json.error, res.json.message, 'the page shows the host’s own sentence, not a paraphrase')
  } finally {
    rmSync(dirname(missing), { recursive: true, force: true })
  }
})

test('a missing root is 503 — never an empty 200 — and the body names the absolute path', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'fly-smart-absent-')), 'not-created-yet')
  const deps = makeDeps({ root: missing })
  try {
    const tasks = await call(deps, '/fly/smart/tasks')
    assert.equal(tasks.status, 503, 'no capability must not look like no data')
    assert.match(tasks.json.error, /smart 任务目录不存在/u)
    assert.match(tasks.json.error, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.match(tasks.json.error, /\/smart <任务>/u)

    const task = await call(deps, `/fly/smart/task?id=${FIXTURE_ID}`)
    assert.equal(task.status, 503)
    assert.equal(task.headers['cache-control'], 'no-store')
  } finally {
    rmSync(dirname(missing), { recursive: true, force: true })
  }
})

test('a task id outside the pattern is refused before any path is built', async () => {
  const root = plantRoot()
  const deps = makeDeps({ root })
  try {
    for (const id of ['../etc/passwd', '..', 'a/b', '', 'has space', 'sneaky%2f']) {
      const res = await call(deps, `/fly/smart/task?id=${encodeURIComponent(id)}`)
      assert.equal(res.status, 400, `id ${JSON.stringify(id)} must be refused`)
      assert.match(res.json.error, /invalid task id/u)
    }
    const absent = await call(deps, '/fly/smart/task')
    assert.equal(absent.status, 400, 'a missing id is a malformed request, not an unknown task')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unknown id is 404 and an unknown endpoint is 404, both with JSON', async () => {
  const root = plantRoot()
  const deps = makeDeps({ root })
  try {
    const unknownTask = await call(deps, '/fly/smart/task?id=20260101-000000-nope')
    assert.equal(unknownTask.status, 404)
    assert.match(unknownTask.json.error, /no such task/u)

    const unknownRoute = await call(deps, '/fly/smart/everything')
    assert.equal(unknownRoute.status, 404)
    assert.match(unknownRoute.json.error, /unknown smart endpoint/u)

    const wrongMethod = await call(deps, '/fly/smart/tasks', { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.allow, 'GET, HEAD')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the task payload carries the board, the six artifacts, the gates and the route drift', async () => {
  const root = plantRoot()
  const deps = makeDeps({ root })
  try {
    const index = await call(deps, '/fly/smart/tasks')
    assert.equal(index.status, 200)
    assert.equal(index.json.root, root)
    assert.equal(index.json.source, 'index.json')
    assert.deepEqual(index.json.tasks.map(row => row.id), [FIXTURE_ID])
    assert.equal(index.json.tasks[0].awaitingGate, 'G5')

    const res = await call(deps, `/fly/smart/task?id=${FIXTURE_ID}`)
    assert.equal(res.status, 200)
    assert.equal(res.json.state.phase, 'reviewing')
    assert.equal(res.json.state.reworkCount, 1)
    assert.deepEqual(Object.keys(res.json.artifacts).sort(), ['acceptance', 'brainstorm', 'design', 'executing', 'plan', 'reviewing'])
    assert.match(res.json.artifacts.plan.markdown, /^# 计划/mu)
    assert.equal(res.json.artifacts['execution-report'], undefined, 'phase keys, not file names')
    assert.equal(res.json.summary.file, 'summary.md')

    assert.deepEqual(res.json.consults.map(record => record.phase), ['brainstorm'])
    assert.equal(res.json.consults[0].provider, HAND_ROUTE.provider)
    assert.equal(res.json.consults[0].model, HAND_ROUTE.model)
    assert.match(res.json.consults[0].body, /可行/u)

    assert.deepEqual(res.json.verifications.map(row => row.file), ['verify/2026-09-28T13-00-00-000Z.md'])
    assert.equal(res.json.verifications[0].acceptance, 'A1')
    assert.equal(res.json.verifications[0].missing, false)

    assert.deepEqual(res.json.gates.map(gate => gate.gate), ['G1', 'G2', 'G3', 'G4'])
    assert.deepEqual(res.json.history.map(entry => entry.file), ['history/2026-09-28T12-30-00-000Z-plan.md'])

    // The whole point of the panel's warning: the executed route is not the hand route.
    assert.deepEqual(res.json.routes.hand, [`${HAND_ROUTE.provider}/${HAND_ROUTE.model}`])
    assert.equal(res.json.routes.executed, `${EXECUTED_ROUTE.provider}/${EXECUTED_ROUTE.model}`)
    assert.equal(res.json.routes.drifted, true)
    assert.match(res.json.routes.execution.line, /^> 执行模型：/u)

    // briefing 格（acceptance A10）：夹具没有 briefings 字段 ⇒ 每阶段照实报 none（不是抛错）。
    assert.deepEqual(Object.keys(res.json.briefings).sort(), ['acceptance', 'brainstorm', 'design', 'executing', 'plan', 'reviewing'])
    assert.equal(res.json.briefings.reviewing.status, 'none')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the briefing cell derives its status from disk (stale when the artifact moved)', async () => {
  const root = plantRoot()
  const deps = makeDeps({ root })
  try {
    // 种一轮 briefing：绑定 reviewing 的 sha，先确认（confirmed）。
    const { createHash } = await import('node:crypto')
    const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(root, 'tasks', FIXTURE_ID)
    const sha = createHash('sha256').update(readFileSync(join(dir, 'review.md'))).digest('hex')
    const stateFile = join(dir, 'state.json')
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    state.briefings = {
      reviewing: {
        rounds: [{
          n: 1,
          at: '2026-09-28T13:05:00.000Z',
          file: 'briefings/reviewing-1.md',
          provider: 'llm-mioffice',
          model: 'xiaomi/mimo-v2.6-pro',
          source: 'default',
          artifactSha256: sha,
          decision: 'confirm',
          confirmedAt: '2026-09-28T13:06:00.000Z',
        }],
        current: 1,
        status: 'confirmed',
      },
    }
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    mkdirSync(join(dir, 'briefings'), { recursive: true })
    writeFileSync(join(dir, 'briefings', 'reviewing-1.md'), '结论：通过。风险：无。未决：无。\n', 'utf8')

    let res = await call(deps, `/fly/smart/task?id=${FIXTURE_ID}`)
    assert.equal(res.json.briefings.reviewing.status, 'confirmed')
    assert.equal(res.json.briefings.reviewing.route, 'llm-mioffice/xiaomi/mimo-v2.6-pro')
    assert.equal(res.json.briefings.reviewing.source, 'default')

    // 带外改产物 ⇒ 派生出 stale（reader 重读磁盘算 sha，不认记忆里的 status）。
    writeFileSync(join(dir, 'review.md'), '# 验收\n- 改了一个字\n', 'utf8')
    res = await call(deps, `/fly/smart/task?id=${FIXTURE_ID}`)
    assert.equal(res.json.briefings.reviewing.status, 'stale')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the reader refuses traversal ids and reports drift only when both routes are known', () => {
  for (const id of ['../etc', '..', 'a/b', '', 'a b', null, 7]) {
    assert.equal(reader.isSafeTaskId(id), false, `id ${JSON.stringify(id)}`)
  }
  assert.equal(reader.isSafeTaskId(FIXTURE_ID), true)

  assert.deepEqual(reader.parseExecutionRoute('> 执行模型：deepseek/deepseek-chat\n'), {
    provider: 'deepseek', model: 'deepseek-chat', line: '> 执行模型：deepseek/deepseek-chat',
  })
  assert.equal(reader.parseExecutionRoute('# 没有路由行的报告\n'), null)
  assert.equal(reader.parseExecutionRoute(undefined), null)

  const consults = [{ phase: 'plan', provider: 'deepseek', model: 'deepseek-chat' }]
  const same = reader.routeReport({ executing: { markdown: '> 执行模型：deepseek/deepseek-chat\n' } }, consults)
  assert.deepEqual([same.drifted, same.hand, same.executed], [false, ['deepseek/deepseek-chat'], 'deepseek/deepseek-chat'])
  // No execution, or no consult: nothing to compare, so no warning.
  assert.equal(reader.routeReport({}, consults).drifted, false)
  assert.equal(reader.routeReport({ executing: { markdown: '> 执行模型：openai/x\n' } }, []).drifted, false)
})

test('the index falls back to scanning state.json files when index.json is gone', () => {
  const root = plantRoot()
  try {
    rmSync(join(root, 'index.json'))
    const index = reader.readIndex(root)
    assert.equal(index.source, 'tasks/*/state.json')
    assert.deepEqual(index.tasks.map(row => row.id), [FIXTURE_ID])
    assert.equal(index.tasks[0].phase, 'reviewing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveRootDir prefers the row config, then the env override, then the home default', () => {
  assert.equal(resolveRootDir({ rootDir: '/tmp/from-config' }, {}), '/tmp/from-config')
  assert.equal(resolveRootDir({}, { DSH_FLY_SMART_ROOT: '/tmp/from-env' }), '/tmp/from-env')
  assert.equal(resolveRootDir({ rootDir: '  ' }, { DSH_FLY_SMART_ROOT: '/tmp/from-env' }), '/tmp/from-env')
  assert.match(resolveRootDir({}, {}), /\.dsh-fly[/\\]smart$/u)
})

/**
 * Cache-busting suffix: a counter, not Date.now(). Two loads inside the same
 * millisecond would otherwise share a specifier, hit the module cache, and leave
 * `loaded` undefined — an order-dependent flake, not a bundle bug.
 */
let loadCount = 0

/** Load the built bundle exactly as the shell does, with stub platform modules. */
async function loadBundle() {
  let loaded
  let loadedId
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        loadedId = id
        loaded = factory(specifier => {
          assert.ok(PLATFORM_MODULES.includes(specifier), `factory required ${specifier}`)
          return {
            createElement: () => null,
            useCallback: callback => callback,
            useEffect: () => {},
            useState: value => [value, () => {}],
          }
        })
      },
    },
  }
  const created = []
  globalThis.document = {
    querySelector: () => null,
    createElement: tag => { created.push(tag); return { dataset: {}, remove() {} } },
    head: { appendChild: () => {} },
  }
  await import(`${pathToFileURL(BUNDLE).href}?t=${++loadCount}`)
  return { loaded, loadedId, created }
}

test('the built bundle registers the fly.smart drawer page after the four workbenches', async () => {
  const source = readFileSync(BUNDLE, 'utf8')
  for (const match of source.matchAll(/require\(["']([^"']+)["']\)/gu)) {
    assert.ok(PLATFORM_MODULES.includes(match[1]), `bundle requires non-platform module ${match[1]}`)
  }
  const { loaded, loadedId, created } = await loadBundle()
  assert.equal(loadedId, manifest.name)
  assert.equal(loaded.name, 'fly-smart-panel')
  assert.deepEqual(loaded.inject, ['slots', 'sidebarRightTabs'])

  const registrations = []
  const types = []
  loaded.apply({
    effect: callback => callback(),
    slots: {
      inject: (slotName, callback) => { registrations.push({ kind: 'inject', name: slotName, dispose: callback() }) },
      register: (options, component) => { registrations.push({ kind: 'register', options, component }); return () => {} },
    },
    sidebarRightTabs: { register: definition => { types.push(definition); return () => {} } },
  })

  // Presentation is the skin's: a second stylesheet tag would break the shell's
  // "one Fly surface" assertion in the acceptance test.
  assert.deepEqual(created, [])
  assert.equal(types.length, 1)
  assert.deepEqual(
    { id: types[0].id, kind: types[0].kind, title: types[0].title(), multiple: types[0].multiple },
    { id: 'dsh-plugin-fly-smart-panel', kind: 'fly.smart', title: 'Smart 工作流', multiple: undefined },
  )
  assert.deepEqual(types[0].guide.map(entry => [entry.id, entry.order, entry.title()]), [['open', 40, 'Smart 工作流']])
  const body = registrations.find(entry => entry.kind === 'register' && entry.options.name === 'sidebar.right.pane.tab')
  assert.equal(body.options.key, 'dsh-plugin-fly-smart-panel')
  assert.deepEqual(registrations.filter(entry => entry.kind === 'inject').map(entry => entry.name), ['sidebar.right.pane.tab'])
  assert.equal(registrations.some(entry => entry.options?.name === 'main'), false)
})

test('the settings row declares the model pair as volatile fields', () => {
  // 这条是"官方 Settings 里能看见这一行"的全部依据：官方设置表单只投影宿主行声明的
  // 字段，且只有 `.volatile()` 的字段会离开宿主（非 volatile 的写了也白写）。少了
  // volatile，用户在设置页看不到配对、也就永远配不上手模型。
  for (const field of ['brainRoute', 'handRoute']) {
    assert.equal(Config.dict[field]?.meta?.volatile, true, `${field} must be a volatile settings field`)
    assert.equal(Config.dict[field]?.meta?.default, '')
  }
  // rootDir 不该是 volatile：浏览器没有理由编辑任务落盘位置。
  assert.equal(Config.dict.rootDir?.meta?.volatile, undefined)
})

test('the real mirror is never touched by this suite, and an empty row writes nothing', () => {
  // M1 的闸：套件跑完，真实 ~/.dsh-fly/smart-routes.json 必须逐字节不变。
  const now = (() => {
    try {
      return readFileSync(REAL_MIRROR)
    } catch {
      return null
    }
  })()
  assert.deepEqual(now, REAL_MIRROR_BYTES, 'the suite must not read-modify the developer\'s real route mirror')
  assert.ok(String(REAL_MIRROR).includes('/.dsh-fly/'), 'the captured path is the real mirror')

  // 行 ref 为空时，boot 合并一个字节都不许写（真实的镜像是用户配置，不是草稿纸）。
  const file = join(mkdtempSync(join(tmpdir(), 'fly-smart-panel-rowref-')), 'smart-routes.json')
  assert.equal(mergeRowRoutes(file, { hand: '' }), null)
  assert.equal(existsSync(file), false)
  assert.equal(mergeRowRoutes(file, {}), null)
  assert.equal(existsSync(file), false)
})
