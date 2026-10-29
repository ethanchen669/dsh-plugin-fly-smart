/**
 * Fly smart — the model-route and dispatch core (agent plane).
 *
 * This module is **self-contained by design**: it is the part of the old workflow
 * plugin that survives the 0.3.0 slim-down, so it must not import anything from
 * `lib/state.mjs` (that file is deleted in the same release).
 *
 * Two responsibilities:
 *
 *   1. **Route resolution** — read the model pair the panel writes
 *      (`~/.dsh-fly/smart-routes.json`), with the preset row's own config as a hard
 *      floor and the legacy top-level `hand` key still readable. Resolution is
 *      **read fresh on every call**: the page saves the mirror and the next spawn
 *      must use the new pair, so a route captured at `apply()` would make "saved"
 *      and "in effect" two different things.
 *   2. **Child dispatch** — run one subagent on a resolved route. Both host
 *      contracts are honoured (`startActivation` on 0.2.x, `start` on 0.1.x) because
 *      this plugin gets installed into other people's profiles, where the host
 *      version is not ours to choose.
 *
 * @module dsh-plugin-fly-smart/dispatch
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * The route mirror the workbench writes and this plugin reads.
 *
 * ## Where it lives (and why not beside the root)
 *
 * The model pair is edited in the `fly.smart` right-drawer page, whose host row
 * (`dsh-plugin-fly-smart-panel`) writes a mirror file that this agent-plane plugin
 * reads: the two planes share no vocabulary, so the interface is a file. A fixed
 * location (`~/.dsh-fly/smart-routes.json`) — deriving it from a workspace root
 * would give every workspace its own file and the page would write A while the
 * tools read B. Overridable only for tests/headless boots via
 * `DSH_FLY_SMART_ROUTES`.
 */
export const ROUTES_FILE = 'smart-routes.json'

/** Absolute-path override for the mirror **file** (tests, headless). */
export const MIRROR_PATH_ENV = 'DSH_FLY_SMART_ROUTES'

/** The three-layer schema version this reader understands. */
export const MIRROR_VERSION = 2

/** Where the mirror lives: the env override, else `~/.dsh-fly/smart-routes.json`. */
export function resolveMirrorPath(env = process.env) {
  const configured = typeof env?.[MIRROR_PATH_ENV] === 'string' ? env[MIRROR_PATH_ENV].trim() : ''
  if (configured !== '') return resolve(configured)
  return join(homedir(), '.dsh-fly', ROUTES_FILE)
}

/**
 * Parse one route value: `"provider/model[@effort]"`, `{ provider, model }`, or empty.
 *
 * An object form carries `reasoningEffort` (the wire name the host uses); the
 * string form's suffix lands in the same field so callers never branch on shape.
 *
 * @param value - the raw value.
 * @returns a route, or undefined when nothing usable was given.
 */
export function parseRouteValue(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) {
    const { provider, model, reasoningEffort } = value
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return undefined
    return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
  }
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return undefined
  const cut = text.indexOf('/')
  if (cut <= 0 || cut === text.length - 1) return undefined
  const provider = text.slice(0, cut).trim()
  const rest = text.slice(cut + 1).trim()
  if (provider === '' || rest === '') return undefined
  const at = rest.indexOf('@')
  if (at <= 0) return { provider, model: rest }
  const model = rest.slice(0, at).trim()
  const effort = rest.slice(at + 1).trim()
  return model === '' ? undefined : effort === '' ? { provider, model } : { provider, model, reasoningEffort: effort }
}

/**
 * Read the mirror into its layers, tolerating every kind of "not there yet".
 *
 * A missing, unreadable or malformed mirror is not an error — it means "the user
 * has not chosen a pair", which the tools report loudly at call time. The
 * top-level `hand`/`brain` keys are the **legacy** layer: readers prefer
 * `default`, and the writer keeps the legacy key mirrored so an older agent
 * (which knows only that key) keeps working during the compatibility window.
 *
 * @param mirrorPath - absolute mirror path (defaults to the resolved location).
 * @returns `{ version, exists, default, review, defaultAt, sessions, legacy }`.
 */
