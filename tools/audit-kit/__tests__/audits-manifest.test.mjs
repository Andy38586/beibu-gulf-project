/**
 * audits-manifest 的自测（真红样：判据必须能报「审件库不见了/内容被改了」）。
 *
 * 探针只做一件事：把「审件库仍在、批次没丢、文件数没变」变成一条可复算的凭据。
 * 因此用例分两类——正常面（假库能跑出确定性输出）与失效面（库不存在必须 FAIL）。
 * 假库用 mkdtemp 建，绝不指向真实桌面库（测试不得依赖本机数据）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../audits-manifest.cjs')

const TMP_ROOTS = []

function makeFakeLib(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w52-manifest-'))
  TMP_ROOTS.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

function run(root) {
  const env = { ...process.env, AUDITS_DIR: root }
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      // cwd 必须是真实存在的目录：Windows 上 spawn 一个不存在的工作目录会直接
      // ENOENT，被测进程根本没跑起来——那样测到的是 spawn 失败，不是判据失效。
      cwd: fs.existsSync(root) ? root : process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    return { code: 0, stdout, stderr: '', message: '' }
  } catch (e) {
    // 子进程非零退出时 stdout/stderr 挂在 error 上，部分版本还会把 stderr
    // 拼进 message —— 三处都收，否则失败面断言会因取错字段而假绿。
    return {
      code: e.status ?? e.code ?? 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
      message: String(e.message ?? ''),
    }
  }
}

const both = (r) => r.stdout + r.stderr + r.message

afterAll(() => {
  for (const root of TMP_ROOTS) fs.rmSync(root, { recursive: true, force: true })
})

describe('audits-manifest（W52 D4 等价凭据）', () => {
  it('正常面：输出批次清单 + 逐文件 md5，且确定性（两次跑同一库结果一致）', () => {
    const lib = makeFakeLib({
      '1003/README.md': '# 1003 批\n',
      '1003/00-记分卡.md': 'score\n',
      '1004/a.md': 'a\n',
      '00-总索引.md': 'index\n',
      'README.md': 'readme\n',
      'notes.txt': 'top-evidence\n',
    })

    const first = run(lib)
    expect(first.code).toBe(0)
    expect(first.stdout).toContain('批次 2 个')
    expect(first.stdout).toContain('文件 6 份')
    expect(first.stdout).toContain('batch 1003')
    expect(first.stdout).toContain('batch 1004')
    // 顶层只收批次级证据（归并映射/总索引/README），且必须出现在清单里
    expect(first.stdout).toContain('top 00-总索引.md')
    expect(first.stdout).toContain('top README.md')
    expect(first.stdout).toContain('top notes.txt')

    const second = run(lib)
    expect(second.stdout).toBe(first.stdout)
  })

  it('@guard-red-sample 失效面：审件库不存在 ⇒ FAIL 且指明改 paths.mjs，不许静默 OK', () => {
    const missing = path.join(os.tmpdir(), `w52-missing-${process.pid}`)
    const r = run(missing)

    // 非零即失败（exit 1 或 spawn 级 ENOENT 都不算通过）
    expect(r.code).not.toBe(0)
    expect(both(r)).toContain('审件库不存在')
    // 关键：提示必须指向单一真相源（paths.mjs / AUDITS_DIR），
    // 否则读侧会去本仓重建副本——那正是 W52 要防的事
    expect(both(r)).toContain('paths.mjs')
  })

  it('内容被改 ⇒ md5 行随之变（凭据的敏感性，不是恒真输出）', () => {
    const lib = makeFakeLib({ '1003/a.md': 'before\n' })
    const before = run(lib)
    fs.writeFileSync(path.join(lib, '1003/a.md'), 'after\n')
    const after = run(lib)

    expect(before.stdout).not.toBe(after.stdout)
  })
})
