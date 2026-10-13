/**
 * DSH Fly smart workbench, browser half — the `fly.smart` right-drawer page.
 *
 * The page is a **view over the task tree on disk**, reached through this
 * package's own host row (`/fly/smart/tasks`, `/fly/smart/task?id=`). It holds no
 * state of its own and never talks to the agent-plane tools package: every fact it
 * draws — phase, open gate, artifacts, gate records, hand-model reviews, evidence,
 * rework history — is read from `~/.dsh-fly/smart/` by `reader.js`, which is what
 * makes the two planes provably consistent instead of merely similar.
 *
 * It has exactly **one write surface**: the 双模型路由 card, which POSTs the hand
 * route to `/fly/smart/routes` (the mirror the agent-plane tools read lazily, per
 * call). `brain` is displayed read-only — the mirror's legacy `brain` key has no
 * consumer — and the card says so, together with whether the value it just saved
 * can actually reach a tool call (a non-empty preset row wins over the page).
 *
 * The one judgement the page makes for itself is the **route warning**: the tools
 * stamp `> 执行模型：<provider>/<model>` into `execution-report.md` and record the
 * hand route on every `consult/<phase>.json`, so a mismatch means the plan was
 * reviewed by one model and executed by another. The host compares them
 * (`routes.drifted`); this page only has to say so in red.
 *
 * Presentation reuses the Fly surface (`fly-panel`, `fly-card`, `fly-chip`,
 * `fly-tag`, `fly-kv`, `fly-table`, `fly-note-error`, `fly-empty`) injected by
 * `dsh-plugin-fly-shell`, and adds **no stylesheet of its own** — the acceptance
 * test asserts the product ships exactly one Fly stylesheet. The artifact viewer
 * needs three layout rules the skin does not carry (scroll box, wrapping, mono
 * font) and gets them as inline styles, still painted with the skin's own tokens.
 *
 * JSX is used here (and `react/jsx-runtime` required from the platform table):
 * the shell seeds it, and a board of conditional cells is where `createElement`
 * stops paying for itself.
 *
 * @module dsh-plugin-fly-smart-panel/client
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { WORKBENCH_CSS } from './workbench-css'

/** Cordis row name; matches the host half. */
export const name = 'fly-smart-panel'

/** The slot registry plus the right drawer's type registry: the data arrives over HTTP. */
export const inject = ['slots', 'sidebarRightTabs']

/** What `openTab` names, and what the guide entry hands back to the drawer. */
const KIND = 'fly.smart'

/** The chip's text. Static, so no `sidebar.right.pane.tab.title` seat is registered. */
const TAB_TITLE = 'Smart 工作流'

/** One line under the guide capsule, shown while the guide stays uncrowded. */
const TAB_DESCRIPTION = 'smart 任务的阶段板、产物、门记录与路由告警'

/** Ascending place among every registered type's guide entries: after the four workbenches. */
const GUIDE_ORDER = 40

/** npm package name: the guide id and the panel's `data-plugin` stamp. */
const PACKAGE = 'dsh-plugin-fly-smart-panel'

/** This row's own host namespace. */
const BASE = '/fly/smart'

/** The board, in phase order — the same list `reader.js` pins. */
const BOARD = [
  { id: 'brainstorm', label: '脑暴', gate: 'G1' },
  { id: 'design', label: '设计', gate: 'G2' },
  { id: 'plan', label: '计划', gate: 'G3' },
  { id: 'acceptance', label: '验收设计', gate: 'G4' },
  { id: 'executing', label: '执行', gate: null },
  { id: 'reviewing', label: '验收', gate: 'G5' },
  { id: 'done', label: '完成', gate: null },
] as const

/** Artifact tab labels, by phase. */
const ARTIFACT_LABEL: Record<string, string> = {
  brainstorm: '脑暴',
  design: '设计',
  plan: '计划',
  acceptance: '验收设计',
  executing: '执行报告',
  // 设计文档把这一阶段的产物名叫「验收」（review.md = 逐条验收结论），阶段板也这么叫；
  // 标签曾是「评审」——那是**手模型逐阶段评审**的说法（同一页 `<dt>评审</dt>` 用对了）。
  reviewing: '验收',
  summary: '收尾总结',
}

/** Phase status vocabulary, as the design doc names it. */
const STATUS_LABEL: Record<PhaseStatus, string> = {
  todo: '待做',
  active: '进行中',
  passed: '已过门',
  archived: '已归档',
}

/**
 * Phase id → the board's own Chinese label, so the task picker and the board say
 * the same word for the same phase. The picker used to print the raw id, and the
 * one place a user reads "done" while the board three lines below reads "完成" is
 * exactly the place they ask what went wrong. Unknown ids fall through to the id
 * itself rather than to an empty chip.
 */
const PHASE_LABEL: Record<string, string> = Object.fromEntries(BOARD.map(entry => [entry.id, entry.label]))

/**
 * The phase board stamps the state machine's own word on both the gate chip and
 * the status tag (`data-phase-status`), instead of mapping it onto a severity
 * word as it used to. The four states have their own colours in the skin now
 * (待做 idle grey / 进行中 pending cyan / 已过门 done green + glow / 已归档
 * receded idle), and a severity vocabulary could only approximate three of them.
 */

/** The artifact viewer's box: the three rules the skin does not own. */
const PRE_STYLE = {
  margin: '0',
  maxHeight: '340px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'var(--fly-mono, ui-monospace, SFMono-Regular, monospace)',
  fontSize: '12px',
  lineHeight: 1.6,
} as const

type PhaseStatus = 'todo' | 'active' | 'passed' | 'archived'

/** 产物里还没收的裁决（`state.pendingDecisions`）：门在它消失之前不会开。 */
interface PendingDecisions {
  headings: string[]
  items: number
}

interface TaskRow {
  id: string
  title: string
  phase: string
  awaitingGate: string | null
  pendingDecisions?: PendingDecisions | null
  /**
   * 用户已裁决条数（索引行带计数，回退路径由 reader 数）。
   *
   * 与 `awaitingGate` 互斥：欠着裁决时那道门是**历史痕迹**（在途任务）或压根没开（新任务），
   * 列表里只写「待裁决 n」—— 并列显示会变成"门开着、可你答不了"的自相矛盾。
   */
  decided?: number
  /**
   * 本阶段返工额度（已用/上限/人加额次数），由 index.json 速路径带过来。
   *
   * `null` = 这一行**没带**这三个字段（老索引行），是"不知道"，不是 0 —— 见
   * `reworkExhausted()`。
   */
  reworkUsed: number | null
  reworkCap: number | null
  reworkGrants: number | null
  updatedAt: string | null
  archived: boolean
}

