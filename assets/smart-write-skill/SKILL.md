---
name: smart-write-skill
description: Use when 创建新技能、修改既有技能、或在部署前验证技能是否有效时加载：写技能就是把 TDD 用在流程文档上。
---

<!-- Ported from obra/superpowers skills/writing-skills/ — MIT License, Copyright (c) 2025 Jesse Vincent. Adapted for DSH. -->

# 写技能（smart-write-skill）

## 总览

**Writing skills IS Test-Driven Development applied to process documentation.**
（写技能就是把 TDD 用在流程文档上。）

你写测试用例（用 `subagent` 跑压力场景），看着它失败（基线行为），写技能（文档），看着测试通过（agent 遵守），再重构（堵漏洞）。

**核心原则：If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.**
（没看过 agent 在没有技能时怎么失败，就不知道这个技能教的是不是对的东西 —— 对应 TDD 的"没看到失败就不知道测的是对的"。）

**REQUIRED BACKGROUND:** 使用本技能前，你 MUST 先懂 TDD（本插件的 `smart-tdd` 技能）：RED-GREEN-REFACTOR 循环在那里定义，本技能只是把它适配到流程文档上。

## 技能是什么 / 不是什么

*Skills are: Reusable techniques, patterns, tools, reference guides*
技能是：可复用的技巧、模式、工具、参考指南。

*Skills are NOT: Narratives about how you solved a problem once*
技能不是：关于"你某一次怎么解决了一个问题"的叙事。

## TDD 映射表（灵魂，**原表 10 行一行不许少**）

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | 压力场景（用 `subagent` 跑） |
| **Production code** | SKILL.md |
| **Test fails (RED)** | 没有技能时 agent 违反规则（基线） |
| **Test passes (GREEN)** | 有技能时 agent 遵守 |
| **Refactor** | 堵漏洞且保持合规 |
| **Write test first** | 写技能前先跑基线 |
| **Watch it fail** | 记下它用过的原话借口 |
| **Minimal code** | 只针对那些违规写技能（不写通用论文） |
| **Watch it pass** | 验证 agent 现在遵守了 |
| **Refactor cycle** | 找到新的借口 → 堵 → 重新验证 |

整个技能创作流程都走 RED-GREEN-REFACTOR。

## 什么时候建技能

**建：** 技巧不是你直觉就会的 / 跨项目会再用 / 模式普适（非项目专属）/ 对别人也有用。

**不建：** 一次性解法 / 别处已经写烂的标准做法 / 项目专属约定（写进 AGENTS.md 这类指令文件）/ 机械约束（能用正则、校验强制的就自动化 —— 文档留给需要判断力的地方）。

**三种类型：** Technique（技巧：有步骤可跟，如条件等待、根因追踪）/ Pattern（模式：看待问题的思维方式）/ Reference（参考：API 文档、语法指南、工具文档）。

## 技能落盘位置（DSH）

两处，别放错：

1. **本插件自带技能**：包内 `assets/<name>/SKILL.md`（例：`assets/smart-tdd/SKILL.md`）。frontmatter 只有 `name` 与 `description` 两个键。
2. **用户自己的技能**：放 harness 的技能目录 `~/.dsh/skills/<name>/SKILL.md`；项目级放仓库里的 `.dsh/skills/`（或 `.agents/skills/`）。

```
<name>/
  SKILL.md        # 主文档（必须）
  其他文件        # 仅在需要时
```

**分出去的只有两种：** ① 重型参考（100+ 行：完整 API、完整语法）② 可复用工具（脚本、模板）。**留在正文：** 原则与概念、代码模式（< 50 行）、其余一切。

**调用包内脚本要写解释器**：`bash scripts/tool.sh`、`node scripts/tool.js`，不要写裸路径 `scripts/tool.sh` —— 有些插件打包器会剥掉可执行位，裸路径在那里 `Permission denied`。

## 写 SKILL.md 的 description（决定会不会被发现）

