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
    // 2026-09-10（阶段 4）：online/impact 两条 FastAPI 全路径已随 algorithm-service
    // 退役删除——淹没档位走 /flood/flood-areas（PostGIS 251 档），影响评估走
    // /flood/analysis/disaster（点面判定在 PostGIS）
    waterArea: '/flood/water-area',
    floodAreas: '/flood/flood-areas',
    statistics: '/flood/flood-statistics',
    terrainProfiles: '/flood/terrain-profiles',
    disaster: '/flood/analysis/disaster',
  },
  siteAnalysis: {
    root: '/site-analysis',
    // 名称关键词搜索（航线分析选点）：多源点集合并（港口/淹没设施点/小区/POI），limit 1..200
    pois: '/site-analysis/pois',
  },
  // FasterAPI 演算服务（algorithm-service，8000；复用 /flood-online 代理通道，
  // vite rewrite 去前缀后落 /route/path）——裸 JSON，envelope:false
  route: {
    // 2026-09-10：route 域自 algorithm-service 下沉至 NestJS（pgRouting）。
    // 由 FastAPI 全路径 '/flood-online/route/path' 改为 Nest 相对路径，
    // 响应结构未变，仅外层信封从「裸 JSON」变为 Nest 统一信封。
    path: '/route/path',
  },
} as const
