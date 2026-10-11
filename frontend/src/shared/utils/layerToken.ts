/**
 * 异步结果陈旧判定（考古 K1-3 收口，2026-10-11）。
 *
 * 模式：每个图层 id 发一个 symbol token，await 前后各验一次——token 不再匹配
 * 即「期间有更新的同 id 请求」，本次结果必须丢弃（写图先复检再回收）。
 * 收口 CesiumRenderer 内 5 处同构判定；换竞态口径只改这里。
 */
export function isStaleToken(tokens: Map<string, symbol>, id: string, token: symbol): boolean {
  return tokens.get(id) !== token
}
