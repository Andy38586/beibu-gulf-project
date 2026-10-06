#!/usr/bin/env node
/**
 * nest-controllers.mjs — controller 面契约（数据面 + 参数面 + 公开面）。
 *
 * 原 `nest-controllers`（z055 承接体）只守数据面；d025 加了 @Body 参数面、
 * d026/d050 加了公开面/限流豁免，三条都是"controller 这一层"的契约 ⇒ 2026-10-06 合并改名，
 * 名字与判据面保持一致（名实一致）。
 *
 * 原 cruise 规则 `nest-controllers-not-read-data-files` 守的是静态 import 边
 * （to: ^backend/data/）——controller 从不 import 数据文件，真实违例面是
 * **运行时会话**：注入 DataFilesService、readFileSync('backend/data/...')。
 * 静态 import 分析够不着运行时路径 ⇒ 该规则名实不副、恒 0 条边、永不红（04-F1）。
 * 本守卫把判据搬到真正的违例面上（grep 级），可红、有阳性对照。
 *
 * 判据：modules 下各域 controllers 目录的 .ts 内出现以下任一形态即失败——
 *   ① `backend/data` 路径字面量；② DataFilesService / dataFiles 引用；
 *   ③ node:fs / fs 导入或 readFileSync 调用。
 * 数据访问一律经 service → repository（db.config 禁默认口令同款分层铁律）。
 *
 * 第二条判据（d025 收口，2026-10-06）：**@Body 参数校验收口**——
 *   controller 的 `@Body()` 必须经 `DtoPipe(<DTO>.parse)`（auth/favorites/plans/forecast/task 同口径），
 *   或在 `BODY_VALIDATION_EXEMPTIONS` 逐条登记（豁免必须写明校验落点）。
 *   为什么：d025 的老形态就是 controller 里 `typeof` + 手写枚举校验，与 DTO 的校验两处维护 ⇒
 *   `HTTP_TASK_DOMAINS` 与 `TaskDomain` 漂移过一次（forecast-map 恒 400）。裸 body 只在
 *   "校验单点在 service 且能指出行号"时才算合法豁免；新写一处裸 body = 新长一处第二校验口。
 *
 * 第三条判据（d026/d050 收口，2026-10-06）：**公开面与限流豁免必须登记且与实装一致**——
 *   每个 controller 必须在 `CONTROLLER_FACE` 出现一次，声明 `needAuth`（是否有 @UseGuards）与
 *   `skipAuthBuckets`（是否挂 @SkipThrottle），守卫按注释剥离后的真实装饰器对账；
 *   新控制器未登记 ⇒ 红（"新增控制器默认入 login 桶"= 必须先做一次显式取舍再登记）。
 *
 * 用法：node tools/v3-guard/nest-controllers.mjs   # 有违例 exit 1
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 注释剥离：判定只认真实装饰器，注释里提到 @UseGuards/@SkipThrottle 不算（task 注释即此形态） */
const stripComments = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const FORBIDDEN = [
  { re: /backend\/data/, why: 'backend/data 路径字面量（数据访问须经 service → repository）' },
  { re: /\bDataFilesService\b/, why: '注入 DataFilesService（controller 不得直读数据文件）' },
  { re: /\bdataFiles\b/, why: 'dataFiles 引用（DataFilesService 实例）' },
  { re: /from 'node:fs'|from "node:fs"|require\('node:fs'\)/, why: 'controller 导入 node:fs' },
  { re: /\breadFileSync\b|\bfs\.read\b/, why: '文件读取 API（数据文件读取收口在 infra/files）' },
]

/**
 * @Body 校验豁免清单（d025）：每条必须给「为什么可以不经 DtoPipe」+「校验落点」。
 * 不在本表的裸 `@Body(` ⇒ 红。新增豁免属改判据域（AGENTS §四-10），须用户批准。
 */
export const BODY_VALIDATION_EXEMPTIONS = [
  {
    file: 'backend/src/modules/flood/controllers/flood.controller.ts',
    why: 'body 只有一个可选 waterLevel，校验单点在 service 的 validateWaterLevel（域解析函数，与会话口径同源），加 DtoPipe 会造第二份水位解析',
    anchor: 'backend/src/modules/flood/services/flood.service.ts:118 validateWaterLevel',
  },
]

/**
 * 公开面登记表（d026/d050）：controller → 是否需登录（@UseGuards）+ 是否豁免命名桶（@SkipThrottle）。
 * 两条都要写 why；`skipAuthBuckets` 的通行理由 = 命名桶默认套用全部路由，不豁免就会被
 * login/register 桶（50/15min）误伤（2026-09-10 flood、09-12 三域两次踩坑）。
 */