/**
 * 这条任务的返工额度**确实**用尽了吗？
 *
 * 只有"已用"与"上限"都是数字、且上限 > 0 时才敢下结论。老索引行不带这三个字段（搬过来的
 * 老任务、任何不是 state.mjs 写出来的行），把缺失读成 0 会得到 `0 >= 0` ⇒ 在已完成的老任务
 * 上画一个假的「额度用尽」（2026-10-02 用户截图里就有一个）。缺失 ≠ 假值。
 */
/** briefing 状态 → 面板文字（与 state.mjs 的派生序对应；none 给「未生成」）。 */
const BRIEFING_LABEL: Record<string, string> = {
  none: '未生成',
  'awaiting-user': '待确认',
  confirmed: '已确认',
  stale: '已过期',
  failed: '生成失败',
  revise: '需修改',
}

/** 当前阶段的 briefing 状态；没有 briefing 面（老任务）报 none。 */
function briefingStatus(task: TaskPayload): string {
  const report = (task as { briefings?: Record<string, { status?: string }> }).briefings
  return report?.[task.state.phase]?.status ?? 'none'
}

/** 当前阶段 briefing 的来源路由（页面只显示，不复制正文）。 */
function briefingRoute(task: TaskPayload): string | null {
  const report = (task as { briefings?: Record<string, { route?: string | null }> }).briefings
  return report?.[task.state.phase]?.route ?? null
}

function reworkExhausted(entry: Pick<TaskRow, 'reworkUsed' | 'reworkCap'>): boolean {
  return typeof entry.reworkUsed === 'number' && typeof entry.reworkCap === 'number'
    && entry.reworkCap > 0 && entry.reworkUsed >= entry.reworkCap
}

interface TasksPayload {
  root: string
  source?: string
  tasks: TaskRow[]
  /** Tasks in the legacy compatibility root that the workspace listing merged in. */
  legacyCount?: number
  legacyRoot?: string
  /** No workspace could be derived from the session: the listing is empty on purpose. */
  unknownWorkspace?: boolean
  message?: string
  /** Same `taskId` in both roots — the workspace one won. */
  note?: string
}

/** One layer of the route mirror, or null when that layer carries no route. */
interface RouteLayer {
  hand: string
  review?: string
  at: string | null
}

/** Where the effective route comes from: the volatile settings row wins over both layers. */
type RouteSource = 'preset' | 'session' | 'default' | null

/**
 * The kernel's `/fly/smart/routes` payload (`readRoutesConfig`).
 *
 * `effective` is what the agent-plane tools will actually spawn with on the next
 * call; `effectiveFromPanel` is the honest part — with a non-empty preset row the
 * page can still *save*, but the preset row is the consumer, so the panel's value
 * never reaches a tool call. Saying that in the card is the whole point.
 */
interface RouteConfig {
  path: string
  version: number
  exists: boolean
  presetRow: { hand: string | null; at: string | null; effective: boolean }
  default: RouteLayer | null
  session: (RouteLayer & { id: string }) | null
  sessionKnown: boolean
  sessionCount: number
  brain: { value: string; consumer: null } | null
  effective: { hand: string; source: RouteSource } | null
  effectiveReview?: { review: string; source: RouteSource } | null
  effectiveFromPanel: boolean
}

/** One accepted route write, as the kernel answers it. */
interface RouteWrite {
  changed: boolean
  effectiveFromPanel: boolean
  source: RouteSource
  sessionKnown: boolean
  at: string | null
  path: string
}

/** The namespace root: the page's capability probe, always a 200. */
interface NamespacePayload {
  root: string
  exists: boolean
  message?: string
  routeConfig?: RouteConfig
}

interface ArtifactView {
  phase: string
  file: string
  bytes: number | null
  markdown: string
}

interface ConsultRecord {
  phase: string
  at: string | null
  provider: string | null
  model: string | null
  question: string
  file: string
  body: string | null
}

interface VerificationRow {
  at: string | null
  file: string
  provider: string | null
  model: string | null
  acceptance: string | null
  bytes: number | null
  missing: boolean
}

interface GateRecord {
  gate?: string
  at?: string
  by?: string
  note?: string
}

interface HistoryRow {
  file: string
  bytes: number | null
  at: string | null
}

interface TaskState {
  id: string
  title: string
  goal?: string
  phase: string
  awaitingGate: string | null
  reworkCount?: number
  /** 返工历史（`to` = 回到哪个阶段）与用户加额记录 —— 本阶段额度的分子与增量从这里来。 */
  history?: { to?: string }[]
  reworkGrants?: { phase?: string }[]
  /** 额度上限是行配置，任务创建/返工时戳一份（见 lib/state.mjs）。 */
  settings?: { maxRework?: number }
  archivedAt?: string
  summary?: { file: string; at: string }
  pendingDecisions?: PendingDecisions | null
  /** 用户裁决原文，按阶段分轮次。 */
  decisions?: Record<string, { at: string; by?: string; entries: unknown[] }[]>
}

interface RouteReport {
  hand: string[]
  execution: { provider: string; model: string; line: string } | null
  executed: string | null
  drifted: boolean
}

interface TaskPayload {
  root: string
  id: string
  taskDir: string
  state: TaskState
  artifacts: Record<string, ArtifactView>
  consults: ConsultRecord[]
  verifications: VerificationRow[]
  gates: GateRecord[]
  history: HistoryRow[]
  summary: { file: string; bytes: number | null; markdown: string } | null
  routes: RouteReport
}

/** One capsule in the drawer's empty-state guide. */
interface TabGuideEntry {
  id: string
  order: number
  title: () => string
  description?: () => string
  icon?: (props: { size?: number; className?: string }) => unknown
}

/** A right-drawer page type, as `ctx.sidebarRightTabs.register` takes it. */
interface TabDefinition {
  id: string
  kind: string
  title: () => string
  guide?: readonly TabGuideEntry[]
}

/** Minimal face of the browser-side Cordis context this plugin uses. */
interface BrowserContext {
  effect(callback: () => void | (() => void), label?: string): void
  /** Optional-chain service lookup: absent services are a degradation, not a crash. */
  get?(name: string): unknown
  slots: {
    inject(name: string, callback: (() => void | (() => void)) | void): void
    register(options: { name: string; key?: string; id?: string; order?: number; label?: string; inject?: () => unknown }, component: unknown): () => void
  }
  sidebarRightTabs: {
    register(definition: TabDefinition): () => void
  }
}

