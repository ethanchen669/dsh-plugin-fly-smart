/**
 * DSH Fly smart workbench — the on-disk reader for `~/.dsh-fly/smart/`.
 *
 * The smart **agent plane** (`dsh-plugin-fly-smart`) owns the state machine and
 * writes the task tree; this module only ever reads it back, and it does so with
 * `node:fs` alone so the page keeps working in a composition where the tools row
 * is not mounted. The two halves of smart mode therefore meet on disk, not in a
 * service graph — which is exactly why the page can be a separate package.
 *
 * Layout this file pins (kept in step with `dsh-plugin-fly-smart/lib/state.mjs`):
 *
 *   <root>/index.json                    { tasks: [{ id, title, phase, awaitingGate, updatedAt }] }
 *   <root>/tasks/<id>/state.json         phase machine, gates[], consults{}, verifications[], history[]
 *   <root>/tasks/<id>/{brainstorm,design,plan,acceptance}.md
 *   <root>/tasks/<id>/{execution-report,review,summary}.md
 *   <root>/tasks/<id>/consult/<phase>.json
 *   <root>/tasks/<id>/verify/<ts>.md
 *   <root>/tasks/<id>/history/<ts>-<file>.md
 *
 * Two rules shape every function here:
 *
 *   1. **A missing file is a fact, not an error.** A task mid-flight has no
 *      `review.md` yet, and the page must say "not yet" instead of blanking. Only
 *      a missing *root* is a capability error, and the route layer turns that into
 *      a 503 (never an empty 200).
 *   2. **Nothing read off disk may become a path.** `state.json` carries file
 *      names, and a task id is attacker-shaped input on a local HTTP surface, so
 *      every id is matched against {@link ID_PATTERN} and every stored file name is
 *      re-derived from the phase instead of trusted.
 *
 * @module dsh-plugin-fly-smart-panel/reader
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Artifact phase → file name (six artifacts; `summary.md` is separate). */
export const ARTIFACT_FILE = {
  brainstorm: 'brainstorm.md',
  design: 'design.md',
  plan: 'plan.md',
  acceptance: 'acceptance.md',
  executing: 'execution-report.md',
  reviewing: 'review.md',
}

/** The artifact phases in board order; what the viewer offers as tabs. */
export const ARTIFACT_PHASES = Object.keys(ARTIFACT_FILE)

/** The four design phases, each closed by a small user gate. */
export const DESIGN_PHASES = ['brainstorm', 'design', 'plan', 'acceptance']

/** Gate that closes each phase's step (G5 closes the review). */
export const GATE_AFTER = {
  brainstorm: 'G1',
  design: 'G2',
  plan: 'G3',
  acceptance: 'G4',
  reviewing: 'G5',
}

/** The board, in order: what the page draws and where the task stands. */
export const BOARD_PHASES = [
  { id: 'brainstorm', label: '脑暴', gate: 'G1' },
  { id: 'design', label: '设计', gate: 'G2' },
  { id: 'plan', label: '计划', gate: 'G3' },
  { id: 'acceptance', label: '验收设计', gate: 'G4' },
  { id: 'executing', label: '执行', gate: null },
  { id: 'reviewing', label: '验收', gate: 'G5' },
  { id: 'done', label: '完成', gate: null },
]

/**
 * optimized 任务的阶段板：验收设计与计划是**一对**（两文件一次写入、一道门），
 * 所以没有独立的「验收设计」阶段，也没有 G4。板格仍保留那一位（产物要能看到），
 * 但把它的门与状态交给 pair 表达 —— 否则面板会对一个永远不会发生的 G4 等下去。
 */
const OPTIMIZED_BOARD = BOARD_PHASES.map(entry => entry.id !== 'acceptance'
  ? entry
  : { id: entry.id, label: '验收设计（并入计划）', gate: null, mergedInto: 'plan' })

/**
 * 这个任务该画哪一套板。未知/缺省 ⇒ v1 的四阶段板（旧任务不受影响）。
 * @param workflow - `state.workflow`（可能为 undefined）。
 */
export function boardFor(workflow) {
  return workflow === 'optimized' ? OPTIMIZED_BOARD : BOARD_PHASES
}

/**
 * A task id as the state machine generates it (`<timestamp>-<slug>`). Also the
 * only shape allowed into a path: no `/`, and `..` is refused separately because
 * the pattern itself would let it through.
 */
export const ID_PATTERN = /^[A-Za-z0-9._-]+$/u

/** The route line `smart_execute` writes at the top of `execution-report.md`. */
export const EXECUTION_ROUTE_PATTERN = /^>\s*执行模型[：:]\s*([^\s/]+)\s*\/\s*(\S+)\s*$/mu

