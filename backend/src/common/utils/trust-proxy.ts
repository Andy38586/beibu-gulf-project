/**
 * trust proxy 跳数解析。
 *
 * 生产经 nginx 反代时 Express 必须 `app.set('trust proxy', <跳数>)`，否则：
 * ① 限流键 `req.ip` 退化为 nginx 容器 IP ⇒ 三个 throttler 桶全站共享，
 *    任一客户端即可把 route/plans/favorites 打成 429（04-G5）；
 * ② `auth.controller.ts` 的 `x-forwarded-proto` 推定（secure cookie）失效。
 *
 * 跳数取部署拓扑（nginx→nest 一跳）默认 1，不用 `true`——那等于任何人都能伪造 XFF。
 * 显式判断非负有限值原样生效、否则回落 1：不能用 `Number(...) || 1`，
 * 它无法表达"不信任代理"（0 是 falsy）。写法继承 3c27a05e~1 老 Express。
 * 空串/纯空白按未设置处理——`Number('')` 是 0，若直接换算会把
 * 「TRUST_PROXY_HOPS=」误释成显式不信任代理（失效形态回归）。
 */
export function resolveTrustProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 1
  const hops = Number(raw)
  return Number.isFinite(hops) && hops >= 0 ? hops : 1
}
