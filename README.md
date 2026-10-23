# dsh-plugin-fly-smart

**带用户门禁的三模型工作流** —— DeepSeek Harness 插件。

方法论移植自 [obra/superpowers](https://github.com/obra/superpowers)（MIT）：
脑设计、评审把关、手执行，**每一道门你来开**。外加 10 个可独立触发的技能 ——
多数日常事不必走工作流。

> **装了能得到什么**：说「修个 bug」就按根因排查走；说「做这个功能」就进带门禁的工作流；
> 每一份产物你都看得见、批得了、退得回。

---

## 它解决什么

让模型干活时**少自作主张、多留痕迹**：

| 常见问题 | 这里怎么处理 |
| --- | --- |
| 模型「我觉得你要的是这个」 | 脑暴先摆**决策表**给你挑方案，选完才进设计 |
| 计划写了等于没写 | `plan.md` 有**内容契约**：每个任务声明它的接口、全局约束、风险面 |
| 评审形同虚设 | 评审走**独立路由**，且**不许回落**到执行者那条 —— 不能自己审自己 |
| 改完了不知道改了啥 | 执行者落**评审包**（commit 列表 + diff），裁决对着 diff 判 |
| 模型替你做了决定没人知道 | 逐条记「决定 — 为什么 — 错了代价」，收尾总结必须提 |
| 小事被 6 个阶段碾过去 | `shape` / `size` 决定走几步、每步花多少 |

---

## 10 个技能：不用开任务也能用

技能按你说话的场景自动命中。**多数日常事到这里就够了。**

| 你说 | 会用 |
| --- | --- |
| 「这个测试挂了」 | `smart-debug` —— 先找根因，症状修复不算修 |
| 「给它加个函数」 | `smart-tdd` —— 先写失败的测试，看着它失败 |
| 「我改完了，能提交吗」 | `smart-verify-claim` —— 证据先于断言 |
| 「评审说这里要改」 | `smart-review-receive` —— 先核实再改，不许表演式同意 |
| 「这是 spec，写个计划」 | `smart-plan` —— 给没见过代码库的工程师写 |
| 「开个分支做这个」 | `smart-worktree` —— 先隔离，绝不在 main 上开工 |
| 「这 3 个测试都挂了」 | `smart-parallel` —— 各派一个并行查 |
| 「我要写个技能」 | `smart-write-skill` —— 写技能就是把 TDD 用在文档上 |
| 「这个任务卡住了」 | `smart-diagnose` —— 症状→假设→验证，每条结论带出处 |
| 「我要开始做个东西」 | `smart-skills` —— 先查再动 |

---

## 需要把关时：开任务

```js
smart_begin({ title, shape, size })
```

| `shape` | 走什么 | 适合 |
| --- | --- | --- |
| `feature` | 设计 → 计划 → 执行 → 验收（G1–G5） | 完整交付一个功能 |
| `fix` | 脑暴 → 计划 → 执行 → 验收（G1、G3、G5） | 修一处、要留证据 |
| `review` | 只做验收（G5） | 看看这段 diff |
| `investigation` | 只做脑暴（G1） | 调查个问题、出结论 |

`size: light | standard | full` 决定每步花多少 —— `light` 不派评审子代理，适合小改动。

**门是给你点的**。每一阶段：

1. 产物落盘 → 生成一份**要点**，我们当面对一遍（你可以提修改）
2. 你觉得没问题 → 确认 → 打开这道门
3. 不满意 → 退回，旧版本进历史不删

*讨论不算批准，你说过「可以」才算。*

---

## 模型路由

**脑**设计 · **手**执行 · **评审**把关 —— 三条路由在插件设置里配，工作台面板也能改。

```
brain:   <provider>/<strong-model>@high    # 决策 / 产物
hand:    <provider>/<fast-model>@max       # 执行
review:  <provider>/<strong-model>@high    # 评审
lite:    <provider>/<fast-model>@high      # 探索 / 取证 / 并行调查
```

三条规则：

- **评审不许回落**到执行者的模型 —— 自己审自己等于没审
- **同一处反复返工**时，评审自动升到该模型的最高推理档（并且告诉你升了）
- 便宜模型在多步工作上常花 2–3 倍轮次，**总成本反而更高** —— 纯机械的活才用 `lite`

---

## 工作台面板

`fly.smart` 右抽屉：阶段板、产物查看器、待裁决 / 自裁决、返工额度、
每轮评审用的哪个模型、证据文件、花了多少次子代理调用。

---

## 装

```
dsh plugin add dsh-plugin-fly-smart
```

配好三条路由即可开用。没配会**大声报错并指路**，不会静默跑偏。

需要完整交付能力时，把它挂进 agent preset（见 [`docs/internals.md`](docs/internals.md)）。

---

## 更多

| 看什么 | 去哪 |
| --- | --- |
| 工作流细节、门与契约、两种裁决、工具面 | [`docs/internals.md`](docs/internals.md) |
| superpowers 移植清单与许可全文 | [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) |
| Public 试运行手册 | [`docs/public-trial.md`](docs/public-trial.md) |

## 许可

MIT。方法论内核移植自 obra/superpowers（MIT，Copyright (c) 2025 Jesse Vincent），
移植清单见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
**本插件不是** obra/superpowers 的官方移植，也不是它本身。
