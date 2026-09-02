/**
 * 安全 localStorage 访问（jsdom/隐私模式/SSR 降级）：
 * 收敛 useTheme.safeStorage、useAuth.readStoredUser/writeStoredUser、mapStore 的
 * 三处手写 try/catch 读。schema/白名单校验留在调用方——本工具只保证"能安全读到
 * 原始 JSON 串"，不替调用方做业务校验（各调用方校验语义不同：useAuth 用 zod 失败
 * 清缓存、mapStore 用白名单、useTheme 用枚举）。
 */

/** 安全获取 localStorage 句柄；不可用（SSR/被禁用）返回 null */
export function getSafeStorage(): Storage | null {
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : null
    return ls && typeof ls.getItem === 'function' ? ls : null
  } catch {
    return null
  }
}

/** 读 JSON 值；键不存在/解析失败返回 null（不抛） */
export function readStoredJSON<T>(key: string): T | null {
  const ls = getSafeStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

/** 写 JSON 值；value 为 null 时清除该键（写入失败静默，如隐私模式配额） */
export function writeStoredJSON(key: string, value: unknown): void {
  const ls = getSafeStorage()
  if (!ls) return
  try {
    if (value === null) {
      ls.removeItem(key)
    } else {
      ls.setItem(key, JSON.stringify(value))
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

/** 删除键 */
export function removeStoredKey(key: string): void {
  const ls = getSafeStorage()
  if (!ls) return
  try {
    ls.removeItem(key)
  } catch {
    // 忽略
  }
}