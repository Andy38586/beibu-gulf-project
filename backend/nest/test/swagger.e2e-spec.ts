import { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// OpenAPI 契约底座测试：SwaggerModule 可从 AppModule 生成文档，
// 供 CI 契约漂移校验脚本（T3.1 起扩展）拉取 /nest-api/docs-json 的等价产物
describe('OpenAPI 契约底座', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('createDocument 产出含健康路由的合法 OpenAPI 文档', () => {
    const config = new DocumentBuilder().setTitle('beibu-gulf v3 API').setVersion('0.1').build()
    const document = SwaggerModule.createDocument(app, config)
    expect(document.info.title).toBe('beibu-gulf v3 API')
    expect(document.openapi).toMatch(/^3\./)
    // health controller 手写信封路由不产 DTO 注解路径；但 controller 路由必须被扫描到
    expect(Object.keys(document.paths ?? [])).toContain('/nest-api/health')
  })
})
