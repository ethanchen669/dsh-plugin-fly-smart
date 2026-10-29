---
name: smart-adr
description: Use when 要把"为什么这么设计"落成记录——技术选型、架构取舍、契约形状、库 vs 自研、在动手实现或写计划的 Global Constraints 之前加载：ADR-lite 五段，决策记录属于做出选择的地方，不是事后叙事。
---

# 设计决策记录（ADR-lite）

## 概述

**核心原则：The decision record belongs where the decision is made.**（决策记录属于做出决策的地方。）
写下来的是**决定**，不是讨论过程。

## 铁律

```
AN ADR IS THE DECISION, NOT THE CONVERSATION
```

## ADR-lite（固定五段）

1. **Context** —— 为什么要做这个决定；约束是什么（引 `## Global Constraints` 的原文）。
2. **Options** —— 考虑过的方案（= `smart-brainstorm` 决策表的候选，含代价）。
3. **Decision & Why** —— 选了哪个、为什么；**错了代价是什么**（这一句最常被省略，也最有用）。
4. **Consequences** —— 这个决定让什么变简单、什么变难、什么被排除。
5. **Revisit trigger** —— 什么信号出现时要重开这个决定（"X 成为主流"/"性能不够"/"上游支持 Y"）。

规则：

- 决策表拍板后**立刻**写 ADR，不是实现完再补 —— 凭记忆补的"理由"是事后合理化。
- 每条决定都要有"错了代价"；没有代价的决定等于没想。
- 不写叙事（"我们一开始想…后来觉得…"）——那是 git log 的活，ADR 里不许出现。
- ADR 里的硬约束**逐字抄**进计划的 `## Global Constraints`，`smart_check_doc` 查得到。

## Red Flags —— 停下

- 五段分不出来，是一段散文
- 「Consequences」全是好处，没有代价
- 没有 Revisit trigger —— 这个决定永远不会被重新检查
- 实现完才补 ADR
- 写了三个选项但没有"Why"

## Rationalization Prevention

| 借口 | 现实 |
| --- | --- |
| "代码就是文档" | 代码说 what，不说 why；半年后没人答得出"当初为什么不那样" |
| "先实现，回头补记录" | 回头补的是事后合理化，不是当时的理由 |
| "这是小事不值得记" | 小事的 ADR 就五句话；只有大事才长篇 |
| "决定会变，记录会过期" | 正因为会变，才有 Revisit trigger 这一段 |
| "反正没人读" | 读它的人是三个月后改这块代码的你 |

## 与其它技能的关系

- **上游**：`smart-brainstorm` 的决策表拍板后写 ADR；ADR 的约束是 `smart-plan` 的 `## Global Constraints` 的来源。
- **下游**：实现改道、约束变化时按 Revisit trigger 重开 ADR（写新一份，不改旧的）。
