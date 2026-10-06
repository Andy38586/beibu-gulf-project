import { DocumentBuilder } from '@nestjs/swagger'

/**
 * Swagger 文档配置单一事实源：
 * `main.ts` 的 `/nest-api/docs` 暴露与本文件消费的契约检查共用同一份配置，
 * 防止「文档标题/版本改了、契约检查还按旧配置生成」的双份漂移。
 */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('beibu-gulf v3 API')
    .setDescription('NestJS 业务层（v3 单一后端；原 Express / FastAPI 均已退役）')
    .setVersion('0.1')
    .build()
}
