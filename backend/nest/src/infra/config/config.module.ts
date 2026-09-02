import { Global, Module } from '@nestjs/common'

import { ConfigService } from './config.service'

// Global：配置是最底层依赖（db/files/bootstrap/main 均需读取），根模块 import 一次全应用可用
@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
