# fly-smart 瘦身：去工作流，留模型配置 + 技能 + 按路由派发 实现计划

> **给执行者：** 按任务逐个实现本计划，步骤用复选框（`- [ ]`）跟踪；
> 执行方式见文末 Execution Handoff。

**Goal:** `dsh-plugin-fly-smart` 0.3.0 —— 删掉 smart 工作流（状态机 / 14 个 `smart_*` 工具 / `/smart` 命令 / 任务树 UI），保留并打通三样：模型路由配置面板、smart 系列技能、按路由选模型的子代理派发；外加一个文档契约 linter。存量数据一个字节不动。

**Architecture:** 从旧代码里**平移**两块可复用资产到新入口，其余删除：`lib/dispatch.mjs` 收纳路由解析与子代理派发（原 `lib/state.mjs` 的路由函数 + `tools/index.js` 的 `routeOf`/`startChild`），`lib/doc-contract.mjs` 收纳文档契约校验（原 `state.mjs` 的 `planContractGaps` 等 + 新写 acceptance 契约）。`tools/index.js` 重写为两个工具（`smart_dispatch` / `smart_check_doc`），面板收缩为模型路由卡。

**Tech Stack:** Node ESM / Cordis 插件 / zod / node:test。

**Spec:** [docs/plans/2026-10-29-slim-fly-smart-acceptance.md](2026-10-29-slim-fly-smart-acceptance.md)（验收契约）；设计裁决见 Global Constraints 第 3–5 条（2026-10-29 会话定案）。

## Global Constraints

1. **存量数据一个字节不动**：`~/.dsh-fly/smart/`（任务树）、各工作区 `docs/smart/`（6 个已交付任务）、`~/.dsh-fly/smart-routes.json`（用户配置；**boot 不许写镜像**，只在用户保存路由时写）。
2. **镜像格式 `MIRROR_VERSION = 2` 不升版**；顶层 `hand` legacy 镜像字段继续可读。
3. **面板配置角色 = `hand` / `review` 两个**（`brain` 只留 legacy 可读）；**effort 升档逻辑不带走**（`escalatedEffort`/`supportedEffortsOf` 随工作流删除）。
4. **产物落盘约定（本次定案）**：计划 `docs/plans/<YYYY-MM-DD-<slug>.md`，验收 `docs/plans/<YYYY-MM-DD-<slug>-acceptance.md` —— 朴素路径、不带 `smart/` 子路径，与 docs/specs/、docs/plans/ 惯例兼容。
5. **文档契约**：plan = 每个任务块带 `**Interfaces:**`（Consumes/Produces）+ `## Global Constraints` + `## Review Focus`；acceptance = 一个含「验收」的 `##` 节 + 至少一条 `- [ ]` 标准行（每行含「检查」与「预期」）+ 无未决「需要你裁决」。
6. **技能不许引用已删工具**：`assets/` 里出现 `smart_begin|smart_artifact|smart_gate|smart_verify|smart_execute|smart_finish|smart_consult|smart_decide|smart_ruling|smart_brief|smart_brief_confirm|smart_rework|smart_status|/smart`（词边界）即门禁红。
7. **桩与真接缝同形**（本仓踩过 `result` 是方法/属性、`exec.args` vs `arguments` 的坑）；验证性输出先 `assert` 命中再打印结论。
8. 版本 **0.3.0**（破坏性：14 个 `smart_*` 工具与 `/smart` 命令消失）；中文 conventional commits；push 需用户点头。

## Review Focus

1. **懒读语义不许变成缓存**：路由每次调用现读（面板保存 → 下一次派发生效）——钉在 Task 1。
2. **两代子代理契约都要活**（`startActivation` / `start`），mock 形状错 = 整版假绿——钉在 Task 3。
3. **升级现场的失败形状**：0.2.x 会话调 `smart_begin` 得到 "unknown tool"——README 记录预期行为（文档级验收，见验收文件 A7）。
4. **技能死引用漏网**：改写后的技能指挥调用不存在的工具——grep 钉子（Task 6）+ 逐技能走查派发段。
5. **路由语义双实现一致**：面板侧 `readRoutesConfig` 与工具侧 `resolveRoute` 对 preset 硬地板 / session / default / legacy 回落的语义必须一致，不允许第三种实现——钉在 Task 1。