- `description` **只写什么时候用**（触发条件、症状），**绝不摘要技能的流程**：实测下来，描述里写了流程的技能，agent 会照描述做、跳过正文（描述说"任务间做一次 review"，agent 就只做一次，尽管流程图写的是两次）。
- 以 "Use when" 开头；第三人称（它会被注入 system prompt）；具体到症状与场景；铺搜索关键词（报错原文、症状词、工具名、同义词）；尽量 < 500 字符。
- `name` 只用字母、数字、连字符；动名词/主动语态（`creating-skills` 优于 `skill-creation`）；别叫 Helper / Utils / Tools。
- 正文 < 500 行，超了拆文件（渐进披露：SKILL.md 当目录）；**引用只许一层深**（SKILL.md 直接指到参考文件，别再嵌套引用 —— 嵌套引用会被半读）；100 行以上的参考文件顶部放目录。
- 全文术语一致（同一个东西别换着叫）；路径一律正斜杠；避免时效性信息（旧做法收进 "old patterns" 折叠区）。
- 引用别的技能只写技能名 + 明确的强弱标记（`**REQUIRED BACKGROUND:**` / `**REQUIRED SUB-SKILL:**`），不要写会整份加载的 `@路径` 链接。

## 铁律（同 TDD）

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

新技能和**改动**既有技能都算。先写技能再测试？删掉重来。没测试就改？同样违规。

**没有例外：** 不为"简单补充"开口子 / 不为"只是加一节"开口子 / 不为"文档更新"开口子 / 不许把没测过的改动留作"参考" / 不许边跑测试边"顺手调整" / 删就是删。

**REQUIRED BACKGROUND:** 为什么这么重要见 `smart-tdd`；文档和代码同理。

## RED-GREEN-REFACTOR for Skills

工具面（DSH）：压力场景用 `subagent` 派全新上下文的子代理；技能文档用 `write` / `edit` 写、`read` 复核；用 `grep` / `glob` 查关键词覆盖与文件结构；用 `bash` 跑 `wc -l`、渲染流程图等。

### RED：写失败的测试（基线）

不给技能，用 `subagent` 跑压力场景，记录原文：
- 它做了什么选择？
- 它用了什么借口（**逐字记下**）？
- 哪种压力触发了违规？

这就是"看着测试失败"：写技能之前必须先看到 agent 自然会怎么做。

**压力场景怎么写：**
- 坏（没压力）："你要实现一个功能，技能怎么说？" —— 太学术，agent 只会背诵技能。
- 好（3+ 种压力叠加）：具体时间、真实后果、真实文件路径、强制 A/B/C 选择、问"你怎么做？"而不是"你该怎么做？"、不许它用"我会先问用户"脱身、开头声明"这是真实场景，必须选择并行动"。
- 压力类型：时间 / 沉没成本 / 权威 / 经济 / 疲惫 / 社交（显得教条）/ "务实 vs 教条"。最佳测试叠加 3 种以上。

### GREEN：写最小的技能

只针对 RED 里记录到的具体失败写，不为假想情况加内容。同样场景带上技能再跑，agent 应当遵守。仍失败 = 技能写得不清或不全，改了再测。

### REFACTOR：堵漏洞

agent 带着技能还违规？像测试回归一样处理：新借口逐字记下 → 加显式反制 → 重测，直到无懈可击。

**堵漏四件套：** ① 规则里显式封死具体逃路（"写码在测试前？删掉重来。**没有例外：** 不许留作参考 / 不许边测边改 / 删就是删"）② 合理化表加一行 ③ Warning Signs 加一条 ④ `description` 补上"快要违规时的症状"。

### 先微测措辞，再跑完整场景

完整压力场景是终检，但每次迭代太贵。先用微测试验证**措辞本身**：

