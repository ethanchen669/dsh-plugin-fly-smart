/**
 * Contract tests for `lib/dispatch.mjs` — the part of the old workflow that survives.
 *
 * Four things are load-bearing here, each one a failure that has already happened:
 *
 *   1. **Parsing** — `provider/model[@effort]` and the object form land in the same
 *      fields, so callers never branch on shape.
 *   2. **The ladder** — preset row > `sessions[<id>]` > `default` > legacy key, with
 *      `source` reported (the review route's `*-fallback` is what a final review
 *      refuses; hiding it would resurrect "the executor audits itself").
 *   3. **The lazy read** — the route is re-read on every call: a mirror written
 *      *after* first resolution is used by the very next call. A cached route would
 *      make "saved in the panel" and "in effect" two different things.
 *   4. **One grammar, two planes** — the host-plane reader (`index.js`
 *      `readRoutesConfig`, which the panel serves) and `resolveRoute` must agree,
 *      value for value, on the same mirror. Two implementations drifting apart is
 *      how "the page says X, the tool uses Y" comes back.
 *
 * Every scratch directory is outside the repo and `HOME`/`DSH_FLY_SMART_ROUTES`
 * point into it (`tests/scratch-home.mjs`), so the developer's real routes file is
 * neither read nor written.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MIRROR_VERSION,
  currentHandRoute,
  currentReviewRoute,
  dispatchOnRoute,
  isAbsolutePath,
  missingRouteError,
  outputText,
  parseRouteValue,
  readMirrorLayers,
  mirrorHandRoute,
  resolveMirrorPath,
  resolveRoute,
  startChild,
} from '../lib/dispatch.mjs'
import { readRoutesConfig } from '../index.js'
import { SCRATCH_MIRROR } from './scratch-home.mjs'

/** Write one mirror document at the scratch path (creating the directory). */
function writeMirror(doc) {
  mkdirSync(dirname(SCRATCH_MIRROR), { recursive: true })
  writeFileSync(SCRATCH_MIRROR, JSON.stringify(doc, null, 2))
}

function cleanMirror() {
  rmSync(SCRATCH_MIRROR, { force: true })
}

/* ── 1. parsing ────────────────────────────────────────────────────────────── */

test('parseRouteValue: string form, object form and refusals agree', () => {
  assert.deepEqual(parseRouteValue('prov/model'), { provider: 'prov', model: 'model' })
  assert.deepEqual(parseRouteValue('prov/model@high'), { provider: 'prov', model: 'model', reasoningEffort: 'high' })
  assert.deepEqual(parseRouteValue({ provider: 'prov', model: 'model', reasoningEffort: 'low' }), { provider: 'prov', model: 'model', reasoningEffort: 'low' })
  // A model id may contain '/', the effort is the last '@'.
  assert.deepEqual(parseRouteValue('prov/vendor/model'), { provider: 'prov', model: 'vendor/model' })
  for (const bad of ['', ' ', 'noslash', '/model', 'prov/', undefined, null, 42, { provider: '', model: 'x' }]) {
    assert.equal(parseRouteValue(bad), undefined, `should refuse ${JSON.stringify(bad)}`)
  }
})

test('readMirrorLayers: v2 default, session layer and the legacy top-level key', () => {
  writeMirror({
    version: 2,
    default: { hand: 'p/m', review: 'p/r' },
    sessions: { 'session-1': { hand: 'p/s' }, 'bad/../id': { hand: 'p/x' }, 'session-2': { review: 'p/sr' } },
    hand: 'legacy/hand',
  })
  const layers = readMirrorLayers(SCRATCH_MIRROR)
  assert.equal(layers.version, 2)
  assert.equal(layers.exists, true)
  assert.deepEqual(layers.default, { provider: 'p', model: 'm' })
  assert.deepEqual(layers.review, { provider: 'p', model: 'r' })
  assert.deepEqual(layers.sessions['session-1'].hand, { provider: 'p', model: 's' })
  // The layer parses whatever is on disk; an unusable id simply never resolves
  // (validated at lookup time, so a stale entry cannot hijack a route).
  assert.equal(mirrorHandRoute(layers, 'bad/../id').source, 'default')
  assert.deepEqual(layers.legacy.hand, { provider: 'legacy', model: 'hand' })
  cleanMirror()
})

