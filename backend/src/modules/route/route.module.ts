import { Module } from '@nestjs/common'

import { RouteController } from './controllers/route.controller'
import { RouteRepository } from './repositories/route.repository'
import { RouteService } from './services/route.service'

// 路径规划模块（route 域，公开只读）：下沉自 algorithm-service 的 networkx 构图，
// 改走 pgRouting（pgr_withPoints + 索引查询）。DbService 为 @Global 共享单例（infra/db），
// 此处不再重复声明。
//
// exports RouteService：v4 异步任务域（TaskHandlers）按域委托执行，需跨模块注入
@Module({
  controllers: [RouteController],
  providers: [RouteRepository, RouteService],
  exports: [RouteService],
})
export class RouteModule {}