---

## File Structure

**新增（先建先测）：**
- `lib/dispatch.mjs` —— 路由解析 + 子代理派发核心（自包含，不依赖 lib/state.mjs）
- `lib/doc-contract.mjs` —— 文档契约校验（plan + acceptance）
- `tests/dispatch.spec.mjs`、`tests/doc-contract.spec.mjs`

**重写：**
- `tools/index.js` —— 1505 行 → 两个工具 + 子代理守卫；`inject` 收缩为 `['tools']`（`commands`/`systemPrompt` 席位随 `/smart` 命令与工作流提示词节一起删）

**删除：**
- `lib/state.mjs`（2389 行；Task 1/2 先把要留的函数平移走）
- `panel/reader.js`（481 行；任务树读取器）
- `src/client/index.tsx` + `src/client/workbench-css.ts` 里的任务树 / 门 / 裁决视图（保留模型路由卡）

**改：**
- `index.js` —— `ENDPOINTS` 去任务端点，只留 `/fly/smart/routes`
- `assets/*/SKILL.md`（10 个既有）—— 引用清洗 + 产物约定改写；新增 `smart-review`（Task 7）
- `scripts/verify-smart.mjs`、`README.md`、`docs/internals.md`、`package.json`（files[] + version）
- `tests/` —— 退役 `workflow`/`briefings`/`execute`/`gates`/`command` specs，`tools.spec.mjs` 重写

---

### Task 1: lib/dispatch.mjs —— 路由解析与派发核心（平移，行为不变）

**Files:**
- Create: `lib/dispatch.mjs`
- Modify: `tools/index.js`（改为从 dispatch.mjs import，其余不动）
- Test: `tests/dispatch.spec.mjs`

**Interfaces:**
- Consumes: `lib/state.mjs` 的 `parseRouteValue` / `readMirrorLayers` / `mirrorHandRoute` / `mirrorReviewRoute` / `currentHandRoute` / `currentReviewRoute`（**平移**，不是重写）；`subagents` 服务契约 `startActivation({provider:'spawn',label,request:{prompt,parent,agentOptions},signal,delivery:'caller'})` → `{childId, result, dispose}` 与老契约 `start('spawn', {...})` → `{result, dispose}`。
- Produces: `lib/dispatch.mjs` 导出：
  - `parseRouteValue(value: string) -> {provider, model, effort?} | null`（原实现逐字平移）
  - `resolveRoute({role: 'hand'|'review', config, sessionId, mirrorPath?, env?}) -> {route, source}` —— 每次调用现读；`source: 'preset'|'session'|'default'|'legacy'|null`；`config.handRoute`/`config.reviewRoute` 非空 = preset 硬地板
  - `startChild(subagents, {label, prompt, agentOptions, signal}) -> {output, stopReason}`（内部优先 `startActivation`、回落 `start`；`result` 按**方法或属性**双形状取）
  - `outputText(output) -> string`

- [ ] **Step 1: 写失败测试**（`tests/dispatch.spec.mjs`，四组）：
  ① `parseRouteValue('prov/model@high')` → `{provider:'prov', model:'model', effort:'high'}`；② preset 行非空时 `resolveRoute` 的 `source === 'preset'`；③ **懒读**：两次 `resolveRoute` 之间改镜像文件 → 第二次读到新值（防缓存回归）；④ **双实现一致**：同一镜像 fixture 下 `readRoutesConfig(...).effective` 与 `resolveRoute` 的 route/source 逐字段相等（含 session/default/legacy 回落各一例）。
