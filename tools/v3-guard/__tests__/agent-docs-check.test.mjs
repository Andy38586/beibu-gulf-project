import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  checkCommitForm,
  checkLiveDocs,
  checkRefs,
  classify,
  extractCommitExamples,
  extractTokens,
  prefixedRefs,
  stripCommitType,
} from '../agent-docs-check.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const NONE = () => false
const some = (set) => (p) => set.has(p)

describe('agent-docs-check（作业协议自述守卫）', () => {
  it('阳性对照：带目录前缀的断链必须判违规', () => {
    const bad = checkRefs([{ token: 'docs/根基文档/01-项目全景.md', line: 4 }], NONE)
    expect(bad).toHaveLength(1)
    expect(bad[0].why).toContain('不存在')
  })

  it('阳性对照：裸 .md 零命中=断链、多命中=歧义、通用名豁免', () => {
    expect(checkRefs([{ token: '01-项目全景.md', line: 18 }], NONE)).toHaveLength(1)
    const ambiguous = some(new Set(['docs/A.md', 'docs/根基文档/A.md']))
    expect(checkRefs([{ token: 'A.md', line: 1 }], ambiguous)).toHaveLength(1)
    const readmeEverywhere = some(new Set(['README.md', 'docs/README.md']))
    expect(checkRefs([{ token: 'README.md', line: 1 }], readmeEverywhere)).toHaveLength(0)
  })

  it('命令、glob、占位符、npm 包名不当作路径；带斜杠的目录引用要校验存在性', () => {
    for (const t of [
      'npm run typecheck',
      'frontend/src/**/*.{ts,vue}',
      'type(scope): 中文说明',
      '@commitlint/config-conventional',
    ])
      expect(classify(t), t).toBeNull()
    expect(classify('docs/audits/')).toEqual({ kind: 'prefixed', value: 'docs/audits/' })
    expect(checkRefs([{ token: 'docs/nope/', line: 1 }], NONE)).toHaveLength(1)
  })

  it('行号后缀必须先剥，否则真路径会被误判断链', () => {
    expect(classify('tools/db/db-schema.sql:77')).toEqual({
      kind: 'prefixed',
      value: 'tools/db/db-schema.sql',
    })
  })

  it('commit 示例只认「例：」，格式占位符不入样', () => {
    const text = '形式 `type(scope): 中文说明`\n  - 例：`fix(task): 修 forecast-map 域恒 400`\n'
    expect(extractCommitExamples(text)).toEqual([
      { message: 'fix(task): 修 forecast-map 域恒 400', line: 2 },
    ])
  })

  it('协议里没有「例：」示例时报红，而不是静默通过', () => {
    expect(checkCommitForm('# 没有示例的协议\n')).toHaveLength(1)
  })

  it('反向样本剥出的就是裸主题（它必须被 commitlint 拒）', () => {
    expect(stripCommitType('fix(task): 穷尽派生 TASK_DOMAINS')).toBe('穷尽派生 TASK_DOMAINS')
  })

  it('回归锚：现存两份协议文件必须自洽', () => {
    for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
      const entries = extractTokens(fs.readFileSync(path.join(ROOT, rel), 'utf8')).map((e) => ({
        ...e,
        file: rel,
      }))
      expect(checkRefs(entries), rel).toEqual([])
    }
  })

  it('阳性对照：只取仓库根锚定路径，目录名/分层名/分支名不算引用', () => {
    const text = [
      '死路径 `backend/src/nope.ts` 必须被抓',
      '历史留痕 `backend/dead/legacy.js` 已退役，按行豁免',
      '目录 `frontend/src/` 与分层名 `types/` 不算',
      '分支名 `experiment/v3-backend-migration` 不算',
      '相对索引 `根基文档/项目全景.md` 不算（它相对 docs/ 解析）',
    ].join('\n')
    expect(prefixedRefs(text).map((r) => r.token)).toEqual([
      'backend/src/nope.ts',
      'backend/dead/legacy.js',
    ])
    expect(prefixedRefs(text)[1].exempt).toBe(true)
  })

  it('回归锚：全部活文档当前无断链', () => {
    expect(checkLiveDocs()).toEqual([])
  })
})
