/**
 * plansService — 方案业务层（d080 修复：controller 直连仓库 → 经 service 收口）。
 * 职责：方案 CRUD 与小区收藏的业务规则收口（属主校验已由 controller 层守卫，service 专注数据访问编排）；
 * 与 siteAnalysisService/floodService 同层，后续 v3 NestJS 迁移时对应 @Injectable()。
 */
import * as plansRepo from '../repositories/plansRepository.js'

/** 当前用户全部方案 */
export function listByUser(userId) {
  return plansRepo.findAllByUserId(userId)
}

/** 按 id 查单条（不存在返回 null，由 controller 转 404） */
export function getById(id) {
  return plansRepo.findById(id)
}

/** 创建方案 */
export function create(data) {
  return plansRepo.create(data)
}

/** 更新方案字段（仅透传已校验字段） */
export function update(id, updates) {
  return plansRepo.update(id, updates)
}

/** 删除方案，返回是否删除成功 */
export function remove(id) {
  return plansRepo.remove(id)
}

/** 保存小区到方案 */
export function saveXiaoqu(planId, xiaoqu) {
  return plansRepo.saveXiaoqu(planId, xiaoqu)
}

/** 从方案移除小区 */
export function removeXiaoqu(planId, xiaoquId) {
  return plansRepo.removeXiaoqu(planId, xiaoquId)
}
