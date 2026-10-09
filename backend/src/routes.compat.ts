/**
 * 内部/兼容端点登记（唯一权威，1004-F14 起）：
 * Express 遗留、前端零消费但保留不删的端点清单。
 *
 * 消费方：
 *   · tools/v3-guard/__tests__/compat-endpoints.test.mjs（端点仍在 manifest + 前端仍零消费）
 *   · backend/test/swagger-contract.spec.ts（Swagger 双向核对的后端独有端点白名单）
 * 新增/删除条目 = 改判据域，须按 K3 登记意图写明理由。
 */
interface CompatEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** routes.manifest 的 path 形态（含 nest-api 前缀、`:param` 参数段） */
  path: string
  /** 前端消费探测正则（出现即红，表示声明与现状分叉） */
  consumerRe?: RegExp
}

export const COMPAT_ENDPOINTS: CompatEndpoint[] = [
  {
    method: 'POST',
    path: 'nest-api/plans/:id/xiaoqu',
    consumerRe: /\/plans\/[^'"\s`]*xiaoqu/,
  },
  {
    method: 'DELETE',
    path: 'nest-api/plans/:id/xiaoqu/:xiaoquId',
    consumerRe: /\/plans\/[^'"\s`]*xiaoqu/,
  },
  { method: 'GET', path: 'nest-api/forecast/:portId' },
]
