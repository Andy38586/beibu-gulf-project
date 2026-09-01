import jwt from 'jsonwebtoken'

// JWT 工具：对齐老 Express middleware/auth.js 的签发/验签行为
//（payload {id, username, tokenVersion}，7 天有效期，secret 强制 ≥32 位）

export interface JwtPayload {
  id: string
  username: string
  tokenVersion: number
}

// 强校验对齐 Express：缺 secret / 长度不足直接抛错（fail fast，不带着弱配置上线）
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'FATAL: JWT_SECRET 环境变量未设置！\n' +
        '请在 backend/nest/.env 文件中配置 JWT_SECRET（至少32位随机字符串）。\n' +
        "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  if (secret.length < 32) {
    throw new Error(
      'FATAL: JWT_SECRET 长度不足！\n' +
        `当前长度: ${secret.length}，要求至少 32 字符。\n` +
        '请更新 backend/nest/.env 中的 JWT_SECRET。'
    )
  }
  return secret
}

export function generateToken(user: {
  id: string
  username: string
  tokenVersion?: number
}): string {
  return jwt.sign(
    { id: user.id, username: user.username, tokenVersion: user.tokenVersion ?? 0 },
    getJwtSecret(),
    { expiresIn: '7d' }
  )
}

// 验签失败（过期/伪造/格式坏）返回 null，不抛错——调用方统一走 401 文案
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    if (typeof decoded === 'string') return null
    return {
      id: String(decoded.id),
      username: String(decoded.username),
      tokenVersion: Number(decoded.tokenVersion ?? 0),
    }
  } catch {
    return null
  }
}
