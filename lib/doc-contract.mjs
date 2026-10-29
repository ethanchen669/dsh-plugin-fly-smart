/**
 * Fly smart — document contract checks (the surviving half of the workflow's value).
 *
 * The gate state machine is gone in 0.3.0, but the **document contract** it enforced
 * is the part that made a plan executable by a model that never saw the design
 * conversation. It costs a few dozen lines to keep, and it is deterministic, so it
 * does not need a workflow to carry it:
 *
 *   - `plan` — every task block declares its own `**Interfaces:**` (`Consumes` /
 *     `Produces`), and the document carries `## Global Constraints` (the project-wide
 *     rules copied verbatim from the spec) and `## Review Focus` (the input classes
 *     the spec implies but no task's tests exercise).
 *   - `acceptance` — a section that names acceptance, at least one `- [ ]` criterion,
 *     every criterion carrying both a **检查** (what to run) and an **预期** (what
 *     passing looks like), and **no open-decision section** left behind.
 *
 * The checks are deliberately blunt (a heading and a keyword), the same trade the
 * old gate made: a clever parser that misses one section is worse than a dumb one
 * that occasionally over-reports, because the missed section is exactly why another
 * model cannot execute the plan.
 *
 * This module is self-contained: it must not import `lib/state.mjs` (deleted in the
 * same release).
 *
 * @module dsh-plugin-fly-smart/doc-contract
 */

/**
 * 产物里标记"还有只有用户能定的问题"的小节关键词。
 *
 * 判据刻意做得**钝**——一个小节标题就能拦下整份文档，因为"聪明"的解析漏掉一节
 * 就会让未裁决的问题被当成已裁决。模型要做的事只有一件：收齐裁决后把标题里的这几个字
 * 去掉（换成「已裁决」并逐条写上用户的选择）。
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

/**
 * The artifact's section headings.
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
 * The three blocks a plan must carry.
 *
 * | 块 | 它买的是什么 |
 * | --- | --- |
 * | `Interfaces` | 一个实现者**只看得到自己的任务**，这一块是他怎么知道邻居任务用什么名字与类型 |
 * | `Global Constraints` | spec 里项目级硬约束的**逐字抄写**（版本下限、命名规则、平台要求）—— 每个任务的隐含前提 |
 * | `Review Focus` | spec **暗示了但没有任何任务的测试覆盖**的输入类/失败模式。*"spec 的沉默不是允许程序在这个输入上坏掉"* |
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
 * @param markdown - plan 的正文。
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
 * plan.md 必须带计划契约 —— **写入处就挡**，不等谁去想起检查。
 *
 * @param markdown - 要落成 plan 的正文。
 * @throws 契约不齐时逐条列出缺什么。
 */
export function assertPlanContract(markdown) {
  const gaps = planContractGaps(markdown)
  if (gaps.length > 0) throw documentContractError('plan', gaps)
}

/**
 * An acceptance document must be **checkable by someone else**.
 *
 * Rules (each one closes a way the old workflow's acceptance file went soft):
 *
 *   - a `##`+ heading that contains 「验收」 (the document names its own purpose);
 *   - at least one `- [ ]` criterion (a list of prose paragraphs is not a checklist);
 *   - every criterion carries both 「检查」 (what to run / look at) and 「预期」
 *     (what passing looks like) — a criterion without both cannot be judged;
 *   - no open-decision section (an unresolved question is not an acceptance criterion).
 *
 * @param markdown - the acceptance document's body.
 * @returns the gaps, in the same style as {@link planContractGaps}; empty = contract met.
 */
export function acceptanceContractGaps(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  if (text.trim() === '') return ['acceptance.md is empty']
  const gaps = []
  const headings = artifactSections(text)
  if (!headings.some(heading => heading.includes('验收'))) gaps.push('a "## …验收…" section')
  const criteria = text.split('\n').filter(line => /^\s*-\s+\[\s\]\s+\S/u.test(line))
  if (criteria.length === 0) gaps.push('at least one "- [ ]" criterion')
  criteria.forEach((line, index) => {
    const label = line.replace(/^\s*-\s+\[\s\]\s*/u, '').slice(0, 40)
    const missing = []
    if (!line.includes('检查')) missing.push('检查')
    if (!line.includes('预期')) missing.push('预期')
    if (missing.length > 0) gaps.push(`criterion ${index + 1} ("${label}…") lacks ${missing.map(word => `「${word}」`).join(' / ')}`)
  })
  const open = openDecisions(text)
  for (const heading of open.headings) gaps.push(`an unresolved decision section ("${heading}")`)
  return gaps
}

