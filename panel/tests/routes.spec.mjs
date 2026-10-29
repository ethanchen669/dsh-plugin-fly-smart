/**
 * Contract tests for the smart workbench's **configuration surface**
 * (`/fly/smart/routes`) and the status contract around it.
 *
 * This is the half of the feature that has to be right in the product: the page
 * writes the hand route and the agent plane reads it, so a wrong status code or a
 * half-written mirror is not a cosmetic bug. What is pinned here, in the order the
 * handler checks it:
 *
 *   404 unknown endpoint → 405 wrong method (+ derived `allow`) → 403 cross-site
 *   write → 415 non-JSON body → 413 body over the cap → 400 malformed route /
 *   unknown key / impossible session id / too many new sessions → 409 mirror lock.
 *
 * Plus the on-disk semantics: the v2 document with its legacy top-level mirror,
 * `""` as the only delete key, "same value is not rewritten" (so `at` never
 * lies), `0600` on the configuration file, and a lock that is always released.
 *
 * Every scratch path is outside the repo, `HOME` is a scratch home and the mirror
 * is an explicit scratch path (`tests/scratch-home.mjs`); the last test asserts the
 * developer's real mirror is byte-identical afterwards.
 *
 * Run: node --test packages/dsh-plugin-fly-smart-panel/tests/routes.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { REAL_MIRROR, REAL_MIRROR_BYTES, SCRATCH_MIRROR } from './scratch-home.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = await import(pathToFileURL(join(packageRoot, '..', 'index.js')).href)
const routes = await import(pathToFileURL(join(packageRoot, 'routes.mjs')).href)
// smart 抽成独立仓之后，它的 lib/ 不再住在 `packages/` 下 —— 走锁感知的解析
// （`packageDir`：本仓 packages/ 优先，其次按 plugins.lock.json 到 $FLY_PLUGINS_DIR 找）。
// 同仓了：面板与工具在**同一个包**里，直接相对解析（不再需要插件锁那套跨仓解析）。
const agentDispatch = await import(pathToFileURL(join(packageRoot, '..', 'lib', 'dispatch.mjs')).href)
const {
  MIRROR_VERSION,
  answerSmartRequest,
  readRoutesConfig,
  writeRoutesConfig,
} = host

const FIXTURE_ID = '20260928-120000-smart-panel'

/** A scratch directory that is removed when the test ends. */
function scratch(t, prefix = 'fly-smart-panel-routes-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A mirror path inside a fresh scratch directory. */
function scratchMirror(t) {
  return join(scratch(t), 'smart-routes.json')
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

/**
 * The handler's capabilities as `apply()` composes them (0.3.0: routes only).
 *
 * @param input - `{ mirrorPath, rowHand, rowReview, write, log }`.
 */
function makeDeps({ mirrorPath = SCRATCH_MIRROR, rowHand = '', rowReview = '', write = true, log = () => undefined } = {}) {
  return {
    readRoutes: sid => readRoutesConfig({ mirrorPath, rowHand, rowReview, sessionId: sid }),
    // 逐字段对齐 `apply()` 的真接线（role/value 都要过）：桩少传一个参数，测的就是另一份契约 ——
    // review 写入正是这样漏过了一整轮测试（面板发 role=review，桩把它丢掉，于是全绿）。
    ...write
      ? {
          writeRoutes: ({ role = 'hand', value = '', hand = value, scope, sessionId: sid }) =>
            writeRoutesConfig({ mirrorPath, rowHand, rowReview, role, value, hand, scope, sessionId: sid }),
        }
      : {},
    log,
  }
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

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')

// ── the status order ────────────────────────────────────────────────────────

test('an unknown endpoint is 404 before any method or body judgement', async () => {
  const deps = makeDeps({})
  const res = await call(deps, '/fly/smart/nope', { method: 'POST', body: 'not json' })
  assert.equal(res.status, 404)
  assert.match(res.json.error, /unknown smart endpoint/u)
  assert.equal(res.json.endpoints.length, 1, '0.3.0 answers exactly one endpoint')
})

test('wrong methods are 405 with a derived allow list, one route table, no duplication', async () => {
  const deps = makeDeps({})
  const deleteRoutes = await call(deps, '/fly/smart/routes', { method: 'DELETE' })
  assert.equal(deleteRoutes.status, 405)
  // POST 分支被删掉时这里会变成 'GET, HEAD' —— 那正是 A/B#1 的红。
  assert.equal(deleteRoutes.headers.allow, 'GET, HEAD, POST')

  const put = await call(deps, '/fly/smart/routes', { method: 'PUT' })
  assert.equal(put.status, 405)
  assert.equal(put.headers.allow, 'GET, HEAD, POST')

  const postRoot = await call(deps, '/fly/smart', { method: 'POST' })
  assert.equal(postRoot.status, 405)
  assert.equal(postRoot.headers.allow, 'GET, HEAD')

  // 已删的任务端点现在按"未知端点"处理，而不是 405 —— 路由表只有一份。
  const gone = await call(deps, '/fly/smart/tasks', { method: 'GET' })
  assert.equal(gone.status, 404)
})

test('a cross-site write is 403, kept apart from the 415 content-type refusal', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const body = JSON.stringify({ hand: 'deepseek/flash', scope: 'default' })

  const crossSite = await call(deps, '/fly/smart/routes', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', origin: 'http://cross-origin.invalid', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(crossSite.status, 403)
  assert.match(crossSite.json.error, /跨站/u)
  assert.equal(existsSync(mirrorPath), false, 'a refused write must not create the mirror')

  // 只有 sec-fetch-site（没有 Origin）也要拦 —— 有些客户端不带 Origin。
  const siteOnly = await call(deps, '/fly/smart/routes', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(siteOnly.status, 403)

  // 同源（或 Node fetch 这种完全没有来源头的）放行。
  const sameOrigin = await call(deps, '/fly/smart/routes', { method: 'POST', body, headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:1' } })
  assert.equal(sameOrigin.status, 200, sameOrigin.body)

  const noOrigin = await call(deps, '/fly/smart/routes', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
  assert.equal(noOrigin.status, 200)
  assert.equal(noOrigin.json.changed, false, '同值不重写')
})

test('415 for a non-JSON body, 413 for one over the cap, 400 for malformed JSON', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })

  const wrongType = await call(deps, '/fly/smart/routes', { method: 'POST', body: 'hand=deepseek/flash', headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongType.status, 415)
  assert.match(wrongType.json.error, /application\/json/u, 'the host writes the sentence; the client only echoes it')

  const tooBig = await call(deps, '/fly/smart/routes', { method: 'POST', body: `{"hand":"${'a'.repeat(4100)}"}`, headers: { 'content-type': 'application/json' } })
  assert.equal(tooBig.status, 413)
  assert.match(tooBig.json.error, /4096/u)

  const malformed = await call(deps, '/fly/smart/routes', { method: 'POST', body: '{ not json', headers: { 'content-type': 'application/json' } })
  assert.equal(malformed.status, 400)
  assert.match(malformed.json.error, /不是合法 JSON/u)

  assert.equal(existsSync(mirrorPath), false, 'none of the refusals may leave a file behind')
})

test('a rejected route leaves the mirror byte-identical', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const good = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'deepseek/deepseek-chat', scope: 'default' }), headers: { 'content-type': 'application/json' } })
  assert.equal(good.status, 200)
  const before = sha(mirrorPath)
  const beforeStat = statSync(mirrorPath)

  const cases = [
    [{ hand: 'no-slash', scope: 'default' }, /不合法/u],
    [{ hand: '/model', scope: 'default' }, /不合法/u],
    [{ hand: 'provider/', scope: 'default' }, /不合法/u],
    [{ hand: 'a/b', scope: 'nope' }, /scope/u],
    [{ hand: 'a/b', scope: 'default', extra: 1 }, /未知字段/u],
    [{ hand: 'a/b', scope: 'session', sessionId: '../../etc' }, /sessionId/u],
    [{ hand: 'a/b', scope: 'session' }, /sessionId/u],
    [{ hand: 7, scope: 'default' }, /hand/u],
    [[], undefined],
  ]
  for (const [payload, pattern] of cases) {
    const res = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } })
    assert.equal(res.status, 400, `${JSON.stringify(payload)} must be 400, got ${res.status} ${res.body}`)
    if (pattern !== undefined) assert.match(res.json.error, pattern)
  }
  assert.equal(sha(mirrorPath), before, 'a refused write must not touch the file (not even `at`)')
  assert.equal(statSync(mirrorPath).mtimeMs, beforeStat.mtimeMs, 'mtime must not lie about a refused write')
})

