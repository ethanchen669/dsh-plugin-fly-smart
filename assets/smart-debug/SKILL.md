---
name: smart-debug
description: Use when 遇到任何 bug、测试失败、行为异常、性能问题、构建失败、集成问题，在提出任何修复之前加载：先做根因调查，症状修复不算修复。
---

<!-- Ported from obra/superpowers skills/systematic-debugging/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# 系统化调试（Systematic Debugging）

## 总览

**核心原则：ALWAYS find root cause before attempting fixes. Symptom fixes are failure.**
（永远先找到根因再修。症状修复就是失败。）

**违反这个流程的字面，就是违反调试的精神（Violating the letter of this process is violating the spirit of debugging）。**

## 铁律（The Iron Law）

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

没有完成阶段 1，就不许提出修复。

## 何时使用

用于**任何**技术问题：

- 测试失败
- 生产环境 bug
- 行为异常
- 性能问题
- 构建失败
- 集成问题

**尤其要用在：**

- 时间压力下（紧急情况让瞎猜变得诱人）
- "先来个快速修复"看起来很明显时
- 你已经试过多个修复
- 上一个修复没有起作用
- 你并没有完全弄懂这个问题

**不许因为这些跳过：**

- 问题看起来很简单（简单 bug 也有根因）
- 你在赶时间（仓促保证返工）
- 上级要它"现在就修好"（系统化比瞎折腾快）

## 四个阶段（The Four Phases）

必须完成当前阶段，才能进入下一阶段。

### 阶段 1：根因调查（Root Cause Investigation）

**在动手修任何东西之前：**

1. **认真读错误信息（Read Error Messages Carefully）**
   - 不要跳过报错与警告，它们常常含有精确的答案
   - 完整读调用栈（用 `read` 读完整日志，别只看最后一行）
   - 记下行号、文件路径、错误码

2. **稳定复现（Reproduce Consistently）**
   - 能可靠触发吗？精确步骤是什么？每次都发生吗？
   - 如果不能复现 → 继续收集数据，不要猜；复现跑在后台（`bash` 长任务）时用 `job_list` / `job_output` 把结果收回来再分析

3. **检查最近的改动（Check Recent Changes）**
   - 什么改动可能导致这个？（`bash` 跑 `git diff` / `git log`）
   - 新依赖、配置改动、环境差异（用 `grep` / `glob` 找到改动落点）

4. **多组件系统里收集证据（Gather Evidence in Multi-Component Systems）**

   **当系统有多个组件时（CI → 构建 → 签名，API → 服务 → 数据库）：**

   **在提出修复之前，先加诊断埋点：**
   ```
   对每一个组件边界：
     - 记录进入组件的数据
     - 记录离开组件的数据
     - 验证环境 / 配置是否传播到位
     - 检查每一层的状态

   跑一次，收集证据，指出「在哪一层断了」
   然后分析证据，锁定失败的组件
   然后只调查那个组件
   ```

   **示例（多层系统）：**
   ```bash
   # 第 1 层：Workflow —— Secrets 可用吗？
   echo "IDENTITY: $([ -n "${IDENTITY:-}" ] && echo SET || echo UNSET)"
   # 第 2 层：构建脚本 —— 环境变量传到了吗？
   printenv IDENTITY >/dev/null 2>&1 && echo "IDENTITY in environment" || echo "IDENTITY not in environment"
   # 第 3 层：签名脚本 —— Keychain 状态
   security list-keychains; security find-identity -v
   # 第 4 层：真正签名
   codesign --sign "$IDENTITY" --verbose=4 "$APP"
   ```

   **这会揭示：**到底哪一层坏了（secrets → workflow ✓，workflow → build ✗）

5. **追溯数据流（Trace Data Flow）**

   **当错误出现在调用栈深处时：**完整技术见下方「延伸 · 根因追溯」。速查版（就是连续追问 why 的 5-Why）：坏值从哪里产生？谁带着坏值调用了这里？一路往上追，直到找到源头——**在源头修，不在症状处修（Fix at source, not at symptom）**。

### 阶段 2：模式分析（Pattern Analysis）

**修之前先找到模式：**

1. **找能工作的例子（Find Working Examples）**
   - 在同一个代码库里找相似的、能工作的代码（`grep` / `glob`）
   - 什么东西和坏掉的东西相似、却好使？

2. **对照参考实现（Compare Against References）**
   - 如果在实现某个模式，**完整读**参考实现（用 `read` 从头读到尾）
   - 不要一目十行——逐行读完再动手

3. **找出差异（Identify Differences）**
   - 能工作的和坏掉的之间有什么不同？
   - 列出**每一个**差异，无论多小
   - 不要假设"这个不可能有影响"

4. **理解依赖（Understand Dependencies）**
   - 它还需要哪些组件？哪些设置、配置、环境？
   - 它做了什么假设？

### 阶段 3：假设与验证（Hypothesis and Testing）

**科学方法：**

1. **形成单一假设（Form Single Hypothesis）**
   - 清楚地说出来："我认为 X 是根因，因为 Y"
   - 写下来，要具体，不要含糊

