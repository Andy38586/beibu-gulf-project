#!/usr/bin/env node
/**
 * csp-sync.mjs — CSP 双配置同步守卫（审查 z153 第②步）。
 *
 * 为什么需要：生产 443/8443 的 server 块由 `docker-entrypoint.sh` 内嵌 heredoc 生成，
 * `nginx.conf` 负责 :80 / 本地口——**同一份 CSP 手抄在两处**。而 nginx 的 `add_header`
 * 是层级全量替换语义，逼得每个自带 add_header 的 location 都要重复一份 CSP，
 * 于是同一策略在两文件里各出现 9 次。本项目已两次栽在这类双份配置上
 * （Cache-Control 重复头、CSP 只在 :80 生效而生产流量走 443）。
 *
 * 本守卫断言：
 *   ① 两文件都有 CSP 声明，且**条数相等**；
 *   ② 全部声明**逐字相同**（单一事实源，杜绝"改了 server 级以为全站生效"）；
 *   ③ 策略里含上报指令（report-uri / report-to）——没有它 Report-Only 等于没接记录仪，
 *      收紧 connect-src 与最终切强制都失去数据依据。
 *
 * 用法：node tools/v3-guard/csp-sync.mjs   （不一致 exit 1）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const CSP_RE = /Content-Security-Policy-Report-Only\s+"([^"]*)"/g
const REPORT_DIRECTIVE_RE = /\breport-(?:uri|to)\b/

/** 抽出某份配置里的全部 CSP 策略串 */
export function extractPolicies(text) {
  return [...text.matchAll(CSP_RE)].map((m) => m[1])
}

/**
 * 抽出全部 `location <path> { ... }` 块（花括号配对扫描，可跨嵌套 if 等子块）。
 * @returns {Array<{path: string, body: string}>}
 */
export function extractLocationBlocks(text) {
  const out = []
  const re = /location\s+([^\s{]+)\s*\{/g
  let m
  while ((m = re.exec(text))) {
    const start = re.lastIndex
    let depth = 1
    let i = start
    while (i < text.length && depth > 0) {
      const ch = text[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    out.push({ path: m[1], body: text.slice(start, i - 1) })
  }
  return out
}

/**
 * 修复（P1-10，2026-09-15）：断言「每个自带 add_header 的 location 都必须重复一份 CSP」。
 * 机理：nginx 的 add_header 是**层级全量替换**——子级只要出现任意一条 add_header，父级（server 块）
 * 的所有 add_header 即不再继承。故只在 server 级放 CSP 是不够的，凡是自带 add_header 的 location
 * 漏写 CSP，该路径的 CSP/HSTS 等安全头会全部丢失（线上实测踩过）。
 * @returns {string[]} 违规的 location 路径
 */
export function locationsMissingCsp(text) {
  const bad = []
  for (const { path: p, body } of extractLocationBlocks(text)) {
    const hasAddHeader = /^[^\S\n]*add_header\b/m.test(body)
    if (!hasAddHeader) continue // 无 add_header → 正常继承 server 级 CSP
    if (!/Content-Security-Policy/.test(body)) bad.push(p)
  }
  return bad
}

/**
 * 纯函数便于单测：两文件文本 → 问题列表（空数组 = 通过）
 * @returns {string[]}
 */
export function auditCspSync(entrypointText, nginxText) {
  const problems = []
  const a = extractPolicies(entrypointText)
  const b = extractPolicies(nginxText)

  if (a.length === 0) problems.push('docker-entrypoint.sh 未找到 CSP 声明（正则或文件结构变了？）')
  if (b.length === 0) problems.push('nginx.conf 未找到 CSP 声明（正则或文件结构变了？）')
  if (a.length !== 0 && b.length !== 0 && a.length !== b.length) {
    problems.push(
      `CSP 声明条数不一致：docker-entrypoint.sh ${a.length} 条 vs nginx.conf ${b.length} 条——` +
        `两者必须同步（生产跑前者生成的 https.conf，:80/本地走后者）`
    )
  }

  const all = [...new Set([...a, ...b])]
  if (all.length > 1) {
    problems.push(
      `存在 ${all.length} 种不同的 CSP 策略串——必须是单一事实源：\n` +
        all.map((p, i) => `    [${i + 1}] ${p.slice(0, 110)}…`).join('\n')
    )
  }

  for (const p of all) {
    if (!REPORT_DIRECTIVE_RE.test(p)) {
      problems.push(
        'CSP 策略缺少上报指令（report-uri / report-to）——Report-Only 无上报端点 = 收集到 0 条数据'
      )
      break
    }
  }

  // ④ 每个自带 add_header 的 location 都必须重复一份 CSP（见 locationsMissingCsp 注释）
  for (const p of locationsMissingCsp(nginxText)) {
    problems.push(
      `nginx.conf location ${p}：声明了 add_header 但未重复 CSP——` +
        'nginx add_header 层级全量替换会丢掉该路径的全部安全头'
    )
  }
  for (const p of locationsMissingCsp(entrypointText)) {
    problems.push(
      `docker-entrypoint.sh（https.conf 段）location ${p}：声明了 add_header 但未重复 CSP（同上层级替换语义）`
    )
  }
  return problems
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const entrypoint = readFileSync(path.join(ROOT, 'docker-entrypoint.sh'), 'utf8')
  const nginx = readFileSync(path.join(ROOT, 'nginx.conf'), 'utf8')
  const problems = auditCspSync(entrypoint, nginx)
  if (problems.length > 0) {
    console.error('[csp-sync] FAIL：')
    for (const p of problems) console.error(`  · ${p}`)
    process.exit(1)
  }
  const n = extractPolicies(entrypoint).length
  console.log(`[csp-sync] OK：两份配置各 ${n} 条 CSP 声明，逐字一致且含上报指令`)
}