export function readMirrorLayers(mirrorPath = resolveMirrorPath()) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  } catch {
    raw = null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
  const sessions = {}
  if (raw.sessions !== null && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)) {
    for (const [id, value] of Object.entries(raw.sessions)) {
      const hand = parseRouteValue(value?.hand)
      const review = parseRouteValue(value?.review)
      if (hand !== undefined || review !== undefined) sessions[id] = {
        ...hand === undefined ? {} : { hand },
        ...review === undefined ? {} : { review },
        at: typeof value?.at === 'string' ? value.at : null,
      }
    }
  }
  const v2Default = parseRouteValue(raw.default?.hand)
  const v3Review = parseRouteValue(raw.default?.review)
  const legacyHand = parseRouteValue(raw.hand)
  const legacyBrain = parseRouteValue(raw.brain)
  return {
    version: Number.isInteger(raw.version) ? raw.version : 1,
    exists: raw.version !== undefined || raw.hand !== undefined || raw.review !== undefined || raw.default !== undefined || raw.sessions !== undefined,
    default: v2Default ?? legacyHand,
    review: v3Review,
    defaultAt: typeof raw.default?.at === 'string' ? raw.default.at : typeof raw.at === 'string' ? raw.at : null,
    sessions,
    legacy: { hand: legacyHand, brain: legacyBrain },
  }
}

/**
 * The hand route a **session** resolves to inside the mirror.
 *
 * Read order is `sessions[<id>]` → `default` (which already fell back to the legacy
 * top-level key); the preset row's own config sits above both and is applied by the
 * caller, which is the only place that has it.
 *
 * An unusable session id is not an error: it means "no per-session layer", so the
 * call falls through to the default.
 *
 * @param layers - {@link readMirrorLayers} result.
 * @param sessionId - `exec.agent.session.id`, or undefined.
 * @returns `{ route, source }` or null.
 */
export function mirrorHandRoute(layers, sessionId) {
  const session = isUsableSessionId(sessionId) ? layers.sessions[sessionId] : undefined
  if (session !== undefined) return { route: session.hand, source: 'session' }
  if (layers.default !== undefined) return { route: layers.default, source: 'default' }
  return null
}

/**
 * Is this session id usable as a mirror key?
 *
 * Shape is **not** whitelisted: the engine mints `session-<n>` from a counter as
 * well as UUIDs, and CLI users pick their own ids. What is refused is what cannot
 * be a key at all — empty, overlong, separators, `..`, control characters. The
 * panel half pins the same rules, and a cross-package test walks one table through
 * both so they cannot drift.
 *
 * @param value - candidate id.
 * @returns whether the id may be used.
 */
export function isUsableSessionId(value) {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 200) return false
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false
  return true
}

/**
 * The full ladder for one call: preset row → mirror session → mirror default.
 *
 * @param input - `{ config, session, mirrorPath, env }`.
 * @returns `{ route, source }` or null when the user has configured nothing.
 */
export function currentHandRoute({ config = {}, session = undefined, mirrorPath = undefined, env = process.env } = {}) {
  if (config.handRoute !== undefined) return { route: config.handRoute, source: 'preset' }
  const layers = readMirrorLayers(mirrorPath ?? resolveMirrorPath(env))
  return mirrorHandRoute(layers, session?.id)
}

/**
 * The review route a **session** resolves to inside the mirror.
 *
 * Same shape as {@link mirrorHandRoute}, but with **no** review configured in the
 * mirror the caller may fall back to the hand route (that fallback is what
 * `source: '*-fallback'` reports, and the final review refuses it).
 */
export function mirrorReviewRoute(layers, sessionId) {
  const session = isUsableSessionId(sessionId) ? layers.sessions[sessionId] : undefined
  if (session?.review !== undefined) return { route: session.review, source: 'session' }
  if (layers.review !== undefined) return { route: layers.review, source: 'default' }
  return null
}

