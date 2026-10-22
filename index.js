/**
 * DSH Fly smart workbench — host half.
 *
 * An ordinary Cordis row that claims the Web carrier prefix `/fly/smart`. It
 * serves the smart task tree as JSON **and owns the route-configuration surface**:
 * the page inside the right drawer is the product entry for `smart.brainRoute` /
 * `smart.handRoute`, so the user never has to find the upstream Settings form
 * (which only projects host-plane rows anyway — see `docs/smart-mode-design.md`).
 *
 * The state machine still lives in the agent-plane package `dsh-plugin-fly-smart`;
 * duplicating it here would give the product two truths about what phase a task is
 * in. What this row owns is the *configuration* interface, because it is the one
 * that can: it has the HTTP surface the browser half talks to.
 *
 * Only `node:` builtins plus this package's own modules are imported, so the
 * Loader can import this from a profile's own `node_modules` with no build step.
 *
 * Routes:
 *
 *   GET  /fly/smart                 → `{ plugin, path, root, exists, routes, routeConfig, endpoints }`
 *   GET  /fly/smart/tasks           → `{ root, tasks, legacyCount, unknownWorkspace? }`
 *   GET  /fly/smart/task?id=<id>    → `{ root, state, artifacts, consults, … }`
 *   GET  /fly/smart/routes          → `{ path, default, session, effective, … }`
 *   POST /fly/smart/routes          → write one hand route; `{ changed, … }`
 *
 * Status contract, checked in this order so the client can tell the cases apart:
 *
 *   404  unknown endpoint — before anything else, so a typo never looks like a refusal
 *   405  wrong method, with the derived `allow` header
 *   403  cross-site write (CSRF) — separate from 415 so a security refusal is never
 *        reported as a content-type problem
 *   415  a write body that is not JSON
 *   413  a write body over 4096 bytes (connection stays reusable)
 *   400  malformed route / unknown key / impossible session id / too many new sessions
 *   503  the root directory does not exist, or this composition cannot write routes.
 *        Never an empty 200: "no data" and "no capability" must not look alike.
 *   409  the mirror lock is held by another writer
 *   404  the root exists but that task does not
 *
 * `unknownWorkspace` is the one soft case: the root exists, but this build could
 * not learn which session's workspace is asking (`acceptance.md` M3/M5). It is a
 * 200 with an empty list plus the host's own sentence — a browser logs every
 * non-2xx fetch as a console error, and a missing session id is not a fault.
 *
 * @module dsh-plugin-fly-smart-panel
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { ID_PATTERN, isSafeTaskId, readIndex, readTask } from './panel/reader.js'
import {
  LockBusy,
  MAX_BODY_BYTES,
  MAX_SESSIONS,
  MIRROR_PATH_ENV,
  MIRROR_VERSION,
  ROUTE_MIRROR_FILE,
  formatRoute,
  isValidSessionId,
  mergeRowRoutes,
  mirrorLockPath,
  parseRouteString,
  readMirrorDocument,
  resolveHand,
  resolveReview,
  resolveMirrorPath,
  updateMirror,
} from './panel/routes.mjs'

export { MIRROR_PATH_ENV, MIRROR_VERSION, ROUTE_MIRROR_FILE, isValidSessionId, mergeRowRoutes, parseRouteString, resolveMirrorPath }

/** Cordis plugin name, matched by the bundle patch's row `name`. */
export const name = 'fly-smart-panel'

/** Host dependencies: the Web carrier, plus `skills` (this row ships bundled skills). */
export const inject = ['webServer', 'skills']

/** Route namespace this workbench owns. */
export const FLY_SMART_PATH = '/fly/smart'

/** Service name this row publishes for other Host plugins and tools. */
export const FLY_SMART_SERVICE = 'flySmartPanel'

/**
 * Where smart mode wrote **before** the task root became the session workspace.
 *
 * Still the read-compat root: tasks created by older builds live here, and the
 * workbench must keep showing (and finishing) them. New tasks do not land here.
 */
export function resolveLegacyRoot() {
  return join(homedir(), '.dsh-fly', 'smart')
}

/** The legacy root, as a constant (kept for callers that only need the default). */
export const DEFAULT_ROOT_DIR = resolveLegacyRoot()

/** Every task of the workspace root lives under this directory name. */
export const WORKSPACE_ROOT_DIR = join('.dsh-fly', 'smart')

