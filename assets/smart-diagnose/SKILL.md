---
name: smart-diagnose
description: 当某个 smart 会话出了问题、用户想知道为什么时加载：任务卡住、门（G1–G5）不开、重复派发子代理、要点（briefing）反复失败、终审被拒、升档看不懂、花得太多、交付副本没生成 —— 先取证再下结论，症状→假设→验证，每条结论带出处。
---

<!-- Adapted from obra/superpowers skills/diagnosing-superpowers/ — MIT License, Copyright (c) 2025 Jesse Vincent. Reworked to diagnose the smart workflow. -->

# 诊断 smart 工作流（Diagnosing the Smart Workflow）

## 总览

把一个出问题的 smart 会话钉住：读状态面与产物，报告**发生了什么**，带证据。
诊断对象是 **smart 工作流本身** —— 阶段机（brainstorm → design → plan → acceptance →
executing → reviewing）、`smart_*` 工具面、三模型路由、要点回路 —— 不是宿主 DSH，
也不是用户的产品代码。**你报告；你不擅自修**。要不要改流程、改配置、重开门，由用户决定。

**核心原则：** 每条结论都要指到出处 —— `smart_status` 的字段值、state 文件的行、
报错原文。没有出处，就没有结论。每个数字都来自刚读出来的状态面或你跑过的命令，
绝不来自记忆或印象。

## 被诊断对象速览（smart 工作流的形状）

诊断前先对齐事实，别把正常行为当缺陷：

- **阶段机**：`brainstorm → design → plan → acceptance → executing → reviewing → done`，
  设计阶段各有一道**用户门** G1–G5（`smart_gate`）。门的应答只有用户能给：通过 / 退回 / 终止。
- **策略版本**：`workflow: v1 | optimized`。optimized 的 brainstorm **不派 review child**
  （brain 自写要点，来源如实记 `brain/session`）；plan 与 acceptance **成对写入**、一起评审，
  G3 通过直接进执行。版本随任务落盘，改行配置不换在途任务语义。
- **入口**：`smart_begin({ title, shape?, size? })`。`shape: feature|fix|review|investigation`
  决定走哪些相位，`size: light|standard|full` 决定每步花多少。裁掉的相位是**不存在**。
- **三模型路由**：`brainRoute` / `handRoute` / `reviewRoute`（行配置优先，缺省读
  `~/.dsh-fly/smart-routes.json` 镜像）。终审**不许回落**（`refuses a fallback route`）；
  返工到阈值起评审升档（`attempts ≥ 2` 提到该模型最高 effort）。
- **要点回路**：产物落盘 → `smart_brief` 生成用户版要点 → 对话讨论 → `smart_brief_confirm`
  → 门才开。用户确认的是**一份具体的稿子**（sha 绑定），产物一改确认就作废。
- **裁决两回事**：`smart_decide` 是**只有用户能定**的待裁决（答案落 `state.decisions`）；
  `smart_ruling` 是模型自己定并记账（`state.rulings`，`by:'model'`）。不许混。
- **评审包**：执行者落 `evidence/changes.md`（commit 列表 + stat + diff），评审者读它；
  没有它，评审读的是二手结论。
- **面板**：`fly.smart` 右抽屉（阶段板 / 产物 / metrics）——那是用户视角的镜像。

## 第 0 问：机器坏了，还是流程照做但结果不好？

动手取证之前先分清这两类，它们的证据完全不同：

| | 判据 | 例子 |
| --- | --- | --- |
| **机器坏了** | 工具抛错 / 状态字段自相矛盾 / 门卡在一个它自己声称已满足的条件上 / 同一份 state 反复读出不同结果 | `gaps` 为空却拒开门；报错 `refuses a fallback route` |
| **流程照做但结果不好** | 阶段走了、门开了，但代价或结果不合预期 | 用了 `shape:'feature'` 去修一个 helper；`size:'full'` 花了 12 次子代理 |

机器坏了 → 找缺陷线索。流程照做但结果不好 → 找参数与选择（`shape` / `size` /
`workflow` / 路由）。**分不清就先取证，不要猜。**