test('readMirrorLayers: a missing mirror is "not configured", not an error', () => {
  cleanMirror()
  const layers = readMirrorLayers(SCRATCH_MIRROR)
  assert.equal(layers.exists, false)
  assert.equal(layers.default, undefined)
  assert.deepEqual(layers.sessions, {})
})

/* ── 2. the ladder ─────────────────────────────────────────────────────────── */

test('the ladder: preset row wins, then session, then default, then the legacy key', () => {
  writeMirror({ version: 2, default: { hand: 'p/m' }, sessions: { 'session-1': { hand: 'p/s' } } })
  const session = { id: 'session-1' }

  assert.deepEqual(currentHandRoute({ config: { handRoute: { provider: 'row', model: 'x' } }, session }), {
    route: { provider: 'row', model: 'x' }, source: 'preset',
  })
  assert.deepEqual(currentHandRoute({ config: {}, session }), { route: { provider: 'p', model: 's' }, source: 'session' })
  assert.deepEqual(currentHandRoute({ config: {}, session: { id: 'session-9' } }), { route: { provider: 'p', model: 'm' }, source: 'default' })
  assert.deepEqual(currentHandRoute({ config: {}, session: { id: 'session-9' } }), { route: { provider: 'p', model: 'm' }, source: 'default' })
  cleanMirror()

  writeMirror({ hand: 'legacy/hand' })
  assert.deepEqual(currentHandRoute({ config: {}, session: { id: 'x' } }), {
    route: { provider: 'legacy', model: 'hand' }, source: 'default',
  }, 'the legacy top-level key is read as the default layer')
  cleanMirror()
})

test('the review ladder reports the fallback instead of hiding it', () => {
  writeMirror({ version: 2, default: { hand: 'p/m' } })
  // No review anywhere: the review route is the hand route, and `source` says so.
  assert.deepEqual(currentReviewRoute({ config: {}, session: { id: 'x' } }), {
    route: { provider: 'p', model: 'm' }, source: 'default-fallback',
  })
  writeMirror({ version: 2, default: { hand: 'p/m', review: 'p/r' } })
  assert.deepEqual(currentReviewRoute({ config: {}, session: { id: 'x' } }), {
    route: { provider: 'p', model: 'r' }, source: 'default',
  })
  // An explicit row review route is a `preset` source, never a fallback.
  assert.equal(currentReviewRoute({ config: { reviewRoute: { provider: 'row', model: 'r' } } }).source, 'preset')
  cleanMirror()
})

test('resolveRoute dispatches by role and refuses nothing on its own', () => {
  writeMirror({ version: 2, default: { hand: 'p/m', review: 'p/r' } })
  assert.deepEqual(resolveRoute({ role: 'hand' }), { route: { provider: 'p', model: 'm' }, source: 'default' })
  assert.deepEqual(resolveRoute({ role: 'review' }), { route: { provider: 'p', model: 'r' }, source: 'default' })
  cleanMirror()
  assert.equal(resolveRoute({ role: 'hand' }), null)
  const err = missingRouteError('hand', SCRATCH_MIRROR)
  assert.match(err.message, /handRoute/)
  assert.match(err.message, /三个来源/)
})

