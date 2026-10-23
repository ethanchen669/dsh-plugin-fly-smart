# smart 工作流优化方案：superpowers 的**移植 + 扩展**

> **定位**：方法论内核移植自 [obra/superpowers](https://github.com/obra/superpowers)
> （MIT License，Copyright (c) 2025 Jesse Vincent），外加 DSH 平台适配层，
> 并**扩展**出 superpowers 没有的五项能力（用户门 / 待裁决 / briefing 回路 / 面板 / 成对相位）。
>
> 本文是实施计划，不是设计叙事。每节末尾有**验收**。

---

## 0. 为什么叫「移植 + 扩展」

| 判据 | 现状 |
| --- | --- |
| **access** | 已通读 superpowers 15 个 `SKILL.md` |
| **substantial similarity** | 计划是 **1:1 映射**（`smart-debug` ← `systematic-debugging` 等），且搬其独有表达（「你正在找借口」对照表、`using-superpowers` 优先级规则、"Size the Work"） |

因此这不是"受启发"，是**衍生作品**。MIT 明确允许复制 / 修改 / 合并 / 发布 / 分发 / 再许可 / **销售**，
唯一义务：

> *"The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."*

### 0.1 许可落点（硬要求）

| 文件 | 内容 | 何时创建 |
| --- | --- | --- |
| `THIRD_PARTY_NOTICES.md` | superpowers 的 MIT 全文 + `Copyright (c) 2025 Jesse Vincent` + 移植清单 | S1 |
| 每个移植的 `skills/<name>/SKILL.md` 头部 | HTML 注释：`<!-- Ported from obra/superpowers skills/<src>/SKILL.md — MIT, Copyright (c) 2025 Jesse Vincent -->` | 各阶段 |
| `package.json` → `files` | **必须加 `THIRD_PARTY_NOTICES.md` 与 `skills`** | S1 |

⚠️ **坑**（AGENTS.md「资产不进包」）：`files` 里列了不等于进了 tarball。
当前 `files: ['index.js','panel','lib/state.mjs','lib/client.js','tools','cordis.patch.yml']` ——
`THIRD_PARTY_NOTICES.md` 不在其中 ⇒ **不加就是没随包分发**，等于没尽义务。
验收要用 `npm pack --dry-run` 逐条核对文件在 tarball 里。

### 0.2 命名红线

- ✅ 用 `superpowers` 作 **keyword**（检索）与**归因**
- ❌ **不要**把包名 / 产品名叫成 `superpowers` 或 `dsh-superpowers`（冒名 + 若有真移植在场会撞车）
- ✅ 自我介绍固定为：**「superpowers 的 DSH 移植与扩展」**

---

## 1. 移植清单（15 个技能）

**三类策略**：
- 📥 **搬原文** —— 保留表达，仅做工具名适配
- ✏️ **改写适配** —— 结构相同，表达重写以接入 smart 机制
- 🔁 **用 smart 机制替代** —— 不产出新技能，把能力补进现有工具

| # | superpowers 源 | smart 目标 | 策略 | 说明 / 对应缺口 |
| --- | --- | --- | --- | --- |
| 1 | `using-superpowers` | `smart-skills` | ✏️ | 优先级规则 +「找借口」表 → 指向本包技能与 `smart_begin`。**A 项** |
| 2 | `brainstorming` | `smart-brainstorm` | ✏️ | smart 已有 brainstorm 相位/决策表；搬**对话纪律**（一次一问、先看再问、"他没说的写成你的决定"）；"Size the Work" → §3 的 `size` |
| 3 | `writing-plans` | `smart-plan` | 📥+✏️ | **文档契约**（Interfaces / Global Constraints / Review Focus / 自审 5 条 / 步长定义）—— **C 项**，smart 最大缺口 |
| 4 | `subagent-driven-development` | — | 🔁 | 已有 hand 派发 + review bundle；补 **ledger rulings**、**派发上下文卫生**、**fix loop cap + 升档**。**E/F 项** |
| 5 | `executing-plans` | — | 🔁 | 并入 `smart_execute`；补「红绿证据」 |
| 6 | `test-driven-development` | `smart-tdd` | 📥 | **D 项** |
| 7 | `systematic-debugging` | `smart-debug` | 📥 | 含 root-cause-tracing / defense-in-depth / condition-based-waiting 等 reference |
| 8 | `verification-before-completion` | `smart-verify-claim` | 📥+🔁 | 铁律 + 7 行清单；并接进 `smart_verify` 的证据要求。**D 项** |
| 9 | `requesting-code-review` | — | 🔁 | `smart_consult` + `smart_verify` 已覆盖；补**评审包 diff**。**I 项** |
| 10 | `receiving-code-review` | `smart-review-receive` | 📥 | **反谄媚**（禁 "You're absolutely right!"）。**H 项** |
| 11 | `using-git-worktrees` | `smart-worktree` | 📥 | **G 项** |
| 12 | `dispatching-parallel-agents` | `smart-parallel` | 📥 | **J 项** |
| 13 | `finishing-a-development-branch` | — | 🔁 | `smart_finish` 已有；补「先绿后菜单」顺序 |
| 14 | `writing-skills` | `smart-write-skill` | 📥 | 元技能：写技能当 TDD。**K 项** |
| 15 | `diagnosing-superpowers` | `smart-diagnose` | ✏️ | 改成诊断 smart 工作流本身。**K 项** |

### 1.1 不被任何技能覆盖的缺口（需状态机/工具改动）

| 项 | 缺口 | 落点 |
| --- | --- | --- |
| **E** | 执行期 `state.rulings[]`、派发上下文卫生（不粘贴历史、产物走文件、子代理不自派） | `lib/state.mjs` + hand prompt 契约 |
| **F** | 终审必须最强档、按任务/步骤分档、返工轮次升档 | 路由解析 + `smart_execute` |
| **I** | 评审包（`BASE..HEAD` diff 作为评审物交付） | `smart_consult` / `smart_verify` |

**验收**：15 个技能各有归属；A/B/C/D/E/F/G/H/I/J/K 十一项都能指到具体落点，无悬空。

---

## 2. 层 1：把方法论发成 harness 技能（不动状态机）

**观察**：DSH 有技能目录（`agent-experience` / `client-blackbox` / `cordis-*` / `editing-cordis-compositions`），
superpowers 就靠它自动触发。smart **一个技能都不发**，只发工具，而工具要求先 `smart_begin`。

### 2.1 首批 6 个（按投入产出排）

| 技能 | 对应源 | 触发场景 | 需要 smart 任务 |
| --- | --- | --- | --- |
| `smart-debug` | systematic-debugging | 任何 bug / 测试失败 / 行为异常 | **否** |
| `smart-tdd` | test-driven-development | 写任何生产代码之前 | **否** |
| `smart-verify-claim` | verification-before-completion | 即将声称完成 / 通过 | **否** |
| `smart-review-receive` | receiving-code-review | 收到评审意见 | **否** |
| `smart-plan` | writing-plans | 有 spec、要写多步计划 | **否**（可直接产出 `plan.md`） |
| `smart-worktree` | using-git-worktrees | 开始特性工作 | **否** |

### 2.2 配套：优先级规则（搬 `using-superpowers`）

```
「建东西」→ 先 smart-brainstorm，再进工作流
「修 bug」→ 先 smart-debug，再决定要不要开任务
```

外加一张**「你正在找借口」对照表**（源自 superpowers，12 行），例如：

| 想法 | 现实 |
| --- | --- |
| "这只是个小问题" | 问题是任务，先查技能 |
| "我先看看代码" | 技能告诉你怎么看，先查 |
| "这个不需要正式技能" | 有技能就用 |
| "我记得这个技能" | 技能会演化，读当前版本 |

### 2.3 模型路由：子代理怎么选模型

**先分清两类**（不然会白配一套）：

| | 跑在哪个模型 | 有得选吗 |
| --- | --- | --- |
| **技能本身**（`SKILL.md` 被执行） | **会话模型** | ❌ 没得选，也改不了 |
| **技能派出去的子代理** | 按 route 指定 | ✅ 有得选 |

技能是给当前模型读的指令，不是进程。想让 `smart-tdd` 便宜，就**在便宜模型的会话里**跑它。

**好消息：smart 不被 DSH 的 allowlist 卡。** `assertAllowedModelSelection`
（`dsh-tool-subagent/lib/index.js:453`）只在 `subagent`/`subagent_fork` **工具**的 execute 里；
smart 直接调 `subagents.startActivation({..., agentOptions: route})` —— 服务层（`dsh-subagent`）
只做 `assertSubagentMaxDepth` + `assertCapabilities`（spawn provider 声明 `agentOptions: true` ⇒ 通过）。
**smart 的 route 配置本身就是选模型机制**，不受用户有没有配 `allowedModels` 影响。

**只有 3 个技能会派子代理**：

| 技能 | 跑在 | 派子代理？ | route |
| --- | --- | --- | --- |
| `smart-tdd` / `smart-verify-claim` / `smart-review-receive` / `smart-worktree` | 会话模型 | ❌ | — |
| `smart-debug` | 会话模型 | 可选（并行调查） | `lite` |
| `smart-plan` | 会话模型 | 可选（自审） | `review` |
| `smart-parallel` | —（它就是派发器） | ✅ 必然 | `lite` |
| `smart-diagnose` | 会话模型 | 可选 | `lite` |

**路由配置**（已定，2026-10-22）：

```yaml
routes:
  brain:  llm-mioffice/ppio/pa/gpt-6-astra@high        # 决策/产物
  hand:   llm-mioffice/deepseek/deepseek-flash@max     # 执行
  review: llm-mioffice/xiaomi/mimo-v2.6-pro@high       # 评审
  lite:   llm-mioffice/deepseek/deepseek-flash@high    # 机械子代理：探索/取证/并行调查
```

**`lite` 取 `@high` 而非更低**：`lite` 干的三件事都是**准确度优先** —— 探索漏一个文件 ⇒ 计划就错；
取证出假证据比没证据更糟；并行调查每路独立，准确度 > 速度。superpowers 的"用便宜模型"说的是
**模型档**（flash vs pro），effort 是另一根轴：**在便宜模型上给足推理**正是对的。

`hand` 与 `lite` 当前同模型只差一档，仍然值得分两条：**可独立调**（将来 `hand` 换强模型时 `lite`
留在 flash），且技能契约读作"派子代理用 `lite`"比"用 `hand` 但降 effort"清楚。

**技能里的契约原文**（写进 `smart-plan` / `smart-parallel` / `smart-debug`）：

> 派子代理时用 `lite` 路由；但若任务需要多步推理或跨多文件理解，改用 `hand`。
> **永远不要**用 `lite` 做评审 —— 评审走 `review`。

**待观察**：`hand` 是 flash 而 hand 是真正干活的（TDD 红绿循环、跨文件改动、多步执行）。
superpowers 的 *"turn count beats token price"* 说的就是这件事：便宜模型轮次更多、总成本反而高。
`@max` 能补偿一部分，但要看执行报告的步骤数 —— 若明显偏多，就是换模型的信号。

**验收**：
0. 四条 route 都能被 `parseRouteValue` 正确解析（多斜杠 model id 如 `ppio/pa/gpt-6-astra`
   走 `indexOf('/')` 只切第一个斜杠，完整保留）；每个 `@effort` 都在该模型声明的
   `reasoningEfforts` 里（`deepseek-flash` 有 max/high，`mimo-v2.6-pro` 只有 low/medium/high）。

**验收**：
1. 六个技能在技能目录里可见、按描述可命中（用真会话验证，不只验文件存在）
2. 未开 smart 任务时可用（`smart-debug` 在无任务会话里能跑完）
3. 每个 SKILL.md 头部有 MIT 出处注释

---

## 3. 层 2：让 smart 任务可以轻装上阵

**现状成本**：6 相位 / 5–11 张卡 / 6–12 次子代理 —— 对"加个 helper 函数"是灾难。

### 3.1 入口扩展

```js
smart_begin({ title, shape?, size? })

shape: 'feature' | 'fix' | 'review' | 'investigation'   // 默认 feature = 现行为
size:  'light'   | 'standard' | 'full'                  // 默认 full = 现行为
```

**两条默认值都是"现行为"** ⇒ 旧任务、旧会话、面板零影响（与 `workflow: v1|optimized` 同一套纪律：
**版本随任务落盘**，之后改行配置不换在途任务语义）。

### 3.2 `shape` 决定相位子集

| shape | 相位 | 门 | 产出 |
| --- | --- | --- | --- |
| `feature` | brainstorm → design → plan(+acceptance) → executing → reviewing | G1–G5 | 全套 |
| `fix` | brainstorm(轻) → plan → executing → reviewing | G1、G3、G5 | 短 plan（**含红绿证据**）+ 执行报告 + review |
| `review` | **只有 reviewing** | G5 | `review.md`（对应 `requesting-code-review`） |
| `investigation` | brainstorm → 结论产物 | G1 | 结论（**无执行**） |

### 3.3 `size` 决定成本档位

| size | 设计阶段深度 | review child | 预估开销 |
| --- | --- | --- | --- |
| `light` | brainstorm **inline**（brain 自写要点，不派 review） | **不派** | ≤ 1 次 child |
| `standard` | brainstorm + plan | 每阶段 1 次（可 bundle） | 3–4 次 |
| `full` | 六相位 | 每阶段 1 次 | 6–12 次 |

**实现要点**：
- `state.shape` / `state.size` 落盘；`gateGaps` / `passGate` / `NEXT_PHASE` 按其裁剪
- 裁剪后的相位表导出给面板（`panel/reader.js` 的 `boardFor()` 已有 `workflow` 分支，再加一维）
- **闸门不静默放宽**：裁掉的门是**相位不存在**，不是"存在但不查"（沿用 optimized 的教训）

**验收**：
1. `shape:'review'` 只产 `review.md`、只开 G5，且**不产生** G1–G4 的记录
2. `size:'light'` 的 `metrics.reviewSpawns === 0`
3. 旧任务（无 `shape`/`size` 字段）走位与现在**逐字相同**（136 条既有测试一条不改全绿）
4. 面板按 `shape` 画对应板格（不出现不存在的相位）

---

## 4. 层 3：技能与工作流互相指向

- 技能末尾写：**「这需要完整交付时，用 `smart_begin` 走工作流」**
- `tools/index.js` 的 `SECTION` 里写：**「只是调试 / 评审 / 小修 → 用 `<技能名>`，不要开任务」**
- 形态对照（照 `using-superpowers` 的优先级表）：

| 用户说 | 该走 |
| --- | --- |
| "修个 bug" | `smart-debug` → 若需改码，`smart_begin({shape:'fix'})` |
| "帮我看看这个 diff" | `smart_begin({shape:'review'})` |
| "加个小工具" | `smart_begin({size:'light'})` |
| "做一个完整功能" | `smart_begin({shape:'feature', size:'full'})` |

**验收**：SECTION 与各 SKILL.md 的指向互相可达（不存在 A 指 B、B 不指 A 的孤岛）。

---

## 5. 扩展部分（superpowers **没有**的，「扩展」二字的证据）

| 扩展 | 现状 | 本次动作 |
| --- | --- | --- |
| **用户门 G1–G5** | ✅ 已有 | 不动（保持模型门与用户门**两层都留**） |
| **`smart_decide` 待裁决** | ✅ 已有 | 不动 |
| **briefing 对话回路** | ✅ 已有 | 補对话纪律（一次一问、先看再问） |
| **面板**（阶段板/产物/metrics） | ✅ 已有 | 随 `shape`/`size` 裁剪 |
| **成对相位 + review bundle** | ✅ 已有 | 不动 |
| **`state.json` 持久化状态机** | ✅ 已有 | 加 `rulings[]` / `shape` / `size` |

> **不照抄的一处**：superpowers 的 *"Rulings, not stalls"*（模型自己裁决一切）与 smart 的用户门
> **价值取向不同**。分流判据是「**是否只有用户能定**」：只有用户能定的走 `smart_decide`；
> 模型能定的走 `Ruling:` 并记账。**不把用户门降级成模型门。**

### 5.1 与用户门互补的 `Ruling:`（E 项）

```
state.rulings.push({
  at, phase, decision, why, costIfWrong, by: 'model'
})
```

派发上下文卫生（源自 superpowers 的 42k 字符事故）写进 hand prompt 契约：
- 产物一律**走文件**，不粘贴历史
- 不自派子代理（工具层已有子会话守卫，**prompt 层补一份**）
- 每次派发只带：本任务 brief、涉及的接口、全局约束、报告文件路径

**验收**：`state.rulings` 可读可归档；A/B 撤掉上下文卫生契约时，派发提示词长度断言变红。

---

## 6. 分阶段实施

> **进度（2026-10-23）**：S1–S7 **已完成并提交**（`a4e258d` → `62ddf97`，共 11 笔）。
> 测试 166 通过 / `verify-smart.mjs` 22/22 / 10 个技能全部进 tarball。
> **S8 未开始** —— 排在 fly-smart 的 Public 试运行之后（见 §7）。

| 阶段 | 内容 | 改动面 | 验收 |
| --- | --- | --- | --- |
| **S1** | 许可文件 + `files` 补齐 + 层 1 六技能 + 优先级规则 | 无状态机 | 技能可命中；`npm pack --dry-run` 见 `THIRD_PARTY_NOTICES.md` |
| **S2** | 计划文档契约（Interfaces / Global Constraints / Review Focus / 自审 5 条） | `SECTION` + 产物校验 | 缺 Interfaces ⇒ 过不了 G3 |
| **S3** | `state.rulings[]` + 派发上下文卫生 | `lib/state.mjs` + prompt | 136 条全绿 + 新增 ruling 测试 |
| **S4** | 模型分级收窄：终审最强档、返工升档 | 路由 + `smart_execute` | 终审 child 的路由 = 最强档（断言） |
| **S5** | `shape` / `size` 入口 | 状态机 + 面板 | §3 验收四条 |
| **S6** | 评审包 diff（`BASE..HEAD`） | `smart_consult`/`smart_verify` | 评审物含 diff 文件路径；不用 `HEAD~1` |
| **S7** | 剩余技能（`smart-parallel` / `smart-write-skill` / `smart-diagnose`） | 无状态机 | 同 S1 |
| **S8** | **投稿市场**（不是直接发布 —— 市场走投稿审核）| 市场 metadata | 见 §7 |

**纪律**（沿用本仓既有）：每阶段门禁绿才 commit；push 需用户逐次点头；
A/B 撤掉修复必须**红且原因正确**；桩必须与真接缝同形。

---

## 7. 投稿市场（**投稿 ≠ 发布**）

> **顺序（2026-10-23 定）**：先做完 **fly-smart 的 Public 试运行**，再投稿市场。
> 市场是**投稿审核制**，不是推上去就上架 —— 所以 S8 不是「发」，是「投」。

**S1–S7 已全部落地**（见 §6）；S8 在 Public 试运行之后。


### 7.1 metadata

```json
{
  "keywords": ["superpowers", "workflow", "methodology", "gates", "tdd", "code-review", "dsh"],
  "description": "superpowers 的 DSH 移植与扩展：15 技能的方法论内核（MIT，Copyright 2025 Jesse Vincent）+ DSH 平台适配。扩展：用户门 G1–G5、smart_decide 待裁决、briefing 对话回路、面板可视化、成对相位与 review bundle。"
}
```

- 检索字段：`keywords` 权重 **2**（仅次于 name/title 的 3），**自由字符串**，从 `package.json` 带入市场 index
- `category` / `labels` 必须是 index **声明过的 id**，不能自造
- CJK 可搜（市场做相邻字对切分，无需分词）

### 7.2 三件事必须一次说清

1. **移植自谁**（obra/superpowers，MIT）—— 归因
2. **不是它**（DSH 移植，非官方）—— 避免冒名
3. **多了什么**（五项扩展）—— 让搜过来的人知道看的是不同东西

**验收**：搜索 `superpowers` 命中本包；详情页描述含以上三点；tarball 内含 MIT 声明。

---

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 用户以为是 obra 原版 | 命名红线（§0.2）+ 描述三点 |
| 市场已有 `dsh-superpowers` | **投稿前先核实市场 index**；若有，描述区分度加强 |
| 把投稿当发布 | 市场是投稿审核制，留审核往返的时间；文案按「待审」写，不写「已上架」 |
| `files` 漏掉许可文件 | S1 验收用 `npm pack --dry-run` 逐条核对 |
| 裁剪相位 ⇒ 闸门被静默放宽 | 只裁"相位不存在"，不裁"存在但不查"（沿用 optimized 教训） |
| 旧任务语义漂移 | `shape`/`size` 随任务落盘，默认 = 现行为 |
