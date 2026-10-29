/**
 * The route mirror, v2 — the one configuration surface both planes share.
 *
 * ## Why a file at all
 *
 * The model pair is edited in the `fly.smart` workbench (host plane) but consumed
 * by the tools (agent plane, `dsh-plugin-fly-smart`). The two planes share no
 * vocabulary, so the interface is a file. Since this page became an *editor* and
 * not just a viewer, the file also has to answer two questions the v1 shape could
 * not:
 *
 *   1. **Which session was this for?** The hand route is per-session by default
 *      (`sessions[<id>]`), because the page is opened beside one session and
 *      "make it the default for every session" must be a separate, deliberate act.
 *   2. **Who wins?** The scripting plane (`tool-fly-smart` row config) is the
 *      hard floor, then this session, then the mirror default.
 *
 * ## v2 schema (frozen; see acceptance.md §2)
 *
 * ```json
 * { "version": 2,
 *   "default":  { "hand": "openrouter/deepseek/deepseek-chat", "at": "…" },
 *   "sessions": { "session-<uuid>": { "hand": "…@high", "at": "…" } },
 *   "hand": "…" }
 * ```
 *
 * `hand` at the top level is the **legacy mirror** of `default.hand`: an engine
 * whose `dsh-plugin-fly-smart` predates v2 reads only that key, and it is the only
 * thing standing between an upgraded panel and "no hand model is configured" in
 * every session. The downgrade path exists in exactly that one direction (the old
 * *panel* could never write the mirror at all — `typeof ref === 'string'` is false
 * for a schema ref, so no old panel can damage v2 keys).
 *
 * ## Paths are not derived from the task root
 *
 * v1 put the mirror *beside* the smart root (`dirname(rootDir)/smart-routes.json`).
 * That was fine while the root was one fixed directory; now that the root is the
 * session's workspace (`<workspace>/.dsh-fly/smart`), deriving the mirror from it
 * would give every workspace its own route file — the panel would write A while
 * the agent read B, silently, with every route resolving to nothing. The mirror
 * therefore lives at a **fixed** location (`~/.dsh-fly/smart-routes.json`), and
 * the lock directory follows the mirror so a test override cannot reach back into
 * the real one (`acceptance.md` M1).
 *
 * @module dsh-plugin-fly-smart-panel/routes
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** The mirror file name. The agent half pins the same constant (`lib/dispatch.mjs`). */
export const ROUTE_MIRROR_FILE = 'smart-routes.json'

/** Absolute-path override for the mirror **file** (tests, headless). */
export const MIRROR_PATH_ENV = 'DSH_FLY_SMART_ROUTES'

/** The v2 schema version written by every writer here. */
export const MIRROR_VERSION = 2

/** How long a lock file may sit untouched before it is treated as a corpse. */
export const LOCK_STALE_MS = 10_000

/** Largest POST body accepted on `/fly/smart/routes` (bytes). */
export const MAX_BODY_BYTES = 4_096

/** How many sessions the mirror may hold before new keys are refused. */
export const MAX_SESSIONS = 200

/**
 * Where the mirror lives.
 *
 * Deliberately **not** `dirname(taskRoot)`: the task root is per-workspace now, so
 * that derivation would split the configuration across workspaces.
 *
 * @param env - process environment (injectable for tests).
 * @returns an absolute path.
 */
export function resolveMirrorPath(env = process.env) {
  const configured = typeof env?.[MIRROR_PATH_ENV] === 'string' ? env[MIRROR_PATH_ENV].trim() : ''
  if (configured !== '') return resolve(configured)
  return join(homedir(), '.dsh-fly', ROUTE_MIRROR_FILE)
}

/**
 * The lock guarding one mirror. Lives in a `locks/` directory beside the mirror
 * file, so overriding the mirror (tests) also moves the lock out of `~/.dsh-fly`.
 *
 * @param mirrorPath - absolute mirror path.
 * @returns an absolute lock path.
 */
export function mirrorLockPath(mirrorPath = resolveMirrorPath()) {
  return join(dirname(mirrorPath), 'locks', `${ROUTE_MIRROR_FILE}.lock`)
}

/**
 * Parse `"provider/model[@effort]"` exactly the way the agent half does
 * (`lib/dispatch.mjs`'s `parseRouteValue`); a cross-package test pins the two together.
 *
 * @param value - candidate string.
 * @returns `{ provider, model, reasoningEffort? }`, or undefined.
 */