/**
 * The live browser context, captured by `apply()`.
 *
 * The model ladder needs `modelDirectories`, which is a service, not a prop: the
 * drawer seat's props carry the pane binding, and reading services off a captured
 * context keeps the component a pure view of one optional capability.
 */
let browserContext: BrowserContext | null = null

/** The host's error text, carried out of a non-2xx response. */
class HostError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HostError'
    this.status = status
  }
}

/** JSON GET whose failure keeps the host's own explanation (503/404 bodies). */
async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text === '' ? null : JSON.parse(text)
  } catch {
    payload = null
  }
  if (!response.ok) {
    const explained = typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `${path} → HTTP ${response.status}`
    throw new HostError(response.status, explained)
  }
  return payload as T
}

/** `2026-09-28T12:00:00.000Z` → `2026-09-28 12:00:00`, without a locale. */
/**
 * The current phase's rework budget, read off the task's own state.
 *
 * Deliberately a mirror of `lib/state.mjs`'s `reworkBudget()` — same rule (counted
 * per phase; the cap grows by one full budget per human grant), because the detail
 * view has the whole `state.json` and no business calling the machine. **Two
 * copies, one rule**: change one and change the other, or the chip will advertise a
 * budget the machine does not honour.
 *
 * @param state - the loaded task state.
 * @returns `{ used, cap, grants }`.
 */
function reworkBudgetOf(state: TaskState): { used: number; cap: number; grants: number } {
  const max = state.settings?.maxRework ?? 5
  const grants = (state.reworkGrants ?? []).filter(grant => grant.phase === state.phase).length
  const used = (state.history ?? []).filter(entry => entry.to === state.phase).length
  return { used, cap: max * (1 + grants), grants }
}

/**
 * The pending-decision section of a phase artifact, or null.
 *
 * Mirrors `lib/state.mjs`'s `openDecisions` for the read-only side: the machine's
 * judgement lives on the artifact (that is what `smart_gate` re-reads), so the面板 has to
 * read the same place — a task stopped before this field existed has no
 * `state.pendingDecisions` at all, and the board must not say 「开门 G1」 while the gate
 * refuses to ask anything.
 *
 * @param task - the loaded task payload.
 * @returns `{ headings, items }` for the current phase's artifact, or null.
 */
function artifactOpenDecisions(task: TaskPayload): PendingDecisions | null {
  const markdown = task.artifacts[task.state.phase]?.markdown ?? ''
  if (markdown === '') return null
  const headings: string[] = []
  let items = 0
  let inside = false
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (/^#{1,6}\s/u.test(line)) {
      inside = line.includes('需要你裁决')
      if (inside) headings.push(line.replace(/^#{1,6}\s*/u, '').trim())
      continue
    }
    if (inside && /^([-*+]|\d+[.)])\s+\S/u.test(line)) items += 1
  }
  return headings.length === 0 ? null : { headings, items }
}

/** The phase's pending decisions: the machine's own field when present, else read off the artifact. */
function pendingDecisionsOf(task: TaskPayload): PendingDecisions | null {
  return task.state.pendingDecisions ?? artifactOpenDecisions(task)
}

/**
 * How many decisions the user has recorded for this task, all phases.
 *
 * @param task - the loaded task payload.
 * @returns the number of recorded answers.
 */
function decidedCount(task: TaskPayload): number {
  let total = 0
  for (const rounds of Object.values(task.state.decisions ?? {})) {
    for (const round of Array.isArray(rounds) ? rounds : []) total += Array.isArray(round?.entries) ? round.entries.length : 0
  }
  return total
}

function formatTime(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}

/** Small byte counts, in the unit the artifact listing reads best in. */
function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—'
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/** `provider/model`, or a dash — never the string "null/null". */
function formatRoute(provider: string | null, model: string | null): string {
  return provider === null || model === null ? '—' : `${provider}/${model}`
}

/**
 * The session this drawer page belongs to, read from the DOM.
 *
 * The page cannot ask the platform for "my session id". The drawer body is seated
 * through the slot registry, and the seat's props carry the pane's binding — whose
 * `key` is the **tab** key, not the session (`runInject` passes `binding.key`;
 * measured in `dsh-client-ui-sidebar-right/lib/client.js`). What is reliable is the
 * attribute the right sidebar pane stamps on its own root
 * (`data-sidebar-right-session`, `dsh-client-ui-sidebar-right/lib/client.js:5680`),
 * so this walks up from the panel node — scoping the read to *this* pane when two
 * sessions are open side by side.
 *
 * A null answer is not fatal: the card falls back to the manual field and offers
 * only the default-scope button, and the host refuses a session write without an
 * id (400) rather than guessing one.
 *
 * @param from - the panel's own root element, or null before first render.
 * @returns the session id, or null when the shell does not expose one.
 */
function readSessionId(from: HTMLElement | null): string | null {
  if (typeof document === 'undefined') return null
  const owner = from?.closest('[data-sidebar-right-session]') ?? document.querySelector('[data-sidebar-right-session]')
  const value = owner?.getAttribute('data-sidebar-right-session') ?? ''
  return value === '' ? null : value
}

/** The host's own sentence for a failed request, keeping its status as a fallback. */
function hostErrorText(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { error?: unknown }).error
    if (typeof message === 'string' && message !== '') return message
  }
  return `HTTP ${status}`
}

/** The consumer of the effective route, in the page's words. */
const SOURCE_LABEL: Record<string, string> = {
  preset: 'preset 行（压过本页）',
  session: '本会话',
  default: '所有会话默认',
  none: '没有任何一层设置 —— 调用工具时会大声报错',
}

/**
 * The review row's sentence.
 *
 * An unset review route is **not** the same failure as an unset hand route: the
 * agent half falls back to the hand route, so the card must say "评审复用 hand"
 * rather than borrowing the hand row's "调用工具时会大声报错".
 *
 * @param config - the route payload.
 * @returns the sentence to print.
 */
function reviewEffectiveLabel(config: RouteConfig | null): string {
  const value = config?.effectiveReview?.review ?? ''
  const source = config?.effectiveReview?.source ?? null
  if (value === '') return '（未配置 —— 评审与取证复用 hand 路由）'
  return `${value} · ${source === null ? '未知来源' : SOURCE_LABEL[source]}`
}

/** One `<option>` of the model ladder, as `provider/model[@effort]`. */
interface LadderOption {
  value: string
  label: string
}

/** One reasoning effort a model accepts (`reasoning.efforts[]` upstream). */
interface ModelEffort {
  id: string
  name?: string
}

