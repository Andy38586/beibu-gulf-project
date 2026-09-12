import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import express from 'express'

import { AppModule } from './app.module'
import { ConfigService } from './infra/config/config.service'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  // 关闭框架指纹：Nest 默认 Express adapter 会给每个响应带 X-Powered-By: Express，
  // 属低成本可消除的信息泄露（2026-09-10 实测线上 /nest-api/* 全部携带）。
  // 必须在首个请求前设置（此处为 listen 前），否则已发出的响应已带该头。
  ;(app.getHttpAdapter().getInstance() as express.Express).disable('x-powered-by')
  // 配置集中读取；listen 前必填校验（缺 JWT_SECRET 直接 fail fast，不带弱配置上线）
  const config = app.get(ConfigService)
  config.validateStartup()
  // 全局前缀 nest-api：Nest 独立端口时代（3100）的反代路径惯用，
  // Express 退役后端口回切 3000，nginx 反代目标不变（/api、/nest-api 均可代理到本服务）
  app.setGlobalPrefix('nest-api')
  // cookie 解析：认证守卫读 HttpOnly auth_token（对齐 Express cookieParser）
  app.use(cookieParser())

  // CSP 违规上报体解析（审查 z153）：浏览器的 Content-Type 是 `application/csp-report`
  // （report-uri）或 `application/reports+json`（report-to/Reporting API）——**都不是**
  // `application/json`，Nest 默认 json 解析器不会碰它们，req.body 会恒为 {}（静默收不到报告）。
  //
  // ⚠️ 必须写成"按类型分流 + 其余纯透传"，**不能**直接 `app.use(express.json({ type: [...] }))`：
  // 本项目 express 是 5.x（body-parser 2.x），其 json 中间件对**不匹配的类型也会打上
  // `req._body = true`**；而 Nest 内置解析器（body-parser 1.x）见到 `_body` 即跳过 ⇒
  // 全局 `application/json` 全部不再解析（实测：畸形 JSON 打到 /nest-api/auth/login 得到的是
  // 业务"用户名和密码不能为空"而非解析报错 = 解析器根本没跑）。此处只在 Content-Type 命中
  // CSP 两种类型时调用解析器，其余请求原样 next()，不触碰任何 request 状态。
  const CSP_REPORT_TYPES = ['application/csp-report', 'application/reports+json']
  // ⚠️ type 必须显式放开：`express.json()` 默认只认 `application/json`，若此处不给
  // `type`，解析器会对本分支放进来的 CSP 请求再跳过一次（隔离复现：中间件命中，handler
  // 里 req.body 仍是 undefined）。类型判定已由外层分支完成，这里 `() => true` 即"已放行"。
  const parseCspReportBody = express.json({ limit: '16kb', type: () => true })
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
    if (!CSP_REPORT_TYPES.includes(contentType)) return next()
    parseCspReportBody(req, res, next)
  })

  // 静态资源托管：backend/static（CTB 地形瓦片 /static/terrain、DEM hillshade /static/dem）。
  // Express 退役后该职责迁移至 Nest（vite proxy /static → 3000 与生产 nginx /static/ 同口径）；
  // 目录从 dataDir 兄弟位解析（backend/data → backend/static），复用 DATA_DIR 解析链的 cwd 容错。
  // .terrain 专用分支：瓦片本身是 gzip 压缩流（CTB 产出），须声明 Content-Encoding——
  // 不走 express.static（send 流式发送 + setHeaders 组合在并发地形请求下偶发 500，实测实锤），
  // 自管流式发送完全掌控响应头；layer.json 无扩展头正常 JSON
  const staticRoot = path.resolve(path.dirname(config.dataDir), 'static')
  const terrainRoot = path.join(staticRoot, 'terrain')
  app.use(
    '/static/terrain',
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const rel = decodeURIComponent(req.path).replace(/^\/+/, '')
      const file = path.resolve(terrainRoot, rel)
      if (!file.startsWith(terrainRoot + path.sep)) return next() // 防路径穿越
      let stat: fs.Stats
      try {
        stat = fs.statSync(file)
      } catch {
        return next()
      }
      if (!stat.isFile()) return next()
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
      if (file.endsWith('.terrain')) res.setHeader('Content-Encoding', 'gzip')
      fs.createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res)
    }
  )
  app.use('/static', express.static(staticRoot, { maxAge: '7d', immutable: true }))

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
