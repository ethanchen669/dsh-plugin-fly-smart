---
name: smart-finish
description: Use when 实现完成、测试全绿、需要决定这堆工作怎么落地时加载——合回主干、推送开 PR、还是先留着；先验证再给选项，执行后按来源清理 worktree，丢弃只在用户明确要求时。
---

# 收尾一个开发分支（Finishing a Branch）

## 概述

**核心原则：Verify → Detect → Ask → Execute → Clean up.**
（先验证，再探测，再问，再执行，最后清理。）

**Order matters**：测试没绿就给菜单，等于让用户在一个坏掉的分支上做集成决定。

## 步骤

### 1. 先验证

跑完整的测试命令（项目自己的：`node --test` / `pytest` / `cargo test` / `go test ./...`）。

**失败就停**，把失败贴出来 —— 菜单在绿之后才有：

```
测试失败（N 个）。先修好再谈集成：
<失败原文>
```

### 2. 探测环境

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
WORKTREE_PATH=$(git rev-parse --show-toplevel)   # 现在就取，第 5 步会先切目录
```

| 状态 | 菜单 | 清理 |
| --- | --- | --- |
| `GIT_DIR == GIT_COMMON`（普通 checkout） | 三选项 | 没有 worktree 要清 |
| `GIT_DIR != GIT_COMMON`，有名字的分支 | 三选项 | 按**来源**清（见 5） |
| `GIT_DIR != GIT_COMMON`，detached HEAD | 两选项（无"本地合并"） | 外部托管，**留着别动** |

### 3. 确认基线分支

基线 = 这条分支从哪切出来的（计划里、对话里、或 `git rev-parse --abbrev-ref @{u}`）。
不确定就问一句："这条分支是从 `<你的猜测>` 切出来的，对吗？"
**合到错的分支代价很高**，动手前确认。

### 4. 给选项（逐字给出，别自己加第四条）

普通 checkout / 有名字的 worktree：

```
实现完成了。你想怎么处理？

1. 本地合回 <base-branch>
2. 推送并开 PR
3. 分支先留着（我稍后自己处理）

选哪个？
```

detached HEAD：

```
实现完成了。当前是 detached HEAD（外部托管的工作区）。

1. 作为新分支推送并开 PR
2. 先留着（我稍后自己处理）

选哪个？
```

**等用户回答。集成决定是他的。** 丢弃工作只在他**明确要求**时才做。

### 5. 执行

**选项 1：本地合并**

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
git checkout <base-branch>
git pull
git merge <feature-branch>
<测试命令>          # 在合并结果上再跑一次
```

合并后测试失败 ⇒ **停**，worktree 与分支都留着排查 —— 什么都没推，退得回来。

合并结果绿了之后：先清 worktree（看下面的来源判定），再删分支 `git branch -d <feature>`。

**选项 2：推送并开 PR**

```bash
git push -u origin <feature-branch>
# detached HEAD：git push origin HEAD:refs/heads/<new-branch>
```

按仓库规矩开 PR（有 `gh` 用 `gh pr create`；没有就把标题与描述交给用户）。
**不自己点合并** —— 合并是工作区外的副作用，属于四种要停的情况之一。

**选项 3：保留**

什么都不动，告诉用户分支名与工作区路径，让他随时回来。

### 6. 清理（按来源）

- **我们建的 worktree**（来源可证：`.worktrees/` 下、或本次会话里 `git worktree add` 建的）⇒ 合并成功后 `git worktree remove <path>`。
- **外部托管的 worktree / detached HEAD** ⇒ **不动**。
- 计划执行留下的 `.dsh-fly/exec/<plan>/` scratch ⇒ 终审干净后删（git 历史已是记录）。

## Red Flags —— 停下

- 测试没跑或没绿就给选项
- 不问就合并 / 推送 / 删分支
- 把"丢弃"写进菜单（只有用户明确要求才做）
- 删了不是自己建的 worktree
- 合并后没在合并结果上重跑测试
- 自己点了合并（那是用户的决定）

## Rationalization Prevention

| 借口 | 现实 |
| --- | --- |
| "测试刚才还是绿的" | 刚才不是现在。跑一次，读输出 |
| "用户肯定想合并" | 集成决定是用户的。给选项、等回答 |
| "顺手把分支删了，干净" | 删分支要在合并成功且验证之后，按用户选的选项做 |
| "这个 worktree 反正没人用" | 不是你建的就别删。外部托管的一律留着 |
| "PR 建了就顺手合了" | 合并是工作区外的副作用 —— 停，让用户点 |
| "detached HEAD 也能合并" | 没有分支名就没有安全的合并对象。只给两个选项 |

## 与其它技能的关系

- **上游**：`smart-execute`（终审干净后交过来）、`smart-verify-claim`（完成声明的证据）。
- **下游**：合并/PR 之后的事（发布、打 tag）不属于本技能 —— 那是用户的决定。