/**
 * Environment override for the smart root.
 *
 * The row config is the product-facing switch; this exists because verification
 * boots a real carrier in a scratch home (`DSH_HOME`), while `homedir()` still
 * points at the developer's real home — without an override a verify run would
 * have to plant fixtures in the user's own `~/.dsh-fly/smart`, which is exactly
 * the kind of write the hard rules forbid.
 */
export const ROOT_DIR_ENV = 'DSH_FLY_SMART_ROOT'

/**
 * Smart's live preferences, declared here because this is the **host-plane** row.
 *
 * `rootDir` is not volatile: the browser has no business editing where tasks land.
 * `brainRoute` / `handRoute` stay volatile because the upstream Settings form is
 * still a supported (if no longer primary) way to set the pair — the drawer page
 * writes the same mirror the tools read, so both entries agree on disk.
 */
export const Config = z.object({
  rootDir: z.string().default(''),
  // `"provider/model"`（可选 `@effort`）；空 = 用户还没选，工具会在调用时指路。
  brainRoute: z.string().default('').volatile(),
  handRoute: z.string().default('').volatile(),
  reviewRoute: z.string().default('').volatile(),
})

/**
 * Read one row-config field that may arrive as a **reference box**.
 *
 * `.volatile()` fields (the ones the upstream Settings form needs to see) are refs
 * in `config`, with the value behind `.get()` — the engine reads its own the same
 * way (`dsh-agent-preset-registry`: `this.config.selectedDefault.get()`). Fields
 * without `.volatile()` (our `rootDir`) are plain values, so **one config object
 * carries both shapes** and the read has to accept either.
 *
 * Getting this wrong is silent: `typeof ref === 'string'` is always false, so the
 * row looks empty and every "the row outranks the page" branch quietly takes the
 * other way. That is a real bug this file shipped once (found while writing the
 * docs, `upstream-tracking.md` §7.1).
 *
 * @param field - a ref box, a plain value, or nothing.
 * @returns the trimmed string value, or `''`.
 */
export function readRowString(field) {
  const value = field !== null && typeof field === 'object' && typeof field.get === 'function' ? field.get() : field
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Endpoint table, also served at the namespace root so the UI can self-describe.
 *
 * Every route this row answers appears here — a "self-describing" table that omits
 * the configuration endpoint would be describing a different product.
 */
export const ENDPOINTS = [
  { path: `${FLY_SMART_PATH}/tasks`, summary: '任务索引（id/标题/阶段/开着的门/更新时间），按更新时间倒序', methods: ['GET', 'HEAD'] },
  { path: `${FLY_SMART_PATH}/task?id=<id>`, summary: '单个任务的状态机、六个产物、评审记录、取证、门记录与返工历史', methods: ['GET', 'HEAD'] },
  { path: `${FLY_SMART_PATH}/routes`, summary: '双模型路由配置：本会话 / 所有会话默认的 hand 路由（GET 读，POST 写）', methods: ['GET', 'HEAD', 'POST'] },
]

/** Methods per endpoint, derived for the `allow` header (never hard-coded twice). */
const ALLOWED = new Map([
  ['/', ['GET', 'HEAD']],
  ['/tasks', ['GET', 'HEAD']],
  ['/task', ['GET', 'HEAD']],
  ['/routes', ['GET', 'HEAD', 'POST']],
])

/**
 * Resolve the **explicit** smart root: row config first, then the env override.
 *
 * "Explicit" means a human said so (or a test did) — it is not derived from a
 * session. When it is set, the workbench lists that root and does not pretend to
 * know a workspace.
 *
 * @param rawConfig - the row's `config` object, as Cordis passes it.
 * @param env - the process environment (injectable for tests).
 * @returns `{ root, source }` or null.
 */
export function resolveExplicitRoot(rawConfig = {}, env = process.env) {
  const configured = readRowString(rawConfig?.rootDir)
  if (configured !== '') return { root: resolve(configured), source: 'row' }
  const fromEnv = typeof env?.[ROOT_DIR_ENV] === 'string' ? env[ROOT_DIR_ENV].trim() : ''
  if (fromEnv !== '') return { root: resolve(fromEnv), source: 'env' }
  return null
}

/**
 * Resolve the smart root: row config, then the env override, then the legacy root.
 * @param rawConfig - the row's `config` object, as Cordis passes it.
 * @param env - the process environment (injectable for tests).
 * @returns an absolute path.
 */
export function resolveRootDir(rawConfig = {}, env = process.env) {
  return resolveExplicitRoot(rawConfig, env)?.root ?? resolveLegacyRoot()
}

/**
 * The task root of one session's workspace: `<header.cwd>/.dsh-fly/smart`.
 *
 * `header.cwd` is the session's own working directory — **not** the host process
 * cwd and **not** the workspace service's root. Those three are routinely
 * different (the desktop shell's cwd is `/`), and `process.cwd()` is banned as a
 * fallback for exactly that reason: it would silently file a task into the repo
 * root. Unknown cwd means "unknown workspace", which the page renders as such.
 *
 * @param sessionId - the session asking.
 * @param sessions - the `sessions` service, if this composition has one.
 * @returns an absolute root, or null when it cannot be known.
 */
export function workspaceRootFromSession(sessionId, sessions) {
  if (!isValidSessionId(sessionId) || sessions === undefined || sessions === null) return null
  let session
  try {
    session = typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
  } catch {
    return null
  }
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) return null
  return join(cwd, WORKSPACE_ROOT_DIR)
}