test('the mirror lock is a 409, and it is released in finally', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const lockPath = routes.mirrorLockPath(mirrorPath)
  mkdirSync(dirname(lockPath), { recursive: true })
  writeFileSync(lockPath, 'someone else\n')
  const busy = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'a/b', scope: 'default' }), headers: { 'content-type': 'application/json' } })
  assert.equal(busy.status, 409)
  assert.match(busy.json.error, /lock/u)
  assert.equal(existsSync(mirrorPath), false)

  // 陈旧锁（写者已死）→ 回收并继续，而不是把用户永久挡在门外。
  const old = new Date(Date.now() - 60_000)
  utimesSync(lockPath, old, old)
  const afterStale = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'a/b', scope: 'default' }), headers: { 'content-type': 'application/json' } })
  assert.equal(afterStale.status, 200, afterStale.body)
  assert.equal(existsSync(lockPath), false, 'the lock must be released in finally')

  // 写失败也不许留下锁：让镜像路径不可写（父目录是个文件），仍要释放。
  const blocked = join(scratch(t), 'blocked')
  writeFileSync(blocked, 'not a directory')
  const failing = makeDeps({ root: scratch(t), mirrorPath: join(blocked, 'x', 'smart-routes.json') })
  const res = await call(failing, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'a/b', scope: 'default' }), headers: { 'content-type': 'application/json' } })
  assert.equal(res.status, 500, res.body)
  assert.equal(existsSync(routes.mirrorLockPath(join(blocked, 'x', 'smart-routes.json'))), false)
})

