import { Global, Module } from '@nestjs/common'

import { DataFilesService } from './data-files.service'

// backend/data 静态只读数据的共享单例：三个读模块（flood/forecast/site-analysis）
// 各自声明 DataFilesService 会产生 3 个独立实例与 3 份独立读缓存——
// 收敛为 @Global 单例，读缓存全局一份，行为等价（各模块读文件互不重叠）。
@Global()
@Module({
  providers: [DataFilesService],
  exports: [DataFilesService],
})
export class DataFilesModule {}
