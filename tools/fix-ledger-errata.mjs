// 已解决主本: 11 项台账勘误补注(2026-08-14 后遗症审查结论)
import fs from 'node:fs'
const P = 'docs/已解决问题.md'
let t = fs.readFileSync(P, 'utf8')

const notes = {
  d048: '2026-08-14 勘误：原"无真 key 入版本库；密钥未泄露"过早闭环——d056 证实天地图 key 曾进 7 个 commit；修订为"当前工作树无真 key；历史已泄露见 d056（待解决）"。',
  b031: '2026-08-14 勘误：b031(8.2) 与 b031-401软登录缺口同号冲突，条目内"待统一修复"无处置记录——登记重编号待办（8.2 组迁后续空号）。',
  c018: '2026-08-14 勘误：与 c024 结论冲突（"收进 forecast/constants.ts" vs "保留 shared"）——实际存放位置 frontend/src/shared/constants/forecast.ts（BASE_YEAR/END_YEAR），此处补指针。',
  c024: '2026-08-14 勘误：与 c018 结论冲突（"保留 shared（红线）" vs c018"收进 forecast"）——实际存放位置 frontend/src/shared/constants/forecast.ts，此处补指针，c018/c024 同源对齐。',
  z003: '2026-08-14 勘误：悬空引用"剩余残留见 z028"——z028 已闭环，补注收口去向（见 z028 条目）。',
  z007: '2026-08-14 勘误：悬空引用"见待解决问题.md a018"——a018 已闭环（2026-08-02），补注收口去向。',
  z089: '2026-08-14 勘误：自述"部分收口待后续批次"——实际已由 z046 收口（renderer 类型逃生治理），补注去向；另注：z089 为原 z042 撞号而来（z036/z047/z078 同源撞号，见后遗症副本勘误对照）。',
  b022: '2026-08-14 勘误：本条目"默认 mock"已被 b031(8.2)（默认 api）推翻——返工链补交叉引用（b031(8.2) 条目）。',
  b024: '2026-08-14 勘误：本条目"默认 mock"已被 b031(8.2)（默认 api）推翻——返工链补交叉引用（b031(8.2) 条目）。',
  b042: '2026-08-14 勘误：本条目（sessionStorage 版本迁移机制+5 回归测试）已被 b057（08-10 整条删除通道）废弃——确认相关测试已清理，返工链补交叉引用。',
}

let done = 0
for (const [id, note] of Object.entries(notes)) {
  const re = new RegExp(`^(\\|\\s*p[0-3]\\s*\\|\\s*${id}[-－][^\\n]*?)(\\|\\s*)$`, 'm')
  if (!re.test(t)) { console.log(`⚠️ 未找到: ${id}`); continue }
  t = t.replace(re, `$1<br>**2026-08-14 勘误**：${note}$2`)
  done++
}
fs.writeFileSync(P, t, 'utf8')
console.log(`勘误补注完成: ${done}/${Object.keys(notes).length}`)
