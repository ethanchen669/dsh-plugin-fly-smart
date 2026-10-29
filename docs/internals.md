# fly-smart 内部契约（给协作者）

面向**改这个插件**的人。使用者看 [`../README.md`](../README.md)。

---

## 1. 两个平面（同一包里）

| 平面 | 入口 | 职责 |
| --- | --- | --- |
| 宿主 | `index.js` | 认领 `/fly/smart` 前缀、只服务 `/routes`（GET/POST）+ 命名空间探测、注册内置技能 |
| 智能体 | `tools/index.js` | 注册 `smart_dispatch` 与 `smart_check_doc` 两个工具 |

两个平面**只通过一个文件说话**：`~/.dsh-fly/smart-routes.json`（`DSH_FLY_SMART_ROUTES` 可覆盖）。
面板写它，工具读它。镜像之外没有共享状态。

## 2. 工具面（2 个）

| 工具 | 做什么 | 关键约束 |
| --- | --- | --- |
| `smart_dispatch({ role, prompt, label? })` | 在配置的路由上跑一个子代理 | `role` 只有 `hand` / `review`（配置面能表达的那两个）；每次调用现读路由；回执带 `route` + `source` |
| `smart_check_doc({ path, kind? })` | 校验计划 / 验收文档契约 | 路径必须绝对（宿主 cwd 是 `/`）；`kind` 按 `-acceptance.md` 后缀推断 |

**子代理会话不能调用它们**：宿主 0.2.x 的 `startActivation` 请求里已经没有 `toolFilter`，
所以"子代理不许再派子代理"这层约束必须由插件自己守（读 `header.origin` / `delegationDepth`）。

## 3. 路由解析（`lib/dispatch.mjs`）

三层 + 一个硬底，**每次调用现读**（面板保存后下一次派发生效，不需要重挂载）：

```
preset（行配置 handRoute / reviewRoute）
  → session（镜像 sessions[<id>].hand / .review）
    → default（镜像 default.hand / .review，兼容顶层 legacy hand）
      → 都没有 ⇒ missingRouteError（文案里给三个去处与镜像绝对路径）
```

- **review 回落**：没有显式 review 时复用 hand，`source` 报 `<session|default>-fallback`。
  这是"执行者在审自己"的信号，调用方必须能看见 —— 所以 `source` 是回执的一部分，不是日志。
- **brain 不可派发**：`brain` 是**会话模型**（决策 / 产物 / 与用户对话），不是可派的位子；
  镜像里的 `brain` 与行配置的 `brainRoute` 只做只读兼容展示（`consumer: null`）。
  派发角色只有 `hand` / `review` / `lite`。
- **一致性**：宿主面 `readRoutesConfig`（`index.js`）与工具面 `resolveRoute`（`lib/dispatch.mjs`）
  是两套实现，`tests/dispatch.spec.mjs` 用同一份镜像逐字段对拍，防止"页面说 X、工具用 Y"。

## 4. 派发契约（双宿主）

| 宿主 | 调用 | 返回 |
| --- | --- | --- |
| 0.2.x | `subagents.startActivation({ provider:'spawn', label, request, signal, delivery:'caller' })` | `{ childId, result(), dispose() }` |
| 0.1.x | `subagents.start('spawn', { label, prompt, parent, agentOptions, signal })` | `{ result(), dispose() }` |

两条坑都在这套代码里踩过，`lib/dispatch.mjs` 的 `startChild` 一并收口：

- `result` 是**方法**不是属性（老实现 `await handle.result` 等到的是函数本身，调用方读到 `undefined`）；
- activation 句柄挂着 Cordis 代理，只能让 `result` 的值离开函数（`JSON.stringify(handle)` 会炸 `toJSON`）。

## 5. 文档契约（`lib/doc-contract.mjs`）

| 文件 | 判据 |
| --- | --- |
| 计划 | `## Global Constraints`、`## Review Focus`；每个 `^### Task` 块里一份 `**Interfaces:**`，且含 `Consumes` / `Produces` |
| 验收 | 含「验收」的 `##` 节；至少一条 `- [ ]`；每条同时含「检查」与「预期」；不得留「需要你裁决」节 |

判据刻意钝（标题 + 关键词）：聪明的解析漏掉一节，比偶尔多报更糟。

## 6. 面板（`src/client/index.tsx`）

一张卡：`hand` / `review` 两个输入框（`brain` 只读）、模型目录下拉（`modelDirectories`，
不可用时退回手填并说明原因）、「当前生效」一栏（值 + 来源层）。
写路径只有 `POST /fly/smart/routes`。

样式：`workbench-css.ts` 是设计系统的**逐字节副本**（`scripts/sync-panel-style.mjs --check`
在门禁里比对），不要手改。

## 7. 技能（`assets/`）

`assets/<name>/SKILL.md`，frontmatter 只有 `name` + `description`。
**注册时一次性展开**：加/改技能必须重启进程（刷新页面不够），原因见 §8。

门禁有一条死引用钉子：`assets/` 里出现已删工作流工具的名字即红
（正则排除 `/smart-routes.json` 与 `assets/smart-*/` 这类现役路径）。

## 8. 装 / 开发 / 验证

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
  实测（2026-10-23）：磁盘 10 个技能，运行中的 dev app 目录里仍是 7 个，重启后才有 10 个。
  这是**设计**不是 bug（`apply()` 的注释要求"注册时就展开全部技能"，少一个 SKILL.md 或
  frontmatter 缺键要当场抛），代价就是"加技能必须重启" —— 试运行手册把它列成开跑前的第 1 步。
- 宿主侧集成验收在 dsh-fly 仓 `scripts/verify-smart-integration.mjs`

### 纪律（都在这套代码里踩过）

- **桩必须与真接缝同形**：`tests/dispatch.spec.mjs` 的 `activationStub` / `startStub` 分别按两条真契约发
  —— 老桩只给 `start` 曾让整版绿在一条真机上不存在的路上
- **A/B 的变异要贴真实失败模式**：加注释当变异会因语法错红，那不算证据
- **闸门不静默放宽**：裁剪 = 相位不存在，不是"存在但不查"
- **资产进包**：`files` 列了不等于进 tarball，验收用 `npm pack --dry-run` 逐条核对

---

## 9. 投稿 / 发布

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
