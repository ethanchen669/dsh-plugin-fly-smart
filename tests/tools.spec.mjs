/**
 * Contract tests for the slim tool surface (0.3.0): `smart_dispatch` + `smart_check_doc`.
 *
 * The 0.2.x suite asserted 14 workflow tools; asserting "two, no more" is the whole
 * point of the slim-down, so the first test is the registry itself. The rest pin the
 * failures that already happened once:
 *
 *   - **both host contracts** — `startActivation` (0.2.x, `result` is a *method*) and
 *     `start` (0.1.x); a stub in the wrong shape makes the suite green against a
 *     contract that does not exist;
 *   - **the route actually reaches `agentOptions`** — a route resolved and then
 *     dropped is "the panel says X, the tool uses the default";
 *   - **children cannot dispatch** — the host no longer restricts a child's tools, so
 *     the plugin has to refuse;
 *   - **the document checks report every gap** and refuse a relative path (the host
 *     cwd is `/` in the desktop shell; a relative path would read the wrong file).
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './scratch-home.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from '../tools/index.js'

/** A tools registry stub in the cordis shape `apply` sees. */
function toolHarness(services = {}) {
  const registered = new Map()
  const ctx = {
    tools: { register: definition => { registered.set(definition.name, definition) } },
    get: serviceName => services[serviceName],
  }
  apply(ctx, { handRoute: undefined, reviewRoute: undefined })
  return registered
}

/** The execution envelope a tool's `execute(args, exec)` receives. */
const execFor = (header = {}) => ({ agent: { session: { id: 'session-1', header } }, signal: undefined })