- [ ] **Step 2: 跑测试、确认失败** —— `node --test tests/dispatch.spec.mjs`，Expected: FAIL（模块不存在）
- [ ] **Step 3: 实现 `lib/dispatch.mjs`** —— 从 `lib/state.mjs` `git mv` 式平移上述函数（state.mjs 暂时 re-export，Task 4 再删）；`startChild` 从 `tools/index.js` 的 `startChild` 平移，参数改为显式传 `subagents` 服务。
- [ ] **Step 4: 跑全部测试确认通过且旧行为不变** —— `node --test tests/*.spec.mjs`，Expected: 新 4 条 PASS、其余全绿（tools.spec 等不许红）。
- [ ] **Step 5: 提交** —— `feat(dispatch): 抽出路由解析与派发核心（行为不变的平移）`

### Task 2: lib/doc-contract.mjs —— 文档契约校验

**Files:**
- Create: `lib/doc-contract.mjs`
- Modify: `lib/state.mjs`（re-export，保持旧引用不破）
- Test: `tests/doc-contract.spec.mjs`

**Interfaces:**
- Consumes: `lib/state.mjs` 的 `PLAN_CONTRACT` / `planContractGaps` / `assertPlanContract` / `artifactSections` / `openDecisions`（平移）。
- Produces: `lib/doc-contract.mjs` 导出上述五个（签名不变）+ 新写 `acceptanceContractGaps(markdown: string) -> string[]`（空数组 = 齐全），规则**逐字**是 Global Constraints 第 5 条的 acceptance 半边：缺「验收」`##` 节 → gap；`- [ ]` 行少于 1 条 → gap；某条 `- [ ]` 行不含「检查」或「预期」→ 点名该行的 gap；`openDecisions` 非空 → 每条未决一 gap。

- [ ] **Step 1: 写失败测试**（`tests/doc-contract.spec.mjs`）：合格 plan / 缺 `## Review Focus` 的 plan / 合格 acceptance / 没有 `- [ ]` 的 acceptance / 一条 `- [ ]` 缺「预期」的 acceptance / 带「需要你裁决」节的 acceptance —— 六个 fixture 断言 gaps 内容（含点名行号文案的子串）。
- [ ] **Step 2: 跑测试、确认失败** —— `node --test tests/doc-contract.spec.mjs`，Expected: FAIL
- [ ] **Step 3: 实现 `lib/doc-contract.mjs`**（平移 + 新写 `acceptanceContractGaps`）。
- [ ] **Step 4: 跑测试确认通过** —— `node --test tests/doc-contract.spec.mjs`，Expected: 全 PASS；`node --test tests/*.spec.mjs` 全绿。
- [ ] **Step 5: 提交** —— `feat(contract): 文档契约校验独立成模块，新增 acceptance 契约`

### Task 3: tools/index.js 重写为两工具

**Files:**
- Rewrite: `tools/index.js`
- Test: `tests/tools.spec.mjs`（重写）；退役 `tests/command.spec.mjs`（`/smart` 命令与工作流提示词节删除）

**Interfaces:**
- Consumes: `lib/dispatch.mjs`（Task 1）、`lib/doc-contract.mjs`（Task 2）、`exec.arguments`（字段名是 `arguments` 不是 `args`）。
- Produces: 两个工具：
  - `smart_dispatch({role?: 'hand'|'review', prompt: string, label?: string}) -> {text, route, source}` —— role 缺省 `'hand'`；内部 `resolveRoute` 现读 → `startChild`；`route` 报实际用的 `{provider, model}`，`source` 报回落来源。
  - `smart_check_doc({path: string, kind?: 'plan'|'acceptance'}) -> {ok, kind, gaps}` —— kind 缺省按文件名推断（含 `-acceptance` → acceptance，否则 plan）；path 必须绝对路径（错误文案教给调用方）。
  - 两者都保留「子代理会话不许调」守卫（现状 `assertEnabled` 语义）；`inject` = `['tools']`；`escalatedEffort`/`supportedEffortsOf`/14 个 `smart_*` 工具/`commands`/`systemPrompt` 席位全部删除。

