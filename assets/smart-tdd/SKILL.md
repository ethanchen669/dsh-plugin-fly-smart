---
name: smart-tdd
description: Use when 实现任何功能或修复 bug、在写实现代码之前加载：先写失败的测试，看着它失败，再写最小实现让它通过。
---

<!-- Ported from obra/superpowers skills/test-driven-development/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# 测试驱动开发（TDD）

## 概述

先写测试。看着它失败。写最小实现让它通过。

**核心原则：如果你没看到测试失败，你就不知道它测的是对的东西。**
（If you didn't watch the test fail, you don't know if it tests the right thing.）

**Violating the letter of these rules is violating the spirit.**

DSH 工具对应：用 `bash` 跑测试命令，用 `read` / `grep` 看代码与测试输出，用 `write` / `edit` 写测试与实现。

## 什么时候用

**Always：** 新功能、修 bug、重构、行为变化。

**例外（先问用户）：**
- 一次性原型（throwaway prototypes）
- 生成的代码（generated code）
- 配置文件（configuration files）

心想「就这一次跳过 TDD」？停。That's rationalization.

## 铁律（The Iron Law）

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

先写了实现、后补测试？**删掉重来。**

**没有例外：**
- 不许留着当「参考」（"reference"）
- 不许写测试时顺手「改造」它（adapt）
- 不许看它
- 删了就是删了（Delete means delete）

从测试全新实现。Period.

## RED-GREEN-REFACTOR 循环

```
RED（写一个失败的测试）
  └→ 验证 RED：必须失败，且因「功能缺失」而失败
       ├─ 失败原因不对 → 回 RED
GREEN（最小实现）
  └→ 验证 GREEN：这条过 + 全套测试绿
       ├─ 没过 → 回 GREEN（改代码，不是改测试）
REFACTOR（清理，保持全绿 → 回验证 GREEN）
  └→ 下一个 RED
```

### RED — 写一个失败的测试

写一个最小测试，说明应该发生什么。

<Good>
```typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };
  const result = await retryOperation(operation);
  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```
名字清楚、测真实行为、只测一件事
</Good>

<Bad>
```typescript
test('retry works', async () => {
  const mock = jest.fn().mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new Error()).mockResolvedValueOnce('success');
  await retryOperation(mock);
  expect(mock).toHaveBeenCalledTimes(3);
});
```
名字含糊、测的是 mock 不是代码
</Bad>

**要求：** 一个行为；名字说清行为；真代码（非万不得已不用 mock）。

### 验证 RED — 看着它失败

**MANDATORY. Never skip.** 用 `bash` 跑测试命令，例如 `npm test path/to/test.test.ts`。

确认：
- 测试**失败**（不是报错 error）
- 失败信息符合预期
- 因为**功能缺失**而失败（不是拼写错误之类的低级原因）

**测试直接过了？** 你测的是既有行为。修测试。

**测试报错？** 先修错误，重跑直到它「正确地失败」。

### GREEN — 最小实现

写能通过测试的最简单代码。

<Good>
```typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) { if (i === 2) throw e; }
  }
  throw new Error('unreachable');
}
```
刚好够通过
</Good>

<Bad>
```typescript
async function retryOperation<T>(fn: () => Promise<T>, options?: {
  maxRetries?: number; backoff?: 'linear' | 'exponential';
  onRetry?: (attempt: number) => void;
}): Promise<T> {
  // YAGNI
}
```
过度设计
</Bad>

别加功能、别顺手重构别的代码、别超出测试去「改进」。

### 验证 GREEN — 看着它通过

**MANDATORY.** 再跑一次测试命令（同验证 RED）。

确认：
- 测试通过
- 其它测试也还过
- 输出干净（无 error、无 warning）

**测试失败？** 改代码，不是改测试。

**别的测试红了？** 立刻修。

**「其它测试」指整个项目的测试套件，不只是你那个文件。** 你写的那一条绿不等于全套绿。交付前要跑项目的测试命令（裸 `pytest`、`npm test`、`cargo test`——仓库用什么跑什么），哪怕你的任务只提到一个测试文件。任务里的范围声明限定的是交付物，不是你的验证。那一次跑出来的任何失败——包括不是你造成的——都要点名写进报告；一条你看着滚过去却没提的红测试，就是被省略证词伪造的报告。

### REFACTOR — 清理并重复

只在全绿之后：去重复、改好名字、抽 helper。保持测试全绿，不加行为。然后为下一个功能写下一条失败的测试（回到 RED）。

## 好测试长什么样

| 质量 | 好 | 坏 |
|------|-----|-----|
| **最小** | 一件事。名字里有「和」？拆开。 | `test('validates email and domain and whitespace')` |
| **清楚** | 名字描述行为 | `test('test1')` |
| **表达意图** | 展示想要的 API | 把代码该做什么藏起来 |

