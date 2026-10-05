// @vitest-environment node
/**
 * compat-endpoints — 内部/兼容端点登记守卫（1004-F14）。
 *
 * 背景：`POST /plans/:id/xiaoqu` 与 `DELETE /plans/:id/xiaoqu/:xiaoquId` 是 Express 遗留、
 * 前端零消费；K3 登记为「内部/兼容端点」保留不删。本守卫钉住这份声明的两条前提：
 *   ① 端点仍在 `backend/src/routes.manifest.ts`——端点被删除而声明未撤 ⇒ 红（"删了就红"）；
 *   ② 前端仍零消费该 URL 形态——出现调用方 ⇒ 红，声明与现状分叉，须重新决定接线或删除。
 * 登记清单以本文件 COMPAT_ENDPOINTS 为唯一权威；K3 注释只指向本文件，不另抄一份。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const COMPAT_ENDPOINTS = [
  { method: 'POST', path: 'nest-api/plans/:id/xiaoqu', consumerRe: /\/plans\/[^'"\s`]*xiaoqu/ },
  {
    method: 'DELETE',
    path: 'nest-api/plans/:id/xiaoqu/:xiaoquId',
    consumerRe: /\/plans\/[^'"\s`]*xiaoqu/,
  },
  { method: 'GET', path: 'nest-api/forecast/:portId' },
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', '__tests__'].includes(entry.name)) continue
      walk(full, out)
    } else if (/\.(ts|vue|js|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('compat-endpoints — 兼容端点登记（1004-F14）', () => {
  const manifest = readFileSync(path.join(ROOT, 'backend/src/routes.manifest.ts'), 'utf8')

  it('端点仍在 routes.manifest（删了端点不撤声明 ⇒ 红）', () => {
    for (const e of COMPAT_ENDPOINTS) {
      expect(manifest, `manifest 缺 ${e.method} ${e.path}`).toContain(
        `{ method: '${e.method}', path: '${e.path}' }`
      )
    }
  })

  it('前端仍零消费（出现登记的 URL 形态 ⇒ 红，须重裁 兼容 vs 删除）', () => {
    const hits = []
    for (const file of walk(path.join(ROOT, 'frontend/src'))) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (COMPAT_ENDPOINTS.some((e) => e.consumerRe?.test(line))) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1}`)
        }
      })
    }
    expect(hits).toEqual([])
  })
})
