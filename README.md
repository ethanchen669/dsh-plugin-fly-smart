# @dsh-fly/dsh-plugin-fly-smart

**模型路由 + 17 个技能** —— DeepSeek Harness 插件。

方法论移植自 [obra/superpowers](https://github.com/obra/superpowers)（MIT）。
插件的活是两件事：让**子代理跑在你指定的模型上**，以及让**工作纪律在需要时才出现**。

> **0.3.0 是瘦身版**：0.2.x 的三模型工作流（阶段机、G1–G5 用户门、14 个 `smart_*` 工具、
> 任务树面板）已删除 —— 它太重、用得也少。留下的三样是每天在用的：**模型路由面板**、
> **按路由派发子代理**、**技能**。计划与验收改回普通 markdown，落在项目自己的 `docs/plans/` 下。
> 存量数据（`~/.dsh-fly/smart/`、各工作区 `docs/smart/`）一个字节没动，仍可当普通文件读。

---

## 它解决什么

| 常见问题 | 这里怎么处理 |
| --- | --- |
| 所有活都用会话模型干，贵模型被当苦力 | `smart_dispatch({ role: 'hand' })` 按面板配的路由派子代理 |
| 「评审」变成自己夸自己 | `role: 'review'` 走评审路由；没有 review 模型时如实回报 `source: *-fallback` |
| 面板改了模型，工具还在用旧的 | 路由**每次调用现读**，保存后下一次派发生效 |
| 计划写了等于没写 | `smart_check_doc` 逐条校验文档契约（Interfaces / 约束 / 风险面 / 验收标准） |
| 模型替你做了决定没人知道 | `smart-verify-claim` 的「发现对账」：每条发现必须有终态 |
| 小事被流程碾过去 | 技能是**按需触发**的，不写文件、不开任务也能用 |

---

## 17 个技能：不用开任务也能用

技能按你说话的场景自动命中。**多数日常事到这里就够了。**

| 你说 | 会用 |
| --- | --- |
| 「这个方案选哪个」 | `smart-brainstorm` —— 先摆决策表（问题 / 候选 / 倾向 / 未决），再选 |
| 「方案定了，怎么设计」 | `smart-design` —— 五问定形状：组件 / 接口 / 数据 / 错误 / 接缝 |
| 「这个设计为什么这么定」 | `smart-adr` —— ADR-lite 五段：上下文 / 候选 / 决定与代价 / 后果 / 重开条件 |
| 「怎么算过」 | `smart-acceptance` —— fixture / gate / probe，先于实现写验收件 |
| 「帮我看看这个 diff」 | `smart-review` —— 判词前先有证据，阻塞 / 非阻塞 / 需要裁决三档 |
| 「这个测试挂了」 | `smart-debug` —— 先找根因，症状修复不算修 |
| 「给它加个函数」 | `smart-tdd` —— 先写失败的测试，看着它失败 |
| 「我改完了，能提交吗」 | `smart-verify-claim` —— 证据先于断言 + 发现对账 |
| 「评审说这里要改」 | `smart-review-receive` —— 先核实再改，不许表演式同意 |
| 「这是 spec，写个计划」 | `smart-plan` —— 给没见过代码库的工程师写，落 `docs/plans/` |
| 「按这个计划做」 | `smart-execute` —— 台账 + 裁定 + 终审；压缩后信台账与 git log |
| 「做完了，怎么落地」 | `smart-finish` —— 先验证，再给合并 / PR / 保留三个选项 |
| 「开个分支做这个」 | `smart-worktree` —— 先隔离，绝不在 main 上开工 |
| 「这 3 个测试都挂了」 | `smart-parallel` —— 各派一个并行查 |
| 「我要写个技能」 | `smart-write-skill` —— 写技能就是把 TDD 用在文档上 |
| 「模型没按我配的跑」 | `smart-diagnose` —— 路由与派发的症状→假设→验证 |
| 「我要开始做个东西」 | `smart-skills` —— 先查再动 |

---

## 模型路由

两条路由，在插件设置或右抽屉「Smart 模型路由」里配：

```
hand:    <provider>/<model>[@effort]   # 执行类派发（默认）
review:  <provider>/<model>[@effort]   # 独立评审
lite:    <provider>/<model>[@effort]   # 机械活的便宜模型（探索 / 取证 / 并行调查）
```

三层 + 一个硬底（`lib/dispatch.mjs`）：

```
preset（行配置 handRoute / reviewRoute，压过面板）
  → session（镜像 ~/.dsh-fly/smart-routes.json 的 sessions[<id>]）
    → default（镜像 default，兼容顶层 legacy hand）
      → 都没有 ⇒ 调用时大声报错并指路
```

两条规则：

- **评审会回落，但回落实话实说**：没配 review 时 `role: 'review'` 复用 hand，
  回执 `source` 是 `*-fallback` —— 那意味着执行者在审自己，**要告诉用户**。
- **每次调用现读**：面板保存后下一次派发生效，不需要重启。
- **lite 不回落**：没配 lite 时 `role: 'lite'` 大声报错，不静默用贵模型跑机械活
  （review 回落 hand 是语义豁免，lite 回落是成本事故 —— 两条规则故意不对称）。
- **brain 不是可派发角色**：brain 就是**会话自己的模型**（想方案、做设计、写计划、和用户对话），
  面板只读展示它的历史字段。派发只有 hand / review / lite 三个角色 ——
  设计期工作在会话里做，交付物才派发。

---

## 派发子代理

```js
smart_dispatch({ role: 'hand',   prompt: '<自包含的任务说明>' })
smart_dispatch({ role: 'review', prompt: '审 <路径>：结论分阻塞 / 非阻塞 / 需要裁决' })
```

回执是 `{ text, route: { provider, model }, source }` —— **`route` 是这一次实际用的模型**，
不是"应该配了哪个"。

---

## 文档契约

```js
smart_check_doc({ path: '/abs/path/docs/plans/2026-10-29-x.md' })
smart_check_doc({ path: '/abs/path/docs/plans/2026-10-29-x-acceptance.md' })
```

| 文件 | 要求 |
| --- | --- |
| 计划 `*.md` | 每个任务块带 `**Interfaces:**`（Consumes / Produces）+ `## Global Constraints` + `## Review Focus` |
| 验收 `*-acceptance.md` | 含「验收」的 `##` 节、至少一条 `- [ ]`、每条同时带「检查」与「预期」、不留「需要你裁决」 |

判据刻意做得钝（标题 + 关键词）：聪明的解析漏掉一节，比偶尔多报更糟。
缺什么就逐条列出来，一次报全。

---

## 工作台面板

`fly.smart` 右抽屉：模型路由卡（hand / review 可写、brain 只读、模型目录下拉）
+ 「当前生效」一栏告诉你实际会用哪一层。任务树面板随工作流一起删除。

---

## 装

```
dsh plugin add @dsh-fly/dsh-plugin-fly-smart
```

配好两条路由即可开用。没配会**大声报错并指路**，不会静默跑偏。

---

## 已知限制

- **从 0.2.x 升级**：14 个 `smart_*` 工具与 `/smart` 命令已删除。旧会话里调它们会得到
  unknown tool —— 那是预期行为，不是故障。旧任务目录仍在磁盘上，可按普通 markdown 阅读。
- **子代理不能派发子代理**：`smart_dispatch` 在子会话里直接拒绝（宿主已不再给子代理收窄工具面，
  这层守卫由插件自己守）。
- **`smart_check_doc` 只做机械判据**：契约齐不齐它能判，"这段计划写得对不对"仍需人读。

---

## 更多

| 看什么 | 去哪 |
| --- | --- |
| 内部结构、路由解析、派发契约 | [`docs/internals.md`](docs/internals.md) |
| superpowers 移植清单与许可全文 | [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) |
| 本次瘦身的计划与验收（新产物约定的实例） | [`docs/plans/2026-10-29-slim-fly-smart.md`](docs/plans/2026-10-29-slim-fly-smart.md) |

## 许可

MIT。方法论内核移植自 obra/superpowers（MIT，Copyright (c) 2025 Jesse Vincent），
移植清单见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
**本插件不是** obra/superpowers 的官方移植，也不是它本身。
