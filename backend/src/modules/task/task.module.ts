import { Module } from '@nestjs/common'

import { FloodModule } from '../flood/flood.module'
import { ForecastModule } from '../forecast/forecast.module'
import { RouteModule } from '../route/route.module'
import { SiteAnalysisModule } from '../site-analysis/site-analysis.module'

import { TaskController } from './controllers/task.controller'
import { TaskService } from './services/task.service'
import { TaskHandlers } from './services/task-handlers'

// 异步任务模块（v4 系统 B）。
//
// 定位：**编排层**，不含任何业务计算 —— 计算一律委托给各业务域的 service
//（TaskHandlers 是唯一耦合点）。因此本模块 imports 四个业务模块，取它们的 exports。
//
// 为什么是进程内注册表而非 Redis/BullMQ：2026-09-18 实测线上接口全在 1.2s 内
// ⇒ 后台任务是被「跨路由保活」逼出来的，不是被「慢」逼出来的（总纲 §四）。
// 代价（多实例不共享 / 重启即丢）已登记在 TaskRegistry 注释。
@Module({
  imports: [FloodModule, RouteModule, SiteAnalysisModule, ForecastModule],
  controllers: [TaskController],
  providers: [TaskHandlers, TaskService],
  exports: [TaskService],
})
export class TaskModule {}