test('a read-only composition answers 503 on POST — never a silent no-op', async t => {
  const deps = makeDeps({ root: scratch(t), write: false })
  const res = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'a/b', scope: 'default' }), headers: { 'content-type': 'application/json' } })
  assert.equal(res.status, 503)
  assert.match(res.json.error, /没有可写的路由面/u)
})

// ── the v2 document ────────────────────────────────────────────────────────

test('the review route is writable through the same handler the panel posts to', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const post = payload => call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } })

  // 面板就是发这个形状：role + review（不是 hand）。曾因宿主只认 hand/scope/sessionId 而 400 ——
  // 而桩当时把 role/value 丢掉，所以这条必须是**走真 handler**的回归。
  const written = await post({ review: 'llm-mioffice/xiaomi/mimo-v2.6-pro@high', role: 'review', scope: 'session', sessionId: 'session-review' })
  assert.equal(written.status, 200, written.body)
  assert.equal(written.json.source, 'session')

  const doc = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(doc.sessions['session-review'].review, 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')
  assert.equal(doc.sessions['session-review'].hand, undefined, '写 review 不许顺手造一条 hand')
  assert.equal(doc.hand, undefined, 'review 写入不动默认层')

  // 读回：面板首屏拿到的就是刚存的那条，且它是独立于 hand 的一层。
  const read = await call(deps, '/fly/smart/routes?sessionId=session-review')
  assert.equal(read.json.session.review, 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')
  assert.equal(read.json.effectiveReview.review, 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')
  assert.equal(read.json.effectiveReview.source, 'session')

  // hand 与 review 互不覆盖：同一会话先写 hand，再写 review，两条都在。
  await post({ hand: 'deepseek/deepseek-flash', scope: 'session', sessionId: 'session-review' })
  const both = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(both.sessions['session-review'].hand, 'deepseek/deepseek-flash')
  assert.equal(both.sessions['session-review'].review, 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')

  // review 也能删：空串只清掉 review 这一半，hand 留着。
  await post({ review: '', role: 'review', scope: 'session', sessionId: 'session-review' })
  const cleared = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(cleared.sessions['session-review'].review, undefined)
  assert.equal(cleared.sessions['session-review'].hand, 'deepseek/deepseek-flash')

  // review 走"所有会话默认"这一层，且默认层照样带兼容双写。
  const asDefault = await post({ review: 'deepseek/deepseek-reasoner', role: 'review', scope: 'default' })
  assert.equal(asDefault.json.source, 'default')
  const withDefault = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(withDefault.default.review, 'deepseek/deepseek-reasoner')
  assert.equal(withDefault.hand, undefined, '只有 review 时不该伪造顶层 hand')

  // 护栏还在：真未知字段依然 400，且错误文案点名允许的字段。
  const bogus = await post({ nope: 'x', scope: 'default' })
  assert.equal(bogus.status, 400)
  assert.match(bogus.json.error, /未知字段 "nope"/u)
  assert.match(bogus.json.error, /review/u, '错误文案必须列出 review，否则用户不知道新字段存在')
})

test('the lite role is writable through the same handler and survives a session write', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ mirrorPath })
  const post = payload => call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } })

  const def = await post({ lite: 'cheap/fast', role: 'lite', scope: 'default' })
  assert.equal(def.status, 200, def.text)
  assert.equal(def.json.source, 'default')
  assert.equal(JSON.parse(readFileSync(mirrorPath, 'utf8')).default.lite, 'cheap/fast')

  const ses = await post({ lite: 'cheap/session', role: 'lite', scope: 'session', sessionId: 'session-9' })
  assert.equal(ses.json.source, 'session')
  const doc = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(doc.sessions['session-9'].lite, 'cheap/session')
  assert.equal(doc.default.lite, 'cheap/fast', 'a session write must not disturb the default layer')

  const read = await call(deps, '/fly/smart/routes?sessionId=session-9')
  assert.equal(read.json.effectiveLite.lite, 'cheap/session')
  assert.equal(read.json.effectiveLite.source, 'session')
})

