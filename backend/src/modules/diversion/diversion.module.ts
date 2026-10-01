import { Module } from '@nestjs/common'

import { DiversionController } from './controllers/diversion.controller'
import { DiversionService } from './services/diversion.service'

// 分流分析模块（论文 W10-11）：无 DB、无状态——common/diversion 纯函数的 HTTP 门面。
// 分货类锚点出处见 common/diversion.ts 头注释（罗淳 2024 §5.3.4/附录 A-6）；
// 港口份额与 F3 情景层同源（forecast/constants/scenario.constants CANAL_PORT_SHARES）。
@Module({
  controllers: [DiversionController],
  providers: [DiversionService],
})
export class DiversionModule {}
