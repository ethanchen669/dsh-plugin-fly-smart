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

两条原则：**每条测试说出它抓哪种破坏**；**每条测试动真格的东西**（mock 不配拥有断言）。
完整的展开（变更探测器、期望值独立推导、mock 的正确层次、变异检查）见
`references/writing-good-tests.md` —— 写或改测试之前读它。

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

完整走一遍（读代码 → 写失败测试 → 看它红 → 最小修复 → 看它绿）见
`references/example-bugfix.md`。

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

先怀疑测试（它真的失败过吗？它抓的是哪种破坏？），再怀疑实现，最后才怀疑框架。
顺序与判断见 `references/stuck-and-debug.md`。

## 最终规则

```
Production code → test exists and failed first
Otherwise → not TDD
```

没有用户的许可，就没有例外。

## 进阶

需要把 TDD 落成多步计划时，用 `smart-plan` 技能写 `docs/plans/` 下的计划；单点修复直接改，写完用 `smart-verify-claim` 对账。