2. **最小化测试（Test Minimally）**
   - 为验证假设做**最小**的改动
   - 一次只动一个变量，不要同时修多个东西

3. **验证后再继续（Verify Before Continuing）**
   - 有效？→ 阶段 4
   - 无效？→ 形成**新的**假设
   - **不要在上面继续叠加修复**

4. **不知道就说不知道（When You Don't Know）**
   - 说"我没弄懂 X"，不要装懂
   - 求助、继续查资料

### 阶段 4：实施（Implementation）

**修根因，不修症状：**

1. **先造失败的测试用例（Create Failing Test Case）**
   - 最简单的复现；能自动化就自动化（`write` 写一次性测试脚本也算）；没有框架就写一次性脚本
   - **修之前必须先有它**

2. **实施单一修复（Implement Single Fix）**
   - 只处理已确认的根因，一次一个改动（用 `edit` 做最小修改）
   - 不要"顺手也改改"，不要夹带重构

3. **验证修复（Verify Fix）**
   - 测试现在过了吗？别的测试没坏吗？问题真的解决了吗？
   - 交付前先验证再宣称成功：把证据（命令 + 实际输出）摆出来

4. **修复无效时（If Fix Doesn't Work）**
   - **停（STOP）**
   - 数一数：你已经试了几个修复？
   - **< 3 个**：回阶段 1，带着新信息重新分析
   - **≥ 3 个**：**停，质疑架构**（见下面第 5 条）
   - 不许在没有架构讨论的情况下尝试第 4 个修复

5. **3 次以上修复失败：质疑架构（Question Architecture）**

   **预示架构问题的模式：**
   - 每次修复都在不同地方暴露新的共享状态 / 耦合 / 问题
   - 修复需要"大规模重构"才能实现
   - 每次修复都在别处制造新症状

   **停下来质疑根本：**这个模式本身站得住脚吗？我们是不是"纯靠惯性在坚持它"？该重构架构，还是继续修症状？

   **动手再修之前，先和你的人类搭档讨论。** 这不是假设失败——这是**架构错了**。

## 红旗：停，回到流程（Red Flags - STOP and Follow Process）

如果你抓住自己正在想：

- "先快速修一下，以后再查"
- "改个 X 试试看行不行"
- "多改几处，跑一遍测试"
- "跳过测试吧，我手动验证"
- "多半是 X，我把它修了"
- "我不完全懂，但这样大概能行"
- "模式说的是 X，但我按自己的方式改改"
- "主要问题有这些：[没调查就列出一堆修复]"
- 还没追溯数据流就提出解决方案
- **"再修一次试试"（已经试了 2 次以上）**
- **每次修复都在不同地方暴露新问题**

**以上任何一条都意味着：停。回阶段 1。如果 3 次以上修复失败：质疑架构（见阶段 4 第 5 条）。**

## 你的人类搭档的信号：你做错了（Your Human Partner's Signals）

**注意这些纠偏话语：**

- "那不是没发生吗？"——你在没验证的情况下下了假设
- "它会给我们看出来……吗？"——你本该加证据收集
- "别猜了"——你在不懂的情况下提修复
- "往深里想"（Ultra-think this）——要质疑根本，不只是症状
- "我们卡住了？"（沮丧）——你的路子不对

**看到这些：停。回阶段 1。**

## 找借口对照表（Common Rationalizations）

| 借口 | 现实 |
|------|------|
| "问题很简单，不用走流程" | 简单问题也有根因。对简单 bug，流程反而快。 |
| "紧急，没时间走流程" | 系统化调试比"猜-试"式瞎折腾**更快**。 |
| "先试试这个，然后再调查" | 第一个修复定下基调。从一开始就做对。 |
| "等确认修复有效我再写测试" | 没测试的修复留不住。先写测试才能证明它。 |
| "一次修多处省时间" | 分不清哪个起了作用，还会制造新 bug。 |
| "参考太长，我照着模式改改" | 一知半解保证出 bug。完整读完。 |
| "我看出问题了，让我修" | 看到症状 ≠ 理解根因。 |
| "再修一次试试"（2 次失败之后） | 3 次以上失败 = 架构问题。质疑模式，别再修。 |

## 快速参考（Quick Reference）

| 阶段 | 关键活动 | 成功判据 |
|------|----------|----------|
| **1. 根因** | 读报错、复现、查改动、收集证据 | 弄懂 WHAT 与 WHY |
| **2. 模式** | 找能工作的例子、对照 | 列出差异 |
| **3. 假设** | 形成理论、最小化验证 | 假设被确认或换新假设 |
| **4. 实施** | 写测试、修复、验证 | bug 解决、测试通过 |

## 当流程揭示"没有根因"

如果系统化调查发现问题是纯环境性的、时序相关的或外部的：

1. 你已经走完了流程
2. 记录你调查了什么
3. 实现恰当的处理（重试、超时、错误提示）
4. 加监控 / 日志，为将来调查留证据

