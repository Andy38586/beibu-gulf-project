/**
 * 后端端点单一事实源：业务层/适配层严禁裸 URL 字面量，一律引用本表。
 * 前缀（/api 或 /nest-api）由 useApiRequest 按功能域自动拼接；
 * flood.online/impact 为 FastAPI（flood-service）全路径，不经业务后端。
 * 端点演进（新增/改名）只改此处，避免散落调用点漏改。
 */
export const ENDPOINTS = {
  auth: {
    me: '/auth/me',
    login: '/auth/login',
    register: '/auth/register',
    logout: '/auth/logout',
  },
  favorites: {
    root: '/favorites',
    item: (itemType: string, itemId: string) => `/favorites/${itemType}/${itemId}`,
  },
  plans: {
    root: '/plans',
    byId: (id: string) => `/plans/${id}`,
    xiaoqu: (planId: string) => `/plans/${planId}/xiaoqu`,
    xiaoquFromOne: (planId: string, xiaoquId: string) => `/plans/${planId}/xiaoqu/${xiaoquId}`,
  },
  forecast: {
    overview: '/forecast/overview',
    timeseries: '/forecast/timeseries',
    map: '/forecast/map',
    indicator: (indicator: string) => `/forecast/indicator/${indicator}`,
  },
  flood: {
    online: '/flood-online/api/flood/online',
    impact: '/flood-online/api/flood/impact',
    waterArea: '/flood/water-area',
    floodAreas: '/flood/flood-areas',
    statistics: '/flood/flood-statistics',
    terrainProfiles: '/flood/terrain-profiles',
    disaster: '/flood/analysis/disaster',
  },
  siteAnalysis: '/site-analysis',
  // FasterAPI 演算服务（algorithm-service，8000；复用 /flood-online 代理通道，
  // vite rewrite 去前缀后落 /route/path）——裸 JSON，envelope:false
  route: {
    path: '/flood-online/route/path',
  },
} as const
