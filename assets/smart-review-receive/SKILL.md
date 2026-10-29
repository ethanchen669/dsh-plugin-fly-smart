---
name: smart-review-receive
description: Use when 收到代码评审意见、评审建议或 review 反馈，在动手改之前加载：先核实再实现，不许表演式同意、不许盲改。
---

<!-- Ported from obra/superpowers skills/receiving-code-review/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# 接收代码评审

## 概述

代码评审要求的是技术评估，不是情绪表演。

**核心原则：Verify before implementing. Ask before assuming. Technical correctness over social comfort.**（先核实再实现。先问清再假设。技术正确性高于社交舒适。）

## The Response Pattern（响应模式）

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

六步展开：
1. **READ（读完）**：完整读完反馈再反应，不许读到一半就动手。
2. **UNDERSTAND（复述）**：用自己的话复述要求；复述不出来就是没懂，去问。
3. **VERIFY（核实）**：对照代码现实 —— 用 `read` / `grep` / `glob` 去看**真实的代码**，不是凭印象、不是凭评审者的措辞。
4. **EVALUATE（评估）**：对**这个**代码库是否成立？（不是对教科书成立。）
5. **RESPOND（回应）**：技术性认可，或者有理有据地推翻。
6. **IMPLEMENT（实现）**：一次一条、逐条测试。

## Forbidden Responses（明令禁止的回答）

**NEVER（核实之前）：**
- `"You're absolutely right!"` —— *explicit instruction-file violation*
- `"Great point!"` / `"Excellent feedback!"` —— *performative*
- `"Let me implement that now"`（在核实之前）—— *performative*

以上是禁语清单，逐字对照；改一个词、换个语言说同一件事，同样违规。

**INSTEAD（该做的）：**
- Restate the technical requirement —— 复述技术要求
- Ask clarifying questions —— 提出澄清问题
- Push back with technical reasoning if wrong —— 错了就用技术理由推翻
- Just start working (actions > words) —— 直接动手，行动大于表态

## Handling Unclear Feedback（处理不清晰的反馈）

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**例子：**
```
用户："把 1-6 都修了"
你懂 1、2、3、6，对 4、5 没把握。
❌ WRONG: 先把 1,2,3,6 改了，4,5 稍后再问
✅ RIGHT: "1、2、3、6 我理解了。动手前需要先澄清 4 和 5。"
```

## Handling Wrong Feedback（处理错误的反馈）

### 来自你的用户

- **可信** —— 理解之后就实现
- 但**范围不清仍然要问**
- **不许表演式同意**
- 直接跳到行动，或者给一句技术性回应

### 来自外部评审（评审工具、其他智能体、代码审查评论）

```
BEFORE implementing:
  1. Check: Technically correct for THIS codebase?
  2. Check: Breaks existing functionality?
  3. Check: Reason for current implementation?
  4. Check: Works on all platforms/versions?
  5. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF can't easily verify:
  Say so: "I can't verify this without [X]. Should I [investigate/ask/proceed]?"

IF conflicts with your user's prior decisions:
  Stop and discuss with your user first
```

**用户的规则：**"外部反馈 —— 保持怀疑，但认真核实。"

### YAGNI Check（对"专业一点"的功能建议）

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage        # 用 grep / glob 查真实调用

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

**用户的规则：**"你和评审者都向我汇报。如果我们不需要这个功能，就不要加。"

## When To Push Back（何时推翻）

在这些情况下推翻：
- 建议会破坏既有功能
- 评审者没有掌握完整上下文
- 违反 YAGNI（没人用的功能）
- 对这个技术栈来说技术上不对
- 存在遗留 / 兼容性原因
- 与用户已定的架构决策冲突

**怎么推翻：**
- 用技术理由，不用防御姿态
- 提具体问题
- 引用能跑的测试 / 现有代码
- 架构级的问题，拉用户进来

**如果你不好意思当面推翻：**把这份张力说出来，然后把看到的问题告诉用户。他们会感谢你的诚实。

## Handling Good Feedback（处理正确的反馈）

反馈确实正确时：
```
✅ "Fixed. [简述改了什么]"
✅ "Good catch - [具体问题]. Fixed in [位置]."
✅ [直接改掉，让代码自己说话]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
❌ "Thanks for [anything]"
❌ ANY gratitude expression（任何形式的感谢）
```

**为什么不许道谢：**行动说话。改掉就行。代码本身证明你听到了反馈。

**如果你发现自己正要打出 "Thanks"：**删掉它，改成陈述修复本身。

## Gracefully Correcting Your Pushback（推翻错了就体面地纠正）

如果你推翻之后发现自己错了：

```
✅ "You were right - I checked [X] and it does [Y]. Implementing now."
✅ "Verified this and you're correct. My initial understanding was wrong because [reason]. Fixing."

❌ 长篇道歉
❌ 为自己为什么推翻而辩护
❌ 过度解释
```

陈述纠正的事实，然后继续干活。

## Implementation Order（实现顺序）

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Then implement in this order:
     - Blocking issues (breaks, security)      # 阻塞性问题
     - Simple fixes (typos, imports)           # 简单修复
     - Complex fixes (refactoring, logic)      # 复杂修复
  3. Test each fix individually                 # 逐条测（bash 跑测试）
  4. Verify no regressions                      # 确认没有回归
```

实现动作用 `edit` / `write`，改之前先 `read` 目标文件，改之后用 `grep` 核对改动确实落盘。

## Common Mistakes（常见错误对照）

| Mistake（错误） | Fix（正确做法） |
|---------|-----|
| Performative agreement | State requirement or just act |
| Blind implementation | Verify against codebase first（先用 `read`/`grep` 核实） |
| Batch without testing | One at a time, test each |
| Assuming reviewer is right | Check if breaks things |
| Avoiding pushback | Technical correctness > comfort |
| Partial implementation | Clarify all items first |
| Can't verify, proceed anyway | State limitation, ask for direction |

## Real Examples（真实例子）

**表演式同意（坏）：**

```
评审："Remove legacy code"
❌ "You're absolutely right! Let me remove that..."
```

**技术性核实（好）：**

```
评审："Remove legacy code"
✅ "Checking... build target is 10.15+, this API needs 13+. Need legacy for backward compat.
   Current impl has wrong bundle ID - fix it or drop pre-13 support?"
```

**YAGNI（好）：**

```
评审："Implement proper metrics tracking with database, date filters, CSV export"
✅ "Grepped codebase - nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**不清晰的条目（好）：**

```
用户："把 1-6 都修了"
你懂 1、2、3、6，对 4、5 没把握。
✅ "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

## 评审线程里的回复

在 PR / 评审线程里回复行内评论时，回到**那条评论线程**里回复（`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`），不要发一条顶层评论。

## 与 smart 工作流的关系

`smart_dispatch({ role: 'review' })` 收回的评审意见、`smart_check_doc` 报出的契约缺口、用户在讨论中提的修改要求 —— 都按本技能处理。**推翻一条评审要有技术论据，采纳一条要复述你改了什么**；不许用「你说得对」糊过去。
