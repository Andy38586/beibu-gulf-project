import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * defineEmits 零监听守卫（必要性审判波二·单元 P）
 *
 * 一个 emit 只有「声明」没有「监听」＝空转通道：调用方拿不到任何东西，
 * 读者却以为存在外部依赖。本判据要求：.vue 里 defineEmits 声明的每个事件名，
 * 必须在全仓留下至少一个消费点（模板监听 / emitted() 断言 / $emit() 调用 /
 * toHaveBeenCalledWith() 断言），一处都没有即红。
 *
 * 本单元删除的七条通道（均为零监听，实测 321 个 .vue/.ts 全扫）：
 *  · GCSPanel.vue            dragstart / dragend
 *  · UnifiedMap.vue          type-change
 *  · PaginatedListPanel.vue  click-item / favorite-change
 *  · BarChart.vue / LineChart.vue  select
 *
 * 已知边界（两条，均如实记）：
 *  · 只认静态形态的消费点（模板 @ 绑定、emitted/$emit/断言字面量）；动态拼接的事件名
 *    （`@${x}`、emit(name) 传变量）不在覆盖内——这类写法本仓实测 0 处。
 *  · 「composable 层的 emit 替身断言」也算消费点。RadarChart 的 show/hide-facility-layer
 *    即靠 useRadarChart.test.ts 的 toHaveBeenCalledWith 判为活，而组件层 @ 监听全仓为 0
 *    （唯一挂载点 AppLayout.vue:159-164 未监听）——该条留作后续候选，不在本单元处理。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')
/** 测试件必须纳入扫描面：部分事件只在 \`emitted(...)\` 断言里被消费（UnifiedMap 的 click / error 曾属此列，已随 emit 删空） */
const SKIP_DIR = new Set(['__mocks__', 'node_modules', 'dist', '.local'])

