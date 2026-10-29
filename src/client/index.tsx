/**
 * DSH Fly smart workbench, browser half — the `fly.smart` right-drawer page.
 *
 * **0.3.0 slim:** the page is one card — the model routes. The task board, the
 * artifact viewer, the gate records and the rework history are gone with the
 * workflow they visualised; the task tree itself stays on disk untouched, readable
 * as plain markdown.
 *
 * What remains is the page's only write surface and the only thing that had to be
 * reachable every day: the `hand` / `review` route pair. It POSTs to
 * `/fly/smart/routes` (the mirror the agent-plane tools read lazily, per call) and
 * says honestly whether what it just saved can reach a tool call — a non-empty
 * preset row wins over the page.
 *
 * `brain` is displayed read-only: the mirror's legacy `brain` key has no consumer,
 * and the session model belongs to the composer.
 *
 * Presentation reuses the Fly surface (`fly-card`, `fly-kv`, `fly-field`, `fly-btn`,
 * `fly-note`, `fly-note-error`) injected by `dsh-plugin-fly-shell`.
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
const TAB_TITLE = 'Smart 模型路由'

/** One line under the guide capsule, shown while the guide stays uncrowded. */
const TAB_DESCRIPTION = 'hand / review 路由：派发子代理时按这里选模型'

/** Ascending place among every registered type's guide entries: after the four workbenches. */
const GUIDE_ORDER = 40

/** npm package name: the guide id and the panel's `data-plugin` stamp. */
const PACKAGE = 'dsh-plugin-fly-smart-panel'

/** This row's own host namespace. */
const BASE = '/fly/smart'

/** One layer of the route mirror, or null when that layer carries no route. */
interface RouteLayer {
  hand: string
  review?: string
  lite?: string
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
 * never reaches a tool call.
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
  effectiveLite?: { lite: string; source: RouteSource } | null
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

/** The live browser context, for the model-directory ladder (set in `apply`). */
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

/** JSON GET whose failure keeps the host's own explanation. */
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

/**
 * The session this drawer page belongs to, read from the DOM.
 *
 * The page cannot ask the platform for "my session id": the seat's props carry the
 * **tab** key, not the session. What is reliable is the attribute the right sidebar
 * pane stamps on its own root (`data-sidebar-right-session`), so this walks up from
 * the panel node — scoping the read to *this* pane when two sessions are open.
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

/**
 * The lite row's sentence. **No fallback** by design: mechanical work silently
 * running on the expensive model is a cost decision the user did not make, so an
 * unconfigured lite route says so instead of borrowing hand.
 */
function liteEffectiveLabel(config: RouteConfig | null): string {
  const value = config?.effectiveLite?.lite ?? ''
  const source = config?.effectiveLite?.source ?? null
  if (value === '') return '（未配置 —— 派发 role:lite 会大声报错，不静默用贵模型）'
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
  const liteInputRef = useRef<HTMLInputElement | null>(null)
  const roleRef = useRef<'hand' | 'review' | 'lite'>('hand')

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
    if (liteInputRef.current !== null) liteInputRef.current.value = config?.session?.lite ?? config?.default?.lite ?? ''
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
  const activeBox = () => (roleRef.current === 'review' ? reviewInputRef.current : roleRef.current === 'lite' ? liteInputRef.current : inputRef.current)

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
        {`配置面 ${config?.path ?? '…'}（hand / review / lite 可写；brain 只读）`}
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
        <dt>lite 当前生效</dt>
        <dd data-probe="effective-lite-route">{liteEffectiveLabel(config)}</dd>
        <dt>本会话 hand</dt>
        <dd data-probe="session-route">{config?.session?.hand === undefined || config.session.hand === '' ? '（未单独设置）' : config.session.hand}</dd>
        <dt>本会话 review</dt>
        <dd data-probe="session-review-route">{config?.session?.review === undefined || config.session.review === '' ? '（未单独设置）' : config.session.review}</dd>
        <dt>本会话 lite</dt>
        <dd data-probe="session-lite-route">{config?.session?.lite === undefined || config.session.lite === '' ? '（未单独设置）' : config.session.lite}</dd>
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

       <label className="fly-field">
        <span>lite 模型（机械活的便宜模型，provider/model，可选 @effort）</span>
        <input
          type="text"
          data-fly-smart-field="lite"
          ref={liteInputRef}
          defaultValue={config?.session?.lite ?? config?.default?.lite ?? ''}
          placeholder="deepseek/deepseek-flash"
          spellCheck={false}
          onFocus={() => { roleRef.current = 'lite' }}
          onChange={event => { roleRef.current = 'lite'; typed.current = true; setDraft(event.target.value) }}
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
        {'上面三个动作作用于你最后碰过的那个输入框（hand / review / lite）—— 点一下要改的那条，再按保存。'}
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
 * The drawer page: the route card, plus the one line that says where the payload
 * came from (so a failed read is readable instead of an empty card).
 */
export function SmartPanel() {
  const [routeConfig, setRouteConfig] = useState<RouteConfig | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)

  // The shell's session attribute only exists after mount, and a second drawer
  // page can appear later, so this re-reads on every load instead of once.
  const scopedSession = useCallback(() => {
    const found = readSessionId(rootRef.current)
    setSessionId(found)
    return found
  }, [])

  const load = useCallback(async () => {
    const sid = scopedSession()
    const query = sid === null ? '' : `?sessionId=${encodeURIComponent(sid)}`
    try {
      const payload = await getJson<RouteConfig>(`${BASE}/routes${query}`)
      setRouteConfig(payload)
      setNotice(null)
    } catch (error) {
      setRouteConfig(null)
      setNotice(error instanceof Error ? `读路由配置失败：${error.message}` : `读路由配置失败：${String(error)}`)
    }
  }, [scopedSession])

  useEffect(() => { void load() }, [load])

  return (
    <section className="fly-panel" data-probe="smart-panel" ref={rootRef}>
      <h1>Smart</h1>
      <p className="fly-sub">{'派发子代理时使用的模型路由。任务的计划与验收就是普通 markdown（docs/plans/），用 smart_check_doc 校验契约。'}</p>
      {notice === null ? null : <p className="fly-note-error" data-probe="route-notice">{notice}</p>}
      <RouteCard config={routeConfig} sessionId={sessionId} onSaved={() => { void load() }} />
    </section>
  )
}

/**
 * Register the drawer page and its design-system copy.
 *
 * No stylesheet of its own beyond the shared design system: every rule this panel
 * needs already lives in the skin (`dsh-plugin-fly-shell`); the copy is injected for
 * surfaces that do not have the shell (`web`).
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

/** The sidebar glyph: a model route — two nodes and the edge between them. */
export function SmartMark({ size = 18, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg className="fly-mark" data-active={active ? 'true' : 'false'} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.2 7.4 15.8 16.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