export const CONTROLLER_FACE = [
  {
    file: 'backend/src/modules/auth/controllers/auth.controller.ts',
    needAuth: true,
    skipAuthBuckets: true,
    why: '登录/注册/登出/me：登录路由只关 register 桶、注册路由只关 login 桶（逐路由豁免），其余路由需 AuthGuard',
  },
  {
    file: 'backend/src/modules/diversion/controllers/diversion.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '公开：分流查询不读用户数据',
  },
  {
    file: 'backend/src/modules/favorites/controllers/favorites.controller.ts',
    needAuth: true,
    skipAuthBuckets: true,
    why: '需登录：收藏读写带属主；豁免命名桶（登录用户操作不应消耗 login 配额）',
  },
  {
    file: 'backend/src/modules/flood/controllers/flood.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '公开：浸没计算不读用户数据；高频交互豁免命名桶（09-10 事故）',
  },
  {
    file: 'backend/src/modules/forecast/controllers/forecast.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '公开：预测计算；时间轴轮播为合法高频交互',
  },
  {
    file: 'backend/src/modules/plans/controllers/plans.controller.ts',
    needAuth: true,
    skipAuthBuckets: true,
    why: '需登录：方案读写带属主；豁免命名桶',
  },
  {
    file: 'backend/src/modules/route/controllers/route.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '公开：路网计算；地图高频交互豁免命名桶（漏挂即 15 分钟 51 次 429）',
  },
  {
    file: 'backend/src/modules/site-suitability/controllers/site-suitability.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '公开：选址适宜性计算不读用户数据',
  },
  {
    file: 'backend/src/modules/task/controllers/task.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '公开：纯计算任务，属主经 request-owner 解析；将来携带私有参数必须先补 @UseGuards（见控制器注释）',
  },
  {
    file: 'backend/src/health/health.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '探针全桶豁免：10s 间隔 ≈90 次/15min 会耗尽认证桶 ⇒ 探针自 429 ⇒ 容器永久 unhealthy',
  },
  {
    file: 'backend/src/csp-report/csp-report.controller.ts',
    needAuth: false,
    skipAuthBuckets: true,
    why: '匿名上报接收：限流会丢上报（body 由匿名请求控制，净化在 common/utils）',
  },
]

/** 列出全部 controller 文件（modules 各域 controllers 目录 + 两个独立控制器 health/csp-report） */
export function listControllers(root = ROOT) {
  const modulesDir = path.join(root, 'backend/src/modules')
  const files = []
  for (const mod of readdirSync(modulesDir)) {
    const ctrlDir = path.join(modulesDir, mod, 'controllers')
    try {
      for (const f of readdirSync(ctrlDir)) {
        if (f.endsWith('.controller.ts')) files.push(path.join(ctrlDir, f))
      }
    } catch {
      // 该模块无 controllers 目录（如 infra）——跳过
    }
  }
  for (const rel of [
    'backend/src/health/health.controller.ts',
    'backend/src/csp-report/csp-report.controller.ts',
  ]) {
    const abs = path.join(root, rel)
    if (existsSync(abs)) files.push(abs)
  }
  return files.sort()
}

/**
 * 审计 controller 数据访问面。
 * @returns {{ violations: Array<{file: string, line: number, text: string, why: string}> }}
 */
export function auditControllers(files, { root = ROOT, face = CONTROLLER_FACE } = {}) {
  const violations = []
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      for (const { re, why } of FORBIDDEN) {
        if (re.test(text)) {
          violations.push({
            file: rel,
            line: i + 1,
            text: text.trim().slice(0, 100),
            why,
          })
        }
      }
      // @Body 校验收口（d025）：裸 @Body( 且未登记豁免 ⇒ 违例
      if (/@Body\(/.test(text) && !/@Body\(new DtoPipe\(/.test(text)) {
        if (!BODY_VALIDATION_EXEMPTIONS.some((e) => e.file === rel)) {
          violations.push({
            file: rel,
            line: i + 1,
            text: text.trim().slice(0, 100),
            why: '@Body 未经 DtoPipe(<DTO>.parse) 收口，且不在 BODY_VALIDATION_EXEMPTIONS（d025）',
          })
        }
      }
    })
    // 公开面/限流豁免（d026/d050）：必须登记，且声明与实装一致（注释剥离后判）
    const code = stripComments(readFileSync(file, 'utf8'))
    const declared = face.find((e) => e.file === rel)
    if (!declared) {
      violations.push({
        file: rel,
        line: 1,
        text: '',
        why: '新 controller 未登记公开面（d026）：先定它是否需要登录、是否豁免命名桶，再进 CONTROLLER_FACE',
      })
    } else {
      const hasGuard = /@UseGuards\(/.test(code)
      const hasSkip = /@SkipThrottle\(/.test(code)
      if (hasGuard !== declared.needAuth)
        violations.push({
          file: rel,
          line: 1,
          text: `实装 @UseGuards=${hasGuard}`,
          why: `公开面登记与实装不符：登记 needAuth=${declared.needAuth}（d026）`,
        })
      if (hasSkip !== declared.skipAuthBuckets)
        violations.push({
          file: rel,
          line: 1,
          text: `实装 @SkipThrottle=${hasSkip}`,
          why: `限流豁免登记与实装不符：登记 skipAuthBuckets=${declared.skipAuthBuckets}（d050）`,
        })
    }
  }
  return { violations }
}

// ---------- main ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const files = listControllers()
  const { violations } = auditControllers(files)
  console.log(`[nest-controllers] 扫描 ${files.length} 个 controller`)
  if (violations.length) {
    for (const v of violations) {
      console.error(`✗ ${v.file}:${v.line} ${v.why}\n    ${v.text}`)
    }
    console.error(`\n[nest-controllers] ${violations.length} 处违例`)
    process.exit(1)
  }
  console.log('[nest-controllers] controller 无直读数据文件 ✓')
}
