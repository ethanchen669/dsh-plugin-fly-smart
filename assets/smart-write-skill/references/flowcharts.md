# 流程图：什么时候用、怎么渲（参考）

摘自 `smart-write-skill`。

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