/**
 * Every root this request could be talking about, in precedence order.
 *
 * @param input - `{ rawConfig, env, sessionId, sessions }`.
 * @returns `{ primary, explicit, explicitSource, workspace, workspaceSource, legacy, unknownWorkspace, candidates }`.
 */
export function resolveRoots({ rawConfig = {}, env = process.env, sessionId = null, sessions = undefined } = {}) {
  const explicit = resolveExplicitRoot(rawConfig, env)
  const workspace = workspaceRootFromSession(sessionId, sessions)
  const legacy = resolveLegacyRoot()
  const candidates = []
  for (const root of [explicit?.root ?? null, workspace, legacy]) {
    if (root !== null && !candidates.includes(root)) candidates.push(root)
  }
  return {
    primary: explicit?.root ?? workspace ?? legacy,
    explicit: explicit?.root ?? null,
    explicitSource: explicit?.source ?? null,
    workspace,
    workspaceSource: workspace === null ? null : 'header.cwd',
    legacy,
    unknownWorkspace: explicit === null && workspace === null,
    candidates,
  }
}

/**
 * Find the task directory of one id across the candidate roots.
 *
 * The root a task is read from is decided by **what is on disk**, not by a value
 * stored inside the task: a recorded `rootDir` in `state.json` is only checked for
 * consistency, so copying a task directory cannot redirect a read (or a later
 * write) into an arbitrary path (`acceptance.md` Y7).
 *
 * @param taskId - task id.
 * @param candidates - roots in precedence order.
 * @returns `{ root, taskDir, note }` or null.
 */
export function locateTask(taskId, candidates) {
  if (!isSafeTaskId(taskId)) return null
  const hits = []
  for (const root of candidates) {
    const taskDir = join(root, 'tasks', taskId)
    if (existsSync(join(taskDir, 'state.json'))) hits.push({ root, taskDir })
  }
  if (hits.length === 0) return null
  return {
    ...hits[0],
    // 同 taskId 双根：工作区根胜出，但要留下痕迹 —— 静默挑一个会让"我的产物去哪了"
    // 变成无从下手的悬案（acceptance.md M10）。
    ...hits.length > 1 ? { note: `task "${taskId}" exists in ${hits.length} roots; reading ${hits[0].root}` } : {},
  }
}

/** The sentence that says smart has produced nothing yet. */
export function missingRootMessage(rootDir) {
  return `smart 任务目录不存在：${rootDir}（smart 模式还没有产出任何任务；在会话里发「/smart <任务>」开始一个）`
}

/** The sentence for "the root is fine, but I cannot tell which workspace you are". */
export function unknownWorkspaceMessage(legacyRoot) {
  return `无法确定当前工作区：右抽屉没有读到会话的工作目录，所以只列出兼容根 ${legacyRoot} 的计数。请在会话里打开这一页（或先选中一个会话）。`
}

/** A write the handler must refuse with a specific status. */
export class RouteWriteError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'RouteWriteError'
    this.status = status
  }
}

/**
 * The read side of the configuration surface.
 *
 * Reconciles the scripting plane's row config on read (`acceptance.md` S1 item 4):
 * a non-empty row value is the hard floor and is merged into the mirror's
 * `default` layer before the state is reported, so what the page shows is what the
 * agent will use. An empty row value writes **nothing at all** — a boot must never
 * touch the user's mirror.
 *
 * @param input - `{ mirrorPath, rowHand, sessionId }`.
 * @returns the payload served at `/fly/smart/routes` and as `routeConfig`.
 */
