# dsh-plugin-fly-smart

**superpowers 的 DSH 移植与扩展**：一套带**用户门禁**的三模型工作流 —— 阶段机 + 13 个
`smart_*` 工具 + **10 个可独立触发的技能** + `fly.smart` 工作台面板。

方法论内核移植自 [obra/superpowers](https://github.com/obra/superpowers)
（MIT，Copyright (c) 2025 Jesse Vincent，全文与移植清单见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)）；**扩展**出 superpowers 没有的五样：
用户门 G1–G5、`smart_decide` 待裁决、briefing 对话回路、面板可视化、成对相位与 review bundle。

> **先看这句**：多数日常事**不需要开任务**。修个 bug、写段测试、声称完成 —— 用技能就够
> （§1）。任务是给**需要别人把关的交付**用的。

---

## 1. 10 个技能（零任务即可用）

技能在**宿主平面**，所以不需要 `smart_begin`：会话按任务描述自动命中。

| 技能 | 什么时候用 | 移植自 |
| --- | --- | --- |
| `smart-skills` | 任何任务开始前 —— 先查技能再动手 | `using-superpowers` |
| `smart-debug` | bug / 测试失败 / 行为异常 / 性能问题 / 构建失败 | `systematic-debugging` |
| `smart-tdd` | 写任何生产代码**之前** | `test-driven-development` |
| `smart-verify-claim` | 即将声称完成 / 测试通过 / 可提交 | `verification-before-completion` |
| `smart-review-receive` | 收到评审意见，动手改之前 | `receiving-code-review` |
| `smart-plan` | 有 spec、要写多步实现计划 | `writing-plans` |
| `smart-worktree` | 开始需要隔离的特性工作 | `using-git-worktrees` |
| `smart-parallel` | 2+ 个互不相干的任务 / 故障 | `dispatching-parallel-agents` |
| `smart-write-skill` | 创建 / 修改技能 | `writing-skills` |
| `smart-diagnose` | 某个 smart 会话出了问题，想知道为什么 | `diagnosing-superpowers`（改写适配） |

**照搬的原文独有表达**（这是"移植"的证据）：铁律措辞、`Common Rationalizations` 表、
`The Gate Function` 5 步、`Forbidden Responses` 禁语清单、`Task Right-Sizing` / `Interfaces` /
`Global Constraints` / `Review Focus` / `Self-Review` 五条、TDD 映射表 **10 行**、
`GIT_DIR` vs `GIT_COMMON` 判据与 submodule guard、5-Why 根因追溯。

---

## 2. 工作流：什么时候开任务

```js
smart_begin({ title, shape?, size?, goal? })
```

**`shape` 决定走哪些相位**（默认 `feature` = 现行为）：

| shape | 相位 | 门 | 典型 |
| --- | --- | --- | --- |
| `feature` | brainstorm → design → plan → acceptance → executing → reviewing | G1–G5 | 完整交付一个功能 |
| `fix` | brainstorm → plan → executing → reviewing | G1、G3、G5 | 修一处、要留证据 |
| `review` | **只有 reviewing** | G5 | 看看这个 diff |
| `investigation` | **只有 brainstorm** | G1 | 调查个问题、出结论 |

**`size` 决定每步花多少**（默认 `full`）：`light` ⇒ 设计相位的用户要点由 brain 自写
（**零 review child**）且不要求独立 consult；`standard` / `full` 照常派。

裁掉的相位是**不存在**，不是"存在但不查" —— 面板也不画那一格。

### `workflow: v1 | optimized`（默认 `v1`）

| | `v1` | `optimized` |
| --- | --- | --- |
| brainstorm 的独立 consult | 必须有 | **不要求** |
| brainstorm 的用户版要点 | review 路由生成 | **brain 自写**（`briefing` 参数），来源记 `brain/session` |
| design / plan / acceptance | 各 1 次 consult + 1 次要点 | **合成一次 review bundle**（同一 child 出两段） |
| plan 与 acceptance | 两个阶段两道门（G3、G4） | **一个阶段一道门**：两文件一次原子写入，G3 过直接进执行 |

`shape` / `size` / `workflow` 都**随任务落盘**：之后改行配置不换在途任务的语义。

---

## 3. 门、契约与两种裁决

**G1–G5 是用户门**（人点卡）。superpowers 的 task review 是模型门 —— **两层都留**。
门在这些时候不开：

- **产物缺内容契约**：`plan.md` 必须有 **每个任务一份 `**Interfaces:**`**（含 `Consumes` /
  `Produces` 签名）、`## Global Constraints`、`## Review Focus`。**写入时就挡**
  （不是等到 G3），缺什么逐条点名 —— 写法见 `smart-plan` 技能。