1. **每次调用一个全新上下文样本**（单发 `subagent`）：system prompt = 技能真实语境（整份技能，不是孤立那段指导），user message = 一个诱惑它犯错的任务。
2. **必须有无指导对照组。** 对照组不出这个毛病，就别写这段指导 —— 停手。
3. **每个变体 5+ 次重复。** 单次样本会撒谎。
4. **每条命中都要人读。** 模板回显、被引用的反例都会伪装成命中；自动计数会同时高估失败和成功。
5. **方差本身是指标。** 指导生效时重复收敛到同一形状；5 次 5 种解读 = 措辞没约束力，先收紧形态再加字。

微测试只验证措辞；纪律类技能仍要跑压力场景。

### GREEN 不生效时：元测试

agent 选错了？问它："你读了技能还是选了 C。这个技能该怎么写才能让你清楚只有 A 可选？"三种回答三种修法：**"技能很清楚，我无视了它"** → 不是文档问题，加基础原则（"违反字面就是违反精神"）；**"技能该写上 X"** → 文档问题，照它说的逐字加；**"我没看到 Y 节"** → 组织问题，关键点提前、更醒目。

**无懈可击的标志：** 最大压力下选对 / 引用技能章节作理由 / 承认诱惑但照做 / 元测试答"技能很清楚，我该照做"。**还没到：** 找到新借口 / 辩称技能错了 / 造"折中方案" / 请求许可并强烈主张违规。

## Testing All Skill Types（按类型测）

| 类型 | 怎么测 | 成功标准 |
|---|---|---|
| **Discipline-Enforcing**（规则/要求，如 TDD） | 学术提问 + 压力场景 + 多重压力叠加；找出借口逐条反制 | 最大压力下仍守规则 |
| **Technique**（操作指南） | 应用场景 + 变化场景 + 缺信息测试 | 能把技巧用到新场景 |
| **Pattern**（心智模型） | 识别场景 + 应用场景 + 反例 | 知道何时用、何时不用 |
| **Reference**（文档/API） | 检索场景 + 应用场景 + 缺口测试 | 找得到且用得对 |

纯参考技能、没有可违反规则的技能不用压力测试（测检索即可）。

## Match the Form to the Failure（形态匹配失败）

写指导前先给基线失败分类。**一种形态能防住的失败，换一种形态会适得其反：**

| 基线失败 | 对的形态 | 错的形态 |
|---|---|---|
| 压力下明知故犯（知道规则却违反） | 禁令 + 合理化表 + Warning Signs | 软指导（"优先…""建议…"） |
| 合规但输出形状不对（prompt 臃肿、结论埋底、复述 spec） | 正面配方/契约：说清输出**是什么**、部件、顺序 | 禁令清单（"别复述""绝不旁白"） |
| 已产出的东西里漏了必备项 | 结构性的：模板里的 REQUIRED 字段/槽位 | 模板附近的散文提醒 |
| 行为该看条件 | 挂在可观察判据上的条件（"如果 brief 存在，就引用它"） | 无条件规则 + 豁免从句 |

**为什么禁令在塑形问题上会翻车：** 在竞争性激励下（"让 prompt 自足"），agent 会跟"不要 X"讨价还价。措辞对照测试里，禁令组产出的坏内容比配方组更多，甚至比无指导对照组还差 —— 自己微测你的个案，但别默认抓禁令。配方没有可谈判的余地：输出对上形状就是对上，没对上就是没对上。

**两条铁则：** **不写"除非"从句**（"不要 X，除非很重要"会重新打开谈判；给赢面的配方追加一个除非从句，就从一致变噪声。真有例外，写成挂在可观察判据上的独立条件）；**豁免从句不生效**（"代码块除外"照样压制代码块 —— 要豁免的部分重构到规则够不着的地方）。

## Bulletproofing Against Rationalization（防合理化）

基线失败是纪律失败（明知规则却在压力下跳过）时，用这套关漏洞：

