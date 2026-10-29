# 三个配套技术（详细）

摘自 `smart-debug`：根因追溯、纵深防御、条件等待，以及二分找污染测试的脚本。

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
