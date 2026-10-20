import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { collectCandidates } from '../lib/collect-candidates.mjs'
import { emptyInputProblem } from '../lib/input-set.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * 装置说明：空分母这件事**只能在主流程里判**——`emptyInputProblem()` 单独拿出来永远
 * 返回一个字符串或 null，看不出「守卫有没有在 0 输入时红」。所以端到端用例把守卫文件
 * 连同它的依赖抄进一个临时根（守卫按 `../..` 反推仓库根，抄对层级即换根），
 * 再故意让它的扫描面为空。
 */
function makeRoot(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w58-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return tmp
}

const GUARD_SRC = (name) =>
  fs.readFileSync(path.join(ROOT, 'tools/v3-guard', `${name}.mjs`), 'utf8')
const LIB_SRC = (name) =>
  fs.readFileSync(path.join(ROOT, 'tools/v3-guard/lib', `${name}.mjs`), 'utf8')

/** 起子进程跑守卫；非零退出不抛，返回 {code, output} */
function runGuard(root, name) {
  let code = 0
  let output = ''
  try {
    output = execFileSync('node', [path.join(root, 'tools/v3-guard', `${name}.mjs`)], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    code = err.status ?? -1
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  return { code, output }
}

const TMP_ROOTS = []
function root(files) {
  const r = makeRoot(files)
  TMP_ROOTS.push(r)
  return r
}
afterAll(() => {
  for (const r of TMP_ROOTS) fs.rmSync(r, { recursive: true, force: true })
})

describe('emptyInputProblem：空输入的统一口径', () => {
  it('非空 ⇒ 返回 null（调用方原样继续）', () => {
    expect(emptyInputProblem(1, { what: 'controller', hint: 'x' })).toBeNull()
    expect(emptyInputProblem(37, { what: 'controller', hint: 'x' })).toBeNull()
  })

  it('0 ⇒ 文案同时说明「0 个什么」「不能报通过」「查哪里」三件事', () => {
    // 只钉承重三段（条数 / 对象名 / 该查哪里），不钉措辞——措辞是等价可改的，
    // 钉死措辞会让一次同义改写误红（AGENTS §5.3 第三式：等价重构不许红）。
    const msg = emptyInputProblem(0, {
      what: 'controller',
      hint: 'backend/src/modules/*/controllers',
    })
    expect(msg).toContain('0 个controller')
    expect(msg).toContain('backend/src/modules/*/controllers')
    expect(msg).not.toBeNull()
  })
})

describe('W58 空分母：0 输入不得报「全部满足」', () => {
  // @guard-red-sample 红样：nest-controllers 的扫描面置空 ⇒ 修前打印「三面契约均满足 ✓」exit 0
  it('nest-controllers 扫到 0 个 controller ⇒ exit 1，且不得出现「均满足」', () => {
    const r = root({
      'tools/v3-guard/nest-controllers.mjs': GUARD_SRC('nest-controllers'),
      'tools/v3-guard/lib/input-set.mjs': LIB_SRC('input-set'),
      // backend/src/modules 存在但一个模块都没有 = 目录改名/扫描面失效的真实形态
      'backend/src/modules/.keep': '',
    })
    const { code, output } = runGuard(r, 'nest-controllers')
    expect(code).toBe(1)
    expect(output).toContain('扫描到 0 个controller')
    expect(output).not.toContain('均满足')
  })

  it('阳性对照：同一装置放进一个合规 controller ⇒ exit 0（证明上一条红的是空分母，不是装置）', () => {
    const r = root({
      'tools/v3-guard/nest-controllers.mjs': GUARD_SRC('nest-controllers'),
      'tools/v3-guard/lib/input-set.mjs': LIB_SRC('input-set'),
      // 路径与 CONTROLLER_FACE 登记一致（needAuth=false / skipAuthBuckets=true），
      // 否则红的是公开面不符、不是空分母，阳性对照就失去意义。
      'backend/src/modules/task/controllers/task.controller.ts':
        'import { Controller, Get, SkipThrottle } from "@nestjs/common"\n' +
        '@Controller("task")\n@SkipThrottle()\nexport class TaskController {\n' +
        '  @Get()\n  list() {\n    return []\n  }\n}\n',
      'backend/src/modules/task/task.module.ts': 'export class TaskModule {}\n',
    })
    const { code, output } = runGuard(r, 'nest-controllers')
    expect(output).toContain('扫描 1 个 controller')
    expect(code).toBe(0)
  })

  // @guard-red-sample 红样：cruise-coverage 的目录集合置空 ⇒ 修前打印「规则集合 == 目录集合 ✓」exit 0
  it('cruise-coverage 扫到 0 个 business 目录 ⇒ exit 1，且不得出现「== 目录集合 ✓」', () => {
    const r = root({
      'tools/v3-guard/cruise-coverage.mjs': GUARD_SRC('cruise-coverage'),
      'tools/v3-guard/lib/input-set.mjs': LIB_SRC('input-set'),
      'frontend/src/business/.keep': '',
      '.dependency-cruiser.cjs': 'module.exports = { forbidden: [] }\n',
    })
    const { code, output } = runGuard(r, 'cruise-coverage')
    expect(code).toBe(1)
    expect(output).toContain('扫描到 0 个business 模块目录')
    expect(output).not.toContain('== 目录集合 ✓')
  })

  it('阳性对照：放进一个目录 + 对应规则 ⇒ exit 0', () => {
    const r = root({
      'tools/v3-guard/cruise-coverage.mjs': GUARD_SRC('cruise-coverage'),
      'tools/v3-guard/lib/input-set.mjs': LIB_SRC('input-set'),
      'frontend/src/business/flood-analysis/.keep': '',
      '.dependency-cruiser.cjs':
        'module.exports = { forbidden: [{ name: "business-cross-import-flood-analysis",' +
        ' from: { path: "^frontend/src/business/flood-analysis/" } },' +
        '{ name: "core-not-import-services", from: { path: "^frontend/src/core/" } },' +
        '{ name: "services-not-import-core", from: { path: "^frontend/src/services/" } },' +
        '{ name: "core-imports-business", from: { path: "^frontend/src/core/" } },' +
        '{ name: "services-imports-business", from: { path: "^frontend/src/services/" } },' +
        '{ name: "shared-not-import-core", from: { path: "^frontend/src/shared/" } }] }\n',
    })
    const { code, output } = runGuard(r, 'cruise-coverage')
    expect(output).toContain('business 目录 1 个')
    expect(code).toBe(0)
  })
})

describe('collectCandidates：git 故障不得伪装成 0 命中', () => {
  it('合法空集（git grep exit 1）⇒ 返回 []', () => {
    const r = root({
      'a.ts': 'const x = 1\n',
    })
    execFileSync('git', ['init', '-q'], { cwd: r })
    execFileSync('git', ['add', '-A'], { cwd: r })
    const files = collectCandidates({
      root: r,
      tokens: ['这个词在仓库里不存在'],
      pathspecs: ['.'],
      accept: (rel) => /\.ts$/.test(rel),
    })
    expect(files).toEqual([])
  })

  it('不在 git 仓库里（git grep exit 128）⇒ throw，不得返回空集', () => {
    // 用「非仓库目录」而不是「坏 pathspec」：实测坏 pathspec 也是 exit 1（与无命中同码），
    // 拿它当负样本会造出一条永远绿的假判据。
    const r = root({ 'a.ts': 'const x = 1\n' })
    expect(() =>
      collectCandidates({
        root: r,
        tokens: ['x'],
        pathspecs: ['.'],
        accept: (rel) => /\.ts$/.test(rel),
      })
    ).toThrow(/不是「0 命中」/)
  })
})