/** One model in the session's directory. */
interface ModelChoice {
  id: string
  reasoning?: { efforts?: ModelEffort[] }
}

/** One provider group in the session's directory. */
interface ModelGroup {
  id: string
  models: ModelChoice[]
}

/** The slice of the `modelDirectories` service the ladder needs. */
interface ModelDirectories {
  directoryFor?(sessionId: string): { load(): Promise<{ groups?: ModelGroup[] }> } | undefined
}

/** What the model directory answered, or why the ladder cannot be drawn. */
type LadderState = 'unavailable' | 'pending' | 'ready'

/**
 * The route configuration card: the page's only write surface.
 *
 * Read-only for `brain` on purpose: the mirror's legacy `brain` key has no consumer
 * (`readRoutesConfig` reports `consumer: null`), and the session model is owned by
 * the composer, so showing it as a read-only fact is the honest presentation. The
 * card writes **hand only**.
 *
 * The text field is the source of truth; the ladder is a helper that fills it in
 * from `modelDirectories.directoryFor(sessionId).load()`. Every degradation path
 * (no service, a throw, an empty directory, no session id) leaves manual entry
 * working and says which one happened, because the alternative — a select that
 * silently offers nothing — is how the route silently becomes unconfigurable.
 *
 * @param props - the current config, the session id, and a reload callback.
 */
