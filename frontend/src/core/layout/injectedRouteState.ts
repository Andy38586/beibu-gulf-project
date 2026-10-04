import { readonly, ref } from 'vue'

/**
 * 「根入口注入取值函数 + core 侧只读版本号重算」的通用载体。
 *
 * routeReadiness 与 taskIndicator 同款形态（core 不引 stores，铁律 L3）：
 * 注入方 register(fn)/notify()，core 侧 get(route) 取值、watch(version) 重算。
 */
export function createInjectedRouteState<S>(empty: S) {
  const getter = ref<(route: string) => S>(() => empty)
  const version = ref(0)
  return {
    /** core 侧消费：读取版本号（watch 它触发重算） */
    version: readonly(version),
    /** core 侧消费：按路由取值 */
    get: (route: string): S => getter.value(route),
    /** 根入口注入（App.vue setup 内一次性调用） */
    register: (fn: (route: string) => S): void => {
      getter.value = fn
      version.value += 1
    },
    /** 注入方通知数据已变（触发 core 侧重算） */
    notify: (): void => {
      version.value += 1
    },
  }
}