export function readRoutesConfig({ mirrorPath, rowHand = '', rowReview = '', sessionId = null }) {
  if (rowHand !== '') {
    try { mergeRowRoutes(mirrorPath, { hand: rowHand }) } catch { /* read remains useful */ }
  }
  const doc = readMirrorDocument(mirrorPath)
  const known = isValidSessionId(sessionId)
  const session = known && doc.sessions[sessionId] !== undefined
    ? { id: sessionId, hand: doc.sessions[sessionId].hand ?? '', review: doc.sessions[sessionId].review ?? '', at: doc.sessions[sessionId].at }
    : null
  const mirror = resolveHand(doc, known ? sessionId : null)
  const review = resolveReview(doc, known ? sessionId : null)
  const effective = rowHand !== '' ? { hand: rowHand, source: 'preset' } : { hand: mirror.hand, source: mirror.source }
  const effectiveReview = rowReview !== '' ? { review: rowReview, source: 'preset' } : review
  return {
    path: mirrorPath, lock: mirrorLockPath(mirrorPath), version: MIRROR_VERSION, exists: existsSync(mirrorPath),
    presetRow: { hand: rowHand, review: rowReview, at: null, effective: rowHand !== '' || rowReview !== '' },
    default: doc.defaultHand === '' && doc.defaultReview === '' ? null : { hand: doc.defaultHand, review: doc.defaultReview, at: doc.defaultAt },
    session, sessionKnown: known, sessionCount: Object.keys(doc.sessions).length,
    brain: doc.legacyBrain === '' ? null : { value: doc.legacyBrain, consumer: null },
    effective, effectiveReview, effectiveFromPanel: rowHand === '' && rowReview === '',
  }
}

/**
 * The write side: one hand route into one layer of the mirror.
 *
 * @param input - `{ mirrorPath, rowHand, hand, scope, sessionId }`.
 * @returns the fixed success payload `{ changed, effectiveFromPanel, source, sessionKnown, at, path }`.
 * @throws {RouteWriteError} for the 400-class refusals.
 */
export function writeRoutesConfig({ mirrorPath, rowHand = '', rowReview = '', value, hand = '', role = 'hand', scope, sessionId = null }) {
  value = value ?? hand ?? ''
  const doc = readMirrorDocument(mirrorPath)
  if (scope === 'session' && value !== '' && doc.sessions[sessionId] === undefined && Object.keys(doc.sessions).length >= MAX_SESSIONS) {
    throw new RouteWriteError(400, `smart routes: 会话路由已达上限 ${MAX_SESSIONS} 条 —— 只挡新增键，先清掉一些会话路由再保存`)
  }
  let result
  try {
    result = updateMirror(mirrorPath, role === 'review' ? { role, review: value, scope, sessionId } : { role, hand: value, scope, sessionId })
  } catch (error) {
    if (error instanceof LockBusy) throw new RouteWriteError(409, error.message)
    throw new RouteWriteError(500, `smart routes: 镜像写入失败：${String(error?.message ?? error)}`)
  }
  const config = readRoutesConfig({ mirrorPath, rowHand, rowReview, sessionId })
  return {
    changed: result.changed,
    effectiveFromPanel: rowHand === '' && rowReview === '',
    source: role === 'review' ? config.effectiveReview.source : config.effective.source,
    sessionKnown: config.sessionKnown,
    at: result.at,
    path: result.path,
  }
}

