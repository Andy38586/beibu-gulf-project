import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'

import { AppModule } from './app.module'
import { ConfigService } from './infra/config/config.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  // 配置集中读取；listen 前必填校验（缺 JWT_SECRET 直接 fail fast，不带弱配置上线）
  const config = app.get(ConfigService)
  config.validateStartup()
  // 迁移期 Nest 用 3100 避让老 Express(3000)；Express 退役后回切 3000。
  // 前缀 nest-api 对齐未来 Vite proxy/nginx 的反代路径（与 Express 的 /api 平行语义）
  app.setGlobalPrefix('nest-api')
  // cookie 解析：认证守卫读 HttpOnly auth_token（对齐 Express cookieParser）
  app.use(cookieParser())

  // OpenAPI 契约底座：DTO 注解为单一事实源，/nest-api/docs-json 供契约对比
  // 漂移校验脚本拉取（与前端 zod 形状比对，契约先行方案）；UI 仅供开发调试，
  // 生产环境关闭暴露面（契约比对脚本在开发环境运行，不受影响）
  if (!config.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('beibu-gulf v3 API')
      .setDescription('NestJS 业务层（strangler 迁移期与老 Express 并存）')
      .setVersion('0.1')
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('nest-api/docs', app, document)
  }

  await app.listen(config.port)
  Logger.log(`nest up on :${config.port}`, 'Bootstrap')
}

void bootstrap()
