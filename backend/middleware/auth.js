import jwt from 'jsonwebtoken'

// 强制要求环境变量配置 JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET 环境变量未设置！\n' +
      '请在 server/.env 文件中配置 JWT_SECRET（至少32位随机字符串）。\n' +
      "生成方式: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
      '可参考 server/.env.example 模板。'
  )
}

// 安全检查：确保密钥长度足够
if (JWT_SECRET.length < 32) {
  throw new Error(
    'FATAL: JWT_SECRET 长度不足！\n' +
      '当前长度: ' +
      JWT_SECRET.length +
      '，要求至少 32 字符。\n' +
      '请更新 server/.env 中的 JWT_SECRET。'
  )
}

// 开发环境警告：如果使用的是弱密钥
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  if (JWT_SECRET.length < 64 || JWT_SECRET.match(/^(test|dev|demo|example)/i)) {
    console.warn(
      '[WARN] 当前 JWT_SECRET 强度不足，仅适用于本地开发！\n' +
        "       生产环境请使用: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
}

export function authenticate(req, res, next) {
  // @arch-note SEC-001: 优先从 cookie 读取 token，兼容从 header 读取
  let token = req.cookies?.auth_token
  if (!token) {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7)
    }
  }

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = { id: decoded.id, username: decoded.username }
    next()
  } catch {
    return res.status(401).json({ error: '认证令牌无效或已过期' })
  }
}

export function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
}
