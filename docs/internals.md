# fly-smart 内部契约（给协作者）

面向**改这个插件**的人。使用者看 [`../README.md`](../README.md)。

---

## 1. 两个平面（同一包里）

| 平面 | 入口 | `inject` | 挂载方式 |
| --- | --- | --- | --- |
| **宿主**（面板 + 自带技能） | `index.js` | `['webServer', 'skills']` | `cordis.patch.yml` 登记**裸包名**那一行 |
| **agent**（阶段机 + 工具） | `tools/index.js` | `['tools', 'commands', 'systemPrompt']` | preset 行 `name: @dsh-fly/dsh-plugin-fly-smart/tools/index.js`，按会话 |

`dsh.bundle.patch` 指向 `cordis.patch.yml`，里面**只有裸名那一行**：

- 带 `/` 的行名 ⇒ 客户端半边登记得不上（面板不出现在浏览器）
- 带 `tools/` 的行 ⇒ 宿主开机激活工具插件

两条都有 `scripts/verify-smart.mjs` 的断言钉着。

**状态机只有一份**（`lib/state.mjs`），宿主平面不复制它 —— 两份会给出两个"任务在哪一阶段"。
`panel/reader.js` 里唯一与 `lib/state.mjs` 同源的是 `phasesFor`（判据相同，两边都有测试钉）。

---

## 2. 工具面（13 个）

`smart_begin` · `smart_artifact` · `smart_consult` · `smart_decide` · `smart_ruling` ·
`smart_brief` · `smart_brief_confirm` · `smart_gate` · `smart_execute` · `smart_verify` ·
`smart_rework` · `smart_finish` · `smart_status`

**子会话不许驱动工作流**：判据是 `session.header.origin === 'subagent'` 或
`delegationDepth > 0`，任何 `smart_*` 一律拒（0.2.x 起宿主不再下发 per-child `toolFilter`，
这层由插件自守）。

`smart_status` 暴露：`metrics`（`METRIC_KEYS` 10 项）、`rulings`、`phases`、
`shape` / `size`、`reviewPackage`、`workflow`、`spawns`（派生估算）—— **只读**，
不参与闸门判定。

---

## 3. 阶段机与 shape

`PHASES = ['brainstorm','design','plan','acceptance','executing','reviewing','done','cancelled']`；
`GATE_AFTER`：G1–G5 对应 brainstorm / design / plan / acceptance / reviewing。

**每个任务走自己的相位序列**（`phasesFor(state)`）：

```js
SHAPES = {
  feature:       ['brainstorm','design','plan','acceptance','executing','reviewing'],
  fix:           ['brainstorm','plan','executing','reviewing'],
  review:        ['reviewing'],
  investigation: ['brainstorm'],
}
// 再按 workflow === 'optimized' 去掉 acceptance（那一相位不存在）
```

**裁掉的相位是「不存在」，不是「存在但不查」** —— `recordArtifact` 对不在序列里的相位
报 `not one of them`（不是"还没到"），`gateGaps` 只对序列里的相位要产物。

`size`：`light` ⇒ 设计相位的用户要点由 brain 自写（`briefingSourceFor` 返回 `inline`），
且 `consultPhasesFor` 返回空（零 review child）。

`shape` / `size` / `workflow` 都**随任务落盘**（`createTask` 的 meta）—— 之后改行配置
不换在途任务的语义。

---

## 4. 门、契约与两种裁决

### 内容契约（写入时就挡）

`plan.md` 必须有：

- **每个 `### Task` 块一份 `**Interfaces:**`**（含 `Consumes` / `Produces`）
- `## Global Constraints`（spec 的项目级约束，逐字抄）
- `## Review Focus`（spec 暗示但没被任务的测试覆盖的输入类）

判据刻意**钝**（同 `openDecisions` 的理由）：小节标题 + 关键词的字面出现，围栏内的不算。
聪明的解析会漏掉一节，而漏掉那节正是计划不可执行的原因。

`assertPlanContract` 在 `recordArtifact(phase:'plan')` 与 `recordPlanAcceptance` 落盘前调；
`gateGaps` 仍在门上兜（defense in depth：盘上的文件可能被人手改过）。

### 两种裁决

