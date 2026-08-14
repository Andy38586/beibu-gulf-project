// git filter-branch msg-filter: 去掉 commit message 中的"批次信息"表述
// 用法: git filter-branch -f --msg-filter "node tools/rewrite-msg.mjs" <range>
import fs from 'node:fs'

const map = {
  '4c94afa': 'fix: 查表键toFixed/0档淹没归零/除零守卫/登出清快照/底图键白名单/占位符数据/契约文档对齐',
  '42c785f': 'fix: 真演算回归测试/缓存单测/日志保留30天/CORS收窄/PII打码/注释漂移/文档约定',
  '78270fd': 'fix: adapter日志/端点对账/注释与基线修正/CSP报告模式/兜底色收口',
  'aa42ddd': 'fix: 选址坐标防御/bbox统一/错误信封/缓存键/渲染器类型债收口',
  'a049b7d': 'fix: 死状态移除/监听具名化/深路径收口/env示例/plans测试/模块README/契约补录',
  'e7417ba': 'fix: tokenSOP与统计脚本/色常量收口/相机pitch常量/参数名统一/阈值提升/预留标注',
  '4bed958': 'fix: plansService 抽取收口/后端治理项裁决',
  '3a35f15': 'fix: token补定义/z-index槽位/渐变与边框token化/focus环/placeholder对比度/thumb统一',
  '4e27bba': 'docs: 修复转正已解决台账(12组合并补记+43新编号+5原编号移入,open 28→23)',
}

const input = fs.readFileSync(0, 'utf8')
const commit = process.env.GIT_COMMIT || ''
const key = commit.slice(0, 7)
if (map[key]) {
  process.stdout.write(map[key])
} else {
  process.stdout.write(input)
}
