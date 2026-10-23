---
name: smart-skills
description: Use when starting any task in this profile — establishes how to find and use the smart skills, requiring a skill check BEFORE any response including clarifying questions. 任何回应（含反问、看代码、查文件）之前先查技能。
---

<!-- Ported from obra/superpowers skills/using-superpowers/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# Smart 技能：先查，再动

<EXTREMELY-IMPORTANT>
如果你觉得某个技能**哪怕只有 1% 的可能**适用于手上的事，你就**必须**调用它。

技能适用时，你没有选择权。必须用它。

这不可谈判。你无法给自己找理由绕过去。
</EXTREMELY-IMPORTANT>

## 规则

**任何回应或动作之前先调用相关或被要求的技能** —— 包括反问、探索代码库、查看文件。
如果调用后发现不适用，你不必照它做。

**进入计划之前**：如果还没做过脑暴，先调用 `smart-brainstorm`。

然后声明「Using [技能名] to [目的]」，并逐条照技能执行。技能里有清单的，每条建一个 todo。

## 技能优先级

多个技能都适用时，**流程技能在前** —— 它们定路子，实现类技能再去执行。

- **「建个东西」**（加功能、做组件、改行为）→ 先 `smart-brainstorm`，再进工作流
- **「修个 bug」/ 行为不对** → 先 `smart-debug`，再决定要不要开任务
- **要写多步计划** → `smart-plan`
- **写任何生产代码之前** → `smart-tdd`
- **即将声称完成 / 测试通过** → `smart-verify-claim`
- **收到评审意见** → `smart-review-receive`
- **开始特性工作** → `smart-worktree`
- **2+ 个互不相干的任务** → `smart-parallel`
- **创建/修改技能** → `smart-write-skill`
- **某个 smart 会话出了问题**（卡住 / 门不开 / 重复派发 / 花太多）→ `smart-diagnose`

## 什么时候才开 smart 任务

技能是**独立的**，多数日常事不需要开任务：

| 你在做的事 | 该走 |
| --- | --- |
| 排查一个 bug、定位一个失败 | `smart-debug`（**不开任务**） |
| 写一小段代码 | `smart-tdd`（**不开任务**） |
| 看看这个 diff / 这段改动 | `smart_begin({ shape: 'review' })` |
| 修一处、要留证据 | `smart_begin({ shape: 'fix' })` |
| 调查个问题、出个结论 | `smart_begin({ shape: 'investigation' })` |
| 小改动 | `smart_begin({ size: 'light' })` |
| 完整交付一个功能 | `smart_begin({ shape: 'feature', size: 'full' })` |
| 写个技能 | `smart-write-skill`（**不开任务**） |
| 会话出了问题、想查为什么 | `smart-diagnose`（**不开任务**） |

**判断依据**：只有当这件事需要**别人的把关**（用户门 G1–G5）或**留档交付**时，才值得开任务。
排查、写测试、验证声明 —— 这些用技能就够。

## 你正在找借口

这些念头出现时**停**，你正在合理化：

| 想法 | 现实 |
| --- | --- |
| 「这只是个小问题」 | 问题是任务。查技能。 |
| 「我得先弄点上下文」 | 查技能在反问**之前**。 |
| 「让我先看看代码」 | 技能告诉你**怎么看**。先查。 |
| 「我可以快速看一眼 git/文件」 | 文件没有对话上下文。查技能。 |
| 「我先收集信息」 | 技能告诉你**怎么收集**。 |
| 「这个不需要正式技能」 | 有技能就用。 |
| 「我记得这个技能」 | 技能会演化。读当前版本。 |
| 「这不算任务」 | 动作 = 任务。查技能。 |
| 「用技能太重了」 | 简单事会变复杂。用它。 |
| 「我就先干这一件事」 | 干任何事**之前**先查。 |
| 「这感觉挺高效的」 | 没纪律的动作浪费时间。技能防这个。 |
| 「我知道那是什么意思」 | 懂概念 ≠ 用了技能。调用它。 |

## 模型选择

**技能本身跑在会话模型上**，改不了 —— 想让某个技能便宜，就在便宜模型的会话里跑它。

**技能派出去的子代理**按 route 选：

- 机械活（探索 / 取证 / 并行调查）→ `lite` 路由
- 多步推理、跨多文件理解 → `hand` 路由
- **评审永远走 `review` 路由**，不用 `lite`

记住 *"turn count beats token price"*：便宜模型在多步工作上常花 2–3 倍轮次，
总成本反而更高。纯机械、一步到位的才用 `lite`。

## 用户指令

用户的直接要求（AGENTS.md、会话里的明确指示）**优先于技能**，技能又优先于默认行为。
只有人类明确告诉你时，才可以跳过技能流程。
