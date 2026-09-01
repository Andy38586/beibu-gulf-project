import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// 背景：T3.1 接手对账时实锤 package.json 与 lockfile 失步——pg/jsonwebtoken/cookie-parser/
// @nestjs/throttler/@nestjs/swagger 只物理存在于 node_modules 而未声明（大概率 --no-save 安装），
// 当时 ci 全绿纯靠 node_modules 现状，全新 npm ci 必挂（tsc/vitest 只解析 node_modules，
// 不校验 package.json 声明，静态门禁拦不住）。本测试守住"src 的外部依赖必须声明"这条线。

const NEST_ROOT = join(__dirname, '..')
const SRC_DIR = join(NEST_ROOT, 'src')

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listTsFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

// 值导入（import ... from 'x' / import 'x'）：运行时真实解析，缺失 = 运行时崩溃。
// import type / export type 只在编译期消费，缺失由 tsc 构建门禁兜底（TS7016/TS2307），不在此重复
function extractValueImports(code: string): string[] {
  const stripped = code.replace(/^\s*(import|export)\s+type\b[\s\S]*?from\s*['"][^'"]*['"]/gm, '')
  const specifiers: string[] = []
  for (const m of stripped.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(m[1])
  }
  for (const m of stripped.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(m[1])
  }
  return specifiers.filter(
    (s) => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('node:')
  )
}

function packageName(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
}

describe('src 外部依赖必须声明在 package.json', () => {
  const pkg = JSON.parse(readFileSync(join(NEST_ROOT, 'package.json'), 'utf-8'))
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])

  const files = listTsFiles(SRC_DIR)
  const importsByFile = files.map((file) => ({
    file,
    imports: extractValueImports(readFileSync(file, 'utf-8')),
  }))

  it('扫描到非空文件集（防目录漂移导致测试空转）', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(importsByFile.some((f) => f.imports.length > 0)).toBe(true)
  })

  it.each(importsByFile.map((f) => [f.file.replace(SRC_DIR, 'src'), f.imports]))(
    '%s 的外部导入均已声明',
    (_label, imports) => {
      for (const specifier of imports) {
        expect(declared, `未声明的依赖: ${specifier}`).toContain(packageName(specifier))
      }
    }
  )
})