- [ ] **Step 1: 写失败测试**（重写 `tests/tools.spec.mjs`）：① 注册面恰为两个工具名（多一个少一个都红）；② `smart_dispatch` 的桩按 `startActivation` 真形状喂（`{name, callId, arguments}` 的 execution + 返回 `{childId, result, dispose}`，`result` 是**方法**），断言 `request.agentOptions` 里带 `{provider, model}`；③ 同一用例在只提供老契约 `start` 的桩上也过（双契约）；④ `smart_check_doc` 对缺 `## Review Focus` 的 plan 报 gap、对合格文件报 ok；⑤ 子代理会话调用被拒。
- [ ] **Step 2: 跑测试、确认失败** —— `node --test tests/tools.spec.mjs`，Expected: FAIL（新工具名不存在）
- [ ] **Step 3: 重写 `tools/index.js`** —— 只保留：`apply(ctx, rawConfig)` 注册两工具 + 守卫 + routeOf 薄封装（回落链逻辑来自 dispatch.mjs）；删除面按 Files 节。
- [ ] **Step 4: 跑测试确认通过** —— `node --test tests/*.spec.mjs`，Expected: tools.spec 全 PASS，**退役的 command.spec 不再在清单里**（`ls tests/` 后确认已删），其余绿。
- [ ] **Step 5: 提交** —— `feat(tools)!: 工具面收缩为 smart_dispatch + smart_check_doc（14 个 smart_* 工具与 /smart 命令删除）`

### Task 4: 删状态机 lib/state.mjs

**Files:**
- Delete: `lib/state.mjs`
- Delete: `tests/workflow.spec.mjs`、`tests/briefings.spec.mjs`、`tests/execute.spec.mjs`、`tests/gates.spec.mjs`、`tests/state.spec.mjs`、`tests/command.spec.mjs`
- Modify: `tests/seams.mjs`（删工作流桩，留 routes/dispatch 桩）

**Interfaces:**
- Consumes: Task 1/2 已平移的函数（state.mjs 里此刻只剩工作流状态机与 re-export）。
- Produces: 无新接口。判据：`grep -rn "state\.mjs" --include='*.js' --include='*.mjs' .`（排除 node_modules）为空。

- [ ] **Step 1: 确认平移完备** —— `grep -nE "from '.*state\.mjs'" tools/index.js lib/*.mjs index.js panel/*.mjs`，Expected: 只剩 re-export 自身（若有遗漏先回 Task 1/2 补平移）。
- [ ] **Step 2: 删文件并跑全套** —— 删 Files 节列出的 7 个文件后 `node --test tests/*.spec.mjs`，Expected: 剩余 spec 全绿。
- [ ] **Step 3: 断言无残留** —— 上面 Produces 里的 grep 判据 + `grep -rn "smart_begin\|smart_artifact" tools/ lib/` 为空。
- [ ] **Step 4: 提交** —— `refactor!: 删除工作流状态机（2389 行）与配套测试（93 用例）`

### Task 5: 面板收缩为模型路由卡

**Files:**
- Modify: `src/client/index.tsx`、`src/client/workbench-css.ts`（删任务树 / 门芯片 / 裁决卡视图及其样式，保留模型路由卡与 `data-fly-smart-field` 表单）
- Delete: `panel/reader.js`
- Modify: `index.js`（`ENDPOINTS` 只留 `/fly/smart/routes`；删任务定位相关导出如 `locateTask`/`workspaceRootFromSession`——以 `grep` 实际引用为准，无消费者即删）、`package.json` files[]（去 `panel/reader.js`，加 `lib/dispatch.mjs`、`lib/doc-contract.mjs`）
- Test: `panel/tests/routes.spec.mjs` 保留、`panel/tests/contract.spec.mjs` 收缩

**Interfaces:**
- Consumes: `panel/routes.mjs` 的 `readMirrorDocument`/`updateMirror`/`resolveHand`/`resolveReview`（不动）。
- Produces: 面板 DOM 契约收缩为：模型路由卡（default / session 两 scope 的 hand、review 输入与保存）；**反向断言**：客户端包里不再出现 `data-phase-status`、`data-selected`（任务树）、gate/decision 样式段（`grep` 钉子进 `panel/tests/contract.spec.mjs`）。