export function parseRouteString(value) {
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

/** `provider/model[@effort]` — the text form both planes agree on. */
export function formatRoute(route) {
  if (route === undefined || route === null) return ''
  const base = `${route.provider}/${route.model}`
  return route.reasoningEffort === undefined ? base : `${base}@${route.reasoningEffort}`
}

/**
 * A session id we are willing to use as a JSON key.
 *
 * Shape is **not** whitelisted: the engine mints `session-<n>` from a counter
 * (`dsh-session` package `lib/index.js:1648`) as well as UUIDs, and CLI users pick
 * their own ids. What is refused is what cannot be a key at all — empty, overlong,
 * separators, `..`, control characters (`acceptance.md` M13).
 *
 * @param value - candidate id.
 * @returns whether the id may be used.
 */
export function isValidSessionId(value) {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 200) return false
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false
  return true
}

/**
 * Read the mirror into layers, tolerating every kind of "not there yet".
 *
 * A malformed file reads as "no routes configured", which the agent already
 * reports loudly at call time — the panel must not refuse to render because a
 * hand-edited JSON lost a brace.
 *
 * @param mirrorPath - absolute mirror path.
 * @returns `{ raw, sessions, defaultHand, defaultAt, legacyBrain }`.
 */
export function readMirrorDocument(mirrorPath = resolveMirrorPath()) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(mirrorPath, 'utf8'))
  } catch {
    raw = null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) raw = {}

  const sessions = {}
  const rawSessions = raw.sessions
  if (rawSessions !== null && typeof rawSessions === 'object' && !Array.isArray(rawSessions)) {
    for (const [id, value] of Object.entries(rawSessions)) {
      if (!isValidSessionId(id)) continue
      sessions[id] = {
        hand: typeof value?.hand === 'string' ? value.hand.trim() : '',
        ...typeof value?.review === 'string' && value.review.trim() !== '' ? { review: value.review.trim() } : {},
        ...typeof value?.lite === 'string' && value.lite.trim() !== '' ? { lite: value.lite.trim() } : {},
        at: typeof value?.at === 'string' ? value.at : null,
      }
    }
  }
  // v2 first, legacy top-level as the fallback (acceptance.md §2: 读侧 v2 优先、顶层回落).
  const defaultHand = typeof raw.default?.hand === 'string' && raw.default.hand.trim() !== ''
    ? raw.default.hand.trim()
    : typeof raw.hand === 'string' ? raw.hand.trim() : ''
  const defaultReview = typeof raw.default?.review === 'string' ? raw.default.review.trim() : ''
  const defaultReviewAt = typeof raw.default?.reviewAt === 'string' ? raw.default.reviewAt : null
  const defaultLite = typeof raw.default?.lite === 'string' ? raw.default.lite.trim() : ''
  const defaultLiteAt = typeof raw.default?.liteAt === 'string' ? raw.default.liteAt : null
  const defaultAt = typeof raw.default?.at === 'string'
    ? raw.default.at
    : typeof raw.at === 'string' ? raw.at : null
  return {
    raw,
    sessions,
    defaultHand,
    defaultReview,
    defaultReviewAt,
    defaultLite,
    defaultLiteAt,
    defaultAt,
    legacyBrain: typeof raw.brain === 'string' ? raw.brain.trim() : '',
  }
}

/**
 * Which hand route a given session resolves to, and where it came from.
 * @param doc - {@link readMirrorDocument} result.
 * @param sessionId - session id, or null when the page has none.
 * @returns `{ hand, source, at }` — `source` is `session`/`default`/null.
 */
export function resolveHand(doc, sessionId) {
  if (sessionId !== null && isValidSessionId(sessionId)) {
    const row = doc.sessions[sessionId]
    if (row !== undefined && row.hand !== '') return { hand: row.hand, source: 'session', at: row.at }
  }
  if (doc.defaultHand !== '') return { hand: doc.defaultHand, source: 'default', at: doc.defaultAt }
  return { hand: '', source: null, at: null }
}

export function resolveReview(doc, sessionId) {
  if (sessionId !== null && isValidSessionId(sessionId)) {
    const row = doc.sessions[sessionId]
    if (row !== undefined && row.review !== '') return { review: row.review, source: 'session', at: row.at }
  }
  if (doc.defaultReview !== '') return { review: doc.defaultReview, source: 'default', at: doc.defaultReviewAt }
  return { review: '', source: null, at: null }
}

