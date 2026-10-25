#!/usr/bin/env node
/**
 * compat-endpoints.mjs — 内部/兼容端点登记的一致性守卫（1004-F14 · D26 升格为登记守卫）。
 *
 * 治什么：`backend/src/routes.compat.ts` 的 `COMPAT_ENDPOINTS` 声明「Express 遗留、前端零
 * 消费、保留不删」。这份声明有两条前提必须持续成立，否则声明与现状分叉成幽灵记录：
 *   ① 每条端点仍在 `backend/src/routes.manifest.ts`（端点被删而登记未撤 ⇒ 幽灵声明）；
 *   ② 前端仍**零消费**其 URL 形态（出现调用方 ⇒ 该接线，或从登记里删）。
 *
 * 判据输入：三份受版本控制的源（`routes.compat.ts` / `routes.manifest.ts` / `frontend/src`）。
 * 权威 = `routes.compat.ts` 的 `COMPAT_ENDPOINTS`（K3 只指向它，不另抄一份）。
 * 按 v3-guard 惯例**正则解析** TS 权威源，不 `import` `*.ts`（不依赖 node 的 type-stripping）。
 *
 * 已知漏口（如实写）：条目若改成非 `{ method, path, consumerRe }` 的面形态则解析不到 ——
 * 解析为空时**直接判失败**（不静默放行，§5.4「分母归零比判红更危险」）。
 *
 * 用法：node tools/v3-guard/compat-endpoints.mjs   # 违例 exit 1
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { walkFiles } from './lib/walk.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const COMPAT_SRC = path.join(ROOT, 'backend/src/routes.compat.ts')
const MANIFEST = path.join(ROOT, 'backend/src/routes.manifest.ts')
const FRONTEND = path.join(ROOT, 'frontend/src')

/** 条目形态：`{ method: 'X', path: 'Y'[, consumerRe: /…/] }`（正则字面量按转义/字符类稳健匹配） */
const ENTRY_RE =
  /\{\s*method:\s*'([A-Z]+)'\s*,\s*path:\s*'([^']+)'\s*(?:,\s*consumerRe:\s*(\/(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[a-z]*))?\s*\}/g

/** 从权威源 TS 文本解析 COMPAT_ENDPOINTS（内部，不导出——变异注入面保持唯一） */
function parseCompatEndpoints(ts) {
  const out = []
  for (const m of ts.matchAll(ENTRY_RE)) {
    let consumerRe
    if (m[3]) {
      const end = m[3].lastIndexOf('/')
      consumerRe = new RegExp(m[3].slice(1, end), m[3].slice(end + 1))
    }
    out.push({ method: m[1], path: m[2], consumerRe })
  }
  return out
}

/**
 * 审计纯函数（**唯一导出**；输入全为文本，便于红样与变异复验）。
 * @param {{ compatText: string, manifestText: string, frontendFiles: Array<{path: string, text: string}> }} input
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditCompatEndpoints({ compatText, manifestText, frontendFiles }) {
  const endpoints = parseCompatEndpoints(compatText)
  if (endpoints.length === 0) {
    return ['COMPAT_ENDPOINTS 解析为空 —— 权威源读不到（面形态变了？），拒绝放行']
  }
  const problems = []
  for (const e of endpoints) {
    if (!manifestText.includes(`{ method: '${e.method}', path: '${e.path}' }`)) {
      problems.push(`manifest 缺 ${e.method} ${e.path} —— 端点被删而登记未撤，属幽灵声明`)
    }
  }
  for (const { path: rel, text } of frontendFiles) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (endpoints.some((e) => e.consumerRe?.test(line))) {
        problems.push(
          `${rel}:${i + 1} 前端消费了登记的兼容端点 URL 形态 —— 须重裁「接线 vs 删登记」`
        )
      }
    })
  }
  return problems
}

/** 前端源文件（跳过测试夹具：登记表的消费面只看产品代码） */
function frontendSources(dir) {
  return walkFiles(dir, {
    match: (name) => /\.(ts|vue|js|mjs)$/.test(name),
    skip: ['__tests__'],
    relBase: ROOT,
    output: 'sources',
  })
}

function main() {
  const problems = auditCompatEndpoints({
    compatText: readFileSync(COMPAT_SRC, 'utf8'),
    manifestText: readFileSync(MANIFEST, 'utf8'),
    frontendFiles: frontendSources(FRONTEND),
  })
  if (problems.length) {
    console.error('[compat-endpoints] 未通过：兼容端点登记与现状分叉')
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  console.log('[compat-endpoints] OK：登记的兼容端点仍在 manifest，且前端零消费 ✓')
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