function RouteCard({ config, sessionId, onSaved }: { config: RouteConfig | null; sessionId: string | null; onSaved: () => void }) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [ladder, setLadder] = useState<LadderState>('unavailable')
  const [options, setOptions] = useState<LadderOption[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const reviewInputRef = useRef<HTMLInputElement | null>(null)
  const roleRef = useRef<'hand' | 'review'>('hand')

  /**
   * "There is unsaved typing in the box", held in a **ref** rather than state.
   *
   * The disk-resync effect has to consult the *latest* interaction. An effect that
   * depends on a state flag reads the snapshot of the render that scheduled it, so
   * a background reload landing in the same tick as the first keystroke could put
   * the disk value back over what the user just typed. A ref has no such race.
   */
  const typed = useRef(false)

  /**
   * The box is **uncontrolled** and follows the disk until the user takes it over.
   *
   * One source of truth for "what gets saved" — the DOM node, read live by
   * {@link boxValue} — instead of two that can disagree for a commit (React's last
   * rendered value and a paste, an IME commit, an autofill or a scripted fill).
   * The effect re-seeds the box from disk whenever the disk value changes and the
   * user has not typed anything; after a save the flag is cleared, so the box
   * shows what is actually on disk again.
   */
  useEffect(() => {
    const next = config?.session?.hand ?? config?.default?.hand ?? ''
    if (typed.current) return
    if (inputRef.current !== null) inputRef.current.value = next
    if (reviewInputRef.current !== null) reviewInputRef.current.value = config?.session?.review ?? config?.default?.review ?? ''
    setDraft(next)
  }, [config])

  useEffect(() => {
    if (sessionId === null) {
      setLadder('unavailable')
      setOptions([])
      return
    }
    const models = browserContext?.get?.('modelDirectories') as ModelDirectories | undefined
    if (models === undefined || models === null || typeof models.directoryFor !== 'function') {
      setLadder('unavailable')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await models.directoryFor?.(sessionId)?.load()
        if (cancelled) return
        const next: LadderOption[] = []
        for (const group of snapshot?.groups ?? []) {
          for (const model of group.models ?? []) {
            const base = `${group.id}/${model.id}`
            next.push({ value: base, label: base })
            for (const effort of model.reasoning?.efforts ?? []) {
              next.push({ value: `${base}@${effort.id}`, label: `${base} · ${effort.name ?? effort.id}` })
            }
          }
        }
        setOptions(next)
        // An empty directory is "not ready yet": the composer fills it in when the
        // session's model list arrives, so this subscribes rather than giving up.
        setLadder(next.length === 0 ? 'pending' : 'ready')
      } catch {
        if (!cancelled) {
          setOptions([])
          setLadder('unavailable')
        }
      }
    })()
    return () => { cancelled = true }
  }, [sessionId])

  const presetEffective = config?.presetRow.effective === true
  const canSession = sessionId !== null && config?.sessionKnown !== false

  /**
   * The box the action row applies to: whichever field the user last touched.
   *
   * One action row drives both routes — the target is the field you typed in, so
   * the ladder and the three buttons never need a second duplicate row.
   *
   * @returns the live input element, or null before mount.
   */
  const activeBox = () => (roleRef.current === 'review' ? reviewInputRef.current : inputRef.current)

  /**
   * The value to save: **the box, read live**.
   *
   * The user's expectation is unambiguous — whatever is in the box is what gets
   * saved — so the write path asks the DOM, and `draft` is only what the box was
   * last re-seeded with. Explicit values (the clear buttons) still win.
   */
  const boxValue = () => activeBox()?.value ?? draft

  const save = async (scope: 'session' | 'default', value = boxValue().trim()) => {
    setSaving(true)
    setStatus(null)
    try {
      const response = await fetch(`${BASE}/routes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scope === 'session' ? { [roleRef.current]: value, role: roleRef.current, scope, sessionId } : { [roleRef.current]: value, role: roleRef.current, scope }),
      })
      const text = await response.text()
      let payload: unknown = null
      try {
        payload = text === '' ? null : JSON.parse(text)
      } catch {
        payload = null
      }
      if (!response.ok) {
        setStatus({ tone: 'error', text: hostErrorText(payload, response.status) })
        return
      }
      const written = payload as RouteWrite
      typed.current = false
      const where = scope === 'session' ? '本会话' : '所有会话默认'
      setStatus({
        tone: written.effectiveFromPanel ? 'ok' : 'warn',
        text: written.changed
          ? `已保存到${where}（${written.at ?? '—'}）${written.effectiveFromPanel ? '' : ' · 但 preset 行已有路由，工具面仍用它'}`
          : `值未变化 —— 磁盘上已经是 ${value === '' ? '（空）' : value}`,
      })
      onSaved()
    } catch (error) {
      setStatus({ tone: 'error', text: `请求失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="fly-card" data-probe="route-config">
      <h2>三模型路由</h2>
      <p className="fly-sub" data-probe="route-path">
        {`配置面 ${config?.path ?? '…'}（hand / review 可写；brain 只读）`}
      </p>
      <dl className="fly-kv">
        <dt>brain（只读）</dt>
        <dd data-probe="brain-route">{config?.brain?.value ?? '（镜像里没有 brain 键 —— 本页只写 hand / review）'}</dd>
        <dt>hand 当前生效</dt>
        <dd data-probe="effective-route">
          {`${config?.effective?.hand === undefined || config.effective.hand === '' ? '（未配置）' : config.effective.hand} · ${SOURCE_LABEL[config?.effective?.source ?? 'none']}`}
        </dd>
        <dt>review 当前生效</dt>
        <dd data-probe="effective-review-route">{reviewEffectiveLabel(config)}</dd>
        <dt>本会话 hand</dt>
        <dd data-probe="session-route">{config?.session?.hand === undefined || config.session.hand === '' ? '（未单独设置）' : config.session.hand}</dd>
        <dt>本会话 review</dt>
        <dd data-probe="session-review-route">{config?.session?.review === undefined || config.session.review === '' ? '（未单独设置）' : config.session.review}</dd>
        <dt>所有会话默认 hand</dt>
        <dd data-probe="default-route">{config?.default?.hand === undefined || config.default.hand === '' ? '（未设置）' : config.default.hand}</dd>
        <dt>所有会话默认 review</dt>
        <dd data-probe="default-review-route">{config?.default?.review === undefined || config.default.review === '' ? '（未设置）' : config.default.review}</dd>
      </dl>

      <label className="fly-field">
        <span>hand 模型（provider/model，可选 @effort）</span>
        <input
          type="text"
          data-fly-smart-field="hand"
          ref={inputRef}
          defaultValue={config?.session?.hand ?? config?.default?.hand ?? ''}
          placeholder="deepseek/deepseek-flash"
          spellCheck={false}
          onFocus={() => { roleRef.current = 'hand' }}
          onChange={event => { roleRef.current = 'hand'; typed.current = true; setDraft(event.target.value) }}
        />
      </label>

      <label className="fly-field">
        <span>review 模型（provider/model，可选 @effort）</span>
        <input
          type="text"
          data-fly-smart-field="review"
          ref={reviewInputRef}
          defaultValue={config?.session?.review ?? config?.default?.review ?? ''}
          placeholder="deepseek/deepseek-reasoner"
          spellCheck={false}
          onFocus={() => { roleRef.current = 'review' }}
          onChange={event => { roleRef.current = 'review'; typed.current = true; setDraft(event.target.value) }}
        />
      </label>

       {ladder === 'ready'
        ? (
            <label className="fly-field">
              <span>从模型目录选择（写入你正在编辑的那个输入框）</span>
              <select
                data-fly-smart-field="ladder"
                defaultValue=""
                onChange={event => {
                  if (event.target.value === '') return
                  // 真的写进框里：`boxValue()` 读的是 DOM，只 setDraft 会让下拉看起来"没反应"。
                  typed.current = true
                  const box = activeBox()
                  if (box !== null) box.value = event.target.value
                  setDraft(event.target.value)
                }}
              >
                <option value="">（从目录里挑一个）</option>
                {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
          )
        : (
            <p className="fly-note" data-probe="ladder-state" data-ladder={ladder}>
              {ladder === 'unavailable'
                ? '模型目录服务不可用（或本页读不到会话 id）—— 请手工填写 provider/model。'
                : '模型目录还没就绪 —— 可以先手工填写，稍后目录到了再从下拉里挑。'}
            </p>
          )}

      <div className="fly-actions">
        <button
          className="fly-btn"
          type="button"
          data-act="save-session"
          disabled={saving || !canSession}
          onClick={() => { void save('session') }}
        >
          保存到本会话
        </button>
        <button
          className="fly-btn"
          type="button"
          data-act="save-default"
          disabled={saving || presetEffective}
          onClick={() => { void save('default') }}
        >
          设为所有会话默认
        </button>
        <button
          className="fly-btn"
          type="button"
          data-act="clear-session"
          disabled={saving || !canSession || config?.session === null || config?.session === undefined}
          onClick={() => { void save('session', '') }}
        >
          清空本会话
        </button>
      </div>

      <p className="fly-note" data-probe="route-target">
        {'上面三个动作作用于你最后碰过的那个输入框（hand 或 review）—— 点一下要改的那条，再按保存。'}
      </p>

      {presetEffective
        ? (
            <p className="fly-note" data-probe="preset-note">
              {`preset 行已把路由钉成 ${config?.presetRow.hand ?? ''}，它压过本页（也压过镜像）—— 「设为所有会话默认」因此禁用；本会话的写入只有在该行清空后才轮到工具面。`}
            </p>
          )
        : null}
      {status === null ? null : <p className={status.tone === 'error' ? 'fly-note-error' : 'fly-note'} data-probe="route-status" data-tone={status.tone}>{status.text}</p>}
    </article>
  )
}

/**
 * Where one board cell stands.
 *
 * The phase machine only advances on a passed gate, so "before the current phase"
 * and "gate recorded" cannot disagree in a well-formed task; the archived case is
 * checked first because an archived task ends with every gate passed.
 */
function phaseStatus(phase: (typeof BOARD)[number], task: TaskPayload): PhaseStatus {
  const state = task.state
  const archived = typeof state.archivedAt === 'string'
  const order = BOARD.map(entry => entry.id as string)
  const currentIndex = order.indexOf(state.phase)
  const index = order.indexOf(phase.id)
  if (archived) return phase.id === 'done' ? 'archived' : 'passed'
  const gatePassed = phase.gate !== null && task.gates.some(record => record.gate === phase.gate)
  if (gatePassed || (currentIndex !== -1 && index < currentIndex)) return 'passed'
  if (index === currentIndex) return 'active'
  return 'todo'
}

/** Artifact tabs: the six existing artifacts, plus the closing summary when archived. */
function artifactTabs(task: TaskPayload): string[] {
  const phases = ['brainstorm', 'design', 'plan', 'acceptance', 'executing', 'reviewing']
  const present = phases.filter(phase => task.artifacts[phase] !== undefined)
  return task.summary === null ? present : [...present, 'summary']
}

/** The markdown for one tab, or null when that artifact does not exist. */
function artifactText(task: TaskPayload, phase: string): string | null {
  if (phase === 'summary') return task.summary?.markdown ?? null
  return task.artifacts[phase]?.markdown ?? null
}

/**
 * Preformatted markdown with recognisable headings.
 *
 * No markdown library: the viewer's contract is "show the artifact as written".
 * Heading lines are pulled out of the `<pre>` so the reader can navigate a long
 * plan, and everything else — lists, tables, fenced blocks — stays exactly as the
 * model wrote it, indentation included.
 */
function MarkdownView({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n')
  const blocks: { kind: 'heading' | 'text'; body: string; level?: number }[] = []
  let buffer: string[] = []
  const flush = () => {
    if (buffer.length === 0) return
    blocks.push({ kind: 'text', body: buffer.join('\n') })
    buffer = []
  }
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading === null) {
      buffer.push(line)
      continue
    }
    flush()
    blocks.push({ kind: 'heading', body: heading[2], level: heading[1].length })
  }
  flush()

  return (
    <div>
      {blocks.map((block, index) => block.kind === 'heading'
        ? (
            <p className="fly-sub" data-heading={block.level} key={`h-${index}`} style={{ margin: '10px 0 6px' }}>
              {block.body}
            </p>
          )
        : <pre style={PRE_STYLE} key={`t-${index}`}>{block.body.replace(/^\n+|\n+$/gu, '')}</pre>)}
    </div>
  )
}

/** The workbench: task picker, board, artifacts, gates, reviews, evidence, warning. */
export function SmartPanel() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [root, setRoot] = useState<string>('')
  const [selected, setSelected] = useState<string | null>(null)
  const [task, setTask] = useState<TaskPayload | null>(null)
  const [tab, setTab] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'missing' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState(true)
  const [routeConfig, setRouteConfig] = useState<RouteConfig | null>(null)
  const [legacyCount, setLegacyCount] = useState(0)
  const [unknownWorkspace, setUnknownWorkspace] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [jumped, setJumped] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const artifactsRef = useRef<HTMLElement | null>(null)

  // The shell's session attribute only exists after mount, and a second drawer
  // page can appear later, so this re-reads on every load instead of once.
  const scopedSession = useCallback(() => {
    const found = readSessionId(rootRef.current)
    setSessionId(found)
    return found
  }, [])

  const load = useCallback(async (wanted?: string | null) => {
    setBusy(true)
    const sid = scopedSession()
    const query = sid === null ? '' : `?sessionId=${encodeURIComponent(sid)}`
    try {
      // Ask the namespace root first: it answers 200 in both cases, so a machine
      // that has never run smart renders the empty state instead of logging a
      // failed request. The data routes keep their 503 contract for HTTP clients.
      const namespace = await getJson<NamespacePayload>(`${BASE}${query}`)
      setRoot(namespace.root)
      setRouteConfig(namespace.routeConfig ?? null)
      if (namespace.exists === false) {
        setTasks([])
        setTask(null)
        setNotice({ kind: 'missing', message: namespace.message ?? `${namespace.root} 下还没有任何 smart 任务。` })
        return
      }

      const index = await getJson<TasksPayload>(`${BASE}/tasks${query}`)
      setRoot(index.root)
      setTasks(index.tasks)
      setLegacyCount(index.legacyCount ?? 0)
      // The explicit argument is the selection the user just made; a refresh
      // passes the current one in, so this callback needs no state dependency.
      const next = wanted ?? index.tasks[0]?.id ?? null
      setSelected(next)
      if (index.unknownWorkspace === true) {
        // The host knows there are legacy tasks but not which workspace is asking:
        // say so instead of showing an empty board as if smart had nothing.
        setTask(null)
        setUnknownWorkspace(index.message ?? '无法确定当前工作区。')
        setNotice(null)
        return
      }
      setUnknownWorkspace(null)
      if (next === null) {
        setTask(null)
        setNotice({ kind: 'missing', message: `${index.root} 下还没有任何 smart 任务。` })
        return
      }
      const detail = await getJson<TaskPayload>(`${BASE}/task?id=${encodeURIComponent(next)}${sid === null ? '' : `&sessionId=${encodeURIComponent(sid)}`}`)
      setTask(detail)
      setNotice(null)
      setTab(current => {
        const available = artifactTabs(detail)
        return current !== null && available.includes(current) ? current : available[0] ?? null
      })
    } catch (error) {
      setTask(null)
      const message = error instanceof Error ? error.message : String(error)
      // 503 is the host saying "smart has produced nothing yet", which is an empty
      // state with instructions, not a failure; anything else is a real fault.
      setNotice({ kind: error instanceof HostError && error.status === 503 ? 'missing' : 'error', message })
    } finally {
      setBusy(false)
    }
  }, [scopedSession])

  useEffect(() => { void load() }, [load])

  /**
   * Board cell → artifact viewer. The chip promises "click to read it", so the
   * click must land on the viewer's tab for that phase and focus it (a keyboard
   * user gets the same destination), not merely set some state somewhere. The
   * focus/scroll runs in the effect *after* the commit, so it lands on the node
   * the new render actually kept.
   */
  const jump = (phase: string) => {
    setTab(phase)
    setJumped(phase)
  }

  useEffect(() => {
    if (jumped === null) return
    const card = artifactsRef.current ?? rootRef.current?.querySelector('[data-probe="artifacts"]') ?? null
    const button = card?.querySelector(`button[data-artifact="${jumped}"]`)
    // No instanceof guard: an Element from another realm fails it, and the only
    // thing this needs is the focus method.
    if (button === null || button === undefined) return
    const target = button as HTMLElement
    // Focus first, then scroll: the focus itself already brings the tab into view,
    // and an explicit `scrollIntoView` racing it is how the focus call gets dropped
    // in Chromium.
    target.focus({ preventScroll: true })
    card?.scrollIntoView({ block: 'nearest' })
  }, [jumped, tab])

  const hand = task?.routes.hand ?? []

  return (
    <section className="fly-panel" data-plugin={PACKAGE} data-session-id={sessionId ?? ''} ref={rootRef}>
      <h1>Smart 工作流</h1>
      <p className="fly-sub">
        smart 模式的磁盘事实：阶段板、六个产物、门记录、手模型评审与验收取证。
        {root === '' ? '' : ` 数据源 ${root}`}
      </p>

      <RouteCard config={routeConfig} sessionId={sessionId} onSaved={() => { void load(selected) }} />

      {unknownWorkspace === null ? null : <p className="fly-note" data-probe="unknown-workspace">{unknownWorkspace}</p>}
      {legacyCount === 0 ? null : (
        <p className="fly-note" data-probe="legacy-count">
          {`另有 ${legacyCount} 个任务在兼容根（旧任务仍可读、可继续、可归档）。`}
        </p>
      )}

      <div className="fly-actions">
        <div className="fly-chip-row">
          <span className="fly-chip" data-chip="tasks">{`任务 ${tasks.length}`}</span>
          <span className="fly-chip" data-chip="root" title={root}>{`根目录 ${root === '' ? '…' : root}`}</span>
          {task === null ? null : (
            <>
              <span className="fly-chip" data-chip="phase">{`阶段 ${PHASE_LABEL[task.state.phase] ?? task.state.phase}`}</span>
              <span className="fly-chip" data-chip="gate">{`开门 ${task.state.awaitingGate ?? '无'}`}</span>
              <span
                className="fly-chip"
                data-chip="rework"
                {...reworkBudgetOf(task.state).used >= reworkBudgetOf(task.state).cap ? { 'data-tone': 'warn' } : {}}
                title={`本阶段（${PHASE_LABEL[task.state.phase] ?? task.state.phase}）返工额度：已用 ${reworkBudgetOf(task.state).used} / 上限 ${reworkBudgetOf(task.state).cap}`
                  + `${reworkBudgetOf(task.state).grants === 0 ? '' : `（含你加额的 ${reworkBudgetOf(task.state).grants} 次）`}`
                  + `${reworkBudgetOf(task.state).used >= reworkBudgetOf(task.state).cap ? '。额度已用尽：下一道门会把「是否继续重做」交给你' : ''}`}
              >
                {`返工 ${reworkBudgetOf(task.state).used}/${reworkBudgetOf(task.state).cap}`}
              </span>
              <span className="fly-chip" data-chip="consults">{`评审 ${task.consults.length}`}</span>
              {/* briefing 格（acceptance A10）：当前阶段产物的对话式要点处于哪一步。面板只报状态
                  与路由 —— 正文在对话里，不复制。映射与 state.mjs 的派生序一一对应。 */}
              <span
                className="fly-chip"
                data-chip="briefing"
                {...briefingStatus(task) === 'stale' || briefingStatus(task) === 'failed' ? { 'data-tone': 'warn' } : {}}
                title={`briefing（${PHASE_LABEL[task.state.phase] ?? task.state.phase}）：${BRIEFING_LABEL[briefingStatus(task)] ?? briefingStatus(task)}${briefingRoute(task) === null ? '' : ` · ${briefingRoute(task)}`}`}
              >
                {`briefing ${BRIEFING_LABEL[briefingStatus(task)] ?? briefingStatus(task)}`}
              </span>
              <span className="fly-chip" data-chip="evidence">{`取证 ${task.verifications.length}`}</span>
              <span className="fly-chip" data-chip="archived">{task.state.archivedAt === undefined ? '未归档' : `归档 ${formatTime(task.state.archivedAt)}`}</span>
              {/* 裁决面：产物里还有只有用户能定的问题 → 门是**不开**的，这里必须说清是"欠裁决"
                  而不是"没到门"；已经定过的条数也摆出来，用户能看到自己定过什么。 */}
              {pendingDecisionsOf(task) === null
                ? decidedCount(task) === 0
                  ? null
                  : <span className="fly-chip" data-chip="decisions">{`已裁决 ${decidedCount(task)}`}</span>
                : (
                    <span
                      className="fly-chip"
                      data-chip="decisions"
                      data-tone="warn"
                      title={pendingDecisionsOf(task)?.headings.join(' / ')}
                    >
                      {`待裁决 ${pendingDecisionsOf(task)?.items}`}
                    </span>
                  )}
              {task.routes.drifted
                ? <span className="fly-chip" data-chip="route" data-tone="warn">{`路由不一致 ${task.routes.executed ?? ''}`}</span>
                : task.routes.executed === null
                  ? <span className="fly-chip" data-chip="route">执行路由未知</span>
                  : <span className="fly-chip" data-chip="route" data-tone="ok">{`路由一致 ${task.routes.executed}`}</span>}
            </>
          )}
        </div>
        <button className="fly-btn" type="button" onClick={() => { void load(selected) }} disabled={busy}>
          {busy ? '读取…' : '刷新'}
        </button>
      </div>

      {notice === null ? null : notice.kind === 'missing'
        ? (
            <p className="fly-empty" data-probe="empty">
              {notice.message}
              {' '}
              它会按 脑暴 → 设计 → 计划 → 验收设计 → 执行 → 验收 推进，每个阶段过门前都要问过你。
            </p>
          )
        : <p className="fly-note-error" data-probe="host-error">{notice.message}</p>}

      {tasks.length === 0 ? null : (
        <article className="fly-card" data-probe="tasks">
          <h2>任务</h2>
          <div className="fly-chip-row">
            {tasks.map(entry => (
              <button
                className="fly-btn"
                type="button"
                key={entry.id}
                data-task={entry.id}
                data-selected={entry.id === selected ? 'true' : 'false'}
                onClick={() => { setSelected(entry.id); void load(entry.id) }}
              >
                {`${entry.title === '' ? entry.id : entry.title} · ${PHASE_LABEL[entry.phase] ?? entry.phase}${entry.pendingDecisions != null
                  ? ` · 待裁决 ${entry.pendingDecisions.items}`
                  : entry.awaitingGate === null ? '' : ` · ${entry.awaitingGate}`}${reworkExhausted(entry) ? ' · 额度用尽' : ''}`}
              </button>
            ))}
          </div>
        </article>
      )}

      {task === null ? null : (
        <>
          {task.routes.drifted
            ? (
                <p className="fly-note-error" data-probe="route-warning">
                  {`路由告警：执行报告写的是 ${task.routes.executed ?? '未知路由'}，`}
                  {`手模型评审记录是 ${hand.length === 0 ? '（无）' : hand.join('、')}。`}
                  设计由一个模型评审、由另一个模型执行 —— 请人工确认这是有意为之。
                </p>
              )
            : null}

          <section className="fly-card" data-probe="board">
            <h2>阶段板</h2>
            <div className="fly-grid">
              {BOARD.map(entry => {
                const status = phaseStatus(entry, task)
                // 完成 阶段的产物是收尾总结：reader 把它放在 task.summary，不塞进 artifacts。
                // 产物查看器早就有「收尾总结」页签，阶段板这一格却写着「—」—— 同一个文件在
                // 一页里两种说法，而这一格正是"任务到底交付了什么"该被看见的地方。
                // 跳转落到查看器的 summary 页签（data-artifact-jump 仍标这一格，不是页签）。
                const target = entry.id === 'done' ? 'summary' : entry.id
                const artifact = target === 'summary' ? (task.summary ?? undefined) : task.artifacts[target]
                const consult = task.consults.find(record => record.phase === entry.id)
                return (
                  <div className="fly-card" key={entry.id} data-phase={entry.id} data-status={status}>
                    <div className="fly-chip-row">
                      <span className="fly-chip">{entry.gate ?? '—'}</span>
                      <span className="fly-chip" data-phase-status={status}>{entry.label}</span>
                      <span className="fly-tag" data-phase-status={status}>{STATUS_LABEL[status]}</span>
                      {entry.id === task.state.phase && pendingDecisionsOf(task) != null
                        ? <span className="fly-tag" data-chip="decisions">{`待裁决 ${pendingDecisionsOf(task)?.items}`}</span>
                        : null}
                      {entry.id === task.state.phase && reworkBudgetOf(task.state).used >= reworkBudgetOf(task.state).cap
                        ? <span className="fly-tag" data-chip="rework">{'额度用尽'}</span>
                        : null}
                    </div>
                    <dl className="fly-kv">
                      <dt>产物</dt>
                      <dd>
                        {artifact === undefined
                          ? '—'
                          : (
                              <button
                                className="fly-btn"
                                type="button"
                                data-artifact-jump={entry.id}
                                title="跳到产物查看器"
                                onClick={() => jump(target)}
                              >
                                {`${artifact.file} · ${formatBytes(artifact.bytes)}`}
                              </button>
                            )}
                      </dd>
                      <dt>评审</dt>
                      <dd>{consult === undefined ? '—' : formatRoute(consult.provider, consult.model)}</dd>
                    </dl>
                  </div>
                )
              })}
            </div>
          </section>

          <article className="fly-card" data-probe="artifacts" ref={artifactsRef}>
            <h2>产物查看器</h2>
            <div className="fly-chip-row">
              {artifactTabs(task).map(phase => (
                <button
                  className="fly-btn"
                  type="button"
                  key={phase}
                  data-artifact={phase}
                  data-selected={phase === tab ? 'true' : 'false'}
                  data-focused={phase === jumped ? 'true' : 'false'}
                  onClick={() => { setTab(phase); setJumped(null) }}
                >
                  {ARTIFACT_LABEL[phase] ?? phase}
                </button>
              ))}
            </div>
            {tab !== null && artifactText(task, tab) !== null
              ? <MarkdownView markdown={artifactText(task, tab) as string} />
              : <p className="fly-empty">这个任务还没有产物。</p>}
          </article>

          <article className="fly-card" data-probe="gates">
            <h2>门记录</h2>
            {task.gates.length === 0
              ? <p className="fly-empty">还没有任何门记录（每个设计阶段结束时由用户确认）。</p>
              : (
                  <table className="fly-table">
                    <thead>
                      <tr><th>门</th><th>时间</th><th>确认人</th><th>备注</th></tr>
                    </thead>
                    <tbody>
                      {task.gates.map((record, index) => (
                        <tr key={`${record.gate ?? 'gate'}-${index}`}>
                          <td>{record.gate ?? '—'}</td>
                          <td>{formatTime(record.at)}</td>
                          <td>{record.by ?? '—'}</td>
                          <td>{record.note === undefined || record.note === '' ? '—' : record.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            <h2 style={{ marginTop: '16px' }}>返工历史</h2>
            {task.history.length === 0
              ? <p className="fly-empty">没有被退回重做的产物。</p>
              : (
                  <table className="fly-table">
                    <thead>
                      <tr><th>时间</th><th>归档产物</th></tr>
                    </thead>
                    <tbody>
                      {task.history.map(entry => (
                        <tr key={entry.file}>
                          <td>{formatTime(entry.at)}</td>
                          <td>{`${entry.file} · ${formatBytes(entry.bytes)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </article>

          <article className="fly-card" data-probe="consults">
            <h2>手模型评审</h2>
            {task.consults.length === 0
              ? <p className="fly-empty">还没有评审记录（每个设计阶段过门前都要请手模型评审一次）。</p>
              : (
                  <table className="fly-table">
                    <thead>
                      <tr><th>阶段</th><th>时间</th><th>路由</th><th>问题</th></tr>
                    </thead>
                    <tbody>
                      {task.consults.map(record => (
                        <tr key={record.phase}>
                          <td>{record.phase}</td>
                          <td>{formatTime(record.at)}</td>
                          <td data-route={formatRoute(record.provider, record.model)}>{formatRoute(record.provider, record.model)}</td>
                          <td>{record.question === '' ? '—' : record.question}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </article>

          <article className="fly-card" data-probe="evidence">
            <h2>验收取证</h2>
            {task.verifications.length === 0
              ? <p className="fly-empty">还没有取证记录（验收阶段由只读子代理逐条核对验收项）。</p>
              : (
                  <table className="fly-table">
                    <thead>
                      <tr><th>时间</th><th>证据</th><th>路由</th></tr>
                    </thead>
                    <tbody>
                      {task.verifications.map(row => (
                        <tr key={row.file}>
                          <td>{formatTime(row.at)}</td>
                          <td>{`${row.file}${row.missing ? '（文件缺失）' : ''}`}</td>
                          <td>{formatRoute(row.provider, row.model)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </article>
        </>
      )}
    </section>
  )
}

/**
 * Seat the workbench in the right drawer: one page type and one body in the
 * drawer's `sidebar.right.pane.tab` seat, keyed by the registration id (the npm
 * package name). The drawer sits beside a session; it never replaces one.
 *
 * No stylesheet is registered: every rule this panel needs already lives in the
 * skin (`dsh-plugin-fly-shell`).
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: BrowserContext): void {
  browserContext = ctx

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PACKAGE,
    kind: KIND,
    title: () => TAB_TITLE,
    guide: [{
      id: 'open',
      order: GUIDE_ORDER,
      title: () => TAB_TITLE,
      description: () => TAB_DESCRIPTION,
      icon: SmartMark,
    }],
  }), 'fly-smart-panel: drawer type')

  // 设计系统的样式表：**自带一份**（web 上没有工作台外壳，`.fly-*` 就没有规则）。
  // 与外壳同一个姿势：注入一个带 `data-plugin` 的 `<style>`，卸载时移除。
  // 桌面/dev 上外壳也在场 ⇒ 两份规则同源（都来自 @dsh-fly/fly-panel-style）⇒ 值一致、只多一层。
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin', PACKAGE)
    tag.textContent = WORKBENCH_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'fly-smart-panel: workbench stylesheet')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: PACKAGE, inject: () => ({}) },
    SmartPanel,
  )), 'fly-smart-panel: drawer body')
}

/** The sidebar glyph: a phase pipeline with the gate shoulder. */
export function SmartMark({ size = 18, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg className="fly-mark" data-active={active ? 'true' : 'false'} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h7M3 12h12M3 18h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 4v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