| | `smart_decide` | `smart_ruling` |
| --- | --- | --- |
| 谁定 | **用户** | 模型 |
| 落点 | `state.decisions` | `state.rulings` |
| 分流判据 | *这件事只有用户能定吗？* | 能定的不许替他定，不能定的不许卡住 |

`recordRuling` 要求三段（`decision` / `why` / `costIfWrong`）**都非空** —— 只写决定不写代价的
裁决，事后没法判断该不该回滚。执行报告的 `## Rulings` 小节由 `rulingsFromReport` 折叠进
state，拆不出三段的整条丢弃并照实计数。

有裁决时 `smart_finish` 要求收尾总结**提到裁决**（判据钝：正文里出现「裁决」或 `Ruling`）。

### 要点回路

产物落盘 → `smart_brief` 生成用户版要点 → 对话讨论 → `smart_brief_confirm` → 门开。
要点要覆盖产物的每个 `##` 小节（`missingBriefingSections`），缺节不写轮。

`source` 如实记：review 路由生成记 `preset`/`session`/`default`，brain 自写记 `brain/session`
（provider/model 为空 —— **不伪装成独立评审**）。

---

## 5. 路由：三条规则

形态 `provider/model[@effort]`（`parseRouteValue` 只切**第一个** `/`，多斜杠 model id 安全）
或 `{ provider, model, reasoningEffort? }`。

三个来源：行配置 → 面板（写 `~/.dsh-fly/smart-routes.json`）→ 手改镜像。都没配时
**大声报错并指路**。

1. **终审不许回落** —— `assertFinalReviewRoute(source)` 只认 `preset`/`session`/`default`，
   `*-fallback` 一律拒。回落链最坏会跑到执行者那条上。
2. **返工升档** —— `escalatedEffort(route, attempts, supported)`：`attempts ≥ 2`（**第 3 稿起**；
   `attempts` 数的是返工次数、不是第几稿）把 effort 提到该模型支持的最高档；查不到档位表
   原样返回并标 `escalated: false`（不猜、不造档位名）。轮次记 `escalated` / `attempts`。
3. **档位按路由查** —— `supportedEffortsOf(exec, route)`，**不写死 brainRoute**：
   拿 brain 的档位表去抬 review 的 effort 会造出该模型没有的档位名。

---

## 6. 评审包与派发卫生

`gitHeadOf(dir)` 只读 `.git`（工具层没有 shell 座位，也不该为此加一个）：支持 `.git` 目录、
worktree/submodule 的 `gitdir:` 指针、`ref:` 与 `packed-refs`。**取在派发前** ——
派发后再算会漏掉多 commit 任务的前面那些（绝不 `HEAD~1`）。

执行者落 `evidence/changes.md`（`git log --oneline BASE..HEAD` + `--stat` + `-U10`）。
`smart_verify` 与写裁决的那位都读它；没落就**照实说没有**，不假装、不代编。

`DISPATCH_HYGIENE` 是**一份答案**，五条 prompt（briefing / bundle / consult / execute / verify）
共同引用：不自派子代理、大输出走文件、遇计划缺陷自己定并记 `## Rulings`、只有四种理由停下来。

---

## 7. workflow 策略

| | `v1` | `optimized` |
| --- | --- | --- |
| brainstorm 的独立 consult | 必须有 | 不要求 |
| brainstorm 的用户版要点 | review 路由生成 | brain 自写（`brain/session`） |
| design / plan / acceptance | 各 1 consult + 1 要点 | **合成一次 review bundle**（同一 child 出两段） |
| plan 与 acceptance | 两阶段两道门 | **一对产物一次原子写入**（`writeAtomicMany`），G3 过直接进执行 |

bundle 两段用固定分隔行（`=== BRIEFING ===` / `=== CONSULT ===`）；缺段或空段 ⇒
**fail closed**：产物保留、要点记失败、**consult 一行都不写**、可重试。
`smart_consult` 先查 `freshReviewBundle`（按 artifact sha + 伴随 sha，**不按时间**）。

---

## 8. 宿主契约

0.1.3 在 DSH 0.2.x 上报 `subagents.start is not a function`。现在：

```js
const activation = await subagents.startActivation({
  provider: 'spawn', label,
  request: { prompt: [{ type: 'text', text }], parent, agentOptions },
  signal, delivery: 'caller',   // 结果只回给调用方，不往父会话塞通知
})
const { output, stopReason } = await activation.result
await activation.dispose()
```

