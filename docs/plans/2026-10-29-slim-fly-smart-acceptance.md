# fly-smart 瘦身 验收契约

对应计划：[2026-10-29-slim-fly-smart.md](2026-10-29-slim-fly-smart.md)。
本文件自身受 acceptance 契约约束（`smart_check_doc` 校验：含「验收」节、每条标准带「检查」与「预期」、无未决「需要你裁决」）。

## 验收标准

- [ ] **A1 工具面恰为两个** —— 检查：`node --test tests/tools.spec.mjs`（注册面断言）+ `grep -c "name: 'smart_" tools/index.js`；预期：测试绿且计数为 2（`smart_dispatch`、`smart_check_doc`）。
- [ ] **A2 派发按面板路由选模型** —— 检查：`tests/dispatch.spec.mjs` 的 preset/session/default/legacy 回落四例 + 懒读用例；预期：全 PASS，且两次 resolveRoute 之间改镜像后第二次读到新值。
- [ ] **A3 双子代理契约都活** —— 检查：`tests/tools.spec.mjs` 里 `startActivation` 桩与 `start` 桩各一组；预期：两组都 PASS，`request.agentOptions` 带 `{provider, model}`。
- [ ] **A4 文档契约 linter 可用** —— 检查：`node --test tests/doc-contract.spec.mjs` + 对本验收文件跑 `smart_check_doc`；预期：测试六 fixture 全 PASS；本文件报 `ok: true`。
- [ ] **A5 状态机与工作流测试全无残留** —— 检查：`ls lib/state.mjs tests/{workflow,briefings,execute,gates,state,command}.spec.mjs 2>&1` + `grep -rn "state\.mjs" tools/ lib/ index.js panel/`；预期：文件全部 Not found、grep 为空。
- [ ] **A6 面板只剩模型路由卡** —— 检查：`node --test panel/tests/contract.spec.mjs`（无 `data-phase-status`/`data-selected`/gate 样式的反向断言 + `data-fly-smart-field` 在场）；预期：全 PASS，`pnpm build:clients` 产物已重建。
- [ ] **A7 升级失败形状可读** —— 检查：README「已知限制」节存在且写明 0.2.x 会话调 `smart_begin` 等旧工具会得到 unknown tool；预期：文档逐字说明，无「工具仍可用」类误导。
- [ ] **A8 技能零死引用** —— 检查：`node scripts/verify-smart.mjs`（assets 死引用钉子）+ 人工走查十一个技能的派发段；预期：钉子绿；每个技能指挥的工具名都存在于 Task 3 的两工具面（走查结论写进提交信息）。
- [ ] **A9 存量数据零改动** —— 检查：`shasum ~/.dsh-fly/smart-routes.json` 与开工前记录比对 + `git -C ~/ai-workspace/dsh-fly status docs/smart`；预期：镜像哈希不变（除非用户在面板上保存过路由）、docs/smart 无 diff。
- [ ] **A10 打包完整性** —— 检查：`npm pack` 后 tar 清单核对；预期：含 `lib/dispatch.mjs`、`lib/doc-contract.mjs`、`assets/**/SKILL.md`（与仓库逐字节一致），不含 `panel/reader.js`、不含 `lib/state.mjs`。
- [ ] **A11 全量门禁** —— 检查：`node --test tests/*.spec.mjs && node --test panel/tests/*.spec.mjs && node scripts/verify-smart.mjs`；预期：全绿，退出码 0。
- [ ] **A12 smart-review 技能到位** —— 检查：`ls assets/smart-review/SKILL.md` + `node scripts/verify-smart.mjs`（死引用钉子）+ 提交信息里的基线/复测记录；预期：技能存在、description 以 "Use when" 开头且只写触发条件、钉子绿；A/B 样例显示：无技能时基线出现橡皮图章/无证据断言/只挑格式 → 带技能时发现进「阻塞/非阻塞/需要裁决」节且每条带复现步骤或 `文件:行`。

## 覆盖说明

计划 Review Focus 第 3 条（升级现场失败形状）没有自动化测试可钉，落在 A7 的文档级验收；其余四条各有对应测试（A2、A3、A8、A2 的一致性断言）。
