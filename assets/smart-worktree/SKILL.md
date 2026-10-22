---
name: smart-worktree
description: Use when 开始需要与当前工作区隔离的特性工作、或在执行实现计划之前加载：确保在隔离工作区里干活，绝不在 main/master 上开工。先探测是否已在隔离区，优先用 DSH 原生工作区，没有才落 git worktree。
---

<!-- Ported from obra/superpowers skills/using-git-worktrees/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# 建立隔离工作区（git worktree / DSH 工作区）

## 概述

确保工作发生在隔离工作区里，而不是当前 checkout、更不是主干上。

**优先级（原句保留）：** *Prefer your platform's native worktree tools. Fall back to manual git worktrees only when no native tool is available.*
**另一句同样保留：** *Never fight the harness.*

**Core principle（原句保留）：** *Detect existing isolation first. Then use native tools. Then fall back to git. Never fight the harness.*

**开工先宣告：** "我正在使用 smart-worktree 技能建立隔离工作区。"

**铁律：绝不在 `main` / `master` 上开工。** 只有人类明确同意（原话点头），才允许直接在主干上改；否则一律先落隔离区（新分支 / worktree / DSH 工作区）。

## Step 0: Detect Existing Isolation（先查有没有现成的隔离）

**在创建任何东西之前，先确认你是不是已经身处隔离工作区。**

判据命令（用 `bash` 执行，命令与表达式保持原样、可直接复制）：

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**Submodule guard（必须先排子模块）：** 原文明确 *"`GIT_DIR != GIT_COMMON` 在子模块里也为真"*（*"`GIT_DIR != GIT_COMMON` is also true inside git submodules"*）。所以在断言"已经在 worktree 里"之前，先排除子模块：

```bash
# If this returns a path, you're in a submodule, not a worktree — treat as normal repo
git rev-parse --show-superproject-working-tree 2>/dev/null
```

返回非空路径 ⇒ 你在子模块里、**不是** worktree ⇒ 按普通仓库处理。

**若 `GIT_DIR != GIT_COMMON`（且不在子模块里）：** 你已经在 linked worktree 里。直接跳到 Step 2（项目装配），**不要再建第二个 worktree**。

按分支状态如实报告：
- 在分支上："Already in isolated workspace at `<path>` on branch `<name>`."
- Detached HEAD："Already in isolated workspace at `<path>` (**detached HEAD, externally managed**). **Branch creation needed at finish time.**"
  —— 外部托管的 detached HEAD 不要自作主张建分支；收尾（finish）时才建分支落盘。

**若 `GIT_DIR == GIT_COMMON`（或在子模块里）：** 你在普通仓库 checkout 里。

用户/上级指令里有没有已经声明的隔离偏好？没有的话，创建 worktree 前先征得同意：

> "要不要我建一个隔离工作区？它能保护你当前分支不被改动。"

已有明确偏好的直接照办、不再问。用户拒绝 ⇒ 就地干活，跳到 Step 2。

## Step 1: Create Isolated Workspace（两条机制，按顺序试）

### 1a. 原生工具（优先）：DSH 工作区 → 平台原生 worktree 工具

1. **DSH 自带隔离能力：会话工作区（workspace）。** 先用它 —— 本技能运行在 DSH 里，session 的 workspace 就是现成的隔离区（独立目录、与当前 checkout 分离）。能在工作区里开分支/开目录干活的，就落在工作区里，跳到 Step 2。
2. 再看有没有别的原生 worktree 工具（名字可能叫 `EnterWorktree`、`WorktreeCreate`、`/worktree` 命令或 `--worktree` 开关）。有就用它，跳到 Step 2。

原生工具会自动处理目录摆放、分支创建和清理。**手里有原生工具却用 `git worktree add`，会制造 harness 看不见、也管不了的幻影状态（phantom state）—— 这是头号错误。**

只有在**没有任何原生工具**时才进 1b。

### 1b. Git Worktree 兜底（仅当 1a 不适用）

#### 目录选择（优先级从高到低；显式指令永远压过观察到的文件系统状态）

