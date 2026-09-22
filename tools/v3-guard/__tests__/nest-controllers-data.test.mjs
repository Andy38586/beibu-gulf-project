import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { auditControllers, listControllers } from '../nest-controllers-data.mjs'

// 构造临时 backend/src/modules 树，避免碰真实仓库
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-ctrl-data-'))
function writeController(rel, content) {
  const p = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

describe('nest-controllers-data：controller 不直读数据文件（z055 承接体）', () => {
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
    const { violations } = auditControllers([f])
    expect(violations).toEqual([])
  })

  it('阳性对照：controller 注入 DataFilesService / 引用 backend/data / readFileSync 必红', () => {
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
    const { violations } = auditControllers([f])
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
})