/** kebab-case ↔ camelCase 在模板里等价，两种拼写都要查 */
function spellings(event: string): string[] {
  const out = new Set<string>([event])
  out.add(event.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))
  out.add(event.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()))
  return [...out]
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue
      listSources(path.join(dir, entry.name), out)
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/** 取 declareEmits 里所有事件名：类型字面量 / 具名 interface / 对象字面量三形态 */
export function declaredEvents(text: string): string[] {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  const names: string[] = []

  /** 类型字面量两种写法：'ev': [...]（PropertySignature）与 (e: 'ev', ...): void（CallSignature） */
  const fromMembers = (members: ts.NodeArray<ts.TypeElement>): void => {
    for (const member of members) {
      if (
        (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
        member.name !== undefined
      ) {
        names.push(member.name.getText(sf).replace(/^['"]|['"]$/g, ''))
      } else if (ts.isCallSignatureDeclaration(member) && member.parameters.length > 0) {
        const p0 = member.parameters[0].type
        if (p0 && ts.isLiteralTypeNode(p0) && ts.isStringLiteral(p0.literal)) {
          names.push(p0.literal.text)
        }
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineEmits'
    ) {
      const typeArgs = node.typeArguments
      if (typeArgs && typeArgs.length > 0) {
        const arg = typeArgs[0]
        if (ts.isTypeLiteralNode(arg)) {
          fromMembers(arg.members)
        } else if (ts.isTypeReferenceNode(arg)) {
          const ifaceName = arg.typeName.getText(sf)
          const walkIface = (n: ts.Node): void => {
            if (ts.isInterfaceDeclaration(n) && n.name.text === ifaceName) fromMembers(n.members)
            ts.forEachChild(n, walkIface)
          }
          walkIface(sf)
        }
      }
      const objArg = node.arguments[0]
      if (objArg && ts.isObjectLiteralExpression(objArg)) {
        for (const prop of objArg.properties) {
          if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
            names.push(prop.name.getText(sf).replace(/^['"]|['"]$/g, ''))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** 事件名在给定源码里是否留下消费点 */
export function hasConsumer(event: string, sources: string[]): boolean {
  for (const text of sources) {
    for (const name of spellings(event)) {
      if (
        text.includes('@' + name) ||
        text.includes("emitted('" + name + "'") ||
        text.includes('emitted("' + name + '"') ||
        text.includes("$emit('" + name + "'") ||
        text.includes('$emit("' + name + '"') ||
        text.includes("toHaveBeenCalledWith('" + name + "'")
      ) {
        return true
      }
    }
  }
  return false
}

/** 阳性对照：三形态都必须被抽到 */
/** 原料必须是纯 TS：`<script setup>` 会让 `<script setup lang="ts">` 被解析成 TS 类型断言表达式，
 *  其后的 interface 全部丢出语法树（实测：加标签后 interface 抽取数从 1 变 0）。 */
const HAND_WRITTEN_SAMPLE = `
interface Emits {
  'alpha-event': [n: number]
  (_e: 'omega-event', n: number): void
}
const a = defineEmits<Emits>()
const b = defineEmits<{ beta: []; 'gamma-x': [] }>()
const c = defineEmits({ delta: null })
`

describe('defineEmits 零监听（必要性审判波二·单元 P）', () => {
  const files = listSources(SRC)
  const texts = files.map((f) => fs.readFileSync(f, 'utf8'))

  it('每条 defineEmits 声明的事件都有消费点', () => {
    const offenders: string[] = []
    let declared = 0
    for (let i = 0; i < files.length; i += 1) {
      if (!files[i].endsWith('.vue')) continue
      const rel = path.relative(SRC, files[i]).split(path.sep).join('/')
      for (const event of declaredEvents(texts[i])) {
        declared += 1
        if (!hasConsumer(event, texts)) offenders.push(`${rel}: '${event}' 有声明无监听`)
      }
    }
    expect(offenders).toEqual([])
    // 兜空：扫描面与声明面都必须真的扫到仓库
    expect(files.length).toBeGreaterThan(200)
    expect(declared).toBeGreaterThan(10)
  })

  it('本单元删除的七条通道没有被重新加回（不得重新出现声明）', () => {
    const GONE: Array<[string, string]> = [
      ['core/layout/components/GCSPanel.vue', 'dragstart'],
      ['core/layout/components/GCSPanel.vue', 'dragend'],
      ['core/map/UnifiedMap.vue', 'type-change'],
      ['shared/components/PaginatedListPanel.vue', 'click-item'],
      ['shared/components/PaginatedListPanel.vue', 'favorite-change'],
      ['visualization/charts/BarChart.vue', 'select'],
      ['visualization/charts/LineChart.vue', 'select'],
    ]
    const offenders: string[] = []
    for (const [rel, event] of GONE) {
      // 只断言「这条事件」不再被声明：文件里若还有别的 emit（如 GCSPanel 的 drop）
      // 属正常保留面，不得因噎废食。
      const declared = declaredEvents(fs.readFileSync(path.join(SRC, rel), 'utf8'))
      if (declared.includes(event)) offenders.push(`${rel}: 重新声明了 ${event}`)
    }
    expect(offenders).toEqual([])
  })

  it('🔴 @guard-red-sample 同形态样本（三形态声明）必被抽到全部事件名', () => {
    expect(declaredEvents(HAND_WRITTEN_SAMPLE).sort()).toEqual(
      ['alpha-event', 'beta', 'delta', 'gamma-x', 'omega-event'].sort()
    )
    // 该样本落进仓内即 offender：证明零监听判据能咬
    expect(hasConsumer('beta', [HAND_WRITTEN_SAMPLE])).toBe(false)
    expect(hasConsumer('beta', ['<Bar @beta="x" />'])).toBe(true)
    // kebab 等价：模板只写 kebab 时 camel 形态也要算有消费
    expect(hasConsumer('alphaEvent', ['<X @alpha-event="y" />'])).toBe(true)
  })
})
