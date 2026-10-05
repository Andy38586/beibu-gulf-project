import { describe, expect, it } from 'vitest'

import { gateCarrierPredicate, gateCarrierPredicateFromRepo, scan } from '../scan.mjs'

describe('G 类门禁载体判别（从契约快照派生，不手抄名单）', () => {
  it('镜像契约语义：base 不分大小写、允许 \\w* 前缀（与 gen-api-contract 的判定 regex 同款）', () => {
    // 合成名 zzFoo/zzBarBaz：不得用真实导出名当字符串字面量（连注释里都不行）——
    // 扫描器按标识符计数且不区分注释，真名一旦出现在本文件就会把那个导出挤出死物池
    // （实测踩过：注释里的真名让对应类型凭空获得"外部引用"）
    const p = gateCarrierPredicate({ schemas: { zzFooSchema: {}, zzBarBazSchema: {} } })
    expect(p('ZzFooParsed')).toBe(true) // zzFooSchema → ZzFooParsed（'i' 标志）
    expect(p('zzFooParsed')).toBe(true) // 同一契约关系的另一种记法 ⇒ 同样命中
    expect(p('LegacyZzFooParsed')).toBe(true) // \w* 前缀（契约同款容忍）
    expect(p('ZzQuxParsed')).toBe(false) // 无对应 schema ⇒ 孤儿，不许吞
    expect(p('Parsed')).toBe(false)
    expect(p('ZzFoo')).toBe(false)
  })

  it('缺快照 ⇒ null（降级可见，全部落回 A 类）；空壳快照 ⇒ 全不命中', () => {
    expect(gateCarrierPredicate(null)).toBe(null)
    const p = gateCarrierPredicate({})
    expect(p('ZzFooParsed')).toBe(false)
  })

  // 整仓扫描是 IO 密集型：慢盘（CI 变体/容器挂载盘实测 11s）会撞 vitest 默认 5s 伪红，
  // 显式放宽到 30s；断言语义不变。
  it(
    '真实仓库：三分类互斥且并集完整；G 类全部是 *Parsed 且在 schemas.ts',
    { timeout: 30_000 },
    () => {
      const { dead, redundantExport, gateCarrier } = scan()
      const all = [...dead, ...redundantExport, ...gateCarrier]
      const keys = new Set(all.map((e) => `${e.file}:${e.line}:${e.name}`))
      expect(keys.size).toBe(all.length) // 三分类互斥，无重复计入
      expect(gateCarrier.length).toBeGreaterThan(0) // 当前快照下必有配对类型（防空真）
      const p = gateCarrierPredicateFromRepo()
      // dead 与 G 判别互斥：凡被判"彻底没人用"的，不得同时命中契约配对谓词。
      // （孤儿 Parsed —— schema 已删 —— 落 dead 是对的：快照重生成后谓词不再命中它）
      expect(dead.every((e) => !p(e.name))).toBe(true)
      expect(gateCarrier.every((e) => /Parsed$/i.test(e.name))).toBe(true)
      expect(gateCarrier.every((e) => e.file === 'frontend/src/types/schemas.ts')).toBe(true)
    }
  )

  it('真实仓库：快照可读 ⇒ 判别函数可用（不可用时 scan 的 A 账会含 Parsed，ratchet 基线会拦）', () => {
    expect(gateCarrierPredicateFromRepo()).not.toBe(null)
  })
})