/** Which lite route a given session resolves to (same ladder as the other two). */
export function resolveLite(doc, sessionId) {
  if (sessionId !== null && isValidSessionId(sessionId)) {
    const row = doc.sessions[sessionId]
    if (row !== undefined && row.lite !== '') return { lite: row.lite, source: 'session', at: row.at }
  }
  if (doc.defaultLite !== '') return { lite: doc.defaultLite, source: 'default', at: doc.defaultLiteAt }
  return { lite: '', source: null, at: null }
}
/**
 * Compute the next mirror document for one route write, without touching disk.
 *
 * Never deletes a key it was not asked to touch: unknown top-level keys (the
 * legacy `brain` field, a future field written by a newer panel) are carried over
 * verbatim. The only ports that clear anything are an explicit `""` on the layer
 * being written, and the "both layers empty" case, which removes the file.
 *
 * @param doc - {@link readMirrorDocument} result.
 * @param input - `{ scope, sessionId, hand, now }`.
 * @returns `{ next, changed, at }` — `next` is null when the file should be removed.
 */
export function planRouteWrite(doc, { role = 'hand', scope, sessionId = null, value = '', now = new Date().toISOString() }) {
  const key = role === 'review' || role === 'lite' ? role : 'hand'
  const defaultFor = k => (k === 'review' ? doc.defaultReview : k === 'lite' ? doc.defaultLite : doc.defaultHand)
  const defaultAtFor = k => (k === 'review' ? doc.defaultReviewAt : k === 'lite' ? doc.defaultLiteAt : doc.defaultAt)
  const current = scope === 'session' ? (doc.sessions[sessionId]?.[key] ?? '') : defaultFor(key)
  if (current === value) return { next: null, changed: false, at: scope === 'session' ? (doc.sessions[sessionId]?.at ?? null) : defaultAtFor(key) }
  const sessions = {}
  for (const [id, row] of Object.entries(doc.sessions)) sessions[id] = { ...row }
  let defaultHand = doc.defaultHand ?? ''
  let defaultReview = doc.defaultReview ?? ''
  let defaultLite = doc.defaultLite ?? ''
  let defaultAt = doc.defaultAt
  let defaultReviewAt = doc.defaultReviewAt
  let defaultLiteAt = doc.defaultLiteAt
  if (scope === 'session') {
    if (value === '') {
      if (sessions[sessionId] !== undefined) delete sessions[sessionId][key]
      if (sessions[sessionId] !== undefined && sessions[sessionId].hand === undefined && sessions[sessionId].review === undefined && sessions[sessionId].lite === undefined) delete sessions[sessionId]
    } else sessions[sessionId] = { ...(sessions[sessionId] ?? {}), [key]: value, at: now }
  } else if (key === 'review') {
    defaultReview = value
    defaultReviewAt = value === '' ? null : now
  } else if (key === 'lite') {
    defaultLite = value
    defaultLiteAt = value === '' ? null : now
  } else {
    defaultHand = value
    defaultAt = value === '' ? null : now
  }
  const next = { version: MIRROR_VERSION }
  if (defaultHand !== '') { next.default = { hand: defaultHand, at: defaultAt ?? now }; next.hand = defaultHand }
  if (typeof defaultReview === 'string' && defaultReview !== '') next.default = { ...(next.default ?? {}), review: defaultReview, at: defaultReviewAt ?? now }
  if (typeof defaultLite === 'string' && defaultLite !== '') next.default = { ...(next.default ?? {}), lite: defaultLite, at: defaultLiteAt ?? now }
  if (Object.keys(sessions).length > 0) next.sessions = sessions
  for (const [keyName, val] of Object.entries(doc.raw)) if (!['version', 'default', 'sessions', 'hand', 'at'].includes(keyName)) next[keyName] = val
  return { next: next.default === undefined && next.sessions === undefined ? null : next, changed: true, at: scope === 'session' ? now : key === 'review' ? defaultReviewAt : key === 'lite' ? defaultLiteAt : defaultAt }
}

export const planHandWrite = (doc, input) => planRouteWrite(doc, { ...input, role: 'hand', value: input.hand ?? '' })

