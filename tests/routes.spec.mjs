/**
 * Contract tests for the route configuration, across the two planes.
 *
 * The pair is edited in the `fly.smart` panel page, whose host row writes a mirror
 * file that the agent-plane tools read **lazily, per call**. What is asserted here is
 * everything that makes "saved" and "in effect" the same word:
 *
 *   1. **The ladder** — preset row > `sessions[<id>]` > `default` > legacy key, and a
 *      loud refusal when nothing is configured (never "silently use the parent model").
 *   2. **The lazy read** — a mirror written after `apply()` is used by the very next
 *      dispatch, with no re-mount.
 *   3. **One grammar, two planes** — the panel half (`panel/routes.mjs`) and the agent
 *      half (`lib/dispatch.mjs`) agree on parsing and on the resolved mirror path.
 *      Two implementations drifting apart is how "the page says X, the tool uses Y"
 *      came back before.
 *
 * Task-root behaviour (workspace roots, legacy task discovery) is gone with the 0.3.0
 * workflow and is not asserted here any more.
 *
 * Every scratch directory is outside the repo, `HOME` is a scratch home and the
 * mirror is an explicit scratch path (`tests/scratch-home.mjs`).
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  currentHandRoute,
  isUsableSessionId,
  parseRouteValue,
  readMirrorLayers,
  readRoutesMirror,
  resolveMirrorPath,
} from '../lib/dispatch.mjs'
import { SCRATCH_MIRROR } from './scratch-home.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 面板与工具**同一个包**（面板在 <root>/panel/，工具在 <root>/tools/）⇒ 就这一条。 */
function resolvePanelRoutes() {
  const candidates = [
    join(packageRoot, 'panel', 'routes.mjs'),
    join(packageRoot, '..', '..', 'dsh-fly', 'packages', 'dsh-plugin-fly-smart-panel', 'routes.mjs'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  // 不软跳过：路由契约是两个平面共用的承重面，找不到就得大声（AGENTS.md §1.2）。
  throw new Error(`找不到面板的 routes.mjs —— 两个平面共用这份路由契约。试过：${candidates.join(' / ')}`)
}
const panelRoutes = await import(pathToFileURL(resolvePanelRoutes()).href)

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

/** Load one fresh `apply()` of the tool surface (the module caches nothing). */
async function load(config = {}) {
  const mod = await import(`${pathToFileURL(join(packageRoot, 'tools', 'index.js')).href}?t=${Date.now()}`)
  const tools = new Map()
  const calls = { start: [] }
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition) },
    get: serviceName => serviceName === 'subagents' ? {
      start: async (provider, request) => {
        calls.start.push({ provider, request })
        return { result: async () => ({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' }), dispose: async () => {} }
      },
    } : undefined,
  }
  mod.apply(ctx, config)
  return { tools, calls }
}

const exec = (session = {}) => ({ signal: undefined, agent: { session } })
const call = (tools, name, args, session) => tools.get(name).execute(args, exec(session))

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

test('the mirror path and route parsing agree across packages', () => {
  // 常量相等是恒真的废断言（M16）；要断的是**解析后的路径相等**，包括相对值。
  for (const env of [{}, { DSH_FLY_SMART_ROUTES: SCRATCH_MIRROR }, { DSH_FLY_SMART_ROUTES: 'rel/dir/mirror.json' }, { DSH_FLY_SMART_ROUTES: './x/../y/mirror.json' }]) {
    assert.equal(resolveMirrorPath(env), panelRoutes.resolveMirrorPath(env), `mirror path differs for ${JSON.stringify(env)}`)
  }
  // 锁基目录跟着镜像走，且不在真实 ~/.dsh-fly 里（M1）。
  assert.equal(panelRoutes.mirrorLockPath(SCRATCH_MIRROR), join(dirname(SCRATCH_MIRROR), 'locks', 'smart-routes.json.lock'))

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
  rmSync(dirname(path), { recursive: true, force: true })
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

test('the hand route is read lazily: a later mirror write reaches the very next dispatch', async t => {
  scratch(t)
  const session = { id: 'session-lazy-1' }
  mirror(SCRATCH_MIRROR, v2({ sessionId: session.id, hand: 'openai/gpt-5.1-codex' }))
  const { tools, calls } = await load({})

  await call(tools, 'smart_dispatch', { prompt: 'first' }, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'openai', model: 'gpt-5.1-codex' })

  // 不重跑 apply()：页面把本会话的路由改成 mimo —— 下一次派发必须用新值。
  mirror(SCRATCH_MIRROR, v2({ sessionId: session.id, hand: 'llm-mioffice/xiaomi/mimo-v2.6-pro@high' }))
  await call(tools, 'smart_dispatch', { prompt: 'second' }, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'llm-mioffice', model: 'xiaomi/mimo-v2.6-pro', reasoningEffort: 'high' })

  // 再改 default（本会话那一层被清掉）：下一次派发跟 default 走，仍然不重挂载。
  mirror(SCRATCH_MIRROR, v2({ sessionId: 'some-other-session', hand: 'openai/x', def: 'deepseek/new-flash' }))
  await call(tools, 'smart_dispatch', { prompt: 'third' }, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'deepseek', model: 'new-flash' })
})

test('the row config outranks the mirror, and neither means a loud refusal', async t => {
  scratch(t)
  mirror(SCRATCH_MIRROR, v2({ sessionId: 'session-row', hand: 'openai/gpt-5.1-codex' }))
  const { tools, calls } = await load({ handRoute: { provider: 'deepseek', model: 'flash' } })
  const session = { id: 'session-row' }
  await call(tools, 'smart_dispatch', { prompt: 'x' }, session)
  assert.deepEqual(calls.start.at(-1).request.agentOptions, { provider: 'deepseek', model: 'flash' })

  // 没镜像、没行配置：调用时必须大声说清去哪儿配对，而不是静默用父模型。
  mirror(SCRATCH_MIRROR, { version: 2 })
  const { tools: bareTools, calls: bareCalls } = await load({})
  await assert.rejects(
    call(bareTools, 'smart_dispatch', { prompt: 'x' }, {}),
    error => {
      // 文案必须可移植：先给**任何 profile 都有**的行配置，再提面板抽屉，镜像绝对路径照给。
      assert.match(error.message, /handRoute/u)
      assert.match(error.message, /右抽屉/u)
      assert.ok(error.message.indexOf('handRoute') < error.message.indexOf('右抽屉'), error.message)
      assert.ok(error.message.includes(SCRATCH_MIRROR), `the message must name the absolute mirror path: ${error.message}`)
      return true
    },
  )
  assert.equal(bareCalls.start.length, 0)
})