test('the v2 document: three layers, the legacy top-level mirror, and `""` as the only delete', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const post = payload => call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } })

  const first = await post({ hand: 'deepseek/deepseek-flash', scope: 'default' })
  assert.equal(first.status, 200)
  assert.deepEqual(Object.keys(first.json).sort(), ['at', 'changed', 'effectiveFromPanel', 'path', 'sessionKnown', 'source'])
  assert.equal(first.json.changed, true)
  assert.equal(first.json.source, 'default')

  const doc = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(doc.version, MIRROR_VERSION)
  assert.equal(doc.default.hand, 'deepseek/deepseek-flash')
  // 兼容窗双写：老 agent 只认顶层 hand。
  assert.equal(doc.hand, 'deepseek/deepseek-flash')
  assert.match(doc.default.at, /^\d{4}-\d{2}-\d{2}T/u)
  // 面板只写 hand —— 镜像里没有 brain 层（§0.2：本页只写 hand）。
  assert.equal(doc.brain, undefined)

  const session = await post({ hand: 'llm-mioffice/xiaomi/mimo-v2.6-pro@high', scope: 'session', sessionId: 'session-abc' })
  assert.equal(session.json.source, 'session')
  const withSession = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(withSession.sessions['session-abc'].hand, 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')
  assert.equal(withSession.default.hand, 'deepseek/deepseek-flash', 'a session write must not disturb the default layer')

  // 同值不重写：at 与 mtime 都不撒谎。
  const beforeMtime = statSync(mirrorPath).mtimeMs
  const again = await post({ hand: 'deepseek/deepseek-flash', scope: 'default' })
  assert.equal(again.json.changed, false)
  assert.equal(statSync(mirrorPath).mtimeMs, beforeMtime)
  assert.equal(again.json.at, first.json.at, 'the reported `at` is the existing layer timestamp')

  // 未知顶层键（老的 brain）不许被删掉。
  const raw = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  raw.brain = 'legacy/brain-model'
  writeFileSync(mirrorPath, `${JSON.stringify(raw, null, 2)}\n`)
  await post({ hand: 'deepseek/other', scope: 'default' })
  assert.equal(JSON.parse(readFileSync(mirrorPath, 'utf8')).brain, 'legacy/brain-model')

  // 显式空串 = 删该层。
  const cleared = await post({ hand: '', scope: 'session', sessionId: 'session-abc' })
  assert.equal(cleared.json.changed, true)
  assert.equal(JSON.parse(readFileSync(mirrorPath, 'utf8')).sessions?.['session-abc'], undefined)

  // default 也清掉 → 两层皆空 → 删文件。
  const clearedDefault = await post({ hand: '', scope: 'default' })
  assert.equal(clearedDefault.json.changed, true)
  assert.equal(existsSync(mirrorPath), false, 'both layers empty means the file goes away')
})

