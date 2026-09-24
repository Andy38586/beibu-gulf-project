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
import { useBusinessLayers } from './useBusinessLayers'

export interface UseOwnedLayersReturn {
  /** 注册并登记归属；返回 false 表示本次注册被拒（组件已卸载） */
  register: (key: string, desc: LayerDescriptor) => boolean
  /** 主动注销单个（在册则一并出册） */
  unregister: (key: string) => void
  /** 立即清空本 owner 的全部图层（通常不必手动调，作用域销毁会自动做） */
  releaseAll: () => void
  /** 当前在册的键（只读视图，供调试与断言） */
  owned: ReadonlySet<string>
}

export function useOwnedLayers(owner: string): UseOwnedLayersReturn {
  const { manager } = useBusinessLayers()
  const owned = new Set<string>()
  let disposed = false

  function register(key: string, desc: LayerDescriptor): boolean {
    if (disposed) {
      // 卸载后到达的注册：拒收。挂上去就没有归属，没人会替它清。
      logger.debug(`[useOwnedLayers:${owner}] 作用域已销毁，拒收图层注册 ${key}`)
      return false
    }
    manager.register(key, desc)
    owned.add(key)
    return true
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

  return { register, unregister, releaseAll, owned }
}
