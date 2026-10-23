/**
 * Fly smart mode — the agent-plane half (design: `docs/smart-mode-design.md`).
 *
 * Smart mode is the "design first, then execute, then accept" workflow of a
 * three-model collaboration: the session's model is the *brain*, a subagent on
 * the *hand* route executes, and an independent *review* route audits feasibility
 * and acceptance evidence. This file mounts the phase machine as tools; the state itself lives in `lib/state.mjs` so every
 * transition is testable without cordis.
 *
 * S1 scope (this file): `smart_begin`, `smart_artifact`, `smart_status`.
 * `smart_consult` / `smart_gate` (S2) and `smart_execute` / `smart_verify` /
 * `smart_rework` / `smart_finish` (S3) follow the design's staging; the machine
 * they need is already here — recording an artifact opens the phase's gate and
 * nothing advances until that gate is passed.
 *
 * @module dsh-plugin-fly-smart
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ARTIFACT_FILE,
  BRIEFING_PHASES,
  DESIGN_PHASES,
  GATE_AFTER,
  briefingGaps,
  briefingStatusOf,
  cancelTask,
  candidateTaskRoots,
  createTask,
  currentHandRoute,
  currentReviewRoute,
  gateGaps,
  gateOwner,
  grantRework,
  openDecisions,
  listTasks,
  locateTask,
  passGate,
  readArtifact,
  readState,
  recordArtifact,
  recordBriefing,
  recordReviewBundle,
  freshReviewBundle,
  recordPlanAcceptance,
  companionFileOf,
  recordBriefingFailure,
  confirmBriefing,
  missingBriefingSections,
  recordConsult,
  readConsult,
  recordDecisions,
  recordVerification,
  resolveConfig,
  resolveBrainstormEffort,
  resolveMirrorPath,
  resolveTaskRoot,
  reworkBudget,
  reworkTo,
  finishTask,
  taskStatus,
  taskDir,
  recordRuling,
  rulingsFromReport,
  escalatedEffort,
  assertFinalReviewRoute,
  reworkUsedIn,
  briefingSourceFor,} from '../lib/state.mjs'

/** Cordis plugin name, matched by the preset row's `name`. */
export const name = 'fly-smart'

/**
 * Every service this row **reads** must be declared here.
 *
 * Cordis throws on an undeclared service *property access*
 * (`cannot get property "systemPrompt" without inject`), and a throw inside
 * `apply` is not a local failure: the preset mounts as one composition, so the
 * activation audit rejects the whole mount and sessions on this preset never
 * become composable. Measured on 0.1.7-rc.2 — the row used to declare only
 * `tools` while reading `ctx.systemPrompt`, which took the entire Fly preset
 * down (see docs/smart-mode-design.md §12.6).
 *
 * `tools` (registry), `commands` (`/smart`), `systemPrompt` (the mode-discipline
 * section). The capability seams the tools reach for later (`subagents`, the
 * hand-model route) are resolved through `ctx.get(name)`, which is the
 * un-injected reflector getter and therefore needs no declaration.
 */
export const inject = ['tools', 'commands', 'systemPrompt']

/** JSON tool output, rendered as text (the `fly-diag` shape). */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