test('a legacy v1 mirror is read as the default layer and upgraded in place', async t => {
  const mirrorPath = scratchMirror(t)
  mkdirSync(dirname(mirrorPath), { recursive: true })
  writeFileSync(mirrorPath, `${JSON.stringify({ brain: 'llm-mioffice/xiaomi/mimo-v2.6-pro', hand: 'llm-mioffice/deepseek/deepseek-flash', at: '2026-09-30T12:58:00.000Z' }, null, 2)}\n`)
  const deps = makeDeps({ root: scratch(t), mirrorPath })

  const read = await call(deps, '/fly/smart/routes')
  assert.equal(read.status, 200)
  assert.equal(read.json.default.hand, 'llm-mioffice/deepseek/deepseek-flash')
  assert.equal(read.json.brain.value, 'llm-mioffice/xiaomi/mimo-v2.6-pro', 'legacy brain is reported read-only')
  assert.equal(read.json.brain.consumer, null)

  const wrote = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'deepseek/new', scope: 'session', sessionId: 'session-1' }), headers: { 'content-type': 'application/json' } })
  assert.equal(wrote.status, 200)
  const doc = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(doc.version, 2)
  assert.equal(doc.default.hand, 'llm-mioffice/deepseek/deepseek-flash', 'the legacy hand becomes the default layer')
  assert.equal(doc.hand, 'llm-mioffice/deepseek/deepseek-flash', 'and stays mirrored at the top level')
})

test('the session cap blocks new keys only, and never rewrites an existing one', async t => {
  const mirrorPath = scratchMirror(t)
  mkdirSync(dirname(mirrorPath), { recursive: true })
  const sessions = {}
  for (let index = 0; index < 200; index += 1) sessions[`session-${index}`] = { hand: 'a/b', at: '2026-10-01T00:00:00.000Z' }
  writeFileSync(mirrorPath, `${JSON.stringify({ version: 2, default: { hand: 'd/e', at: '2026-10-01T00:00:00.000Z' }, sessions, hand: 'd/e' })}\n`)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const before = sha(mirrorPath)

  const tooMany = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'x/y', scope: 'session', sessionId: 'session-brand-new' }), headers: { 'content-type': 'application/json' } })
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.json.error, /上限 200/u)
  assert.equal(sha(mirrorPath), before)

  const existing = await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'x/y', scope: 'session', sessionId: 'session-7' }), headers: { 'content-type': 'application/json' } })
  assert.equal(existing.status, 200, existing.body)
  assert.equal(existing.json.changed, true)
})

test('the configuration file is 0600, written atomically, with pid+random temp names', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  await call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'a/b', scope: 'default' }), headers: { 'content-type': 'application/json' } })
  assert.equal(statSync(mirrorPath).mode & 0o777, 0o600, 'the route file must not be group/world readable')

  // 不留 temp 文件；temp 名带 pid + 随机（同毫秒并发写入不能撞名）。
  const leftovers = readdirSync(dirname(mirrorPath)).filter(name => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
  const source = readFileSync(join(packageRoot, 'routes.mjs'), 'utf8')
  assert.match(source, /tmp-\$\{process\.pid\}-\$\{Date\.now\(\)\}-\$\{randomBytes\(4\)/u)

  // 打 20 发并发同值 POST：第一发 changed:true，其余 false；文件始终可解析。
  const results = await Promise.all(Array.from({ length: 20 }, () => call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'deepseek/deepseek-chat', scope: 'default' }), headers: { 'content-type': 'application/json' } })))
  assert.deepEqual(results.map(res => res.status), Array(20).fill(200))
  assert.equal(results.filter(res => res.json.changed).length, 1, 'same value: exactly one write')
  const final = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(final.default.hand, 'deepseek/deepseek-chat')
})

