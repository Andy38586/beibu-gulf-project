// @vitest-environment node
/**
 * 空模块判据的自测（PZ-1 回归闸）。
 *
 * 治的是「删剩一个壳」：文件里所有 import 都被摘掉，只剩 `export {}` 撑着不报错。
 * 原扫描器两条栏位（导出声明 / 引用统计）都不看这类文件，于是它一格都不占。
 *
 * 钉四件事：
 *   1) 只有 `export {}`（可带注释与空行）⇒ 判空模块；
 *   2) 还有任何其它语句 ⇒ 不是空模块（不许把正常文件判成债）；
 *   3) 生成件 `*.d.ts` 与 barrel `index.ts` ⇒ 豁免（它们本就可能是这个形态）；
 *   4) 判据从**真实文件路径**出发，不吃外部状态。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isEmptyModule, scan } from '../scan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('dead-code 空模块判据', () => {
  it('@guard-red-sample 只剩 export {} ⇒ 判空模块', () => {
    expect(isEmptyModule('frontend/src/views/index.tsx', 'export {}\n')).toBe(true)
    expect(isEmptyModule('frontend/src/foo.ts', 'export {};\n')).toBe(true)
  })

  it('带注释与空行的 export {} ⇒ 仍判空模块（注释不是内容）', () => {
    const text = `/**\n * 这个文件曾经有 12 个导出，逐个迁走后只剩这一行。\n */\n\n// 保留路径以免 import 路径变动\nexport {}\n`
    expect(isEmptyModule('frontend/src/legacy.ts', text)).toBe(true)
  })

  it('还有任何其它语句 ⇒ 不是空模块', () => {
    expect(isEmptyModule('frontend/src/a.ts', 'export {}\nexport const x = 1\n')).toBe(false)
    expect(isEmptyModule('frontend/src/b.ts', 'export {}\nconst helper = () => 1\n')).toBe(false)
  })

  it('生成件 *.d.ts ⇒ 豁免（unplugin 产出的声明件本就可能只留 export {}）', () => {
    expect(isEmptyModule('frontend/auto-imports.d.ts', 'export {}\n')).toBe(false)
  })

  it('barrel index.ts ⇒ 豁免（空转发不属本类，另有 barrel 口径）', () => {
    expect(isEmptyModule('frontend/src/shared/index.ts', 'export {}\n')).toBe(false)
  })

  it('非空内容但无 export 语句（如 main.ts 入口）⇒ 不是空模块', () => {
    expect(
      isEmptyModule('frontend/src/main.ts', "import { createApp } from 'vue'\ncreateApp({})\n")
    ).toBe(false)
  })

  // ── 接线：纯函数判对不等于线上算得出来 ─────────────────────────────────
  it('@guard-red-sample 接线：scan() 的 emptyModules 栏必须存在且与真实仓库一致', () => {
    const r = scan()
    // 栏位本身要存在 —— 否则「接线被摘」时上层只看到 undefined，静默当 0
    expect(Array.isArray(r.emptyModules)).toBe(true)
    // 真实仓库当前必须是 0 个（PZ-1 已删 frontend/src/views/index.ts）
    expect(r.emptyModules).toEqual([])
  })

  it('🔴 @guard-red-sample 阳性对照：扫描面里真有一个空模块时，scan() 必须列出来', () => {
    // 负结果不单独成立（AGENTS §5.4）：真实仓库当前是 0 个，
    // 而「算出 0」与「收集那段被停用」在 0 个时表现完全一样。
    // 因此往扫描面里放一个真空模块，证明这条链路是通的，再删掉。
    const probe = path.join(ROOT, 'frontend/test/__pa3_probe__.ts')
    fs.writeFileSync(probe, 'export {}\n')
    try {
      const r = scan()
      expect(r.emptyModules.map((e) => e.file)).toContain('frontend/test/__pa3_probe__.ts')
    } finally {
      fs.rmSync(probe, { force: true })
    }
    // 清理后必须回到 0 —— 证明上面那条不是靠残留文件撑着的
    expect(scan().emptyModules).toEqual([])
  })
})
