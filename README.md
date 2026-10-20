# dsh-plugin-fly-smart

Fly **smart 工作流**的 **agent 平面**半边：阶段机（brainstorm → design → plan → execute → review）
+ `smart_*` 工具面，由 preset **按会话**挂载。

- **故意不带 `dsh.bundle`**：本包是 agent 平面（行声明 `inject: ['tools']`），宿主平面在开机时激活它会
  让 Host 去挂一个工具插件 —— dsh-fly 的 `scripts/lib/fly-profile.mjs` 注释里为挡这件事写下了理由。
- **工作台面板是另一个包**：`dsh-plugin-fly-smart-panel`（client plane，画 G1–G5 门、待裁决、阶段卡）。
  两个平面共用一份**路由契约**（本仓 `lib/state.mjs` 读镜像，面板写镜像）：本仓的
  `tests/routes.spec.mjs` 会**跨仓解析**面板的 `routes.mjs` 来断这份契约（找不到就大声抛，不软跳过）。
- **三模型路由**（brain / hand / review）是**用户机器**上的状态（`~/.dsh-fly/smart-routes.json`，面板写），
  行配置 `<field>Route` 优先；未配置时工具会大声报错并指路。

## 工作流策略：`workflow`

行配置（或 preset 行）可写 `workflow: v1 | optimized`，**默认 `v1`** —— 既有任务一行代码都不变。
版本在 `smart_begin` 时**记进任务 state**，之后改行配置不会让在途任务换语义。

| | `v1`（历史行为） | `optimized`（省一轮评审） |
| --- | --- | --- |
| brainstorm 的独立 consult | 必须有 | **不要求**（候选方案阶段还没有可执行性可审） |
| brainstorm 的用户版要点 | review 路由生成 | **brain 自己写**（`smart_artifact` 的 `briefing` 参数），来源记 `brain/session` |
| design / plan / acceptance | review consult + review 要点（各 1 次子代理） | **合成一次 review bundle**（同一 child 出要点 + consult） |
| plan 与 acceptance | 两个阶段、两道门（G3、G4） | **一个阶段一道门**：两文件一次原子写入、一起评审，G3 通过直接进执行 |
| 执行 / 验收 | 同左 | 同左 |

两条不变量：
- **brain 自写的要点仍要过同一条完整性检查**（每个 `##` 小节都要点到），缺节不写轮、门不开；
- **来源必须如实**：`brain/session` 的轮没有 provider/model，状态与面板里的路由显示为空，
  不会伪装成独立评审。

省了多少钱可以从磁盘算：`smart_status` 的 `spawns` 给出至今的**子代理调用**估算
（review 要点轮 + consult + 取证 + 执行报告）；`inline` 单独报 brain 自写、没起 child 的轮次
（optimized 的 brainstorm 就是 0 次调用 + 1 轮 inline）。它不参与任何闸门判定。

## 宿主契约（2026-10-20 修正：`subagents.start` 已经不在服务面上）

0.1.3 在 DSH 0.2.x 上**跑不起来**：`subagents.start('spawn', …)` 报
`subagents.start is not a function`。宿主把子代理接缝换成了

```js
const activation = await subagents.startActivation({
  provider: 'spawn', label,
  request: { prompt: [{ type: 'text', text }], parent, agentOptions },
  signal, delivery: 'caller',          // caller：结果只回给调用方，不往父会话塞通知
})
const { output, stopReason } = await activation.result
await activation.dispose()
```

0.1.4 起**两条都支持**：有 `startActivation` 走新面，没有就退回老的 `start`（插件会被装进
别人的 profile，宿主版本不由我们决定）。

**一处能力损失，如实记在这里**：新宿主的 `SubagentStartRequest` 里**没有 `toolFilter`**
（它只剩在冷恢复的描述符里），所以"给孩子禁掉 `smart_*` 工具"这层约束**下发不了**。
补偿控制改成**插件自守**：任何 `smart_*` 工具在子会话里调用一律拒绝
（判据是 `session.header.origin === 'subagent'` 或 `delegationDepth > 0`）。
`smart_verify` 的只读名单（禁 `write`/`edit`）同理只在老宿主生效 —— 新宿主上取证 child
仍有写工具，这一点必须知道。

## 装 / 开发

- 作为 preset 行：宿主仓（dsh-fly）的 `presets/fly/agent.cordis.yml` 里是 `name: dsh-plugin-fly-smart`；
  宿主通过 `plugins.lock.json` 解析本仓（工作区 `$FLY_PLUGINS_DIR`，缺省 `../dsh-plugins`）。
- 本仓要**自己 install 一次**（测试 import 入口，而入口 import 引擎 peer）：`pnpm install`
  （`.npmrc` 已把 `@deepseek-ai` 与默认 registry 都钉到公开 npm —— 本机默认是内网镜像）。
- **本仓门禁**：`node scripts/verify-smart.mjs` —— 跑 `node --test tests/*.spec.mjs` 加五条源码形状：
  `files` 覆盖入口与内部模块、**不带 `dsh.bundle`**、交付字节里无内网 provider/模型 id、
  `repository.url` 与本仓逐字一致、必需文件在位。**引擎无关**，任何机器都能跑。
- **宿主侧集成验收**（起 scratch profile、`dsh plugin add`、preset 行、真跑阶段机 47 条）在
  **dsh-fly** 仓的 `scripts/verify-smart-integration.mjs` —— 那验的是"宿主怎么接这个包"，属宿主仓。

## 发布（tag → OIDC + provenance）

升 `version` → 提交 → 打**注释 tag** → 推 tag ⇒ `.github/workflows/release.yml` 自动
`npm publish --access public --provenance`（不需要 token、不需要 2FA）。前提是 npm 上这个包的
Settings → Trusted Publisher 配好（GitHub Actions / `ethanchen669` / `dsh-plugin-fly-smart` /
workflow filename `release.yml` / ☑ **Allow npm publish**）。

- **0.1.0 是历史遗留**：那时包还在 dsh-fly 的 `packages/` 里、用 `npm stage publish` 发的（无 provenance，
  且 `repository` 指向 dsh-fly）。**0.1.1 起**从本仓走 tag 发布。
- 重推同一个 tag **不会**重跑 workflow ⇒ 要重跑就换一个新 tag。
- 验收三件（**换缓存键**再读）：`dist-tags.latest == 新版本`、`dist.attestations` 存在、README 是本版快照。
