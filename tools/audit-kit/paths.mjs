/**
 * 审查体系的路径单点。文档里只写逻辑名「审件库」，物理位置只在这一处定义。
 *
 * AUDITS_DIR 可被环境变量覆盖 —— 审件搬到独立版本库后，主仓不必再持有该目录。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SPEC_DIR = path.join(ROOT, 'docs/根基文档/审查体系专项')
export const CONVENTION = path.join(SPEC_DIR, '审查体系约定.md')
export const AUDITS_DIR = process.env.AUDITS_DIR
  ? path.resolve(process.env.AUDITS_DIR)
  : path.join(ROOT, 'docs/audits')