/**
 * Resolve the review route from row config, then the mirror, then the hand route.
 *
 * The fallback chain is reported, never hidden: `source` is `preset` / `session` /
 * `default` for an explicit review choice, and `<source>-fallback` when the review
 * route is really the hand one. Callers that must not accept a fallback (a final
 * review) check `source` themselves.
 */
export function currentReviewRoute({ config = {}, session = undefined, mirrorPath = undefined, env = process.env } = {}) {
  if (config.reviewRoute !== undefined) return { route: config.reviewRoute, source: 'preset' }
  if (config.handRoute !== undefined) return { route: config.handRoute, source: 'hand-fallback' }
  const layers = readMirrorLayers(mirrorPath ?? resolveMirrorPath(env))
  const review = mirrorReviewRoute(layers, session?.id)
  if (review !== null) return review
  const hand = mirrorHandRoute(layers, session?.id)
  if (hand !== null) return { ...hand, source: `${hand.source}-fallback` }
  return null
}

/**
 * Back-compat shim: the legacy shape `{ brain, hand }` of the mirror.
 *
 * Kept because the brain half of the pair is still readable (never written) from
 * the mirror: a user who configured the pair upstream keeps their brain route.
 * `consumer: null` elsewhere is the honest note that nothing reads `brain` for a
 * spawn.
 *
 * @param mirrorPath - absolute mirror path.
 * @returns `{ brain?, hand? }` in the old shape.
 */
export function readRoutesMirror(mirrorPath = resolveMirrorPath()) {
  const layers = readMirrorLayers(mirrorPath)
  return {
    ...layers.legacy.brain === undefined ? {} : { brain: layers.legacy.brain },
    ...layers.default === undefined ? {} : { hand: layers.default },
  }
}

/**
 * Resolve one role's route, **fresh on every call**.
 *
 * This is the single entry point the tools use: `role: 'hand'` for implementation
 * work, `role: 'review'` for an independent audit. The role names here are exactly
 * the roles the panel can configure — a name that the config surface cannot hold
 * would be a route that can never resolve.
 *
 * @param input - `{ role, config, session, mirrorPath, env }`.
 * @returns `{ route, source }` or null when nothing is configured for that role.
 */
export function resolveRoute({ role = 'hand', config = {}, session = undefined, mirrorPath = undefined, env = process.env } = {}) {
  if (role === 'review') return currentReviewRoute({ config, session, mirrorPath, env })
  return currentHandRoute({ config, session, mirrorPath, env })
}

/**
 * The error a tool throws when a role has no route configured.
 *
 * It names all three places the route can come from, because the user's fix
 * differs per deployment: a row config in a scripted run, the panel in the
 * desktop app, or the mirror file by hand when there is no panel at all.
 *
 * @param role - the role that failed to resolve.
 * @param mirrorPath - where the mirror would live.
 */
export function missingRouteError(role, mirrorPath = resolveMirrorPath()) {
  const field = role === 'review' ? 'reviewRoute' : 'handRoute'
  return new Error(
    `smart: no ${role} model is configured — 给 tool-fly-smart 的行配置加 ${field}: { provider, model }`
    + ` 三个来源任选其一：① 行配置 tool-fly-smart 的 config.${field}: { provider, model }；`
    + `② Fly 工作台「模型路由」卡里选（写 ${mirrorPath}）；`
    + `③ **没有面板时**手改镜像文件 ${mirrorPath}（JSON：{"${role === 'review' ? 'default' : 'default'}": {"${role === 'review' ? 'review' : 'hand'}": "provider/model"}}）。`,
  )
}

/**
 * Flatten a subagent result's output array into text.
 *
 * Upstream returns `{ output: [{ type: 'text', text }…], stopReason }`; anything
 * that is not a text part is skipped rather than stringified (a proxy object's
 * `toJSON` throws without inject, and that failure used to take a whole run down).
 *
 * @param output - the `output` array of a run result.
 * @returns the concatenated text.
 */