- [ ] **Step 1: 写失败测试** —— `panel/tests/contract.spec.mjs` 加断言：构建产物里无 `data-phase-status`、无 `data-selected`、无 gate chip 样式段；模型路由卡的 `data-fly-smart-field` 仍在。Expected: FAIL（现状都还在）。
- [ ] **Step 2: 删 UI 与 reader.js**，跑 `pnpm build:clients` 重建 `lib/client.js`（**必须重建**，打包链装的是它）。
- [ ] **Step 3: 跑测试确认通过** —— `node --test panel/tests/*.spec.mjs` + `node scripts/verify-smart.mjs`，Expected: 全绿（verify-smart 若有断 reader.js 的检查随收口任务改，此处允许它红到 Task 8？—— **不允许**：本任务内同步改 `verify-smart.mjs` 里引用 reader.js 的检查项，保持每步绿）。
- [ ] **Step 4: 提交** —— `feat(panel)!: 面板收缩为模型路由卡（任务树/门/裁决视图与 reader 删除）`

### Task 6: skills 引用清洗 + 产物约定改写

**Files:**
- Modify: `assets/smart-skills/SKILL.md`、`assets/smart-plan/SKILL.md`、`assets/smart-verify-claim/SKILL.md`、`assets/smart-diagnose/SKILL.md`、`assets/smart-tdd/SKILL.md`、`assets/smart-debug/SKILL.md`、`assets/smart-review-receive/SKILL.md`、`assets/smart-parallel/SKILL.md`、`assets/smart-worktree/SKILL.md`、`assets/smart-write-skill/SKILL.md`
- Test: `scripts/verify-smart.mjs` 加一条检查（Global Constraints 第 6 条的 grep 钉子）

**Interfaces:**
- Consumes: Task 3 的工具名面（`smart_dispatch`/`smart_check_doc`）；Global Constraints 第 4/5 条的产物约定。
- Produces: 每个技能零死引用（钉子判据）；路由指引只出现 `hand`/`review` 两个角色名（**删 `lite`**，配置面不存在）；`smart-plan` 落盘节改为 `docs/plans/` 两份制；`smart-verify-claim` 的「与 smart 工作流的关系」段改写为「收尾报告就是 execution report + review 的合体，落不落盘按需」；`smart-diagnose` 主题从「smart 会话/门故障」**收窄**为「模型路由 / smart_dispatch 派发问题诊断」（保留技能，换对象）；`smart-skills` 的「什么时候才开 smart 任务」表改写为「什么时候写 plan/acceptance 文件」。

- [ ] **Step 1: 写失败的钉子** —— `scripts/verify-smart.mjs` 加检查：`assets/` 下命中 Global Constraints 第 6 条的正则即红。Expected: FAIL（现状大量命中）。
- [ ] **Step 2: 逐技能清洗** —— 按 Produces 逐个改写（一技能一 commit 可并）。
- [ ] **Step 3: 跑钉子 + 走查** —— `node scripts/verify-smart.mjs` 绿；逐技能通读派发段，确认指挥的工具都存在（这一步是人工走查，结论写进提交信息）。
- [ ] **Step 4: 提交** —— `docs(skills): 引用清洗与产物约定（docs/plans 两份制），技能面与 0.3.0 工具面对齐`

### Task 7: 设计期技能四件套 `smart-brainstorm` / `smart-design` / `smart-adr` / `smart-review`