写或改任何测试、加 mock、加测试用的清理/helper 方法时，遵守下面让测试保持诚实的规则（并入自 writing-good-tests.md）。一个测试存在的意义是抓住某一种特定的破坏，两条原则管住一切：

```
1. Every test names the break it catches
2. Every test exercises the real thing
```

严格的 TDD 自然产出这两条：先写、并看着它对真代码失败的测试，已经证明了它会失败；只有当真依赖确实慢或外部时，它才挣得一个 mock。

### 原则一：说清它抓哪种破坏

写测试体之前先回答：**什么样的生产代码改动会让这条测试失败——那是 bug 还是一个有意的决定？** 一条测试靠抓住写错的分支、丢掉的副作用、传错的参数、边界情况或被破坏的契约来挣得位置。

- **期望值独立推导。** 用字面量和手工核对的 fixture；表驱动 + 字面 `want` 值是首选形状。用被测代码（或它的 helper）算出来的期望值，无论那段代码做什么都会通过：

```typescript
// ❌ 镜像断言：同一个 builder 算两边 —— 恒真
const expected = buildSearchQuery({ tag: 'urgent' });
expect(buildSearchQuery({ tag: 'urgent' })).toBe(expected);
// ✅ 手推字面量
expect(buildSearchQuery({ tag: 'urgent' })).toBe('tag:"urgent"');
```

- **不要变更探测器（change detector）。** 如果只有有意的决定才能让测试失败（常量的值、报错文案、私有结构），它会在重新设计时乱叫、在真 bug 面前睡觉。测依赖该决定的行为：不是 `expect(MAX_RETRIES).toBe(5)`，而是「失败的调用被重试 5 次，第 6 次不再发生」。
- **行为，不是文本。** 断言脚本、技能或配置里含有某一精确行，只证明「源码就是源码」。拿受控输入去跑脚本，断言输出、副作用或退出码。指导智能体的文档由消费它的智能体的行为来测试；给人看的文字不配拥有测试。
- **你的代码，不是框架。** 测你的代码在边界上立下的契约——你注册的路由、你发出的查询、你产出的 payload。上游机制是上游维护者该写的测试（经典反例：断言你的路由器调用了注册的 handler——那是框架的测试，不是你的）。构造器、getter、常量、平凡转发，只有在做校验、归一、默认、派生、强制或产生副作用时才配拥有测试。

**Gate Function（写测试体之前）：**

```
说出哪一处生产代码改动会让这条测试失败。
  说不出来 → 围绕可观察的行为重新设计；「源码文本变了」→ 跑产物、断言它的效果
  只有有意的决定会失败 → 变更探测器，改测依赖该决定的行为
  期望值若借助被测代码的逻辑/helper 推导 → 换成字面量或手工核对的 fixture
```

### 原则二：动真格的（Exercise the Real Thing）

- **mock 不配拥有断言。** mock 在场就通过、移除就失败的断言，对组件一无所言。断言真组件的行为；要查的就是 mock 本身，就拆掉 mock 或删掉断言。人类伙伴常问的一句：「我们在测一个 mock 的行为吗？」
- **在正确的层次 mock。** 替换真方法之前先弄清它的每一个副作用；只 mock 慢或外部的那层，测试依赖的部分保持真实。拿不准时先对真实现跑一遍测试，观察到底需要发生什么（反例：mock 掉 `ToolCatalog.discoverAndCacheTools` 会吞掉去重检测要读的那次配置写入）。
- **假件要具体。** 参数、调用次数、顺序是契约的一部分就断言它们；什么都接受的假件什么都没验证。每个分支（成功、出错、畸形）给各自的 fixture 或 spy，让错误的分支满足不了期望。
- **完整复刻真实数据。** mock 要复刻现实中的完整结构——所有文档化字段——不只是你测试读到的那几个。残缺的 mock 在下游读到漏掉的字段时静默失败：测试通过，集成坏了。
- **生产类只带生产方法。** 只有测试需要的清理代码放测试工具里，绝不给生产类加 `destroy()`。问自己：这个方法只有测试调用吗？这个类拥有这个资源的生命周期吗？答错了 → 测试工具。
- **真组件优于复杂 mock。** mock 搭建超过测试逻辑本身、mock 漏掉真组件有的方法、mock 一变测试就碎时，换成带真组件的集成测试。人类伙伴常问的一句：「这里我们需要用 mock 吗？」

**Gate Function（加 mock 或测试 helper 之前）：**

```
列出真方法的副作用；测试依赖的保持真实，只 mock 它下面的慢/外部层。
mock 响应复刻完整的真实结构；只有测试调用的方法放测试工具，不进生产代码。
正要对 mock 本身下断言？→ 拆掉 mock，或删掉这条断言。
```

### 测试与实现一起交付

