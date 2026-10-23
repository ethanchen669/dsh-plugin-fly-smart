/**
 * Fly smart mode — the phase machine, as pure functions over a task directory.
 *
 * Design: `docs/smart-mode-design.md` §3 (phases + artifact contract) and §7
 * (on-disk layout). This module owns *only* the state; the tools in `index.js`
 * are thin wrappers, so every transition is unit-testable without cordis.
 *
 * Two rules the design calls load-bearing, both enforced here rather than in the
 * prompt:
 *
 *   - **Phase order is checked in code.** An artifact may only be recorded for
 *     the phase the task is actually in; anything else throws.
 *   - **Nothing advances on its own.** Recording an artifact sets
 *     `awaitingGate` (G1..G5); only `passGate` moves the phase forward, which is
 *     what makes the user confirmations real rather than narrated.
 *
 * @module dsh-plugin-fly-smart/state
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

/**
 * The route mirror the workbench writes and this plugin reads.
 *
 * ## Where it lives (and why not beside the root)
 *
 * The model pair is edited in the `fly.smart` right-drawer page, whose host row
 * (`dsh-plugin-fly-smart-panel`) writes a mirror file that this agent-plane plugin
 * reads: the two planes share no vocabulary, so the interface is a file. v1 put it
 * beside the smart root (`dirname(rootDir)/smart-routes.json`), which was fine
 * while the root was one fixed directory. The root is now the **session's
 * workspace** (`<header.cwd>/.dsh-fly/smart`), so deriving the mirror from it would
 * give every workspace its own route file — the page would write A while the tools
 * read B, with every route silently resolving to nothing. Hence a fixed location:
 * `~/.dsh-fly/smart-routes.json`, overridable only for tests/headless boots via
 * `DSH_FLY_SMART_ROUTES` (`acceptance.md` Y2/M1).
 *
 * It sits *outside* the smart root for the original reason too: a file inside the
 * root would make `existsSync(rootDir)` true on a machine that never ran a task,
 * which is exactly the difference the workbench empty state and the 503 contract
 * are built on.
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

/** The pre-workspace task root: readable, continuable, never written by new tasks. */
export function resolveLegacyRoot() {
  return join(homedir(), '.dsh-fly', 'smart')
}

/** `tasks/<id>/state.json` under one root — the on-disk fact that locates a task. */
export function taskStateFile(rootDir, id) {
  return join(resolve(rootDir), 'tasks', id, 'state.json')
}

/**
 * The workspace task root of a session: `<session.header.cwd>/.dsh-fly/smart`.
 *
 * `header.cwd` is the session's own working directory. It is **not** the host
 * process cwd and **not** the workspace service's root: the three differ routinely
 * (the desktop shell's cwd is `/`), and `process.cwd()` is banned as a fallback for
 * exactly that reason — it would file a task into the repository root. Note
 * `header.cwd` is optional upstream (`dsh-acp/lib/index.js:1267` treats a missing
 * value as "cannot place this session"), so a missing value must be loud, not
 * guessed (`acceptance.md` M11/Y4).
 *
 * @param session - `exec.agent.session`, or anything with a `header`.
 * @returns `{ root, source }` or null.
 */
export function workspaceTaskRoot(session) {
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) return null
  return { root: join(cwd, '.dsh-fly', 'smart'), source: 'header.cwd' }
}

/**
 * The preset row's `rootDir`, or null.
 *
 * A row `rootDir` exists for scripted/headless runs (verification), and it would
 * otherwise **silently override the workspace root for every session** — the exact
 * failure the per-call resolution exists to prevent. So it is treated as a
 * declaration that this composition is not a product session and must be spelled
 * out: `allowGlobalRoot: true`. Without it, this throws loudly instead of filing
 * tasks into a directory nobody is looking at (`acceptance.md` Y1/M7).
 *
 * @param config - normalised row config.
 * @returns `{ root, source }` or null.
 * @throws {Error} when a row root is set without `allowGlobalRoot`.
 */
export function presetTaskRoot(config = {}) {
  const raw = config.rootDir
  if (typeof raw !== 'string' || raw.trim() === '') return null
  if (config.allowGlobalRoot !== true) {
    throw new Error(`smart: the preset row sets rootDir=${JSON.stringify(raw)} — that would silently override every session's workspace root. Add \`allowGlobalRoot: true\` to the row when this is deliberate (tests / headless runs), or drop rootDir and let the workspace decide.`)
  }
  return { root: resolve(raw.trim()), source: 'preset' }
}

/**
 * Every root a task could live in, in precedence order.
 *
 * Writes go to {@link resolveTaskRoot}; this list is for **finding** an existing
 * task (and for the read fallbacks). The env override is deliberately a read
 * candidate only: `DSH_FLY_SMART_ROOT` does not redirect the agent's writes
 * (`acceptance.md` M17) — a fixture that only sets it has not isolated the agent.
 *
 * @param input - `{ config, env, session }`.
 * @returns `{ roots, primary }`.
 */
export function candidateTaskRoots({ config = {}, env = process.env, session = undefined } = {}) {
  const roots = []
  const push = entry => {
    if (entry === null || entry === undefined) return
    if (!roots.some(existing => existing.root === entry.root)) roots.push(entry)
  }
  push(presetTaskRoot(config))
  const fromEnv = typeof env?.[ROOT_DIR_ENV] === 'string' ? env[ROOT_DIR_ENV].trim() : ''
  if (fromEnv !== '') push({ root: resolve(fromEnv), source: 'env' })
  push(workspaceTaskRoot(session))
  push({ root: resolveLegacyRoot(), source: 'legacy' })
  return { roots, primary: roots[0]?.root ?? resolveLegacyRoot() }
}

/**
 * The root this call **writes** to: preset row (guarded) → session workspace → legacy.
 *
 * @param input - `{ config, session }`.
 * @returns `{ root, source }`.
 */
export function resolveTaskRoot({ config = {}, session = undefined } = {}) {
  const preset = presetTaskRoot(config)
  if (preset !== null) return preset
  const workspace = workspaceTaskRoot(session)
  if (workspace !== null) return workspace
  // 归属未知 ⇒ **大声报错**，不静默落到全局老根。
  //
  // 老根只剩"找任务"的读候选（`candidateTaskRoots`）：旧任务仍然可读、可继续、可归档。
  // 但**写**进老根等于让任务不属于任何工作区 —— 它在每个工作区的面板里都会露头、只有它
  // 会跨工作区累积、而且没有工作区认领它。这与 `presetTaskRoot` 的规矩是同一条：静默覆盖
  // "每个会话的工作区根"必须显式声明（`rootDir` + `allowGlobalRoot: true`）。
  throw new Error(
    'smart: this call has no workspace — a session without an absolute `header.cwd` has no task '
    + 'root, and the legacy root is read-only now (it still serves old tasks: read / continue / '
    + 'archive). Give the session a real working directory, or declare the root explicitly in the '
    + 'preset row: `rootDir: <abs>` together with `allowGlobalRoot: true` (scripted/headless runs).',
  )
}

/**
 * Find an existing task directory across the candidate roots.
 *
 * The disk decides which copy is read (`state.json` must exist), so a recorded
 * `rootDir` inside a task cannot redirect the read; the same-id-in-two-roots case
 * resolves in precedence order and says so.
 *
 * @param taskId - task id.
 * @param candidates - roots in precedence order (`{root, source}` or plain strings).
 * @returns `{ root, source, taskDir, note? }` or null.
 */
export function locateTask(taskId, candidates) {
  assertTaskId(taskId)
  const hits = []
  for (const entry of candidates) {
    const root = typeof entry === 'string' ? entry : entry.root
    if (existsSync(taskStateFile(root, taskId))) hits.push({ root, source: typeof entry === 'string' ? null : entry.source })
  }
  if (hits.length === 0) return null
  return {
    root: hits[0].root,
    source: hits[0].source,
    taskDir: join(resolve(hits[0].root), 'tasks', taskId),
    ...hits.length > 1 ? { note: `task "${taskId}" exists in ${hits.length} roots; using ${hits[0].root}` } : {},
  }
}

/** Environment override for the smart root **read** candidates (see {@link candidateTaskRoots}). */
export const ROOT_DIR_ENV = 'DSH_FLY_SMART_ROOT'

/**
 * Parse one route value into `{ provider, model, reasoningEffort? }`.
 *
 * The workbench's text field carries `"provider/model"` (with an optional
 * `@effort`); the preset row carries an object. Both are accepted here so the two
 * sources cannot drift into different shapes.
 *
 * @param value - `"provider/model[@effort]"`, `{ provider, model }`, or empty.
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
 * Read the mirror into its three layers, tolerating every kind of "not there yet".
 *
 * A missing, unreadable or malformed mirror is not an error — it means "the user
 * has not chosen a pair", which the tools already report loudly at call time. The
 * top-level `hand`/`brain` keys are the **legacy** layer: v2 readers prefer
 * `default`, and the writer keeps the legacy key mirrored so an older agent (which
 * knows only that key) keeps working during the compatibility window.
 *
 * @param mirrorPath - absolute mirror path (defaults to the resolved location).
 * @returns `{ version, exists, default, sessions, legacy }`.
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
 * call falls through to the default. The tool surface is exercised with bare `{}`
 * session objects throughout the suite, and refusing there would make every one of
 * those specs red for a reason that has nothing to do with routing.
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
 * Shape is **not** whitelisted: the engine mints `session-<n>` from a counter
 * (`dsh-session` package `lib/index.js:1648`) as well as UUIDs, and CLI users pick
 * their own ids. What is refused is what cannot be a key at all — empty, overlong,
 * separators, `..`, control characters. The panel half pins the same rules, and a
 * cross-package test walks one table through both so they cannot drift.
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

export function mirrorReviewRoute(layers, sessionId) {
  const session = isUsableSessionId(sessionId) ? layers.sessions[sessionId] : undefined
  if (session?.review !== undefined) return { route: session.review, source: 'session' }
  if (layers.review !== undefined) return { route: layers.review, source: 'default' }
  return null
}

/** Resolve the review route from row config, then the mirror. */
/**
 * 返工升档（superpowers：*"fix-loop escalation (rounds 4-5): use a model at least one
 * tier above"*）。
 *
 * smart 的返工是**用户门控**的（`maxRework` + 人加额），但每次返工后那份稿子还是要过
 * review child —— 一个反复修不好的点，值得让评审那侧看得更用力。
 * 规则：同一路由，**attempt ≥ 2 时把 effort 提到该模型支持的最高档**；查不到档位表就
 * 原样返回并如实标注 `escalated: false`（不猜、不造档位名）。
 *
 * @param route - `{ provider, model, reasoningEffort? }`。
 * @param attempts - 本阶段已返工次数（0 = 第一次写）。
 * @param supported - 该模型支持的 effort id 列表，查不到给 `undefined`。
 * @returns `{ route, escalated, attempts }`。
 */
export function escalatedEffort(route, attempts, supported) {
  if (attempts < 2 || route === undefined || route === null) return { route, escalated: false, attempts }
  if (!Array.isArray(supported) || supported.length === 0) return { route, escalated: false, attempts }
  const highest = supported[supported.length - 1]
  if (highest === undefined || highest === route.reasoningEffort) return { route, escalated: false, attempts }
  return { route: { ...route, reasoningEffort: highest }, escalated: true, attempts }
}

/**
 * 终审（G5 那一关的评审）**不许回落**。
 *
 * superpowers：*"dispatch it on the most capable available model, not the session
 * default"* —— 而回落链（`review → hand → session`）最坏的情况是终审跑在**执行者用的
 * 那条**上：自己审自己。所以终审必须是**显式配置的** review 路由
 * （`preset` / `session` / `default`），来源是 `*-fallback` 一律拒绝。
 *
 * @param source - `currentReviewRoute` 回的来源标识。
 * @throws 来源是回落时，指出该配什么。
 */
export function assertFinalReviewRoute(source) {
  if (source === 'preset' || source === 'session' || source === 'default') return
  throw new Error(
    `smart: the final review refuses a fallback route (got "${source ?? 'none'}") — 终审不许跑在回落出来的路由上：`
    + `那样最坏情况是执行者审自己。给 tool-fly-smart 的行配置加显式的 reviewRoute: { provider, model }`
    + `（有 Fly 工作台时在右抽屉「Smart 工作流 → 三模型路由」里选 review），然后重试。`,
  )
}

export function currentReviewRoute({ config = {}, session = undefined, mirrorPath = undefined, env = process.env } = {}) {
  if (config.reviewRoute !== undefined) return { route: config.reviewRoute, source: 'preset' }
  if (config.handRoute !== undefined) return { route: config.handRoute, source: 'hand-fallback' }
  const layers = readMirrorLayers(mirrorPath ?? resolveMirrorPath(env))
  const review = mirrorReviewRoute(layers, session?.id)
  if (review !== null) return review
  const hand = mirrorHandRoute(layers, session?.id)
  if (hand !== null) return { ...hand, source: `${hand.source}-fallback` }
  if (config.handRoute !== undefined) return { route: config.handRoute, source: 'hand-fallback' }
  return null
}
/**
 * Back-compat shim: the legacy shape `{ brain, hand }` of the mirror.
 *
 * Kept because the brain half of the pair is still read (never written) from the
 * mirror: the page writes only the hand route, so a user who configured the pair in
 * the upstream Settings form keeps their brain route. `consumer: null` is the honest
 * note that nothing in this plugin reads `brain` for a spawn.
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

/** Every phase a task can be in, in order. */
export const PHASES = ['brainstorm', 'design', 'plan', 'acceptance', 'executing', 'reviewing', 'done', 'cancelled']

/** The four design phases, each ending at a small user gate (G1–G4). */
export const DESIGN_PHASES = ['brainstorm', 'design', 'plan', 'acceptance']

