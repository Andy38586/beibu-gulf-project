/**
 * 审查体系的路径单点。文档里只写逻辑名「审件库」，物理位置只在这一处定义。
 *
 * A-11 裁定（2026-10-05，用户批准）：桌面独立库为唯一落盘位，主仓 `docs/audits/`
 * 只留 README 指针。AUDITS_DIR 可被环境变量覆盖，供其它机器/独立版本库复用。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SPEC_DIR = path.join(ROOT, 'docs/根基文档/审查体系专项')
export const CONVENTION = path.join(SPEC_DIR, '审查体系约定.md')
const DEFAULT_AUDITS_DIR = 'C:/Users/JionHappY/Desktop/_北部湾项目/02-审查流水账/audits'
export const AUDITS_DIR = process.env.AUDITS_DIR
  ? path.resolve(process.env.AUDITS_DIR)
  : DEFAULT_AUDITS_DIR