test('mixed concurrent writes converge on one legal document (no half files)', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ root: scratch(t), mirrorPath })
  const values = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5']
  const legal = new Set(values)
  const shasums = new Set()
  const results = await Promise.all(values.map(value => call(deps, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: value, scope: 'default' }), headers: { 'content-type': 'application/json' } })))
  for (const value of values) {
    // 每一次写入之后观察到的文件都必须是一个合法文档（这里只能看终态 + 每次写入都是原子的）。
    const doc = JSON.parse(readFileSync(mirrorPath, 'utf8'))
    assert.ok(legal.has(doc.default.hand), `terminal document is legal: ${doc.default.hand}`)
    shasums.add(sha(mirrorPath))
  }
  assert.deepEqual(results.map(res => res.status), Array(values.length).fill(200))
  assert.equal(JSON.parse(readFileSync(mirrorPath, 'utf8')).default.hand, values.at(-1), 'the last successful write wins')
  assert.equal(readdirSync(dirname(mirrorPath)).some(name => name.includes('.tmp-')), false)
})

// ── read-side semantics ────────────────────────────────────────────────────

test('reconcile-on-read folds a non-empty row ref into the default layer, and an empty ref writes nothing', async t => {
  const mirrorPath = scratchMirror(t)
  mkdirSync(dirname(mirrorPath), { recursive: true })

  // 空 ref：字节不变，连文件都不创建。
  const silent = makeDeps({ root: scratch(t), mirrorPath, rowHand: '' })
  const read = await call(silent, '/fly/smart/routes')
  assert.equal(read.status, 200)
  assert.equal(existsSync(mirrorPath), false)

  // 非空 ref：GET 之后 default.hand == ref（脚本化硬底压过镜像）。
  const pinned = makeDeps({ root: scratch(t), mirrorPath, rowHand: 'llm-mioffice/deepseek/deepseek-flash' })
  const reconciled = await call(pinned, '/fly/smart/routes')
  assert.equal(reconciled.json.presetRow.effective, true)
  assert.equal(reconciled.json.effective.source, 'preset')
  assert.equal(reconciled.json.effectiveFromPanel, false, 'preset 行非空 → 面板写的东西到不了工具面')
  assert.equal(JSON.parse(readFileSync(mirrorPath, 'utf8')).default.hand, 'llm-mioffice/deepseek/deepseek-flash')

  // POST 答复也必须说实话：面板保存成功，但 effective 仍是 preset。
  const post = await call(pinned, '/fly/smart/routes', { method: 'POST', body: JSON.stringify({ hand: 'openai/x', scope: 'session', sessionId: 'session-1' }), headers: { 'content-type': 'application/json' } })
  assert.equal(post.status, 200)
  assert.equal(post.json.changed, true)
  assert.equal(post.json.effectiveFromPanel, false)
  assert.equal(post.json.source, 'preset')
  assert.equal(post.json.sessionKnown, true)
})

test('the root payload carries the same routeConfig as GET /routes (one request for first paint)', async t => {
  const mirrorPath = scratchMirror(t)
  const deps = makeDeps({ mirrorPath })
  const boot = await call(deps, '/fly/smart?sessionId=session-1')
  const direct = await call(deps, '/fly/smart/routes?sessionId=session-1')
  assert.deepEqual(boot.json.routeConfig, direct.json)
  assert.deepEqual(boot.json.endpoints.map(entry => entry.path), ['/fly/smart/routes'])
})

test('the session id table agrees with the agent half, character for character', () => {
  const rejected = ['', '..', 'a/b', 'a\\b', `x${String.fromCharCode(0)}y`, 'x'.repeat(201), null, 7, undefined]
  const accepted = ['session-3f2a1c88-1f1e-4a1f-9f4d-2a4a1c881f1e', '3f2a1c88-1f1e-4a1f-9f4d-2a4a1c881f1e', 'session-7', 'my-custom-id', 'x'.repeat(200)]
  for (const value of [...rejected, ...accepted]) {
    assert.equal(routes.isValidSessionId(value), agentDispatch.isUsableSessionId(value), `panel/agent disagree on ${JSON.stringify(value)}`)
  }
  for (const value of rejected) assert.equal(routes.isValidSessionId(value), false)
  for (const value of accepted) assert.equal(routes.isValidSessionId(value), true)
})

