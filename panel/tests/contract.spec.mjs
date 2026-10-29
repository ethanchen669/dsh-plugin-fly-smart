/**
 * Contract tests for the Fly smart workbench (0.3.0 slim).
 *
 * The host half has two contracts worth pinning, and they fail differently:
 *
 *   1. **The route/status table.** This row answers exactly one endpoint now
 *      (`/fly/smart/routes`) plus the 200-only namespace probe. The deleted task
 *      endpoints must read as *unknown* (404), not as a refusal — one route table,
 *      one truth. "No capability" (503 on POST in a read-only composition) must never
 *      look like "no data".
 *   2. **The built bundle.** It must load through the real module-loader contract,
 *      seat `fly.smart` in the drawer registry (order 40) and add no stylesheet of
 *      its own — presentation stays in the shell skin. The bundle and the client
 *      source must carry **no** task-board code (the reverse assertion for the
 *      slim-down: a leftover board fetch would be a page the product no longer has).
 *
 * Run: node --test panel/tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { REAL_MIRROR, REAL_MIRROR_BYTES, SCRATCH_MIRROR } from './scratch-home.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// 面板已并入 dsh-plugin-fly-smart：清单在**包根**，不再有面板自己的 package.json。
const manifest = JSON.parse(readFileSync(join(packageRoot, '..', 'package.json'), 'utf8'))
const HOST_ENTRY = join(packageRoot, '..', 'index.js')
const CLIENT_SOURCE = join(packageRoot, '..', 'src', 'client', 'index.tsx')
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

const host = await import(pathToFileURL(HOST_ENTRY).href)
const { Config, answerSmartRequest, readRoutesConfig, writeRoutesConfig } = host

function makeDeps({ mirrorPath = SCRATCH_MIRROR, rowHand = '', rowReview = '', write = true, log = () => undefined } = {}) {
  return {
    readRoutes: sid => readRoutesConfig({ mirrorPath, rowHand, rowReview, sessionId: sid }),
    ...write
      ? {
          writeRoutes: ({ role = 'hand', value = '', hand = value, scope, sessionId: sid }) =>
            writeRoutesConfig({ mirrorPath, rowHand, rowReview, role, value, hand, scope, sessionId: sid }),
        }
      : {},
    log,
  }
}

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(text) { this.body = typeof text === 'string' ? text : '' },
  }
}

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

async function call(deps, url, { method = 'GET', body = null, headers = {} } = {}) {
  const res = fakeResponse()
  await answerSmartRequest(deps, fakeRequest({ method, url, headers, body }), res)
  let json = null
  try {
    json = res.body === '' ? null : JSON.parse(res.body)
  } catch {
    json = null
  }
  return { status: res.status, headers: res.headers, body: res.body, json }
}

/**
 * Load the built bundle through the **real** module-loader contract.
 *
 * The bundle is a `__ModuleLoader__.load({ id, factory })` registration, not a plain
 * ESM module: importing it needs `window.__ModuleLoader__`, and the factory needs the
 * platform modules it lists. The stub mirrors that shape (a wrong-shaped stub once
 * made this suite green against a contract the product never uses).
 *
 * @returns `{ loaded, loadedId, created }` — the plugin module, its id, and every
 *   element the plugin created (the stylesheet is the one it is allowed to add).
 */
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
            useCallback: callback => callback,
            useEffect: () => {},
            useRef: value => ({ current: value }),
            useState: value => [value, () => {}],
          }
        })
      },
    },
  }
  const created = []
  const documentStub = {
    querySelector: () => null,
    // 桩必须与真接缝同形：面板客户端会给 `<style>` 打 data-plugin 属性（真元素当然有
    // setAttribute；第一版桩没有 ⇒ 面板注入样式时当场 TypeError）。
    createElement: tag => {
      created.push(tag)
      const element = { dataset: {}, remove() {}, setAttribute(name, value) { element[name] = value } }
      documentStub.__lastStyleTag = element
      return element
    },
    head: { appendChild: () => {} },
  }
  globalThis.document = documentStub
  await import(`${pathToFileURL(BUNDLE).href}?t=${++loadCount}`)
  return { loaded, loadedId, created }
}

let loadCount = 0

