/**
 * 页面级图层归属（结构约束：注册即登记，注销随作用域销毁）。
 *
 * 治的是四轮反复的**结构**缺口：图层的注册与注销此前靠「每个页面自己记得写
 * onUnmounted + 手工维护 id 列表」。921→924 四轮都在同一个点复发
 * （RouteAnalysisPage 的平陆图层跨路由残留），每次都以「再补一段清理代码」收场 ——
 * 补的是点，不是结构，所以下一个页面照样漏。
 *
 * 约束形态：注册一律经本 composable（它登记归属），注销由作用域销毁统一负责。
 * ⇒ 页面**不需要、也不应该**自己调 `manager.remove`；「漏一个」在结构上不可能发生，
 * 因为页面里根本没有那个可以漏的动作。
 *
 * 异步边：卸载后才 resolve 的注册请求一律拒收，堵住「卸载后仍向 App 级单例注册」
 * 这条 921/922 反复出现的路径（裸 fetch 的回包）。
 */
import { onScopeDispose } from 'vue'

import { logger } from '@/shared'

import type { LayerDescriptor } from '../BusinessLayerManager'

import { type BusinessLayerManagerLike, useBusinessLayers } from './useBusinessLayers'

export interface UseOwnedLayersReturn {
  /** 注册并登记归属；返回 false 表示本次注册被拒（组件已卸载） */
  register: (key: string, desc: LayerDescriptor) => boolean
  /**
   * 幂等上图：**未在册则注册，已在册则只更新数据与样式**。
   *
   * 收掉「`has()` ? `updateData` : `register`」这句样板 —— 它此前在每个消费模块各写一遍
   * （flood 的淹没范围 / 受影响设施、forecast 的指标图层…），每处都要自己记得「先判重、
   * 再挑路径」，改注册形态时得同步多处。
   *
   * 判重在**本 owner 册**上做，而不是问引擎 `manager.has(key)`：要回答的问题是
   * 「**我**登记过没有」，别的 owner 用了同名 key 不该干扰本册判断。
   */
  applyOrUpdate: (key: string, desc: LayerDescriptor) => boolean
  /** 主动注销单个（在册则一并出册） */
  unregister: (key: string) => void
  /** 立即清空本 owner 的全部图层（通常不必手动调，作用域销毁会自动做） */
  releaseAll: () => void
  /** 当前在册的键（只读视图，供调试与断言） */
  owned: ReadonlySet<string>
}

/**
 * @param explicitManager 显式传入的 manager（透传给 useBusinessLayers）——供"provide 者自己"用，
 *                        见 useBusinessLayers 的实测注。不传时仍走 inject（后代组件既有路径）。
 *                        注：本地接收者仍叫 `manager`——不放宽 owned-layers 守卫对
 *                        `manager.register(` 的派生（守卫靠它数注册语义，改名会让分母归零）。
 */
export function useOwnedLayers(
  owner: string,
  explicitManager?: BusinessLayerManagerLike
): UseOwnedLayersReturn {
  const { manager } = useBusinessLayers(explicitManager)
  const owned = new Set<string>()
  let disposed = false

  function reject(key: string): false {
    // 卸载后到达的注册：拒收。挂上去就没有归属，没人会替它清。
    logger.debug(`[useOwnedLayers:${owner}] 作用域已销毁，拒收图层注册 ${key}`)
    return false
  }

  function register(key: string, desc: LayerDescriptor): boolean {
    if (disposed) return reject(key)
    manager.register(key, desc)
    owned.add(key)
    return true
  }

  function applyOrUpdate(key: string, desc: LayerDescriptor): boolean {
    if (disposed) return reject(key)
    if (owned.has(key)) {
      manager.updateData(key, { data: desc.data, options: desc.options })
      return true
    }
    return register(key, desc)
  }

  function unregister(key: string): void {
    if (owned.delete(key)) manager.remove(key)
  }

  function releaseAll(): void {
    disposed = true
    for (const key of owned) manager.remove(key)
    owned.clear()
  }

  onScopeDispose(releaseAll)

  return { register, applyOrUpdate, unregister, releaseAll, owned }
}