/** Does this request look like a cross-site write? */
function crossSite(req) {
  const site = String(req?.headers?.['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return true
  const origin = typeof req?.headers?.origin === 'string' ? req.headers.origin : ''
  if (origin === '' || origin === 'null') return false
  const host = req?.headers?.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

/**
 * Read a request body with a hard byte ceiling.
 *
 * Resolves as soon as the ceiling is crossed **without** unsubscribing: the rest
 * of the request is drained, which is what keeps the connection reusable for the
 * next request (`acceptance.md` S1b-2 measures this on a real socket).
 *
 * @param req - incoming request.
 * @param limit - maximum accepted bytes.
 * @returns `{ text }` or `{ tooLarge: true }`.
 */
export async function readBody(req, limit = MAX_BODY_BYTES) {
  return await new Promise(resolveBody => {
    let total = 0
    const chunks = []
    let decided = false
    const finish = value => {
      if (decided) return
      decided = true
      resolveBody(value)
    }
    req?.on?.('data', chunk => {
      total += chunk.length
      if (total > limit) {
        chunks.length = 0
        finish({ tooLarge: true })
        return
      }
      chunks.push(chunk)
    })
    req?.on?.('end', () => finish({ text: Buffer.concat(chunks).toString('utf8') }))
    req?.on?.('error', () => finish({ text: '' }))
  })
}

/**
 * Answer one smart request. The handler owns the whole response lifecycle — the
 * carrier answers a thrown handler with a bare 400 and no diagnostics.
 *
 * @param deps - the composition's capabilities:
 *   - `roots(sessionId)` → {@link resolveRoots} shape
 *   - `readRoutes(sessionId)` → {@link readRoutesConfig} shape
 *   - `writeRoutes({hand, scope, sessionId})` → write payload, or undefined for a read-only host
 *   - `locate(taskId, sessionId?)` → `{root, taskDir, note?}` or null
 *   - `readIndex(root)` / `readTask(root, id)` → readers (injectable for tests)
 *   - `log()` → optional logger service
 * @param req - the incoming request.
 * @param res - the response to finish.
 * @returns a promise that settles once the response has been written.
 */
export async function answerSmartRequest(deps, req, res) {
  const method = String(req?.method ?? 'GET').toUpperCase()
  const pathname = String(req?.url ?? '/').split('?')[0]
  const index = deps?.readIndex ?? readIndex
  const detail = deps?.readTask ?? readTask
  const log = typeof deps?.log === 'function' ? deps.log() : undefined

  /** Log a line when a logger is available; a missing logger is not an error. */
  const note = message => {
    try {
      log?.warn?.(message)
    } catch {
      // 日志降级：宿主没有 log 服务时只体现在响应字段里（acceptance.md M15）。
    }
  }

  const json = (status, payload) => {
    const body = JSON.stringify(payload, null, 2)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(method === 'HEAD' ? undefined : body)
  }

  // ── 1. Route table: an unknown path is a 404 before any other judgement ──────
  const relative = pathname === FLY_SMART_PATH
    ? '/'
    : pathname.startsWith(`${FLY_SMART_PATH}/`) ? pathname.slice(FLY_SMART_PATH.length) : null
  if (relative === null || !ALLOWED.has(relative)) {
    json(404, { error: `unknown smart endpoint: ${pathname}`, endpoints: ENDPOINTS })
    return
  }

  // ── 2. Method: 405 with the derived allow list ──────────────────────────────
  const allowed = ALLOWED.get(relative)
  const isWrite = relative === '/routes' && method === 'POST'
  if (!allowed.includes(method)) {
    res.writeHead(405, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      allow: allowed.join(', '),
    })
    res.end('method not allowed')
    return
  }

  const sessionId = (() => {
    try {
      const url = new URL(String(req?.url ?? '/'), 'http://127.0.0.1')
      const raw = url.searchParams.get('sessionId')
      return raw === null || raw === '' ? null : raw
    } catch {
      return null
    }
  })()

  // ── 3. CSRF, then content type, then size, then shape ──────────────────────
  let body = null
  if (isWrite) {
    if (crossSite(req)) {
      json(403, { error: 'smart routes: 跨站写入被拒（同源页面才能改模型路由）' })
      return
    }
    const type = String(req?.headers?.['content-type'] ?? '').toLowerCase()
    if (!type.startsWith('application/json')) {
      json(415, { error: 'smart routes: 请求体必须是 application/json（面板只回显这句宿主文案）' })
      return
    }
    const read = await readBody(req)
    if (read.tooLarge === true) {
      json(413, { error: `smart routes: 请求体超过 ${MAX_BODY_BYTES} 字节上限（路由值本身很短，请检查客户端）` })
      return
    }
    try {
      body = JSON.parse(read.text === '' ? '{}' : read.text)
    } catch {
      json(400, { error: 'smart routes: 请求体不是合法 JSON' })
      return
    }
  }

  try {
    const roots = deps.roots(sessionId)
    const missingRoot = () => json(503, {
      error: missingRootMessage(roots.primary),
      root: roots.primary,
      endpoints: ENDPOINTS,
    })

    if (relative === '/') {
      // "有数据吗"问的是**任何一个**候选根：产品里新任务是工作区的，老任务在 legacy
      // 根里，只探测 primary 会把"这台机器上还有老任务"误报成"什么都没有"。
      const exists = roots.candidates.some(root => existsSync(root))
      const config = deps.readRoutes(sessionId)
      json(200, {
        plugin: name,
        path: FLY_SMART_PATH,
        root: roots.primary,
        rootSource: roots.explicitSource ?? roots.workspaceSource ?? 'legacy',
        exists,
        routes: config,
        // 面板读到的配置随根 payload 一起回去：页面首屏不必再发一次 GET /routes。
        routeConfig: config,
        ...exists ? {} : { message: missingRootMessage(roots.primary) },
        endpoints: ENDPOINTS,
      })
      return
    }

    if (relative === '/routes') {
      if (!isWrite) {
        json(200, deps.readRoutes(sessionId))
        return
      }
      if (typeof deps.writeRoutes !== 'function') {
        json(503, {
          error: 'smart routes: 这个宿主没有可写的路由面（只读组合）—— 用 tool-fly-smart 行的 config 配置配对',
          path: deps.readRoutes(sessionId).path,
        })
        return
      }
      const payload = body
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        json(400, { error: 'smart routes: 请求体必须是一个 JSON 对象' })
        return
      }
      for (const key of Object.keys(payload)) {
        if (!['hand', 'review', 'role', 'scope', 'sessionId'].includes(key)) {
          json(400, { error: `smart routes: 未知字段 ${JSON.stringify(key)}（只认 hand / review / role / scope / sessionId）` })
          return
        }
      }
      const scope = payload.scope ?? 'session'
      if (scope !== 'session' && scope !== 'default') {
        json(400, { error: `smart routes: scope 只能是 "session" 或 "default"（收到 ${JSON.stringify(payload.scope)}）` })
        return
      }
      // 一条写路径服务两个角色：`role` 指名要写哪一条（缺省看有没有 review 字段，再退 hand）。
      // 老客户端的 `{ hand, scope, sessionId }` 因此逐字节照旧可用。
      const role = payload.role === 'review' || typeof payload.review === 'string' ? 'review' : 'hand'
      const value = payload[role]
      if (typeof value !== 'string') {
        json(400, { error: `smart routes: ${role} 必须是字符串（空串 = 删除该层的路由）` })
        return
      }
      const routeValue = value.trim()
      if (routeValue !== '' && parseRouteString(routeValue) === undefined) {
        json(400, { error: `smart routes: 路由值 ${JSON.stringify(routeValue)} 不合法 —— 期望 provider/model（可选 @effort），例如 deepseek/deepseek-flash` })
        return
      }
      const wanted = payload.sessionId ?? sessionId
      if (wanted !== null && wanted !== undefined && !isValidSessionId(wanted)) {
        json(400, { error: `smart routes: sessionId ${JSON.stringify(wanted)} 不可用（不能为空、不能含 / 或 .. 、不能有控制字符、不超过 200 字符）` })
        return
      }
      if (scope === 'session' && !isValidSessionId(wanted)) {
        json(400, { error: 'smart routes: 保存到本会话需要 sessionId（页面没能读到会话 id 时请改用"设为所有会话默认"）' })
        return
      }
      const written = deps.writeRoutes({ role, value: routeValue, hand: role === 'hand' ? routeValue : '', scope, sessionId: isValidSessionId(wanted) ? wanted : null })
      json(200, written)
      return
    }

    if (relative === '/tasks') {
      const anyRootExists = roots.candidates.some(root => existsSync(root))
      if (!anyRootExists) {
        missingRoot()
        return
      }
      if (roots.unknownWorkspace) {
        const legacyIndex = existsSync(roots.legacy) ? index(roots.legacy) : { source: 'none', tasks: [] }
        json(200, {
          root: roots.legacy,
          source: legacyIndex.source,
          tasks: [],
          legacyCount: legacyIndex.tasks.length,
          unknownWorkspace: true,
          message: unknownWorkspaceMessage(roots.legacy),
        })
        return
      }
      if (roots.explicit !== null) {
        const only = index(roots.explicit)
        json(200, { root: roots.explicit, source: only.source, tasks: only.tasks, legacyCount: 0 })
        return
      }
      // 工作区模式：本工作区的任务 + legacy 兼容根的计数与可读列表（同 id 工作区胜出）。
      const hasWorkspace = roots.workspace !== null && existsSync(roots.workspace)
      const workspaceIndex = hasWorkspace ? index(roots.workspace) : { source: 'none', tasks: [] }
      const legacyIndex = existsSync(roots.legacy) ? index(roots.legacy) : { source: 'none', tasks: [] }
      const seen = new Map()
      for (const row of [...workspaceIndex.tasks, ...legacyIndex.tasks]) if (!seen.has(row.id)) seen.set(row.id, row)
      const duplicateIds = workspaceIndex.tasks
        .filter(row => legacyIndex.tasks.some(other => other.id === row.id))
        .map(row => row.id)
      json(200, {
        root: hasWorkspace ? roots.workspace : roots.legacy,
        source: hasWorkspace ? workspaceIndex.source : legacyIndex.source,
        tasks: [...seen.values()],
        legacyCount: legacyIndex.tasks.length,
        legacyRoot: roots.legacy,
        ...duplicateIds.length === 0 ? {} : {
          note: `同 taskId 双根（工作区根优先）：${duplicateIds.join(', ')}`,
        },
      })
      return
    }

    // relative === '/task'
    const url = new URL(String(req?.url ?? '/'), 'http://127.0.0.1')
    const id = url.searchParams.get('id')
    // Refused before anything is joined into a path.
    if (id === null || !isSafeTaskId(id)) {
      json(400, {
        error: `smart: invalid task id ${JSON.stringify(id)} — expected /${ID_PATTERN.source}/ and no ".."`,
        root: roots.primary,
      })
      return
    }
    if (!roots.candidates.some(root => existsSync(root))) {
      missingRoot()
      return
    }
    const found = deps.locate(id, sessionId)
    if (found === null) {
      json(404, {
        error: `smart: no such task "${id}" under ${roots.candidates.map(root => join(root, 'tasks')).join(' or ')}`,
        root: roots.primary,
      })
      return
    }
    const task = detail(found.root, id)
    if (task === null) {
      json(404, { error: `smart: no such task "${id}" under ${join(found.root, 'tasks')}`, root: found.root })
      return
    }
    // Y7：state.rootDir 只当校验值 —— 它不决定读哪个根（那是磁盘扫描的事），
    // 不一致就要大声，因为那正是"复制任务目录 → 重定向写入"的指纹。
    const recorded = task.state?.rootDir
    const mismatch = typeof recorded === 'string' && recorded !== '' && resolve(recorded) !== resolve(found.root)
      ? { recorded, actual: found.root }
      : null
    if (mismatch !== null) note(`fly-smart-panel: task "${id}" state.rootDir=${mismatch.recorded} 与实际读根 ${mismatch.actual} 不一致`)
    json(200, {
      root: found.root,
      ...found.note === undefined ? {} : { note: found.note },
      ...mismatch === null ? {} : { rootDirMismatch: mismatch },
      ...task,
    })
  } catch (error) {
    if (error instanceof RouteWriteError) {
      json(error.status, { error: error.message })
      return
    }
    note(`fly-smart-panel: request failed: ${String(error?.message ?? error)}`)
    json(500, { error: `fly-smart-panel: read failed: ${String(error)}` })
  }
}

/**
 * Plugin body: publish the service and claim the route namespace.
 *
 * @param ctx - the Host plugin context.
 * @param rawConfig - the row's `config` object (`{ rootDir, brainRoute, handRoute }`).
 */
// ─────────────────────────────────────────────────────────────────────────────
// bundled skills（移植自 obra/superpowers，见 THIRD_PARTY_NOTICES.md）
//
// 技能放在**宿主平面**这一行：它们的价值是**零 smart 任务就能用** —— 修个 bug、
// 写段测试、声称完成，这些不需要开工作流。形状照 `dsh-plugin-fly-blackbox`：
// 注册一个 skill provider，从包内 `assets/<name>/` 读，别名即目录名。
// ─────────────────────────────────────────────────────────────────────────────

/** `assets/` 的绝对路径（打包版走真实路径，不是 SEA）。 */
const ASSETS_ROOT = fileURLToPath(new URL('./assets/', import.meta.url))

/** frontmatter 里必须有的两个键：`name` 与 `description`（技能目录只看 description）。 */
function skillFrontmatter(raw, path) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (block?.[1] === undefined) throw new Error(`fly-smart: ${path} has no YAML frontmatter`)
  const name = /^name:\s*(.+)$/mu.exec(block[1])?.[1]?.trim()
  const description = /^description:\s*(.+)$/mu.exec(block[1])?.[1]?.trim()
  if (name === undefined || name === '') throw new Error(`fly-smart: ${path} has no name`)
  if (description === undefined || description === '') throw new Error(`fly-smart: ${path} has no description`)
  return { name, description, content: raw.slice(block[0].length).trim() }
}