test('the lite role: same ladder, but NO fallback to hand (cost decision stays a decision)', () => {
  writeMirror({ version: 2, default: { hand: 'p/h', lite: 'p/l' }, sessions: { 'session-1': { lite: 'p/sl' } } })
  assert.deepEqual(resolveRoute({ role: 'lite' }), { route: { provider: 'p', model: 'l' }, source: 'default' })
  assert.deepEqual(resolveRoute({ role: 'lite', session: { id: 'session-1' } }), { route: { provider: 'p', model: 'sl' }, source: 'session' })

  // 只有 hand、没有 lite ⇒ null（**不**回落到 hand：机械活跑贵模型是用户没做的成本决定）
  writeMirror({ version: 2, default: { hand: 'p/h' } })
  assert.equal(resolveRoute({ role: 'lite' }), null)
  // review 的回落是语义豁免（评审可以复用 hand）；lite 的缺省是成本事故，两条规则故意不对称。
  assert.equal(resolveRoute({ role: 'review' }).source, 'default-fallback')

  cleanMirror()
  const err = missingRouteError('lite', SCRATCH_MIRROR)
  assert.match(err.message, /liteRoute/)
  assert.match(err.message, /三个来源/)
})

/* ── 3. the lazy read ──────────────────────────────────────────────────────── */

test('the route is re-read on every call — a later mirror write takes effect without a re-mount', () => {
  writeMirror({ version: 2, default: { hand: 'first/model' } })
  assert.deepEqual(resolveRoute({ role: 'hand' }).route, { provider: 'first', model: 'model' })

  writeMirror({ version: 2, default: { hand: 'second/model' } })
  assert.deepEqual(resolveRoute({ role: 'hand' }).route, { provider: 'second', model: 'model' },
    'a cached route would still say first/model')

  cleanMirror()
  assert.equal(resolveRoute({ role: 'hand' }), null, 'deleting the mirror is seen too')
})

/* ── 4. one grammar, two planes ────────────────────────────────────────────── */

test('the host reader and resolveRoute agree on the same mirror', () => {
  const cases = [
    { version: 2, default: { hand: 'p/m', review: 'p/r' }, sessions: { 'session-1': { hand: 'p/s' } } },
    { hand: 'legacy/hand' },
    { version: 2, default: { hand: 'p/m' } },
  ]
  for (const doc of cases) {
    writeMirror(doc)
    for (const sessionId of ['session-1', 'session-2', null]) {
      const config = readRoutesConfig({ mirrorPath: SCRATCH_MIRROR, sessionId })
      const ours = resolveRoute({ role: 'hand', session: sessionId === null ? undefined : { id: sessionId }, mirrorPath: SCRATCH_MIRROR })
      assert.equal(ours === null ? '' : `${ours.route.provider}/${ours.route.model}`, config.effective.hand,
        `hand route disagrees on ${JSON.stringify(doc)} / ${sessionId}`)
      assert.equal(ours === null ? null : ours.source, config.effective.source,
        `hand source disagrees on ${JSON.stringify(doc)} / ${sessionId}`)
    }
  }
  cleanMirror()
  assert.equal(MIRROR_VERSION, 2)
})

/* ── 5. dispatch: both host contracts, and the traps ───────────────────────── */

