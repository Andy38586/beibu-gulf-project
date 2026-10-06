/**
 * retired-claims 自测：在役口吻的退役词条必红；退役语气 / venv 路径 / 对齐注不误红（z040）。
 */
import { describe, expect, it } from 'vitest'

import { auditRetiredClaims } from '../retired-claims.mjs'

const run = (text, path = 'Dockerfile') => auditRetiredClaims([{ path, text }])

describe('retired-claims — 退役机制不得以在役口吻残留（z040）', () => {
  it('@guard-red-sample 未标记的 FastAPI 在役口吻 ⇒ 必红', () => {
    const problems = run('// 请求转发到 FastAPI 洪涝服务处理\n')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('退役机制以在役口吻残留')
  })

  it('@guard-red-sample 同义改写违约（flood-online 通道仍在用）⇒ 必红', () => {
    expect(run('// flood-online 通道处理在线演算\n')).toHaveLength(1)
    expect(run('RUN 启动 algorithm-service 容器\n')).toHaveLength(1)
  })

  it('阳性对照：带退役/历史标记不红（含跨行注释块）', () => {
    expect(run('// FastAPI 已于 2026-09-10 退役删除\n')).toEqual([])
    expect(
      run(
        '// 本地 dev 下 Vite 把 /api 转发到后端（/flood-online 代理\n' +
          '// 已随 algorithm-service 退役删除）\n'
      )
    ).toEqual([])
    expect(run('// 响应结构逐字段对齐 FastAPI 的 /route/path\n')).toEqual([])
    expect(run('// 取代 backend/algorithm-service 的 networkx 构图\n')).toEqual([])
  })

  it('阳性对照：离线 venv 路径（.venv）不判——路径保留决策见 setup-runtime.ps1', () => {
    expect(
      run(
        'const PY = path.join(ROOT, "backend", "algorithm-service", ".venv", "Scripts", "python.exe")\n'
      )
    ).toEqual([])
  })

  it('等价重构不误红：同义标记（已下线/已迁移/原口径）都放行', () => {
    expect(run('// FastAPI 已下线\n')).toEqual([])
    expect(run('// FastAPI 能力已迁移到 Nest\n')).toEqual([])
    expect(run('// 本次改动基于原 FastAPI 口径\n')).toEqual([])
  })

  it('代码行（非注释）没有标记 ⇒ 必红，注释块的标记不外溢到代码', () => {
    expect(run('const url = "/flood-online/api"\n')).toHaveLength(1)
    expect(run('// FastAPI 已退役\nconst url = "/flood-online/api"\n')).toHaveLength(1)
  })
})