TDD 循环——失败的测试、最小实现、重构——就是「完成」的定义。只交付这条行为需要的测试：琐碎代码和给人看的文字不配拥有测试，而为流程而写的测试要被维护一辈子。

### 变异检查（The Mutation Check）

收尾前在脑子里变异生产代码：每一种现实的变异都至少要有一条测试变红——常量或参数写错、分支处理器写错、缺少状态变更或副作用、返回空值或默认值、缺少对零值/空/nil/未授权/畸形输入的校验。

没有任何变异被抓到，说明这段行为没被保护——或者那条测试是同义反复。

## 常见借口（Common Rationalizations）

| 借口 | 现实 |
|------|------|
| 「太简单不用测」 | 简单代码也会坏。测试只要 30 秒。 |
| 「我之后再补测试」 | 事后补的测试一写就过——这什么也证明不了。它们可能测错了东西、测实现而不是行为，或者漏掉你忘掉的边界用例。你从没看它失败，就从没证明过它抓得住 bug。先写测试强制这个失败。 |
| 「事后测试目标一样（重精神不重仪式）」 | 事后测试回答「这段代码做了什么？」；先写测试回答「这段代码该做什么？」事后写的测试被你已写的代码带偏——你验证的是想起来的用例，不是本会发现的用例。有覆盖率，没有「测试能工作」的证明。 |
| 「已经手动测过了」 | 手动测试是即兴的：没有覆盖记录，代码一变没法重跑，压力下容易忘用例。「我试的时候是好的」不等于全面。自动化测试每次跑得一模一样。 |
| 「删掉 X 小时的代码太浪费」 | 沉没成本谬误——那些时间无论如何已经花掉了。真正的选择是：用 TDD 重写（高信心）vs 留着再补测试（低信心、大概率带 bug）。留着一段不敢信的代码才是浪费。 |
| 「留着当参考，测试先写」 | 你会顺手改它。那就是事后测试。删了就是删了。 |
| 「我得先探索一下」 | 可以。把探索产物扔掉，从 TDD 开始。 |
| 「测试难写 = 设计不清」 | 听测试的。难测 = 难用。 |
| 「TDD 会拖慢我」 | TDD 就是务实之路：提交前抓 bug、防回归、让你敢重构。「务实」的捷径意味着在生产环境里调试——更慢，不是更快。 |
| 「手动测更快」 | 手动证明不了边界用例。每次改动你都得重测一遍。 |
| 「既有代码没有测试」 | 你正在改进它。给既有代码补测试。 |

## 红旗（Red Flags）——停下，推倒重来

- 先写代码后写测试
- 实现写完才写测试
- 测试一写就过
- 说不清测试为什么失败
- 测试「以后再补」
- 说服自己「就这一次」
- 「我已经手动测过了」
- 「事后测试目的一样」
- 「重精神不重仪式」
- 「留着当参考」或「改造既有代码」
- 「已经花了 X 小时，删了浪费」
- 「TDD 太教条，我这是务实」
- 「这次情况不一样，因为……」

**以上任何一条都意味着：删掉代码，用 TDD 重新开始。**

## 示例：修一个 bug

**Bug：** 空邮箱被接受。

**RED**
```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```
**验证 RED**（用 `bash` 跑 `npm test`）：
```bash
FAIL: expected 'Email required', got undefined
```

**GREEN**
```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) return { error: 'Email required' };
  // ...
}
```
**验证 GREEN**（同一条命令）：
```bash
PASS
```

**REFACTOR**：需要的话把校验抽出来支持多个字段。

## 完成前检查清单

- [ ] 每个新函数/方法都有测试
- [ ] 每条测试都在实现之前看着它失败
- [ ] 每条测试都因预期的原因失败（功能缺失，不是拼写错误）
- [ ] 为每条测试写了最小实现
- [ ] 全部测试通过
- [ ] 输出干净（无 error、无 warning）
- [ ] 测试用真代码（mock 仅限非万不得已）
- [ ] 边界情况和错误路径已覆盖

勾不满？你跳过了 TDD。重新开始。

## 卡住时

| 问题 | 解法 |
|------|------|
| 不知道怎么测 | 写出想要的 API。先写断言。问用户。 |
| 测试太复杂 | 设计太复杂。简化接口。 |
| 必须 mock 一切 | 代码耦合太紧。用依赖注入。 |
| 测试准备代码巨大 | 抽 helper。还是复杂？简化设计。 |

## 调试

发现 bug？先写一个复现它的失败测试，走完 TDD 循环。这个测试既证明修复有效，也防止回归。

**Never fix bugs without a test.**

## 最终规则

```
Production code → test exists and failed first
Otherwise → not TDD
```

没有用户的许可，就没有例外。

## 进阶

需要把 TDD 落成多步计划时，用 `smart-plan` 技能写 `docs/plans/` 下的计划；单点修复直接改，写完用 `smart-verify-claim` 对账。
