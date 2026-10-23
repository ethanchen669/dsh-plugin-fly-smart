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
  // 两个目录：agent 平面（tests/）与面板（panel/tests/，随面板一起并进来的契约测试）。
  const specFiles = ['tests', join('panel', 'tests')].flatMap(dir =>
    readdirSync(join(ROOT, dir)).filter(name => name.endsWith('.spec.mjs')).map(name => join(dir, name)))
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
// 平面归属（2026-10-12 合并面板后）：本包**同时**是 agent 平面（`index.js` 的工具行由 preset
// 按会话挂载）与宿主平面（bundle 层声明**工作台那一页**）。铁律是：bundle patch **只能**声明
// 面板行 —— 一旦把工具行写进去，宿主平面就会在开机时激活一个 `inject: ['tools']` 的插件。
{
  const patchPath = join(ROOT, String(manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml'))
  const bundlePatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const rowNames = [...bundlePatch.matchAll(/^\s*-?\s*name:\s*'?([^'\n]+?)'?\s*$/gmu)].map(m => m[1])
  check('bundle 层指向 cordis.patch.yml', manifest.dsh?.bundle?.patch === './cordis.patch.yml', String(manifest.dsh?.bundle?.patch))
  check('bundle patch 里恰好一行（工作台那一页）', rowNames.length === 1, rowNames.join(', '))
  // **必须是裸包名**：`@deepseek-ai/dsh-client-modules/lib/index.js:82` 的 `exactPackageSpecifier()`
  // 对带 `/` 的行名一律返回 undefined ⇒ 客户端半边不会被登记、面板在浏览器里根本不出现（实测过：
  // 子路径行时 boot payload 里连一条 smart 都没有）。裸名指向**面板**，工具在 tools/ 子路径里
  // 由 preset 挂载 ⇒ 客户端登记与"宿主不激活工具插件"两条同时成立。
  check('那一行是本包的**裸包名**（客户端半边只对裸名行登记）', rowNames[0] === 'dsh-plugin-fly-smart', String(rowNames[0]))
  // 禁的是**工具那半边**：`tools/index.js` 的插件 inject ['tools','commands','systemPrompt']，
  // 写进 bundle 就等于宿主开机激活一个要 tools 的插件（本仓与 dsh-fly 坑表都记着）。
  // 判据落在**行名**上，不 grep 全文：注释里提到 `tools/index.js` 是解释，不是声明
  //（第一版 grep 全文 ⇒ 被自己的注释判红，与"grep 全文 ⇒ 假绿"是同一种坏尺子）。
  check('bundle patch 里**没有** tools 子路径行（否则宿主开机激活 inject:tools）', rowNames.every(name => !name.includes('tools/')))
  check('tools 子路径确实存在（preset 那一行指着它）', existsSync(join(ROOT, 'tools', 'index.js')))
  check('客户端半边声明了 platform/inject', manifest.dsh?.client?.platform === 'web' && Array.isArray(manifest.dsh?.client?.inject))
  // **dsh.client 必须配 exports["./client"]**：引擎的 `dsh-client-modules` 就是靠这个键找客户端包的，
  // 缺了直接启动失败（2026-10-12 实测原文：
  //   `client-modules: dsh-plugin-fly-smart declares dsh.client but exports no "./client" bundle`），
  // 而且是**必挂**（required plugin did not activate）——不是警告。
  check('exports["./client"] 指向构建产物', manifest.exports?.['./client'] === './lib/client.js', String(manifest.exports?.['./client']))
  check('exports["."] 指向宿主入口（裸名行挂的就是它）', manifest.exports?.['.'] === './index.js', String(manifest.exports?.['.']))
  check('exports 不挡包子路径（tools/、panel/ 的行名还要解析）', manifest.exports?.['./*'] === './*', String(manifest.exports?.['./*']))
}

// ④ 内网 provider / 内网模型 id 不许进交付字节
const INTERNAL = [/llm-mioffice/iu, /xiaomi\/mimo-/iu, /gpt-6-astra/iu, /ppio\/pa\//iu]
// **跳过 scripts/**：本文件自己就带着这串模式（同 dsh-fly 的 shipping-hygiene 跳过 verify-*.mjs），
// 不跳的话尺子会扫到自己、永远假红。
// **markdown 也算交付字节**：README.md 是 npm 自动带上的、`assets/*/SKILL.md` 在 `files` 里 ——
// 只扫 `.mjs|.js|.tsx` 时，README 里写一句内网 provider 就**照旧 22/22**（这次就漏过一次）。
const text = [...shipped].filter(rel => /\.(mjs|js|tsx|md)$/u.test(rel) && !rel.startsWith('scripts/')).map(rel => readFileSync(join(ROOT, rel), 'utf8'))
const internalHits = text.flatMap(body => String(body).split('\n').filter(line => INTERNAL.some(pattern => pattern.test(line))))
check('交付字节里不出现内网 provider / 内网模型 id', internalHits.length === 0, internalHits.slice(0, 2).join(' | '))

// ⑤ repository.url 与仓名一致
const url = manifest.repository?.url ?? ''
check('repository.url 指本仓', url.endsWith('github.com/ethanchen669/dsh-plugin-fly-smart.git'), url)

// ⑤.b peer 范围要吃得到 harness 的**预发布**构建
//
// 市场规范点名的那个坑：node-semver 只在「范围里某个比较符与该版本的 major.minor.patch
// **元组完全一致**、且自身带预发布标签」时才放行预发布版本。所以 `^0.2.0-rc.2` 吃得到
// `0.2.0-rc.2` 与 `0.2.1`（稳定），却吃不到 **`0.2.1-rc.2`** —— 而那正是 harness 现在的
// 版本，用户装包会撞 ERESOLVE。写法要带**显式预发布分支**：
//   `>=0.2.0-rc.1 <0.2.1 || >=0.2.1-rc.1 <0.3.0-0`
const peers = manifest.peerDependencies ?? {}
const shorthandPrerelease = Object.entries(peers)
  .filter(([name, range]) => name.startsWith('@deepseek-ai/') && /^[~^]/u.test(String(range)) && /-[0-9A-Za-z]/u.test(String(range)))
  .map(([name, range]) => `${name}=${range}`)
check('peer 范围不许用带预发布的 ^/~ 简写（会静默排除 harness 的预发布构建）', shorthandPrerelease.length === 0, shorthandPrerelease.join(', '))
const noBranch = Object.entries(peers)
  .filter(([name, range]) => name.startsWith('@deepseek-ai/') && !String(range).includes('||'))
  .map(([name, range]) => `${name}=${range}`)
check('peer 范围带显式预发布分支（|| 分支）', noBranch.length === 0, noBranch.join(', '))

// ⑥ 必须文件存在
for (const rel of ['index.js', 'lib/state.mjs', 'README.md', 'LICENSE', '.gitignore']) {
  check(`存在 ${rel}`, existsSync(join(ROOT, rel)))
}

// ⑦ 面板**自带**设计系统（web 上没有工作台外壳时它也得长得对）
//    —— 2026-10-13 的教训：面板在 web 上"有内容、没样式"，就是因为这条尺子缺席。
{
  const sync = execFileSync(process.execPath, [join(ROOT, 'scripts', 'sync-panel-style.mjs'), '--check'], { encoding: 'utf8' })
  check('workbench-css.ts 与设计系统库逐字节一致', sync.includes('逐字节一致'), sync.trim().split('\n').at(-1))
  const bundlePath = join(ROOT, 'lib', 'client.js')
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : ''
  check('客户端包内联了设计系统（.fly-panel 有规则）', bundle.includes('.fly-panel'), `${bundle.length} 字节`)
  check('客户端包内联了工作台基元（.fly-card / .fly-chip）', bundle.includes('.fly-card') && bundle.includes('.fly-chip'))
  const client = readFileSync(join(ROOT, 'src', 'client', 'index.tsx'), 'utf8')
  check('客户端真的注入那份样式（带 data-plugin 的 <style>）', client.includes("setAttribute('data-plugin', PACKAGE)"))
}

let failed = 0
for (const { label, ok, detail } of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : `   ${detail}`}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
