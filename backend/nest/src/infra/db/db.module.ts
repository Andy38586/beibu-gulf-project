import { Global, Module } from '@nestjs/common'

import { DbService } from './db.service'

// Global：DB 访问经 repository 层收口后，各 feature 的 repository 都需要注入 DbService，
// 根模块 import 一次全应用可用
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
