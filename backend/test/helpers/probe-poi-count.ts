import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * 库内 POI 行数探测（同步，供 describe.skipIf 在 collection 期消费）。
 *
 * 为什么是同步的：skipIf 的取值在 vitest collection 期（模块加载）就要确定，
 * 异步查询拿不到时序；而 backend tsconfig 的 module/target 不支持顶层 await
 *（tsc --noEmit 是真类型门禁，不能为测试开 esnext TLA）。故用子进程同步跑
 * 一次 pg 计数：pg 模块复用 backend/node_modules（cwd 指到 backend 根），无新依赖。
 *
 * 连接参数与 src/infra/db/db.config.ts 同口径（env 缺省 postgres/postgres/v3_dev）。
 * 任何失败（库不可达 / 表不存在）都按 0 处理——调用方据此跳过数据绑定套件。
 */
export function probePoiCount(): number {
  const script = `
    const { Client } = require('pg')
    const c = new Client({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT ?? 5432),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      database: process.env.PG_DATABASE || 'v3_dev',
    })
    c.connect()
      .then(() => c.query('SELECT count(*)::int AS n FROM poi_facilities'))
      .then((r) => { console.log(r.rows[0].n); return c.end() })
      .catch((e) => { console.error(String(e && e.message)); process.exit(1) })
  `
  try {
    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..', '..'),
      encoding: 'utf8',
      timeout: 15000,
    })
    return Number(out.trim()) || 0
  } catch {
    return 0
  }
}