**但是：**95% 的"没有根因"其实是调查不完整。

## 延伸：三个配套技术（原参考资料摘要）

### 根因追溯（Root Cause Tracing）

Bug 常出现在调用栈深处（`git init` 在错误目录、文件建在错的地方、数据库开在错的路径）。**核心原则：沿调用链向后追，直到找到最初的触发点，在源头修。**

追溯五步：观察症状 → 找直接原因 → 问"谁调用了它？" → 继续往上追（坏值是什么？从哪来？）→ 找到原始触发点。
追不上时加埋点：在危险操作**之前**打印目录、`process.cwd()`、环境变量和 `new Error().stack`（测试里用 `console.error`，logger 可能被吞）。

真实案例：`.git` 被建到源码目录里 —— 5 层追溯发现 `context.tempDir` 在 `beforeEach` 之前被读到（初始值是空串，空串当 `cwd` 解析成 `process.cwd()`）。根因修法：把 `tempDir` 改成 getter，初始化前访问就抛错。**NEVER fix just the symptom.**

### 纵深防御（Defense-in-Depth）

在源头修完之后再做：**每一层数据经过的地方都校验，让 bug 在结构上不可能发生。** 单点校验："我们修好了这个 bug"；多层校验："我们让这个 bug 不可能发生"。

| 层 | 作用 | 例子 |
|----|------|------|
| 1. 入口校验 | 在 API 边界拒绝明显非法的输入 | 空目录 / 不存在 / 不是目录就抛 |
| 2. 业务逻辑校验 | 数据对这个操作得说得通 | `projectDir` 必填 |
| 3. 环境守卫 | 阻止特定上下文里的危险操作 | 测试环境拒绝在 tmpdir 外 `git init` |
| 4. 调试埋点 | 事后取证 | 危险操作前打调用栈 |

逐层测试：试着绕过第 1 层，确认第 2 层接得住。**别停在一个校验点。**

### 条件等待（Condition-Based Waiting）

flaky 测试常靠任意延时猜时间。**核心原则：等你真正关心的条件，不要猜"大概要多久"。**

```typescript
// ❌ 猜时间
await new Promise(r => setTimeout(r, 50));
// ✅ 等条件
await waitFor(() => getResult() !== undefined);
```

| 场景 | 模式 |
|------|------|
| 等事件 | `waitFor(() => events.find(e => e.type === 'DONE'))` |
| 等状态 | `waitFor(() => machine.state === 'ready')` |
| 等数量 | `waitFor(() => items.length >= 5)` |
| 等文件 | `waitFor(() => fs.existsSync(path))` |

通用轮询：每 10ms 查一次，必须带超时并抛出清晰错误，getter 在循环**内**取新鲜数据。使用任意超时的正当情形：先等触发条件，再基于**已知**节拍等待（并在注释里写清 WHY）。

### 找污染测试的二分脚本（find-polluter.sh）

不知道哪个测试制造了多余的文件 / 状态时，用二分脚本逐个跑测试：

```bash
#!/usr/bin/env bash
# 用法: bash find-polluter.sh <要检查的文件/目录> <测试文件 glob>   例: '.git' 'src/**/*.test.ts'
set -e
[ $# -ne 2 ] && { echo "Usage: $0 <file_to_check> <test_pattern>"; exit 1; }
POLLUTION_CHECK="$1"; TEST_PATTERN="${2#./}"
TEST_FILES=$(find . \( -path "./$TEST_PATTERN" -o -path "./${TEST_PATTERN//\*\*\//}" \) | sort -u)
TOTAL=$(printf '%s\n' "$TEST_FILES" | grep -c . || true)
echo "Found $TOTAL test files"
COUNT=0
for TEST_FILE in $TEST_FILES; do
  COUNT=$((COUNT + 1))
  [ -e "$POLLUTION_CHECK" ] && { echo "⚠️ pollution already exists, skipping $TEST_FILE"; continue; }
  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"
  npm test "$TEST_FILE" > /dev/null 2>&1 || true
  [ -e "$POLLUTION_CHECK" ] && { echo "🎯 FOUND POLLUTER: $TEST_FILE (created $POLLUTION_CHECK)"; ls -la "$POLLUTION_CHECK"; exit 1; }
done
echo "✅ No polluter found - all tests clean!"
```

### 压力测试：这套流程是为顶住压力设计的

原文用三个压力场景校验过这套纪律，遇到同类情形照流程走：**① 紧急生产事故**（每分钟在亏钱、有人喊"先修再说"——系统化仍比猜-试快）；**② 沉没成本 + 疲惫**（同一个失败试了 6 次 `sleep` 还在加码——那是第 4 个修复，停，质疑架构/时序假设）；**③ 权威与社交压力**（资深同事说"这模式我见多了，直接修"——照样先追根因，30 分钟的追溯比错误修复便宜）。

## 进阶：需要完整交付时

如果这个 bug 需要改代码并交付，用 `smart_begin({ shape: 'fix' })` 走 smart 工作流；只是排查定位则不必。