export function outputText(output) {
  if (!Array.isArray(output)) return ''
  return output
    .filter(part => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

/**
 * Run one child subagent on a resolved route and return its result.
 *
 * ## Why both contracts are here
 *
 * The host's subagent service changed shape in 0.2.x: `start(name, request)` gave
 * way to `startActivation({ provider, label, request, signal, delivery })`, which
 * returns `{ childId, result, dispose }` instead of `{ id, localAgent, result,
 * dispose }`. Plugins are installed into other people's profiles, so the host
 * version is not ours to choose — both are honoured, newest first.
 *
 * Two traps this function closes, both measured in production:
 *
 *   - `result` is a **method** (`result(): Promise<…>`), not a property. Awaiting
 *     the property awaited the function itself, and every caller then read
 *     `undefined` off it.
 *   - the activation handle carries a Cordis proxy (`localAgent`); passing it to
 *     `JSON.stringify` throws `cannot get property "toJSON" without inject`. Only
 *     `result`'s value leaves this function.
 *
 * @param subagents - the `subagents` service (`ctx.get('subagents')`).
 * @param input - `{ label, prompt, agentOptions, signal }`.
 * @returns the run result (`{ output, stopReason, diagnostic? }`).
 */
export async function startChild(subagents, { label, prompt, agentOptions, signal }) {
  if (subagents === null || typeof subagents !== 'object') {
    throw new Error('smart: the subagent service is not available in this session — cannot dispatch a child')
  }
  if (typeof subagents.startActivation === 'function') {
    const activation = await subagents.startActivation({
      provider: 'spawn',
      label,
      request: {
        prompt: [{ type: 'text', text: prompt }],
        parent: undefined,
        ...agentOptions === undefined ? {} : { agentOptions },
      },
      signal,
      // caller：只把结果交回调用方，不往父会话塞一条通知 —— 工具调用要的是同步结果。
      delivery: 'caller',
    })
    try {
      return await (typeof activation.result === 'function' ? activation.result() : activation.result)
    } finally {
      try { await activation.dispose() } catch { /* 释放失败不顶替结果判定 */ }
    }
  }
  if (typeof subagents.start === 'function') {
    const run = await subagents.start('spawn', {
      label,
      prompt: [{ type: 'text', text: prompt }],
      ...agentOptions === undefined ? {} : { agentOptions },
      signal,
    })
    try {
      return await (typeof run.result === 'function' ? run.result() : run.result)
    } finally {
      try { await run.dispose() } catch { /* disposal failure is not the caller's verdict */ }
    }
  }
  throw new Error('smart: the subagent service exposes neither startActivation() nor start() — cannot dispatch a child')
}

/**
 * Dispatch one child on a role's route and return `{ text, route, source }`.
 *
 * The route is resolved here (not by the caller) so that "read fresh" is a
 * property of the seam rather than a habit every caller has to remember.
 *
 * @param input - `{ subagents, role, prompt, label, config, session, mirrorPath, env }`.
 */
export async function dispatchOnRoute({ subagents, role = 'hand', prompt, label = 'smart_dispatch', config = {}, session = undefined, mirrorPath = undefined, env = process.env }) {
  const found = resolveRoute({ role, config, session, mirrorPath, env })
  if (found === null || found.route === undefined) throw missingRouteError(role, mirrorPath ?? resolveMirrorPath(env))
  const result = await startChild(subagents, { label, prompt, agentOptions: found.route, signal: undefined })
  if (result?.stopReason !== undefined && result.stopReason !== 'completed') {
    const detail = result?.diagnostic === undefined ? '' : `: ${result.diagnostic}`
    throw new Error(`smart: the ${role} model run "${label}" ended as "${result.stopReason}"${detail}`)
  }
  const text = outputText(result?.output)
  if (text.trim() === '') throw new Error(`smart: the ${role} model returned nothing for "${label}"`)
  return { text, route: found.route, source: found.source }
}

/** Whether an absolute path is usable as a document path. */
export function isAbsolutePath(value) {
  return typeof value === 'string' && value !== '' && isAbsolute(value)
}