/**
 * Write bytes so a reader never sees half a document, with an explicit `0600`.
 *
 * The `0600` is not decoration: this file names the model that will run code in
 * the user's sessions, and the previous `writeFileSync` default (0644) would widen
 * it the first time an existing 0600 mirror was rewritten. The temp name carries
 * the pid **and** random bytes — `pid-Date.now` collides when two writes land in
 * the same millisecond, which is exactly what a burst of saves does.
 *
 * @param file - destination path.
 * @param text - full contents.
 * @param mode - file mode (default 0600).
 */
export function writeAtomicPrivate(file, text, mode = 0o600) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
  writeFileSync(tmp, text, { encoding: 'utf8', mode })
  try {
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

/** Raised when the mirror lock is held; the handler maps it to 409. */
export class LockBusy extends Error {
  constructor(lockPath) {
    super(`smart routes: another writer holds the mirror lock (${lockPath})`)
    this.name = 'LockBusy'
  }
}

/**
 * Take an exclusive lock, synchronously.
 *
 * Synchronous on purpose: the critical section is read-modify-atomic-rename with
 * no awaits, so within one process the lock can never be released by a task that
 * has not finished. What it does cover is a second process (the packaged app plus
 * a dev session) and a crashed writer (stale reclaim).
 *
 * @param lockPath - lock file.
 * @param options - `{ staleMs, now }`.
 * @returns the release function.
 */
export function acquireLock(lockPath, { staleMs = LOCK_STALE_MS, now = Date.now() } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(dirname(lockPath), { recursive: true })
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(fd, `${process.pid} ${new Date(now).toISOString()}\n`, 'utf8')
      } finally {
        closeSync(fd)
      }
      return () => { rmSync(lockPath, { force: true }) }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      // 写入是同步的、通常微秒级，所以"超过 10 秒还没释放"只可能是写者已经死了。
      let age = Number.POSITIVE_INFINITY
      try {
        age = now - statSync(lockPath).mtimeMs
      } catch {
        // 锁在这一刻被别人释放了：直接再抢一次。
        continue
      }
      if (age > staleMs) {
        rmSync(lockPath, { force: true })
        continue
      }
      throw new LockBusy(lockPath)
    }
  }
  throw new LockBusy(lockPath)
}

/**
 * Run `fn` under the mirror lock, always releasing it.
 * @param lockPath - lock file.
 * @param fn - critical section.
 * @returns whatever `fn` returns.
 */
export function withMirrorLock(lockPath, fn) {
  const release = acquireLock(lockPath)
  try {
    return fn()
  } finally {
    release()
  }
}

/**
 * One hand write against the real file: lock, read, plan, write (or not).
 *
 * @param mirrorPath - absolute mirror path.
 * @param input - `{ scope, sessionId, hand }`.
 * @returns `{ changed, at, path, doc }`.
 */
export function updateMirror(mirrorPath, input) {
  const lockPath = mirrorLockPath(mirrorPath)
  return withMirrorLock(lockPath, () => {
    const doc = readMirrorDocument(mirrorPath)
    const planned = planRouteWrite(doc, { ...input, value: input.role === 'review' || input.role === 'lite' ? input[input.role] : input.hand })
    if (!planned.changed) return { changed: false, at: planned.at, path: mirrorPath, doc }
    if (planned.next === null) {
      rmSync(mirrorPath, { force: true })
      return { changed: true, at: null, path: mirrorPath, doc: readMirrorDocument(mirrorPath) }
    }
    mkdirSync(dirname(mirrorPath), { recursive: true })
    writeAtomicPrivate(mirrorPath, `${JSON.stringify(planned.next, null, 2)}\n`)
    return { changed: true, at: planned.at, path: mirrorPath, doc: readMirrorDocument(mirrorPath) }
  })
}

/**
 * The boot-time merge: the scripting plane's row config is the hard floor.
 *
 * Only writes a **non-empty** row value into `default`, and never deletes a key —
 * boot is not allowed to clear a user's choice, it can only assert one.
 *
 * @param mirrorPath - absolute mirror path.
 * @param routes - `{ hand }` as the row spells them.
 * @returns the mirror path when something was written, else null.
 */
export function mergeRowRoutes(mirrorPath, routes) {
  const hand = typeof routes?.hand === 'string' ? routes.hand.trim() : ''
  if (hand === '') return null
  const result = updateMirror(mirrorPath, { scope: 'default', sessionId: null, hand })
  return result.path
}
