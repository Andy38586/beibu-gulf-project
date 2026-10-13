// @vitest-environment node
/**
 * 重复表达式扫描器的自测。
 *
 * 钉四件事：
 *   1) 词法器把注释/字符串/模板串处理对（不然 token 序列不稳，判据就成了噪声源）；
 *   2) 平衡括号组**带前置成员链**（`Math.sin(...)` 而不是裸 `(...)`）；
 *   3) `scanTexts` 检得出重复、过滤得掉单次与过短片段；
 *   4) **阳性对照：推动 S2 转向的那个案例**（呼吸脉动公式）必须被检出 ——
 *      这是本判据存在的理由，检不出就说明判据量的和动机不是同一个东西。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MIN_TOKENS,
  balancedGroups,
  codeOf,
  compareToBaseline,
  isNamedCallRepetition,
  scanTexts,
  tokenize,
} from '../scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('dup-scan — 重复表达式判据', () => {
  it('词法器：注释与字符串不进 token 流', () => {
    const t = ['// renderer.removeLayer(key)', "const s = 'manager.register(k)'", 'go()'].join('\n')
    expect(tokenize(t).map((x) => x.text)).toEqual([
      'const',
      's',
      '=',
      "'manager.register(k)'",
      'go',
      '(',
      ')',
    ])
  })

  it('词法器：模板串整段算一个 token（不展开 ${}，避免把表达式切碎造成假重复）', () => {
    const toks = tokenize('const c = `rgba(${r}, ${g})`')
    expect(toks.map((x) => x.text)).toEqual(['const', 'c', '=', '`rgba(${r}, ${g})`'])
  })

  it('平衡括号组带前置成员链：Math.sin(elapsed * Math.PI * 2)', () => {
    const src = 'const v = Math.sin(elapsed * Math.PI * 2)'
    const texts = balancedGroups(tokenize(src)).map((g) => g.text)
    expect(texts).toContain('Math . sin ( elapsed * Math . PI * 2 )')
  })

  it('codeOf：.vue 只取 <script> 块（<style> 里的 var(--GCS-…) 不算债）', () => {
    const vue = [
      '<template><div :style="x" /></template>',
      '<script setup lang="ts">',
      'const a = 1',
      '</script>',
      '<style scoped>',
      '.x { color: var(--GCS-color-primary) }',
      '</style>',
    ].join('\n')
    const code = codeOf(vue, '.vue')
    expect(code).toContain('const a = 1')
    expect(code).not.toContain('GCS-color-primary')
  })

  it('@red-sample 阳性对照：呼吸脉动公式 ×2 ⇒ 必被检出（S2 转向的动机案例）', () => {
    const body = [
      'const breathing = () => {',
      '  const elapsed = (Date.now() - startTime) / 1000',
      '  return 10 + Math.sin(elapsed * Math.PI * 2) * 5',
      '}',
      'const breathing2 = () => {',
      '  const elapsed = (Date.now() - startTime) / 1000',
      '  return 10 + Math.sin(elapsed * Math.PI * 2) * 5',
      '}',
    ].join('\n')
    const { groups } = scanTexts([{ relPath: 'a.ts', text: body }])
    const hit = groups.find((g) => g.text === 'Math . sin ( elapsed * Math . PI * 2 )')
    expect(hit, '公式重复必须被检出，否则判据抓不到它存在的理由').toBeDefined()
    expect(hit.count).toBeGreaterThanOrEqual(2)
  })

  it('只出现一次 / 短于 MIN_TOKENS ⇒ 不检出（阳性对照：判据不是恒有输出）', () => {
    const once = [{ relPath: 'a.ts', text: 'Math.sin(elapsed * Math.PI * 2)' }]
    expect(scanTexts(once).groups).toEqual([])
    const short = [
      { relPath: 'a.ts', text: 'logger.debug(msg)\nlogger.debug(msg)' },
      { relPath: 'b.ts', text: 'logger.debug(msg)' },
    ]
    expect(scanTexts(short).groups).toEqual([])
    expect(MIN_TOKENS).toBeGreaterThan(6)
  })

  it('跨文件重复 ⇒ 检出并列出两侧文件', () => {
    const line = 'features.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))'
    const { groups } = scanTexts([
      { relPath: 'frontend/src/a.ts', text: line },
      { relPath: 'backend/src/b.ts', text: line },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].files).toEqual(['frontend/src/a.ts', 'backend/src/b.ts'])
    expect(groups[0].redundantTokens).toBe(groups[0].tokenCount)
  })

  it('compareToBaseline：上升 / 下降 / 持平 都据实报，且不判非零', () => {
    const base = { totalGroups: 10, totalRedundantTokens: 100 }
    const up = compareToBaseline({ totalGroups: 12, totalRedundantTokens: 130 }, base)
    expect(up.deltaGroups).toBe(2)
    expect(up.deltaTokens).toBe(30)
    expect(compareToBaseline({ totalGroups: 8, totalRedundantTokens: 90 }, base).deltaGroups).toBe(
      -2
    )
    expect(
      compareToBaseline({ totalGroups: 10, totalRedundantTokens: 100 }, base).deltaTokens
    ).toBe(0)
    // 无基线时不编造 delta
    expect(
      compareToBaseline({ totalGroups: 10, totalRedundantTokens: 100 }, null).deltaGroups
    ).toBeNull()
  })

  it('基线文件与工具同源且字段齐全（防止基线被手改成别的形状）', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(HERE, '../baseline.json'), 'utf8'))
    expect(baseline.generatedFrom).toBe('tools/dup/scan.mjs')
    expect(baseline.minTokens).toBe(MIN_TOKENS)
    expect(typeof baseline.totalGroups).toBe('number')
    expect(typeof baseline.totalRedundantTokens).toBe('number')
    // D5 降权后新增两字段：基线必须带，否则降权口径与基线不同源
    expect(typeof baseline.callSiteGroups).toBe('number')
    expect(typeof baseline.callSiteTokens).toBe('number')
  })
})

describe('D5 降权 — 具名调用重复不计冗余（防指标惩罚正确的共享）', () => {
  it('@guard-red-sample 同一具名调用重复 ⇒ 判为降权，冗余 token 记 0', () => {
    // 注意 fixture 长度：内层调用须 ≥ MIN_TOKENS，否则进不了组，
    // 测的就不是降权而是"没检出"（一次实测踩过：10 tok 的 isStaleToken 三参形态被 MIN 挡掉）
    const line = 'isStaleToken(renderer._geoJsonTokens, layerId, requestToken, options)\n'
    const r = scanTexts([{ relPath: 'x.ts', text: line + line }])
    expect(r.totalGroups).toBeGreaterThan(0)
    expect(r.callSiteGroups).toBeGreaterThan(0)
    expect(r.totalRedundantTokens).toBe(0)
  })

  it('🔴 成员链调用但**参数含 lambda** ⇒ 不降权（被重复的是参数里的逻辑，属真重复）', () => {
    const line = 'const e = layerCatalog.value.find((x) => x.key === key)\n'
    const r = scanTexts([
      { relPath: 'a.ts', text: line },
      { relPath: 'b.ts', text: line },
    ])
    expect(r.callSiteGroups).toBe(0)
    expect(r.totalRedundantTokens).toBeGreaterThan(0)
  })

  it('🔴 含块结构的重复**不得**被降权（否则真重复被洗白）', () => {
    const block =
      'const c = computed(() => { if (!props.series || props.series.length === 0) return false; return true })\n'
    const r = scanTexts([
      { relPath: 'BarChart.vue', text: block },
      { relPath: 'LineChart.vue', text: block },
    ])
    expect(r.callSiteGroups).toBe(0)
    expect(r.totalRedundantTokens).toBeGreaterThan(0)
  })

  it('🔴 接口/参数表等非调用形态不得被降权', () => {
    expect(isNamedCallRepetition('export interface TaskView { taskId : string }')).toBe(false)
    expect(
      isNamedCallRepetition('( adapterFn : ( ) => Promise < T > , transactionId : number )')
    ).toBe(false)
    expect(isNamedCallRepetition('if ( ! Number . isFinite ( v ) || v < 0 || v > 1 )')).toBe(false)
  })
})
