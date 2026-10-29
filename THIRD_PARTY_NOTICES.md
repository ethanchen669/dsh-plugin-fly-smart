# Third-Party Notices

本仓库（`dsh-plugin-fly-smart`）是 [obra/superpowers](https://github.com/obra/superpowers)
的 **DSH 移植与扩展**。方法论内核移植自 superpowers，外加 DSH 平台适配层，
并扩展出 superpowers 没有的能力（用户门 G1–G5、`smart_decide` 待裁决、
briefing 对话回路、面板可视化、成对相位与 review bundle）。

以下内容依据 MIT License 分发。

---

## superpowers

- **来源**: https://github.com/obra/superpowers
- **对照基线**: v7.0.1（2026-10-21）—— brainstorming 重建与调优、长技能 references/ 化、executing-plans/SDD 台账纪律
- **许可**: MIT License
- **版权**: Copyright (c) 2025 Jesse Vincent

```
MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 移植清单

每个 `assets/<name>/SKILL.md` 的头部都带出处注释。对应关系：

| 本仓库技能 | 移植自 superpowers | 策略 |
| --- | --- | --- |
| `assets/smart-skills/` | `skills/using-superpowers/` | 改写适配 |
| `assets/smart-debug/` | `skills/systematic-debugging/` | 移植（含 references 摘要） |
| `assets/smart-tdd/` | `skills/test-driven-development/` | 移植（含 `writing-good-tests.md`） |
| `assets/smart-verify-claim/` | `skills/verification-before-completion/` | 移植 |
| `assets/smart-review-receive/` | `skills/receiving-code-review/` | 移植 |
| `assets/smart-plan/` | `skills/writing-plans/` | 移植（文档契约） |
| `assets/smart-worktree/` | `skills/using-git-worktrees/` | 移植 |
| `assets/smart-parallel/` | `skills/dispatching-parallel-agents/` | 移植 |
| `assets/smart-write-skill/` | `skills/writing-skills/` | 移植（含 references 摘要） |
| `assets/smart-diagnose/` | `skills/diagnosing-superpowers/` | **改写适配**（诊断对象换成路由与派发） |
| `assets/smart-brainstorm/` | `skills/brainstorming/`（v7.0.1） | 改写适配（决策表 + 先看再问 + 批准才动工） |
| `assets/smart-execute/` | `skills/executing-plans/` + `skills/subagent-driven-development/` | 合并改写（两模式共用台账） |
| `assets/smart-finish/` | `skills/finishing-a-development-branch/` | 移植 |
| `assets/smart-review/` | `skills/requesting-code-review/` | 扩展（它只管派人，我们同时给评审纪律与三档终态） |
| `assets/smart-acceptance/` | （上游无） | **本仓扩展**：fixture / gate / probe |
| `assets/smart-design/` | （上游无） | **本仓扩展**：设计五问 |
| `assets/smart-adr/` | （上游无） | **本仓扩展**：ADR-lite 五段含"错了代价" |

**未移植但用 smart 现有机制替代**的 superpowers 技能（无版权文本随包分发，但方法论来源相同）：

| superpowers | 本仓库的等价物 |
| --- | --- |
| `subagent-driven-development` | `smart-execute` 的派发模式 |
| `executing-plans` | `smart-execute` 的内联模式 |
| `requesting-code-review` | `smart-review` + `smart_dispatch({ role: 'review' })` |
| `finishing-a-development-branch` | `smart-finish` |
| `brainstorming` | `smart-brainstorm` |
| `diagnosing-superpowers` | `smart-diagnose`（改写适配） |

### 命名

本包**不是** obra/superpowers 的官方移植，也不是它本身。若在插件市场搜索
`superpowers` 找到本包，看到的是**衍生实现**：方法论继承，机制不同。
