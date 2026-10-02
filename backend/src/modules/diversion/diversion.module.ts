import { Module } from '@nestjs/common'

import { DiversionController } from './controllers/diversion.controller'
import { DiversionRepository } from './repositories/diversion.repository'
import { DiversionService } from './services/diversion.service'

// 分流分析模块（论文 W10-11）：breakdown 纯函数门面（无状态）；canal-line 经
// DiversionRepository 读权威库 canal 表（Cesium ③ 弧线几何底座）。
// 分货类锚点出处见 common/diversion.ts 头注释（罗淳 2024 §5.3.4/附录 A-6）；
// 港口份额与 F3 情景层同源（forecast/constants/scenario.constants CANAL_PORT_SHARES）。
@Module({
  controllers: [DiversionController],
  providers: [DiversionRepository, DiversionService],
})
export class DiversionModule {}