- **显式关死每个逃路**：不只写规则，点名禁止具体变通（"留作参考""边测边改""我只是看看"）。
- **斩断"精神 vs 字面"**：早处放一句 **Violating the letter of the rules is violating the spirit of the rules.**（违反字面就是违反精神。）—— 一刀砍掉整类"我守的是精神"的借口。
- **合理化表**：基线测试里 agent 用过的每个借口都进表（见下节）。
- **Warning Signs（红旗清单）**：让 agent 能自检"正在合理化"的瞬间（见反模式节）。
- **说服原理有实验依据**：权威（"MUST / 无例外"）、承诺（公开声明、强制选择）、稀缺（"在做 X 之前立刻"）、社会认同（"每次都…"）等原则实测把遵守率从约 33% 提到约 72%（Meincke et al., 2025，N=28,000）。用它们保证关键实践在压力下被遵守，不是用来操纵。

## Common Rationalizations（常见合理化借口）

| Excuse | Reality |
|--------|---------|
| "这技能显然很清楚" | 你清楚 ≠ 别的 agent 清楚。测它。 |
| "这只是参考文档" | 参考文档也有缺口、有含糊段落。测检索。 |
| "测试是小题大做" | 没测过的技能必有问题，每次都这样。测 15 分钟省后面几小时。 |
| "出了问题我再测" | "出问题" = agent 用不了这个技能。部署**前**测。 |
| "测试太麻烦" | 比在生产里调试一个坏技能省事。 |
| "我有信心它没问题" | 过度自信必然出问题。照测。 |
| "审一遍就够了" | 读 ≠ 用。测应用场景。 |
| "没时间测" | 部署没测过的技能，后面修它花的时间更多。 |
| "先写技能再补测试" | 你测的是**你以为**要防的东西，不是真要防的东西。删掉重来。 |
| "写完再测也一样" | 事后测试 = "这在干什么？"事前测试 = "它该干什么？" |

**以上每一条的意思都是：部署前测完，没有例外。**

## Anti-Patterns（反模式 / Warning Signs）

- ❌ **叙事例**："2025-10-03 那次会话里，我们发现空 projectDir 导致……" —— 太具体，不可复用。
- ❌ **多语言稀释**：example-js.js / example-py.py / example-go.go —— 质量平庸、维护负担。**一个优秀例子胜过多个平庸例子**；你很擅长移植，一种语言就够。
- ❌ **流程图里写代码**：`step1 [label="import fs"]` —— 没法复制，难读。
- ❌ **无语义标签**：helper1、step2、pattern4。
- ❌ **Warning Signs 触发却不回头**：先写技能后补基线 / 只跑了学术测试 / 单压力场景 / 只记"agent 错了"没记原话 / 加的是"别作弊"这种空泛反制 / 第一次通过就收工。
- ❌ **批量产技能**：写完一个必须停下走完部署清单，不许测试留到"批量一起测"。部署没测过的技能 = 部署没测过的代码。

## Skill Creation Checklist（TDD 适配）

**每一条建一个 todo。**

**RED：**
- [ ] 写压力场景（纪律类技能 3+ 种压力叠加）
- [ ] 不带技能跑场景，逐字记录基线行为与借口
- [ ] 归纳失败/借口模式，找出有效的压力

**GREEN：**
- [ ] `name` 只用字母/数字/连字符；frontmatter 只带 `name` + `description`（≤1024 字符）
- [ ] `description` 以 "Use when" 开头、第三人称、只写触发条件、不摘要流程
- [ ] 全文铺搜索关键词（报错、症状、工具名）
- [ ] 有总览与核心原则；逐条对上 RED 的具体失败
- [ ] 指导形态匹配失败类型；行为塑造类措辞做过微测（纯参考技能 N/A）
- [ ] 代码内联或链到独立文件；一个优秀例子（不搞多语言）
- [ ] 带技能跑同样场景，验证 agent 遵守

**REFACTOR：**
- [ ] 从测试里抓出**新**借口，逐条加显式反制
- [ ] 合理化表、Warning Signs 汇总所有轮次
- [ ] `description` 补"快要违规的症状"
- [ ] 重测直到无懈可击，元测试确认是"清楚但被无视"还是文档问题

