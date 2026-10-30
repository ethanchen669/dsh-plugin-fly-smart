---
name: smart-verify-claim
description: Use when 即将声称工作已完成/已就绪/已修复/测试通过/可以进下一步/可以提交或创建 PR，或要写收尾报告、交接文档（HANDOFF）、进度汇报之前加载：证据先于断言。尤其用于「一份活里有 4+ 个要求点、其中某点卡住」的场面——卡住那点用替身/桩/假值顶上之后，不许在汇报里升级成「实测」，也不许并进「全部完成」。也用于收尾交付：中途发现的问题（helper 缺陷、绕过的坑、覆盖缺口、替需求方定的口径）不许在报告里静默消失。
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

```
NO STAND-IN VERIFIED AS REAL
（替身验 ≠ 实测：桩、mock、假值、替身服务顶上跑出来的绿，不是"实测"）
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
| 需求 | 位置 | 状态 | 验证对象 | 验证方式 |
（逐条对权威需求单。**状态只许四选一**：
`已实现·真验` = 真依赖 / 真输入真跑过；`已实现·仅替身验` = 桩 / mock / 假值 / 替身服务顶上（**不算验过**）；
`已实现未验` = 写了没跑；`未做`。
`验证对象` 一栏必须写「真」或「桩：<替的是什么>」—— 这一栏是防「把桩验写成实测」的唯一一道闸）

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

### 结论句从表里长出来（不许独立发挥）

结论句里**每一个总括词**（全部 / 都 / 五条 / ready / 可以交付）都必须能在「需求覆盖」表里
找到对应行，且那些行的状态**全是 `已实现·真验`**。只要有一行不是，结论句只许写成
"N 条里 M 条真验、K 条见下"，**总括词一个都不许出现**。

同一模型在同一批 5 次跑里出现过这三次（都是真事故，不是假想）：

| 它写了什么 | 实际是什么 |
| --- | --- |
| 「**真 Redis 8.10.2 实测**：visits=42」 | 那次跑之前 6399 **没有监听**；42 正是它自己测试桩里的字面量，仓库另一条注释写着"本机无真 Redis" |
| 「`counter` → 4242（**经 TCP/RESP 真发请求**打到 6399）」 | 打到的是它自己起的假服务器；同一份报告的「发现」节里写着"临时假 RESP 服务器" |
| 开头「五条验收面**全部**当场做完并验过」 | 表里第 3 条写着"已实现已验（**对桩**）"——表是对的，结论句把它盖掉了 |

**判据：** 报告里出现「实测 / 真 / 跑过」，证据就必须来自**真依赖**。桩验只能写成
"用桩验过、真依赖未验"。**把桩验写成实测是造假，不是措辞问题。**

## 多步交接（和用户配合的动作，别抢跑）

有一类"完成"不是一个动作，而是**两方按序各做一步**：

```
① 你写属性 / 给选项 / 改配置   →   ② 用户填值、选好、或说"好了"   →   ③ 你才检查是否 ready
```

实测失败（同一模型，真实使用）：用户**选完选项**，模型**跳过了自己那一步（没写属性）**、
也不等用户"填好了"的信号，直接去检查 —— 检查的是旧状态，然后报"没 ready"或"已 ready"，
两者都错。

规矩：

- **用户"选了 X" ≠ "X 已生效"**。选择是意图，生效是另一件事。
- **你自己的那一步先做完**（写属性 / 落盘 / 改配置），再等对方；不要把自己的步骤和对方的步骤并成一次。
- **等的是一个可观察信号**（"填好了" / 提交了 / 重启完了），不是"用户回了一句话"。
- 拿不到信号就检查 ⇒ 你检查的是**上一次的状态**，结论无意义；如实说"等你的 OK 再验"。
- 报"ready"之前，先确认**前置条件真的成立**（属性已写、值已填），不是"用户操作过了"。

| 它说了什么（真实） | 缺的是哪一步 |
| --- | --- |
| 用户选完方案 A 后，它说"配置已 ready" | ① 它没写属性 ② 没等用户填值 —— ready 是从旧状态推的 |
| 用户选完后它去检查，报错"值不对" | ① 没写 ② 没等 —— 检查的是空值，错怪用户 |

**红旗：** 用户刚回"选好了"，你下一句就去断言 ready / 没 ready。

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
- 报告里出现「实测 / 真 / 跑过」，而证据是桩、mock、假值或替身服务
- 结论句用了「全部 / 都 / ready」，而「需求覆盖」表里有一行不是「已实现·真验」
- 某条要求卡住了，你用替身顶上后**只改了实现、没改状态词**

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
| "桩也是真 TCP，算实测吧" | 桩验的是你的代码**怎么说话**，不是真依赖**怎么回答**。写「桩验过、真依赖未验」 |
| "用户说实在做不到就想办法顶上" | 可以顶上，**但顶上那条必须带「替身」字样进报告**。授权的是降级，不是改写结果 |
| "表里写清楚了，开头概括一下没事" | 概括词会把表里的降级盖掉。结论句只能从表里长出来 |

## Key Patterns

各场景的现成句式（交付报告怎么开头、发现对账怎么列、拒绝时的说法）见
`references/key-patterns.md`。
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

工作流退役后，这套纪律**没有任何工具替你做**：`smart_check_doc` 只校验文档契约，`smart_dispatch({ role: 'review' })` 只提供独立视角 —— 取证与对账仍然是你自己的活。
