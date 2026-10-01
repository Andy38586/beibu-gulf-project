import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// 数据自述失真防线。
//
// backend/data 下的生成物由 tools/ 下脚本产出（另有少量人工维护的配置型数据），各自在
// metadata 里写一个「上次更新」戳记（lastUpdated / generatedAt / updatedAt）。这些戳记此前
// 零断言，已证一处失真：forecast/index.json 的 lastUpdated="2026-08-08" 比它最后一次内容改动
//（git 实测 2026-09-11）晚 34 天仍是旧值，且被同一 metadata 里的 coordinateProvenance
// 自述「2026-09-11 已对齐」自证为假——任何「数据换了没生效」的排查都只能靠重启进程或猜。
//
// 判据：戳记不得**早于**该文件最后一次 git 改动日。
//   · 刚重跑生成脚本、尚未提交时戳记 > git（允许，不误红）；
//   · 改了内容却没更戳记 ⇒ 戳记 < git ⇒ 红（本次要抓的形态）。
// 约定：提交数据文件的任何改动时，把戳记改成改动当天（生成脚本已改为生成时写入）。
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DATA_DIR = path.join(REPO_ROOT, 'backend', 'data')
const STAMP_KEYS = ['lastUpdated', 'generatedAt', 'updatedAt'] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface StampedFile {
  rel: string
  key: string
  stamp: string
}

function walkJson(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkJson(full, acc)
    else if (entry.name.endsWith('.json')) acc.push(full)
  }
  return acc
}

function stampedFiles(): StampedFile[] {
  const rows: StampedFile[] = []
  for (const abs of walkJson(DATA_DIR)) {
    let parsed: { metadata?: Record<string, unknown> }
    try {
      parsed = JSON.parse(readFileSync(abs, 'utf8')) as { metadata?: Record<string, unknown> }
    } catch {
      continue // 非 JSON 或损坏由别的用例负责
    }
    const metadata = parsed.metadata
    if (!metadata || typeof metadata !== 'object') continue
    for (const key of STAMP_KEYS) {
      const value = metadata[key]
      if (typeof value === 'string' && ISO_DATE.test(value)) {
        rows.push({
          rel: path.relative(REPO_ROOT, abs).split(path.sep).join('/'),
          key,
          stamp: value,
        })
      }
    }
  }
  return rows
}

/** 浅克隆（CI actions/checkout 默认 fetch-depth:1）判定。
 *
 * 为什么必须识别它：浅克隆里只存在 tip 提交，`git log -1 -- <path>` 对**任何**路径
 * 都会退化成「根提交 = 全量新增」口径，把文件最后改动日一律报成 tip 日期
 * （2026-10-01 实测：facilityPoints.json 真实改动日 09-23、戳记 09-23 本应绿，
 * CI 却报 10-01 ⇒ 假红）。此时本守卫无法取证，按「无 git」同口径跳过；
 * 真正的保护由 ci.yml backend-tests 的 fetch-depth: 0 提供全量历史。 */
function isShallowRepo(): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim() === 'true'
    )
  } catch {
    return false // 取不到就按非浅克隆走原逻辑，让真问题仍能红
  }
}

/** 该文件最后一次 git 改动日；无 git（导出包）/浅克隆/未跟踪时返回 null ⇒ 跳过不误红 */
function gitLastChange(rel: string): string | null {
  if (isShallowRepo()) return null
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
    return ISO_DATE.test(out) ? out : null
  } catch {
    return null
  }
}

describe('backend/data 生成物自述戳记 vs git 改动日', () => {
  it('🔴 戳记不得早于该文件最后一次改动日（改了内容没更戳记即红）', () => {
    const rows = stampedFiles()
    // 存在性断言：一个戳记都扫不到时本用例会空过（假绿），故先钉住样本数
    expect(rows.length).toBeGreaterThan(0)

    for (const { rel, key, stamp } of rows) {
      const git = gitLastChange(rel)
      if (!git) continue
      expect(
        stamp >= git,
        `${rel} 的 metadata.${key}=${stamp} 早于该文件最后一次改动 ${git}——改了内容没更新戳记`
      ).toBe(true)
    }
  })
})