0.1.4 起**两条都支持**（有 `startActivation` 走新面，没有退回老 `start`）。

**能力损失，如实记**：新宿主 `SubagentStartRequest` 里**没有 `toolFilter`**
（只剩在冷恢复描述符里）⇒ "给孩子禁 `smart_*`"下发不了，由工具层自守补偿。
`smart_verify` 的只读名单（禁 `write`/`edit`）**只在老宿主生效**，新宿主上取证 child 仍有写工具。

---

## 9. 装 / 开发 / 验证

- 宿主通过 `plugins.lock.json` 解析本仓（工作区 `$FLY_PLUGINS_DIR`，缺省 `../dsh-plugins`）
- 本仓要**自己 install 一次**（测试 import 引擎 peer）：`pnpm install`
  （`.npmrc` 已把 `@deepseek-ai` 与默认 registry 钉到公开 npm）
- **门禁**：`node --test tests/*.spec.mjs panel/tests/*.spec.mjs` + `node scripts/verify-smart.mjs`
  （源码形状：`files` 覆盖 import 图、bundle 恰好一行且是裸名、无 `tools/` 行、exports 三条、
  **交付字节无内网 provider**、必需文件在位）。**引擎无关**，任何机器都能跑。
- **改 `src/client/` 要 `pnpm build:clients`**（宿主仓跑，含外部插件）+ **重启 dev app**
  （引擎把客户端包缓存在进程内，刷新不够）
- **新增/改名 `assets/<name>/SKILL.md` 也要重启进程**，刷新页面同样不够 —— 而原因不同：
  技能清单是**注册时一次性展开**的。`ctx.skills.registerProvider(create)` 里
  `provider = create(control)` 只调**一次**（`dsh-skill/lib/index.js:147`），
  `smartSkillProvider()` 于是在**那一刻**把 `bundledSkills()` 读成固定数组、`list()` 只是
  闭包返回它 ⇒ 之后往磁盘加技能，这个进程永远看不见。
  实测（2026-10-23）：磁盘 10 个技能，运行中的 dev app 目录里仍是 7 个（差 `smart-diagnose`
  / `smart-parallel` / `smart-write-skill`），重启后才有 10 个。
  这是**设计**不是 bug（`apply()` 的注释要求"注册时就展开全部技能"，少一个 SKILL.md 或
  frontmatter 缺键要当场抛），代价就是"加技能必须重启" —— 试运行手册把它列成开跑前的第 1 步。
- 宿主侧集成验收在 dsh-fly 仓 `scripts/verify-smart-integration.mjs`

### 纪律（都在这套代码里踩过）

- **桩必须与真接缝同形**：`tests/seams.mjs` 的 `childService` 同时给 `startActivation` 与 `start`
  —— 老桩只给 `start` 曾让整版绿在一条真机上不存在的路上
- **A/B 的变异要贴真实失败模式**：加注释当变异会因语法错红，那不算证据
- **闸门不静默放宽**：裁剪 = 相位不存在，不是"存在但不查"
- **资产进包**：`files` 列了不等于进 tarball，验收用 `npm pack --dry-run` 逐条核对

---

## 10. 投稿 / 发布

市场是**投稿审核制**，不是推上去就上架。顺序：**先跑完 Public 试运行**
（[`public-trial.md`](public-trial.md)）再投稿。文案要点三条：移植自谁（归因）·
**不是它**（DSH 移植，非官方）· 多了什么（五项扩展）。

**发布（tag → OIDC）**：升 `version` → 提交 → 打注释 tag → 推 tag ⇒ `release.yml` 自动
`npm publish --access public --provenance`（仓库已 public，provenance 条件满足）。

- 重推同一个 tag **不会**重跑 workflow ⇒ 要重跑就换一个新 tag。
- 验收（**换缓存键**）：`/-/package/<name>/dist-tags` 与 packument 各读一次
  `latest == 新版本`、拉 tarball 确认代码在里面。

> **发布参数的当前取舍写在 `release.yml` 的注释里**（那一行要改的时候，人就看在跟前），
> 不写进本文档 —— 这类「现在是这样、将来会翻」的状态写在文档里只会过期。
