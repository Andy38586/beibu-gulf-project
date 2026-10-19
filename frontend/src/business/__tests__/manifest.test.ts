import fs from 'node:fs'
import path from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useForecastStore } from '@/stores'

import { businessModules, runBusinessLogoutReset } from '../manifest'

/** 判据扫描面：排除依赖目录与测试目录（本文件必然要写这两个模式，否则判据自咬） */
const SKIP_DIRS = new Set(['node_modules', '__mocks__', '__tests__'])

/**
 * manifest → 登出重置注册映射单测。
 * 新增业务模块只需在清单补 reset，App.vue/登出链路零改动——此测试锁住"已实现模块必须声明 reset、
 * 占位模块可省略、批量执行真实复位"三条不变量。
 */
describe('business/manifest 登出重置注册', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('已实现业务模块均声明 reset（登出重置）', () => {
    const implemented = businessModules.filter((m) => m.component !== null)
    expect(implemented.map((m) => m.name).sort()).toEqual([
      'DiversionAnalysis',
      'FloodAnalysis',
      'Forecast',
      'RouteAnalysis',
      'SiteSuitability',
    ])
    for (const m of implemented) {
      expect(m.reset, `${m.name} 缺少登出 reset`).toBeDefined()
    }
  })

  it('分流分析已切 3D 引擎（Cesium ③：弧线可视化前提；翻回 2d 即红）', () => {
    const diversion = businessModules.find((m) => m.name === 'DiversionAnalysis')
    expect(diversion?.engine).toBe('3d')
  })

  it('RouteAnalysis 已实现（组件非 null、注册路由、声明 reset）', () => {
    const route = businessModules.find((m) => m.name === 'RouteAnalysis')
    expect(route).toBeDefined()
    expect(route?.component).not.toBeNull()
    expect(route?.reset).toBeDefined()
  })

  it('runBusinessLogoutReset 批量执行不抛错，且 Forecast 运行时状态复位', () => {
    const forecast = useForecastStore()
    forecast.currentTime = '2027-01' // 人为改写
    expect(() => runBusinessLogoutReset()).not.toThrow()
    expect(forecast.currentTime).toBe('2026-06') // reset() 的默认值
  })

  /**
   * 预留字段守卫（必要性审判·单元 S）：`navDisabled` 已于 2026-10-19 删除 —— 5 个模块无一
   * 设置它，生产侧只有 App.vue 读一次且恒取 false。
   *
   * 只咬**声明面**（`navDisabled?:`）与**成员读**（`.navDisabled`）：处置留痕的散文注释里
   * 出现字段名是历史记录，不是回潮；测试目录自身也被排除（它必然要写这两个模式）。
   * 扫描分母兜底（>50 个源文件），否则目录被挪走时判据会退化成空扫全绿。
   */
  it('navDisabled 不得回潮（声明面与成员读两处）', () => {
    const SRC = path.resolve(__dirname, '..', '..')
    const DECL = /navDisabled\s*\?:/
    const READ = /\.navDisabled\b/
    const hits: string[] = []
    let scanned = 0
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue
          walk(p)
        } else if (/\.(ts|vue)$/.test(e.name)) {
          scanned += 1
          const text = fs.readFileSync(p, 'utf8')
          if (DECL.test(text) || READ.test(text)) hits.push(path.relative(SRC, p))
        }
      }
    }
    walk(SRC)
    expect(scanned, '扫描分母过小：判据可能已空转').toBeGreaterThan(50)
    expect(hits, 'navDisabled 已删除，声明面/成员读不得回潮').toEqual([])
  })
  it('可重复执行（登出多次无障碍）', () => {
    expect(() => {
      runBusinessLogoutReset()
      runBusinessLogoutReset()
    }).not.toThrow()
  })
})
