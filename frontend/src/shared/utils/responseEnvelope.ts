/**
 * 统一响应信封（envelope={code,data}）解包：后端成功响应形如 { code, data, [附加字段] }，
 * 本函数提取 data 作为唯一事实源，供 useApiRequest 与 mapDataService 等所有解包位置复用。
 * 仅要求同时含 code 与 data 即解包、不限键数——后端扩展 message/timestamp 等字段仍正常。
 */
export function unwrapEnvelope<T = unknown>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'code' in raw && 'data' in raw) {
    return (raw as Record<string, unknown>).data as T
  }
  return raw as T
}