/**
 * Mount the smart-mode tools.
 * @param ctx - cordis context of the preset's smart row.
 * @param rawConfig - row `config` (`{ enabled, rootDir, brainRoute, handRoute, maxRework, requireConsult }`).
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  // 行 rootDir 只允许在"我就是要压掉工作区根"的显式声明下使用（测试/无头）。少了
  // allowGlobalRoot 就**在挂载时**大声报错：静默压掉工作区根会让产物落到一个没人看的
  // 目录里，而那正是这次改造要消灭的失败模式（acceptance.md Y1/M7）。
  if (typeof config.rootDir === 'string' && config.rootDir.trim() !== '' && config.allowGlobalRoot !== true) {
    throw new Error(`smart(fly-smart): 行配置 rootDir=${JSON.stringify(config.rootDir)} 缺少 allowGlobalRoot: true —— 它会静默压掉每个会话的工作区根。测试/无头请显式写 allowGlobalRoot: true；产品会话请删掉 rootDir。`)
  }

  /** The mirror path this composition reads (fixed; see `lib/state.mjs`). */
  const mirrorPath = resolveMirrorPath()

  /**
   * The workspace a session says it is in — `session.header.cwd`, never
   * `process.cwd()` (the host's cwd is not the user's workspace; guessing there
   * would file tasks into the repository root).
   */
  const workspaceOf = exec => {
    const session = exec?.agent?.session
    const cwd = session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? { workspace: cwd, workspaceSource: 'session.header.cwd' } : null
  }

  /** Where a **new** task lands: preset row (guarded) → workspace → legacy. */
  const rootOf = exec => resolveTaskRoot({ config, session: exec?.agent?.session })

  /** Where an **existing** task is: disk scan across the candidates, else the write root. */
  const taskRootOf = (id, exec) => {
    const { roots } = candidateTaskRoots({ config, env: process.env, session: exec?.agent?.session })
    const found = locateTask(id, roots)
    return found === null ? rootOf(exec).root : found.root
  }

  /**
   * The hand route for **this call**, read fresh every time.
   *
   * Read lazily on purpose: the page writes the mirror while the session is live,
   * so a route captured at `apply()` would make "saved" and "in effect" two
   * different things — the user would change the model and the next consult would
   * still hand the work to the old one (`acceptance.md` S2b-1, A/B#2).
   */
  const routeOf = (role, exec) => {
    const found = role === 'review'
      ? currentReviewRoute({ config, session: exec?.agent?.session, mirrorPath })
      : currentHandRoute({ config, session: exec?.agent?.session, mirrorPath })
    if (found === null) {
      const field = role === 'review' ? 'review' : 'hand'
      // **可移植的文案**（2026-10-10 定）：这一行会随"模式包"装进别人的 profile，而那里
      // **不一定有我们的工作台抽屉**（`fly-smart-panel` 是宿主平面的另一个包，装不装由用户
      // 决定），所以指路的顺序必须反过来 —— 先给**行配置**（任何 profile 都有），再说面板
      // （有才用得上）；中英各一句（官方 profile 的界面是英文）。镜像路径照给：它是"未配置"
      // 这件事最具体的证据。
      const fallback = field === 'review' ? '（review 未配置时会回退到 hand：配好 hand 就能跑）' : ''
      throw new Error(
        `smart: no ${field} model is configured — 给 tool-fly-smart 的行配置加 ${field}Route: { provider, model }`
        + `（有 Fly 工作台时也可在右抽屉「Smart 工作流 → 三模型路由」里选）${fallback}；当前镜像：${mirrorPath}。`
        + ` 三个来源任选其一：① 行配置 tool-fly-smart 的 config.${field}Route: { provider, model }；`
        + `② 工作台「Fly → Smart」右上角的路由抽屉；`
        + `③ **没有面板时**手改镜像文件 ${resolveMirrorPath()}（JSON：{"${field}": {"provider": "…", "model": "…"}}）。`
        + ` drawer when present (mirror: ${mirrorPath}), then retry.`,
      )
    }
    return found
  }
  const handRouteOf = exec => routeOf('hand', exec)
  const reviewRouteOf = exec => routeOf('review', exec)

  // **按路由查**，不写死 brainRoute：升档用在 review/hand 上，而它们与 brain 可能是
  // 不同的模型 —— 拿 brain 的档位表去抬 review 的 effort，会造出该模型没有的档位名。
  const supportedEffortsOf = async (exec, forRoute) => {
    const route = forRoute ?? config.brainRoute
    const directories = ctx.get?.('modelDirectories')

    if (route === undefined || directories?.directoryFor === undefined) return undefined
    const sessionId = exec?.agent?.session?.id
    if (typeof sessionId !== 'string') return undefined
    const snapshot = await directories.directoryFor(sessionId)?.load?.()
    for (const group of snapshot?.groups ?? []) {
      if (group.id !== route.provider) continue
      for (const model of group.models ?? []) if (model.id === route.model) return (model.reasoning?.efforts ?? []).map(effort => effort.id)
    }
    return []
  }
  /**
   * Deliberately per-session with NO global fallback: a "last touched task"
   * shortcut would let one session write artifacts into another session's task,
   * which is exactly the kind of cross-talk this machine must not have. A call
   * without an active task either names its `taskId` or fails loudly.
   */
  const activeTasks = new WeakMap()

  const assertEnabled = exec => {
    if (!config.enabled) throw new Error('smart: smart mode is disabled for this row (set `enabled: true` in the fly-smart config)')
    // **子代理不许驱动工作流**（2026-10-20 补）：老宿主靠给孩子的 toolFilter 禁掉 smart_*，
    // 而 0.2.x 的 `startActivation` 请求里**没有** toolFilter 这个字段（只剩在冷恢复的描述符里），
    // 于是这层约束必须由插件自己守 —— 否则执行子代理能把门关了、把产物改了。
    // 判据用会话自己的血缘字段（不是"看起来像孩子"）：`origin === 'subagent'` 或 delegationDepth > 0。
    const header = exec?.agent?.session?.header
    const isChild = header?.origin === 'subagent'
      || (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0)
    if (isChild) {
      throw new Error('smart: this session is a subagent child — the workflow tools belong to the top-level session, not to a delegated child (the host no longer restricts a child\'s tool list, so the plugin refuses here)')
    }
  }

  /** Resolve the task a call refers to: explicit argument, else this session's. */
  const pickTaskId = (exec, args = {}) => {
    if (typeof args.taskId === 'string' && args.taskId.length > 0) return args.taskId
    const session = exec?.agent?.session
    if (session !== undefined) {
      const remembered = activeTasks.get(session)
      if (remembered !== undefined) return remembered
    }
    throw new Error('smart: no active task in this session — call smart_begin first, or pass `taskId`')
  }

  const remember = (exec, id) => {
    const session = exec?.agent?.session
    if (session !== undefined) activeTasks.set(session, id)
    return id
  }

  /** Fetch a capability seam, failing loudly with what to install instead. */
  const service = (name, what) => {
    const found = ctx.get(name)
    if (found === undefined) throw new Error(`smart: the ${what} service (\`${name}\`) is unavailable — smart mode needs it for this step`)
    return found
  }

  /** Flatten whatever a subagent returned into review text. */
  const outputText = value => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(part => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    if (value !== null && typeof value === 'object') return typeof value.text === 'string' ? value.text : JSON.stringify(value)
    return value === undefined || value === null ? '' : String(value)
  }

  /**
   * Smart's own tools, denied to every child we spawn.
   *
   * A child getting them could drive the machine (close its own gates, rewrite
   * artifacts) — the pair collaborates, but only the session's model holds the
   * workflow keys. Children still get the full capability surface for the *work*
   * (拍板 2: 执行与会话同权), which is exactly what this list does not touch.
   */
  /**
   * 门问询里 summary 的字数上限。它不是审美：上游的用户问询卡（QuestionComposer，
   * @deepseek-ai/dsh-client-ui-user-questions）把 question 渲染成卡片的**标题**，而标题所在的
   * header 既不收缩也不滚 —— 塞一整篇产物进去就会把正文（选项在这里）和提交按钮挤出卡的可见
   * 区域，用户看得到问题、却点不到任何东西（2026-10-01 实机）。超过上限就截断，并如实告诉
   * agent：完整正文本来就该落在产物里，产物在面板里可读。
   */
  const GATE_SUMMARY_LIMIT = 300

  /** 截断长 summary：优先在换行/句末断，别让用户停在半句话上。 */
  const capGateSummary = text => {
    const trimmed = text.trim()
    if (trimmed.length <= GATE_SUMMARY_LIMIT) return { text: trimmed, truncated: false }
    const cut = trimmed.slice(0, GATE_SUMMARY_LIMIT)
    const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('。'), cut.lastIndexOf('；'))
    const head = (boundary >= GATE_SUMMARY_LIMIT * 0.6 ? cut.slice(0, boundary + 1) : cut).trimEnd()
    return {
      text: `${head}…\n（摘要已截断：门问询只写决策所需的最短理由，完整正文见产物文件）`,
      truncated: true,
    }
  }

  const SMART_TOOL_NAMES = ['smart_begin', 'smart_artifact', 'smart_consult', 'smart_decide', 'smart_ruling', 'smart_gate', 'smart_execute', 'smart_verify', 'smart_rework', 'smart_finish', 'smart_brief', 'smart_brief_confirm']

  /** Evidence gathering may inspect the world, never mutate it (design §5). */
  const VERIFY_TOOL_DENY = [...SMART_TOOL_NAMES, 'write', 'edit', 'subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code']

  /**
   * 只读名单分两段：**必备**（智能工具面 + 写文件的工具）与**部署相关**（子代理后端不止一套：
   * 本仓闭包只暴露 `subagent_fork`，`subagent` / `subagent_codex` / `subagent_claude_code`
   * 属于别的后端）。分段的理由见 `verifyToolFilter()`。
   */
  const VERIFY_TOOL_DENY_CORE = [...SMART_TOOL_NAMES, 'write', 'edit']
  const VERIFY_TOOL_DENY_OPTIONAL = ['subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code']

  /**
   * 证据面的只读名单要按**本部署的视图**收敛一次。
   *
   * 症状：`smart_verify` 在只暴露 `subagent_fork` 的部署上第一步就死 —— 名单里的
   * `subagent` / `subagent_codex` / `subagent_claude_code` 不存在，而上游 `tools.restrict()`
   * （由 spawn 后端替我们调用）对**不存在的名字直接抛错**：
   * `tools.restrict() names unknown global tools "subagent", …; known global tools: …`。
   * 只读名单的本意是"证据面不许改世界"，不是"每种部署都得有这三个后端"。
   *
   * 收敛两条纪律：
   * ① **只丢部署相关的**——`write`/`edit`/智能工具面一个不丢；视图里连必备项都没有，说明这个
   *    视图不可信（不是"本部署没有 write 工具"），此时退回全名单（老行为），**绝不**收敛成
   *    `deny: []` 把证据面变成可写；
   * ② 收敛掉的名单走 debug 留痕，不静默。
   */
  const verifyToolFilter = agent => {
    const known = (() => {
      try { return ctx.tools?.view?.(agent)?.restrictableNames } catch { return undefined }
    })()
    if (known === undefined) return { deny: VERIFY_TOOL_DENY }
    if (VERIFY_TOOL_DENY_CORE.some(name => !known.has(name))) return { deny: VERIFY_TOOL_DENY }
    const dropped = VERIFY_TOOL_DENY_OPTIONAL.filter(name => !known.has(name))
    if (dropped.length > 0) ctx.logger?.debug?.(`smart: smart_verify 只读名单里 ${dropped.join(', ')} 在本部署不存在（视图里没有），已收敛`)
    return { deny: [...VERIFY_TOOL_DENY_CORE, ...VERIFY_TOOL_DENY_OPTIONAL.filter(name => known.has(name))] }
  }

  /**
   * Run one hand-route child and return its text.
   *
   * 上游契约（`@deepseek-ai/dsh-subagent` 的 `start(name, request)`；spawn 后端是
   * `dsh-subagent-spawn-in-process` + `dsh-subagent-in-process-driver`）：`start()`
   * 返回的是 **run 句柄** `{ id, localAgent, result, dispose }`，产出要 `await run.result`
   * 得 `{ output: [{ type: 'text', text }…], stopReason }`，取完按官方 settleRun 的姿势
   * `dispose()` 释放孩子。曾把整个句柄当结果丢进 JSON.stringify —— 句柄上挂着 Cordis
   * 代理（localAgent），序列化摸它 toJSON 直接炸 `cannot get property "toJSON" without
   * inject`；单测的 mock 一直返回 `{ output }`（与真契约不符），所以从没暴露。
   */
  /**
   * 起一个子代理并等它跑完。
   *
   * **宿主契约在 0.2.x 换过一次**（2026-10-20 现场：`subagents.start is not a function`）：
   * 现在是 `startActivation({ provider, label, request, signal, delivery })`，返回
   * `{ childId, result, dispose }`；老的 `start(name, request)` 已从服务面上消失。
   * 两条都留着：新宿主走 startActivation，老宿主走 start（plugin 会被装到别人的 profile 里，
   * 版本不由我们决定）。
   *
   * **代价要如实说**：新请求类型 `SubagentStartRequest` 里**没有** `toolFilter`（它只剩在
   * 冷恢复的描述符里）。所以新宿主上孩子**拿不到**「禁掉 smart_* 工具」这层约束 —— 这条
   * 写在 README 的已知限制里，不再假装它还生效。
   */
  const startChild = async (exec, { label, prompt, agentOptions, toolFilter }) => {
    const subagents = service('subagents', 'subagent registry')
    if (typeof subagents.startActivation === 'function') {
      const activation = await subagents.startActivation({
        provider: 'spawn',
        label,
        request: {
          prompt: [{ type: 'text', text: prompt }],
          parent: exec.agent,
          ...agentOptions === undefined ? {} : { agentOptions },
        },
        signal: exec.signal,
        // caller：只把结果交回调用方，不往父会话塞一条通知 —— 工具调用要的是同步结果。
        delivery: 'caller',
      })
      try {
        return await activation.result
      } finally {
        try { await activation.dispose() } catch { /* 释放失败不顶替结果判定 */ }
      }
    }
    // 老宿主（0.1.x）：start(name, request) → run 句柄。
    const run = await subagents.start('spawn', {
      label,
      prompt: [{ type: 'text', text: prompt }],
      parent: exec.agent,
      ...agentOptions === undefined ? {} : { agentOptions },
      ...toolFilter === undefined ? {} : { toolFilter },
      signal: exec.signal,
    })
    try {
      return await run.result
    } finally {
      try { await run.dispose() } catch { /* disposal failure is not the caller's verdict */ }
    }
  }

  const runHand = async (exec, { label, prompt, toolFilter, role = 'hand', phase = undefined, attempts = 0 }) => {
    // 每次调用现读（懒读）：页面保存的新路由必须在下一次 spawn 就生效。
    // `source`（preset/session/default/*-fallback）随结果带出：review 路由回落 hand 时，
    // 记录要如实标注 fallback，不能让"谁真的看了这份稿子"变成猜（acceptance B5）。
    const found = role === 'review' ? reviewRouteOf(exec) : handRouteOf(exec)
    let route = found.route
    const source = found.source
    // **终审不许回落**（G5 那一关的评审）：回落链最坏会跑到执行者用的那条上 —— 自己审自己。
    if (phase === 'reviewing') assertFinalReviewRoute(source)
    // **返工升档**：同一阶段反复修不好的点，让评审那侧看得更用力（提到该模型支持的最高档；
    // 查不到档位表就原样跑并如实标注，不猜、不造档位名）。
    const escalation = escalatedEffort(route, attempts, await supportedEffortsOf(exec, found.route))
    route = escalation.route
    const result = await startChild(exec, { label, prompt, agentOptions: route, toolFilter })
    if (result?.stopReason !== 'completed') {
      const detail = result?.diagnostic === undefined ? '' : `: ${result.diagnostic}`
      throw new Error(`smart: the hand model run "${label}" ended as "${result?.stopReason ?? 'no result'}"${detail}`)
    }
    const body = outputText(result.output)
    if (body.trim().length === 0) throw new Error(`smart: the hand model returned nothing for "${label}" — nothing was recorded`)
    return { route, source, body, escalated: escalation.escalated, attempts: escalation.attempts }
  }

  /**
   * The briefing brief: the draft is the whole context, the output is what the user
   * will be walked through in conversation. Structure is pinned so the mechanical
   * completeness check (`missingBriefingSections`) has something to check against.
   */
  /**
   * 派发上下文卫生（一份答案，五条 prompt 共用）。
   *
   * 源自 superpowers 记的那次事故：*"一次真实派发 42k 字符，99% 是粘贴的历史"* ——
   * 子代理的 prompt 与它回的正文都常驻父会话上下文、每轮重读。两条约束：
   * ① 不自派子代理（评审是**你的活**，不是你雇的人）；② 大输出走文件，回正文只给结论与路径。
   *
   * 另有工具层兜底：子会话调用任何 `smart_*` 一律拒绝（`assertEnabled`）。
   */
  const DISPATCH_HYGIENE = [
    'Working contract (how you work, not what you build): do not dispatch subagents — not helpers, not reviewers; review is your job, not someone you hire. Put bulk output in files, not in your reply: your reply is re-read on every later turn of the parent session, so report conclusions and the paths that prove them, not the transcripts themselves.',
  ]

  const briefingPrompt = ({ state, phase, draft }) => [
    `You are the *review* model in a three-model workflow, writing a **briefing**: what the user needs to know about one phase artifact so the presenting model can walk them through it in plain conversation before their gate. The reader is the USER — a person deciding, not a model executing. Your own verdict belongs in the consult record, not here.`,
    '',
    `Task: ${state.title}`,
    state.goal === '' ? '' : `Goal: ${state.goal}`,
    '',
    `--- ${ARTIFACT_FILE[phase]} ---`,
    draft.trimEnd(),
    '--- end ---',
    '',
    'Write the briefing in the user\'s language (Chinese artifacts ⇒ Chinese briefing), as markdown:',
    '1. Start with a line `覆盖章节：…` naming **every** section heading of the artifact above (## and deeper) — that line is machine-checked, keep it exact. Everything after it is for the user.',
    '2. Then explain the artifact in **user-facing language**: plain sentences a person can follow without having read the artifact and without knowing its vocabulary. Translate artifact-internal shorthand — clause IDs (like A1–A11), file and tool names, test counts, gate names — into what they mean for this decision. Do NOT organize the prose by the artifact\'s internal labels and do NOT write in checklist/audit voice; organize it by what the user must decide.',
    '3. For each part of the story, distinguish 已定 (settled in the draft) / 建议 (the draft recommends, still theirs to accept) / 未决 (open questions only they can answer). Name the critical details — key parameters, the real risks, what would break acceptance — in words that show consequence for the user, not in checklist vocabulary.',
    '4. End with at most 3 questions the user should answer before confirming, phrased as questions to a person.',
    '',
    'Be specific and complete over long: the user decides from this and the conversation, not from the raw draft. No praise.',
    ...DISPATCH_HYGIENE,
  ].filter(line => line !== '').join('\n')

  /** optimized：把 plan 与伴随 acceptance 拼成一份给 review 的正文。 */
  const artifactForReview = (rootDir, id, phase) => {
    const main = readArtifact(rootDir, id, phase) ?? ''
    const companion = companionFileOf(phase)
    if (companion === null) return main
    let extra = ''
    try {
      extra = readFileSync(join(taskDir(rootDir, id), companion), 'utf8')
    } catch {
      extra = ''
    }
    return extra === '' ? main : `${main.trimEnd()}\n\n--- ${companion} ---\n${extra.trimEnd()}`
  }

  const BUNDLE_MARKERS = { briefing: '=== BRIEFING ===', consult: '=== CONSULT ===' }

  /**
   * 一次 review child 出两段：先给用户的要点，再给模型的可行性评审。
   *
   * 两段用**固定分隔行**隔开，解析时要求两段都非空 —— 缺一段就是格式违约，整次失败
   * （fail closed）：宁可让模型重跑一次，也不能把"只有评审、没有要点"的半套结果落盘。
   */
  const bundlePrompt = ({ state, phase, draft, question }) => [
    `You are the *review* model in a three-model workflow. Produce **two** outputs for the ${phase} artifact below, in one reply.`,
    '',
    `Task: ${state.title}`,
    state.goal === '' ? '' : `Goal: ${state.goal}`,
    '',
    `--- ${ARTIFACT_FILE[phase]} ---`,
    draft.trimEnd(),
    '--- end ---',
    '',
    `Reply with exactly these two sections, each starting with its marker line, in this order:`,
    BUNDLE_MARKERS.briefing,
    'What the USER needs to know, in plain user-facing language: name every section heading of the artifact on a first `覆盖章节：…` line (machine-checked), then explain 已定 / 建议 / 未决 and the details that change the decision. At most 3 questions to the user. No audit voice.',
    BUNDLE_MARKERS.consult,
    question === undefined || question.trim() === '' ? 'Your feasibility review for the model that will execute: blocking problems first, then concrete additions. Be specific.' : question.trim(),
    '',
    'Do not omit either marker. No praise, no restating the artifact.',
    ...DISPATCH_HYGIENE,
    '',
  ].filter(line => line !== '').join('\n')

  /** 解析两段；缺段/空段 ⇒ 抛错（调用方保证产物不动、可重试）。 */
  const parseBundle = body => {
    const text = String(body ?? '')
    const briefingAt = text.indexOf(BUNDLE_MARKERS.briefing)
    const consultAt = text.indexOf(BUNDLE_MARKERS.consult)
    if (briefingAt === -1 || consultAt === -1 || consultAt < briefingAt) {
      throw new Error('smart: the review reply is missing one of the two sections (=== BRIEFING === / === CONSULT ===); nothing was recorded — retry')
    }
    const briefingBody = text.slice(briefingAt + BUNDLE_MARKERS.briefing.length, consultAt).trim()
    const consultBody = text.slice(consultAt + BUNDLE_MARKERS.consult.length).trim()
    if (briefingBody === '' || consultBody === '') throw new Error('smart: one section of the review reply is empty; nothing was recorded — retry')
    return { briefingBody, consultBody }
  }

  /** The review brief for the hand model: the draft is the whole context. */
  const consultPrompt = ({ state, phase, draft, question }) => [
    `You are the *review* model in a three-model workflow (brain designs, you review, hand executes). Review the ${phase} artifact below for execution feasibility and say what would break.`,
    '',
    `Task: ${state.title}`,
    state.goal === '' ? '' : `Goal: ${state.goal}`,
    '',
    `--- ${ARTIFACT_FILE[phase]} ---`,
    draft.trimEnd(),
    '--- end ---',
    '',
    question === undefined || question.trim() === '' ? 'Review it: what is missing, wrong, or unexecutable? Be concrete.' : question.trim(),
    '',
    ...DISPATCH_HYGIENE,
    '',
    'Answer in markdown. Lead with blocking problems, then concrete additions. No praise, no restating the draft.',
  ].filter(line => line !== '').join('\n')

  /** The executor's briefing: the plan and the acceptance contract, nothing else. */
  const executePrompt = ({ state, plan, acceptance, instructions }) => [
    'You are the *hand* model executing an approved plan. The design is settled; your job is to carry it out and report honestly what happened.',
    '',
    `Task: ${state.title}`,
    state.goal === '' ? '' : `Goal: ${state.goal}`,
    '',
    '--- plan.md ---',
    plan.trimEnd(),
    '--- end plan ---',
    '',
    '--- acceptance.md (what will be checked) ---',
    acceptance.trimEnd(),
    '--- end acceptance ---',
    '',
    instructions === undefined || instructions.trim() === '' ? '' : `Extra instructions for this run: ${instructions.trim()}`,
    '',
    'Work through the plan step by step with your tools. Then report in markdown:',
    '1. each plan step with its outcome (done / skipped / failed) and the evidence (paths, commands, output);',
    '2. anything you had to deviate from, and why;',
    '3. what you did NOT do and what remains.',
    'Do not summarise the plan back at me, and do not claim success you did not observe.',
    '',
    'Working contract (these are about how you work, not what you build):',
    ...DISPATCH_HYGIENE,
    '- A worker-spawned reviewer is a duplicate seat reviewing the same diff — a defect to flag, not rigor. Review arrives after your report.',
    '- **When the plan is wrong, decide and record, do not stall.** A plan defect, an ambiguity, a conflict with the spec — settle it yourself and keep going. Record each one under a `## Rulings` heading as `- **<what you decided>** — <why> — <what it costs if wrong>`. Three parts or it will be dropped. A wrong ruling is rework your human can see and undo; a session parked on a question costs their day and buys nothing.',
    '- **Four things stop you, and only these:** an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree that norms say you ask about first; and a plan so broken that every path forward is a guess.',
  ].filter(line => line !== '').join('\n')

  /** The verifier's briefing: an adversarial check against the acceptance contract. */
  const verifyPrompt = ({ state, acceptance, report, focus }) => [
    'You are the *review* model gathering acceptance evidence — independent of the executor who wrote the report below. You did not write the acceptance criteria and you are not here to be agreeable: your job is to find out whether each criterion is actually met, by inspection.',
    '',
    `Task: ${state.title}`,
    state.goal === '' ? '' : `Goal: ${state.goal}`,
    '',
    '--- acceptance.md (the contract) ---',
    acceptance.trimEnd(),
    '--- end acceptance ---',
    '',
    ...DISPATCH_HYGIENE,
    '',
    '--- execution report (what the executor claims) ---',
    report.trimEnd(),
    '--- end report ---',
    '',
    focus === undefined || focus.trim() === '' ? '' : `Concentrate on: ${focus.trim()}`,
    '',
    'You have inspection tools only — no file writes, no edits. Treat the execution report as a claim to be checked, not evidence.',
    'For each acceptance criterion report: id/label · PASS or FAIL · the exact command or file you inspected · what you observed.',
    'End with a list of criteria you could NOT verify and why. If a criterion is unverifiable by inspection, say so instead of guessing.',
  ].filter(line => line !== '').join('\n')

  const summary = (rootDir, id, extra = {}) => {
    const status = taskStatus(rootDir, id, { requireConsult: config.requireConsult, maxRework: config.maxRework })
    return JSON.stringify({ taskId: id, rootDir, ...status, ...extra }, null, 2)
  }

  /**
   * Sessions with smart mode switched on (via `/smart`).
   *
   * The mechanical state machine is always available through the tools; this flag
   * is what makes the *workflow discipline* part of the model's brief. Without it
   * the tools are just nine more names in the registry.
   */
  const smartOn = new WeakMap()
  const isOn = session => session !== undefined && smartOn.get(session) === true

  const SECTION = [
    'Smart mode is active for this session: run the task as a three-model workflow — design, then execute, then accept.',
    '',
    'Discipline (the tools enforce the mechanical parts; these are the parts only you can honour):',
    '1. Open the task with smart_begin, then work the design phases in order: brainstorm → design → plan → acceptance. Write each artifact with smart_artifact and stop at its gate. **plan.md carries a document contract the gate enforces** (see the `smart-plan` skill): every task block declares its own `**Interfaces:**` with `Consumes` / `Produces` signatures, the document has a `## Global Constraints` section (the project-wide rules the spec fixes, copied verbatim) and a `## Review Focus` section (the input classes the spec implies but no task exercises in its tests). Missing any of them, G3 will not open — that is the floor for "another model can execute this from these files alone". The artifact contract differs per phase: brainstorm is a **decision table** (problem / candidates / current lean / open questions) that is explicitly NOT yet approved; design turns the accepted choice into an **ADR-lite** section (context, options, decision and why, consequences, revisit trigger) — the decision record belongs where the choice is made, not in the phase that was still exploring.',
    '1b. Under the optimized workflow the brainstorm phase spawns no review child: you write its user-facing digest yourself and pass it as smart_artifact\'s `briefing` argument (provenance is recorded as brain/session, never as an independent review). Every later phase keeps the review route.',
    '2. Before every gate, call smart_consult so the review model audits that phase for execution feasibility. Reviews are cheap; discovering an unexecutable plan after execution is not.',
    '3. **Settle what you can decide yourself; put to the user only what only they can decide.** A plan defect, an ambiguity, a conflict with the spec — decide it, record it with `smart_ruling` (`Ruling: what — why — what it costs if wrong`, all three parts), and keep going. A session parked on a question costs the user their day and buys nothing; a wrong ruling is rework they can see and undo. Before a gate, settle what only the user can decide: put those questions to them with smart_decide (the same option card, recorded), fold the answers into the artifact as an 已裁决 section, and re-record it. A draft that still carries a 需要你裁决 section does not open its gate at all — the recommendation you wrote must not silently become their decision.',
    '4. After every artifact lands (including the execution report and the review), a briefing is generated for it (smart_artifact does this; smart_brief only retries a failed one). Walk the user through that briefing **in ordinary conversation** — the key points and the critical details, section by section — and leave room for their questions and requested changes. Discussing is not approving: nothing you say, and nothing they say in chat, opens anything.',
    '5. When the discussion settles, call smart_brief_confirm. It pops one short card and only that card\'s real answer opens the phase gate (or moves execution into review). If the user wants changes, they answer 需要修改 — re-record the artifact and the briefing regenerates; that loop costs no rework budget.',
    '6. Call smart_gate to put the gate to the user, with a short summary of the risks and open questions. The ask card renders that summary as its heading, and a page of it pushes the options off the card — keep it to a few lines (the tool truncates past 300 characters and says so), and put the long version in the artifact, which the panel can show. Never treat your own judgement, or a passing remark, as their approval — the gate records their actual answer.',
    '7. Do not execute before the user passes gate G4. When they do, smart_execute hands the approved plan to the hand model; you stay out of the execution itself. The execution report gets its own briefing and confirmation before the task moves to review.',
    '8. After execution, gather evidence with smart_verify, then write your own verdict as the review artifact and put gate G5 to the user.',
    '9. If the user or the evidence sends the work back, use smart_rework (or the rework option on the gate) — superseded versions are archived, never rewritten in place. Finish with smart_finish once G5 passes.',
    '',
    'Keep the artifacts honest and specific: another model has to execute them from those files alone, with no access to this conversation.',
  ].join('\n')

  if (config.enabled) {
    // 座位在本文件的 `inject` 里声明；未声明的服务属性访问会抛，抛 = 整棵 preset 挂载被拒。
    ctx.systemPrompt.section({
      name: 'fly-smart:policy',
      // 500 = PLAN_POLICY、600 = TEAM_POLICY 之间：模式纪律挨着模式纪律。
      order: 550,
      text: context => (context?.agent !== undefined && isOn(context.agent.session) ? SECTION : ''),
    })

    // 官方 `/goal` 的形状（`dsh-command-goal/lib/index.js`）：宿主平面的 `commands`
    // 注册表 + 本行 ctx 的 scoped layer，handler 从 invocation 拿 agent。
    ctx.commands.register({
      definitionId: 'dsh-plugin-fly-smart',
      name: 'smart',
      description: 'Enter or leave smart mode (design with the brain model, execute with the hand model)',
      input: { hint: '[off|task]', attachments: true },
      handler: ({ agent, rawInput, attachments = [] }) => {
        const message = String(rawInput ?? '').trim()
        if (message === 'off') {
          if (attachments.length > 0) return { kind: 'error', text: 'Attachments cannot accompany /smart off.' }
          if (!isOn(agent?.session)) return { kind: 'success', text: 'Smart mode is already off.' }
          if (agent?.session !== undefined) smartOn.delete(agent.session)
          return { kind: 'success', text: 'Smart mode off. Any task already on disk stays where it is (see smart_status).' }
        }
        // 与 plan mode 互斥：两个模式都要主导"先说清楚再动手"，同时开只会互相打架。
        const planMode = ctx.get?.('planMode')
        const planState = planMode?.get?.(agent)
        if (planState === true || planState?.active === true) {
          return { kind: 'error', text: 'Plan mode is active — run /plan off first, then /smart on.' }
        }
        if (agent?.session !== undefined) smartOn.set(agent.session, true)
        if (message !== '' || attachments.length > 0) {
          agent.steer(createUserMessage({
            content: [...attachments, ...message === '' ? [] : [{ type: 'text', text: message }]],
            source: { kind: 'user' },
          }))
        }
        return {
          kind: 'success',
          text: [
            'Smart mode on: design (you) → execute (hand model) → accept (both), with a user gate after every design phase.',
            message === '' ? 'Describe the task, or call smart_begin with the title and goal.' : 'Treating the message above as the task — call smart_begin, then work the design phases.',
            'Use /smart off to leave.',
          ].join(' '),
        }
      },
    })
  }

  ctx.tools.register(defineTool({
    name: 'smart_begin',
    description: 'Open a smart-mode task: create its record and enter the brainstorm phase. Smart mode runs a three-model workflow — this session\'s model designs (brainstorm → design → plan → acceptance, each confirmed by the user), the review route briefs and audits, a subagent on the configured hand route executes, then the pair accepts. Use it when the user asks for a smart-mode run or a task big enough to deserve design-before-execution.',
    parameters: {
      title: { type: 'string', description: 'Short task title (also the default task id slug).' },
      shape: {
        type: 'string',
        enum: ['feature', 'fix', 'review', 'investigation'],
        description: 'What this task is. It decides which phases this task walks: `feature` = the full six (brainstorm → design → plan → acceptance → executing → reviewing); `fix` = brainstorm → plan → executing → reviewing (no design phase — a fix does not need a second exploration); `review` = reviewing only (produce review.md, no G1–G4); `investigation` = brainstorm only (a conclusion, no execution). Default `feature` = the historical behaviour. Recorded with the task: changing the row config later does not re-shape an in-flight task.',
      },
      size: {
        type: 'string',
        enum: ['light', 'standard', 'full'],
        description: 'Cost tier. `light` writes every design phase\'s user-facing digest yourself (the brain) — **zero review children**; `standard` and `full` dispatch one per phase. Orthogonal to `shape`: shape is how many steps, size is what each step costs. Default `full` = the historical behaviour.',
      },
      goal: { type: 'string', description: 'What done looks like, in one or two sentences.' },
      brainstormDepth: { type: 'string', description: 'Optional user-selected depth for brainstorm: light | balanced | deep | exhaustive. Choose based on project type and risk.' },
       taskId: { type: 'string', description: 'Optional explicit id (letters, digits, dot, dash, underscore).' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      // 任务根按**本次调用**解析：preset 行（显式 allowGlobalRoot）→ 本会话工作区
      // （session.header.cwd）→ legacy。绝不用 process.cwd()：宿主 cwd 不是用户工作区。
      const rootDir = rootOf(exec).root
      const where = workspaceOf(exec)
      const brainstormDepth = args.brainstormDepth ?? config.brainstormDepth ?? 'balanced'
      const supportedEfforts = await supportedEffortsOf(exec)
      const effort = resolveBrainstormEffort(brainstormDepth, supportedEfforts)
      const brainRoute = config.brainRoute === undefined ? undefined : { ...config.brainRoute, reasoningEffort: effort.reasoningEffort }
      const state = createTask(rootDir, args, { ...where ?? {}, maxRework: config.maxRework, workflow: config.workflow, shape: args.shape, size: args.size, brainstormDepth: effort.depth, brainstormEffort: effort.reasoningEffort, brainRoute })
      remember(exec, state.id)
      return summary(rootDir, state.id, {
        created: true,
        rootSource: rootOf(exec).source,
        workspace: where?.workspace ?? null,
        workspaceSource: where?.workspaceSource ?? null,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_artifact',
    description: 'Record one smart-mode phase artifact (markdown) and open that phase\'s user gate. Phases are ordered and enforced in code: brainstorm → design → plan → acceptance → (executing) → (reviewing). Writing a later phase before finishing the current one, or writing while a gate is open, fails loudly. The user confirms each gate before the workflow moves on.',
    parameters: {
      phase: {
        type: 'string',
        description: 'Which artifact: brainstorm | design | plan | acceptance | executing (execution report) | reviewing (review).',
        enum: ['brainstorm', 'design', 'plan', 'acceptance', 'executing', 'reviewing'],
      },
      markdown: { type: 'string', description: 'The full artifact body, markdown. Per-phase content contract, **enforced at write time** (not only at the gate): brainstorm is a decision table (problem / candidates / current lean / open questions); design is an ADR-lite section; **plan.md must carry the document contract** — an "**Interfaces:**" block in EVERY task (with `Consumes` / `Produces` signatures), a "## Global Constraints" section (the project-wide rules the spec fixes, copied verbatim), and a "## Review Focus" section (the input classes the spec implies but no task exercises). Missing any of these and the write is refused with the list. See the `smart-plan` skill.' },
      acceptanceMarkdown: {
        type: 'string',
        description: 'Required for `phase: "plan"` under the optimized workflow: the acceptance design. The two files are written together and reviewed by one child, so this phase replaces the separate acceptance gate. Leave it out everywhere else.',
      },
      briefing: {
        type: 'string',
        description: 'Optional: the user-facing digest of this artifact, written by you (the brain). Required for brainstorm under the optimized workflow, which spawns no review child for that phase; on every other phase leave it out — the review route writes that digest (and a passing one here would be ignored).',
      },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      // optimized 的 plan 相位：计划与验收设计是**一次操作**（两文件一起写、一起评）。
      // 相位名仍是 plan，相位表不动；v1 的任务永远走下面那条老路。
      const needsPair = (() => {
        const current = readState(rootDir, id)
        return current?.workflow === 'optimized' && args.phase === 'plan'
      })()
      if (needsPair) {
        if (typeof args.acceptanceMarkdown !== 'string' || args.acceptanceMarkdown.trim() === '') {
          throw new Error('smart: the optimized workflow records plan.md and acceptance.md together — pass `acceptanceMarkdown` with the acceptance design (this phase replaces the separate acceptance gate)')
        }
        const paired = recordPlanAcceptance(rootDir, id, args.markdown, args.acceptanceMarkdown)
        remember(exec, id)
        const briefResult = await (async () => {
          try {
            return await briefArtifact(exec, { rootDir, id, phase: 'plan' })
          } catch (error) {
            return { briefingFailed: true, error: String(error?.message ?? error), nextStep: 'the pair is on disk but its review bundle failed — retry with smart_brief' }
          }
        })()
        return summary(rootDir, id, {
          recorded: 'plan',
          pairedWith: 'acceptance.md',
          awaitingGate: paired.awaitingGate,
          ...briefResult.briefingFailed === true
            ? { briefingFailed: true, briefingError: briefResult.error, nextStep: briefResult.nextStep }
            : { briefing: briefResult.briefing, briefingRound: briefResult.round, consult: briefResult.consult, bundled: briefResult.bundled === true, nextStep: 'walk the user through the briefing in conversation, then call smart_brief_confirm — one confirmation covers both plan.md and acceptance.md' },
        })
      }
      const state = recordArtifact(rootDir, id, args.phase, args.markdown)
      remember(exec, id)
      // optimized 工作流的 brainstorm **不派 review 子代理**：候选方案阶段还没有可执行性可审，
      // 那一次评审是纯开销。要点由 brain 自己写（`briefing` 参数），记成 `brain/session` 来源。
      const inline = typeof args.briefing === 'string' && args.briefing.trim() !== '' ? args.briefing : undefined
      // 谁写用户要点：`size: 'light'` 的设计相位与 optimized 的 brainstorm 都由 brain 自写
      // （零 review child）—— 判据集中在 `briefingSourceFor`，不散在各处。
      const brainBriefs = briefingSourceFor(state, args.phase) === 'inline'
      // 产物落盘即自动生成 briefing（acceptance A1）：这条路是主路径，smart_brief 只做
      // 失败重试/旧任务补生成。生成失败**不冒泡**成落盘失败 —— 产物永远保留（A2）。
      let brief
      if (brainBriefs && inline === undefined) {
        brief = {
          briefingRequired: true,
          nextStep: `这一步（${args.phase}）的用户版要点由你（brain）写：把要点放进 \`briefing\` 参数，用同一份 markdown 再调一次 smart_artifact —— 记成 brain/session 来源、不派 review 子代理（${state.size === 'light' ? 'light 成本档' : 'optimized 工作流'}）。要点必须逐个点到产物的每个 ## 小节。`,
        }
      } else {
        try {
          brief = await briefArtifact(exec, { rootDir, id, phase: args.phase, inline: brainBriefs ? inline : undefined })
        } catch (error) {
          brief = {
            briefingFailed: true,
            error: String(error?.message ?? error),
            nextStep: `the artifact is on disk but its briefing is incomplete — fix the review output and retry with smart_brief`,
          }
        }
      }
      const pending = state.pendingDecisions ?? null
      return summary(rootDir, id, {
        recorded: args.phase,
        awaitingGate: state.awaitingGate,
        ...brief.briefingFailed === true
          ? { briefingFailed: true, briefingError: brief.error, nextStep: brief.nextStep }
          : brief.briefingRequired === true
            ? { briefingRequired: true, nextStep: brief.nextStep }
            : {
              briefing: brief.briefing,
              briefingRound: brief.round,
              // bundle 路径同时已经把 consult 落盘了：返回里如实带上，模型不必再调 smart_consult。
              ...brief.consult === undefined ? {} : { consult: brief.consult, bundled: brief.bundled === true },
              nextStep: 'walk the user through the briefing in conversation (key points + critical details, leave room for questions), then call smart_brief_confirm — discussion does not open the gate',
            },
        // 没开门前必须说清为什么、下一步做什么：产物里还留着只有用户能定的问题。
        ...pending === null ? {} : {
          decisionsPending: pending.items,
          decisionsPendingStep: `${ARTIFACT_FILE[args.phase]} still has ${pending.items} unanswered decision(s) under "${pending.headings.join(' / ')}" — put them to the user with smart_decide (option cards), fold the answers in (rename that section to 已裁决 and write what they chose), then record the artifact again; gate ${GATE_AFTER[args.phase] ?? '?'} opens only after that`,
        },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_consult',
    description: 'Ask the hand model (the configured handRoute — the model that will execute) to review the current design-phase draft before its gate. The review route audits each design-phase draft for execution feasibility (the briefing is a separate tool, smart_brief): the brain writes brainstorm/design/plan/acceptance, the review model checks each before its gate. Requires that phase\'s artifact to exist; the review is recorded so the gate can prove it happened.',
    parameters: {
      question: { type: 'string', description: 'Optional specific question for the reviewer; defaults to "what is missing, wrong, or unexecutable?".' },
      phase: { type: 'string', description: 'Optional phase to review; defaults to the task\'s current phase.', enum: [...DESIGN_PHASES] },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      const phase = args.phase ?? state.phase
      // 前置条件先查完，再花子代理的钱：对一份还没写的草稿做评审没有意义。
      if (!DESIGN_PHASES.includes(phase)) throw new Error(`smart: consults cover the design phases (${DESIGN_PHASES.join(', ')}), not "${phase}"`)
      if (state.phase !== phase) throw new Error(`smart: task "${id}" is in phase "${state.phase}"; the "${phase}" review comes with its own phase`)
      const draft = readArtifact(rootDir, id, phase)
      if (draft === null) throw new Error(`smart: write ${ARTIFACT_FILE[phase]} before asking for a review of it`)
      // optimized：上一次 bundle 若仍绑着**这份**产物，consume 它，不再起第二个 child ——
      // 这正是"两次 review 调用合成一次"的另一半。
      if (state.workflow === 'optimized' && BUNDLE_PHASES.includes(phase)) {
        const bundle = freshReviewBundle(rootDir, state, phase)
        if (bundle !== null) {
          const recorded = readConsult(rootDir, id, phase)
          if (recorded !== null) {
            return summary(rootDir, id, {
              consulted: phase,
              reviewer: `${bundle.provider}/${bundle.model}`,
              review: recorded.body,
              bundleHit: true,
              nextStep: 'this consult came from the same review child as the briefing (no extra spawn); decide whether to fold anything into the artifact',
            })
          }
        }
        // 没有 fresh bundle（要点生成失败/产物改过）：自己跑一次 bundle，两段一起补齐。
        const produced = await runReviewBundle(exec, { rootDir, id, phase, question: args.question })
        return summary(rootDir, id, {
          consulted: phase,
          reviewer: produced.bundleRoute ?? null,
          review: produced.consult,
          bundleHit: false,
          briefingRound: produced.round,
          nextStep: 'walk the user through the briefing in conversation, then record their answer with smart_brief_confirm',
        })
      }
      const { route, body } = await runHand(exec, {
        label: `smart consult · ${phase}`,
        prompt: consultPrompt({ state, phase, draft, question: args.question }),
        toolFilter: { deny: SMART_TOOL_NAMES },
        role: 'review',
        phase,
        attempts: reworkUsedIn(state, phase),
      })
      recordConsult(rootDir, id, phase, { provider: route.provider, model: route.model, question: args.question ?? '', body })
      return summary(rootDir, id, { consulted: phase, reviewer: `${route.provider}/${route.model}`, review: body })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_decide',
    description: 'Put the decisions only the user can make to them — on the same option card the gate uses — and record their answers in the task tree. Call it whenever a design-phase artifact would otherwise carry open questions (a "需要你裁决" section): those questions are the user\'s to answer, your recommendation must not silently become their decision, and the gate does not open while that section is there. After it returns, fold the answers into the artifact, rename the section to 已裁决 (one line per question: what the user chose), and record the artifact again with smart_artifact.',
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'The decisions to put to the user, in the order they should be answered. Only ask what only they can decide — anything you can settle yourself does not belong here.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            question: { type: 'string', required: true, description: 'The decision, phrased so the user can answer it by choosing.' },
            options: {
              type: 'array',
              description: 'Optional choices to show. If you recommend one, put it first and append "(Recommended)" to that label.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                  description: { type: 'string', description: 'One sentence explaining the tradeoff.' },
                },
              },
            },
            multiSelect: { type: 'boolean', description: 'Set when the user may choose several options at once.' },
          },
        },
      },
      phase: { type: 'string', description: 'Optional; the phase these decisions belong to (defaults to the task\'s current phase).' },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      const phase = typeof args.phase === 'string' && args.phase.trim() !== '' ? args.phase.trim() : state.phase
      if (!DESIGN_PHASES.includes(phase) && phase !== 'reviewing') {
        throw new Error(`smart: phase "${phase}" does not take decisions (the four design phases and reviewing do)`)
      }
      const questions = (Array.isArray(args.questions) ? args.questions : []).filter(item => typeof item?.question === 'string' && item.question.trim() !== '')
      if (questions.length === 0) throw new Error('smart: smart_decide needs at least one question with a non-empty `question`')
      const outgoing = questions.map((item, index) => ({
        id: `smart-decide-${phase}-${index + 1}`,
        header: `smart · ${phase} 裁决`,
        question: item.question.trim(),
        // 选项只收 { label, description? }（schema 就是这么声明的，且 describeTool 会真的校验：
        // 传字符串当场 ToolArgsError）—— 不做"顺手也认字符串"的宽容分支，那是够不到的死代码。
        ...Array.isArray(item.options) && item.options.length > 0
          ? { options: item.options.map(option => ({ label: option.label, ...option.description === undefined ? {} : { description: option.description } })) }
          : {},
        multi_select: item.multiSelect === true,
      }))
      const userQuestions = service('userQuestions', 'user-question')
      const asked = await userQuestions.ask({
        questions: outgoing,
        ...exec.agent === undefined ? {} : { agent: exec.agent },
        signal: exec.signal,
      })
      // 按 id 收回答案：用户可能只答了一部分（引擎允许跳过），缺的照实记成空 —— 不替用户回答。
      const byId = new Map((asked?.answers ?? []).map(answer => [answer?.id, answer]))
      const answers = outgoing.map(item => {
        const answer = byId.get(item.id) ?? {}
        return {
          question: item.question,
          options: (item.options ?? []).map(option => option.label),
          multiSelect: item.multi_select,
          selected: [...answer.selected ?? []],
          custom: (answer.custom ?? '').trim(),
        }
      })
      recordDecisions(rootDir, id, phase, answers, { by: 'user' })
      remember(exec, id)
      const open = openDecisions(readArtifact(rootDir, id, phase))
      return summary(rootDir, id, {
        decided: phase,
        decisions: answers.map(entry => ({ question: entry.question, answer: [...entry.selected, entry.custom].filter(part => part !== '').join(' · ') || '(未作答)' })),
        ...open.headings.length === 0 ? {} : {
          nextStep: `把裁决并进 ${ARTIFACT_FILE[phase]}：把「需要你裁决」那一节改成「已裁决」，逐条写下用户的选择，然后重新 smart_artifact 落盘 —— 这一节消失之前门不会开`,
        },
      })
    },
  }))

  /**
   * Generate one briefing round for a phase artifact (design §briefing).
   *
   * Failure semantics (acceptance A2), exactly three kinds:
   *   - review child fails / returns nothing ⇒ `{ briefingFailed }` **returned** (the
   *     artifact is fine; generation is retryable) — failure marker is recorded;
   *   - completeness violation ⇒ **throws**, listing what the briefing skipped —
   *     a digest that skips a section is worse than none (it reads as coverage);
   *   - no artifact ⇒ the caller's precondition throw.
   */
  /**
   * optimized 的哪些阶段把「要点 + consult」合成一次 bundle：
   * 正好是那些**必须有 consult** 的设计阶段。brainstorm 走 brain 自写，executing/reviewing
   * 没有独立 consult，三者都不进 bundle。
   */
  const BUNDLE_PHASES = ['design', 'plan', 'acceptance']

  /** 跑一次 bundle child：一次调用同时拿到用户要点与可行性评审。 */
  const runReviewBundle = async (exec, { rootDir, id, phase, question }) => {
    const state = readState(rootDir, id)
    const draft = artifactForReview(rootDir, id, phase)
    const produced = await runHand(exec, {
      label: `smart bundle · ${phase}`,
      prompt: bundlePrompt({ state, phase, draft, question }),
      toolFilter: { deny: SMART_TOOL_NAMES },
      role: 'review',
      phase,
      attempts: reworkUsedIn(state, phase),
    })
    const { briefingBody, consultBody } = parseBundle(produced.body)
    const next = recordReviewBundle(rootDir, id, phase, {
      provider: produced.route.provider,
      model: produced.route.model,
      source: produced.source,
      briefingBody,
      consultBody,
      question: question ?? '',
    })
    return {
      briefing: briefingBody,
      consult: consultBody,
      source: produced.source,
      bundleRoute: `${produced.route.provider}/${produced.route.model}`,
      round: next.briefings[phase].current,
      bundled: true,
    }
  }

  const briefArtifact = async (exec, { rootDir, id, phase, inline = undefined }) => {
    const state = readState(rootDir, id)
    const draft = readArtifact(rootDir, id, phase)
    if (draft === null) throw new Error(`smart: write ${ARTIFACT_FILE[phase]} before briefing it`)
    // inline（brain 自写）与 review 生成走**同一条**完整性检查与落轮路径，只在来源上不同：
    // 没有 provider/model 的轮必须如实标注 brain/session，不能伪装成独立评审（acceptance B5）。
    if (typeof inline === 'string' && inline.trim() !== '') {
      const missing = missingBriefingSections(draft, inline)
      if (missing.length > 0) {
        const error = new Error(`smart: the briefing for "${phase}" does not cover the artifact — missing: ${missing.join('; ')}. Nothing was recorded; cover every section.`)
        recordBriefingFailure(rootDir, id, phase, error)
        throw error
      }
      const next = recordBriefing(rootDir, id, phase, { provider: null, model: null, source: 'brain/session', body: inline })
      return { briefing: inline, source: 'brain/session', round: next.briefings[phase].current, brainAuthored: true }
    }
    // optimized：design/plan/acceptance 用**一次** child 同时出要点与 consult。
    const workflow = readState(rootDir, id)?.workflow
    if (workflow === 'optimized' && BUNDLE_PHASES.includes(phase)) {
      try {
        return await runReviewBundle(exec, { rootDir, id, phase })
      } catch (error) {
        const message = String(error?.message ?? error)
        recordBriefingFailure(rootDir, id, phase, error)
        return { briefingFailed: true, error: message, nextStep: `the review bundle for "${phase}" failed (${message}) — the artifact is untouched; retry with smart_brief` }
      }
    }
    let produced
    try {
      produced = await runHand(exec, {
        label: `smart brief · ${phase}`,
        prompt: briefingPrompt({ state, phase, draft }),
        // 生成面同样不许动工作流：孩子只读稿、写摘要。
        toolFilter: { deny: SMART_TOOL_NAMES },
        role: 'review',
        phase,
        attempts: reworkUsedIn(state, phase),
      })
    } catch (error) {
      const message = String(error?.message ?? error)
      recordBriefingFailure(rootDir, id, phase, error)
      return {
        briefingFailed: true,
        error: message,
        nextStep: `briefing generation failed for "${phase}" — the artifact is untouched; retry with smart_brief`,
      }
    }
    const missing = missingBriefingSections(draft, produced.body)
    if (missing.length > 0) {
      const error = new Error(`smart: the briefing for "${phase}" does not cover the artifact — missing: ${missing.join('; ')}. Nothing was recorded; regenerate (smart_brief).`)
      recordBriefingFailure(rootDir, id, phase, error)
      throw error
    }
    const next = recordBriefing(rootDir, id, phase, {
      provider: produced.route.provider,
      model: produced.route.model,
      source: produced.source,
      escalated: produced.escalated === true,
      attempts: produced.attempts ?? 0,
      body: produced.body,
    })
    return { briefing: produced.body, source: produced.source, round: next.briefings[phase].current }
  }

  ctx.tools.register(defineTool({
    name: 'smart_ruling',
    description: 'Record one model-side ruling: a plan defect, ambiguity, or spec conflict you settled yourself while working. Use this INSTEAD of stalling; use smart_decide instead when the question is one only the user can answer. Three parts are required — what you decided, why, and what it costs if it turns out wrong. Rulings are kept in state.rulings and reviewed at the end; they never open or close a gate.',
    parameters: {
      decision: { type: 'string', description: 'What you decided, in one line.' },
      why: { type: 'string', description: 'The reasoning you decided it on.' },
      costIfWrong: { type: 'string', description: 'What it costs if this turns out wrong — this is what makes the ruling reviewable later.' },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = recordRuling(rootDir, id, {
        decision: args.decision,
        why: args.why,
        costIfWrong: args.costIfWrong,
        by: 'model',
      })
      return JSON.stringify({
        recorded: true,
        total: state.rulings.length,
        ruling: state.rulings.at(-1),
        nextStep: 'Keep going — a ruling is a decision you own, not a request for approval. Surface it in the briefing so the user sees what you decided.',
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_brief',
    description: 'Generate the briefing for the current phase\'s artifact with the review route: a section-complete digest the presenting model walks the user through in conversation. Normally this runs automatically when smart_artifact lands an artifact — use this tool only to retry a failed generation or to backfill an old task that has none. It never opens anything: only smart_brief_confirm\'s card answer does.',
    parameters: {
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      const phase = state.phase
      const result = await briefArtifact(exec, { rootDir, id, phase })
      if (result.briefingFailed === true) return summary(rootDir, id, { briefed: false, phase, ...result })
      return summary(rootDir, id, {
        briefed: true,
        phase,
        round: result.round,
        source: result.source,
        briefing: result.briefing,
        nextStep: `present the briefing to the user in ordinary conversation (key points + critical details, leave room for their questions), then record their answer with smart_brief_confirm — discussion does not open the gate`,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_brief_confirm',
    description: 'Record the user\'s answer to the current phase\'s briefing on one short card and open what their answer opens: 确认 opens the phase gate (or moves the execution report into review), 需要修改 keeps the gate closed for artifact edits at no rework cost, 终止 cancels the task. Call this only after presenting the briefing in conversation and letting the user ask or request changes — the confirmation comes from the card answer alone, so nothing you pass as arguments can stand in for it.',
    parameters: {
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      const phase = state.phase
      const entry = state.briefings?.[phase]
      const round = entry?.current ?? 0
      if (round === 0) throw new Error(`smart: no briefing round for "${phase}" — generate one first (smart_brief); nothing was asked`)
      const gateText = phase === 'executing'
        ? '进入验收阶段（reviewing）'
        : `开门 ${GATE_AFTER[phase] ?? '?'}`
      const userQuestions = service('userQuestions', 'user-question')
      const capped = capGateSummary(`briefing（${phase} · 第 ${round} 轮）的要点已经在对话里讲给你听。确认后${gateText}。要改产物请选「需要修改」——这一轮修改不消耗返工额度。`)
      const briefOptions = [
        { kind: 'confirm', label: '确认，进入门禁', description: phase === 'executing' ? '执行报告看懂了，任务进入验收。' : `要点无误，打开 ${GATE_AFTER[phase] ?? '下一阶段'}。` },
        { kind: 'revise', label: '需要修改', description: '产物还要改；门保持关，改完重新落盘会生成新一轮 briefing。' },
        { kind: 'cancel', label: '终止任务', description: '停止这个任务，不做完。' },
      ]
      const asked = await userQuestions.ask({
        questions: [{
          id: `smart-brief-${phase}`,
          header: `smart · ${phase} briefing`,
          question: capped.text,
          options: briefOptions.map(({ label, description }) => ({ label, description })),
          multi_select: false,
        }],
        ...exec.agent === undefined ? {} : { agent: exec.agent },
        signal: exec.signal,
      })
      const answer = asked?.answers?.[0]
      const choice = (answer?.selected?.[0] ?? '').trim()
      const note = (answer?.custom ?? '').trim()
      const audit = [choice, note].filter(part => part !== '').join(' · ')
      const prefixes = { confirm: ['确认'], revise: ['需要修改', '修改'], cancel: ['终止', '取消'] }
      const kind = briefOptions.find(option => option.label === choice)?.kind
        ?? Object.entries(prefixes).find(([, list]) => list.some(prefix => choice.startsWith(prefix)))?.[0]
        ?? ''
      if (kind === 'cancel') {
        const next = cancelTask(rootDir, id, audit === '' ? '终止自 briefing 确认' : audit)
        return summary(rootDir, id, { briefingDecision: 'cancel', phase: next.phase, note: audit })
      }
      if (kind !== 'confirm' && kind !== 'revise') {
        throw new Error(`smart: unrecognised briefing answer "${choice}"${note === '' ? '' : ` (note: ${note})`} — expected one of: ${briefOptions.map(option => option.label).join(' / ')} — no state was changed`)
      }
      const next = confirmBriefing(rootDir, id, phase, kind, { round })
      return summary(rootDir, id, {
        briefingDecision: kind,
        phase,
        round,
        note: audit,
        awaitingGate: next.awaitingGate,
        nextPhase: next.phase,
        nextStep: kind === 'confirm'
          ? next.phase === phase
            ? `briefing confirmed — ask the user to confirm gate ${next.awaitingGate} (smart_gate)`
            : `briefing confirmed — ${phase} is now ${next.phase}`
          : 'keep the gate closed: edit the artifact and record it again (smart_artifact) — a new briefing round is generated for the new draft, at no rework cost',
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_gate',
    description: 'Put the current gate (G1–G4 after each design phase, G5 at the end) to the user and act on their answer. The preconditions are checked in code first: if the artifact or the required hand review is missing, this fails loudly instead of asking. The user\'s answer is recorded with the gate, and only "通过" advances the phase.',
    parameters: {
      summary: { type: 'string', description: `Optional short summary of what the user is approving (risks, open questions, what changed). The ask card renders it as the card's heading, so keep it to a few lines — past ${GATE_SUMMARY_LIMIT} characters the tool truncates it and points the user at the artifact.` },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      const gate = state.awaitingGate
      if (gate === null) {
        const pending = state.pendingDecisions ?? null
        const briefing = state.artifacts[state.phase] === undefined ? [] : briefingGaps(rootDir, state, state.phase)
        throw new Error(`smart: no gate is open for task "${id}" (phase "${state.phase}")${
          pending !== null
            ? ` — ${ARTIFACT_FILE[state.phase]} still has ${pending.items} unanswered decision(s) under "${pending.headings.join(' / ')}": put them to the user (smart_decide) and fold the answers into the artifact before the gate opens`
            : briefing.length > 0
              ? ` — ${briefing[0]}: present the briefing and record the user's answer (smart_brief_confirm) first — discussion does not open the gate`
              : ''
        }`)
      }
      // 门在代码里：条件不满足就不去打扰用户 —— 不能让"用户点了通过"掩盖产物缺失。
      const gaps = gateGaps(rootDir, state, { requireConsult: config.requireConsult })
      if (gaps.length > 0) throw new Error(`smart: gate ${gate} is blocked — ${gaps.join('; ')}`)

      const owner = gateOwner(gate)
      // 设计阶段退回"上一阶段"，终门（G5）退回计划阶段重做 —— 验收不过时能回去的地方
      // 就是计划（设计稿 §3 的返工回路）。
      const canStepBack = owner === 'reviewing' || DESIGN_PHASES.includes(owner)
      const backTo = owner === 'reviewing' ? 'plan' : DESIGN_PHASES[Math.max(0, DESIGN_PHASES.indexOf(owner) - 1)]
      // 额度耗尽**不是强制收尾**：那一项照样在卡上，只是含义变成"你同意再加一个预算"。
      // 计数按**目标阶段**算（每阶段各有额度），所以这里问的是 backTo 那一段的余额。
      const budget = backTo === null ? null : reworkBudget(state, backTo, config.maxRework)
      const overQuota = budget !== null && budget.used >= budget.cap
      const userQuestions = service('userQuestions', 'user-question')
      // 封顶在前、问询在后：卡片拿这段文字当标题，超长会让用户看不到选项（见 GATE_SUMMARY_LIMIT）。
      const capped = capGateSummary(args.summary ?? '')
      const truncation = capped.truncated ? { summaryTruncated: true, summaryLimit: GATE_SUMMARY_LIMIT } : {}
      // 选项是**带 kind 的一等对象**，应答按 kind 分派：早先按标签前缀匹配，而 G5 那条写作
      // 「验收不通过，退回计划（plan）重做」⇒ 不以「退回」开头 ⇒ 用户一点就抛
      // "unrecognised gate answer"（钥匙在锁上，锁不认识它）。文案以后怎么改都不会再错位。
      const reworkLabel = canStepBack
        ? overQuota
          ? `退回重做（「${backTo}」额度已用尽 ${budget.used}/${budget.cap}：选这项＝同意再加 ${config.maxRework} 次）`
          : backTo === owner ? '退回本阶段重做' : owner === 'reviewing' ? `验收不通过，退回计划（${backTo}）重做` : `退回上一阶段重做（${backTo}）`
        : null
      const gateOptions = [
        { kind: 'pass', label: '通过，进入下一阶段', description: gate === 'G5' ? '归档任务，交付完成。' : '进入下一阶段（G4 通过即授权执行）。' },
        ...reworkLabel === null ? [] : [{
          kind: 'rework',
          label: reworkLabel,
          description: overQuota
            ? `额度归零代表"机器不再自己加轮次"，不代表"你只能收下这版"。选这项我就记下你的加额授权，然后立刻退回「${backTo}」重做。`
            : '保留历史版本，重做该阶段及其后的产物。',
        }],
        { kind: 'cancel', label: '终止任务', description: '停止这个任务，不做完。' },
      ]
      const asked = await userQuestions.ask({
        questions: [{
          id: `smart-gate-${gate}`,
          header: `smart · ${owner}`,
          question: [
            `阶段「${owner}」的产物与手模型评审都已就绪，是否过门 ${gate}？`,
            overQuota ? `\n\n本阶段返工额度已用尽（${budget.used}/${budget.cap}）。过门或退回都由你定：退回不会白退 —— 你选它我就再加 ${config.maxRework} 次额度。` : '',
            capped.text === '' ? '' : `\n\n${capped.text}`,
          ].join(''),
          // 只把 label/description 送进上游（kind 是本进程的账）。
          options: gateOptions.map(({ label, description }) => ({ label, description })),
          multi_select: false,
        }],
        ...exec.agent === undefined ? {} : { agent: exec.agent },
        signal: exec.signal,
      })
      const answer = asked?.answers?.[0]
      const choice = (answer?.selected?.[0] ?? '').trim()
      const note = (answer?.custom ?? '').trim()
      const audit = [choice, note].filter(part => part !== '').join(' · ')
      // 先认标签（选项是我们自己给的，逐字相等即答案），再退到前缀匹配（用户手打/改写时兜底）。
      const prefixes = { pass: ['通过'], rework: ['退回', '验收不通过', '继续重做'], cancel: ['终止'] }
      const kind = gateOptions.find(option => option.label === choice)?.kind
        ?? Object.entries(prefixes).find(([, list]) => list.some(prefix => choice.startsWith(prefix)))?.[0]
        ?? ''

      if (kind === 'pass') {
        const next = passGate(rootDir, id, gate, { by: 'user', note: audit }, { requireConsult: config.requireConsult })
        return summary(rootDir, id, { ...truncation, gate, decision: 'passed', nextPhase: next.phase, note: audit })
      }
      if (kind === 'rework') {
        if (backTo === null) throw new Error(`smart: gate ${gate} has no earlier phase to return to`)
        // 人在门上选了「继续重做」＝加额授权：先落授权再返工（reworkTo 按额度判，顺序反了会被自己挡住）。
        const granted = overQuota ? grantRework(rootDir, id, backTo, { by: 'user', note: audit, maxRework: config.maxRework }) : null
        const next = reworkTo(rootDir, id, backTo, audit === '' ? `退回自 ${gate}` : audit, { maxRework: config.maxRework })
        return summary(rootDir, id, {
          ...truncation,
          gate,
          decision: 'rework',
          backTo,
          reworkCount: next.reworkCount,
          grantedAnotherBudget: granted === null ? null : config.maxRework,
          rework: reworkBudget(next, backTo, config.maxRework),
          note: audit,
        })
      }
      if (kind === 'cancel') {
        const next = cancelTask(rootDir, id, audit === '' ? `终止自 ${gate}` : audit)
        return summary(rootDir, id, { ...truncation, gate, decision: 'cancelled', note: audit })
      }
      throw new Error(`smart: unrecognised gate answer "${choice}"${note === '' ? '' : ` (note: ${note})`} — expected one of: ${gateOptions.map(option => option.label).join(' / ')} — no state was changed`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_execute',
    description: 'Hand the approved plan to the hand model and let it execute. Call this only after gate G4 passed (the design is approved): it runs the plan with the hand route, same capabilities as this session, and records the execution report. The hand model works from plan.md + acceptance.md only — it does not need (or see) the design conversation.',
    parameters: {
      instructions: { type: 'string', description: 'Optional extra marching orders for this run (constraints that appeared after the plan was written).' },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      // G4 未过就不许执行 —— 执行授权是代码判的，不是模型自己觉得可以了。
      if (state.phase !== 'executing') throw new Error(`smart: task "${id}" is in phase "${state.phase}"; execution starts only after gate G4 passes`)
      // 重入闸（acceptance B3）：执行报告落盘后停在 executing 等 briefing 确认，这个工具
      // 必须拒绝重跑 —— 否则第二次调用会把第一份报告整个覆盖掉。
      if (state.artifacts.executing !== undefined) throw new Error(`smart: the execution report of task "${id}" is already on disk — smart_execute runs once; the task now waits for the report's briefing (smart_brief_confirm)`)
      const plan = readArtifact(rootDir, id, 'plan')
      const acceptance = readArtifact(rootDir, id, 'acceptance')
      if (plan === null || acceptance === null) throw new Error('smart: execution needs both plan.md and acceptance.md on disk')

      const { route, body } = await runHand(exec, {
        label: `smart execute · ${id}`,
        prompt: executePrompt({ state, plan, acceptance, instructions: args.instructions }),
        // 拍板 2：执行与会话同权（只挡住工作流工具，不挡干活的能力）。
        toolFilter: { deny: SMART_TOOL_NAMES },
      })
      const report = `# 执行报告\n\n> 执行模型：${route.provider}/${route.model}\n\n${body.trim()}\n`
      const next = recordArtifact(rootDir, id, 'executing', report)
      // hand 在执行中自己定下的裁决进 state.rulings（`## Rulings` 小节）：拆不出
      // 「决定 — 为什么 — 错了代价」三段的整条丢弃并照实计数 —— 宁可少记，
      // 不记不存在的裁决。
      const { rulings: handRulings, skipped } = rulingsFromReport(report)
      for (const ruling of handRulings) recordRuling(rootDir, id, { ...ruling, by: 'hand' })
      const rulings = { recorded: handRulings.length, skipped }
      // 执行报告同样走 briefing 回路（G2 裁决①）：停在 executing，确认后才进 reviewing。
      let brief
      try {
        brief = await briefArtifact(exec, { rootDir, id, phase: 'executing' })
      } catch (error) {
        brief = { briefingFailed: true, error: String(error?.message ?? error) }
      }
      return summary(rootDir, id, {
        executed: true,
        executor: `${route.provider}/${route.model}`,
        // 叫 rulingsRecorded 而不是 rulings：`summary()` 先铺 status（里面有 rulings 数组），
        // 同名会把它遮蔽成计数 —— 同一个词在两处指两个东西，是给人添乱。
        rulingsRecorded: rulings,
        nextPhase: next.phase,
        report: body,
        ...brief.briefingFailed === true
          ? { briefingFailed: true, briefingError: brief.error, nextStep: 'the report is on disk; regenerate its briefing with smart_brief, then confirm' }
          : { briefing: brief.briefing, nextStep: 'walk the user through the execution-report briefing in conversation, then call smart_brief_confirm to move the task into review' },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_verify',
    description: 'Gather acceptance evidence with the hand model: it runs the checks in acceptance.md against the execution report and reports each criterion with the exact command and observed result. Read-only in code — the child has no write/edit tools. Record the evidence, then write your own verdict with smart_artifact(phase="reviewing").',
    parameters: {
      focus: { type: 'string', description: 'Optional: criteria or doubts to concentrate on.' },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      if (state.phase !== 'reviewing') throw new Error(`smart: task "${id}" is in phase "${state.phase}"; evidence is gathered in the review phase, after the execution report`)
      const acceptance = readArtifact(rootDir, id, 'acceptance')
      const report = readArtifact(rootDir, id, 'executing')
      if (acceptance === null || report === null) throw new Error('smart: verification needs acceptance.md and the execution report on disk')

      const { route, body } = await runHand(exec, {
        label: `smart verify · ${id}`,
        prompt: verifyPrompt({ state, acceptance, report, focus: args.focus }),
        toolFilter: verifyToolFilter(exec.agent),
        role: 'review',
        phase: 'reviewing',
        attempts: reworkUsedIn(state, 'reviewing'),
      })
      const next = recordVerification(rootDir, id, { provider: route.provider, model: route.model, body, acceptance: 'acceptance.md' })
      return summary(rootDir, id, { verified: true, verifier: `${route.provider}/${route.model}`, evidence: next.verifications.at(-1)?.file ?? null, findings: body })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_rework',
    description: 'Send the task back for rework outside a gate: the acceptance run failed, or the user asked for changes. The superseded artifacts move to history/ (never deleted) and the design phase you name must be redone. Bounded by maxRework (per phase); past the bound you cannot buy more — only the user can, by answering 继续重做 at a gate.',
    parameters: {
      reason: { type: 'string', description: 'Why it goes back — this is what the history records.' },
      backTo: { type: 'string', description: 'Design phase to redo (default: plan).', enum: [...DESIGN_PHASES] },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
      if (reason === '') throw new Error('smart: smart_rework needs a reason — the history is meant to explain itself')
      const next = reworkTo(rootDir, id, args.backTo ?? 'plan', reason, { maxRework: config.maxRework })
      return summary(rootDir, id, { rework: true, backTo: args.backTo ?? 'plan', reworkCount: next.reworkCount, reason })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_finish',
    description: 'Archive a task whose final gate (G5) passed: write the closing summary into the hidden task tree, promote the deliverables (brainstorm/design/plan/acceptance/execution report/review/summary + README) into <workspace>/docs/smart/<taskId>/, and mark the task archived. The machine refuses to archive while any gate is still open, and a failed promotion leaves the task unarchived so it can be retried.',
    parameters: {
      summary: { type: 'string', description: 'Closing summary markdown: what shipped, what is deliberately left out.' },
      workspace: { type: 'string', description: 'Optional explicit workspace directory for the delivery copy; defaults to the task\'s recorded workspace, then this session\'s working directory.' },
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const id = pickTaskId(exec, args)
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      // 解析序（acceptance.md Y5）：显式 args.workspace → 任务自己记的 → 调用会话的
      // header.cwd。legacy 任务（state 里没有 workspace）因此提升到**调用者**工作区。
      const where = workspaceOf(exec)
      const explicit = typeof args.workspace === 'string' && args.workspace.trim() !== '' ? args.workspace.trim() : null
      const workspace = explicit ?? (typeof state.workspace === 'string' && state.workspace !== '' ? state.workspace : where?.workspace ?? null)
      const workspaceSource = explicit !== null ? 'args.workspace' : state.workspace !== undefined ? 'state.workspace' : where?.workspaceSource ?? null
      // 收尾总结必须**覆盖模型自主裁决**：那是"我替你定的那些事"，用户只有在最后这份
      // 文档里才看得全。判据刻意钝（同 briefing 完整性）：有裁决就要求正文里出现
      // 「裁决」或 `Ruling` —— 一个词都看不见 = 这件事被悄悄吞了。
      const rulings = Array.isArray(state.rulings) ? state.rulings : []
      const closing = args.summary ?? ''
      if (rulings.length > 0 && !/(裁决|Ruling)/iu.test(closing)) {
        throw new Error(`smart: this task recorded ${rulings.length} model-side ruling(s), and the closing summary never mentions them — cover each one (what you decided, why, and what to watch for if it turns out wrong). They are decisions made on the user's behalf; the closing summary is the only place they all appear together.`)
      }
      const next = finishTask(rootDir, id, closing, { workspace, workspaceSource })
      const promotion = next._promotion
      return summary(rootDir, id, {
        archived: true,
        archivedAt: next.archivedAt,
        delivery: next.delivery,
        deliverablePaths: promotion.written,
        gitHint: `交付副本在 ${next.delivery.dir}（相对工作区）—— 若它应当进版本库，记得 git add 它；隐藏树 .dsh-fly/ 建议留在 .gitignore。`,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_status',
    description: 'Includes `rulings` (model-side decisions recorded with `smart_ruling`, distinct from `decisions`, which record what the user chose). Read the smart-mode task state: current phase, recorded artifacts, open user gate, blocking gaps, and the next required action. Call it with no taskId when you need to find the active task, or after a failure to see what the machine expects.',
    parameters: {
      taskId: { type: 'string', description: 'Optional; defaults to the session\'s active task, then the most recently touched one.' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertEnabled(exec)
      exec.signal?.throwIfAborted?.()
      const { roots, primary } = candidateTaskRoots({ config, env: process.env, session: exec?.agent?.session })
      let id
      try {
        id = pickTaskId(exec, args)
      } catch (error) {
        // 候选根全看一遍：新任务在工作区、老任务在 legacy，只列一个会让"我的任务呢"
        // 变成找不到。
        const seen = new Map()
        for (const entry of roots) for (const row of listTasks(entry.root)) if (!seen.has(row.id)) seen.set(row.id, row)
        const tasks = [...seen.values()]
        if (args.taskId === undefined && tasks.length > 0) {
          return JSON.stringify({ rootDir: primary, roots: roots.map(entry => ({ root: entry.root, source: entry.source })), active: null, tasks }, null, 2)
        }
        throw error
      }
      const rootDir = taskRootOf(id, exec)
      const state = readState(rootDir, id)
      if (state === null) throw new Error(`smart: no such task "${id}"`)
      return summary(rootDir, id)
    },
  }))
}