> **执行结果（最终）**：四个技能全部交付（用户两轮点齐：brainstorm / adr / review，后补 design ——
> 「只做 adr/brainstorm/plan 不做 design」正是设计期链条的断点：设计定形状，ADR 记理由，计划拆步骤。）中途的弯路如实记录：我曾按 `smart-write-skill` 的
> 「无失败测试不写指导」把 `smart-review` 取消交付（提交 `17cba9f`），又把 `smart-brainstorm` /
> `smart-adr` 的引用当死引用清掉 —— **这是误判**：瘦身的范围是工作流（状态机 / 门 / 14 工具），
> 不是技能面；本计划与「保留完整技能面」的验收口径都要求它们存在。用户裁决后补回，
> 并加了第二条钉子（技能不许引用不存在的技能），它第一条就红了 3 处悬空引用。
> RED 基线的记录仍有价值（它说明清单纪律本身就是能力），保留不删。

**Files:**
- Create: `assets/smart-review/SKILL.md`
- Modify: `assets/smart-skills/SKILL.md`（技能目录列入本技能）；`scripts/verify-smart.mjs`（死引用钉子自动覆盖新技能，无需新检查）

**Interfaces:**
- Consumes: `smart_dispatch`（Task 3，`role: 'review'` 派独立评审子代理）；`smart-verify-claim` 的终态语言（**对齐不重复定义**：发现三档 = 阻塞 / 非阻塞 / 需要裁决，与「发现对账」的终态表同构）。
- Produces: `assets/smart-review/SKILL.md` —— frontmatter 只带 `name: smart-review` 与 `description`（"Use when" 开头、只写触发条件、<500 字符）；正文含：触发面（**代码 diff 与 计划/产物 都审**，一套核心纪律 + 按对象换 checklist）、四条核心纪律（证据先于判词：每条发现带复现步骤或 `文件:行`+实读数；三档分级；不表演式挑刺——spec 的沉默不是允许坏掉；评审报告固定形状：阻塞问题 → 非阻塞建议 → 已核对项 → 结论三态）、派发指引（重大交付走 `smart_dispatch(role: 'review')`；自审切「别人提交的 diff」视角）。
- 命名裁决（2026-10-29）：与 `smart-review-receive` 成对**不改名**。

- [ ] **Step 1: RED —— 不带技能跑评审压力场景**：一份埋着 3 个真缺陷的 diff + 一份缺 `## Review Focus` 的计划，叠加社交压力（"这代码看着没问题吧，快下班了"）；用 `subagent` 全新上下文跑，**逐字**记录基线行为与借口（预期失败形状：橡皮图章式同意、无证据断言、只挑格式、spec 沉默处不审）。
- [ ] **Step 2: GREEN —— 写最小技能**：只针对 Step 1 观测到的失败写 `SKILL.md`；同一场景复测，Expected: 发现进「阻塞/非阻塞/需要裁决」节且每条带复现或 `文件:行`。
- [ ] **Step 3: REFACTOR —— 堵新借口**：复测中出现的新借口逐字记下、加显式反制（合理化表 / Warning Signs），再测至无懈可击。
- [ ] **Step 4: 走查与钉子** —— `node scripts/verify-smart.mjs` 绿（含死引用钉子）；对照 Task 3 的两工具面走查派发段。Expected: 全绿。
- [ ] **Step 5: 提交** —— `feat(skills): 新增 smart-review —— 执行评审（代码与产物都审），含基线/复测记录`

### Task 9: `smart-execute` —— 执行纪律（台账 / 压缩生存 / 裁定 / 终审） —— **已交付**（148 行）

**背景**：删工作流时把"怎么执行一份计划"连同 `smart_execute` 一起删了，而这正是上游
`executing-plans`（321 行）+ `subagent-driven-development`（336 行）的承重内容。**这是第三次
"把方法论当承载形式删掉"**（前两次：review、design）。本次按上游 v7.0.1 移植并 DSH 化。

**Files:**
- Create: `assets/smart-execute/SKILL.md`
- Modify: `assets/smart-skills/SKILL.md`（入口表）、`assets/smart-plan/SKILL.md`（执行交接指向它）

**Interfaces:**
- Consumes: `smart-plan` 的 plan 文件（任务块 + 每步 `Expected:`）；`smart-worktree` 的隔离区；
  `smart-dispatch` 工具（`role: 'review'` 终审、`role: 'hand'` 派发执行）；`smart-verify-claim`
  的完成声明纪律；`smart-finish`（收尾）。
