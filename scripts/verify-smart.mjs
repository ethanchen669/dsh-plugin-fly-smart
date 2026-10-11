#!/usr/bin/env node
/**
 * 本仓门禁（**引擎无关**，不装依赖、不起 dsh）：
 *
 *   1. 单元与行为测试：`node --test tests/`（阶段机、门、工具面、路由、briefing、command）。
 *      它们只 import 本仓相对文件，所以这一层能在**任何**机器上跑。
 *   2. 源码形状（打包语义 + 平面归属）：
 *      - `package.json` 的 `files` 必须真覆盖入口与它 import 的每个内部文件（`files` 里列了
 *        不等于进了 tarball —— 主仓门禁为资产踩过这条）；
 *      - **不许**出现 `dsh` / `dsh.bundle` 字段：本包是 **agent 平面**，由 preset 按会话挂载。
 *        带上 `dsh.bundle` 会让宿主开机激活一个 `inject: ['tools']` 的插件（主仓
 *        `fly-profile.mjs` 的注释里写着这条理由）；
 *      - 交付字节里不许出现内网 provider / 内网模型 id（与主仓 shipping-hygiene 同一套模式）；
 *      - `repository.url` 必须与跑发布 workflow 的仓库**逐字一致**（npm `--provenance` 会校验，
 *        写错 = 直接拒发）。
 *
 * **宿主侧集成验收**（起 scratch profile、`dsh plugin add`、preset 行、真跑阶段机）不在这里，
 * 它在 dsh-fly 仓的 `scripts/verify-smart-integration.mjs` —— 那一层验的是"宿主怎么接这个包"，
 * 属于宿主仓。
 *
 * Usage: node scripts/verify.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checks = []
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail: String(detail) })

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// ① 单元与行为测试
let testOut = ''
let testOk = true
try {
  // 显式给文件列表：`node --test tests/` 在本机 Node 24 上会把目录当**模块**去解析
  // （实测 `Cannot find module '…/tests'`），dsh-fly 里也一直是 `node --test <file>`。
  const specFiles = readdirSync(join(ROOT, 'tests')).filter(name => name.endsWith('.spec.mjs')).map(name => join('tests', name))
  testOut = execFileSync(process.execPath, ['--test', ...specFiles], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) {
  testOk = false
  testOut = `${error.stdout ?? ''}${error.stderr ?? ''}`
}
// 两种 reporter 的计数行都要认：老格式 `# pass 79`、本机 Node 24 打的是 `ℹ pass 79`
// （第一版只认前者 ⇒ 明明 79/79 全过却读成 `? 过 / ? 败` 并判红）。
const count = name => (testOut.match(new RegExp(`^(?:#|ℹ)\\s*${name}\\s+(\\d+)$`, 'mu')) ?? [])[1] ?? '?'
const passLine = count('pass')
const failLine = count('fail')
check(`单元与行为测试全过（${passLine} 过 / ${failLine} 败）`, testOk && failLine === '0', testOk ? '' : testOut.split('\n').slice(-12).join(' / '))

// ② files 必须覆盖**入口 + 它真正 import 的内部文件**（不是"目录里所有源文件"：dev-only 的
//    共享件如 lib/commit-identity.mjs 本来就不该进包）。口径 = 从入口沿相对 import 递归可达。
const shipped = new Set()
const walk = (dir, prefix = '') => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', '.git', '__pycache__'].includes(item.name)) continue
    const rel = prefix === '' ? item.name : `${prefix}/${item.name}`
    if (item.isDirectory()) walk(join(dir, item.name), rel)
    else shipped.add(rel)
  }
}
walk(ROOT)
const entry = manifest.main ?? 'index.js'
const reachable = new Set([entry])
const queue = [entry]
while (queue.length > 0) {
  const rel = queue.pop()
  const body = readFileSync(join(ROOT, rel), 'utf8')
  for (const match of body.matchAll(/from\s+'(\.\/[^']+)'/gu)) {
    const resolved = join(dirname(rel), match[1])
    if (!shipped.has(resolved) || reachable.has(resolved)) continue
    reachable.add(resolved)
    queue.push(resolved)
  }
}
const files = manifest.files ?? []
const covered = rel => files.some(rule => rel === rule || rel.startsWith(`${rule}/`))
const missing = [...reachable].filter(rel => !covered(rel))
check(`files 覆盖入口及其 import 图（${reachable.size} 个文件）`, missing.length === 0 && reachable.size >= 2, missing.join(', '))

// ③ 平面归属：不许带 dsh / dsh.bundle
check('不带 dsh.bundle（agent 平面，由 preset 按会话挂载）', manifest.dsh === undefined, JSON.stringify(manifest.dsh ?? null))

// ④ 内网 provider / 内网模型 id 不许进交付字节
const INTERNAL = [/llm-mioffice/iu, /xiaomi\/mimo-/iu, /gpt-6-astra/iu, /ppio\/pa\//iu]
// **跳过 scripts/**：本文件自己就带着这串模式（同 dsh-fly 的 shipping-hygiene 跳过 verify-*.mjs），
// 不跳的话尺子会扫到自己、永远假红。
const text = [...shipped].filter(rel => /\.(mjs|js)$/u.test(rel) && !rel.startsWith('scripts/')).map(rel => readFileSync(join(ROOT, rel), 'utf8'))
const internalHits = text.flatMap(body => String(body).split('\n').filter(line => INTERNAL.some(pattern => pattern.test(line))))
check('交付字节里不出现内网 provider / 内网模型 id', internalHits.length === 0, internalHits.slice(0, 2).join(' | '))

// ⑤ repository.url 与仓名一致
const url = manifest.repository?.url ?? ''
check('repository.url 指本仓', url.endsWith('github.com/ethanchen669/dsh-plugin-fly-smart.git'), url)

// ⑥ 必须文件存在
for (const rel of ['index.js', 'lib/state.mjs', 'README.md', 'LICENSE', '.gitignore']) {
  check(`存在 ${rel}`, existsSync(join(ROOT, rel)))
}

let failed = 0
for (const { label, ok, detail } of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : `   ${detail}`}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
