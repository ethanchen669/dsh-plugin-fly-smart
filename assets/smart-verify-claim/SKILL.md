---
name: smart-verify-claim
description: Use when 即将声称工作已完成、已修复、测试通过、可以进下一步、可以提交或创建 PR，在做出任何成功声明之前加载：证据先于断言。也用于收尾交付：中途发现的问题（helper 缺陷、绕过的坑、覆盖缺口、替需求方定的口径）不许在报告里静默消失。
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
5. RECONCILE: 逐条对账本次所有发现（见「发现对账」），每条有终态
6. ONLY THEN: Make the claim（携带交付自检报告）

Skip any step = lying, not verifying
```

## 发现对账（no silent drop）

你干活时发现的每个问题（helper 有缺陷、边界没测试、spec 与测试冲突、你替需求方定的口径），
**发现的当下**就登记为一条「发现」。收尾时逐条对账。
**思维链里的发现不是承诺；报告里没有的发现就是丢了。**

每条发现必须以恰好一种终态出现在报告里，**终态只许用这三种字，不许自造新词**（"已验但需知情""替需求方定的口径"都不是终态；口径类发现 = 需要裁决，再同步到「替需求方定的口径」节）：

| 终态 | 必须附带 |
|------|----------|
| 已修复 | 证据（命令 + 输出）；**缺陷在原地消失才算已修复** |
| 有意不修 / 绕过 | 原因、影响面、谁会踩到（"我在调用处兜住了"就是有意不修——helper 仍是坏的，下一个复用它的人会踩。**兜住 ≠ 已修复**） |
| 需要裁决 | 冲突双方原文、选项、你的推荐 |

不许第四种终态：消失。**测试全绿、代码能跑、不影响我这一版，都不是省略一条发现的理由。**
自己修不了的（别人模块、需求冲突）也要报——"这不是我的代码"不改变"这是你的发现"。

## 交付自检报告（固定形状）

任何收尾结论（"完成 / 能进下一步 / 可以提交"）必须携带下面四节。
某节为空，写"无"——**缺节 = 未交付**，"无"与缺节不是一回事。

```
### 需求覆盖
| 需求 | 位置 | 状态 | 验证方式 |
（逐条对权威需求单；状态 = 已实现已验 / 已实现未验 / 未做）

### 发现对账
| 发现 | 终态 | 证据/原因 |

### 证据
本次实跑的命令与结果（测试、探针）；没跑过的东西不许出现在这节。

### 替需求方定的口径
| 口径 | 依据 | 需要谁点头 |
（实现中你替 spec 补的决定；"无"也要写）
```

结论句必须与四节一致：存在「需要裁决」项或未验需求时，不许说"可以无条件进下一步"。
**"报告要短"约束的是措辞，不是结构——四节一节不能少。**

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
- 收尾报告里只有"测试全绿 + 可以进下一步"，发现与裁决都不见了
- 你绕过了某个坑（兜底、短路、自己重写校验），报告里没提它
- 中途消息里说过的发现，收尾报告里没有
- 用"一句话结论 / 报告要短"躲开交付自检报告

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
| "报告要短 / 没人看长报告" | 简短的是措辞，不是结构；四节一节不能少 |
| "我在调用处兜住了，不算问题" | 兜住 = 有意不修，照报；helper 仍是坏的 |
| "那是同事的半成品，不是我的问题" | 你发现了它，它就是你的发现 |
| "小问题不值得占报告" | 大小由受话人判断，不由你 |
| "测试绿了就是验收过" | 测试只证明它盖到的部分；没盖的要报 |

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

**交付：**
```
✅ 交付自检报告四节齐全 → 结论句与四节一致 → 说"能进下一步"
❌ "7 pass / 0 fail，可以进下一步"（发现与裁决都没对账）
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
