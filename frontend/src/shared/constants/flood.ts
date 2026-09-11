/**
 * 洪涝域跨层共享常量（前后端权威值互指，勿单侧修改）。
 * services 层禁止 import business（分层契约），故 floods 侧共享常量落 shared。
 */

// 水位上限（米）：与 backend/src/common/constants/flood.constants.ts 的 MAX_WATER_LEVEL
// 同源（251 档 0.1m 步进 0-25m），双侧一致性由 tools/v3-guard/constants-audit.mjs 断言。
// 注意口径分层：本值是数据档位上限；WaterLevelProfilePanel 的 7 个刻度是潮汐基准面
// 参照标记（0-15m，最低潮面→最高潮位），参照系与数据档位是两个层的东西
export const MAX_WATER_LEVEL = 25

// 风险等级缺省标签：与 backend/src/common/constants/flood.constants.ts 的
// RISK_LEVEL_BANDS[0].label（'无风险'）同源，改任一侧必须同步。
// 前端配色键（business/flood-analysis/constants/colors.ts）以中文标签为键，
// riskLevelCode 作为唯一 join 键的完整迁移见台账（架构 P1-3）
export const DEFAULT_RISK_LEVEL = '无风险'
