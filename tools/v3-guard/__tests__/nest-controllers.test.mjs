import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { auditControllers, listControllers } from '../nest-controllers.mjs'

// 构造临时 backend/src/modules 树，避免碰真实仓库
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-ctrl-data-'))
function writeController(rel, content) {
  const p = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

/**
 * 测试夹具的公开面声明（无装饰器 = 公开且不豁免）。
 * 本套用例只验数据面与参数面；公开面对账由后面专门的用例覆盖 ⇒ 夹具显式声明、不落登记表。
 */
const STUB_FACE = (rel) => [{ file: rel, needAuth: false, skipAuthBuckets: false, why: '测试夹具' }]

describe('nest-controllers：controller 不直读数据文件（z055 承接体）', () => {
  it('列出 modules 各域 controllers 目录的 .controller.ts', () => {
    writeController('backend/src/modules/task/controllers/task.controller.ts', 'export class A {}')
    writeController('backend/src/modules/task/services/task.service.ts', 'export class B {}')
    writeController(
      'backend/src/modules/plans/controllers/plans.controller.ts',
      'export class C {}'
    )
    const files = listControllers(TMP).map((f) => path.relative(TMP, f).replace(/\\/g, '/'))
    expect(files).toEqual([
      'backend/src/modules/plans/controllers/plans.controller.ts',
      'backend/src/modules/task/controllers/task.controller.ts',
    ])
  })

  it('干净 controller 无违例', () => {
    const f = writeController(
      'backend/src/modules/task/controllers/task.controller.ts',
      "import { Controller } from '@nestjs/common'\nexport class A {}\n"
    )
    const { violations } = auditControllers([f], {
      root: TMP,
      face: STUB_FACE('backend/src/modules/task/controllers/task.controller.ts'),
    })
    expect(violations).toEqual([])
  })

  it('@guard-red-sample 阳性对照：controller 注入 DataFilesService / 引用 backend/data / readFileSync 必红', () => {
    const f = writeController(
      'backend/src/modules/flood/controllers/flood.controller.ts',
      [
        "import { readFileSync } from 'node:fs'",
        "import { DataFilesService } from '../../../infra/files/data-files.service'",
        "const P = 'backend/data/flood/flood_levels.json'",
        'readFileSync(P)',
        'constructor(private readonly dataFiles: DataFilesService) {}',
      ].join('\n')
    )
    const { violations } = auditControllers([f], {
      root: TMP,
      face: STUB_FACE('backend/src/modules/flood/controllers/flood.controller.ts'),
    })
    const whys = violations.map((v) => v.why)
    expect(violations.length).toBeGreaterThanOrEqual(4)
    expect(whys.some((w) => w.includes('DataFilesService'))).toBe(true)
    expect(whys.some((w) => w.includes('backend/data'))).toBe(true)
    expect(whys.some((w) => w.includes('node:fs'))).toBe(true)
    expect(whys.some((w) => w.includes('文件读取'))).toBe(true)
    expect(whys.some((w) => w.includes('dataFiles'))).toBe(true)
    // 行号定位到真实位置
    expect(violations.every((v) => v.line >= 1 && v.line <= 5)).toBe(true)
  })

  it('@guard-red-sample @Body 未经 DtoPipe 且不在豁免清单 ⇒ 红（d025 收口）', () => {
    const bare = writeController(
      'backend/src/modules/newwrite/controllers/newwrite.controller.ts',
      "import { Body, Post } from '@nestjs/common'\nexport class C { @Post() m(@Body() body: { a?: unknown }) { return body } }\n"
    )
    const { violations } = auditControllers([bare], {
      root: TMP,
      face: STUB_FACE('backend/src/modules/newwrite/controllers/newwrite.controller.ts'),
    })
    expect(violations.some((v) => v.why.includes('DtoPipe'))).toBe(true)
    expect(violations[0].why).toContain('BODY_VALIDATION_EXEMPTIONS')
  })

  it('阳性对照：@Body 经 DtoPipe 收口 ⇒ 不红（同一形态换写法不误报）', () => {
    const piped = writeController(
      'backend/src/modules/newwrite/controllers/newwrite.controller.ts',
      "import { Body, Post } from '@nestjs/common'\nexport class C { @Post() m(@Body(new DtoPipe(X.parse)) body: X) { return body } }\n"
    )
    expect(
      auditControllers([piped], {
        root: TMP,
        face: STUB_FACE('backend/src/modules/newwrite/controllers/newwrite.controller.ts'),
      }).violations
    ).toEqual([])
  })

  it('@guard-red-sample 新 controller 未登记公开面 ⇒ 红（d026：先做一次显式取舍）', () => {
    const f = writeController(
      'backend/src/modules/brandnew/controllers/brandnew.controller.ts',
      "import { Controller } from '@nestjs/common'\nexport class C {}\n"
    )
    const { violations } = auditControllers([f], { root: TMP, face: [] })
    expect(violations.some((v) => v.why.includes('未登记公开面'))).toBe(true)
  })

  it('@guard-red-sample 登记与实装不符（声明需登录、实装无 @UseGuards）⇒ 红', () => {
    const rel = 'backend/src/modules/brandnew/controllers/brandnew.controller.ts'
    const f = writeController(
      rel,
      "import { Controller } from '@nestjs/common'\nexport class C {}\n"
    )
    const { violations } = auditControllers([f], {
      root: TMP,
      face: [{ file: rel, needAuth: true, skipAuthBuckets: true, why: '夹具' }],
    })
    expect(violations.some((v) => v.why.includes('公开面登记与实装不符'))).toBe(true)
    expect(violations.some((v) => v.why.includes('限流豁免登记与实装不符'))).toBe(true)
  })

  it('阳性对照：登记与实装一致（含注释里提到 @UseGuards 但实装没有）⇒ 不红', () => {
    const rel = 'backend/src/modules/brandnew/controllers/brandnew.controller.ts'
    const f = writeController(
      rel,
      "import { Controller } from '@nestjs/common'\n// 将来要加 @UseGuards，现在没有\nexport class C {}\n"
    )
    expect(
      auditControllers([f], {
        root: TMP,
        face: [{ file: rel, needAuth: false, skipAuthBuckets: false, why: '夹具' }],
      }).violations
    ).toEqual([])
  })
})
