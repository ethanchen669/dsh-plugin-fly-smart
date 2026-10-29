# fly-smart 瘦身 验收契约

对应计划：[2026-10-29-slim-fly-smart.md](2026-10-29-slim-fly-smart.md)。
本文件自身受 acceptance 契约约束（`smart_check_doc` 校验：含「验收」节、每条标准带「检查」与「预期」、无未决「需要你裁决」）。

## 验收标准

- [ ] **A1 工具面恰为两个** —— 检查：`node --test tests/tools.spec.mjs`（注册面断言）+ `grep -c "name: 'smart_" tools/index.js`；预期：测试绿且计数为 2（`smart_dispatch`、`smart_check_doc`）。
- [ ] **A2 派发按面板路由选模型** —— 检查：`tests/dispatch.spec.mjs` 的 preset/session/default/legacy 回落四例 + 懒读用例；预期：全 PASS，且两次 resolveRoute 之间改镜像后第二次读到新值。
- [ ] **A3 双子代理契约都活** —— 检查：`tests/tools.spec.mjs` 里 `startActivation` 桩与 `start` 桩各一组；预期：两组都 PASS，`request.agentOptions` 带 `{provider, model}`。
- [ ] **A4 文档契约 linter 可用** —— 检查：`node --test tests/doc-contract.spec.mjs` + 对本验收文件跑 `smart_check_doc`；预期：测试六 fixture 全 PASS；本文件报 `ok: true`。
- [ ] **A5 状态机与工作流测试全无残留** —— 检查：`ls lib/state.mjs tests/{workflow,briefings,execute,gates,state,command}.spec.mjs 2>&1` + `grep -rn "from '.*state\.mjs'" tools/ lib/ index.js panel/`；预期：文件全部 Not found、**没有任何 import**（说明性注释允许提及该模块已删除，那不是残留）。
- [ ] **A6 面板只剩模型路由卡** —— 检查：`node --test panel/tests/contract.spec.mjs` 的反向断言（客户端源码里无 `/tasks`、`artifactTabs`、`reworkBudgetOf`、`data-probe="board"`；构建产物里无 `/fly/smart/tasks`）+ `data-fly-smart-field` 在场；预期：全 PASS、`lib/client.js` 已重建。**注**：`workbench-css.ts` 是设计系统的逐字节副本（`sync-panel-style.mjs --check` 在门禁里比对），其中的 `data-phase-status` 规则属于共享库，故反向断言打在客户端源码与产物上，不打在 CSS 上。
- [ ] **A7 升级失败形状可读** —— 检查：README「已知限制」节存在且写明 0.2.x 会话调 `smart_begin` 等旧工具会得到 unknown tool；预期：文档逐字说明，无「工具仍可用」类误导。
- [ ] **A8 技能零死引用** —— 检查：`node scripts/verify-smart.mjs`（assets 死引用钉子）+ 人工走查十四个技能的派发段；预期：钉子绿；每个技能指挥的工具名都存在于 Task 3 的两工具面（走查结论写进提交信息）。
- [ ] **A9 存量数据零改动** —— 检查：`shasum ~/.dsh-fly/smart-routes.json` 与开工前记录比对 + `git -C ~/ai-workspace/dsh-fly status docs/smart`；预期：镜像哈希不变（除非用户在面板上保存过路由）、docs/smart 无 diff。
- [ ] **A10 打包完整性** —— 检查：`npm pack` 后 tar 清单核对；预期：含 `lib/dispatch.mjs`、`lib/doc-contract.mjs`、`assets/**/SKILL.md`（与仓库逐字节一致），不含 `panel/reader.js`、不含 `lib/state.mjs`。
- [ ] **A11 全量门禁** —— 检查：`node --test tests/*.spec.mjs && node --test panel/tests/*.spec.mjs && node scripts/verify-smart.mjs`；预期：全绿，退出码 0。
- [ ] **A12 设计期能力不缩水（用户裁决，2026-10-29）** —— 检查：`ls assets/{smart-brainstorm,smart-design,smart-adr,smart-review}/SKILL.md` + 两条钉子（已删工具死引用 / 悬空技能引用）+ `panel/tests/contract.spec.mjs` 的技能名单（14 个）；预期：四个技能都在、内容各自承载工作流退役前的阶段契约（决策表 / 设计五问 / ADR-lite 五段 / 三档评审）、钉子绿、名单齐。**注**：瘦身的范围是**工作流**（状态机 / 门 / 14 工具），不是技能面；此前把 `smart-review` 按"RED 未复现失败"取消交付属于误判——计划里写明要交付它，我按测试纪律单方面砍掉，与"保留完整技能面"的验收口径冲突。

## 覆盖说明

计划 Review Focus 第 3 条（升级现场失败形状）没有自动化测试可钉，落在 A7 的文档级验收；其余四条各有对应测试（A2、A3、A8、A2 的一致性断言）。

## 执行证据（2026-10-29，0.3.0）

| 项 | 结果 |
| --- | --- |
| A1 | `node --test tests/tools.spec.mjs` 7/7 绿；`grep -c "name: 'smart_" tools/index.js` = **2** |
| A2 | `tests/dispatch.spec.mjs` 11/11 绿（含懒读：两次 resolveRoute 之间改镜像，第二次读到新值；与宿主面逐字段对拍） |
| A3 | `tests/tools.spec.mjs` 的 `activationStub` 与 `startStub` 两组都绿，`request.agentOptions` = `{provider, model}` |
| A4 | `tests/doc-contract.spec.mjs` 9/9 绿；本文件与计划文件跑 linter 均「契约齐全」 |
| A5 | `lib/state.mjs` 与 6 个工作流 spec 全部 Not found；`from '…state.mjs'` 的 import 为 0 |
| A6 | `panel/tests/contract.spec.mjs` 8/8 绿（含反向断言）；`lib/client.js` 已重建（53 KB） |
| A7 | README「已知限制」三条：0.2.x 会话调旧工具得 unknown tool、子代理不能派发、`smart_check_doc` 只做机械判据 |
| A8 | 死引用钉子绿；10 个技能全部指向现存工具面 |
| A9 | `~/.dsh-fly/smart-routes.json` mtime 仍为 10-20；`~/.dsh-fly/smart/` 未动；`dsh-fly/docs/smart` 无本次改动 |
| A10 | `npm pack` 后逐项核对：含 dispatch/doc-contract/tools/panel routes、不含 reader/state/tests；10 个 SKILL.md 与仓库**逐字节一致** |
| A11 | 61 个测试全绿 + `verify-smart` **32/32** |
| A12 | ✅ 四个技能已交付：`smart-brainstorm`（决策表）、`smart-design`（五问定形状）、`smart-adr`（ADR-lite 五段）、`smart-review`（三档评审 + 反橡皮图章「已核对」节）；技能名单 14 个、两条钉子绿 |
