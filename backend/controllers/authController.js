import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as userService from '../services/userService.js'
import { generateToken } from '../middleware/auth.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

// 提取公共 cookie 设置，register/login 复用
function setAuthCookie(res, token, req) {
  // 2026-08-09 修复：Secure 由实际连接协议决定（nginx 透传 X-Forwarded-Proto），
  // 而非 NODE_ENV——生产 HTTP（无 TLS 证书）下 Secure cookie 被浏览器拒绝保存，
  // 登录成功立即失效（me 401 → 自动登出）。上 HTTPS 后 x-forwarded-proto=https 自动 Secure。
  const isHttps = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https'
  // 使用 HttpOnly Cookie 存储 token
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
  })
}

// 历史转义密码兼容（与前端旧版 escapePassword 规则一致）
function escapeHtmlLegacy(str) {
  return str.replace(/[&<>"']/g, (char) => {
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return escapeMap[char]
  })
}

export async function register(req, res, next) {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名和密码不能为空')
    }
    if (username.length < 2 || username.length > 20) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名长度应在 2-20 个字符之间')
    }
    if (password.length < 6) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '密码长度不能少于 6 位')
    }
    // 密码强度增强 - 至少包含大小写字母和数字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/
    if (!passwordRegex.test(password)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '密码必须包含大小写字母和数字')
    }
    const exists = await userService.userExists(username)
    if (exists) {
      throw new BusinessError(ErrorCode.DUPLICATE_USERNAME, '用户名已存在')
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await userService.createUser(username, hashedPassword)
    const token = generateToken(user)
    setAuthCookie(res, token, req)

    logger.audit('REGISTER', { userId: user.id, username, ip: req.ip })
    sendSuccess(res, { user }, 201)
  } catch (error) {
    next(error)
  }
}

export async function login(req, res, next) {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名和密码不能为空')
    }
    const user = await userService.findByUsername(username)
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '用户名或密码错误')
    }
    // 双通道比对 + 静默迁移
    let valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      // 旧版前端转义密码的存量账号回退通道
      const legacy = escapeHtmlLegacy(password)
      if (legacy !== password && (await bcrypt.compare(legacy, user.password))) {
        valid = true
        // 静默迁移：用原始密码重哈希，下次登录走正常通道
        const rehashed = await bcrypt.hash(password, 10)
        await userService.updatePassword(user.id, rehashed)
      }
    }
    if (!valid) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '用户名或密码错误')
    }
    const token = generateToken(user)
    setAuthCookie(res, token, req)

    logger.audit('LOGIN', { userId: user.id, username: user.username, ip: req.ip })
    sendSuccess(res, { user: { id: user.id, username: user.username, createdAt: user.createdAt } })
  } catch (error) {
    next(error)
  }
}

export async function logout(req, res) {
  // 吊销令牌——解码 cookie 中的 token（不校验过期）并自增 tokenVersion，
  // 使该 token 后续在 authenticate 校验时因 tokenVersion 不匹配而失效。
  const token = req.cookies?.auth_token
  if (token) {
    try {
      // 验签后再吊销——jwt.verify 校验签名，伪造 token 视为无效直接放行，
      // 避免任意构造 payload 即让他人 tokenVersion 自增（DoS）。原 jwt.decode 仅解 base64 不验签，存在漏洞。
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      if (decoded?.id) {
        await userService.updateTokenVersion(decoded.id)
      }
    } catch {
      // 签名无效（伪造 token / 过期）不影响登出流程，仍清除 cookie，但不吊销合法用户
    }
  }
  // 清除 token cookie
  res.clearCookie('auth_token')
  logger.audit('LOGOUT', { ip: req.ip })
  sendSuccess(res, { message: '登出成功' })
}

export async function me(req, res) {
  sendSuccess(res, { user: req.user })
}
