import { describe, expect, it } from 'vitest'

import { collectOverdue } from '../review-age.mjs'

const MAP = JSON.stringify({
  docs: [
    { id: 'OLD', path: 'docs/契约/旧契约.md', layer: '契约', status: 'active' },
    { id: 'NEW', path: 'docs/契约/新契约.md', layer: '契约', status: 'active' },
    { id: 'C1', path: 'docs/宪法/C1-项目宪法.md', layer: '宪法', status: 'active' },
  ],
})
const FILES = {
  'tools/v3-guard/lib/doc-map.json': MAP,
  'docs/契约/旧契约.md': '# 旧\n> 最近复核：2026-01-01\n',
  'docs/契约/新契约.md': '# 新\n> **最近复核**：2026-10-04\n',
  'docs/宪法/C1-项目宪法.md': '# C1\n> 最近复核：2020-01-01\n',
}

const readFile = (p) => {
  if (p in FILES) return FILES[p]
  throw new Error(`ENOENT ${p}`)
}

describe('review-age', () => {
  it('正对照：超期契约被列出且带天数（旧契约 2026-01-01 → 2026-10-05 已 277 天）', () => {
    const overdue = collectOverdue({ today: new Date('2026-10-05T00:00:00'), readFile })
    expect(overdue.map((o) => o.id)).toEqual(['OLD'])
    expect(overdue[0].days).toBe(277)
  })

  it('负对照：全部在阈值内时返回空（含加粗写法的「最近复核」）', () => {
    // 2026-02-01：旧契约距复核 31 天（≤90），新契约复核日在未来 ⇒ 均不超期
    const overdue = collectOverdue({ today: new Date('2026-02-01T00:00:00'), readFile })
    expect(overdue).toEqual([])
  })

  it('宪法层不参与契约超期（层级过滤，不是漏检）', () => {
    const overdue = collectOverdue({ today: new Date('2026-10-05T00:00:00'), readFile })
    expect(overdue.some((o) => o.id === 'C1')).toBe(false)
  })
})