/** Artifact file per phase (the contract §3 checks). */
/**
 * 工作流策略版本（**opt-in**，不改变既有任务语义）。
 *
 * - `v1`：四阶段各派一次独立 review consult + 每份产物一次 review briefing（历史行为）。
 * - `optimized`：brainstorm 不派独立 consult（brain 出用户版要点，review 从 design 才开始）
 *   —— 候选方案阶段还没有可执行的东西可审，那一次评审是纯开销。
 *
 * 版本在 `createTask` 时**记进 state**：之后即使行配置改了，在途任务仍按自己那份跑完。
 */
export const WORKFLOWS = ['v1', 'optimized']

/** 每个工作流下**必须**有独立 consult 记录的设计阶段。 */
export const CONSULT_PHASES = {
  v1: ['brainstorm', 'design', 'plan', 'acceptance'],
  optimized: ['design', 'plan', 'acceptance'],
}

/** 这个任务需要 consult 的阶段（未知版本按 v1 兜底，绝不静默放宽）。 */
export function consultPhasesFor(state) {
  // `size: 'light'` 明确是"零 review child"的档位：要点由 brain 自写，也就没有独立的
  // 可行性评审。这不是**静默放宽**（判据仍在、只是判据本身说这里没有这一步），status
  // 会如实报 `phases` 与 `size`，用户看得见自己选了什么。
  if (state?.size === 'light') return []
  return CONSULT_PHASES[state?.workflow] ?? CONSULT_PHASES.v1
}

export const ARTIFACT_FILE = {
  brainstorm: 'brainstorm.md',
  design: 'design.md',
  plan: 'plan.md',
  acceptance: 'acceptance.md',
  executing: 'execution-report.md',
  reviewing: 'review.md',
}

/**
 * optimized 工作流把 `acceptance.md` 写成 **plan 相位的伴随产物**（不改相位表）。
 *
 * 为什么不动相位表：`PHASES` / `NEXT_PHASE` / `GATE_AFTER` 是持久化状态与面板的公共契约，
 * 改它等于给所有在途任务换语义。伴随文件让"计划与验收一起写、一起审、一道门"成立，而
 * 盘上的相位名仍是 `plan` —— 旧任务、面板、`smart_execute` 的读取路径全都不用改。
 */
export const COMPANION_ARTIFACT = { plan: 'acceptance.md' }

/** 这个相位的伴随产物文件名（没有则 null）。 */
export function companionFileOf(phase) {
  return COMPANION_ARTIFACT[phase] ?? null
}

/** 主产物 + 伴随产物的正文（伴随缺失时就是主产物），供"未决小节"这类整段判定用。 */
export function artifactTextWithCompanion(rootDir, id, phase) {
  const main = readFileSync.length === 0 ? null : null // 占位，真正的读取在下面（保持纯函数形状）
  void main
  const parts = []
  try {
    const file = ARTIFACT_FILE[phase]
    if (file !== undefined) parts.push(readFileSync(join(taskDir(rootDir, id), file), 'utf8'))
  } catch { /* 主产物缺失：交给调用方各自的缺口检查 */ }
  const companion = companionFileOf(phase)
  if (companion !== null) {
    try {
      parts.push(readFileSync(join(taskDir(rootDir, id), companion), 'utf8'))
    } catch { /* 伴随缺失同理 */ }
  }
  return parts.join('\n')
}

/** Gate that closes each phase's step. */
/**
 * **shape**：任务形态，决定这个任务走哪些相位（S5）。
 *
 * 目的：让"加个 helper 函数"不被 6 相位 / 5–11 张卡 / 6–12 次子代理碾压。
 * 每个 shape 是 `PHASES` 的一个**有序子集**；裁掉的相位是**不存在**，不是
 * "存在但不查" —— 闸门不静默放宽，是这条设计的底线（见 optimized 那次踩的坑）。
 *
 * | shape | 相位 | 门 | 典型 |
 * | --- | --- | --- | --- |
 * | `feature` | 六相位 | G1–G5 | 完整交付一个功能 |
 * | `fix` | brainstorm → plan → executing → reviewing | G1、G3、G5 | 修一处、要留证据 |
 * | `review` | 只有 reviewing | G5 | 看看这个 diff |
 * | `investigation` | 只有 brainstorm | G1 | 调查个问题、出结论 |
 */
export const SHAPES = {
  feature: ['brainstorm', 'design', 'plan', 'acceptance', 'executing', 'reviewing'],
  fix: ['brainstorm', 'plan', 'executing', 'reviewing'],
  review: ['reviewing'],
  investigation: ['brainstorm'],
}

/**
 * **size**：成本档位，决定设计相位要不要派 review child。
 *
 * `light` ⇒ 设计相位的用户要点由 brain 自写（**零 review child**）；`standard` / `full`
 * 照常派。与 shape 正交：shape 管"走几步"，size 管"每步花多少"。
 */
export const SIZES = ['light', 'standard', 'full']

/**
 * 这个任务的相位序列（有序）。
 *
 * 两件事共同决定：`shape`（走哪些）与 `workflow: optimized`（把 `acceptance` 并进
 * `plan`，那一相位**不存在**）。
 * @param state - 任务 state（`shape` / `workflow` 缺省按 v1 全套）。
 * @returns 相位数组，例如 `['brainstorm','plan','executing','reviewing']`。
 */
/**
 * 一个 git 工作树当前的 HEAD（只读 `.git`，不跑命令）。
 *
 * **用途只有一个**：执行派发前记下 BASE。superpowers 明确警告过
 * *"never `HEAD~1`, which silently drops all but the last commit of a multi-commit task"* ——
 * 派发**之后**再算基线，多 commit 的任务会把前面的提交全漏掉。所以基线必须在派发前取。
 *
 * 只用 `node:fs`（工具层没有 shell 座位，也不该为此加一个）：读 `.git/HEAD`，
 * 是 `ref:` 就再解一层（`refs/heads/*` 或 `packed-refs`）；`.git` 是文件（worktree/submodule）
 * 时按 `gitdir: <path>` 走。解不出就返回 null —— **不是 git 工作树不算错**。
 *
 * @param dir - 工作树根（或其中任意路径，向上找 `.git`）。
 * @returns 40 位 sha，或 null。
 */
export function gitHeadOf(dir) {
  try {
    let current = resolve(dir)
    let gitDir = null
    for (let depth = 0; depth < 64; depth += 1) {
      const candidate = join(current, '.git')
      if (existsSync(candidate)) {
        const stat = statSync(candidate)
        if (stat.isDirectory()) { gitDir = candidate; break }
        // worktree / submodule：`.git` 是文件，内容形如 `gitdir: /path/to/.git/worktrees/x`
        const pointer = readFileSync(candidate, 'utf8').trim()
        const target = /^gitdir:\s*(.+)$/u.exec(pointer)?.[1]?.trim()
        if (target === undefined) return null
        gitDir = isAbsolute(target) ? target : resolve(current, target)
        break
      }
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
    if (gitDir === null) return null
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    const sha = /^[0-9a-f]{40}$/iu.test(head) ? head : null
    if (sha !== null) return sha
    const ref = /^ref:\s*(.+)$/u.exec(head)?.[1]?.trim()
    if (ref === undefined) return null
    const refFile = join(gitDir, ref)
    if (existsSync(refFile)) {
      const value = readFileSync(refFile, 'utf8').trim()
      return /^[0-9a-f]{40}$/iu.test(value) ? value : null
    }
    // 打包引用（`packed-refs`）：`<sha> <ref>` 一行一条。
    const packed = join(gitDir, 'packed-refs')
    if (!existsSync(packed)) return null
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      const match = /^([0-9a-f]{40})\s+(.+)$/u.exec(line.trim())
      if (match !== null && match[2] === ref) return match[1]
    }
    return null
  } catch {
    return null
  }
}

export function phasesFor(state) {
  const shape = SHAPES[state?.shape] ?? SHAPES.feature
  return state?.workflow === 'optimized' ? shape.filter(phase => phase !== 'acceptance') : shape
}

/**
 * 这个任务里 `from` 的下一个相位；没有下一个（或 `from` 不在这个任务里）⇒ null。
 * @param state - 任务 state。
 * @param from - 当前相位。
 */
export function nextPhaseFor(state, from) {
  const list = phasesFor(state)
  const index = list.indexOf(from)
  return index === -1 || index + 1 >= list.length ? null : list[index + 1]
}

/**
 * 这个任务的用户要点由谁写：`'review'`（派 review child）还是 `'inline'`（brain 自写）。
 *
 * 两个来源都是"省一次子代理调用"：`workflow: optimized` 的 brainstorm 本来就是 inline；
 * `size: 'light'` 把**全部设计相位**都变成 inline（轻任务不值得为每步起一个评审）。
 */
export function briefingSourceFor(state, phase) {
  if (state?.size === 'light' && DESIGN_PHASES.includes(phase)) return 'inline'
  if (state?.workflow === 'optimized' && phase === 'brainstorm') return 'inline'
  return 'review'
}

export const GATE_AFTER = {
  brainstorm: 'G1',
  design: 'G2',
  plan: 'G3',
  acceptance: 'G4',
  reviewing: 'G5',
}

/** Phase the machine moves to once a gate passes. */
/**
 * 产物里标记"还有只有用户能定的问题"的小节关键词。
 *
 * 门的机械判据就挂在它上面：`## …需要你裁决…` 这种小节还在，门就不开（见 recordArtifact
 * 与 gateGaps）。规则刻意做得**钝**——一个小节标题就能拦下整道门，因为"聪明"的解析漏掉一节
 * 就会让门在裁决未收齐时打开，而那正是这套东西要堵的洞。模型要做的事也只有一件：收齐裁决后
 * 把标题里的这几个字去掉（换成「已裁决」并逐条写上用户的选择）。
 */
export const DECISION_MARKER = '需要你裁决'

/**
 * Find the open-decision sections of an artifact.
 *
 * @param markdown - artifact body (null/undefined tolerated).
 * @returns `{ items, headings }`: how many list items sit under such sections, and the
 *   headings themselves (empty `headings` = nothing open).
 */
export function openDecisions(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') return { items: 0, headings: [] }
  const headings = []
  let items = 0
  let inside = false
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (/^#{1,6}\s/u.test(line)) {
      inside = line.includes(DECISION_MARKER)
      if (inside) headings.push(line.replace(/^#{1,6}\s*/u, '').trim())
      continue
    }
    if (inside && /^([-*+]|\d+[.)])\s+\S/u.test(line)) items += 1
  }
  return { items, headings }
}

const NEXT_PHASE = {
  brainstorm: 'design',
  design: 'plan',
  plan: 'acceptance',
  acceptance: 'executing',
  executing: 'reviewing',
  reviewing: 'done',
}

const TASK_ID = /^[A-Za-z0-9._-]+$/u

/**
 * Validate a task id: safe for a path segment, and never a traversal.
 * @param id - candidate id.
 * @returns the id, unchanged.
 * @throws {Error} when the id could escape `tasks/`.
 */
export function assertTaskId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 80) throw new Error('smart: task id must be a non-empty string (≤80 chars)')
  if (!TASK_ID.test(id) || id === '.' || id === '..' || id.includes('..')) throw new Error(`smart: unsafe task id "${id}" (allowed: letters, digits, dot, dash, underscore)`)
  return id
}

/**
 * Resolve row config into the shape the tools use, with defaults and checks.
 *
 * The two routes are deliberately opaque `{provider, model, reasoningEffort?}`
 * pairs: the design keeps the pair configurable (Pro/Flash, cross-provider, …)
 * and never hard-codes a model name.
 *
 * @param raw - the preset row's `config` object (may be undefined).
 * @returns normalised config.
 * @throws {Error} on a malformed route.
 */
export function resolveConfig(raw = {}) {
  const route = (value, key) => {
    if (value === undefined) return undefined
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`smart: ${key} must be an object { provider, model, reasoningEffort? }`)
    const { provider, model, reasoningEffort } = value
    if (typeof provider !== 'string' || provider.length === 0) throw new Error(`smart: ${key}.provider must be a non-empty string`)
    if (typeof model !== 'string' || model.length === 0) throw new Error(`smart: ${key}.model must be a non-empty string`)
    if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) throw new Error(`smart: ${key}.reasoningEffort must be a non-empty string when present`)
    return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
  }
  // **每阶段**的返工额度（不是整任务的总预算）：某个阶段反复迭代不该把后面阶段的额度吃掉，
  // 否则"设计稿改了三次"就直接等于"计划阶段一次也不许改"。
  const maxRework = raw.maxRework === undefined ? 5 : Number(raw.maxRework)
  if (!Number.isInteger(maxRework) || maxRework < 0) throw new Error('smart: maxRework must be a non-negative integer (per phase)')
  if (raw.rootDir !== undefined && (typeof raw.rootDir !== 'string' || raw.rootDir.length === 0)) throw new Error('smart: rootDir must be a non-empty string when present')
  if (raw.allowGlobalRoot !== undefined && typeof raw.allowGlobalRoot !== 'boolean') throw new Error('smart: allowGlobalRoot must be a boolean when present')
  const brainstormDepth = raw.brainstormDepth === undefined ? 'balanced' : String(raw.brainstormDepth).trim().toLowerCase()
  if (!BRAINSTORM_DEPTHS.includes(brainstormDepth)) throw new Error(`smart: brainstormDepth must be one of ${BRAINSTORM_DEPTHS.join(', ')}`)
  const workflow = raw.workflow === undefined ? 'v1' : String(raw.workflow).trim().toLowerCase()
  if (!WORKFLOWS.includes(workflow)) throw new Error(`smart: workflow must be one of ${WORKFLOWS.join(', ')}`)
  return {
    enabled: raw.enabled !== false,
    rootDir: raw.rootDir,
    // 行 rootDir 是"测试/无头"开关，必须显式承认它压掉工作区根（见 presetTaskRoot）。
    allowGlobalRoot: raw.allowGlobalRoot === true,
    brainRoute: route(raw.brainRoute, 'brainRoute'),
    handRoute: route(raw.handRoute, 'handRoute'),
    reviewRoute: route(raw.reviewRoute, 'reviewRoute'),
    brainstormDepth,
    // 新任务用哪一版工作流（v1 = 历史行为；optimized = brainstorm 不派独立 consult）。
    workflow,
    maxRework,
    requireConsult: raw.requireConsult !== false,
  }
}

