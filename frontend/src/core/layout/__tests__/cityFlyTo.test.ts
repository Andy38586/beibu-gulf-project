// @vitest-environment jsdom
/**
 * 必要性审判波次二·单元 F — 城市飞行同义转发层收口
 *
 * 原 useScreenActions.ts 只是 useMapControls().flyTo + MAP_CONFIG.CITY_CENTERS 的同义转发
 * （1 个生产消费点：AppLayout.vue），已内联回消费点。
 *
 * 阳性对照（删/改任一即红）：
 * ① 复活 useScreenActions.ts ⇒ 存在性 + 全仓 moduleSpecifier 扫描红
 * ② core barrel 重新导出 useScreenActions ⇒ 形态断言红
 * ③ flyTo 参数不再从 MAP_CONFIG.CITY_CENTERS 派生（写死坐标）⇒ 字面量断言红
 * ④ AppLayout 不再从 @/core 取 useMapControls ⇒ 行为断言红
 *
 * 🔴 教训（vitest 4.1.10 实测）：若 mock 的是 barrel（`@/core`）且 factory 是 async importOriginal，
 * 又在**模块作用域**读取该 barrel 的导出（如 `const X = MAP_CONFIG.CITY_CENTERS`），
 * factory 会被调用但替身 useMapControls 永不生效（实测 CALLS 0）—— 同步模块求值与
 * 异步 factory 的 importOriginal 互相抢跑，最终落到真实模块上。
 * 修法：只 mock 叶子模块 `@/core/map/composables/useMapControls`，且权威源读取一律放进 it()。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFlyTo = vi.fn()
vi.mock('@/core/map/composables/useMapControls', () => ({
  useMapControls: () => ({ flyTo: mockFlyTo }),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/flood-analysis', name: 'Flood', meta: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/visualization', () => ({
  RadarChart: { template: '<div class="radar-stub" />' },
  SNAPSHOT_XIAOQU: { id: 'snap', name: 'snap', breakdown: {} },
  SNAPSHOT_SELECTED_TYPES: [],
}))
vi.mock('@/core/map/components/LayerControlPanel.vue', () => ({
  default: { template: '<div class="layer-panel-stub" />' },
}))

import { MAP_CONFIG } from '@/core'
import AppLayout from '../AppLayout.vue'
import { useMobileDrawer } from '../useMobileDrawer'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = resolve(HERE, '..', '..')
const SRC = resolve(HERE, '..', '..', '..')
const RETIRED_ALIAS = 'layout/composables/useScreenActions'
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|\.local|dist)$/

function scriptOf(file: string): string {
  const text = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return text
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIR.test(e.name) ? [] : walk(join(dir, e.name))
    return /\.(ts|vue)$/.test(e.name) ? [join(dir, e.name)] : []
  })
}

/** 只读 AST 的 import / export 源 —— 不拿源码文本子串当形态判据（AGENTS §七-8） */
function moduleSpecifiers(source: string): string[] {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function numericLiterals(source: string): number[] {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node)) out.push(Number(node.text))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('useScreenActions 已退役（必要性审判波次二·单元 F）', () => {
  it('转发层文件不存在，且 frontend/src 全仓无一处 import', () => {
    expect(existsSync(join(CORE, RETIRED_ALIAS + '.ts'))).toBe(false)

    const files = walk(SRC)
    const hits = files.filter((f) =>
      moduleSpecifiers(scriptOf(f)).some((s) => s.includes('layout/composables/useScreenActions'))
    )
    expect(hits).toEqual([])
    // 阳性对照：扫描面真的在（不是空分母）
    expect(files.length).toBeGreaterThan(100)
  })

  it('公开面收窄 — core barrel 不再导出 useScreenActions（useMapControls 仍在）', () => {
    const barrel = moduleSpecifiers(readFileSync(join(CORE, 'index.ts'), 'utf8'))
    expect(barrel.some((s) => s.includes('useScreenActions'))).toBe(false)
    expect(barrel.some((s) => s.includes('map/composables/useMapControls'))).toBe(true)
  })

  it('AppLayout 就地消费：深路径取权威源，不走 @/core barrel（避免 core barrel 自环）', () => {
    const src = scriptOf(join(HERE, '..', 'AppLayout.vue'))
    const specs = moduleSpecifiers(src)
    expect(specs).toContain('@/core/config/map')
    expect(specs).toContain('@/core/map/composables/useMapControls')
    // core 内文件不得再走 barrel —— core/index.ts → AppLayout.vue → core/index.ts 会触发 no-circular
    expect(specs).not.toContain('@/core')

    // 权威源派生（写在 it 内：模块作用域读 MAP_CONFIG 会毒化 @/core 的 mock）
    const lngsLats = Object.values(MAP_CONFIG.CITY_CENTERS).flatMap((t) => [t.lng, t.lat])
    expect(lngsLats.length).toBe(6)
    const literals = numericLiterals(src)
    expect(literals.filter((v) => lngsLats.includes(v))).toEqual([])
  })
})

describe('城市飞行行为（桌面顶部按钮组 + 抽屉按钮组）', () => {
  enableAutoUnmount(afterEach)
  afterEach(() => {
    document.body.innerHTML = ''
  })
  beforeEach(() => {
    setActivePinia(createPinia())
    mockFlyTo.mockClear()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    document.body.innerHTML = ''
  })

  it('桌面顶部组：点第 1 个城市按钮 ⇒ flyTo 收到 MAP_CONFIG 派生的坐标与选项', async () => {
    const cities = Object.keys(MAP_CONFIG.CITY_CENTERS)
    const wrapper = mount(AppLayout, { attachTo: document.body })
    const buttons = document.querySelectorAll('.top-button-inner .GCS-button')
    expect(buttons.length).toBe(cities.length + 1) // 城市 + 主题
    ;(buttons[0] as HTMLElement).click()
    await wrapper.vm.$nextTick()

    const target = MAP_CONFIG.CITY_CENTERS[cities[0]]
    expect(mockFlyTo).toHaveBeenCalledTimes(1)
    expect(mockFlyTo).toHaveBeenCalledWith(
      { lng: target.lng, lat: target.lat },
      { height: target.height, zoom: target.zoom }
    )
  })

  it('抽屉城市组：同源驱动，点击同样触发 flyTo', async () => {
    const cities = Object.keys(MAP_CONFIG.CITY_CENTERS)
    const wrapper = mount(AppLayout, { attachTo: document.body })
    const { toggleDrawer } = useMobileDrawer()
    toggleDrawer()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const buttons = document.querySelectorAll(
      '.drawer-menu__row[aria-label="城市切换"] .GCS-button'
    )
    expect(buttons.length).toBe(cities.length + 1)
    ;(buttons[1] as HTMLElement).click()
    await wrapper.vm.$nextTick()

    const target = MAP_CONFIG.CITY_CENTERS[cities[1]]
    expect(mockFlyTo).toHaveBeenCalledTimes(1)
    expect(mockFlyTo).toHaveBeenCalledWith(
      { lng: target.lng, lat: target.lat },
      { height: target.height, zoom: target.zoom }
    )
  })
})
