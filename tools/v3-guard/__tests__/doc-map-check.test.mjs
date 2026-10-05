import { describe, expect, it } from 'vitest'

import { auditDocMap } from '../doc-map-check.mjs'

const FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'tools/doc-system/baseline/AGENTS.md',
  'docs/宪法/C1-项目宪法.md',
  'docs/宪法/C3-信息源宪法.md',
  'docs/契约/K1-技术规则集.md',
  'docs/文档地图.md',
  'docs/待解决问题.md',
  'tools/v3-guard/protocol-single-source.mjs',
])

const CONTRACT_OK = [
  '# 文档地图',
  '> 最近复核：2026-10-05',
  '## 变更记录',
  '- 2026-10-05 生成',
].join('\n')

function baseInput() {
  return {
    docs: [
      {
        id: 'AGENTS',
        path: 'AGENTS.md',
        layer: '宪法',
        status: 'active',
        role: '协议',
        readWhen: ['*'],
        writeWhen: ['用户批准'],
        guard: 'tools/v3-guard/protocol-single-source.mjs',
      },
      {
        id: 'C1',
        path: 'docs/宪法/C1-项目宪法.md',
        layer: '宪法',
        status: 'stub',
        role: '宪法',
        guard: null,
      },
      {
        id: 'C3',
        path: 'docs/宪法/C3-信息源宪法.md',
        layer: '宪法',
        status: 'active',
        role: '信息源宪法',
        readWhen: ['*'],
        writeWhen: ['用户批准'],
        guard: null,
      },
      {
        id: 'K1',
        path: 'docs/契约/K1-技术规则集.md',
        layer: '契约',
        status: 'stub',
        role: '规则',
        guard: null,
      },
      {
        id: 'MAP',
        path: 'docs/文档地图.md',
        layer: '契约',
        status: 'active',
        role: '地图',
        readWhen: ['*'],
        writeWhen: ['docs:map'],
        guard: null,
      },
      {
        id: 'S1',
        path: 'docs/待解决问题.md',
        layer: '日志',
        status: 'external',
        role: '台账',
        readWhen: ['A'],
        writeWhen: ['同笔'],
        guard: null,
        ts: 'rolling',
      },
    ],
    facts: [
      {
        id: 'protocol-source',
        authority: { kind: 'doc', ref: 'AGENTS' },
        derived: [{ site: 'CLAUDE.md', guard: 'tools/v3-guard/protocol-single-source.mjs' }],
        guard: 'tools/v3-guard/protocol-single-source.mjs',
      },
    ],
    tasks: [{ id: 'A', read: ['K1', 'S1'], writeBack: ['K1', 'S1'] }],
    kp: {
      sources: [
        {
          id: 'AGENTS.md',
          doc: 'AGENTS.md',
          file: 'tools/doc-system/baseline/AGENTS.md',
          sections: [{ heading: '## 一、四条铁律', anchor: 'AGENTS.md:8' }],
        },
      ],
      kps: [
        {
          id: 'KP-001',
          source: 'AGENTS.md',
          anchor: 'AGENTS.md:8',
          heading: '## 一、四条铁律',
          target: 'C3',
          authority: 'new',
        },
      ],
    },
    meta: { migrationOpen: true },
    agentsText: '| A 修 bug | K1 对应节 + S1 | K1 / S1 |',
    trackedUnderActiveDirs: [],
    exists: (p) => FILES.has(p),
    gitDate: () => null,
    readText: (p) => (p === 'docs/文档地图.md' ? CONTRACT_OK : null),
  }
}

function codes(problems) {
  return problems.map((p) => p.code)
}

describe('doc-map-check', () => {
  it('正对照：完整登记 + 矩阵对齐 + KP 覆盖 → 零问题', () => {
    expect(auditDocMap(baseInput())).toEqual([])
  })

  it('@guard-red-sample 三层目录下未登记文档 ⇒ 红', () => {
    const input = baseInput()
    input.trackedUnderActiveDirs = ['docs/宪法/C9-野文档.md']
    expect(codes(auditDocMap(input))).toContain('DOC-UNREG')
  })

  it('同一 KP 锚点指向两个目标（双权威）⇒ 红', () => {
    const input = baseInput()
    input.kp.kps.push({
      id: 'KP-002',
      source: 'AGENTS.md',
      anchor: 'AGENTS.md:8',
      heading: '## 一、四条铁律',
      target: 'MAP',
      authority: 'new',
    })
    expect(codes(auditDocMap(input))).toContain('KP-DUAL')
  })

  it('KP 目标未登记 ⇒ 红', () => {
    const input = baseInput()
    input.kp.kps[0].target = 'K9'
    expect(codes(auditDocMap(input))).toContain('KP-TARGET')
  })

  it('契约缺当日变更记录 ⇒ 红', () => {
    const input = baseInput()
    input.readText = (p) =>
      p === 'docs/文档地图.md'
        ? '# 文档地图\n> 最近复核：2026-10-01\n## 变更记录\n- 2026-10-01 生成'
        : null
    input.gitDate = (p) => (p === 'docs/文档地图.md' ? '2026-10-05' : null)
    expect(codes(auditDocMap(input))).toContain('CONTRACT-LOG')
  })

  it('@guard-red-sample 生成件落后于源 ⇒ 红；同笔暂存重生成件 ⇒ 不红（序依赖解除）', () => {
    const input = baseInput()
    input.docs.find((d) => d.id === 'MAP').generatedFrom = 'tools/v3-guard/lib/doc-map.json'
    input.gitDate = (p) =>
      p === 'tools/v3-guard/lib/doc-map.json'
        ? '2026-10-06'
        : p === 'docs/文档地图.md'
          ? '2026-10-05'
          : null
    input.readText = (p) => (p === 'docs/文档地图.md' ? CONTRACT_OK : null)
    expect(codes(auditDocMap(input))).toContain('CONTRACT-STALE')
    expect(codes(auditDocMap({ ...input, staged: ['docs/文档地图.md'] }))).not.toContain(
      'CONTRACT-STALE'
    )
  })

  it('迁移声明结束后仍有 stub ⇒ 红', () => {
    const input = baseInput()
    input.meta.migrationOpen = false
    expect(codes(auditDocMap(input))).toContain('MIG-OPEN')
  })

  it('KP 指向 frozen 记录件 ⇒ new 合法（冻结承接不是失配）', () => {
    const input = baseInput()
    input.docs.push({
      id: 'SNAP',
      path: 'docs/日志/快照/代码知识库.md',
      layer: '日志',
      status: 'frozen',
      role: '快照',
      guard: null,
      ts: '2026-10-05',
    })
    input.exists = (p) => FILES.has(p) || p === 'docs/日志/快照/代码知识库.md'
    input.kp.kps[0].target = 'SNAP'
    expect(codes(auditDocMap(input))).not.toContain('KP-AUTH')
  })
})
