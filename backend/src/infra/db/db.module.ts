import { Global, Module } from '@nestjs/common'

import { DbService } from './db.service'
import { SpatialRepository } from './spatial.repository'

// Global：DB 访问经 repository 层收口后，各 feature 的 repository 都需要注入 DbService，
// 根模块 import 一次全应用可用。
// SpatialRepository 同处 infra/db：它是唯一持有空间 SQL 的 provider（service 层禁止裸 SQL），
// flood/site-analysis 两个 service 共用同一份算子口径
@Global()
@Module({
  providers: [DbService, SpatialRepository],
  exports: [DbService, SpatialRepository],
})
export class DbModule {}
