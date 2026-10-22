---
name: smart-verify-claim
description: Use when 即将声称工作已完成、已修复、测试通过、可以提交或创建 PR，在做出任何成功声明之前加载：证据先于断言。
---

<!-- Ported from obra/superpowers skills/verification-before-completion/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# 完成声明之前先验证

## 概述

**核心原则：Evidence before claims, always.**

**Violating the letter of this rule is violating the spirit of this rule.**

## 铁律

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

如果你在**这条消息里**没有跑过验证命令，你就不能声称它通过。"上次是绿的"、"应该是好的"、"我记得没问题" —— 都不是证据。

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | `bash` diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags —— 停下

- 使用 "should" / "probably" / "seems to"
- 验证之前表达满意（"Great!"、"Perfect!"、"Done!" 等）
- 未经验证就想 commit / push / 开 PR
- 相信子代理的成功报告
- 依赖部分验证
- 心想"就这一次"
- 累了、想快点收工
- **任何暗示成功却没跑过验证的措辞**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | 独立验证：`bash` 看 diff，`read` 看产出 |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "换种说法就不算违规" | Spirit over letter |

## Key Patterns

**测试：**
```
✅ [跑测试命令] [看到: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**回归测试（TDD Red-Green）：**
```
✅ 写 → 跑(过) → 撤销修复 → 跑(必须红) → 恢复 → 跑(过)
❌ "我写了回归测试"（没做过红绿验证）
```

**构建：**
```
✅ [跑构建] [看到: exit 0] "Build passes"
❌ "Linter passed"（linter 不检查编译）
```

**需求：**
```
✅ 重读计划 → 列清单 → 逐条验证 → 报告缺口或完成
❌ "Tests pass, phase complete"
```

**子代理委派：**
```
✅ 子代理报告成功 → bash 看 diff → 验证改动 → 报告实际状态
❌ 相信子代理报告
```

DSH 工具面：跑命令用 `bash`，读产出用 `read`，改文件用 `write` / `edit`，找内容用 `grep`；
后台任务先 `job_list`、再用 `job_output` 收齐输出 —— **没读到输出 = 没跑过**。

## When To Apply

**ALWAYS before:**
- 任何成功 / 完成声明的变体
- 任何满意表达
- 任何关于工作状态的正面陈述
- 提交、开 PR、宣布任务完成
- 转向下一项任务
- 把工作委派给子代理

**Rule applies to:**
- 原句
- 改述与同义词
- 暗示成功的表述
- 任何暗示完成 / 正确的沟通

## 与 smart 工作流的关系

smart 工作流的 `smart_verify` 是这套纪律的工具化：它取证并把证据落成文件。但这条纪律适用于**任何**会话 —— 不需要开 smart 任务。