1. **先看指令里有没有声明好的 worktree 目录偏好**（用 `read` 查计划/约束文件）：有就直接用、不再问。
2. **再查项目里有没有现成的 worktree 目录**（用 `glob` 或 `bash`）：
   ```bash
   ls -d .worktrees 2>/dev/null     # Preferred (hidden)
   ls -d worktrees 2>/dev/null      # Alternative
   ```
   找到就用；两个都在 ⇒ `.worktrees` 赢。
3. **没有任何别的指引** ⇒ 默认用项目根下的 `.worktrees/`。

#### 安全校验（仅项目内目录需要）

**创建前必须确认目录已被忽略：**

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**没被忽略：** 写进 `.gitignore`（`write` / `edit`），提交这次改动，再继续。

**为什么关键：** 没忽略的 worktree 目录会把整棵 worktree 内容提交进仓库。

#### 创建 worktree

```bash
# Determine path based on chosen location
path="$LOCATION/$BRANCH_NAME"

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**Sandbox fallback：** `git worktree add` 若因权限被拒（沙箱拦截），告诉用户"沙箱挡住了 worktree 创建、改为就地干活"，然后在当前目录跑装配与基线测试。别跟 harness 较劲（*Never fight the harness.*）。

**分支名约束：** `$BRANCH_NAME` 从特性名派生，**不得**是 `main` / `master`；需要在主干上开工只有人类点头一条路。

## Step 2: Project Setup（项目装配）

自动探测并跑对应装配（用 `bash`）：

```bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

没有对应清单文件就跳过依赖安装。

## Step 3: Verify Clean Baseline（干净基线）

跑测试，确认工作区起点是干净的：

```bash
# Use project-appropriate command
npm test / cargo test / pytest / go test ./...
```

**测试挂了：** 如实报告失败项，问用户"继续还是先排查"—— 越过失败往下走是人类的决定。
**测试过了：** 报告就绪。

### 报告格式

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| 情况 | 动作 |
|------|------|
| 已在 linked worktree | 不再创建（Step 0） |
| 在子模块里 | 按普通仓库处理（Step 0 submodule guard） |
| 有 DSH 会话工作区 | 用它（Step 1a 第一优先） |
| 有原生 worktree 工具 | 用它（Step 1a） |
| 原生工具都没有 | git worktree 兜底（Step 1b） |
| `.worktrees/` 已存在 | 用它（先验 ignored） |
| `worktrees/` 已存在 | 用它（先验 ignored） |
| 两个都存在 | 用 `.worktrees/` |
| 都不存在 | 查指令偏好，否则默认 `.worktrees/` |
| 目录没被忽略 | 写 `.gitignore` + 提交 |
| detached HEAD | externally managed，收尾时才建分支 |
| 创建被沙箱拦 | Sandbox fallback，就地干活 |
| 基线测试挂 | 报告失败 + 问用户 |
| 没有 package.json/Cargo.toml | 跳过依赖安装 |

## Common Rationalizations（常见自我开脱）

| 借口 | 现实 |
|------|------|
| "我显然不在 worktree 里 —— 不用查了" | 跑 Step 0。harness 造的隔离和子模块都能骗过肉眼；判据命令才能定案。 |
| "`git worktree add` 比找原生工具快" | 原生工具（如 DSH 工作区、`EnterWorktree`）拥有摆放、分支、清理的所有权。绕过它是头号错误 —— 会制造 harness 看不见、管不了的幻影状态。 |
| "worktree 目录肯定已经被忽略了" | 跑 `git check-ignore`。没忽略的 worktree 目录会把整棵树提交进仓库。 |
| "随便哪个目录名都行" | 显式指令 > 已有的项目内目录 > `.worktrees/` 默认。 |
| "工作区是新的 —— 基线测试可以等等" | 脏基线会让后面每个失败都变得说不清。现在就跑；要不要越过失败是人类的决定。 |
| "主干上开两分钟没事儿" | 绝不在 `main`/`master` 上开工，除非人类明确同意。隔离区不是仪式，是回滚点的载体。 |

## 与 smart 工作流的关系

smart 的 `plan.md` 要求写回滚点，但没要求写『在哪条分支/哪个 worktree 干』。本技能补上这一格：开工前先定隔离区，把它写进计划的 Global Constraints。
