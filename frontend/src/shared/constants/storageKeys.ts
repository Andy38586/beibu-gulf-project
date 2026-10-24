/**
 * 前端本地存储键唯一权威源（W63 / PC-5）。
 *
 * 五个键此前以裸字面量散在各消费文件里（W63 登记的可派生族）：本表立权威后，
 * 消费侧一律 import 本表取键；任何文件出现第二份键字面量手抄，
 * 由 `tools/v3-guard/constants-audit.mjs` 的存储键族判红（键清单从本文件解析派生，
 * 守卫不手抄键值——根因 C：判据不许写死字符串）。
 *
 * 新增存储键：在本表加一条 + 消费侧 import；删除键：同笔删消费点（零消费即删）。
 */
export const STORAGE_KEYS = {
  /** 登录用户快照（useAuth 经 safeStorage 读写） */
  authUser: 'beibu-gulf-user',
  /** 任务属主标识（useTaskApi，跨刷新保持同一 client id） */
  taskClient: 'beibu-gulf-task-client',
  /** 底图选择（mapStore 持久化） */
  baseLayer: 'beibu-gulf-base-layer',
  /** 主题偏好（useTheme） */
  theme: 'gcs-theme',
  /** 行政边界 GeoJSON 缓存（useBoundaryLayer） */
  boundaryCache: 'beibu-gulf-boundary-cache',
} as const

export type StorageKey = keyof typeof STORAGE_KEYS