test('the developer’s real mirror is never read-modified by this suite', () => {
  const now = (() => {
    try {
      return readFileSync(REAL_MIRROR)
    } catch {
      return null
    }
  })()
  assert.deepEqual(now, REAL_MIRROR_BYTES, 'the suite must leave ~/.dsh-fly/smart-routes.json byte-identical')
  assert.equal(SCRATCH_MIRROR.includes('.dsh-fly'), false, 'the scratch mirror is not under a real home')
})

test('a volatile row field arrives as a reference box, and the panel reads through it', t => {
  // The panel row declares `brainRoute`/`handRoute` with `.volatile()` (the upstream
  // Settings form needs them), and the engine hands `apply()` a **ref**, not a
  // string — the engine reads its own the same way (`dsh-agent-preset-registry`:
  // `this.config.selectedDefault.get()`). `typeof field === 'string'` is therefore
  // always false: the row looked empty, so "the row outranks the page" was silently
  // dead in the real app while every spec that passed a plain object stayed green.
  const box = { get: () => 'llm-mioffice/xiaomi/mimo-v2.6-pro@high' }
  assert.equal(host.readRowString(box), 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')
  // Plain values (non-volatile fields like our `rootDir`) still work…
  assert.equal(host.readRowString('  llm-mioffice/x/deepseek-flash '), 'llm-mioffice/x/deepseek-flash')
  // …and a box that holds nothing is empty, not the string "[object Object]".
  assert.equal(host.readRowString({ get: () => undefined }), '')
  assert.equal(host.readRowString({}), '')
  assert.equal(host.readRowString(undefined), '')
  assert.equal(host.readRowString(null), '')
  assert.equal(host.readRowString(42), '')

  // The read has to reach the route surface: a boxed row value pins the effective
  // route and forbids the page from claiming its own write takes effect.
  const mirrorPath = join(scratch(t), 'mirror', 'smart-routes.json')
  const config = readRoutesConfig({ mirrorPath, rowHand: host.readRowString(box), sessionId: null })
  assert.equal(config.presetRow.effective, true)
  assert.equal(config.effective.source, 'preset')
  assert.equal(config.effective.hand, 'llm-mioffice/xiaomi/mimo-v2.6-pro@high')
  assert.equal(config.effectiveFromPanel, false, 'a pinned row means the page is not the effective source')
})

test('a boxed row handRoute reaches the mirror at mount, not just the reader', async t => {
  // The other half of the same bug: `apply()` merges a non-empty row into the mirror
  // at boot. Reading the ref wrong made that a silent no-op — the row user's choice
  // never reached the file the agent half reads.
  const mirrorPath = join(scratch(t), 'boot', 'smart-routes.json')
  const previous = process.env.DSH_FLY_SMART_ROUTES
  process.env.DSH_FLY_SMART_ROUTES = mirrorPath
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_FLY_SMART_ROUTES
    else process.env.DSH_FLY_SMART_ROUTES = previous
  })
  const registered = []
  host.apply({
    provide: () => {},
    effect: callback => callback(),
    webServer: { register: options => { registered.push(options); return () => {} } },
    skills: { registerProvider: () => {} },
  }, { handRoute: { get: () => 'llm-mioffice/deepseek/deepseek-flash' } })

  assert.equal(registered.length, 1)
  assert.equal(existsSync(mirrorPath), true, 'the row hand route must land in the mirror at mount')
  const document = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  assert.equal(document.version, MIRROR_VERSION)
  assert.equal(document.default.hand, 'llm-mioffice/deepseek/deepseek-flash')
  // Legacy top-level echo stays in sync for an older agent half.
  assert.equal(document.hand, 'llm-mioffice/deepseek/deepseek-flash')
})