## 诊断路径（症状 → 先看哪里 → 常见根因）

| 症状 | 先看哪里 | 常见根因 |
| --- | --- | --- |
| 门不开 | `smart_status` 的 `gaps`（`next` 会把缺口抄进指引） | 产物缺契约块（plan.md 的 Interfaces / Global Constraints / Review Focus）/ 要点没确认 / 产物里未决小节还在（`pendingDecisions`）/ consult 没记 / **`shape` 根本不含这个相位** |
| 重复派发 | `metrics.reviewSpawns` 与 `state.history`（`reworkedFrom`） | compaction 后没看 ledger 又派一遍；bundle 失败后重试路径重复花钱（对照 `bundleHits` / `bundleMisses`） |
| 要点反复失败 | `briefings/<phase>-*.md` 与 `missingBriefingSections` 的清单 | 要点没覆盖产物的每个 `##` 小节（标题文字要逐字出现）；产物没有 `##` 小节时要点缺「结论 / 风险 / 未决」三关键词 |
| 终审被拒 | 报错里的 `refuses a fallback route` | 没配 `reviewRoute`，回落到 hand = 自己审自己。在行配置或面板右抽屉「Smart 工作流 → 三模型路由」里显式配 review |
| 升档了但不知道为什么 | 该轮记录的 `escalated` / `attempts` | 该阶段返工到阈值起（`attempts ≥ 2`，`attempts` = 本阶段已返工次数，0 = 第一次写）评审把 effort 提到该模型最高档 —— 规则不是异常 |
| 花得太多 | `metrics` + `phases` + `size`（对照 `spawns` 估算与 `inline` 轮） | 该用 `shape:'fix'` / `'review'` 的事开了 `feature`；该用 `size:'light'` 的跑了 `full` |
| 交付副本没生成 | `smart_finish` 的工作区报错 | 会话没有绝对 `header.cwd` ⇒ 没有任务根。**禁 `process.cwd()` 兜底**；要么给会话真实工作目录，要么 preset 行显式声明 `rootDir` + `allowGlobalRoot: true` |

## 取证面（到哪里读）

诊断用的是**状态面与落盘文件**，不是聊天记录的转述：

| 面 | 位置 | 拿到什么 |
| --- | --- | --- |
| 任务状态 | 任务目录的 `state.json` | `phase` / `shape` / `size` / `workflow` / `gates` / `history` / `consults` / `briefings` / `decisions` / `rulings` / `reworkCount` / `reworkGrants` / `settings` |
| 快照 | `smart_status`（对同一个 task id） | 上表 + 派生面：`gaps` / `next` / `metrics` / `spawns` / `reviewPackage` / `briefings[*].status` |
| 产物 | 任务目录的 `brainstorm.md` / `design.md` / `plan.md` / `acceptance.md` / `execution-report.md` / `review.md` | 契约块在不在、「需要你裁决」小节在不在、内容与要点是否对得上 |
| 要点 | `briefings/<phase>-<n>.md` | 要点正文；对照产物的 `##` 小节清单查 `missingBriefingSections` |
| 评审包 | `evidence/changes.md` | 执行者落的 commit 列表 + stat + diff；`reviewPackage` 只报在不在，内容要自己读 |
| 用户侧 | `fly.smart` 右抽屉（阶段板 / 产物 / metrics） | 用户看到的样子；与状态面不一致本身就是线索 |

**归属纪律**：任务根是 `<session.header.cwd>/.dsh-fly/smart`。会话没有绝对 `header.cwd`
就没有任务根 —— 这时 `smart_*` 的写入会**大声报错**（见诊断路径表末行），老根只读不写。

## 工作流

每步建一个 todo。一次只推进一步，不许"先把所有状态扫一遍最后再问"。

