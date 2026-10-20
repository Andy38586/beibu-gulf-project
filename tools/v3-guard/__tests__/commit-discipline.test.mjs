// @vitest-environment node
/**
 * 「fix/refactor 须附测试」判据域（03 §1.6）与两侧口径一致性。
 *
 * 治的是「门禁在跑，但判据域漏了整整一个顶层目录」：`.husky/pre-push` 第 12 步与
 * `.github/workflows/ci.yml` 的 commit-discipline job 都只认 `frontend/src|backend`
 * ⇒ `tools/` 下 116 个实现文件 + 80 个 `.test.mjs` 在该检查里**两边都数成 0**。
 * 后果不是"少查一点"，而是判据恒真：一次只改 tools/ 实现的 `fix:` 提交，该检查以
 * 「src 没改」为由静默通过 —— 本仓最该被它检查的那类提交（守卫本体）恰好全程免检。
 *
 * 同一个盲区还有第二面：impl 面剔测试用的 `\.(test|spec)\.` 与 test 面的
 * `\.(test|spec)\.(ts|js|vue)$` 是**两份手写正则**，而后端 e2e 记法是
 * `backend/test/task.e2e-spec.ts`（`-spec.`，不是 `.spec.`）⇒ 该文件被 impl 面收下、
 * 又被 test 面拒收，「只改 e2e 测试」的提交会被判成「改实现却没附测试」。
 * ⇒ 本判据要求两侧各自只有一份测试正则，impl 面剔测试也复用它（禁止写第二份）。
 *
 * 为什么断言的是"两个站点 + 分类矩阵"而不是 grep 某一串字面量：
 * 前者管的是判据域（哪些路径算实现/算测试），后者只能证明"这行还在"。
 *
 * 变量名不进判据（变异第三式：等价重构不许红）：本文件**按行为**找那两条正则
 * ——哪条匹配测试探针、哪条匹配实现探针——再问「剔测试那步用的是不是同一个变量」。
 * 把 `test_re` 改名成 `testRe` 属于等价重构，两侧同改即绿；把剔除管道换成手写
 * 第二份正则才红。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const HOOK = '.husky/pre-push'
const CI = '.github/workflows/ci.yml'
const SITES = [HOOK, CI]

/** 探针：用来按行为分辨两条正则，而不是靠变量名 */
const IMPL_PROBE = 'tools/v3-guard/owned-layers.mjs'
const TEST_PROBE = 'tools/v3-guard/__tests__/owned-layers.test.mjs'

function read(rel) {
  return readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')
}

/** 站点里所有 `name='regex'` 单引号赋值（判据域的唯一真相源就在这两行） */
function assignments(text) {
  return [...text.matchAll(/^\s*([A-Za-z_]\w*)='([^']+)'\s*$/gm)].map((m) => ({
    name: m[1],
    src: m[2],
  }))
}

function safeTest(src, path) {
  try {
    return new RegExp(src).test(path)
  } catch {
    return false
  }
}

/**
 * 按行为抽出实现面/测试面两条正则（各连带变量名）。
 * 测试正则 = 命中 TestProbe 的那条；实现正则 = 命中 ImplProbe 且不命中 TestProbe 的那条。
 */
export function extractRes(text) {
  const all = assignments(text)
  // 测试面 = 命中测试探针、但**不**命中实现探针的那条（impl 正则天生也命中测试文件，
  // 靠后续的减法把测试剔出实现面，所以这里不能用「谁匹配测试探针」单独判）。
  const test = all.find((a) => safeTest(a.src, TEST_PROBE) && !safeTest(a.src, IMPL_PROBE)) ?? null
  const impl = all.find((a) => a !== test && safeTest(a.src, IMPL_PROBE)) ?? null
  return { impl: impl?.src ?? null, test: test?.src ?? null, testName: test?.name ?? null }
}

/**
 * 分类矩阵：每行 [路径, 期望算实现, 期望算测试]。
 * 期望值写的是**业务口径**（这文件在语义上是什么），不是"正则现在怎么判"。
 */
