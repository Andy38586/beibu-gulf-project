/**
 * 洪涝域跨层共享常量（前后端权威值互指，勿单侧修改）。
 * services 层禁止 import business（分层契约），故 floods 侧共享常量落 shared。
 */

// 风险等级缺省标签：与 backend/src/common/constants/flood.constants.ts 的
// RISK_LEVEL_BANDS[0].label（'无风险'）同源，改任一侧必须同步。
// 前端配色键（business/flood-analysis/constants/colors.ts）以中文标签为键，
// riskLevelCode 作为唯一 join 键的完整迁移见台账（架构 P1-3）
export const DEFAULT_RISK_LEVEL = '无风险'
