/**
 * 把设计系统库（`@dsh-fly/fly-panel-style`）的 CSS 同步成**包内**的生成文件。
 *
 * 为什么不能直接 import：客户端构建器（`scripts/build-client.mjs`）不许把本包 `src/` 之外的文件
 * 引进产物 —— 陈旧指纹只哈希本包 `src/`，外部输入会让指纹变成瞎尺子。所以走"生成 + 门禁比字节"：
 *
 *   @dsh-fly/fly-panel-style (npm 包，设计系统的单一所有者)
 *        ↓ sync（本脚本；--check 在门禁里比字节）
 *   src/client/workbench-css.ts   ← 生成物，进指纹 ✓
 *
 * 面板是 `.fly-panel` 页，需要的是**全量**设计系统（库里 9 段 join 好的 `WORKBENCH_CSS`）——
 * 它自己没有被交错的自有规则（外壳才有）。
 *
 * 用法：`node scripts/sync-panel-style.mjs`（写入）· `--check`（只校验）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const OUT = join(ROOT, 'src', 'client', 'workbench-css.ts')

function library() {
  const candidates = [
    join(ROOT, 'node_modules', '@dsh-fly', 'fly-panel-style', 'index.js'),
  ]
  const entry = candidates.find(path => existsSync(path))
  if (entry === undefined) throw new Error(`找不到 @dsh-fly/fly-panel-style（试过：${candidates.join(' / ')}）—— 先 \`pnpm install\`（发布前可先用 file: 指向 dsh-fly 的 packages/fly-panel-style）`)
  const source = readFileSync(entry, 'utf8')
  const match = source.match(/export const WORKBENCH_CSS = [^\n]*$/mu) ?? source.match(/export const WORKBENCH_CSS = `([\s\S]*)`\s*$/u)
  const joined = /join\(''\)/u.test(source)
  if (joined) {
    // 库导出的是分段 + join：这里把分段取出来自己 join（避免依赖库内部的实现细节）
    const segments = [...source.matchAll(/^  `([\s\S]*?)`[,]?$/gmu)].map(m => m[1])
    if (segments.length === 0) throw new Error(`${entry}: 取不到分段`)
    return { css: segments.join(''), version: versionOf(entry), entry, segments: segments.length }
  }
  if (match?.[1] === undefined) throw new Error(`${entry}: 找不到 WORKBENCH_CSS`)
  return { css: match[1], version: versionOf(entry), entry, segments: 1 }
}
const versionOf = (entry) => JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')).version

const { css, version, entry, segments } = library()
if (css.includes('`') || css.includes('${')) throw new Error(`${entry}: CSS 里有反引号或 \${ —— 库那边该把它解析掉`)
const body = `/**
 * **生成物，别手改** —— 来自 \`@dsh-fly/fly-panel-style@${version}\`（设计系统库，不是插件）。
 * 面板是 \`.fly-panel\` 页：外壳在场时它吃到外壳的样式表；**外壳不在场**（web）时靠这份自足，
 * 由客户端注入成 \`<style data-plugin="dsh-plugin-fly-smart-panel">\`。
 * 重新生成：\`node scripts/sync-panel-style.mjs\`（\`--check\` 只校验）。段数：${segments}。
 */
export const WORKBENCH_CSS = \`${css}\`
`
if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== body) { console.error(`✗ ${OUT} 与 @dsh-fly/fly-panel-style@${version} 不一致 —— 跑 \`node scripts/sync-panel-style.mjs\``); process.exit(4) }
  console.log(`ok   workbench-css.ts 与库@${version} 逐字节一致（${css.length} 字符 · ${segments} 段）`)
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, body)
  console.log(`✓ 已写入 src/client/workbench-css.ts（库@${version}，${css.length} 字符 · ${segments} 段）`)
}
