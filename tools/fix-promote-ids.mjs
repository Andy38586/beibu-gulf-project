// 修正: open 台账 5 条(b027/z076/z103/z105/d080)用原编号移入已解决, 撤销误分配的新编号
import fs from 'node:fs'
const P = 'docs/已解决问题.md'
let t = fs.readFileSync(P, 'utf8')

// 删除误分配的新编号行(d093/z113/z109/z114/d094)
const wrong = ['d093', 'z113', 'z109', 'z114', 'd094']
for (const id of wrong) {
  const re = new RegExp(`^\\| p[0-3] \\| ${id}[-－][^\\n]*\\n`, 'm')
  const before = t
  t = t.replace(re, '')
  if (t === before) console.log(`⚠️ 未找到误编号行: ${id}`)
  else console.log(`已删除误编号: ${id}`)
}

// 用原编号插入(对应分节末尾)
const insert = {
  后端层: [
    '| p2 | b027-waterLevel传参姿势分裂<br>`discover:20260801`<br>`solve:20260814` | online 模式 level 参数名与 api 模式 waterLevel 分裂（前后端易漂移）。 | 2026-08-14 修复：前端 floodAdapter 两处 params:{level}→{waterLevel}；FastAPI online/impact Query(level)→Query(waterLevel)；test_main.py 9 处查询参数与 API契约文档 §5 同步；flood-service pytest 6/6。',
    '| p2 | d080-plansController直连仓库<br>`discover:20260810`<br>`solve:20260814` | plansController 直接操作 plansRepo 绕过 service 层。 | 2026-08-14 修复：plansService 8 方法收口 repo 访问，controller 改调；backend 全量 207/207。',
  ],
  暂未归类: [
    '| p2 | z076-引擎切换pitch硬编码<br>`discover:20260810`<br>`solve:20260814` | 引擎切换相机 pitch=-90 硬编码。 | 2026-08-14 修复：DEFAULT_CAMERA_PITCH_DEG 常量 + 刻意设计注释（引擎切换不传递倾斜状态，OL 无 pitch 概念）。',
    '| p2 | z103-覆盖率阈值形同虚设<br>`discover:20260810`<br>`solve:20260814` | CI 覆盖率阈值 15-25% 过低。 | 2026-08-14 修复：frontend vitest 阈值提升 30/25/18/30（留余量防假红，60% 目标挂下阶段）。',
    '| p3 | z105-setTerrainEnabled无调用方<br>`discover:20260810`<br>`solve:20260814` | setTerrainEnabled 仅定义无调用方。 | 2026-08-14 处置：@arch-note 预留钩子标注（layerAdapters geotiff 走普通图层显隐语义，L350 状态延续依赖本方法）。',
  ],
}
for (const [sec, rows] of Object.entries(insert)) {
  const marker = `## ${sec}`
  const si = t.indexOf(marker)
  const next = t.indexOf('\n## ', si + marker.length)
  const end = next === -1 ? t.length : next
  t = t.slice(0, end) + '\n' + rows.join('\n') + '\n' + t.slice(end)
  console.log(`${sec}: 插入原编号 ${rows.length} 条`)
}

fs.writeFileSync(P, t, 'utf8')
console.log('完成')
