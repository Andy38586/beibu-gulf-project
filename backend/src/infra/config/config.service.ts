import { existsSync } from 'node:fs'
import path from 'node:path'

import { Injectable, Optional } from '@nestjs/common'

import { getJwtSecret } from '../../common/utils/jwt.util'
import { resolveTrustProxyHops } from '../../common/utils/trust-proxy'
import { DbConfig, parseDbConfig } from '../db/db.config'

// 数据目录解析：优先 DATA_DIR env；否则从 cwd 向上找 backend/data（仓根或 backend/nest
// cwd 都能命中）；一路找不到回落 <cwd>/backend/data（报 ENOENT 而非静默错目录）
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  cwd: string = process.cwd()
): string {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR)
  let dir = cwd
  for (;;) {
    const candidate = path.join(dir, 'backend', 'data')
    if (exists(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(cwd, 'backend/data')
    dir = parent
  }
}

/**
 * 配置集中入口：PORT/NODE_ENV/JWT_SECRET/DATA_DIR、PG 凭据与 TRUST_PROXY_HOPS 全部经此类读取，
 * 业务代码不再散落 process.env。环境读取在构造时一次性定型，
 * 测试可直接 new ConfigService({...}) 注入假环境。
 * JWT 验签路径保持 jwt.util 的懒校验语义（auth 用时抛错），本类只做统一出口。
 */
@Injectable()
export class ConfigService {
  readonly port: number
  readonly nodeEnv: string
  readonly dbConfig: DbConfig
  // 反代跳数（d058）：main.ts 起服务时 set 到 Express 实例上，故必须与 PORT 同口径走本类出口
  // ——留在 main.ts 直读 process.env 就绕过了 validateStartup 的生产必填断言（原失效形态）
  readonly trustProxyHops: number

  // 逃生开关（z054，2026-09-26 用户裁定「fail + 本地逃生开关」）：置 1 表示**明知无 TLS
  // 仍要跑**（仅限本地开发），生产置 1 会关闭 auth cookie 的 Secure、JWT 明文传输，
  // 故 validateStartup() 会告警。默认关（未设或非 '1' 皆为 false）。
  readonly allowInsecure: boolean

  private readonly env: NodeJS.ProcessEnv

  // @Optional：NodeJS.ProcessEnv 无 DI token，Nest 环境解析不到即用默认 process.env；
  // 单测直连构造传假环境
  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    this.env = env
    // Number 语义与原 main.ts 完全一致：NaN/0/空串回落 3000（Express 已退役，主端口）
    this.port = Number(env.PORT) || 3000
    this.nodeEnv = env.NODE_ENV ?? 'development'
    this.dbConfig = parseDbConfig(env)
    this.trustProxyHops = resolveTrustProxyHops(env.TRUST_PROXY_HOPS)
    this.allowInsecure = (env.ALLOW_INSECURE ?? '') === '1'
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production'
  }

  /**
   * auth cookie 的 Secure 标志（z054）：**由显式配置决定，不再由请求头推定**。
   *
   * 原形态 `req.secure || x-forwarded-proto === 'https'`（auth.controller）在无证书部署下
   * 恒为 false，却因整条链「健康」而无声——令牌明文传输、中间人即账号接管。
   * 现形态：生产默认 true（部署前置 `scripts/preflight-deploy.sh` 已断言证书存在，
   * 见该脚本第 3 步）；仅 ALLOW_INSECURE=1 才转 false。非生产（本地）默认 false，
   * 便于 http://localhost 开发。
   */
  get cookieSecure(): boolean {
    return this.isProduction && !this.allowInsecure
  }

  get dataDir(): string {
    return resolveDataDir(this.env)
  }

  // 强校验单一事实源在 jwt.util：缺 secret / 长度不足直接抛错（不带着弱配置上线）
  get jwtSecret(): string {
    return getJwtSecret()
  }

  // 启动必填校验：main.ts 在 listen 前调用，缺必填配置直接 fail fast。
  // 相比原先「auth 路由用时才抛错」，起服务即可感知配置缺失，避免带病上线
  validateStartup(): void {
    void this.jwtSecret
    // P0（EP-09 / EH-07，2026-09-15）：生产环境 PG 凭据必填——db.config 已在构造期强校验
    // PG_PASSWORD，此处对四项一起做显式断言，给出可读的缺失清单（fail fast，不静默带病启动）
    if (this.isProduction) {
      const missing = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'].filter(
        (k) => !this.env[k]
      )
      if (missing.length > 0) {
        throw new Error(
          `启动失败：生产环境必须注入 ${missing.join('、')}（禁止依赖开发默认值上线）`
        )
      }
      // P0（d058，2026-09-23）：反代跳数同样必填，且必须显式可解析为 ≥1 的整数。
      // 为什么不像 PG_* 那样只判"缺不缺"：**0 就是失效形态本身**——它表示不信任任何代理，
      // 生产限流键随即退化为 nginx 容器 IP（三个桶全站共享）且 auth 的 secure 推定失真；
      // 非法值（abc / 1.5 / -1）则被解析层静默回落 1，等于"没配也照跑"，同属隐式默认。
      // 取值按部署拓扑级数：nginx→nest 一跳填 1；前置 CDN 再 +1。本地开发无需注入。
      const rawHops = (this.env.TRUST_PROXY_HOPS ?? '').trim()
      const hops = Number(rawHops)
      if (!Number.isInteger(hops) || hops < 1) {
        throw new Error(
          `启动失败：生产环境必须注入 TRUST_PROXY_HOPS 且为 ≥1 的整数（当前=${
            rawHops === '' ? '未设置' : rawHops
          }）。` +
            'nginx→nest 一跳填 1，多级反代按级数递增；0/非法值会让限流键与 secure 推定退化（d058），生产禁用。'
        )
      }
      // z054：生产显式开启逃生开关（ALLOW_INSECURE=1）时告警——它关闭 cookie Secure，
      // 使 JWT 走明文，仅限本地/演示；生产应配 TLS 证书而非此开关。
      if (this.allowInsecure) {
        console.warn(
          '[ConfigService] ⚠️ ALLOW_INSECURE=1 已启用：auth cookie 的 Secure 关闭、JWT 明文传输。' +
            '仅限本地开发；生产环境请改用 TLS 证书（./certs/），否则中间人可接管账号。'
        )
      }
    }
    void this.dbConfig
  }
}