- Produces: 台账格式 `# exec ledger — plan: <path>` + `Task <N>: complete (commits <a>..<b>, tests: … → …)`
  + `Task <N>: Ruling: <what> — <why> — <cost if wrong>`；终审三档处理契约；收尾交接。

- [ ] **Step 1: 写 SKILL.md** —— 两模式（内联 / 派发）+ 台账 + 压缩生存 + per-task 循环 + 完成契约 +
  Rulings not stalls + 只四种停 + 终审（派 review 路由 / 自审如实标注）+ 收尾交接。
- [ ] **Step 2: 台账位置与 gitignore 说明** —— `.dsh-fly/exec/<plan-basename>/progress.md`，
  写明"scratch 目录，git clean -fdx 会毁掉它，从 git log 恢复"。
- [ ] **Step 3: 引用接线** —— smart-skills 入口表加"执行计划"；smart-plan 的执行交接指向本技能。
- [ ] **Step 4: 钉子与名单** —— `verify-smart` 悬空引用钉子绿；`panel/tests/contract.spec.mjs` 名单加 `smart-execute`。
- [ ] **Step 5: 提交** —— `feat(skills): 新增 smart-execute —— 执行纪律（台账/压缩生存/裁定/终审）`

### Task 10: `smart-finish` —— 分支收尾与集成 —— **已交付**（135 行）

**背景**：上游 `finishing-a-development-branch`（225 行）的等价物 `smart_finish` 随工作流删除。
现在跑完计划就没有下一步指导：合并？开 PR？留着？清理什么？

**Files:**
- Create: `assets/smart-finish/SKILL.md`
- Modify: `assets/smart-skills/SKILL.md`、`assets/smart-execute/SKILL.md`（收尾指向）

**Interfaces:**
- Consumes: `smart-execute` 的终审结论与台账（rulings / deferred minors）；`smart-worktree` 的
  环境探测判据（`GIT_DIR` vs `GIT_COMMON`、detached HEAD）。
- Produces: 固定三选项（本地合并 / 推送开 PR / 保留分支）+ detached HEAD 两选项；合并后验证与清理顺序。

- [ ] **Step 1: 写 SKILL.md** —— 先验证测试（失败就停）→ 探测环境 → 确认基线分支 → 三选项逐字给出 →
  执行（本地合并先验证再清理；PR 推送；保留）。清理只删**我们建的** worktree；丢弃只在用户明确要求时。
- [ ] **Step 2: 接线与名单** —— smart-skills、smart-execute 尾段指向；contract.spec 名单加 `smart-finish`。
- [ ] **Step 3: 提交** —— `feat(skills): 新增 smart-finish —— 分支收尾与集成`

### Task 11: `smart-brainstorm` 补 v7 对话手艺 —— **已交付**（62 → 115 行）

**背景**：上游 v7.0.0 重写了 brainstorming（294 行），v7.0.1 再调优：先挖上下文再问、问好问题、
只在自主启动时提供"跳过问题"。其"approaches + 设计文档 + 批准才动工"正是我们
brainstorm→design 链条的英文版 —— 方向被验证，缺的是**对话手艺**。我们现有 62 行只有决策表。

**Files:**
- Modify: `assets/smart-brainstorm/SKILL.md`（62 → ~120 行）

**Interfaces:**
- Consumes: 仓库/文件/spec 的真实内容（先读再问）；`smart-design`（批准后交形状）。
- Produces: 首条消息形状（复述请求 + 查到什么 + 一个开放点）；approaches 段（= 决策表）；
  spike 模式；Size the Work（小改动短文档）；"跳过问题"只在自主启动时提供。

- [ ] **Step 1: 改写 SKILL.md** —— 保留决策表四列作为 approaches 段；新增"先看再问""首条消息形状"
  "问好问题（后续问题建立在答案上、说明答案会改变什么）""approval before building""spike""size the work"。