/** A 0.2.x subagent stub: `startActivation` → `{ childId, result(): Promise, dispose() }`. */
function activationStub(seen, text = 'ok') {
  return {
    startActivation: async request => {
      seen.push(request)
      return {
        childId: 'child-1',
        result: async () => ({ output: [{ type: 'text', text }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }
}

/** A 0.1.x subagent stub: `start(name, request)` → `{ result, dispose }`. */
function startStub(seen, text = 'old') {
  return {
    start: async (provider, request) => {
      seen.push({ provider, request })
      return { result: async () => ({ output: [{ type: 'text', text }], stopReason: 'completed' }), dispose: async () => {} }
    },
  }
}

const mirrorDir = mkdtempSync(join(tmpdir(), 'fly-smart-mirror-'))
const mirrorPath = join(mirrorDir, 'smart-routes.json')
writeFileSync(mirrorPath, JSON.stringify({ version: 2, default: { hand: 'p/m', review: 'p/r' } }))
process.env.DSH_FLY_SMART_ROUTES = mirrorPath

test('the registry is exactly two tools, and the plugin declares only the tools seat', () => {
  assert.equal(name, 'fly-smart')
  assert.deepEqual(inject, ['tools'], 'inject must shrink with the workflow: commands/systemPrompt are gone')
  const tools = toolHarness()
  assert.deepEqual([...tools.keys()].sort(), ['smart_check_doc', 'smart_dispatch'])
})

test('smart_dispatch runs on the configured hand route and reports route + source', async () => {
  const seen = []
  const tools = toolHarness({ subagents: activationStub(seen) })
  const tool = tools.get('smart_dispatch')
  const out = JSON.parse(await tool.execute({ prompt: 'do it' }, execFor()))
  assert.equal(out.text, 'ok')
  assert.deepEqual(out.route, { provider: 'p', model: 'm' })
  assert.equal(out.source, 'default')
  assert.deepEqual(seen[0].request.agentOptions, { provider: 'p', model: 'm' })
  assert.equal(seen[0].provider, 'spawn')
})

test('smart_dispatch honours the old host contract too', async () => {
  const seen = []
  const tools = toolHarness({ subagents: startStub(seen) })
  const out = JSON.parse(await tools.get('smart_dispatch').execute({ prompt: 'do it' }, execFor()))
  assert.equal(out.text, 'old')
  assert.equal(seen[0].provider, 'spawn')
  assert.deepEqual(seen[0].request.agentOptions, { provider: 'p', model: 'm' })
})

test('smart_dispatch role=review uses the review route', async () => {
  const tools = toolHarness({ subagents: activationStub([]) })
  const out = JSON.parse(await tools.get('smart_dispatch').execute({ prompt: 'audit', role: 'review' }, execFor()))
  assert.deepEqual(out.route, { provider: 'p', model: 'r' })
})

test('smart_dispatch role=lite uses the lite route and reports it', async () => {
  // smart_dispatch 每次现读 SCRATCH_MIRROR（工具面不收 mirrorPath），所以写那份。
  writeFileSync(mirrorPath, JSON.stringify({ version: 2, default: { hand: 'p/h', lite: 'p/l' } }))
  const tools = toolHarness({ subagents: activationStub([]) })
  const out = JSON.parse(await tools.get('smart_dispatch').execute({ prompt: 'scan it', role: 'lite' }, execFor()))
  assert.deepEqual(out.route, { provider: 'p', model: 'l' })
  assert.equal(out.source, 'default')
  // lite 不回落：没有 lite 层时大声报错，而不是静默用 hand（贵模型跑机械活）。
  writeFileSync(mirrorPath, JSON.stringify({ version: 2, default: { hand: 'p/h' } }))
  await assert.rejects(() => tools.get('smart_dispatch').execute({ prompt: 'scan it', role: 'lite' }, execFor()), /no lite model is configured/)
  writeFileSync(mirrorPath, JSON.stringify({ version: 2, default: { hand: 'p/m', review: 'p/r' } }))
})

test('smart_dispatch refuses: empty prompt, missing service, and a child session', async () => {
  const tools = toolHarness({ subagents: activationStub([]) })
  await assert.rejects(() => tools.get('smart_dispatch').execute({ prompt: '  ' }, execFor()), /non-empty `prompt`/)
  const noService = toolHarness({})
  await assert.rejects(() => noService.get('smart_dispatch').execute({ prompt: 'x' }, execFor()), /subagent service .* unavailable/)
  await assert.rejects(() => tools.get('smart_dispatch').execute({ prompt: 'x' }, execFor({ origin: 'subagent' })), /subagent child/)
  await assert.rejects(() => tools.get('smart_dispatch').execute({ prompt: 'x' }, execFor({ delegationDepth: 2 })), /subagent child/)
})

test('smart_check_doc reports every plan gap at once, and says ok on a complete plan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-doc-'))
  const bad = join(dir, 'plan.md')
  writeFileSync(bad, '# plan\n\n### Task 1: x\n\n- [ ] step\n')
  const tools = toolHarness()
  const failed = JSON.parse(await tools.get('smart_check_doc').execute({ path: bad }, execFor()))
  assert.equal(failed.ok, false)
  assert.equal(failed.kind, 'plan')
  assert.ok(failed.gaps.some(gap => gap.includes('Global Constraints')))
  assert.ok(failed.gaps.some(gap => gap.includes('Review Focus')))

  const good = join(dir, 'ok.md')
  writeFileSync(good, `# ok\n\n## Global Constraints\n\n1. x\n\n## Review Focus\n\n1. y\n\n### Task 1: a\n\n**Interfaces:**\n- Consumes: none\n- Produces: f()\n`)
  const passed = JSON.parse(await tools.get('smart_check_doc').execute({ path: good }, execFor()))
  assert.equal(passed.ok, true, passed.gaps.join('|'))
  rmSync(dir, { recursive: true, force: true })
})

test('smart_check_doc infers acceptance by suffix and refuses relative paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fly-smart-doc2-'))
  const file = join(dir, 'x-acceptance.md')
  writeFileSync(file, '# x 验收\n\n## 验收标准\n\n- [ ] **A1** —— 检查：跑测试；预期：全绿。\n')
  const tools = toolHarness()
  const out = JSON.parse(await tools.get('smart_check_doc').execute({ path: file }, execFor()))
  assert.equal(out.kind, 'acceptance')
  assert.equal(out.ok, true, out.gaps.join('|'))
  await assert.rejects(() => tools.get('smart_check_doc').execute({ path: 'docs/plans/x.md' }, execFor()), /ABSOLUTE path/)
  await assert.rejects(() => tools.get('smart_check_doc').execute({ path: join(dir, 'nope.md') }, execFor()), /no such file/)
  rmSync(dir, { recursive: true, force: true })
})