test('the manifest ships each file individually and declares a Loader row', () => {
  // exports 必须**在**：`dsh.client` 要靠 `exports["./client"]` 被引擎找到
  //（实测：缺了它 `dsh-client-modules` 直接让启动失败），同时 `./*` 保证包内子路径行名照样解析。
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./*'], './*')
  // A bare directory in `files` silently drops the contract for `pack:tar`.
  // **panel 列成运行时文件而不是整个目录**：整目录会把 `panel/tests/` 一起带进 tarball。
  for (const entry of ['index.js', 'lib/client.js', 'lib/dispatch.mjs', 'lib/doc-contract.mjs', 'panel/routes.mjs', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(entry), `files 少了 ${entry}`)
  }
  // 0.3.0 删除的两份不许再出现在 files 里：列了却没有的文件会被 pack 静默忽略。
  for (const gone of ['lib/state.mjs', 'panel/reader.js']) {
    assert.equal(manifest.files.includes(gone), false, `files 里还留着已删除的 ${gone}`)
  }
  assert.equal(manifest.files.includes('panel'), false, '别把 panel 整目录塞进 files —— panel/tests 会跟着进包')
  assert.equal(manifest.files.some(entry => entry.includes('tests')), false, '测试不该进 tarball')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  const patch = readFileSync(join(packageRoot, '..', manifest.dsh.bundle.patch), 'utf8')
  assert.match(patch, /id: fly-smart-panel/u)
  assert.equal(patch.match(/^ {4}- id:/gmu)?.length, 1)
})

test('the host row claims the /fly/smart namespace and publishes its service', async () => {
  const hostModule = await import(pathToFileURL(HOST_ENTRY).href)
  assert.equal(hostModule.name, 'fly-smart-panel')
  assert.deepEqual(hostModule.inject, ['webServer', 'skills'])

  const registered = []
  const provided = []
  const skillProviders = []
  hostModule.apply({
    provide: (serviceName, value) => provided.push([serviceName, value]),
    effect: callback => callback(),
    webServer: { register: options => { registered.push(options); return () => {} } },
    skills: { registerProvider: create => skillProviders.push(create()) },
  }, {})

  // 自带技能真的被登记：11 个技能一个不能少（0.3.0 新增 smart-review），且每个都带 description
  //（技能目录只看 description —— 缺了 = 用户搜不到 = 本次移植白做）。
  assert.equal(skillProviders.length, 1)
  assert.equal(skillProviders[0].name, 'fly-smart')
  const skills = await skillProviders[0].list()
  // 一个不能少：新增技能要同步补进这份名单（0.3.0 补齐设计期能力：brainstorm / design / adr / plan / acceptance / review）。
  const expected = ['smart-acceptance', 'smart-adr', 'smart-brainstorm', 'smart-debug', 'smart-design', 'smart-diagnose', 'smart-parallel', 'smart-plan', 'smart-review', 'smart-review-receive', 'smart-skills', 'smart-tdd', 'smart-verify-claim', 'smart-worktree', 'smart-write-skill']
  assert.deepEqual(skills.map(entry => entry.name).sort(), expected)
  for (const entry of skills) {
    assert.equal(typeof entry.description, 'string')
    assert.ok(entry.description.length > 0, `${entry.name} 缺 description`)
    assert.equal(entry.provider, 'fly-smart')
    assert.equal(entry.source, 'bundled')
  }
  // 内容能取回，且 frontmatter 已剥掉（正文才被喂给模型）。
  const body = await skillProviders[0].get(skills.find(entry => entry.name === 'smart-skills'), {})
  assert.ok(body.content.length > 0)
  assert.equal(body.content.startsWith('---'), false, 'frontmatter 必须剥掉')

  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, '/fly/smart')
  assert.equal(typeof registered[0].handler, 'function')
  assert.equal(provided.length, 1)
  assert.equal(provided[0][0], 'flySmartPanel')
  // slim 服务面：路由是唯一的事实来源；任务树相关的读取入口全部消失。
  assert.equal(typeof provided[0][1].routes, 'function')
  assert.equal(provided[0][1].tasks, undefined, 'tasks() 属于已删的任务面板')
  assert.equal(provided[0][1].locate, undefined, 'locate() 属于已删的任务面板')
})

test('the root endpoint self-describes and the table matches the handler', async () => {
  const deps = makeDeps({})
  const res = await call(deps, '/fly/smart')
  assert.equal(res.status, 200)
  assert.equal(res.json.plugin, 'fly-smart-panel')
  // 自描述表必须与路由表逐字一致：0.3.0 只剩路由一个端点。
  assert.deepEqual(res.json.endpoints.map(entry => entry.path), ['/fly/smart/routes'])
  assert.deepEqual(res.json.routeConfig, res.json.routes, 'routeConfig 与 GET /routes 是同一份（首屏省一次请求）')
  const gone = await call(deps, '/fly/smart/tasks')
  assert.equal(gone.status, 404, '删掉的任务端点按未知端点处理 —— 路由表只有一份')
  assert.match(gone.json.error, /unknown smart endpoint/u)
})

test('the root endpoint is the page’s 200-only capability probe, and a read-only host says 503 on write', async () => {
  const res = await call(makeDeps({}), '/fly/smart')
  // Always a 200: the browser logs every non-2xx fetch.
  assert.equal(res.status, 200)
  assert.equal(res.json.plugin, 'fly-smart-panel')

  const readOnly = await call(makeDeps({ write: false }), '/fly/smart/routes', {
    method: 'POST',
    body: JSON.stringify({ hand: 'deepseek/flash', scope: 'default' }),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(readOnly.status, 503, 'no capability must not look like no data')
  assert.match(readOnly.json.error, /没有可写的路由面/u)
})

test('the settings row declares the model pair as volatile fields', () => {
  // 这条是"官方 Settings 里能看见这一行"的全部依据：官方设置表单只投影宿主行声明的
  // 字段，且只有 `.volatile()` 的字段会离开宿主（非 volatile 的写了也白写）。
  for (const field of ['brainRoute', 'handRoute', 'reviewRoute']) {
    assert.equal(Config.dict[field]?.meta?.volatile, true, `${field} must be a volatile settings field`)
    assert.equal(Config.dict[field]?.meta?.default, '')
  }
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
  assert.equal(host.mergeRowRoutes(file, { hand: '' }), null)
  assert.equal(existsSync(file), false)
  assert.equal(host.mergeRowRoutes(file, {}), null)
  assert.equal(existsSync(file), false)
  rmSync(dirname(file), { recursive: true, force: true })
})

test('the built bundle registers the fly.smart drawer page and adds no stylesheet of its own', async () => {
  const source = readFileSync(BUNDLE, 'utf8')
  for (const match of source.matchAll(/require\(["']([^"']+)["']\)/gu)) {
    assert.ok(PLATFORM_MODULES.includes(match[1]), `bundle requires non-platform module ${match[1]}`)
  }
  const { loaded, created } = await loadBundle()
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

  // 面板**自带**设计系统：web 上没有工作台外壳，`.fly-*` 就没有任何规则。
  assert.deepEqual(created, ['style'])
  assert.equal(globalThis.document.__lastStyleTag?.['data-plugin'], 'dsh-plugin-fly-smart-panel')
  assert.equal(types.length, 1)
  assert.deepEqual(
    { id: types[0].id, kind: types[0].kind, title: types[0].title() },
    { id: 'dsh-plugin-fly-smart-panel', kind: 'fly.smart', title: 'Smart 模型路由' },
  )
  assert.deepEqual(types[0].guide.map(entry => [entry.id, entry.order, entry.title()]), [['open', 40, 'Smart 模型路由']])
  const body = registrations.find(entry => entry.kind === 'register' && entry.options.name === 'sidebar.right.pane.tab')
  assert.equal(body.options.key, 'dsh-plugin-fly-smart-panel')
  assert.deepEqual(registrations.filter(entry => entry.kind === 'inject').map(entry => entry.name), ['sidebar.right.pane.tab'])
  assert.equal(registrations.some(entry => entry.options?.name === 'main'), false)
})

test('the reverse assertion: no task-board code survives in the client or the bundle', () => {
  // 0.3.0 的反向钉子。任务面板删了，但"删干净"必须有一条会红的尺子 ——
  // 漏下一个 `/tasks` 请求或一块板子逻辑，页面就会去读一个不存在的端点（404 + 空面板）。
  const source = readFileSync(CLIENT_SOURCE, 'utf8')
  for (const gone of ['/tasks', 'data-probe="board"', 'artifactTabs', 'reworkBudgetOf', 'data-phase-status']) {
    assert.equal(source.includes(gone), false, `客户端里还留着已删任务面板的 ${gone}`)
  }
  // 路由卡必须还在：它是这个页面唯一的存在理由。
  assert.ok(source.includes('data-fly-smart-field="hand"'))
  assert.ok(source.includes('data-fly-smart-field="review"'))
  const bundle = readFileSync(BUNDLE, 'utf8')
  for (const gone of ['/fly/smart/tasks', '/fly/smart/task?id=']) {
    assert.equal(bundle.includes(gone), false, `构建产物里还留着已删端点的 ${gone}`)
  }
  assert.ok(bundle.includes('data-fly-smart-field'), '构建产物必须带上路由卡的表单钩子')
})