export const MATRIX = [
  // tools/ 实现面 —— 本轮扩面的主因
  ['tools/v3-guard/owned-layers.mjs', true, false],
  ['tools/metrics/derive-status.mjs', true, false],
  ['tools/db/db-import.mjs', true, false],
  ['scripts/x.cjs', false, false], // scripts/ 未纳入：不在本轮裁决范围
  // tools/ 测试面 —— 80 个 .test.mjs 此前两边都数成 0
  ['tools/v3-guard/__tests__/owned-layers.test.mjs', false, true],
  ['tools/metrics/__tests__/derive-status.test.mjs', false, true],
  ['tools/coverage-ratchet.test.mjs', false, true],
  // 后端实现面
  ['backend/src/modules/task/task.service.ts', true, false],
  ['backend/src/app.module.ts', true, false],
  // 后端 e2e 用 '-spec.' 记法：必须算测试，不得算实现（第二面）
  ['backend/test/task.e2e-spec.ts', false, true],
  ['backend/test/auth.spec.ts', false, true],
  ['backend/test/task.service.spec.ts', false, true],
  // 后端 test/ 下的非测试夹具
  ['backend/test/seed/ci-seed.sh', false, false],
  // 前端
  ['frontend/src/core/map/MapRenderer.ts', true, false],
  ['frontend/src/core/map/MapRenderer.test.ts', false, true],
  ['frontend/src/core/map/MapRenderer.spec.ts', false, true],
  ['frontend/src/core/map/__tests__/cesiumMock.ts', true, false], // 无 test/spec 标记 = 辅助件
  // 前端 Playwright（顶层 e2e/，不在 impl 面内）
  ['frontend/e2e/smoke.spec.ts', false, true],
  // 非代码文件
  ['docs/日志/状态/接力状态.md', false, false],
  ['package.json', false, false],
  ['tools/metrics/evidence.json', false, false],
]

/**
 * 复刻站点里那条管道的语义：`src_changed = impl_re 命中 且 test_re 不命中`
 * （shell 侧是 `grep -E "$impl_re" | grep -vE "$test_re"`）。
 * 两个正则**不是**互斥集合 —— 测试文件天生同时命中 impl_re，靠这条减法才被剔出实现面。
 */
function classOf(path, { impl, test }) {
  const isTest = safeTest(test, path)
  const isImpl = safeTest(impl, path) && !isTest
  return [isImpl, isTest]
}

describe('fix/refactor 须附测试：判据域（03 §1.6）', () => {
  it('@guard-red-sample 两个强制点都声明了实现面/测试面两条正则', () => {
    for (const rel of SITES) {
      const { impl, test } = extractRes(read(rel))
      expect(impl, `${rel} 找不到实现面正则`).toBeTruthy()
      expect(test, `${rel} 找不到测试面正则`).toBeTruthy()
    }
  })

  it('@guard-red-sample 两侧判据域逐字一致（本地与 CI 不得有两套口径）', () => {
    const [a, b] = SITES.map((rel) => extractRes(read(rel)))
    expect(a.impl, '实现面两侧分叉：本地与 CI 会对同一笔提交给出不同结论').toBe(b.impl)
    expect(a.test, '测试面两侧分叉').toBe(b.test)
  })

  it('@guard-red-sample 分类矩阵：每个路径的实现/测试归属都符合业务口径', () => {
    for (const rel of SITES) {
      const re = extractRes(read(rel))
      const wrong = MATRIX.filter(([p, isImpl, isTest]) => {
        const [gotImpl, gotTest] = classOf(p, re)
        return gotImpl !== isImpl || gotTest !== isTest
      }).map(([p, isImpl, isTest]) => {
        const [gotImpl, gotTest] = classOf(p, re)
        return `${p}：期望 实现=${isImpl}/测试=${isTest}，实际 实现=${gotImpl}/测试=${gotTest}`
      })
      expect(wrong, `${rel} 分类错误：\n  ${wrong.join('\n  ')}`).toEqual([])
    }
  })

  it('@guard-red-sample impl 面剔测试必须复用同一个测试正则，不得手写第二份', () => {
    for (const rel of SITES) {
      const text = read(rel)
      const { testName } = extractRes(text)
      expect(testName, `${rel} 找不到测试面正则的变量名`).toBeTruthy()
      // 剔除管道里必须引用共享的那份（变量名按行为找出，改名不影响本条）
      const srcLine = text.split(/\r?\n/).find((l) => l.includes('src_changed='))
      expect(srcLine, `${rel} 找不到 src_changed 声明`).toBeTruthy()
      expect(srcLine, `${rel} 的 src_changed 没有复用测试面正则 $${testName}`).toContain(
        `$${testName}`
      )
      // 不得出现第二份手写的测试正则（本轮就栽在两份口径）
      const handWritten = text
        .split(/\r?\n/)
        .filter((l) => l.includes('src_changed=') && /grep -vE '\\?\.\(test/.test(l))
      expect(
        handWritten,
        `${rel} 的 src_changed 行手写了第二份测试正则：\n${handWritten.join('\n')}`
      ).toEqual([])
    }
  })

  it('@guard-red-sample tools/ 实现面必须被收下（否则本仓守卫改动全程免检）', () => {
    for (const rel of SITES) {
      const [gotImpl] = classOf(IMPL_PROBE, extractRes(read(rel)))
      expect(gotImpl, `${rel} 仍不收 tools/ 实现面 —— 该检查对守卫本体恒真`).toBe(true)
    }
  })
})