**质量检查：**
- [ ] 流程图只在决策不显然时用；有速查表；有常见错误节；无叙事
- [ ] 配套文件只为工具或重型参考

## 写技能的通用做法（官方最佳实践摘要）

> 摘要自源技能的 references/anthropic-best-practices.md，内容进正文，不落独立文件。

- **简洁为王**：上下文窗口是公共品。默认假设 agent 已经很聪明，只加它没有的信息；每一段都过"这段值它的 token 吗"。
- **自由度匹配脆弱性**：多种路都对 → 文字指导（高自由）；有偏好模式 → 伪代码/带参脚本（中）；脆弱、必须按固定顺序 → 钉死的脚本（低）。"窄桥两侧是悬崖"给护栏，"旷野无险"给方向。
- **不同档位的模型各测一遍**：快而省的档位看指导够不够、均衡档位看是否清晰高效、最强档位看是否过度解释。给最强模型刚好的量，弱一点的档位会不够用。
- **渐进披露**：SKILL.md 当目录；正文 < 500 行，超了拆文件；引用一层深；长参考文件加目录。
- **复杂流程给可勾选清单**，别让 agent 跳过关键校验步；**反馈环**（跑校验 → 修错 → 重来）显著提升质量。
- **先建评测再写文档**：没有技能跑代表性任务找差距 → 建 3 个评测场景 → 量基线 → 写最小指令 → 迭代。这就是本文的 RED。
- **用 agent 迭代技能**：Agent A（帮你写/改技能）↔ Agent B（带技能干真活），把 B 的真实表现带回 A 改。观察 agent 怎么**导航**你的技能：意外的读取顺序 = 结构不直觉；从不读某文件 = 该删或该加强信号。
- **可执行脚本**：solve, don't punt —— 处理错误并给替代，别把异常原样抛给 agent；别留魔法常数（每个值写清理由）；写清是"执行"还是"当参考读"；别假设依赖已装（写出安装命令）。
- **反模式**：Windows 反斜杠路径；一次给 5 个库（给默认 + 逃生口）；时效性信息（写进 old patterns 折叠区）；同一个概念换着叫。

## Flowcharts（流程图）

流程图**只**用于：不显然的决策点 / 可能提前停下的循环 / "A 还是 B"的取舍。
**绝不**用于：参考资料（用表格）/ 代码示例（用 markdown 块）/ 线性步骤（用编号列表）/ 无语义标签。

给用户渲图（抽出 SKILL.md 里语言标记为 `dot` 的围栏块，交给 graphviz 渲成 SVG；需要 graphviz）：

```bash
node scripts/render-graphs.js <技能目录>            # 每张图单独渲
node scripts/render-graphs.js <技能目录> --combine  # 全部合成一张
```

精简实现（源技能 render-graphs.js 的核心，可直接落成脚本；`--combine` 等完整版在同一脚本里）：

```js
// 从 SKILL.md 抽出 dot 围栏块，逐块交给 graphviz 渲成 SVG
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = path.resolve(process.argv[2]);
const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
const blocks = [...md.matchAll(/`{3}dot\n([\s\S]*?)`{3}/g)].map(m => m[1].trim());
if (!blocks.length) { console.log('no dot blocks'); process.exit(0); }
fs.mkdirSync(path.join(dir, 'diagrams'), { recursive: true });
for (const [i, dot] of blocks.entries()) {
  const name = (dot.match(/digraph\s+(\w+)/) || [, `graph_${i + 1}`])[1];
  const svg = execFileSync('dot', ['-Tsvg'], { input: dot, maxBuffer: 10 * 1024 * 1024 });
  fs.writeFileSync(path.join(dir, 'diagrams', `${name}.svg`), svg);
  console.log(`rendered ${name}.svg`);
}
```

## 与 smart 工作流的关系

写技能本身不需要开 smart 任务。若你要交付一个带测试、要人验收的技能包，那才用 `smart_begin({ size: 'light' })`。