/**
 * Every bundled skill, listed once at startup.
 *
 * A missing or malformed `SKILL.md` throws here rather than silently dropping the
 * skill: "the skill is not in the catalog" is the exact failure the plugin exists
 * to prevent, and it must be loud.
 */
function bundledSkills() {
  const entries = readdirSync(ASSETS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  return entries.map(dirName => {
    const base = join(ASSETS_ROOT, dirName)
    const locator = join(base, 'SKILL.md')
    const raw = readFileSync(locator, 'utf8')
    const { name, description } = skillFrontmatter(raw, locator)
    return {
      name,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'fly-smart',
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: base },
      locator,
    }
  })
}

function smartSkillProvider() {
  const skills = bundledSkills()
  return {
    name: 'fly-smart',
    list: () => Promise.resolve(skills),
    async get(requested, options) {
      const { rank: _rank, locator: file, ...summary } = requested
      const raw = readFileSync(file, { encoding: 'utf8', signal: options?.signal })
      return { ...summary, content: skillFrontmatter(raw, file).content }
    },
  }
}

export function apply(ctx, rawConfig = {}) {
  const env = process.env
  const mirrorPath = resolveMirrorPath(env)
  const rowHand = readRowString(rawConfig?.handRoute)
  const rowReview = readRowString(rawConfig?.reviewRoute)

  // 行 ref 非空 = 脚本化硬底：启动时并进 default 层（永不删键）。行 ref 为空时
  // **一个字节都不写** —— 真实的 ~/.dsh-fly/smart-routes.json 是用户的配置，不是我们的草稿纸。
  ctx.effect(() => {
    if (rowHand === '') return
    try {
      mergeRowRoutes(mirrorPath, { hand: rowHand })
    } catch (error) {
      ctx.get?.('log')?.warn?.(`fly-smart-panel: route mirror merge failed: ${String(error?.message ?? error)}`)
    }
  }, 'fly-smart-panel: route mirror')

  const sessions = () => {
    try {
      // 可选链：宿主行没有声明 `inject: ['sessions']`（见 acceptance.md M4），
      // 拿不到就是"工作区未知"，而不是整块不渲染。
      return ctx.get?.('sessions')
    } catch {
      return undefined
    }
  }

  const rootsOf = sessionId => resolveRoots({ rawConfig, env, sessionId, sessions: sessions() })

  const service = Object.freeze({
    path: FLY_SMART_PATH,
    rootDir: resolveRootDir(rawConfig, env),
    legacyRoot: resolveLegacyRoot(),
    mirrorPath,
    activatedAt: new Date().toISOString(),
    endpoints: ENDPOINTS.map(endpoint => ({ ...endpoint })),
    roots: sessionId => rootsOf(sessionId),
    routes: sessionId => readRoutesConfig({ mirrorPath, rowHand, rowReview, sessionId }),
    tasks: sessionId => {
      const roots = rootsOf(sessionId)
      return roots.unknownWorkspace ? { source: 'unknown', tasks: [] } : readIndex(roots.primary)
    },
    locate: (id, sessionId) => locateTask(id, rootsOf(sessionId).candidates),
    task: (id, sessionId) => {
      const found = locateTask(id, rootsOf(sessionId).candidates)
      return found === null ? null : readTask(found.root, id)
    },
  })
  ctx.provide(FLY_SMART_SERVICE, service)

  const deps = {
    roots: rootsOf,
    readRoutes: sessionId => readRoutesConfig({ mirrorPath, rowHand, rowReview, sessionId }),
    writeRoutes: ({ role = 'hand', value = '', hand = value, scope, sessionId }) => writeRoutesConfig({ mirrorPath, rowHand, rowReview, role, value, hand, scope, sessionId }),
    locate: (id, sessionId) => locateTask(id, rootsOf(sessionId).candidates),
    readIndex,
    readTask,
    log: () => {
      try {
        return ctx.get?.('log')
      } catch {
        return undefined
      }
    },
  }

  // 自带技能：零 smart 任务即可用（修 bug / 写测试 / 声称完成都不必开工作流）。
  // **故意在注册时就展开全部技能**：少一个 SKILL.md 或 frontmatter 缺键 ⇒ 抛，
  // 而不是静默少一个技能 —— 「技能不在目录里」正是本插件要防的失败形状。
  ctx.skills.registerProvider(() => smartSkillProvider())

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: FLY_SMART_PATH,
      handler: (req, res) => answerSmartRequest(deps, req, res),
    }),
    'fly-smart-panel: /fly/smart/*',
  )
}

/** Re-exported for the route panel's own tests and for `formatRoute` consumers. */
export { formatRoute }
