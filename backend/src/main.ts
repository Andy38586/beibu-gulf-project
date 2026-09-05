import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import express from 'express'
import path from 'node:path'

import { AppModule } from './app.module'
import { ConfigService } from './infra/config/config.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  // 配置集中读取；listen 前必填校验（缺 JWT_SECRET 直接 fail fast，不带弱配置上线）
  const config = app.get(ConfigService)
  config.validateStartup()
  // 全局前缀 nest-api：Nest 独立端口时代（3100）的反代路径惯用，
  // Express 退役后端口回切 3000，nginx 反代目标不变（/api、/nest-api 均可代理到本服务）
  app.setGlobalPrefix('nest-api')
  // cookie 解析：认证守卫读 HttpOnly auth_token（对齐 Express cookieParser）
  app.use(cookieParser())

  // 静态资源托管：backend/static（CTB 地形瓦片 /static/terrain、DEM hillshade /static/dem）。
  // Express 退役后该职责迁移至 Nest（vite proxy /static → 3000 与生产 nginx /static/ 同口径）；
  // 目录从 dataDir 兄弟位解析（backend/data → backend/static），复用 DATA_DIR 解析链的 cwd 容错。
  // .terrain 特判：瓦片本身是 gzip 压缩流（CTB 产出），须声明 Content-Encoding 否则 Cesium
  // 不解压直接按原始格式解码 → RangeError（对齐老 Express 特判与生产 nginx location ~ \.terrain$）
  const staticRoot = path.resolve(path.dirname(config.dataDir), 'static')
  app.use(
    '/static',
    express.static(staticRoot, {
      maxAge: '7d',
      immutable: true,
      fallthrough: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.terrain')) {
          res.setHeader('Content-Encoding', 'gzip')
        }
      },
    })
  )

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