export const BRAINSTORM_DEPTHS = ['light', 'balanced', 'deep', 'exhaustive']

export const BRAINSTORM_EFFORT_CANDIDATES = {
  light: ['low'],
  balanced: ['medium', 'low'],
  deep: ['high', 'medium', 'low'],
  exhaustive: ['xhigh', 'max', 'high', 'medium', 'low'],
}

/** Map a user-facing brainstorm depth to the strongest supported wire effort. */
export function resolveBrainstormEffort(depth = 'balanced', supportedEfforts = undefined) {
  const normalized = String(depth).trim().toLowerCase()
  if (!BRAINSTORM_DEPTHS.includes(normalized)) throw new Error(`smart: brainstormDepth must be one of ${BRAINSTORM_DEPTHS.join(', ')}`)
  const candidates = BRAINSTORM_EFFORT_CANDIDATES[normalized]
  if (supportedEfforts === undefined) return { depth: normalized, reasoningEffort: candidates[0], fallback: false }
  const supported = new Set((Array.isArray(supportedEfforts) ? supportedEfforts : []).map(value => String(value).toLowerCase()))
  const selected = candidates.find(value => supported.has(value))
  if (selected === undefined) throw new Error(`smart: brainstorm depth "${normalized}" cannot be used — model supports [${[...supported].join(', ')}], but no compatible reasoning effort exists`)
  return { depth: normalized, reasoningEffort: selected, fallback: selected !== candidates[0], supported: [...supported] }
}


export function tasksRoot(rootDir) {
  return join(resolve(rootDir), 'tasks')
}

/**
 * Absolute directory of one task, proven to stay inside `tasks/`.
 * @param rootDir - smart root directory.
 * @param id - task id.
 * @returns absolute task directory.
 * @throws {Error} when the resolved path escapes the root.
 */
export function taskDir(rootDir, id) {
  assertTaskId(id)
  const base = tasksRoot(rootDir)
  const dir = resolve(base, id)
  if (dir !== join(base, id) || !dir.startsWith(base + sep)) throw new Error(`smart: task path escapes the root: ${dir}`)
  return dir
}

/**
 * Write a file so a reader never sees a half-written document: same-directory
 * temp file, then rename. The design's §11.5 check depends on this.
 *
 * The temp name carries the pid, a millisecond stamp **and** random bytes: a burst
 * of writes inside one process (or an `apply()` racing a tool call) lands in the
 * same millisecond routinely, and `pid-Date.now` then has two writers renaming to
 * the same temp path — one loses, and the failure looks like a corrupted state
 * file rather than a collision (`acceptance.md` S2b-4).
 *
 * @param file - destination path.
 * @param text - full contents.
 * @param mode - file mode when the file is created.
 */
export function writeAtomic(file, text, mode = 0o644) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
  writeFileSync(tmp, text, { encoding: 'utf8', mode })
  try {
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

/**
 * 真实子代理调用计数（**索引**，不是主题；从不参与闸门判定）。
 *
 * 早先只有派生的 `spawnEstimate`（数磁盘上的记录），它分不清"review child 跑过"与
 * "brain 自己写了一轮要点" —— 那条错已经修过，但派生计数仍回答不了"这一轮 bundle 命中
 * 省了几次调用"。所以这里落一份显式计数：只在**真的起过 child / 真的命中缓存**的地方加一。
 *
 * 老 state 没有这个字段 ⇒ 读作全零（`metricsOf`），不需要迁移。
 */
export const METRIC_KEYS = ['reviewSpawns', 'handSpawns', 'brainRounds', 'consults', 'briefings', 'verifications', 'bundleHits', 'bundleMisses', 'gatesPassed', 'phaseTransitions']

/** 一个任务的计数快照（缺字段补零，绝不返回 undefined）。 */
export function metricsOf(state) {
  const stored = state?.metrics ?? {}
  return Object.fromEntries(METRIC_KEYS.map(key => [key, Number.isInteger(stored[key]) ? stored[key] : 0]))
}

/** 就地加计数（调用方随后自己 writeState）。 */
function bump(state, ...keys) {
  const current = { ...metricsOf(state) }
  for (const key of keys) current[key] = current[key] + 1
  state.metrics = current
  return state
}

/**
 * 原子地写**一组**文件：先把每个都落到同目录临时文件，全部成功后再逐个 rename。
 *
 * 为什么不是"循环 writeAtomic"：那种写法在第一份成功后崩掉就留下**半套产物**（盘上有
 * `plan.md`、没有 `acceptance.md`），而闸门与面板都会把半套当成真实的半成品来读。这里要么
 * 全成、要么一个字节都不留（临时文件全部清掉）。
 *
 * @param entries - `[{ file, text }]`（绝对路径）。
 */
export function writeAtomicMany(entries) {
  const staged = []
  try {
    for (const { file, text } of entries) {
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
      writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o644 })
      staged.push({ tmp, file })
    }
    for (const { tmp, file } of staged) renameSync(tmp, file)
  } catch (error) {
    for (const { tmp } of staged) rmSync(tmp, { force: true })
    throw error
  }
}

/** Read `state.json`, or null when the task does not exist / is unreadable. */
export function readState(rootDir, id) {
  const file = join(taskDir(rootDir, id), 'state.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`smart: state.json of task "${id}" is unreadable: ${error.message}`)
  }
}

/** Persist `state.json` and touch the task index. */
export function writeState(rootDir, state) {
  const dir = taskDir(rootDir, state.id)
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
  updateIndex(rootDir, state)
  return state
}

/** Rewrite `index.json` from the state being saved (one line per task). */
function updateIndex(rootDir, state) {
  const root = resolve(rootDir)
  const file = join(root, 'index.json')
  let entries = []
  try {
    entries = JSON.parse(readFileSync(file, 'utf8')).tasks ?? []
  } catch {
    entries = []
  }
  // 裁决也跟着进索引行：面板的板格走 index.json 快路径，只读面板要能一眼看到"这门为什么
  // 还没开"（待裁决 n）与"用户已经定了多少"（已裁决 n），不必为每行再读一次 state.json。
  const budget = reworkBudget(state, state.phase, state.settings?.maxRework ?? 5)
  const row = {
    id: state.id,
    title: state.title,
    phase: state.phase,
    awaitingGate: state.awaitingGate ?? null,
    pendingDecisions: state.pendingDecisions ?? null,
    // 模型自主裁决（Ruling:）—— 与用户裁决（decisions）分开放：两者都要看得见，
    // 但不能混为一谈（一个是「我替你定了」，一个是「你定的」）。索引行只给**条数**
    //（面板板格够用），完整条目在 `smart_status` 的 `rulings` 里。
    rulings: Array.isArray(state.rulings) ? state.rulings.length : 0,
    decided: countDecisions(state.decisions),
    // 本阶段返工额度（已用/上限/人加额次数）：面板要在**撞墙之前**就能看见分母。
    reworkUsed: budget.used,
    reworkCap: budget.cap,
    reworkGrants: budget.grants,
    // briefing 一格（acceptance A10）：当前阶段的状态 + 路由，与「待裁决」并列。
    briefing: briefingCell(rootDir, state, state.phase),
    updatedAt: state.updatedAt,
  }
  const next = [row, ...entries.filter(entry => entry.id !== state.id)].slice(0, 100)
  mkdirSync(root, { recursive: true })
  writeAtomic(file, `${JSON.stringify({ tasks: next }, null, 2)}\n`)
}

/** How many decisions the user has recorded across all phases (index rows carry the count). */
function countDecisions(decisions) {
  let total = 0
  for (const rounds of Object.values(decisions ?? {})) {
    for (const round of Array.isArray(rounds) ? rounds : []) total += Array.isArray(round?.entries) ? round.entries.length : 0
  }
  return total
}

/** Every task row in the index, newest first. */
export function listTasks(rootDir) {
  try {
    return JSON.parse(readFileSync(join(resolve(rootDir), 'index.json'), 'utf8')).tasks ?? []
  } catch {
    return []
  }
}

/**
 * Create a task in the first design phase.
 * @param rootDir - smart root.
 * @param input - `{ title, goal, taskId? }`.
 * @param meta - `{ workspace?, workspaceSource? }`: where the session said it is.
 *   Recorded so a later `smart_finish` (possibly from another session) can promote
 *   the deliverables without guessing — the calling session's own cwd is the
 *   fallback, never `process.cwd()`.
 * @returns the new state.
 */
export function createTask(rootDir, input = {}, meta = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title.length === 0) throw new Error('smart: smart_begin needs a non-empty `title`')
  const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
  // 默认 id 走同日去重（`YYYY-MM-DD` ⇒ 一天里可能撞）；显式 id 照旧：重了就是调用方的错。
  const explicit = input.taskId === undefined ? null : assertTaskId(input.taskId)
  const id = explicit ?? uniqueTaskId(rootDir, defaultTaskId(title))
  if (readState(rootDir, id) !== null) throw new Error(`smart: task "${id}" already exists`)
  const now = new Date().toISOString()
  // shape / size 随任务落盘（同 workflow 的纪律）：之后改行配置不换在途任务的语义。
  const shape = typeof meta.shape === 'string' && Object.hasOwn(SHAPES, meta.shape) ? meta.shape : 'feature'
  const size = typeof meta.size === 'string' && SIZES.includes(meta.size) ? meta.size : 'full'
  const state = {
    id,
    title,
    goal,
    createdAt: now,
    updatedAt: now,
    shape,
    size,
    // 起始相位是**这个任务自己序列**的第一个：`review` 形态直接从 reviewing 起。
    phase: phasesFor({ shape, workflow: meta.workflow })[0],
    awaitingGate: null,
    artifacts: {},
    consults: {},
    // 用户裁决的原文（按阶段分轮次存）：门记录的是"你批了没有"，这里记的是"你定了什么"。
    decisions: {},
    gates: [],
    reworkCount: 0,
    // 用户显式加额的记录（只有门可以写，见 grantRework）：审计要能看出"这一轮返工是人批的"，
    // 而不是模型自己把额度刷长了。
    reworkGrants: [],
    history: [],
    // 额度上限是**行配置**，只有工具层知道；状态里戳一份，面板的速路径（index.json）与
    // taskStatus 才能显示 "本阶段 3/5" 而不是一个没有分母的计数。门与返工时刷新它。
    ...Number.isInteger(meta.maxRework) && meta.maxRework >= 0 ? { settings: { maxRework: meta.maxRework } } : {},
    ...typeof meta.brainstormDepth === 'string' && meta.brainstormDepth !== '' ? { brainstormDepth: meta.brainstormDepth } : {},
    // 策略版本随任务落盘：在途任务不因行配置改动而换语义。
    ...typeof meta.workflow === 'string' && WORKFLOWS.includes(meta.workflow) ? { workflow: meta.workflow } : {},
    ...typeof meta.brainstormEffort === 'string' && meta.brainstormEffort !== '' ? { brainstormEffort: meta.brainstormEffort } : {},
    ...meta.brainRoute !== undefined ? { brainRoute: meta.brainRoute } : {},

    ...typeof meta.workspace === 'string' && meta.workspace !== '' ? { workspace: meta.workspace } : {},
    ...typeof meta.workspaceSource === 'string' && meta.workspaceSource !== '' ? { workspaceSource: meta.workspaceSource } : {},
  }
  mkdirSync(taskDir(rootDir, id), { recursive: true })
  return writeState(rootDir, state)
}

/** `YYYYMMDD-HHmmss-<slug>` — sortable and safe as a path segment. */
/**
 * **本地**日历日期 `YYYY-MM-DD`。
 *
 * 任务 id 是**给人看的**（目录名、交付目录名、面板标题旁），所以按本机日历走：
 * 用 UTC 会让"今天开的任务"在东八区显示成昨天（2026-10-12 用户裁决：时间戳那半不再用
 * UTC `YYYYMMDD-HHmmss`，改成 locale 日期）。
 */
export function localDateStamp(now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 标题里的 ASCII 段（小写、非字母数字折成 `-`、截 24 字符）；中文标题 ⇒ 空串。 */
function titleSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 24)
}

/**
 * 默认任务 id：`<本地 YYYY-MM-DD>[-<ascii-slug>]`。
 *
 * `now` 可注入（测试用假时钟断"本地而非 UTC"，别用 `toISOString()` 那半边）。
 */
export function defaultTaskId(title, now = new Date()) {
  const stamp = localDateStamp(now)
  const slug = titleSlug(title)
  return slug.length === 0 ? stamp : `${stamp}-${slug}`
}

/**
 * 同日不撞车：丢掉时分秒之后，一天里第二个任务必须自己长出一个序号。
 *
 * 只在**默认 id** 这条路上用；显式传 `taskId` 的调用方仍旧要拿到 `already exists`（那是它的错，
 * 不是我们替它改名）。
 */
function uniqueTaskId(rootDir, base) {
  if (readState(rootDir, base) === null) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (readState(rootDir, candidate) === null) return candidate
  }
  throw new Error(`smart: 同一天的任务太多了（${base}-2 … ${base}-999 都被占用）`)
}

