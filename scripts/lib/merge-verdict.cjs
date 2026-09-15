/**
 * 合入准入结论判定（EP-DYN，2026-09-15）。从 pre-merge-check.cjs 抽出为纯函数，便于注入测试。
 *
 * 背景：旧逻辑只要没有 FAIL 就一律「READY TO MERGE / main CI 不会红」并 exit 0——
 * 但 --static/--skip-tests/--skip-build/--no-secret-scan 会让测试、构建、密钥扫描根本不执行，
 * 「没检查」被当成「检查通过」= 直接放行。新三态结论：
 *   BLOCKED(1)：存在 FAIL，合入必红；
 *   PARTIAL(2)：无 FAIL，但验证类关卡被跳过且未显式确认——不能保证 main CI 绿，不放行；
 *   READY(0)  ：无 FAIL 且验证齐全；或验证有跳过但调用方显式 ackSkip（容错通道，故意且留痕）。
 */

/**
 * @param {{tests:boolean, build:boolean, secretScan:boolean}} flags 三项验证是否【会执行】
 * @returns {string[]} 被跳过、因此不足以担保合入的验证项中文名（空=齐全）
 */
function listVerificationSkipped(flags) {
  const out = []
  if (!flags.tests) out.push('测试（前端 / tools / 后端 / pytest 全未执行）')
  if (!flags.build) out.push('生产构建（npm run build 未执行）')
  if (!flags.secretScan) out.push('增量密钥扫描（--no-secret-scan 已关闭）')
  return out
}

/**
 * @param {number} failsCount 阻断项数量
 * @param {string[]} verificationSkipped 被跳过的验证项（listVerificationSkipped 的结果）
 * @param {boolean} ackSkip 是否显式 --acknowledge-skip
 * @returns {{code:0|1|2, verdict:'BLOCKED'|'PARTIAL'|'READY'|'READY_ACK'}}
 */
function decideVerdict(failsCount, verificationSkipped, ackSkip) {
  if (failsCount > 0) return { code: 1, verdict: 'BLOCKED' }
  if (verificationSkipped.length > 0 && !ackSkip) return { code: 2, verdict: 'PARTIAL' }
  if (verificationSkipped.length > 0 && ackSkip) return { code: 0, verdict: 'READY_ACK' }
  return { code: 0, verdict: 'READY' }
}

module.exports = { listVerificationSkipped, decideVerdict }
