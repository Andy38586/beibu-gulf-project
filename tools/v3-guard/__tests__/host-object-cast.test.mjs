/**
 * host-object-cast 自测：双断言写宿主属性必红；注释/测试夹具/只读探针不许误红（z043）。
 */
import { describe, expect, it } from 'vitest'

import { auditHostObjectCasts, stripComments } from '../host-object-cast.mjs'

const PROD = 'frontend/src/core/map/renderers/CesiumRenderer.ts'
const run = (path, text) => auditHostObjectCasts([{ path, text }])

describe('host-object-cast — 禁 as unknown as 写宿主对象属性（z043/d134）', () => {
  it('@guard-red-sample d134 同形态（(scene as unknown as {x}).x = 4）⇒ 必红', () => {
    const problems = run(
      PROD,
      'const scene = viewer.scene\n;(scene as unknown as { maximumScreenSpaceError: number }).maximumScreenSpaceError = 4\n'
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('往宿主对象写属性')
    expect(problems[0]).toContain(':2')
  })

  it('@guard-red-sample 自增/自减也算写 ⇒ 必红', () => {
    expect(run(PROD, ';(obj as unknown as { n: number }).n++\n')).toHaveLength(1)
    expect(run(PROD, ';(obj as unknown as { n: number }).n--\n')).toHaveLength(1)
  })

  it('阳性对照：只读/可调用探针（不写属性）不许红', () => {
    expect(
      run(
        PROD,
        ';(renderer as unknown as { clearPendingVisibility?: (id: string) => void })?.clearPendingVisibility?.(key)\n'
      )
    ).toEqual([])
    expect(run(PROD, 'const v = (x as unknown as { a: number }).a\n')).toEqual([])
  })

  it('阳性对照：注释里的同形态不许红（历史注释就写着那条实锤）', () => {
    expect(
      run(PROD, '// 此前 (scene as unknown as {...}).maximumScreenSpaceError = 4 实为无效\n')
    ).toEqual([])
    expect(stripComments('/* (a as unknown as {b}).b = 1 */\n')).not.toContain('as unknown as')
  })

  it('阳性对照：测试夹具给 mock 挂属性不属生产面（__tests__ 路径跳过）', () => {
    expect(
      run(
        'frontend/src/core/map/__tests__/BusinessLayerManager.test.ts',
        ';(renderer as unknown as { addPointLayer: unknown }).addPointLayer = vi.fn()\n'
      )
    ).toEqual([])
  })

  it('声明扩展面是允许的替代（declare global / interface Window）', () => {
    expect(
      run(
        PROD,
        'declare global {\n  interface Window {\n    __perf?: Api\n  }\n}\nwindow.__perf = api\n'
      )
    ).toEqual([])
  })
})
