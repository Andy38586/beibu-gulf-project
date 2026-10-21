/**
 * vue-list-keys 自测：下标/时间戳 key 必红，稳定 key 不许误红（同形态阳性对照）。
 *
 * 后半段是空分母（W58）的端到端装置：`main()` 里「拿到 0 份候选就不许报通过」这条只能在
 * 主流程里判，纯函数单测够不着。装置把守卫连同它的两个依赖抄进临时根，并把
 * `lib/collect-candidates.mjs` 换成**固定返回**的桩——要验的是「输入为 0 时守卫怎么收场」，
 * 与 git 能不能跑无关。真 git 的两种情况（合法空集返回 [] / 故障一律 throw 不得伪装空集）
 * 由 `input-set.test.mjs` 单独盯，两处不重复。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { auditVueTemplate } from '../vue-list-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const GUARD_DIR = path.join(ROOT, 'tools/v3-guard')
const read = (...p) => fs.readFileSync(path.join(GUARD_DIR, ...p), 'utf8')

/** 桩：忽略参数，固定返回给定候选（`TS_VUE` 一并导出，免得守卫的 import 落空） */
function collectStub(candidates) {
  return (
    'export const TS_VUE = (rel) => /\\.(ts|vue)$/.test(rel)\n' +
    `export function collectCandidates() { return ${JSON.stringify(candidates)} }\n`
  )
}

function makeRoot(candidates) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w58-vlk-'))
  const write = (rel, content) => {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  write('tools/v3-guard/vue-list-keys.mjs', read('vue-list-keys.mjs'))
  write('tools/v3-guard/lib/input-set.mjs', read('lib', 'input-set.mjs'))
  write('tools/v3-guard/lib/collect-candidates.mjs', collectStub(candidates))
  write('frontend/src/.keep', '')
  return tmp
}

const TMP_ROOTS = []
function root(candidates) {
  const r = makeRoot(candidates)
  TMP_ROOTS.push(r)
  return r
}
afterAll(() => {
  for (const r of TMP_ROOTS) fs.rmSync(r, { recursive: true, force: true })
})

/**
 * 起子进程跑守卫。输出走**文件描述符**而不是管道：受限环境拒绝管道式子进程
 * （`error=EPERM` / `status=null`），管道版会把「根本没跑起来」读成「红了」
 * —— `guard-red-mutation` 头注 1 正是这个坑换来的。
 */
function runGuard(tmpRoot) {
  const out = path.join(tmpRoot, 'guard-out.log')
  const fd = fs.openSync(out, 'w')
  try {
    const r = spawnSync(
      process.execPath,
      [path.join(tmpRoot, 'tools/v3-guard/vue-list-keys.mjs')],
      {
        cwd: tmpRoot,
        stdio: ['ignore', fd, fd],
        timeout: 120000,
      }
    )
    return { code: r.status, output: fs.readFileSync(out, 'utf8') }
  } finally {
    fs.closeSync(fd)
  }
}

describe('vue-list-keys — 列表 key 稳定性（c023）', () => {
  it('@guard-red-sample 下标 key（:key="index"）⇒ 必红', () => {
    const problems = auditVueTemplate(
      'x.vue',
      '<div v-for="(item, index) in list" :key="index">x</div>'
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('含数组下标')
  })

  it('@guard-red-sample 复合键里夹下标（`${item.name}-${index}`）⇒ 必红', () => {
    const problems = auditVueTemplate(
      'x.vue',
      '<div v-for="(issue, index) in list" :key="`${issue.name}-${index}`">x</div>'
    )
    expect(problems).toHaveLength(1)
  })

  it('@guard-red-sample 时间戳/随机数 key ⇒ 必红', () => {
    expect(
      auditVueTemplate('x.vue', '<li v-for="t in todos" :key="Date.now()">x</li>')
    ).toHaveLength(1)
    expect(
      auditVueTemplate('x.vue', '<li v-for="t in todos" :key="Math.random()">x</li>')
    ).toHaveLength(1)
  })

  it('阳性对照：稳定 key（id / 值本身 / name+field 组合）不许红', () => {
    expect(auditVueTemplate('x.vue', '<li v-for="t in todos" :key="t.id">x</li>')).toEqual([])
    expect(auditVueTemplate('x.vue', '<li v-for="key in KEYS" :key="key">x</li>')).toEqual([])
    expect(
      auditVueTemplate(
        'x.vue',
        '<li v-for="(i, index) in list" :key="`${i.name}-${i.field}`">x</li>'
      )
    ).toEqual([])
  })

  it('等价重构不误红：v-for 不带下标参数、或下标未出现在 key 里', () => {
    expect(auditVueTemplate('x.vue', '<li v-for="item in list" :key="item.name">x</li>')).toEqual(
      []
    )
    expect(
      auditVueTemplate('x.vue', '<li v-for="(item, index) in list" :key="item.id">x</li>')
    ).toEqual([])
  })
})

describe('W58 空分母：0 份候选不得报「全部使用稳定 key」', () => {
  it('@guard-red-sample 候选 0 份 ⇒ exit 1，且不得出现「全部使用稳定 key」', () => {
    // 修前（`catch { return [] }` 版 collectVueFiles）这里打印
    // 「[vue-list-keys] OK：0 份含 :key 的 .vue 全部使用稳定 key ✓」并 exit 0。
    const tmpRoot = root([])
    const { code, output } = runGuard(tmpRoot)
    expect(code).toBe(1)
    expect(output).toContain('扫描到 0 个含 :key= 的 .vue 候选文件')
    expect(output).not.toContain('全部使用稳定 key')
  })

  it('阳性对照：同一装置放进 1 份 key 稳定的 .vue ⇒ exit 0 且计入候选数', () => {
    const tmpRoot = root([
      {
        path: 'frontend/src/List.vue',
        text: '<ul><li v-for="t in todos" :key="t.id">{{ t.name }}</li></ul>\n',
      },
    ])
    const { code, output } = runGuard(tmpRoot)
    expect(code).toBe(0)
    expect(output).toContain('OK：1 份含 :key 的 .vue 全部使用稳定 key')
  })

  it('装置能分辨真违例：1 份下标 key ⇒ exit 1 且报「列表 key 不稳定」', () => {
    const tmpRoot = root([
      {
        path: 'frontend/src/Bad.vue',
        text: '<ul><li v-for="(t, i) in todos" :key="i">{{ t.name }}</li></ul>\n',
      },
    ])
    const { code, output } = runGuard(tmpRoot)
    expect(code).toBe(1)
    expect(output).toContain('列表 key 不稳定')
  })
})
