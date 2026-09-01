import { Injectable } from '@nestjs/common'

import { PlansRepository } from '../repositories/plans.repository'

// 方案业务层：属主校验由 controller 层守卫（对齐 Express plansService 分工——
// service 专注数据访问编排，d080 分层语义在 Nest 侧保持同构）
@Injectable()
export class PlansService {
  constructor(private readonly plansRepository: PlansRepository) {}

  listByUser(userId: string) {
    return this.plansRepository.findAllByUserId(userId)
  }

  getById(id: string) {
    return this.plansRepository.findById(id)
  }

  create(data: {
    userId: string
    name: string
    selectedKeys: unknown
    typeSettings: unknown
    weights: unknown
  }) {
    return this.plansRepository.create(data)
  }

  update(id: string, updates: Record<string, unknown>) {
    return this.plansRepository.update(id, updates)
  }

  remove(id: string): Promise<boolean> {
    return this.plansRepository.remove(id)
  }

  saveXiaoqu(planId: string, xiaoqu: Record<string, unknown>) {
    return this.plansRepository.saveXiaoqu(planId, xiaoqu)
  }

  removeXiaoqu(planId: string, xiaoquId: string) {
    return this.plansRepository.removeXiaoqu(planId, xiaoquId)
  }
}