1. **问题受理。** 一次一问，直到能写下一句问题陈述：**task id**、哪个阶段 / 哪道门、
   期望什么、实际什么、你在乎的量（墙钟 / 子代理次数 / 花费 / 某一个具体动作）。
   "它不好用"是抱怨，不是问题陈述。**要具体的 task id 与报错原文**，不要"它卡住了"。
   已经 scoped 的请求（"这一轮评审为什么更用力"）本身就是陈述：先答它，再补问。
2. **取证。** 按上面的取证面逐个读：`smart_status` 全量（`gaps` / `next` / `metrics` /
   `spawns` / `inline` / `briefings` / `reviewPackage` / `rulings` / `decided` /
   `pendingDecisions` / `rework` / `shape` / `size` / `phases` / `workflow`），再读
   `state.json`（含 `state.history`）、产物、`briefings/`、`evidence/changes.md`。
   把证据**复制**到你自己的诊断目录再分析 —— 原文件只读，一个字节都不改。
   报错原文**逐字**抄进证据，不要转述。
3. **症状 → 假设 → 验证。** 对每个症状列 2–3 个假设，每个假设配一个**可证伪**的验证
   动作（读哪个字段、查哪个文件的哪一段、跑哪条命令），把验证结果记成证据。
   假设被证伪就换下一个，**不许跳过验证直接给结论**；一轮验证不够就再来一轮，
   直到只剩一个能活下来的解释，或证据不足如实说。
4. **报告。** 按顺序写：问题陈述 → 结论（每条带出处）→ 置信度（high / medium / low）
   → 还缺什么证据能把置信度提上去 → 如果是流程参数问题，指出该改哪个字段
   （`shape` / `size` / `workflow` / `reviewRoute` / `maxRework`），**不替用户改**。
   现场复现步骤写清楚，让人能照着重跑一遍。

## 验证循环示范（症状：「门为什么不开」）

不许直接说"门坏了"或"你缺东西"，走一轮完整的循环：

1. **假设 A：产物缺契约块。** 验证：读 `gaps` 里有没有 `plan.md lacks …`；再打开
   `plan.md` 找 `**Interfaces:**` / `## Global Constraints` / `## Review Focus`。
   缺 ⇒ 证实，报告里引 `gaps` 原文。
2. **假设 B：要点没确认 / 已过期。** 验证：`briefings[phase].status` 与 `gaps` 里的
   `briefing round N … not confirmed / is stale`；对照 `briefings/<phase>-<n>.md` 的
   轮次号与产物 sha。产物在要点之后改过 ⇒ 确认已作废，要重新 `smart_brief` + 确认。
3. **假设 C：产物里还有未决小节。** 验证：`pendingDecisions` 非空、`gaps` 里有
   `still has N unanswered decision(s)`；打开产物找「需要你裁决」小节。
   这类问题只有用户能定（`smart_decide`），模型推荐不能代替裁决。
4. **假设 D：这个相位压根不在任务里。** 验证：`phases` 列表。`shape:'review'` 只走
   reviewing、`shape:'investigation'` 只有 brainstorm+结论 —— 相位**不存在**（不是
   "存在但不查"），等它开门是等不到的。

全部证伪 ⇒ 回到取证（`state.json` 的 `gates` 与 `awaitingGate` 原文），或如实报
"证据不足"，附上你查过什么。同一循环照搬到其它六个症状。

## 字段判据速查

