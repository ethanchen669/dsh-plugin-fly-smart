/**
 * Contract tests for `lib/doc-contract.mjs` — the checks that survive the workflow.
 *
 * The workflow's gates are gone in 0.3.0, but their **document contract** was the
 * part that made a plan executable by a model that never saw the design
 * conversation. These tests pin the contract itself, one gap at a time:
 *
 *   - plan: `Interfaces` per task (with `Consumes` / `Produces`), `## Global
 *     Constraints`, `## Review Focus`;
 *   - acceptance: a 「验收」section, at least one `- [ ]` criterion, every criterion
 *     carrying both 检查 and 预期, and no open-decision section;
 *   - the decisions marker is still read from headings only (a mention in prose is
 *     not an open decision), and fenced code does not create sections.
 *
 * Run: node --test tests/*.spec.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PLAN_CONTRACT,
  acceptanceContractGaps,
  artifactSections,
  assertPlanContract,
  contractKindFor,
  documentContractError,
  openDecisions,
  planContractGaps,
} from '../lib/doc-contract.mjs'

const GOOD_PLAN = `# X 实现计划

## Global Constraints

1. Node 22。

## Review Focus

1. 空输入。

---

### Task 1: A

**Files:** Create \`a.js\`

**Interfaces:**
- Consumes: 无
- Produces: \`f(x: number) -> number\`

- [ ] **Step 1: 写测试**

Run: \`node --test\`
Expected: FAIL

### Task 2: B

**Files:** Create \`b.js\`

**Interfaces:**
- Consumes: \`f(x: number) -> number\`
- Produces: \`g() -> void\`

- [ ] **Step 1: 写测试**
`

const GOOD_ACCEPTANCE = `# X 验收

## 验收标准

- [ ] **A1 行为正确** —— 检查：\`node --test\`；预期：全绿。
- [ ] **A2 边界** —— 检查：传空数组；预期：返回 0。

## 覆盖说明

无。
`

test('a complete plan has no gaps', () => {
  assert.deepEqual(planContractGaps(GOOD_PLAN), [])
  assert.doesNotThrow(() => assertPlanContract(GOOD_PLAN))
  assert.deepEqual(PLAN_CONTRACT, ['Interfaces', 'Global Constraints', 'Review Focus'])
})

test('each plan gap is named, and several gaps are reported together', () => {
  const gaps = planContractGaps('# X\n\n## Global Constraints\n\n1. Node 22。\n\n### Task 1: A\n\n- [ ] Step\n')
  assert.ok(gaps.some(gap => gap.includes('Review Focus')), gaps.join('|'))
  assert.ok(gaps.some(gap => gap.includes('Interfaces')), gaps.join('|'))
  assert.ok(gaps.some(gap => gap.includes('Consumes')), gaps.join('|'))
  assert.equal(planContractGaps('').length, 1)
})

test('one Interfaces block for N tasks is not enough', () => {
  const twoTasksOneBlock = GOOD_PLAN.replace(
    /\*\*Interfaces:\*\*\n- Consumes: `f\(x: number\) -> number`\n- Produces: `g\(\) -> void`\n/,
    '',
  )
  assert.ok(!twoTasksOneBlock.includes('`g() -> void`'), 'the second Interfaces block really was removed')
  const gaps = planContractGaps(twoTasksOneBlock)
  assert.ok(gaps.some(gap => /found 1, need 2/u.test(gap)), gaps.join('|'))
})

test('assertPlanContract lists every gap at once and names plan.md', () => {
  assert.throws(() => assertPlanContract('# empty'), error => {
    assert.match(error.message, /plan\.md/)
    assert.match(error.message, /Global Constraints/)
    assert.match(error.message, /smart-plan/)
    return true
  })
})

test('a complete acceptance has no gaps', () => {
  assert.deepEqual(acceptanceContractGaps(GOOD_ACCEPTANCE), [])
})

test('acceptance gaps: no 验收 section, no criterion, missing 检查/预期, open decisions', () => {
  assert.deepEqual(acceptanceContractGaps(''), ['acceptance.md is empty'])

  const noSection = GOOD_ACCEPTANCE.replace('## 验收标准', '## 标准')
  assert.ok(acceptanceContractGaps(noSection).some(gap => gap.includes('验收')))

  const noCriterion = GOOD_ACCEPTANCE.replace(/- \[ \] \*\*A1.*\n/, '').replace(/- \[ \] \*\*A2.*\n/, '')
  assert.ok(acceptanceContractGaps(noCriterion).some(gap => gap.includes('- [ ]')))

  const halfCriterion = GOOD_ACCEPTANCE.replace('检查：`node --test`；预期：全绿。', '检查：`node --test`。')
  const gap = acceptanceContractGaps(halfCriterion)
  assert.equal(gap.length, 1, gap.join('|'))
  assert.match(gap[0], /criterion 1/)
  assert.match(gap[0], /预期/)

  const open = `${GOOD_ACCEPTANCE}\n## 需要你裁决\n\n1. 用 SQLite 还是 Postgres？\n`
  assert.ok(acceptanceContractGaps(open).some(g => g.includes('unresolved decision section')))
})

test('open decisions come from headings, not prose; fences do not create sections', () => {
  assert.deepEqual(openDecisions('正文提到需要你裁决但没有小节。').headings, [])
  const open = openDecisions('## 需要你裁决（G1）\n\n1. A 还是 B？\n2. C 还是 D？\n\n## 其他\n\n- 不是裁决\n')
  assert.equal(open.headings.length, 1)
  assert.equal(open.items, 2)

  const fenced = '## 真节\n\n```\n## 假节\n```\n'
  assert.deepEqual(artifactSections(fenced), ['真节'])
})

test('contractKindFor: explicit kind wins, otherwise the acceptance suffix decides', () => {
  assert.equal(contractKindFor('docs/plans/x-acceptance.md'), 'acceptance')
  assert.equal(contractKindFor('docs/plans/x.md'), 'plan')
  assert.equal(contractKindFor('docs/plans/x-acceptance.md', 'plan'), 'plan')
  assert.equal(contractKindFor(undefined), 'plan')
})

test('documentContractError names the right skill per kind', () => {
  assert.match(documentContractError('plan', ['x']).message, /smart-plan/)
  assert.match(documentContractError('acceptance', ['x']).message, /smart-verify-claim/)
  assert.match(documentContractError('acceptance', ['x']).message, /acceptance\.md/)
})