/**
 * A design document must be the **shape**, checkable by someone who never saw the
 * conversation. Five sections, each answering one question:
 *
 *   组件与边界 / 接口 / 数据与状态 / 错误与失败模式 / 接缝与取舍
 *
 * The blunt judge is the same as the plan contract: a missing `##` section is a
 * missing answer. `Step` lines are refused outright — a design document with steps
 * is a plan wearing the wrong hat.
 *
 * @param markdown - the design document's body.
 * @returns the gaps; empty = contract met.
 */
export function designContractGaps(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  if (text.trim() === '') return ['design.md is empty']
  const gaps = []
  const headings = artifactSections(text)
  const wanted = [['组件', '边界'], ['接口'], ['数据', '状态'], ['错误', '失败'], ['接缝', '取舍']]
  for (const anyOf of wanted) {
    if (!headings.some(heading => anyOf.some(word => heading.includes(word)))) {
      gaps.push(`a "## …${anyOf[0]}…" section`)
    }
  }
  if (/(^|\n)\s*#{2,4}\s+.*\bStep\s*\d/u.test(text) || /(^|\n)\s*- \[ \] \*\*Step\s*\d/u.test(text)) {
    gaps.push('no steps in a design document — steps belong in the plan')
  }
  return gaps
}

/**
 * An ADR must record **the decision**, not the conversation. Five sections:
 * Context / Options / Decision & Why (with the cost of being wrong) /
 * Consequences / Revisit trigger. The judge accepts bilingual headings (the
 * section names are English in the skill's template and Chinese in a Chinese
 * document) by keyword.
 *
 * @param markdown - the ADR body.
 * @returns the gaps; empty = contract met.
 */
export function adrContractGaps(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  if (text.trim() === '') return ['adr is empty']
  const gaps = []
  const headings = artifactSections(text)
  const wanted = [['Context', '上下文'], ['Options', '候选'], ['Decision', '决定'], ['Consequences', '后果'], ['Revisit', '重开']]
  for (const anyOf of wanted) {
    if (!headings.some(heading => anyOf.some(word => heading.includes(word)))) {
      gaps.push(`a "## …${anyOf[0]}…" section`)
    }
  }
  // 决定段必须回答"错了代价"——没有代价的决定等于没想。
  const decisionSection = headings.findIndex(heading => ['Decision', '决定'].some(word => heading.includes(word)))
  if (decisionSection >= 0 && !/(错了代价|cost of being wrong|if wrong)/iu.test(text)) {
    gaps.push('the decision section must state the cost of being wrong (错了代价)')
  }
  return gaps
}

/**
 * Thrown by the tool surface when a document does not carry its contract.
 *
 * It lists every gap at once (a caller that fixes one gap per round trip wastes the
 * user's turns) and names the skill that explains each block.
 *
 * @param kind - `'plan'` or `'acceptance'`.
 * @param gaps - {@link planContractGaps} / {@link acceptanceContractGaps} result.
 */
export function documentContractError(kind, gaps) {
  const where = kind === 'acceptance' ? 'the acceptance contract' : kind === 'design' ? 'the design contract' : kind === 'adr' ? 'the ADR contract' : 'the document contract'
  const skill = kind === 'acceptance' ? 'smart-acceptance' : kind === 'design' ? 'smart-design' : kind === 'adr' ? 'smart-adr' : 'smart-plan'
  return new Error(
    `smart: ${kind}.md does not carry ${where} — ${gaps.join('; ')} — see the ${skill} skill for what each block must carry`,
  )
}

/**
 * Which contract to apply for a path.
 *
 * Filename-based on purpose: the acceptance file lives beside the plan as
 * `<slug>-acceptance.md`, and requiring a `kind` argument for a path the caller just
 * typed is a round trip for nothing. An explicit `kind` still wins.
 *
 * @param path - the document path.
 * @param kind - optional explicit kind.
 * @returns `'plan' | 'acceptance'`.
 */
export function contractKindFor(path, kind = undefined) {
  if (kind === 'plan' || kind === 'acceptance' || kind === 'design' || kind === 'adr') return kind
  if (typeof path !== 'string') return 'plan'
  if (/acceptance\.md$/iu.test(path)) return 'acceptance'
  if (/-?design\.md$/iu.test(path)) return 'design'
  if (/(^|[-_/])adr(-\d+)?\.md$/iu.test(path)) return 'adr'
  return 'plan'
}