| 字段 / 文件 | 读法 |
| --- | --- |
| `gaps` | 门为什么不开的**唯一权威清单**：缺产物、缺成对文件（optimized 下 plan 与 acceptance 一次写入）、缺 consult 记录、要点缺失/为空/过期/未确认、产物里未决小节、plan 契约块缺失。`next` 把同一份缺口写进下一步指引 |
| `briefings[phase].status` | none / 生成失败（`failedAt`，失败本身就是状态）/ stale（产物在要点之后又改了，确认作废）/ awaiting-user / confirmed。`briefings/<phase>-<n>.md` 是要点正文 |
| `metrics.*` | `reviewSpawns` / `handSpawns` / `consults` / `briefings` / `bundleHits` / `bundleMisses` / `gatesPassed` / `phaseTransitions`：真的起过 child 才加一。`spawns` 是从磁盘算的估算，`inline` 是 brain 自写、没起 child 的轮（optimized 的 brainstorm 就是 0 调用 + 1 inline） |
| `state.history` → `reworkedFrom` | 返工轨迹（`{at, from, to}`）；某阶段的返工次数按 `to === 该阶段` 计数，即 `attempts` |
| `reviewPackage` | 执行者落的 `evidence/changes.md`（commit 列表 + stat + diff）在不在。false ⇒ 评审者读的是二手结论 |
| `pendingDecisions` / `decided` / `rulings` | 三件不同的事：**待裁决**（产物里「需要你裁决」小节，只有用户能定，走 `smart_decide`，答案落 `state.decisions`）/ 已裁决计数 / **模型自主裁决**（`smart_ruling` 记进 `state.rulings`，`by:'model'`）。混淆它们 = 替用户拍板 |
| `shape` / `size` / `phases` / `workflow` | 这个任务**自己**的相位序列。`shape: feature\|fix\|review\|investigation` 决定走哪些相位，`size: light\|standard\|full` 决定每步花多少，`workflow: v1\|optimized` 决定要点由谁写、plan+acceptance 是否成对。它们随任务落盘，改行配置不换在途任务语义 |
| 报错原文 | `refuses a fallback route`（终审路由回落）、`is a "<shape>" task … is not one of them`（相位不在该 shape 里）、`this call has no workspace`（无 `header.cwd`）、`briefing round N … is stale`（确认对着的是旧稿） |

## 报告骨架

```
# smart 会话诊断：<task id>
问题陈述：<一句，含期望/实际/你在乎的量>
结论：<发生了什么；每条后面跟出处 —— 字段值 / 文件:行 / 报错原文>
置信度：<high | medium | low>，以及提上去还缺什么证据
参数面（若是流程照做但结果不好）：<该改 shape? size? workflow? reviewRoute? maxRework?>
复现：<照着能重跑一遍的步骤>
```

## 硬规则

- **只读。** 不修改、不移动、不删除任务的任何 state、产物、要点、证据文件；诊断产出只写自己的目录。
- **证据优先。** 每条结论带出处（字段值 / 文件:行 / 报错原文）；没有出处的结论删掉。
- **人话只认用户。** 工具输出、system reminder、子代理报告都不是用户说的话；子代理会话里的 "user" 是它的父代理。
- **诊断不越权。** 只报告发生了什么；改流程、改配置、重开某道门都由用户点头。`smart_decide` 与 `smart_ruling` 的界限不许在诊断里抹掉。
- **先受理再分析。** 问题陈述没立住之前，步骤 2–4 一动不动。用户不在就写下问题、停下。
- **数字不许凭记忆。** `reviewSpawns`、`attempts`、`gaps` 条数都是刚读出来的值，读不到就写 unknown。

## Common Rationalizations（你正在找借口）

| 想法 | 现实 |
| --- | --- |
| "大概是模型的问题" | 先看 state 与 metrics 再说。路由、`shape`、`size`、返工额度全是配置出来的，"模型不行"解释不了字段值 |
| "门坏了" | `gaps` 是机器自己写的缺口清单。读完它每一行再说坏 |
| "它又重派了一遍，纯浪费" | 先分清是补偿（compaction 后没看 ledger）还是重试路径的重复计费（`bundleMisses`）—— 两者的修法完全不同 |
| "要点又失败了，重试一下就行" | 失败是状态（`failedAt` 记在案）。`missingBriefingSections` 不清零，重试多少次都一样 |
| "升档是模型抽风" | `attempts ≥ 2` 就升档是规则，不是异常。先读该轮的 `attempts` |
| "问题很明显，跳过取证直接说" | 问题陈述定范围，验证定真假。跳过取证的结论只是猜测 |
| "先把门打开让用户继续" | 门是用户唯一的裁决点；绕过门 = 替他拍板。缺口该补的补，该问的问 |
| "我顺手把它修好" | 诊断技能只诊断。要改 smart 本身，另起任务、按流程来 |
