/**
 * vue-list-keys 自测：下标/时间戳 key 必红，稳定 key 不许误红（同形态阳性对照）。
 */
import { describe, expect, it } from 'vitest'

import { auditVueTemplate } from '../vue-list-keys.mjs'

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
