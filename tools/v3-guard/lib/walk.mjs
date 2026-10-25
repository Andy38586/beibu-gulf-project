/**
 * tools/v3-guard/lib/walk.mjs — 守卫的目录遍历**唯一实现**。
 *
 * 收口前 9 个守卫各写一份递归 walker，跳过集分裂成三套以上且无人声明为什么
 * （同一个 `__tests__` 有的跳、有的不跳）。致命处不是重复，而是**扫描面不可复核**：
 * 分母不对的守卫与没有守卫等价（W58 同族）。
 *
 * 约定：只有一份默认跳过集；任何额外跳过必须写在调用点的 `skip` 里，于是
 * 「为什么这个守卫少扫一类目录」成为可读代码。目录不可读时跳过该目录（原实现里
 * 只有两处 try/catch，其余会整体崩）。**不排序**：返回顺序即 readdir 顺序，
 * 需要稳定顺序的调用点自己 `.sort()`（报错文案先后依赖于此）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 默认跳过集：VCS / 依赖 / 产物 / 本机工作区，这些目录里不可能有受判目标 */
export const DEFAULT_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.local',
  '.workbuddy',
  '.trae',
  '_traetmp',
  '.reasonix',
  '.staging-react',
  'pdf_build',
  'algorithm-service', // 退役目录：已不在版本控制内，保留此名只为跳过其遗留产物
])

/**
 * @param {string} root 起点（绝对路径）
 * @param {object} o
 * @param {(name: string) => boolean} o.match 文件名判据（目录不参与）
 * @param {string[]} [o.skip] 额外跳过的目录名
 * @param {(name: string, depth: number) => boolean} [o.skipEntry] 按名字+深度跳过目录
 * @param {number} [o.maxDepth] 最大递归深度（根 = 0）
 * @param {'rel'|'abs'|'sources'} [o.output='rel'] 相对路径 / 绝对路径 / `{ path, text }`
 * @param {string} [o.relBase] `rel` / `sources` 的相对基准（默认 = root）
 * @returns {Array<string | { path: string, text: string }>}
 */
export function walkFiles(root, o) {
  const skip = new Set(o.skip ?? [])
  const base = o.relBase ?? root
  const shape = (abs) => {
    if (o.output === 'abs') return abs
    const rel = path.relative(base, abs).split(path.sep).join('/')
    return o.output === 'sources' ? { path: rel, text: readFileSync(abs, 'utf8') } : rel
  }
  const out = []
  const walk = (dir, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 不可读目录：跳过，不让守卫整体崩
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (DEFAULT_SKIP_DIRS.has(e.name) || skip.has(e.name)) continue
        if (o.skipEntry?.(e.name, depth)) continue
        if (o.maxDepth !== undefined && depth >= o.maxDepth) continue
        walk(path.join(dir, e.name), depth + 1)
      } else if (o.match(e.name)) {
        try {
          out.push(shape(path.join(dir, e.name)))
        } catch {
          continue // 单文件读失败：跳过
        }
      }
    }
  }
  walk(root, 0)
  return out
}