/**
 * Record one phase artifact and put the task in front of that phase's gate.
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - phase the artifact belongs to.
 * @param markdown - artifact body.
 * @returns the updated state.
 * @throws {Error} when the phase is not the machine's current phase, or the body is empty.
 */
export function recordArtifact(rootDir, id, phase, markdown) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  const file = ARTIFACT_FILE[phase]
  if (file === undefined) throw new Error(`smart: "${phase}" is not an artifact phase (one of: ${Object.keys(ARTIFACT_FILE).join(', ')})`)
  // 相位顺序按**这个任务自己的序列**（shape × workflow）判，不再按全局相位表：
  // `fix` 形态里没有 design，那不是"还没到"，是"这个任务不走那一步"。
  const list = phasesFor(state)
  if (!list.includes(phase)) {
    throw new Error(`smart: task "${id}" is a "${state.shape ?? 'feature'}" task — its phases are [${list.join(', ')}]; "${phase}" is not one of them (the shape sets what this task walks)`)
  }
  if (state.phase !== phase) {
    const here = list.indexOf(state.phase)
    const want = list.indexOf(phase)
    throw new Error(`smart: task "${id}" is in phase "${state.phase}"; the "${phase}" artifact comes ${want < here ? 'earlier (already recorded)' : `later — finish "${state.phase}" and pass its gate first`}`)
  }
  // 冻结的是**用户正在批的那份稿子**，不是"门开着"这个状态本身（acceptance A8）：
  // 门开着 + 当前 briefing 轮已确认且 fresh ⇒ 拒绝重写；否则（门开着但 briefing 未确认 /
  // stale —— 迁移态、带外改写态、revise 后）允许重写，重写即天然是新一轮 briefing 的起点。
  // 保留原例外：稿子自己还带着未决小节时照旧允许重写（把用户裁决并回产物的在途任务不能卡死）。
  const staleOpen = state.awaitingGate !== null && openDecisions(readArtifact(rootDir, id, phase)).headings.length > 0
  const confirmedFresh = state.awaitingGate !== null
    && briefingGaps(rootDir, state, phase).length === 0
    && briefingStatusOf(state.briefings?.[phase], artifactSha256(rootDir, id, phase)) === 'confirmed'
  if (confirmedFresh && !staleOpen) throw new Error(`smart: task "${id}" is waiting on gate ${state.awaitingGate}; pass it before writing more artifacts`)
  if (typeof markdown !== 'string' || markdown.trim().length === 0) throw new Error('smart: artifact body must be non-empty markdown')
  if (phase === 'plan') assertPlanContract(markdown)
  const dir = taskDir(rootDir, id)
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, file), markdown.endsWith('\n') ? markdown : `${markdown}\n`)
  const now = new Date().toISOString()
  const text = readFileSync(join(taskDir(rootDir, id), file), 'utf8')
  state.artifacts[phase] = {
    file,
    bytes: Buffer.byteLength(markdown, 'utf8'),
    at: now,
    // sha256 绑的是**写进磁盘的那些字节**（writeAtomic 归一化过尾换行）：briefing 确认
    // 绑的就是它，重算而不是复用 `bytes`（那是归一化前的长度，见 acceptance A6）。
    sha256: createHash('sha256').update(text).digest('hex'),
  }
  const open = openDecisions(markdown)
  if (open.headings.length > 0) {
    // 产物里还有只有用户能定的问题 —— **门先不开**（连 briefing 确认也开不了：confirmBriefing
    // 重查 openDecisions）。见 docs/smart-mode-design.md。
    state.pendingDecisions = { headings: open.headings, items: open.items }
  } else {
    delete state.pendingDecisions
  }
  // 门不再从这里开（acceptance A5）：开门路径只有 `confirmBriefing('confirm')` —— 门是
  // "用户看懂了"的证明，不是"文件写完了"的证明。executing 落盘后也**不再自动推进**到
  // reviewing（G2 裁决①）：等 briefing 确认后由 confirmBriefing 推进。
  state.awaitingGate = null
  state.updatedAt = now
  // 执行报告是 hand 子代理跑出来的（这条路径只由 smart_execute 走到）。
  if (phase === 'executing') bump(state, 'handSpawns')
  return writeState(rootDir, state)
}

/** Position of a phase in the design order (or PHASES order for later phases). */
function phaseIndex(phase) {
  const design = DESIGN_PHASES.indexOf(phase)
  return design === -1 ? PHASES.indexOf(phase) : design
}

/**
 * optimized 工作流：把 `plan.md` 与它的伴随 `acceptance.md` 作为**一次操作**落盘。
 *
 * 两条纪律：
 *   1. **要么两份都在、要么一份都不留**（`writeAtomicMany`）—— 半套产物会让闸门读到
 *      "计划写了、验收没写"这种不存在的中间态；
 *   2. state 只在两份都写成功之后才更新，且相位名仍是 `plan`（相位表不动，见
 *      `COMPANION_ARTIFACT` 的注释）。
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param plan - plan.md 正文。
 * @param acceptance - acceptance.md 正文（optimized 下必填）。
 * @returns the updated state.
 */
export function recordPlanAcceptance(rootDir, id, plan, acceptance) {
  assertPlanContract(plan)
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (state.workflow !== 'optimized') {
    throw new Error(`smart: task "${id}" runs the ${state.workflow ?? 'v1'} workflow — plan and acceptance are separate phases there; record them with smart_artifact one at a time`)
  }
  if (state.phase !== 'plan') throw new Error(`smart: task "${id}" is in phase "${state.phase}"; the plan+acceptance pair comes with the plan phase`)
  if (typeof plan !== 'string' || plan.trim() === '') throw new Error('smart: plan body must be non-empty markdown')
  if (typeof acceptance !== 'string' || acceptance.trim() === '') throw new Error('smart: acceptance body must be non-empty markdown — the optimized workflow records both files together')
  // 冻结判据与单文件路径一致：门开着且当前 briefing 已确认且 fresh ⇒ 不许重写。
  const staleOpen = state.awaitingGate !== null && openDecisions(readArtifact(rootDir, id, 'plan')).headings.length > 0
  const confirmedFresh = state.awaitingGate !== null
    && briefingGaps(rootDir, state, 'plan').length === 0
    && briefingStatusOf(state.briefings?.plan, artifactSha256(rootDir, id, 'plan')) === 'confirmed'
  if (confirmedFresh && !staleOpen) throw new Error(`smart: task "${id}" is waiting on gate ${state.awaitingGate}; pass it before writing more artifacts`)

  const dir = taskDir(rootDir, id)
  mkdirSync(dir, { recursive: true })
  const planText = plan.endsWith('\n') ? plan : `${plan}\n`
  const acceptanceText = acceptance.endsWith('\n') ? acceptance : `${acceptance}\n`
  writeAtomicMany([
    { file: join(dir, 'plan.md'), text: planText },
    { file: join(dir, 'acceptance.md'), text: acceptanceText },
  ])
  const now = new Date().toISOString()
  state.artifacts.plan = {
    file: 'plan.md',
    bytes: Buffer.byteLength(plan, 'utf8'),
    at: now,
    sha256: createHash('sha256').update(planText).digest('hex'),
    companion: 'acceptance.md',
    companionSha256: createHash('sha256').update(acceptanceText).digest('hex'),
  }
  // 两份里的未决小节都算数：任一份还有「需要你裁决」，门就不开。
  const open = openDecisions(planText + '\n' + acceptanceText)
  if (open.headings.length > 0) {
    state.pendingDecisions = { headings: open.headings, items: open.items }
  } else {
    delete state.pendingDecisions
  }
  state.awaitingGate = null
  state.updatedAt = now
  bump(state, 'phaseTransitions')
  return writeState(rootDir, state)
}

/**
 * 记一条**模型自主裁决**（`Ruling:`）—— 计划有缺陷 / 有歧义 / 与 spec 冲突时，模型自己定、
 * 记账、继续走，而不是卡住等人。
 *
 * 为什么与 `smart_decide` 并存：后者是**只有用户能定**的事（`state.decisions`）；这条是
 * **模型能定**的事。分流判据只有一句：*这件事只有用户能定吗？* —— 能定的不许替他定，
 * 不能定的不许卡住。superpowers 的原话：*"一个卡在问题上的会话，花掉他一整天，什么也没
 * 买到；一个错误的裁决，是他看得见、可以撤销的返工。"*
 *
 * 形状照它的 ledger 行：`Ruling: <决定了什么> — <为什么> — <错了代价是什么>`。
 * 三段都必须非空 —— 只写决定不写代价的裁决，事后没法判断该不该回滚。
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param ruling - `{ decision, why, costIfWrong, phase?, by? }`。
 * @returns 写入后的 state。
 */
export function recordRuling(rootDir, id, ruling) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  const decision = typeof ruling?.decision === 'string' ? ruling.decision.trim() : ''
  const why = typeof ruling?.why === 'string' ? ruling.why.trim() : ''
  const costIfWrong = typeof ruling?.costIfWrong === 'string' ? ruling.costIfWrong.trim() : ''
  if (decision === '') throw new Error('smart: a ruling needs `decision` — what you decided')
  if (why === '') throw new Error('smart: a ruling needs `why` — the reasoning you decided it on')
  if (costIfWrong === '') throw new Error('smart: a ruling needs `costIfWrong` — what it costs if this turns out wrong (that is what makes it reviewable later)')
  const entry = {
    at: new Date().toISOString(),
    phase: ruling?.phase ?? state.phase,
    decision,
    why,
    costIfWrong,
    by: ruling?.by === 'hand' ? 'hand' : 'model',
  }
  if (!Array.isArray(state.rulings)) state.rulings = []
  state.rulings.push(entry)
  writeState(rootDir, state)
  return state
}

/**
 * 执行报告里 hand 自己写下的裁决（`## Rulings` 小节）。
 *
 * hand 在执行中撞到计划缺陷/歧义时不能干等，但它的决定必须留痕 —— 这一节是它的 ledger。
 * 解析刻意钝（同 `openDecisions`）：`## Rulings`（或 `## 裁决`）小节里的每一条
 * `- **决定** — 为什么 — 错了代价`，拆不出三段的整条丢弃并照实计数（**宁可少记，
 * 不记不存在的裁决**）。
 *
 * @param reportMarkdown - 执行报告正文。
 * @returns `{ rulings, skipped }` —— 能用的裁决与被丢弃的条数。
 */