/** Max id length; the state machine's ids are far shorter. */
const ID_MAX = 128

/**
 * Is this string usable as a task id — safe to join into `<root>/tasks`?
 * @param id - the raw query value.
 * @returns true only for the state machine's own id shape.
 */
export function isSafeTaskId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX && ID_PATTERN.test(id) && !id.includes('..')
}

/** Parse JSON, treating unreadable/partial files as absent. */
function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Read a UTF-8 text file, or null when it does not exist. */
function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** `mtime` as ISO text — the only timestamp a bare evidence file has. */
function mtimeIso(path) {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return null
  }
}

/** Size in bytes, or null when the file vanished between listing and stat. */
function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

/** File names inside a task sub-directory, sorted, `[]` when the directory is absent. */
function listFiles(directory, suffix) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** The task ids present under `<root>/tasks`, sorted. */
function listTaskIds(rootDir) {
  try {
    return readdirSync(join(rootDir, 'tasks'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isSafeTaskId(entry.name))
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Decisions recorded across all phases of a raw `state.json` (the fallback path counts here). */
function countDecided(decisions) {
  let total = 0
  for (const rounds of Object.values(decisions ?? {})) {
    for (const round of Array.isArray(rounds) ? rounds : []) total += Array.isArray(round?.entries) ? round.entries.length : 0
  }
  return total
}

/** One index row, from whatever the index (or `state.json`) carries. */
function taskRow(source) {
  return {
    id: source.id,
    title: typeof source.title === 'string' ? source.title : '',
    phase: typeof source.phase === 'string' ? source.phase : 'unknown',
    awaitingGate: source.awaitingGate ?? null,
    // 裁决两行两种来源都得对：索引行由 state.mjs 写（decided 是数字），回退路径拿到的是
    // 整个 state.json（只有 decisions 明细，条数在这里数）。
    pendingDecisions: source.pendingDecisions ?? null,
    decided: typeof source.decided === 'number' ? source.decided : countDecided(source.decisions),
    // 模型自主裁决（Ruling:）条数：与「待裁决」是两件事 —— 一个是等用户答，一个是
    // 模型替用户定过。索引行给数字，完整条目在任务详情里（`rulings`）。
    rulings: typeof source.rulings === 'number' ? source.rulings : Array.isArray(source.rulings) ? source.rulings.length : 0,
    // 本阶段返工额度（index.json 由 lib/state.mjs 的 updateIndex 写好）：额度用尽的任务
    // 在下拉里就能认出来，不必逐个点开。
    //
    // 缺字段给 `null`（"不知道"），**不给 0**：老索引行（以及任何不是 state.mjs 写出来的行）
    // 本来就没有这三个字段，补成 0 会让 `used >= cap` 退化成 `0 >= 0` ⇒ 在**已完成的旧任务**
    // 上画一个假的「额度用尽」（2026-10-02 实测：从全局老根搬过来的那个任务就带着它）。
    // 缺失 ≠ 假值：消费端要么两个都是数字，要么当不知道。
    reworkUsed: typeof source.reworkUsed === 'number' ? source.reworkUsed : null,
    reworkCap: typeof source.reworkCap === 'number' ? source.reworkCap : null,
    reworkGrants: typeof source.reworkGrants === 'number' ? source.reworkGrants : null,
    // briefing 格（state.mjs updateIndex 写好）：缺失给 null（不知道），不补假值。
    briefing: source.briefing !== null && typeof source.briefing === 'object' ? source.briefing : null,
    updatedAt: source.updatedAt ?? null,
    archived: source.archivedAt !== undefined && source.archivedAt !== null,
  }
}

/**
 * The task index, newest first.
 *
 * `index.json` is the fast path. When it is missing or unreadable the reader
 * falls back to scanning `tasks/*​/state.json`, because a board that goes blank
 * while tasks sit on disk is worse than a slightly slower read; `source` says
 * which path was taken so the page can report it.
 *
 * @param rootDir - the absolute smart root.
 * @returns `{ source, tasks, indexFile }`.
 */
export function readIndex(rootDir) {
  const indexFile = join(rootDir, 'index.json')
  const raw = readJson(indexFile)
  const entries = Array.isArray(raw?.tasks) ? raw.tasks.filter(entry => isSafeTaskId(entry?.id)) : null

  const tasks = entries === null
    ? listTaskIds(rootDir)
      .map(id => readJson(join(rootDir, 'tasks', id, 'state.json')))
      .filter(state => state !== null && isSafeTaskId(state.id))
      .map(taskRow)
    : entries.map(taskRow)

  tasks.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
  return { source: entries === null ? 'tasks/*/state.json' : 'index.json', indexFile, tasks }
}

/**
 * Consult records for one task, in design order.
 *
 * The state machine writes both `state.consults[phase]` (metadata) and
 * `consult/<phase>.json` (the review body). This merges them, and re-derives the
 * file path from the phase rather than trusting the stored name.
 * @param dir - the task directory.
 * @param state - the parsed `state.json`.
 */
export function readConsults(dir, state) {
  const stored = state.consults !== null && typeof state.consults === 'object' ? state.consults : {}
  const phases = []
  for (const phase of [...DESIGN_PHASES, ...Object.keys(stored)]) {
    // A phase name becomes a file name below, so only the known shape is allowed.
    if (isSafeTaskId(phase) && !phases.includes(phase)) phases.push(phase)
  }
  phases.sort((left, right) => {
    const [a, b] = [DESIGN_PHASES.indexOf(left), DESIGN_PHASES.indexOf(right)]
    return (a === -1 ? 99 : a) - (b === -1 ? 99 : b)
  })

  return phases.flatMap(phase => {
    const meta = stored[phase] !== null && typeof stored[phase] === 'object' ? stored[phase] : {}
    const record = readJson(join(dir, 'consult', `${phase}.json`))
    if (record === null && Object.keys(meta).length === 0) return []
    return [{
      phase,
      at: record?.at ?? meta.at ?? null,
      provider: record?.provider ?? meta.provider ?? null,
      model: record?.model ?? meta.model ?? null,
      question: typeof (record?.question ?? meta.question) === 'string' ? (record.question ?? meta.question) : '',
      file: `consult/${phase}.json`,
      body: typeof record?.body === 'string' ? record.body : null,
    }]
  })
}

/**
 * Verification evidence for one task, oldest first.
 *
 * The evidence files under `verify/` are the truth (they are the artifact a human
 * opens); the `state.verifications[]` entries only annotate them with the route
 * that produced them. A record whose file is gone is kept and flagged, because a
 * missing piece of evidence is itself a finding.
 * @param dir - the task directory.
 * @param state - the parsed `state.json`.
 */
export function readVerifications(dir, state) {
  const stored = Array.isArray(state.verifications) ? state.verifications : []
  const rows = listFiles(join(dir, 'verify'), '.md').map(name => {
    const file = `verify/${name}`
    const meta = stored.find(entry => typeof entry?.file === 'string' && (entry.file === file || entry.file.endsWith(`/${name}`))) ?? {}
    return {
      at: meta.at ?? mtimeIso(join(dir, 'verify', name)),
      file,
      provider: meta.provider ?? null,
      model: meta.model ?? null,
      acceptance: meta.acceptance ?? null,
      bytes: sizeOf(join(dir, 'verify', name)),
      missing: false,
    }
  })
  for (const entry of stored) {
    const name = typeof entry?.file === 'string' ? entry.file.split('/').at(-1) : null
    if (name === null || rows.some(row => row.file.endsWith(`/${name}`))) continue
    rows.push({ at: entry.at ?? null, file: entry.file, provider: entry.provider ?? null, model: entry.model ?? null, acceptance: entry.acceptance ?? null, bytes: null, missing: true })
  }
  rows.sort((left, right) => String(left.at ?? '').localeCompare(String(right.at ?? '')))
  return rows
}

/** Archived (superseded) artifacts moved aside by `smart_rework`, oldest first. */
export function readHistory(dir) {
  return listFiles(join(dir, 'history'), '.md')
    .map(name => ({ file: `history/${name}`, bytes: sizeOf(join(dir, 'history', name)), at: mtimeIso(join(dir, 'history', name)) }))
    .sort((left, right) => String(left.at ?? '').localeCompare(String(right.at ?? '')))
}

/**
 * The route line `smart_execute` writes into `execution-report.md`.
 * @param markdown - the report text, or undefined while the task has not executed.
 * @returns `{ provider, model, line }` or null.
 */
export function parseExecutionRoute(markdown) {
  if (typeof markdown !== 'string') return null
  const match = EXECUTION_ROUTE_PATTERN.exec(markdown)
  return match === null ? null : { provider: match[1], model: match[2], line: match[0].trim() }
}

/**
 * Compare the executed route with the hand routes that reviewed the design.
 *
 * This is the one cross-plane fact the page can prove on its own: the tools record
 * the hand route on every consult (`consult/<phase>.json`) and the executed route
 * in the report header, and a mismatch means the plan was approved by one model
 * and run by another. `drifted` is false while either side is unknown — "no
 * execution yet" is not drift, and a page that cries wolf stops being read.
 *
 * @param artifacts - `readTask`'s artifact map.
 * @param consults - `readTask`'s consult records.
 * @returns `{ hand, execution, executed, drifted }`.
 */
export function routeReport(artifacts, consults) {
  const hand = []
  for (const record of consults) {
    if (typeof record.provider !== 'string' || record.provider === '') continue
    if (typeof record.model !== 'string' || record.model === '') continue
    const route = `${record.provider}/${record.model}`
    if (!hand.includes(route)) hand.push(route)
  }
  const execution = parseExecutionRoute(artifacts.executing?.markdown)
  const executed = execution === null ? null : `${execution.provider}/${execution.model}`
  return { hand, execution, executed, drifted: executed !== null && hand.length > 0 && !hand.includes(executed) }
}

/**
 * Everything the page shows for one task.
 * @param rootDir - the absolute smart root.
 * @param id - the task id (validated here as well as at the route).
 * @returns the task view, or null when there is no such task.
 */
/**
 * Per-phase briefing status, derived the way `state.mjs` derives it (acceptance
 * A10's total ordering). The reader is read-only and shares no code with the
 * agent-plane package — the two halves meet on disk, so this re-derives instead
 * of trusting a remembered `status`: stale means "the artifact on disk moved".
 *
 * @param dir - the task directory.
 * @param state - the parsed `state.json`.
 * @returns `{ [phase]: { rounds, current, status, at, route, source } }`.
 */
export function briefingReport(dir, state) {
  const stored = state.briefings !== null && typeof state.briefings === 'object' ? state.briefings : {}
  const report = {}
  for (const phase of ARTIFACT_PHASES) {
    const entry = stored[phase] !== null && typeof stored[phase] === 'object' ? stored[phase] : null
    const rounds = Array.isArray(entry?.rounds) ? entry.rounds : []
    const round = rounds.find(item => item?.n === (entry?.current ?? 0)) ?? null
    const sha = sha256Of(join(dir, ARTIFACT_FILE[phase]))
    const latest = rounds.at(-1)?.at ?? null
    let status
    if (typeof entry?.failedAt === 'string' && (latest === null || entry.failedAt > latest)) status = 'failed'
    else if (round === null) status = 'none'
    else if (round.artifactSha256 !== sha) status = 'stale'
    else if (round.decision === 'confirm') status = 'confirmed'
    else if (round.decision === 'revise') status = 'revise'
    else status = 'awaiting-user'
    report[phase] = {
      rounds: rounds.length,
      current: entry?.current ?? 0,
      status,
      at: round?.at ?? entry?.failedAt ?? null,
      route: round === null || (round.provider == null && round.model == null) ? null : `${round.provider ?? '?'}/${round.model ?? '?'}`,
      source: round?.source ?? null,
      lastError: typeof entry?.lastError === 'string' ? entry.lastError : null,
    }
  }
  return report
}

/** sha256 of a file's bytes (hex), or null when missing — same rule as state.mjs. */
function sha256Of(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

export function readTask(rootDir, id) {
  if (!isSafeTaskId(id)) return null
  const dir = join(rootDir, 'tasks', id)
  if (!existsSync(join(dir, 'state.json'))) return null
  const state = readJson(join(dir, 'state.json'))
  if (state === null) return null

  const artifacts = {}
  for (const phase of ARTIFACT_PHASES) {
    const markdown = readText(join(dir, ARTIFACT_FILE[phase]))
    if (markdown !== null) {
      artifacts[phase] = {
        phase,
        file: ARTIFACT_FILE[phase],
        bytes: sizeOf(join(dir, ARTIFACT_FILE[phase])),
        markdown,
      }
    }
  }

  const consults = readConsults(dir, state)
  const summary = readText(join(dir, 'summary.md'))
  return {
    id,
    taskDir: dir,
    state,
    // 面板不必自己猜工作流：reader 把"该画哪套板"一并发过来。
    workflow: state.workflow ?? 'v1',
    board: boardFor(state.workflow),
    artifacts,
    briefings: briefingReport(dir, state),
    consults,
    verifications: readVerifications(dir, state),
    // 模型自主裁决（Ruling:）：完整条目随任务详情下发 —— 这是「替用户定过的事」，
    // 用户只有在这里（和收尾总结里）才看得全。
    rulings: Array.isArray(state.rulings) ? state.rulings : [],
    gates: Array.isArray(state.gates) ? state.gates : [],
    history: readHistory(dir),
    summary: summary === null ? null : { file: 'summary.md', bytes: sizeOf(join(dir, 'summary.md')), markdown: summary },
    routes: routeReport(artifacts, consults),
  }
}
