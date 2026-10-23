# fly-smart Public 试运行手册

> **排期**：S1–S7 已落地；S8（投稿市场）排在**本试运行之后**。
> 市场是**投稿审核制**，不是推上去就上架。

**范围**（2026-10-23 定）：转 public 仓 + 自己真用一段时间。
**完成判据**：收集到真实反馈并修掉问题。

---

## 0. 开跑前的三件事（都得做完，否则试运行测的不是它）

| # | 做什么 | 为什么 | 判据 |
| --- | --- | --- | --- |
| 1 | **重启 dev app** | 引擎把客户端包缓存在**进程内**；10 个技能也要重启才挂上 | 本会话技能目录里出现 `smart-parallel` / `smart-write-skill` / `smart-diagnose`（S1 的 7 个已在） |
| 2 | ~~仓库转 public~~ ✅ **已完成（2026-10-23）** | 它解封了 `--provenance`（已在 `release.yml` 恢复） | GitHub 上可匿名访问 |
| 3 | **路由配齐** | 终审**不许回落**，只配 `handRoute` 走不到 G5 | `brainRoute` / `handRoute` / `reviewRoute` 三条都在（你已有） |

> 转 public 后把 `release.yml` 那行改回 `npm publish --access public --provenance`
> （文件里注释写着同样的话）。这一步**不是**试运行的一部分，随时可做。

---

## 1. 要练的场景（每条都带「该看到什么」）

试运行的价值在**踩到真实形状**，不是"用了几天"。按下面走一遍，每个形态至少一次。

### A. 入口形态（`shape` × `size`）

| # | 场景 | 该看到 | 常见问题形状 |
| --- | --- | --- | --- |
| A1 | 修一处 bug | `smart_begin({ shape: 'fix' })` 只走 4 相位、开 G1/G3/G5 | 走出 design 相位 = shape 裁剪没生效 |
| A2 | 看一段 diff | `shape: 'review'` **直接从 reviewing 起**、只开 G5 | 报 `missing execution-report.md` = gate 没按 shape 裁 |
| A3 | 调查个问题 | `shape: 'investigation'` 只有 brainstorm、G1 后就完 | 走出执行 = shape 失效 |
| A4 | 加个小工具 | `size: 'light'` ⇒ **零 review child**（`metrics.reviewSpawns === 0`） | 仍派了 child = `briefingSourceFor` 没接上 |
| A5 | 完整交付 | `shape: 'feature', size: 'full'` 走六相位（或 optimized 五相位） | — |

### B. 门与契约

| # | 场景 | 该看到 | 常见问题形状 |
| --- | --- | --- | --- |
| B1 | 写一份裸 `plan.md` | **写入时**就拒，点名缺 `Interfaces`/`Global Constraints`/`Review Focus` | 等到 G3 才拒 = 写入校验没接上（白花 briefing+consult） |
| B2 | 3 个任务只写 1 个 `Interfaces` | 报 `found 1, need 3` | — |
| B3 | 产物里留「需要你裁决」小节 | 门不开，提示用 `smart_decide` | — |
| B4 | 模型自己定一件小事 | `smart_ruling` 记进 `state.rulings`，收尾总结要提 | 收尾总结漏了 ⇒ `smart_finish` 拒 |
| B5 | 有裁决但总结只字不提 | `smart_finish` 报 `recorded N model-side ruling(s)` | — |

### C. 路由与评审

| # | 场景 | 该看到 | 常见问题形状 |
| --- | --- | --- | --- |
| C1 | 只配 `handRoute` 走到 G5 | 报 `refuses a fallback route` + 指路 `reviewRoute` | 悄悄跑完 = 终审自审自己 |
| C2 | 同一阶段返工 2 次 | **第 3 稿起**评审 effort 提到该模型最高档；轮次记 `escalated: true, attempts: 2` | 不升 = 档位表没查到（`supportedEffortsOf`） |
| C3 | 执行完看 `evidence/changes.md` | 执行者落了 commit 列表 + stat + diff | 只有散文没文件 ⇒ 评审者被如实告知"没有" |

### D. 技能命中（**10 个逐个验**）

每个技能：用**它 description 里的场景词**说一句话，看会话是否命中该技能。

| 技能 | 说这句 |
| --- | --- |
| `smart-skills` | "我要开始做个东西" |
| `smart-debug` | "这个测试挂了，帮我看看" |
| `smart-tdd` | "我要给它加个函数" |
| `smart-verify-claim` | "我改完了，可以提交了吗" |
| `smart-review-receive` | "评审说这里要改" |
| `smart-plan` | "这是 spec，写个实现计划" |
| `smart-worktree` | "开个新分支做这个功能" |
| `smart-parallel` | "这 3 个测试文件都挂了，根因不同" |
| `smart-write-skill` | "我要写一个新技能" |
| `smart-diagnose` | "这个 smart 任务卡住了，为什么" |

**没命中** = description 写得不够可发现（改 description，不是改正文）。

---

## 2. 反馈怎么记（用 `smart-diagnose` 的判据）

每个问题按三段记，**没有出处就没有结论**：

```
症状：（一句话 + task id / 报错原文）
判据：（看了哪个字段 —— gaps / metrics / state.history / 轮次记录 …）
结论：（机器坏了 or 流程照做但结果不好 + 修法）
```

**别记成**"感觉不好用" —— 那是抱怨不是问题陈述。

---

## 3. 什么算过、什么不过

| 过 | 不过 |
| --- | --- |
| A1–A5 各跑通一次，行为与「该看到」一致 | 任一形态走出不该走的相位 / 门开不了 |
| B1–B5 的拦截都在，且报错可执行 | 拦截静默失效（尤其 B1、B4、B5） |
| C1–C3 的规则生效 | C1 悄悄跑完 = **阻塞级** |
| 10 个技能按描述可命中 | 3 个以上没命中 |
| 期间发现的问题**都修掉** | 留着已知问题去投稿 |

---

## 4. 试运行期间的纪律

- **发现问题当场记**，不要攒到"以后再说"（`smart-diagnose` 的判据当场最好取）
- **修问题时按既有纪律**：门禁绿才 commit、A/B 撤掉修复必须红且原因正确
- **别为了试运行改产品语义** —— 试运行是找问题，不是加功能。要加功能记进 `docs/superpowers-port-plan.md` 的后续阶段
- 每个问题修完**在本文档留一行**（哪条场景、症状、修法、提交号）

---

## 5. 试运行记录

> 跑的过程中往这里加，一行一条。

| 日期 | 场景 | 症状 | 结论 | 修复（提交号） |
| --- | --- | --- | --- | --- |
| | | | | |