- **要点没确认**：产物落盘 → `smart_brief` 生成用户版要点 → **对话讨论** →
  `smart_brief_confirm` 才开门。*讨论不算批准。*
- **产物里留着「需要你裁决」小节**：用 `smart_decide` 收**用户**的决定，折回产物再开。

**两种裁决是两件事**：

| | `smart_decide` | `smart_ruling` |
| --- | --- | --- |
| 谁定 | **用户** | 模型 |
| 落点 | `state.decisions` | `state.rulings` |
| 分流判据 | *这件事只有用户能定吗？* | 能定的不许替他定，不能定的不许卡住 |

`smart_ruling` 记 `Ruling: 决定 — 为什么 — 错了代价`（**三段缺一不可**）。有裁决时
`smart_finish` 要求收尾总结**逐条提它** —— 那是替用户定的事，总结是它们唯一全在一起出现的地方。

---

## 4. 模型路由：三条规则

```yaml
routes:
  brain:  llm-mioffice/ppio/pa/gpt-6-astra@high        # 决策 / 产物
  hand:   llm-mioffice/deepseek/deepseek-flash@max     # 执行
  review: llm-mioffice/xiaomi/mimo-v2.6-pro@high       # 评审
  lite:   llm-mioffice/deepseek/deepseek-flash@high    # 机械子代理：探索 / 取证 / 并行调查
```

字符串形态 `provider/model[@effort]`，或行配置里的 `{ provider, model, reasoningEffort? }`
（多斜杠 model id 安全）。三个来源：**行配置** → **面板**（右抽屉「三模型路由」，写
`~/.dsh-fly/smart-routes.json`）→ **手改镜像文件**。都没配时**大声报错并指路**，不静默回落。

三条规则（都有测试 + A/B）：

1. **终审不许回落** —— `review` 路由的来源必须是显式配置（`preset`/`session`/`default`），
   `*-fallback` 一律拒。回落链最坏会跑到**执行者那条**上：自己审自己。
2. **返工升档** —— 同阶段 `attempts ≥ 2`（**第 3 稿起**，`attempts` 数的是返工次数、不是第几稿）
   把评审 effort 提到该模型支持的最高档；查不到档位表就原样跑并如实标注 `escalated: false`
   （不猜、不造档位名）。轮次记 `escalated` / `attempts`。
3. **技能派子代理** —— 机械活用 `lite`、多步推理用 `hand`、**评审永远走 `review`**。
   *"turn count beats token price"*：便宜模型在多步工作上常花 2–3 倍轮次，总成本反而更高。

---

## 5. 评审包与派发卫生

**评审包**：执行者落 `evidence/changes.md`（`git log --oneline BASE..HEAD` + `git diff --stat`
+ `git diff -U10`）。基线**在派发前**取（只读 `.git`，不跑命令），**绝不 `HEAD~1`** ——
那会悄悄吞掉多 commit 任务的前面那些。评审者与**写裁决的那位**都读它：
*"执行者的散文是**声称**，diff 才是证据"*。

**派发上下文卫生**（五条 prompt 一份答案）：不自派子代理（评审是你的活，不是你雇的人）、
大输出走文件（prompt 与回文都常驻父会话、每轮重读）、遇计划缺陷**自己定并记 `## Rulings`**、
只有四种理由停下来（不可逆 / 安全敏感 / worktree 外副作用 / 计划烂到每条路都是猜）。

---

## 6. 工具面（13 个）与平面

`smart_begin` · `smart_artifact` · `smart_consult` · `smart_decide` · `smart_ruling` ·
`smart_brief` · `smart_brief_confirm` · `smart_gate` · `smart_execute` · `smart_verify` ·
`smart_rework` · `smart_finish` · `smart_status`

**子会话不许驱动工作流**：判据是 `session.header.origin === 'subagent'` 或
`delegationDepth > 0`，任何 `smart_*` 一律拒（0.2.x 起宿主不再下发 per-child `toolFilter`，
这层由插件自守）。

`smart_status` 暴露 `metrics`（`reviewSpawns` / `handSpawns` / `brainRounds` / `consults` /
`briefings` / `bundleHits` / `bundleMisses` / `gatesPassed` …）、`rulings`、`phases`、
`shape` / `size`、`reviewPackage` —— 只读，不参与闸门判定。

**两个平面在同一包里**（角色对调后的形状）：

| 平面 | 入口 | `inject` | 挂载方式 |
| --- | --- | --- | --- |
| **宿主**（面板 + 自带技能） | `index.js` | `['webServer', 'skills']` | `cordis.patch.yml` 登记**裸包名**那一行 |
| **agent**（阶段机 + 工具） | `tools/index.js` | `['tools', 'commands', 'systemPrompt']` | preset 行 `name: dsh-plugin-fly-smart/tools/index.js`，按会话 |

