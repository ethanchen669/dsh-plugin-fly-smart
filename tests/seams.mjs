/**
 * Shared capability-seam stubs for the smart-mode specs.
 *
 * 桩必须与真接缝**同形**（AGENTS.md §4「桩必须与真接缝同形」）：
 * `userQuestions.ask` 的回答是 `{ answers: [{ id, selected: [label], custom }] }`，
 * `subagents.start` 返回 run 句柄（`{ id, localAgent, result, dispose }`，产出在
 * `await run.result` 的 `{ output, stopReason }` 里）。曾有桩发 `{ [id]: label }`
 * 与 promise 属性的 result —— 与真契约不符，绿的是错的契约。
 *
 * 另一半纪律（acceptance B1）：**桩要按卡的 id 分派应答**。briefing 卡（`smart-brief-*`）
 * 与门卡（`smart-gate-*`）会出现在同一个流程里，只答一个固定标签的桩在新流程下永远
 * 无法确认 briefing —— 于是测试改到"绿在错的地方"。
 */

/** The briefing card's answer label (smart_brief_confirm's confirm option). */
export const BRIEF_CONFIRM = '确认，进入门禁'

/** The gate card's answer label (smart_gate's pass option). */
export const GATE_PASS = '通过，进入下一阶段'

/**
 * A briefing body that passes the completeness check for the artifact embedded in a
 * briefing prompt: every `##`+ heading is named, plus the three no-section keywords.
 *
 * Used as the default `subagents.start` reply for briefing prompts; consult prompts
 * get `CONSULT_REVIEW` instead (a fixed review text is all those assertions need).
 */
export function briefingText(prompt) {
  const match = /--- [^\n]+ ---\n([\s\S]*?)\n--- end ---/u.exec(prompt)
  const draft = match?.[1] ?? ''
  const sections = [...draft.matchAll(/^#{2,6}\s+(.+)$/gmu)].map(found => found[1].trim())
  return `覆盖章节：${sections.length === 0 ? '全文' : sections.join('、')}\n\n结论：可执行。\n风险：缺回滚点。\n未决：无。\n`
}

/** The canned consult review (gates.spec asserts on 缺回滚点). */
export const CONSULT_REVIEW = '手模型评审：缺回滚点。'

/**
 * Default review-route child reply: briefing prompts get `briefingText(prompt)`
 * (section-complete), everything else gets `CONSULT_REVIEW`.
 */
export function reviewReply(request) {
  const prompt = request?.prompt?.[0]?.text ?? ''
  return prompt.includes('briefing') ? briefingText(prompt) : CONSULT_REVIEW
}

/**
 * A `subagents` seam stub matching the real run-handle contract.
 *
 * @param calls - recorder `{ start: [], dispose: 0 }`.
 * @param text - fixed text, or `(request) => text` for prompt-aware replies.
 * @returns the seam object.
 */
export function subagentsStub(calls, text = reviewReply) {
  return {
    start: async (provider, request) => {
      calls.start.push({ provider, request })
      return {
        id: `child-${calls.start.length}`,
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: typeof text === 'function' ? text(request) : text }], stopReason: 'completed' }),
        dispose: async () => { calls.dispose += 1 },
      }
    },
  }
}

/**
 * A `userQuestions` seam stub answering each card via `choose(card)`.
 *
 * @param calls - recorder with an `ask` array.
 * @param choose - `(card) => label`; defaults to the standard flow
 *   (briefing card ⇒ 确认, gate card ⇒ 通过).
 * @returns the seam object.
 */
export function askStub(calls, choose = defaultChoose) {
  return {
    ask: async question => {
      calls.ask.push(question)
      const card = question.questions[0]
      return { answers: [{ id: card.id, selected: [choose(card)], custom: '' }] }
    },
  }
}

/** The standard flow's answer: confirm the briefing, pass the gate. */
export function defaultChoose(card) {
  return card.id.startsWith('smart-brief-') ? BRIEF_CONFIRM : GATE_PASS
}

/**
 * Confirm the current phase's briefing after `smart_artifact` landed one.
 *
 * Call sites that used to be `smart_artifact → smart_gate` become
 * `smart_artifact → confirmBrief(tool, call, session) → smart_gate`.
 */
export async function confirmBrief(tool, call, session, taskId) {
  return call(tool, 'smart_brief_confirm', taskId === undefined ? {} : { taskId }, session)
}
