/**
 * Fly smart — the agent-plane tool surface (0.3.0, slim).
 *
 * The 0.2.x line mounted a whole workflow here (14 `smart_*` tools, a phase machine,
 * user gates). That workflow ran rarely in practice, so 0.3.0 keeps only the two
 * things that were used every day:
 *
 *   - **`smart_dispatch`** — run a subagent on a route the panel configures
 *     (`hand` for implementation work, `review` for an independent audit). The route
 *     is resolved **fresh on every call** (see `lib/dispatch.mjs`), so saving a new
 *     model in the panel takes effect on the very next dispatch.
 *   - **`smart_check_doc`** — check a plan or acceptance document against the
 *     document contract the old gates enforced (`lib/doc-contract.mjs`). The gate
 *     machine is gone; the contract that made a plan executable by a model who never
 *     saw the design conversation is not.
 *
 * Everything else — phases, gates, briefings, rulings, task trees, the `/smart`
 * command, the workflow prompt section — is deleted, along with `lib/state.mjs`.
 *
 * @module dsh-plugin-fly-smart
 */

import { existsSync, readFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  dispatchOnRoute,
  isAbsolutePath,
  parseRouteValue,
  resolveMirrorPath,
} from '../lib/dispatch.mjs'
import {
  acceptanceContractGaps,
  adrContractGaps,
  contractKindFor,
  designContractGaps,
  planContractGaps,
} from '../lib/doc-contract.mjs'

/** Cordis plugin name, matched by the preset row's `name`. */
export const name = 'fly-smart'

/**
 * Every service this row **reads** must be declared here.
 *
 * Cordis throws on an undeclared service *property access*, and a throw inside
 * `apply` is not a local failure: the preset mounts as one composition, so the
 * activation audit rejects the whole mount. `tools` is the only seat the slim
 * surface needs — `subagents` is resolved through `ctx.get(name)`, the
 * un-injected reflector getter, which needs no declaration.
 */
export const inject = ['tools']

/** JSON tool output, rendered as text (the `fly-diag` shape). */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

/**
 * Mount the slim smart tools.
 *
 * @param ctx - cordis context of the preset's smart row.
 * @param rawConfig - row `config` (`{ enabled, handRoute, reviewRoute }`).
 */
export function apply(ctx, rawConfig = {}) {
  const config = {
    enabled: rawConfig?.enabled !== false,
    handRoute: parseRouteValue(rawConfig?.handRoute),
    reviewRoute: parseRouteValue(rawConfig?.reviewRoute),
  }

  /**
   * Refuse to run **inside a subagent child**.
   *
   * A child dispatching another child multiplies the session's token bill with
   * nobody watching, and the old host's `toolFilter` (which used to deny this in the
   * child) is gone from the 0.2.x activation request. The blood line is read from the
   * session's own fields, not from "it looks like a child": `origin === 'subagent'`
   * or a positive `delegationDepth`.
   */
  const assertNotChild = exec => {
    const header = exec?.agent?.session?.header
    const isChild = header?.origin === 'subagent'
      || (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0)
    if (isChild) {
      throw new Error('smart: this session is a subagent child — dispatch and document checks belong to the top-level session; a child must not spend the user\'s budget on more children')
    }
  }

  ctx.tools.register(defineTool({
    name: 'smart_dispatch',
    description: 'Run a subagent on a model route configured in the Fly smart panel (or the row config): `role: "hand"` for implementation work, `role: "review"` for an independent audit of work already done, `role: "lite"` for mechanical work on the cheap model. Use it whenever the task should be executed or reviewed by a model other than the session\'s own — the route is re-read on every call, so a model saved in the panel takes effect immediately. The reply carries the child\'s text plus the route and its source (a review route with no review model configured falls back to hand, and `source` says `<x>-fallback` so you can tell the user instead of silently reviewing with the executor\'s model).',
    parameters: {
      prompt: { type: 'string', description: 'The complete, self-contained instruction for the child. It does not see this conversation: include the goal, the files, and what "done" looks like.' },
      role: { type: 'string', description: 'Which configured route to run on: "hand" (default, implementation work), "review" (independent audit — never the executor\'s own model when a review route is configured), or "lite" (cheap model for mechanical work: exploration, evidence gathering, parallel investigation; no fallback — configure it or use hand).' },
      label: { type: 'string', description: 'Short label for the run, shown in logs (default "smart_dispatch").' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertNotChild(exec)
      exec.signal?.throwIfAborted?.()
      const role = args.role === 'review' || args.role === 'lite' ? args.role : 'hand'
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (prompt === '') throw new Error('smart: smart_dispatch needs a non-empty `prompt` — the child does not see this conversation')
      const subagents = ctx.get('subagents')
      if (subagents === undefined) {
        throw new Error('smart: the subagent service (`subagents`) is unavailable in this session — cannot dispatch')
      }
      const result = await dispatchOnRoute({
        subagents,
        role,
        prompt,
        label: typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : 'smart_dispatch',
        config,
        // 上游 0.2.x 契约要求 `request.parent` = **活着的那个父 agent** 本身（它按
        // `parent.id` 去注册表里比对身份），不是 id、不是 session。少了它，报错在
        // 宿主内部变成 `Cannot read properties of undefined (reading 'id')`。
        parent: exec?.agent,
        session: exec?.agent?.session,
        mirrorPath: resolveMirrorPath(),
      })
      return JSON.stringify({ text: result.text, route: result.route, source: result.source }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'smart_check_doc',
    description: 'Check a plan, acceptance, design or ADR document against its document contract: a plan needs an "**Interfaces:**" block (Consumes / Produces) in EVERY task, a "## Global Constraints" section and a "## Review Focus" section; an acceptance document needs a "## …验收…" section, at least one "- [ ]" criterion, and every criterion must carry both 「检查」 (what to run) and 「预期」 (what passing looks like), with no 「需要你裁决」 section left open; a design needs the five shape sections (组件/接口/数据/错误/接缝) and no steps; an ADR needs the five decision sections and the cost of being wrong. Run it after writing the file and fix every reported gap before handing the plan to anyone. The kind is inferred from a `-acceptance.md` suffix unless `kind` is given.',
    parameters: {
      path: { type: 'string', description: 'Absolute path of the markdown file to check.' },
      kind: { type: 'string', description: 'Optional "plan", "acceptance", "design" or "adr"; omitted = inferred from the filename (-acceptance.md / -design.md / -adr.md suffixes).' },
    },
    output: textOutput,
    async execute(args, exec) {
      assertNotChild(exec)
      exec.signal?.throwIfAborted?.()
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      if (path === '') throw new Error('smart: smart_check_doc needs a `path`')
      if (!isAbsolutePath(path)) {
        throw new Error(`smart: smart_check_doc needs an ABSOLUTE path (got ${JSON.stringify(path)}) — a relative path would be resolved against the host process, not your workspace (the two differ; the desktop shell's cwd is /)`)
      }
      if (!existsSync(path)) throw new Error(`smart: no such file: ${path}`)
      const text = readFileSync(path, 'utf8')
      const kind = contractKindFor(path, args.kind)
      const gaps = kind === 'acceptance' ? acceptanceContractGaps(text) : kind === 'design' ? designContractGaps(text) : kind === 'adr' ? adrContractGaps(text) : planContractGaps(text)
      return JSON.stringify({ ok: gaps.length === 0, kind, path, gaps }, null, 2)
    },
  }))
}
