/**
 * 统一信封解包（z063）
 *
 * 后端统一响应契约：成功响应形如 `{ code, data, [message|timestamp]... }`，
 * 调用方只关心 `data`。本函数作为唯一事实源，供 useApiRequest 与
 * mapDataService 等所有需要解包的位置复用，保持行为逐字等价。
 *
 * 契约（REQ-1）：仅要求响应对象同时含 `code` 与 `data` 两个字段即解包，
 * 不要求对象只有 2 个键——后端扩展 `message`/`timestamp` 等附加字段时
 * 仍应正常解包，避免旧逻辑因 Object.keys 长度限制而解包失败。
 */
export function unwrapEnvelope<T = unknown>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'code' in raw && 'data' in raw) {
    return (raw as Record<string, unknown>).data as T
  }
  return raw as T
}