/** A subagent stub in the **0.2.x** shape: `result` is a method, dispose is async. */
function activationStub(seen) {
  return {
    startActivation: async request => {
      seen.push(request)
      return {
        childId: 'child-1',
        result: async () => ({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
        dispose: async () => { seen.push({ disposed: true }) },
      }
    },
  }
}

/** A subagent stub in the **0.1.x** shape: `start(name, request)` → run handle. */
function startStub(seen) {
  return {
    start: async (name, request) => {
      seen.push({ name, request })
      return {
        result: async () => ({ output: [{ type: 'text', text: 'old-host' }], stopReason: 'completed' }),
        dispose: async () => { seen.push({ disposed: true }) },
      }
    },
  }
}

/** 宿主校验身份用的那枚活 agent（`request.parent` 必须是它本身）。 */
const LIVE_PARENT = { id: 'session-live', session: { id: 'session-live' } }

test('dispatch honours both host contracts and passes the route as agentOptions', async () => {
  writeMirror({ version: 2, default: { hand: 'p/m' } })
  const seenNew = []
  const fresh = await dispatchOnRoute({ subagents: activationStub(seenNew), role: 'hand', prompt: 'hi', parent: LIVE_PARENT, mirrorPath: SCRATCH_MIRROR })
  assert.equal(fresh.text, 'done')
  assert.deepEqual(fresh.route, { provider: 'p', model: 'm' })
  assert.deepEqual(seenNew[0].request.agentOptions, { provider: 'p', model: 'm' })
  assert.equal(seenNew[0].provider, 'spawn')
  assert.equal(seenNew[0].delivery, 'caller')
  // 0.3.1 的真正缺陷：`request.parent` 没传 ⇒ 宿主里 `parent.id` 抛 TypeError。
  assert.equal(seenNew[0].request.parent, LIVE_PARENT, 'request.parent must be the live agent object itself')
  assert.ok(seenNew.some(entry => entry.disposed === true), 'the child is disposed')

  const seenOld = []
  const legacy = await dispatchOnRoute({ subagents: startStub(seenOld), role: 'hand', prompt: 'hi', parent: LIVE_PARENT, mirrorPath: SCRATCH_MIRROR })
  assert.equal(legacy.text, 'old-host')
  assert.equal(seenOld[0].name, 'spawn')
  assert.equal(seenOld[0].request.parent, LIVE_PARENT)
  assert.deepEqual(seenOld[0].request.agentOptions, { provider: 'p', model: 'm' })
  assert.ok(seenOld.some(entry => entry.disposed === true))
  cleanMirror()
})

test('dispatch refuses loudly: no route, no service, empty output, non-completed run', async () => {
  cleanMirror()
  await assert.rejects(
    () => dispatchOnRoute({ subagents: activationStub([]), role: 'hand', prompt: 'hi', parent: LIVE_PARENT, mirrorPath: SCRATCH_MIRROR }),
    /no hand model is configured/,
  )
  await assert.rejects(() => startChild(undefined, { label: 'x', prompt: 'p' }), /subagent service is not available/)
  await assert.rejects(() => startChild({}, { label: 'x', prompt: 'p', parent: LIVE_PARENT }), /neither startActivation\(\) nor start\(\)/)
  // 少了 parent ⇒ 我们自己的大声报错，不是宿主那句读不懂的 TypeError。
  await assert.rejects(
    () => startChild({ startActivation: async () => ({}) }, { label: 'x', prompt: 'p' }),
    /dispatch needs the calling agent as .request\.parent./,
  )

  writeMirror({ version: 2, default: { hand: 'p/m' } })
  const empty = {
    startActivation: async () => ({ childId: 'c', result: async () => ({ output: [], stopReason: 'completed' }), dispose: async () => {} }),
  }
  await assert.rejects(() => dispatchOnRoute({ subagents: empty, role: 'hand', prompt: 'hi', parent: LIVE_PARENT, mirrorPath: SCRATCH_MIRROR }), /returned nothing/)
  const failed = {
    startActivation: async () => ({ childId: 'c', result: async () => ({ output: [], stopReason: 'error', diagnostic: 'boom' }), dispose: async () => {} }),
  }
  await assert.rejects(() => dispatchOnRoute({ subagents: failed, role: 'hand', prompt: 'hi', parent: LIVE_PARENT, mirrorPath: SCRATCH_MIRROR }), /ended as "error": boom/)
  cleanMirror()
})

test('outputText skips non-text parts instead of stringifying proxies', () => {
  assert.equal(outputText([{ type: 'text', text: 'a' }, { type: 'tool' }, { type: 'text', text: 'b' }]), 'ab')
  assert.equal(outputText(undefined), '')
  assert.equal(outputText([{ type: 'text', text: 42 }]), '')
  assert.equal(isAbsolutePath('/a/b'), true)
  assert.equal(isAbsolutePath('a/b'), false)
  assert.equal(resolveMirrorPath({ DSH_FLY_SMART_ROUTES: SCRATCH_MIRROR }), SCRATCH_MIRROR)
})