- [ ] **Step 2: 与 design 的交接收紧** —— 批准的是**方案**，形状交给 `smart-design`；写清两者边界。
- [ ] **Step 3: 提交** —— `feat(skills): smart-brainstorm 补 v7 对话手艺（先看再问 / approaches / 批准才动工）`

### Task 12: 长技能拆 `references/`（渐进披露） —— **已交付**（tdd 334→233 / debug 320→246 / write-skill 278→239）

**背景**：上游 v7.0.1 因 Claude Code 20k 字符截断把长技能支撑内容挪进 `references/` 按需读
（一次真实事故：SDD 丢了五轮上限，单任务跑了 18 轮）。DSH 没有该截断，但"省上下文、按需加载"
的账一样成立；我们自己的写技能守则也要求正文 < 500 行、超了拆文件。

**Files:**
- Modify: `assets/smart-tdd/SKILL.md`（333 行）、`assets/smart-debug/SKILL.md`（319 行）
- Create: `assets/smart-tdd/references/*.md`、`assets/smart-debug/references/*.md`
- Modify: `scripts/verify-smart.mjs`（新钉子：SKILL.md 里引用的 `references/x.md` 必须存在）

**Interfaces:**
- Consumes: 两份技能的现有正文（逐字搬移，不重写内容）。
- Produces: 正文当索引（保留可执行纪律、指向 references）；引用只一层深；钉子判据
  `references/<file>.md` 存在且被正文引用。

- [ ] **Step 1: 写钉子（先红）** —— 正文里 `references/x.md` 不存在即红；现有两份技能会被判绿（还没引用），
  故同时加"正文超过 240 行必须至少有一个 references/"的另一条 —— 先红再拆。
- [ ] **Step 2: 拆 smart-tdd** —— 把 tests-as-design、断言风格、常见反例等搬进 references，正文留流程。
- [ ] **Step 3: 拆 smart-debug** —— 把根因调查的长案例、语言特定技巧搬进 references，正文留流程。
- [ ] **Step 4: 门禁与提交** —— 两条钉子绿；`feat(skills): 长技能拆 references（渐进披露）`

### Task 13: 收口 —— 文档、门禁、版本、打包

**Files:**
- Modify: `README.md`（能力清单改写）、`docs/internals.md`、`scripts/verify-smart.mjs`（28 条里与工作流/reader/state 相关的检查项替换）、`package.json`（`version: 0.3.0`）、`cordis.patch.yml`（核对：tools 子路径行指向不变，其余行无工作流残留）
- Test: `npm pack` 核对（资产进包纪律）

**Interfaces:**
- Consumes: Task 1–7 的全部产物。
- Produces: `node scripts/verify-smart.mjs` 全绿；`npm pack` 的 tarball 里 `assets/**/SKILL.md` 与仓库逐字节一致、含 `lib/dispatch.mjs`/`lib/doc-contract.mjs`、不含 `panel/reader.js`；README 的「已知限制」记录 A7（0.2.x 会话调旧工具的失败形状）。

- [ ] **Step 1: 改 README / internals** —— 能力清单 = 模型路由面板 + 11 技能 + `smart_dispatch`/`smart_check_doc`；删除工作流叙事。
- [ ] **Step 2: 改 verify-smart 检查项** —— 与 `node scripts/verify-smart.mjs` 逐条对齐现状；跑至全绿。
- [ ] **Step 3: 版本 0.3.0 + pack 核对** —— `npm pack` 后按 Produces 逐项核对（**先 assert 再打印**）。
- [ ] **Step 4: 全量验证** —— `node --test tests/*.spec.mjs && node --test panel/tests/*.spec.mjs && node scripts/verify-smart.mjs`，Expected: 全绿、退出码 0。
- [ ] **Step 5: 提交** —— `git status` 干净（除待提交改动）后 `chore(release): 0.3.0 —— 瘦身版：模型配置 + 技能 + 按路由派发`。
- [ ] **Step 6: 交付** —— 停在本地提交，push 与打 tag（= 发 npm）等用户点头。
