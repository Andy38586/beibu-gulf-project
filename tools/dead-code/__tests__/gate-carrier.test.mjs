import { describe, expect, it } from 'vitest'

import {
  gateCarrierPredicate,
  gateCarrierPredicateFromRepo,
  isGateCarrierExport,
  scan,
} from '../scan.mjs'

describe('G 类门禁载体判别（从契约快照派生，不手抄名单）', () => {
  it('镜像契约语义：base 不分大小写、允许 \\w* 前缀、且认本体名（与 gen-api-contract 的两条 regex 同款）', () => {
    // 合成名 zzFoo/zzBarBaz：不得用真实导出名当字符串字面量（连注释里都不行）——
    // 扫描器按标识符计数且不区分注释，真名一旦出现在本文件就会把那个导出挤出死物池
    // （实测踩过：注释里的真名让对应类型凭空获得"外部引用"）
    const p = gateCarrierPredicate({ schemas: { zzFooSchema: {}, zzBarBazSchema: {} } })
    expect(p('ZzFooParsed')).toBe(true) // zzFooSchema → ZzFooParsed（'i' 标志）
    expect(p('zzFooParsed')).toBe(true) // 同一契约关系的另一种记法 ⇒ 同样命中
    expect(p('LegacyZzFooParsed')).toBe(true) // \w* 前缀（契约同款容忍）
    expect(p('zzFooSchema')).toBe(true) // 本体：^export const (\w+Schema) 提取的那个名字
    expect(p('zzBarBazSchema')).toBe(true) // 本体同样命中（每个登记 schema 都要）
    expect(p('zzQuxSchema')).toBe(false) // 未登记进快照的 *Schema 不是载体（漏跑 types:gen 的假 schema 照常落账）
    expect(p('ZzQuxParsed')).toBe(false) // 无对应 schema ⇒ 孤儿，不许吞
    expect(p('Parsed')).toBe(false)
    expect(p('ZzFoo')).toBe(false)
  })

  it('🔴 @guard-red-sample 归属两道闸：名字在快照内 **且** 声明落在契约源文件', () => {
    const p = gateCarrierPredicate({ schemas: { zzFooSchema: {} } })
    const entry = (file, name) => ({ file, name, kind: 'const', line: 1 })
    const SCHEMAS = 'frontend/src/types/schemas.ts'
    expect(isGateCarrierExport(entry(SCHEMAS, 'zzFooSchema'), p)).toBe(true) // 本体，登记在快照
    expect(isGateCarrierExport(entry(SCHEMAS, 'zzFooParsed'), p)).toBe(true) // 配对类型
    // 第二道闸：换个文件写同名导出不是载体 —— 全仓「以 Schema 结尾」不构成豁免口
    expect(isGateCarrierExport(entry('frontend/src/types/fake.ts', 'zzFooSchema'), p)).toBe(false)
    // 第一道闸：不在快照内的 *Schema 不是载体（漏跑 types:gen 的假 schema 照常落账）
    expect(isGateCarrierExport(entry(SCHEMAS, 'zzQuxSchema'), p)).toBe(false)
    expect(isGateCarrierExport(entry(SCHEMAS, 'zzQuxParsed'), p)).toBe(false)
    // 快照缺失（谓词 null）⇒ 一律不归 G 类，宁可误报也不静默吞
    expect(isGateCarrierExport(entry(SCHEMAS, 'zzFooSchema'), null)).toBe(false)
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
      // 本体 `*Schema` 与配对 `*Parsed` 都在 G 类；`*Schema` 本体原先被 hits>1 归进
      // redundantExport（账上恒 3 项），本笔把它纳入 G 类 ⇒ 冗余导出账 3 → 0。
      expect(gateCarrier.every((e) => /(Parsed|Schema)$/i.test(e.name))).toBe(true)
      expect(gateCarrier.filter((e) => /Schema$/i.test(e.name)).length).toBeGreaterThan(0)
      expect(gateCarrier.every((e) => e.file === 'frontend/src/types/schemas.ts')).toBe(true)
    }
  )

  it('真实仓库：快照可读 ⇒ 判别函数可用（不可用时 scan 的 A 账会含 Parsed，ratchet 基线会拦）', () => {
    expect(gateCarrierPredicateFromRepo()).not.toBe(null)
  })
})
