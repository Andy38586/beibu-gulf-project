#!/usr/bin/env node
/**
 * render-doc-map — 从登记表生成人读《文档地图》（docs/文档地图.md）。
 * 生成件禁止手改；改登记表 tools/v3-guard/lib/doc-map.json 后重跑本脚本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/v3-guard/lib/doc-map.json'), 'utf8'))
const KP = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/doc-system/kp-map.json'), 'utf8'))
const DATE = MAP.meta.date

const byLayer = (layer) => MAP.docs.filter((d) => d.layer === layer)
const table = (rows) =>
  ['| id | 文档 | 状态 | 定位 | 何时读 |', '| --- | --- | --- | --- | --- |', ...rows].join('\n')
const docRow = (d) =>
  `| ${d.id} | \`${d.path}\` | ${d.status} | ${d.role}${d.status === 'planned' ? '（迁移中：当前不存在，Batch D 移入）' : ''} | ${(d.readWhen || []).join('、') || '—'} |`

const taskRows = (t) =>
  `| ${t.id} | ${(t.read || []).join(' · ')} | ${(t.writeBack || []).join(' · ')} |`

const md = `# 文档地图（三层信息源索引）

> **生成件**：\`npm run docs:map\` 从 \`tools/v3-guard/lib/doc-map.json\` 生成，请勿手改。
> 最近复核：${DATE}
> 阅读入口：先读 \`AGENTS.md\` §二矩阵；本页是它的全量展开。

## 一、宪法层（无时效、罕改、改动需用户批准）

${table(byLayer('宪法').map(docRow))}

## 二、契约层（当前有效；每次修改必须追加当日变更记录）

${table(byLayer('契约').map(docRow))}

## 三、日志层（带时间戳、只增不改、不删）

${table(byLayer('日志').map(docRow))}

## 四、标准库与不动清单

${table(byLayer('标准库').map(docRow))}

- 本轮不动：审查标准库（约定 + 专项1-8 + 附录）、audits（桌面审件库）、两本台账、P0/P1 工单。
- 旧文档并行期：${byLayer('待迁移').length} 件（见登记表 \`layer=待迁移\`，全部保留，退役需用户批准）。

## 五、任务→必读→回写矩阵（机读版：\`doc-map.json\` 的 tasks[]）

| 任务 | 必读 | 回写 |
| --- | --- | --- |
${MAP.tasks.map(taskRows).join('\n')}

## 六、单一事实源登记（facts）

| 事实 | 权威 | 派生点 | 守卫 |
| --- | --- | --- | --- |
${MAP.facts
  .map((f) => {
    const auth =
      f.authority.kind === 'doc'
        ? f.authority.ref
        : (() => {
            const [p, frag] = String(f.authority.ref).split('#')
            return '`' + p + '`' + (frag ? ` 的 ${frag} 常量` : '')
          })()
    return `| ${f.id} | ${auth} | ${(f.derived || []).map((d) => d.site).join('、') || '—'} | \`${f.guard}\` |`
  })
  .join('\n')}

## 七、迁移进度

- 登记文档 ${MAP.docs.length} 件：active ${MAP.docs.filter((d) => d.status === 'active').length}｜stub ${MAP.docs.filter((d) => d.status === 'stub').length}｜planned ${MAP.docs.filter((d) => d.status === 'planned').length}｜parallel ${MAP.docs.filter((d) => d.status === 'parallel').length}。
- KP 表：源 ${KP.sources.length} 件 / 知识点 ${KP.kps.length} 条；权威 new ${KP.kps.filter((k) => k.authority === 'new').length}｜old ${KP.kps.filter((k) => k.authority === 'old').length}。
- 迁移完成前 \`meta.migrationOpen=true\`；结束时须把全部 stub/planned 清零并翻 false。

## 变更记录

- ${DATE} 生成（信息源三层体系 Batch A；源：\`tools/v3-guard/lib/doc-map.json\`）。
`

fs.writeFileSync(path.join(ROOT, 'docs/文档地图.md'), md, 'utf8')
console.log(`[render-doc-map] OK：docs/文档地图.md（${md.split('\n').length} 行）`)
