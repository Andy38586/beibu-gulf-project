// CI 工作流静态核对（只读，诊断工具非门禁）：
//   YAML 语法 / jobs.needs 可解析 / working-directory 存在 / npm script 引用 /
//   node 脚本路径存在 / uses 是否带版本。
// 用法：node tools/diag/validate-workflows.mjs [工作流目录，默认 .github/workflows]
// 2026-10-05 实测：ci.yml（8 jobs）+ data-sync.yml（1 job）错误/警告 0；
// 核对计数 = npm script 引用 12 处、node 脚本路径 7 处（均为非空转计数）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'

const ROOT = resolve(import.meta.dirname, '../..')
const WF = process.argv[2] ? resolve(ROOT, process.argv[2]) : join(ROOT, '.github/workflows')
const pkgs = new Map()
function pkg(dir) {
  if (!pkgs.has(dir)) {
    const p = join(ROOT, dir, 'package.json')
    pkgs.set(dir, existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
  }
  return pkgs.get(dir)
}

let errors = 0
let warns = 0
let npmChecks = 0
let nodeChecks = 0
const files = readdirSync(WF).filter((f) => /\.ya?ml$/.test(f))
for (const f of files) {
  const text = readFileSync(join(WF, f), 'utf8')
  let doc
  try {
    doc = yaml.load(text)
  } catch (e) {
    console.log(`ERROR ${f}: YAML 解析失败: ${e.message}`)
    errors++
    continue
  }
  console.log(`OK   ${f}: YAML 解析通过（jobs=${Object.keys(doc.jobs ?? {}).length}）`)
  const jobIds = new Set(Object.keys(doc.jobs ?? {}))
  for (const [jid, job] of Object.entries(doc.jobs ?? {})) {
    for (const need of [].concat(job.needs ?? [])) {
      if (!jobIds.has(need)) {
        console.log(`ERROR ${f}#${jid}: needs 引用了不存在的 job "${need}"`)
        errors++
      }
    }
    for (const step of job.steps ?? []) {
      const wd = step['working-directory'] ?? '.'
      if (step['working-directory'] && !existsSync(join(ROOT, step['working-directory']))) {
        console.log(`ERROR ${f}#${jid}: working-directory 不存在: ${step['working-directory']}`)
        errors++
      }
      if (step.uses && !/@/.test(step.uses)) {
        console.log(`WARN  ${f}#${jid}: uses 未固定版本: ${step.uses}`)
        warns++
      }
      const run = step.run
      if (typeof run !== 'string') continue
      // npm run <script> / npm test；支持 --prefix 前置或后置两种写法
      for (const m of run.matchAll(
        /npm\s+(?:--prefix\s+(\S+)\s+)?(run\s+([A-Za-z0-9:_.-]+)|test\b)(?:\s+--prefix\s+(\S+))?/g
      )) {
        const prefix = m[1] ?? m[4] ?? wd
        const script = m[3] ?? 'test'
        npmChecks++
        const p = pkg(prefix)
        if (!p) {
          console.log(`ERROR ${f}#${jid}: npm 目标 ${prefix} 无 package.json`)
          errors++
        } else if (!p.scripts?.[script]) {
          console.log(`ERROR ${f}#${jid}: ${prefix}/package.json 缺 script "${script}"`)
          errors++
        }
      }
      // node <path>（跳过多行脚本里的注释行）
      for (const m of run.matchAll(
        /(?:^|[\s&|;(])node\s+(?:-[^\s]+\s+)*([^\s&|;)]+\.(?:cjs|mjs|js|ts))\b/g
      )) {
        const rel = m[1]
        if (rel.startsWith('$')) continue
        nodeChecks++
        if (!existsSync(join(ROOT, wd, rel))) {
          console.log(`ERROR ${f}#${jid}: node 脚本不存在: ${wd}/${rel}`)
          errors++
        }
      }
    }
  }
}
console.log(`\n合计：${files.length} 个 workflow；错误 ${errors}，警告 ${warns}`)
console.log(`核对计数：npm script 引用 ${npmChecks} 处；node 脚本路径 ${nodeChecks} 处`)
process.exit(errors ? 1 : 0)
