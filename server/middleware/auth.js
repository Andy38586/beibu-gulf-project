import jwt from 'jsonwebtoken'

const DEV_SECRET = 'beibu-gulf-dev-secret-2024'
const isProd = process.env.NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || (isProd ? null : DEV_SECRET)

if (!JWT_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET 环境变量未设置！\n' +
    '请在 server/.env 文件中配置 JWT_SECRET（至少32位随机字符串）。\n' +
    '可参考 server/.env.example 模板。'
  )
}

if (!isProd && JWT_SECRET === DEV_SECRET) {
  console.warn(
    '[WARN] 当前使用默认开发密钥，仅适用于本地开发！\n' +
    '       生产环境必须设置 JWT_SECRET 环境变量。'
  )
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' })
  }
  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = { id: decoded.id, username: decoded.username }
    next()
  } catch (err) {
    return res.status(401).json({ error: '认证令牌无效或已过期' })
  }
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
}
