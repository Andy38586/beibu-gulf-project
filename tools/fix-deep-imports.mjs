// 副-02: shared 外部跨层深路径导入收口为 @/shared 桶入口(01 §五.10)
import fs from 'node:fs'
const files = [
  'frontend/src/visualization/composables/useECharts.ts',
  'frontend/src/visualization/charts/composables/useRadarChart.ts',
  'frontend/src/core/map/renderers/index.ts',
  'frontend/src/core/map/BusinessLayerManager.ts',
  'frontend/src/business/flood-analysis/components/WaterLevelProfilePanel.vue',
  'frontend/src/views/components/PlansPanel.vue',
  'frontend/src/core/layout/components/GCSDebugOverlay.vue',
  'frontend/src/business/flood-analysis/components/AffectedFacilityListPanel.vue',
]
let total = 0
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  const m = t.match(/from '@\/shared\/utils\/[^']+'/g) || []
  if (m.length) {
    const next = t.replace(/from '@\/shared\/utils\/[^']+'/g, "from '@/shared'")
    fs.writeFileSync(f, next, 'utf8')
    total += m.length
    console.log(`${f.replace('frontend/src/', '')}: ${m.length} 处`)
  }
}
console.log(`共收口 ${total} 处`)