export function rulingsFromReport(reportMarkdown) {
  const text = typeof reportMarkdown === 'string' ? reportMarkdown : ''
  const lines = text.split('\n')
  const start = lines.findIndex(line => /^#{2,6}\s+.*\b(Rulings|裁决)\b/u.test(line.trim()))
  if (start === -1) return { rulings: [], skipped: 0 }
  const rulings = []
  let skipped = 0
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (/^#{1,6}\s/u.test(line)) break
    if (!line.startsWith('-')) continue
    // `- **决定** — 为什么 — 错了代价`：三段用 em dash 或 `—` 分。
    const parts = line.replace(/^[-*]\s+/u, '').split(/\s+[—–-]{1,2}\s+/u)
    const [decision, why, costIfWrong] = parts.map(part => part?.replace(/^\*\*|\*\*$/gu, '').trim() ?? '')
    if (parts.length < 3 || decision === '' || why === '' || costIfWrong === '') { skipped += 1; continue }
    rulings.push({ decision, why, costIfWrong })
  }
  return { rulings, skipped }
}

/**
 * Record the user's decisions for one phase — the answers to the questions only they
 * can make, still unanswered when the artifact was drafted.
 *
 * Kept as a transcript (rounds, newest last) so the gate record can be audited against
 * what the user actually said, and so the workbench can show "已裁决 n 项". This call
 * does **not** open the gate and does **not** touch the artifact: the brain model still
 * has to fold the answers into the artifact and re-record it (which is what removes the
 * 需要你裁决 heading and lets the gate open).
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - phase the decisions belong to.
 * @param entries - `[{ question, options?, multiSelect?, selected, custom }]`.
 * @param meta - `{ by }` audit trail.
 * @returns the updated state.
 */
export function recordDecisions(rootDir, id, phase, entries = [], meta = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (!DESIGN_PHASES.includes(phase) && phase !== 'reviewing') {
    throw new Error(`smart: phase "${phase}" does not take decisions (design phases and reviewing do)`)
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('smart: smart_decide needs at least one question')
  for (const entry of entries) {
    if (typeof entry?.question !== 'string' || entry.question.trim() === '') throw new Error('smart: every decision needs a non-empty `question`')
  }
  const at = new Date().toISOString()
  state.decisions = state.decisions ?? {}
  state.decisions[phase] = [...state.decisions[phase] ?? [], { at, by: meta.by ?? 'user', entries }]
  state.updatedAt = at
  return writeState(rootDir, state)
}

/**
 * Close the current gate and advance the machine.
 *
 * Gate preconditions live here (not in the prompt): G1–G4 need that phase's
 * artifact, and — while `requireConsult` is on — its consult record. G5 needs
 * the execution report and the review.
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param gate - gate id being passed (`G1`..`G5`).
 * @param decision - `{ by, note? }` audit trail of who confirmed.
 * @param options - `{ requireConsult }` from row config (NOT task state).
 * @returns the updated state.
 */
export function passGate(rootDir, id, gate, decision = {}, options = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (state.awaitingGate !== gate) throw new Error(`smart: task "${id}" is not waiting on gate ${gate}${state.awaitingGate === null ? ' (no gate open)' : ` (open: ${state.awaitingGate})`}`)
  const owner = Object.keys(GATE_AFTER).find(phase => GATE_AFTER[phase] === gate)
  if (owner === undefined) throw new Error(`smart: unknown gate "${gate}"`)
  const missing = gateGaps(rootDir, state, { requireConsult: options.requireConsult !== false })
  if (missing.length > 0) throw new Error(`smart: gate ${gate} is blocked — ${missing.join('; ')}`)
  const now = new Date().toISOString()
  state.gates.push({ gate, at: now, by: decision.by ?? 'user', note: decision.note ?? '' })
  // 下一个相位按**这个任务自己的序列**走：optimized 的 plan 相位已经把验收设计一起做完
  // （两文件同一次评审、同一道门）⇒ 序列里没有 acceptance，G3 直接进执行；`review` 形态
  // 只有 reviewing，过完 G5 就没有下一个了。v1 feature 的 plan → acceptance → executing
  // 一个字都不动（`phasesFor` 给的就是那条）。
  state.phase = nextPhaseFor(state, owner) ?? NEXT_PHASE[owner]
  state.awaitingGate = null
  bump(state, 'gatesPassed', 'phaseTransitions')
  state.updatedAt = now
  return writeState(rootDir, state)
}

/**
 * What still blocks the open gate, as human-readable lines.
 *
 * @param rootDir - smart root (the decision check re-reads the artifact, so an edit
 *   made outside smart_artifact cannot smuggle unanswered questions past the gate).
 * @param state - task state.
 * @param options - `{ requireConsult }` from row config (NOT task state).
 * @returns gap list (empty means the gate can close).
 */
export function gateGaps(rootDir, state, options = {}) {
  const requireConsult = options.requireConsult !== false
  if (state.awaitingGate === null) return ['no gate is open']
  const owner = Object.keys(GATE_AFTER).find(phase => GATE_AFTER[phase] === state.awaitingGate)
  const gaps = []
  // 只对**这个任务序列里**的相位要产物：`review` 形态没有执行阶段，就不存在
  // "缺 execution-report.md" 这回事 —— 闸门要的是 shape 说它走的那几步的产物。
  const walked = phasesFor(state)
  if (state.awaitingGate === 'G5') {
    for (const phase of ['executing', 'reviewing'].filter(item => walked.includes(item))) {
      if (state.artifacts[phase] === undefined) gaps.push(`missing ${ARTIFACT_FILE[phase]}`)
    }
  } else if (owner !== undefined && state.artifacts[owner] === undefined) {
    gaps.push(`missing ${ARTIFACT_FILE[owner]}`)
  }
  // optimized 的 plan 相位把 acceptance.md 当伴随产物一起写：它缺了同样是缺口
  // （两份是一次原子写入的，缺一份说明盘上的东西不是这个工作流产出的）。
  // **只有 optimized** 才把 acceptance.md 当 plan 的伴随产物：v1 的 acceptance.md 是
  // 下一个阶段自己的产物，在 G3 时当然还不存在（早先写成无条件 ⇒ v1 的 G3 全部误报缺口）。
  if (owner !== undefined && state.workflow === 'optimized') {
    const companion = companionFileOf(owner)
    if (companion !== null && !existsSync(join(taskDir(rootDir, state.id), companion))) {
      gaps.push(`missing ${companion} (the optimized plan phase records plan.md and acceptance.md together)`)
    }
  }
  // Consult records belong to the four design phases: in the execution and
  // review phases the hand model IS the other half of the pair, so demanding a
  // separate review-of-the-review would be ceremony, not control.
  // 哪些阶段**必须**有独立 consult 由任务的策略版本决定（optimized 下 brainstorm 不派 review：
  // 候选方案阶段还没有可执行性可审）。未知版本按 v1 兜底，绝不静默放宽。
  if (requireConsult && owner !== undefined && consultPhasesFor(state).includes(owner) && state.consults[owner] === undefined) gaps.push(`missing consult record for "${owner}" (requireConsult)`)
  // briefing 闸门（acceptance A5）：门所属阶段（G5 取 reviewing）的四态 —— 缺轮 / 轮正文空 /
  // stale / 未确认 —— 任一命中即挡在 ask 之前。开门路径只有 confirmBriefing('confirm')，
  // 所以这里兜的是**迁移态**（旧任务门开着但没有 briefings）与带外改写后的回退防线。
  const briefed = state.awaitingGate === 'G5' ? 'reviewing' : owner
  if (briefed !== undefined) gaps.push(...briefingGaps(rootDir, state, briefed))
  // 产物里还留着"需要你裁决"的小节：那些问题的答案只能来自用户，所以门不许过。这一条是
  // 本轮补的洞——在此之前门只查"文件在不在/评审有没有"，一份满是未决问题的稿子照样能过。
  const decisionPhases = state.awaitingGate === 'G5' ? ['reviewing'] : owner === undefined ? [] : [owner]
  for (const phase of decisionPhases) {
    const open = openDecisions(state.workflow === 'optimized'
      ? artifactTextWithCompanion(rootDir, state.id, phase)
      : readArtifact(rootDir, state.id, phase))
    if (open.headings.length === 0) continue
    const what = open.items === 0 ? 'an open section' : `${open.items} unanswered decision(s)`
    gaps.push(`${ARTIFACT_FILE[phase]} still has ${what} under "${open.headings.join(' / ')}" — put the questions to the user (smart_decide) and fold the answers into the artifact first`)
  }
  // 计划文档契约（smart-plan 的三块）：一份缺 Interfaces / Global Constraints / Review Focus
  // 的 plan.md **不该被批准** —— 那三块正是"另一个模型只读这些文件就能执行"的最低保证。
  // 只查 plan.md 自己：optimized 的 acceptance.md 是另一份产物，不背这个契约。
  if (owner === 'plan' && state.artifacts.plan !== undefined) {
    for (const gap of planContractGaps(readArtifact(rootDir, state.id, 'plan'))) {
      gaps.push(`plan.md lacks ${gap} — see the smart-plan skill for what each block must carry`)
    }
  }
  return gaps
}

/**
 * A task's snapshot for `smart_status`: phase, artifacts, open gate, gaps, and
 * what the operator should do next.
 * @param rootDir - smart root.
 * @param id - task id.
 * @param options - `{ requireConsult }` from row config.
 * @returns status object.
 */
export function taskStatus(rootDir, id, options = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  const gaps = gateGaps(rootDir, state, { requireConsult: options.requireConsult !== false })
  return {
    id: state.id,
    title: state.title,
    goal: state.goal,
    phase: state.phase,
    // 任务自己的策略版本（旧任务没有这个字段 ⇒ 按 v1 报）。
    workflow: state.workflow ?? 'v1',
    awaitingGate: state.awaitingGate,
    artifacts: Object.fromEntries(Object.entries(state.artifacts).map(([phase, meta]) => [phase, meta])),
    consults: Object.keys(state.consults),
    // S3 之后模型要能自查"取证成没成、归档没归档"：没有这两行，它写完验收也不知道
    // 证据是否真的落盘，只能靠记忆猜。
    verifications: (state.verifications ?? []).map(record => ({ at: record.at, file: record.file, route: record.provider === null || record.provider === undefined ? null : `${record.provider}/${record.model}` })),
    gates: state.gates,
    // 面板与模型都要能一眼看到"这门为什么还没开"/"用户已经定了什么"
    pendingDecisions: state.pendingDecisions ?? null,
    // 模型自主裁决（Ruling:）—— 与用户裁决（decisions）分开放：两者都要看得见，
    // 但不能混为一谈（一个是「我替你定了」，一个是「你定的」）。
    // shape/size 与这个任务的相位序列：面板据此画板格 —— 裁掉的相位是**不存在**，
    // 不该在板上留一个永远"待做"的格子。
    shape: state.shape ?? 'feature',
    size: state.size ?? 'full',
    phases: phasesFor(state),
    // 评审包（S6）：执行者落的 `evidence/changes.md`。状态里如实报**在不在** ——
    // 它由执行者写，所以"有没有"本身就是信息（评审者据此知道看的是不是二手结论）。
    reviewPackage: existsSync(join(taskDir(rootDir, state.id), 'evidence', 'changes.md')),
    rulings: Array.isArray(state.rulings) ? state.rulings : [],
    decided: Object.fromEntries(Object.entries(state.decisions ?? {}).map(([phase, rounds]) => [phase, rounds.reduce((sum, round) => sum + (round.entries?.length ?? 0), 0)])),
    reworkCount: state.reworkCount,
    // briefing 面（每阶段：轮数、当前轮、状态、路由、source）：模型自查"确认收了没有"，
    // 面板画「待确认/已确认/已过期/生成失败」格。
    briefings: Object.fromEntries(BRIEFING_PHASES.map(phase => {
      const entry = state.briefings?.[phase]
      const round = currentBriefingRound(state, phase)
      return [phase, {
        rounds: entry?.rounds?.length ?? 0,
        current: entry?.current ?? 0,
        status: briefingStatusOf(entry, ARTIFACT_FILE[phase] === undefined ? null : artifactSha256(rootDir, state.id, phase)),
        at: round?.at ?? entry?.failedAt ?? null,
        route: round === null || (round.provider == null && round.model == null) ? null : `${round.provider}/${round.model}`,
        source: round?.source ?? null,
      }]
    })),
    // 子代理调用是这套流程的主要墙钟与费用：给一个**从磁盘算得出来**的估算（不新增状态面）。
    // review 侧 = 已落盘的 briefing 轮 + consult 记录 + 取证记录；hand 侧 = 执行报告在不在。
    // 它只用于"这一轮比上一轮贵/便宜"的对照，不参与任何闸门判定。
    spawns: spawnEstimate(state),
    // 真实计数（只在真的起过 child / 真的命中缓存处加一）；老 state 读作全零。
    metrics: metricsOf(state),
    // 哪些阶段是一次 bundle 出的（同一 child 出要点 + consult）—— 审计要能看出来。
    reviewBundles: Object.fromEntries(Object.entries(state.reviewBundles ?? {}).map(([phase, bundle]) => [phase, { at: bundle.at, route: bundle.provider == null && bundle.model == null ? null : `${bundle.provider}/${bundle.model}`, source: bundle.source ?? null }])),
    // 分母也报给模型/面板：额度快用尽时模型该知道"再要一轮就得用户点头"。
    rework: reworkBudget(state, state.phase, options.maxRework ?? state.settings?.maxRework ?? 5),
    reworkedFrom: (state.history ?? []).map(entry => ({ at: entry.at, from: entry.from, to: entry.to })),
    ...state.archivedAt === undefined ? {} : { archivedAt: state.archivedAt, summary: state.summary?.file ?? null },
    gaps,
    next: nextAction(rootDir, state, gaps),
  }
}

/**
 * 这套工作流至今花掉了多少次子代理调用（**估算**，从磁盘上的记录数出来）。
 *
 * 为什么是估算而不是埋点计数：briefing 轮、consult 记录、取证记录本身就是"一次子代理
 * 跑完留下的凭据"，数它们不需要新的状态面，也不会因为中途崩溃而漏记（崩溃那一轮本来
 * 就没留下记录）。它够用来回答"优化到底省了没有"：v1 的每个设计阶段是 1 briefing +
 * 1 consult，optimized 的 brainstorm 是 0 + 0。
 */
export function spawnEstimate(state) {
  const rounds = Object.values(state.briefings ?? {}).flatMap(entry => entry?.rounds ?? [])
  // **关键区别**：一轮要点不等于一次子代理调用。`brain/session` 的轮是 brain 自己写的
  // （optimized 的 brainstorm，零 child），把它算成 review 调用会把这套优化的证据抹掉 ——
  // 那一版就是错的：轮次被当成调用，于是"省掉一次"在读刻度上等于没省。
  const inline = rounds.filter(round => round?.source === 'brain/session').length
  const reviewed = rounds.length - inline
  const consults = Object.keys(state.consults ?? {}).length
  const verifications = (state.verifications ?? []).length
  const hand = state.artifacts?.executing === undefined ? 0 : 1
  const review = reviewed + consults + verifications
  // total 只数真正起过的子代理；inline 单独报（它省下来的正是这些）。
  return { review, hand, inline, total: review + hand }
}

/**
 * One-line guidance derived from the machine's position.
 *
 * Kept accurate as the tool surface grew: it names the tool that moves the task
 * now (`smart_execute` while executing, `smart_verify` before the verdict), so a
 * model reading only `smart_status` knows what to do next.
 */
function nextAction(rootDir, state, gaps) {
  if (state.phase === 'cancelled') return 'task cancelled'
  if (state.phase === 'done') {
    return state.archivedAt === undefined ? 'task complete — archive it with smart_finish' : 'task complete and archived'
  }
  if (state.pendingDecisions !== undefined && state.pendingDecisions !== null) {
    const file = ARTIFACT_FILE[state.phase] ?? 'the artifact'
    return `the draft still has ${state.pendingDecisions.items} unanswered decision(s) in ${file} — put them to the user (smart_decide), fold the answers in, then re-record the artifact (smart_artifact); the gate opens only after that`
  }
  if (state.awaitingGate !== null) {
    const gate = state.awaitingGate
    // 把缺口写进指引本身：模型只读 next 也能知道差什么，不必回翻 status.gaps。
    if (gaps.length > 0) return `close ${gaps.join('; ')}, then ask the user to confirm gate ${gate}`
    return `ask the user to confirm gate ${gate} (smart_gate)`
  }
  // briefing 分支排在 executing 分支**之前**（acceptance B3）：执行报告落盘后停在 executing，
  // 下一步是 briefing 而不是"再执行一次"。产物还没写时不算 —— 那时该写产物。
  const briefing = state.artifacts[state.phase] === undefined ? [] : briefingGaps(rootDir, state, state.phase)
  if (briefing.length > 0) {
    return briefing[0].startsWith('missing briefing')
      ? `generate the briefing (smart_brief), present it to the user in conversation, then record their answer with smart_brief_confirm`
      : `fix the briefing (${briefing[0]}), then record the user's answer with smart_brief_confirm`
  }
  if (state.phase === 'executing') return 'call smart_execute to hand the approved plan to the hand model'
  if (state.phase === 'reviewing') {
    return (state.verifications ?? []).length === 0
      ? 'gather evidence with smart_verify, then write review.md (smart_artifact phase="reviewing")'
      : 'write your verdict as review.md (smart_artifact phase="reviewing")'
  }
  const file = ARTIFACT_FILE[state.phase]
  return file === undefined ? `phase "${state.phase}" has no artifact to write` : `write ${file} (smart_artifact phase="${state.phase}")`
}

/**
 * Record the hand model's review of the current phase (design §4).
 *
 * Requires the phase's own artifact to exist — a review of a draft nobody wrote
 * is not a review. The `handRoute` is stored with the record so the workbench can
 * prove which route actually reviewed (design §6 warns when it drifts).
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - design phase being reviewed.
 * @param review - `{ provider, model, question, body }`.
 * @returns the updated state.
 */
export function recordConsult(rootDir, id, phase, review = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (!DESIGN_PHASES.includes(phase)) throw new Error(`smart: consults cover the design phases (${DESIGN_PHASES.join(', ')}), not "${phase}"`)
  if (state.phase !== phase) throw new Error(`smart: task "${id}" is in phase "${state.phase}"; the "${phase}" review comes with its own phase`)
  if (state.artifacts[phase] === undefined) throw new Error(`smart: write ${ARTIFACT_FILE[phase]} before asking for a review of it`)
  if (typeof review.body !== 'string' || review.body.trim().length === 0) throw new Error('smart: a consult record needs the review text')
  const dir = taskDir(rootDir, id)
  mkdirSync(join(dir, 'consult'), { recursive: true })
  const at = new Date().toISOString()
  const record = {
    phase,
    at,
    provider: review.provider ?? null,
    model: review.model ?? null,
    question: review.question ?? '',
    body: review.body,
  }
  writeAtomic(join(dir, 'consult', `${phase}.json`), `${JSON.stringify(record, null, 2)}\n`)
  state.consults[phase] = { at, provider: record.provider, model: record.model, question: record.question, file: `consult/${phase}.json` }
  state.updatedAt = at
  bump(state, 'consults', 'reviewSpawns')
  return writeState(rootDir, state)
}

/** One consult record, or null. */
export function readConsult(rootDir, id, phase) {
  try {
    return JSON.parse(readFileSync(join(taskDir(rootDir, id), 'consult', `${phase}.json`), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Briefing 回路（阶段产物对话式审阅）：产物落盘 → review 路由出 briefing → 脑模型用
// 对话讲给用户 → `smart_brief_confirm` 收用户真实应答 → **门才开**。
//
// 设计（docs/smart-mode-design.md「briefing 回路」，acceptance.md A5–A10）里两条承重：
//
//   - **开门路径只有 `confirmBriefing('confirm')`。** `recordArtifact` 不再开门；门是
//     用户看懂了的证明，不是"文件写完了"的证明。
//   - **briefing 绑产物 sha256（重读磁盘算，不采信调用方）。** 产物一改，旧确认自动
//     stale —— 用户确认的是一份**具体的稿子**，不是这个阶段名。
// ─────────────────────────────────────────────────────────────────────────────

/** Phases whose artifact gets a briefing: every artifact phase. */
export const BRIEFING_PHASES = Object.keys(ARTIFACT_FILE)

/** Absolute path of briefing round `n` for one phase. */
export function briefingRoundPath(rootDir, id, phase, n) {
  return join(taskDir(rootDir, id), 'briefings', `${phase}-${n}.md`)
}

/**
 * sha256 of the artifact bytes **on disk** (hex), or null when the artifact is missing.
 *
 * Re-read every time on purpose: the hash is the binding between a briefing and "the
 * draft the user confirmed", so it may not trust a caller's copy of either.
 */
export function artifactSha256(rootDir, id, phase) {
  const file = ARTIFACT_FILE[phase]
  if (file === undefined) throw new Error(`smart: "${phase}" is not an artifact phase`)
  try {
    return createHash('sha256').update(readFileSync(join(taskDir(rootDir, id), file))).digest('hex')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** One briefing round's body, or null when the file is missing. */
export function readBriefingRound(rootDir, id, phase, n) {
  try {
    return readFileSync(briefingRoundPath(rootDir, id, phase, n), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * 计划文档契约（`smart-plan` 技能的三块）：一份 plan.md 该带、而 smart 原先只要求
 * 「分组步骤 / 每步验收检查点 / 回滚点」的那三样。
 *
 * | 块 | 它买的是什么 |
 * | --- | --- |
 * | `Interfaces` | 一个实现者**只看得到自己的任务**，这一块是他怎么知道邻居任务用什么名字与类型 |
 * | `Global Constraints` | spec 里项目级硬约束的**逐字抄写**（版本下限、命名规则、平台要求）—— 每个任务的隐含前提 |
 * | `Review Focus` | spec **暗示了但没有任何任务的测试覆盖**的输入类/失败模式。*"spec 的沉默不是允许程序在这个输入上坏掉"* |
 *
 * 判据刻意做得**钝**（同 `openDecisions` 的理由）：`##` 小节标题 + 三个关键词的字面出现。
 * 聪明的解析会漏掉一节，而漏掉的那一节正是计划不可执行的原因 —— 一个标题就能拦下整道门。
 */
export const PLAN_CONTRACT = ['Interfaces', 'Global Constraints', 'Review Focus']

/**
 * plan.md 缺少的计划契约块（空数组 = 齐全）。
 *
 * - `Global Constraints` / `Review Focus`：必须是 `##`+ 小节标题（标题文本含该短语）。
 * - `Interfaces`：任务块里的是 **`**Interfaces:**` 粗体标签**而非标题，所以按关键词判；
 *   且**每个任务块都要有一份** —— 只在一处写 Interfaces 而有 5 个任务，等于 4 个任务的
 *   实现者仍然不知道邻居的名字。任务块数按 `^### Task` 数。
 *
 * @param markdown - plan.md 的正文。
 * @returns 缺失项的英文描述，空数组表示契约齐全。
 */
export function planContractGaps(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  if (text.trim() === '') return ['plan.md is empty']
  const gaps = []
  const headings = artifactSections(text)
  for (const want of ['Global Constraints', 'Review Focus']) {
    if (!headings.some(heading => heading.includes(want))) gaps.push(`a "## …${want}…" section`)
  }
  // Interfaces：粗体标签，出现在每个 Task 块里。
  const taskBlocks = text.split('\n').filter(line => /^#{3,4}\s+.*\bTask\b/u.test(line.trim())).length
  const interfaces = (text.match(/\bInterfaces\b/gu) ?? []).length
  if (taskBlocks > 0 ? interfaces < taskBlocks : interfaces === 0) {
    gaps.push(`an "**Interfaces:**" block per task (${taskBlocks > 0 ? `found ${interfaces}, need ${taskBlocks}` : 'need at least one'})`)
  }
  for (const want of ['Consumes', 'Produces']) {
    if (!text.includes(want)) gaps.push(`"**${want}:**" lines under each Interfaces block`)
  }
  return gaps
}

/**
 * plan.md 必须带计划契约 —— **写入处就挡**，不等门。
 *
 * 为什么两处都要：等 G3 才撞墙 = 白花 briefing + consult 两轮子代理；门上那道仍在
 * （defense in depth：盘上的文件也可能被人手改过）。
 * @param markdown - 要写进 plan.md 的正文。
 * @throws 契约不齐时逐条列出缺什么。
 */
export function assertPlanContract(markdown) {
  const gaps = planContractGaps(markdown)
  if (gaps.length > 0) {
    throw new Error(`smart: plan.md does not carry the document contract — ${gaps.join('; ')} — see the smart-plan skill for what each block must carry (an "**Interfaces:**" block per task with Consumes/Produces, a "## Global Constraints" section, a "## Review Focus" section)`)
  }
}

/**
 * The artifact's section headings a briefing must mention.
 *
 * ATX `##` and deeper, fence-aware (a `## fake` inside a fenced code block is not a
 * section), heading text trimmed the way `openDecisions` trims. A level-1 `#` title is
 * the document name, not a section.
 */
export function artifactSections(markdown) {
  if (typeof markdown !== 'string') return []
  const headings = []
  let fenced = false
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (/^(```|~~~)/u.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    if (/^#{2,6}\s/u.test(line)) headings.push(line.replace(/^#{1,6}\s*/u, '').trim())
  }
  return headings
}

/**
 * What a briefing body fails to cover (empty list = complete).
 *
 * Section rule (acceptance A1): every `##`+ heading text must appear in the body as a
 * literal substring. Artifact without such headings ⇒ the body must be non-empty and
 * carry the three keywords 结论 / 风险 / 未决. A long body proves nothing on its own.
 */
export function missingBriefingSections(artifact, body) {
  const text = typeof body === 'string' ? body : ''
  const missing = []
  if (text.trim() === '') missing.push('briefing body is empty')
  const sections = artifactSections(artifact)
  if (sections.length === 0) {
    for (const word of ['结论', '风险', '未决']) if (!text.includes(word)) missing.push(`keyword "${word}"`)
  } else {
    for (const heading of sections) if (!text.includes(heading)) missing.push(`section "${heading}"`)
  }
  return missing
}

/** The current round record of one phase's briefing, or null. */
function currentBriefingRound(state, phase) {
  const entry = state.briefings?.[phase]
  if (entry === undefined) return null
  const n = entry.current ?? 0
  return (entry.rounds ?? []).find(round => round.n === n) ?? null
}

/**
 * Derived briefing status (acceptance A10's total ordering — keep in sync with the
 * panel mapping). `failedAt` counts only when it is **strictly** newer than the latest
 * round; equal timestamps fall through (a failure marker and its retry share a clock).
 *
 * ① failedAt later than latest round ⇒ failed ② no round ⇒ none ③ round sha ≠ artifact
 * sha ⇒ stale ④ decision confirm ⇒ confirmed ⑤ decision revise ⇒ revise ⑥ awaiting-user.
 */
export function briefingStatusOf(entry, artifactSha) {
  const rounds = entry?.rounds ?? []
  const latest = rounds.at(-1)?.at ?? null
  if (typeof entry?.failedAt === 'string' && (latest === null || entry.failedAt > latest)) return 'failed'
  const round = entry === undefined ? null : rounds.find(item => item.n === (entry.current ?? 0))
  if (round === undefined || round === null) return 'none'
  if (round.artifactSha256 !== artifactSha) return 'stale'
  if (round.decision === 'confirm') return 'confirmed'
  if (round.decision === 'revise') return 'revise'
  return 'awaiting-user'
}

/** Re-derive every phase's `status` in place (readers want it fresh, not remembered). */
export function refreshBriefings(rootDir, state) {
  for (const phase of BRIEFING_PHASES) {
    const entry = state.briefings?.[phase]
    if (entry === undefined) continue
    entry.status = briefingStatusOf(entry, artifactSha256(rootDir, state.id, phase))
  }
  return state
}

/** The index-row / panel cell for one phase's briefing (`null` = unknown). */
export function briefingCell(rootDir, state, phase) {
  const entry = state.briefings?.[phase]
  // done/cancelled 不是产物阶段：没有产物可绑，格子照实报 none（不是抛错）。
  const sha = ARTIFACT_FILE[phase] === undefined ? null : artifactSha256(rootDir, state.id, phase)
  const status = briefingStatusOf(entry, sha)
  const round = currentBriefingRound(state, phase)
  return {
    status,
    at: round?.at ?? entry?.failedAt ?? null,
    route: round === null || (round.provider == null && round.model == null) ? null : `${round.provider}/${round.model}`,
  }
}

/**
 * Record one briefing round for a phase artifact (design §briefing).
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - phase the briefing covers.
 * @param review - `{ provider, model, source, body }`.
 * @returns the updated state.
 * @throws {Error} when there is no artifact, the body is empty, or (A8) the gate is
 *   open and the current round is already confirmed and fresh — a regeneration must
 *   never silently discard what the user confirmed.
 */
export function recordBriefing(rootDir, id, phase, review = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (ARTIFACT_FILE[phase] === undefined) throw new Error(`smart: "${phase}" is not an artifact phase`)
  if (state.phase !== phase) throw new Error(`smart: task "${id}" is in phase "${state.phase}"; the "${phase}" briefing comes with its own phase`)
  const artifact = readArtifact(rootDir, id, phase)
  if (artifact === null) throw new Error(`smart: write ${ARTIFACT_FILE[phase]} before briefing it`)
  if (typeof review.body !== 'string' || review.body.trim().length === 0) throw new Error('smart: a briefing needs its body text')
  const sha = artifactSha256(rootDir, id, phase)
  const current = currentBriefingRound(state, phase)
  if (state.awaitingGate !== null && current !== null && current.decision === 'confirm' && current.artifactSha256 === sha) {
    throw new Error(`smart: the briefing for "${phase}" is confirmed and current while gate ${state.awaitingGate} is open — answer 需要修改 at smart_brief_confirm (or pass the gate) instead of regenerating over the user's confirmation`)
  }
  const at = new Date().toISOString()
  const entry = state.briefings?.[phase] ?? { rounds: [], current: 0 }
  const n = (entry.rounds.at(-1)?.n ?? 0) + 1
  const dir = join(taskDir(rootDir, id), 'briefings')
  mkdirSync(dir, { recursive: true })
  writeAtomic(briefingRoundPath(rootDir, id, phase, n), review.body.endsWith('\n') ? review.body : `${review.body}\n`)
  entry.rounds.push({
    n,
    at,
    file: `briefings/${phase}-${n}.md`,
    provider: review.provider ?? null,
    model: review.model ?? null,
    source: review.source ?? null,
    // 返工升档（S4）：本阶段反复修不好的点，评审那侧被提到该模型支持的最高档。
    // 如实记下来 —— 用户有权知道这一轮的评审**比上一轮更用力**，以及为什么。
    escalated: review.escalated === true,
    attempts: typeof review.attempts === 'number' ? review.attempts : 0,
    artifactSha256: sha,
    decision: null,
    confirmedAt: null,
  })
  entry.current = n
  state.briefings = { ...(state.briefings ?? {}), [phase]: entry }
  state.updatedAt = at
  // 一轮要点背后可能是 review child，也可能是 brain 自己写的：两者在成本上是两回事。
  bump(state, 'briefings')
  bump(state, review.source === 'brain/session' ? 'brainRounds' : 'reviewSpawns')
  return writeState(rootDir, refreshBriefings(rootDir, state))
}

/**
 * Mark the last generation attempt as failed (no round is written for it).
 *
 * The panel needs to say 生成失败, so the failure itself is state — "wrote nothing" is
 * indistinguishable from "never tried" otherwise (acceptance A10).
 */
export function recordBriefingFailure(rootDir, id, phase, error) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  const at = new Date().toISOString()
  const entry = state.briefings?.[phase] ?? { rounds: [], current: 0 }
  entry.failedAt = at
  entry.lastError = String(error?.message ?? error).slice(0, 500)
  state.briefings = { ...(state.briefings ?? {}), [phase]: entry }
  state.updatedAt = at
  return writeState(rootDir, refreshBriefings(rootDir, state))
}

/**
 * Record the user's answer to a briefing (acceptance A7).
 *
 * The decision comes from `userQuestions.ask`'s real answer — never from a tool
 * argument. Only the **current, still-unanswered** round may be confirmed (the caller
 * passes the round number it showed the user; a newer round appearing in between makes
 * the answer stale).
 *
 * `confirm` opens the phase gate (`G1..G4`), advances executing → reviewing, or opens
 * `G5` from reviewing. `revise` closes the gate without consuming rework budget.
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - phase the briefing belongs to.
 * @param decision - `'confirm' | 'revise'`.
 * @param options - `{ round }`: the round number the user was shown.
 * @returns the updated state.
 */
export function confirmBriefing(rootDir, id, phase, decision, options = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (decision !== 'confirm' && decision !== 'revise') throw new Error(`smart: briefing decision must be "confirm" or "revise", got "${decision}"`)
  const entry = state.briefings?.[phase]
  const round = currentBriefingRound(state, phase)
  if (entry === undefined || round === null) throw new Error(`smart: no briefing round to answer for "${phase}" — generate one first (smart_brief)`)
  if (options.round !== undefined && options.round !== round.n) {
    throw new Error(`smart: briefing round ${options.round} of "${phase}" is not the current one (now ${round.n}) — the user's answer refers to what they were shown; show them the new round`)
  }
  if (round.decision !== null) throw new Error(`smart: briefing round ${round.n} of "${phase}" is already answered (${round.decision})`)
  const artifact = readArtifact(rootDir, id, phase)
  const open = openDecisions(artifact)
  if (open.headings.length > 0) {
    throw new Error(`smart: ${ARTIFACT_FILE[phase]} still has unanswered decision(s) under "${open.headings.join(' / ')}" — put them to the user (smart_decide) and fold the answers in before confirming the briefing`)
  }
  const sha = artifactSha256(rootDir, id, phase)
  if (round.artifactSha256 !== sha) {
    throw new Error(`smart: briefing round ${round.n} of "${phase}" is stale — ${ARTIFACT_FILE[phase]} changed after it was generated; regenerate (smart_brief) and confirm the new round`)
  }
  const at = new Date().toISOString()
  round.decision = decision
  round.confirmedAt = at
  if (decision === 'revise') {
    // 用户要改稿：门保持关，且**不消耗**返工额度 —— 改稿是对话的一部分，不是返工。
    state.awaitingGate = null
  } else if (phase === 'executing') {
    // G2 裁决①：执行报告确认后才进验收（执行→验收的确认门，不占 G1–G5 编号）。
    state.phase = nextPhaseFor(state, phase) ?? NEXT_PHASE[phase]
    state.awaitingGate = null
  } else {
    state.awaitingGate = GATE_AFTER[phase] ?? null
  }
  state.updatedAt = at
  return writeState(rootDir, refreshBriefings(rootDir, state))
}

/**
 * 一次 review child 同时产出「用户版要点」与「可行性 consult」时，两段一起落盘。
 *
 * 这是 optimized 工作流的省钱点：design/plan/acceptance 三段原本各要 2 次子代理调用
 * （auto briefing + consult），合成一次 bundle 后各只要 1 次。**两段的审计记录仍然分开**
 * （`briefings/` 与 `consult/` 各写各的），`reviewBundles` 只记"这一次是同一个 child 出的"。
 *
 * 原子性：两个内容文件先一起写（`writeAtomicMany`），state 只更新一次 —— 不会出现
 * "consult 有了、要点没有"这种半套成功；任一步失败就只剩产物本身，可重试。
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - phase being reviewed.
 * @param bundle - `{ provider, model, source, briefingBody, consultBody }`.
 * @returns the updated state.
 */
export function recordReviewBundle(rootDir, id, phase, bundle = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (state.phase !== phase) throw new Error(`smart: task "${id}" is in phase "${state.phase}"; the "${phase}" bundle comes with its own phase`)
  if (ARTIFACT_FILE[phase] === undefined) throw new Error(`smart: "${phase}" is not an artifact phase`)
  const artifact = readArtifact(rootDir, id, phase)
  if (artifact === null) throw new Error(`smart: write ${ARTIFACT_FILE[phase]} before reviewing it`)
  const briefingBody = typeof bundle.briefingBody === 'string' ? bundle.briefingBody : ''
  const consultBody = typeof bundle.consultBody === 'string' ? bundle.consultBody : ''
  if (briefingBody.trim() === '' || consultBody.trim() === '') {
    throw new Error('smart: a review bundle needs both halves — the user-facing briefing and the feasibility consult; nothing was recorded')
  }
  const missing = missingBriefingSections(artifact, briefingBody)
  if (missing.length > 0) throw new Error(`smart: the briefing half of the bundle for "${phase}" does not cover the artifact — missing: ${missing.join('; ')}. Nothing was recorded.`)

  const entry = state.briefings?.[phase] ?? { rounds: [], current: 0 }
  const n = (entry.rounds.at(-1)?.n ?? 0) + 1
  const dir = join(taskDir(rootDir, id), 'briefings')
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(taskDir(rootDir, id), 'consult'), { recursive: true })
  const at = new Date().toISOString()
  const roundFile = `briefings/${phase}-${n}.md`
  const consultFile = `consult/${phase}.json`
  const record = {
    phase,
    at,
    provider: bundle.provider ?? null,
    model: bundle.model ?? null,
    question: bundle.question ?? '',
    body: consultBody,
  }
  writeAtomicMany([
    { file: join(taskDir(rootDir, id), roundFile), text: briefingBody.endsWith('\n') ? briefingBody : `${briefingBody}\n` },
    { file: join(taskDir(rootDir, id), consultFile), text: `${JSON.stringify(record, null, 2)}\n` },
  ])

  const companion = readCompanionSha(rootDir, id, phase)
  entry.rounds.push({
    n,
    at,
    file: roundFile,
    provider: bundle.provider ?? null,
    model: bundle.model ?? null,
    source: bundle.source ?? null,
    artifactSha256: artifactSha256(rootDir, id, phase),
    ...companion === undefined ? {} : { companionSha256: companion },
    decision: null,
    confirmedAt: null,
    bundled: true,
  })
  entry.current = n
  state.briefings = { ...(state.briefings ?? {}), [phase]: entry }
  state.consults[phase] = { at, provider: record.provider, model: record.model, question: record.question, file: consultFile, bundled: true }
  state.reviewBundles = {
    ...(state.reviewBundles ?? {}),
    [phase]: {
      at,
      artifactSha256: artifactSha256(rootDir, id, phase),
      ...companion === undefined ? {} : { companionSha256: companion },
      provider: record.provider,
      model: record.model,
      source: bundle.source ?? null,
    },
  }
  state.updatedAt = at
  // 一次 child 产出两段 ⇒ review 调用只记一次（这是省下来的那一次）。
  bump(state, 'reviewSpawns', 'briefings', 'consults')
  return writeState(rootDir, refreshBriefings(rootDir, state))
}

/** 伴随产物的 sha（没有伴随产物 ⇒ undefined）。 */
function readCompanionSha(rootDir, id, phase) {
  const companion = companionFileOf(phase)
  if (companion === null) return undefined
  try {
    return createHash('sha256').update(readFileSync(join(taskDir(rootDir, id), companion))).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * 这个阶段有没有**仍然 fresh** 的 bundle（同一份产物、含伴随文件）。
 *
 * fresh 的判据是 sha 而不是时间：产物一改（哪怕同长度），旧 bundle 里的 consult 就
 * 不再是对这一版稿子的意见，必须重跑 —— 否则用户拿到的是一份过期评审。
 */
export function freshReviewBundle(rootDir, state, phase) {
  const bundle = state.reviewBundles?.[phase]
  if (bundle === undefined) return null
  if (bundle.artifactSha256 !== artifactSha256(rootDir, state.id, phase)) return null
  const companion = readCompanionSha(rootDir, state.id, phase)
  if (companion !== undefined && bundle.companionSha256 !== companion) return null
  if (companion === undefined && bundle.companionSha256 !== undefined) return null
  return bundle
}

/**
 * What still blocks treating a phase's briefing as confirmed (acceptance A5's four
 * conditions). Empty list = the briefing is usable.
 *
 * Conditions are checked against disk, not memory: the round body is re-read and the
 * artifact hash recomputed, so out-of-band edits cannot smuggle a stale confirmation
 * past the gate.
 */
export function briefingGaps(rootDir, state, phase) {
  const entry = state.briefings?.[phase]
  const round = currentBriefingRound(state, phase)
  if (entry === undefined || round === null) return [`missing briefing for "${phase}" (generate one with smart_brief)`]
  const body = readBriefingRound(rootDir, state.id, phase, round.n)
  if (body === null || body.trim() === '') return [`briefing round ${round.n} of "${phase}" is empty on disk (${round.file})`]
  const sha = artifactSha256(rootDir, state.id, phase)
  if (round.artifactSha256 !== sha) return [`briefing round ${round.n} of "${phase}" is stale — ${ARTIFACT_FILE[phase]} changed after it was generated`]
  if (round.decision !== 'confirm') return [`briefing round ${round.n} of "${phase}" is not confirmed (answer smart_brief_confirm first)`]
  return []
}

/**
 * How many times this phase has already been redone — counted **per phase** off the
 * history (`to` is the phase we returned to).
 *
 * @param state - task state.
 * @param phase - design phase.
 * @returns the count.
 */
export function reworkUsedIn(state, phase) {
  return (state.history ?? []).filter(entry => entry.to === phase).length
}

/**
 * A phase's rework budget: `{ phase, used, cap, grants, maxRework }`.
 *
 * `cap` is `maxRework` per human grant: each time the user answers 「继续重做」 at a
 * gate that has run out, they buy another full budget (recorded in `reworkGrants`,
 * so the audit shows the loop was authorized, not self-extended).
 *
 * @param state - task state.
 * @param phase - design phase.
 * @param maxRework - the row config's per-phase allowance.
 * @returns the budget.
 */
export function reworkBudget(state, phase, maxRework = 5) {
  const grants = (state.reworkGrants ?? []).filter(entry => entry.phase === phase)
  return { phase, used: reworkUsedIn(state, phase), cap: maxRework * (1 + grants.length), grants: grants.length, maxRework }
}

/**
 * Record the user's authorization for another rework budget in `phase`.
 *
 * Only the gate calls this, and only on an explicit answer: a model that could grant
 * itself more budget would make the bound meaningless.
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - design phase the extra budget belongs to.
 * @param meta - `{ by?, note?, maxRework? }`.
 * @returns the updated state.
 */
export function grantRework(rootDir, id, phase, meta = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (!DESIGN_PHASES.includes(phase)) throw new Error(`smart: rework grants can only name a design phase (${DESIGN_PHASES.join(', ')})`)
  const at = new Date().toISOString()
  state.reworkGrants = [...(state.reworkGrants ?? []), {
    phase,
    at,
    by: meta.by ?? 'user',
    budget: meta.maxRework ?? 5,
    ...typeof meta.note === 'string' && meta.note !== '' ? { note: meta.note } : {},
  }]
  state.updatedAt = at
  return writeState(rootDir, state)
}

/**
 * Send the task back to an earlier design phase (gate "退回" / acceptance
 * failure, design §3 rework loop).
 *
 * The superseded artifacts are **moved to `history/`, never deleted**: the whole
 * point of a rework is that we can see what was rejected. Counting is **per phase**
 * and bounded by `maxRework`; the machine refuses to loop on its own, but running
 * out is **the user's call, not a forced finish** — at the gate they can pick
 * 「继续重做」 and `grantRework()` buys another budget (see `index.js`).
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param phase - design phase to return to.
 * @param reason - why (recorded).
 * @param options - `{ maxRework }` from row config.
 * @returns the updated state.
 */
export function reworkTo(rootDir, id, phase, reason = '', options = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (!DESIGN_PHASES.includes(phase)) throw new Error(`smart: rework can only return to a design phase (${DESIGN_PHASES.join(', ')})`)
  const budget = reworkBudget(state, phase, options.maxRework ?? 5)
  // 未按规定触发「额度耗尽 ⇒ 强制收尾」：额度不是墙，找谁开门要说清楚。
  if (budget.used >= budget.cap) {
    throw new Error(
      `smart: task "${id}" has used its ${budget.cap} rework(s) into "${phase}" — the machine will not loop on its own; `
      + `the user decides at the gate (option 「继续重做」 grants another ${budget.maxRework}), not the model`,
    )
  }
  state.settings = { ...(state.settings ?? {}), maxRework: budget.maxRework }
  const from = state.phase
  const index = DESIGN_PHASES.indexOf(phase)
  const dir = taskDir(rootDir, id)
  mkdirSync(join(dir, 'history'), { recursive: true })
  const at = new Date().toISOString()
  const stamp = at.replace(/[:.]/gu, '-')
  const archived = []
  for (const dropping of [...DESIGN_PHASES.slice(index), 'executing', 'reviewing']) {
    if (state.artifacts[dropping] === undefined) continue
    const file = ARTIFACT_FILE[dropping]
    renameSync(join(dir, file), join(dir, 'history', `${stamp}-${file}`))
    // 伴随产物跟着主产物一起进 history —— 留一份孤儿 acceptance.md 在盘上，下一次落盘
    // 会把它当成"已经是这一轮的产物"读进来。
    const companion = state.workflow === 'optimized'
      ? state.artifacts[dropping]?.companion ?? companionFileOf(dropping)
      : null
    if (typeof companion === 'string' && existsSync(join(dir, companion))) {
      renameSync(join(dir, companion), join(dir, 'history', `${stamp}-${companion}`))
    }
    archived.push(dropping)
    delete state.artifacts[dropping]
    if (state.consults[dropping] !== undefined) {
      renameSync(join(dir, 'consult', `${dropping}.json`), join(dir, 'history', `${stamp}-consult-${dropping}.json`))
      delete state.consults[dropping]
    }
  }
  state.phase = phase
  state.awaitingGate = null
  state.reworkCount += 1
  state.history.push({ at, from, to: phase, reason, archived })
  state.updatedAt = at
  return writeState(rootDir, state)
}

/**
 * Record one verification run's evidence (design §5, `smart_verify`).
 *
 * The evidence is a file, not a promise: the workbench and the review both read
 * it from disk, and the route that produced it is stored beside it so a drifted
 * reviewer is visible rather than trusted.
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param evidence - `{ provider, model, body, acceptance }`.
 * @returns the updated state.
 */
export function recordVerification(rootDir, id, evidence = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (state.phase !== 'reviewing') throw new Error(`smart: verification belongs to the review phase; task "${id}" is in "${state.phase}"`)
  if (typeof evidence.body !== 'string' || evidence.body.trim().length === 0) throw new Error('smart: a verification run needs its evidence text')
  const dir = taskDir(rootDir, id)
  mkdirSync(join(dir, 'verify'), { recursive: true })
  const at = new Date().toISOString()
  const file = `verify/${at.replace(/[:.]/gu, '-')}.md`
  writeAtomic(join(dir, file), `${evidence.body.endsWith('\n') ? evidence.body : `${evidence.body}\n`}`)
  state.verifications ??= []
  state.verifications.push({ at, file, provider: evidence.provider ?? null, model: evidence.model ?? null, acceptance: evidence.acceptance ?? null })
  state.updatedAt = at
  bump(state, 'verifications', 'reviewSpawns')
  return writeState(rootDir, state)
}

/** Every verification record, oldest first. */
export function listVerifications(state) {
  return state.verifications ?? []
}

/**
 * Archive a finished task (design §5, `smart_finish`).
 *
 * Only a task whose final gate passed can be archived — the machine will not let
 * a summary paper over an open gate.
 *
 * The task belongs to a **workspace** now, so archiving has two halves: the hidden
 * tree keeps working state, and the workspace gets the delivery copy under
 * `docs/smart/<taskId>/`. The summary is written to the hidden tree **first**, so a
 * promotion that fails (read-only volume, cross-device rename, EACCES) leaves a
 * retryable task rather than a lost one — and it is explicitly **not** marked
 * archived in that case.
 *
 * @param rootDir - smart root.
 * @param id - task id.
 * @param summary - closing summary markdown.
 * @param options - `{ workspace, workspaceSource }`: the calling session's workspace
 *   (`args.workspace` → `state.workspace` → the session's `header.cwd`, resolved by
 *   the caller, which is the only place that has the session).
 * @returns the updated state.
 */
export function finishTask(rootDir, id, summary = '', options = {}) {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  if (state.phase !== 'done') throw new Error(`smart: task "${id}" is in phase "${state.phase}"; only a task past gate G5 can be archived`)
  if (state.archivedAt !== undefined) throw new Error(`smart: task "${id}" is already archived (${state.archivedAt})`)
  if (typeof summary !== 'string' || summary.trim().length === 0) throw new Error('smart: smart_finish needs a closing summary')
  const workspace = typeof options.workspace === 'string' && options.workspace.trim() !== ''
    ? resolve(options.workspace.trim())
    : typeof state.workspace === 'string' && state.workspace.trim() !== '' ? resolve(state.workspace.trim()) : null
  if (workspace === null) {
    throw new Error(`smart: 无法归档："${id}" 不知道自己属于哪个工作区（state.workspace 缺失），调用会话也没有 header.cwd。归档要把交付副本写进 <工作区>/docs/smart/，所以必须有工作区 —— 请在有工作目录的会话里 finish，或显式传 workspace。（禁 process.cwd() 兜底：宿主 cwd 不是用户工作区）`)
  }
  const dir = taskDir(rootDir, id)
  const at = new Date().toISOString()
  writeAtomic(join(dir, 'summary.md'), summary.endsWith('\n') ? summary : `${summary}\n`)
  state.archivedAt = at
  state.summary = { file: 'summary.md', at }
  state.workspace = workspace
  state.workspaceSource = options.workspaceSource ?? state.workspaceSource ?? 'session.header.cwd'
  state.updatedAt = at
  // 提升失败会抛出，且 archivedAt 只在提升成功后才落盘（state 在下面写）。
  const promotion = promoteDeliverables({ taskDir: dir, workspace, state })
  state.delivery = { dir: join(DELIVERY_DIR, id), files: promotion.files, at }
  const written = writeState(rootDir, state)
  return Object.assign(written, { _promotion: { target: promotion.target, files: promotion.files, written: promotion.written } })
}

/** Where a workspace's promoted deliverables live. */
export const DELIVERY_DIR = join('docs', 'smart')

/**
 * The files that become the workspace's delivery copy — and nothing else.
 *
 * Deliberately **not** the whole task directory: `consult/` holds the hand model's
 * review transcripts and `verify/` the raw evidence, and `history/` the superseded
 * drafts. Those stay in the hidden tree; a delivery copy that shipped every draft
 * and every reviewer's prose would be a pile, not a deliverable
 * (`acceptance.md` Y6/B6). `docs/smart/` is the reviewed result.
 */
export const DELIVERABLE_FILES = ['brainstorm.md', 'design.md', 'plan.md', 'acceptance.md', 'execution-report.md', 'review.md', 'summary.md']

/** The hidden manifest that marks a promotion this machine performed. */
export const PROMOTION_MANIFEST = '.dsh-fly-promotion.json'

/**
 * The README written beside the promoted artifacts.
 *
 * Relative paths only: an absolute `/Users/...` in a delivered document names the
 * machine that produced it and breaks the moment the repo is cloned elsewhere.
 *
 * @param state - task state.
 * @param files - promoted file names.
 * @returns markdown.
 */
function deliveryReadme(state, files) {
  return [
    `# smart 任务交付副本：${state.title}`,
    '',
    `- 任务 id：\`${state.id}\``,
    `- 目标：${state.goal === '' ? '（未填写）' : state.goal}`,
    `- 归档时间：${state.archivedAt ?? new Date().toISOString()}`,
    '',
    '## 产物',
    '',
    ...files.map(file => `- [\`${file}\`](./${file})`),
    '',
    '## 这是只读交付副本',
    '',
    '`docs/smart/` 是给仓库和评审者看的**交付副本**，不是工作态。修改请改隐藏任务树',
    '（`.dsh-fly/smart/tasks/<taskId>/`），然后重新 `smart_finish` 覆盖这里 —— 直接改这里',
    '不会回流，下一次归档会把你的改动盖掉。',
    '',
    '手模型评审原文与原始取证留在隐藏树（`consult/`、`verify/`），不进交付面。',
    '',
  ].join('\n')
}

/**
 * Promote a finished task's deliverables into the calling session's workspace.
 *
 * Semantics that matter (`acceptance.md` Y5/Y6/M9/M10):
 *
 *   - **Individually atomic, collectively all-or-nothing-ish**: every file is
 *     written to a staging directory first, and the whole promotion is a single
 *     directory rename when the target does not exist yet. On a retry (target
 *     exists) each file is moved in one at a time, which is why a failure reports
 *     the paths it did write instead of pretending nothing happened.
 *   - **A retry may clean up its own half-finished promotion**, and only its own:
 *     the manifest lists the task and the files this machine wrote. A file that is
 *     not ours is a user's file and refuses the promotion.
 *   - **Failure never marks the task archived.** Cross-volume, read-only and
 *     EACCES are explicit errors the caller can retry after fixing the volume.
 *
 * @param input - `{ taskDir, workspace, state }`.
 * @returns `{ target, manifest, files, written }` (paths relative to the workspace).
 * @throws {Error} with `.written` set to the relative paths already promoted.
 */
export function promoteDeliverables({ taskDir, workspace, state }) {
  const target = join(resolve(workspace), DELIVERY_DIR, state.id)
  const present = DELIVERABLE_FILES.filter(file => existsSync(join(taskDir, file)))
  if (present.length === 0) throw new Error(`smart: task "${state.id}" has no artifacts to promote (looked in ${taskDir})`)
  const files = [...present, 'README.md']

  try {
    mkdirSync(target, { recursive: true })
  } catch (error) {
    throw promoteError(target, [], `cannot create ${target}: ${error.message}`)
  }

  const previous = readManifest(target)
  const foreign = files.filter(file => existsSync(join(target, file)) && !(previous?.taskId === state.id && previous.files.includes(file)))
  if (foreign.length > 0) {
    throw promoteError(target, [], `交付副本已存在，且不是本任务上一次提升写下的（拒绝覆盖用户文件）：${foreign.map(file => `${DELIVERY_DIR}/${state.id}/${file}`).join(', ')}`)
  }

  const bodies = new Map()
  for (const file of present) bodies.set(file, readFileSync(join(taskDir, file)))
  bodies.set('README.md', Buffer.from(deliveryReadme(state, files), 'utf8'))

  const written = []
  for (const file of files) {
    const destination = join(target, file)
    try {
      writeAtomic(destination, bodies.get(file), 0o644)
      written.push(`${DELIVERY_DIR}/${state.id}/${file}`)
    } catch (error) {
      throw promoteError(target, written, `promotion failed at ${destination}: ${error.message}`)
    }
  }
  const manifest = {
    taskId: state.id,
    title: state.title,
    promotedAt: new Date().toISOString(),
    files,
    shasums: Object.fromEntries([...bodies].map(([file, body]) => [file, createHash('sha256').update(body).digest('hex')])),
  }
  try {
    writeAtomic(join(target, PROMOTION_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 0o644)
  } catch (error) {
    throw promoteError(target, written, `promotion manifest failed: ${error.message}`)
  }
  return { target, manifest, files, written }
}

/** Read a promotion manifest, or null. */
export function readManifest(target) {
  try {
    const parsed = JSON.parse(readFileSync(join(target, PROMOTION_MANIFEST), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && typeof parsed.taskId === 'string' && Array.isArray(parsed.files) ? parsed : null
  } catch {
    return null
  }
}

/** One promotion failure, carrying what was already written. */
function promoteError(target, written, message) {
  const error = new Error(`smart: 归档提升失败（任务保持未归档，修好后可重试）：${message}${written.length === 0 ? '' : `\n已写入：${written.join(', ')}`}\n目标目录：${target}`)
  error.written = written
  error.target = target
  return error
}
/** Stop a task without finishing it. */
export function cancelTask(rootDir, id, reason = '') {
  const state = readState(rootDir, id)
  if (state === null) throw new Error(`smart: no such task "${id}"`)
  const at = new Date().toISOString()
  state.phase = 'cancelled'
  state.awaitingGate = null
  state.cancelled = { at, reason }
  state.updatedAt = at
  return writeState(rootDir, state)
}

/** The phase a gate belongs to (`G1` → `brainstorm`), or undefined. */
export function gateOwner(gate) {
  return Object.keys(GATE_AFTER).find(phase => GATE_AFTER[phase] === gate)
}

/** Remove a task directory entirely (used by tests and `smart_abort`). */
export function removeTask(rootDir, id) {
  rmSync(taskDir(rootDir, id), { recursive: true, force: true })
  const remaining = { tasks: listTasks(rootDir).filter(row => row.id !== id) }
  const file = join(resolve(rootDir), 'index.json')
  try {
    writeAtomic(file, `${JSON.stringify(remaining, null, 2)}\n`)
  } catch {
    /* index is a cache; a missing root is fine here */
  }
  return remaining.tasks
}

/** Artifact body, or null. */
export function readArtifact(rootDir, id, phase) {
  const file = ARTIFACT_FILE[phase]
  if (file === undefined) throw new Error(`smart: "${phase}" is not an artifact phase`)
  try {
    return readFileSync(join(taskDir(rootDir, id), file), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** Task ids present on disk (for the workbench in S4). */
export function taskIds(rootDir) {
  try {
    return readdirSync(tasksRoot(rootDir), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}