`bundle` patch 里**只有裸名那一行**（带 `/` 的行名客户端半边登记得不上；带 `tools/` 的行
会让宿主开机激活工具插件）。两条都有 `verify-smart.mjs` 的断言钉着。

---

## 7. 面板（`fly.smart` 右抽屉）

画：阶段板（**按 `shape` 裁格**，`done` 与伴随格永远留着）、产物查看器、
**待裁决 n / 自裁 n**、返工额度、要点与路由来源、evidence、`metrics`。

---

## 8. 宿主契约

0.1.3 在 DSH 0.2.x 上**跑不起来**：`subagents.start('spawn', …)` 报
`subagents.start is not a function`。现在是：

```js
const activation = await subagents.startActivation({
  provider: 'spawn', label,
  request: { prompt: [{ type: 'text', text }], parent, agentOptions },
  signal, delivery: 'caller',   // caller：结果只回给调用方，不往父会话塞通知
})
const { output, stopReason } = await activation.result
await activation.dispose()
```

0.1.4 起**两条都支持**（有 `startActivation` 走新面，没有退回老 `start`）。

**一处能力损失，如实记**：新宿主的 `SubagentStartRequest` 里**没有 `toolFilter`**
（只剩在冷恢复描述符里），所以"给孩子禁掉 `smart_*`"下发不了 —— 由 §6 的插件自守补偿。
`smart_verify` 的只读名单（禁 `write`/`edit`）同理**只在老宿主生效**，新宿主上取证 child
仍有写工具。

---

## 9. 装 / 开发

- 宿主通过 `plugins.lock.json` 解析本仓（工作区 `$FLY_PLUGINS_DIR`，缺省 `../dsh-plugins`）。
- 本仓要**自己 install 一次**（测试 import 引擎 peer）：`pnpm install`
  （`.npmrc` 已把 `@deepseek-ai` 与默认 registry 钉到公开 npm —— 本机默认是内网镜像）。
- **本仓门禁**：`node --test tests/*.spec.mjs panel/tests/*.spec.mjs`（166 条）
  + `node scripts/verify-smart.mjs`（22 条源码形状：`files` 覆盖 import 图、bundle 恰好一行
  且是裸名、无 `tools/` 行、exports 三条、交付字节无内网 provider、必需文件在位）。
  **引擎无关**，任何机器都能跑。
- **改了 `src/client/` 要 `pnpm build:clients`**（在宿主仓跑，含外部插件），且**重启 dev app** ——
  引擎把客户端包缓存在**进程内**，刷新页面不够。
- **宿主侧集成验收**（scratch profile、`dsh plugin add`、preset 行、真跑阶段机）在
  **dsh-fly** 仓的 `scripts/verify-smart-integration.mjs`。

---

## 10. 投稿市场（投稿 ≠ 发布）

市场是**投稿审核制**，不是推上去就上架。顺序：**先做完 Public 试运行**
（[`docs/public-trial.md`](docs/public-trial.md)），再投稿。文案要点三条：
**移植自谁**（归因）· **不是它**（DSH 移植，非官方）· **多了什么**（五项扩展）。

**发布（tag → OIDC）**：升 `version` → 提交 → 打注释 tag → 推 tag ⇒ `release.yml` 自动
`npm publish --access public`（Trusted Publisher，不需要 token / 2FA）。

- **暂时不带 `--provenance`**：npm 要求 provenance 的 `repository` 指向 **public** 仓库，
  本仓现为私有 ⇒ 带 flag 必然失败（历史实证：0.1.0–0.1.3 的 `dist.attestations` 全为 `None`）。
  仓库转 public 那天把那行改回来，注释里写着同样的话。
- **0.1.0 是历史遗留**：包还在 dsh-fly 的 `packages/` 里、用 `npm stage publish` 发的。
  **0.1.1 起**从本仓走 tag 发布。
- 重推同一个 tag **不会**重跑 workflow ⇒ 要重跑就换一个新 tag。
- 验收（**换缓存键**再读）：`/-/package/<name>/dist-tags` 与 packument 各读一次
  `latest == 新版本`、`dist.tarball` 拉下来确认代码在里面、README 是本版快照。

---

## 11. 许可

MIT（本包）。方法论内核移植自 obra/superpowers（MIT，Copyright (c) 2025 Jesse Vincent），
全文与移植清单见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)；每个
`assets/*/SKILL.md` 头部带出处注释。**本包不是** obra/superpowers 的官方移植，也不是它本身。
