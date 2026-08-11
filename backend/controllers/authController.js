import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as userService from '../services/userService.js'
import { generateToken } from '../middleware/auth.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

// 公共 cookie 设置，register/login 复用
function setAuthCookie(res, token, req) {
  // Secure 由实际连接协议决定（含 nginx 透传的 X-Forwarded-Proto），不能按 NODE_ENV 判断：
  // 生产 HTTP 下 Secure cookie 会被浏览器拒绝保存，登录即失效
  const isHttps = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https'
  // HttpOnly 防 XSS 窃取 token
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
  // 吊销令牌：验签后自增 tokenVersion，使旧 token 在后续校验时失效
  const token = req.cookies?.auth_token
  if (token) {
    try {
      // 先验签再吊销：jwt.decode 不验签，伪造 payload 可致他人令牌被批量吊销（DoS）
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
  // 认证响应禁止缓存：Express 默认 ETag 会让刷新时返回 304，前端 fetch 视为错误而误判登出
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, { user: req.user })
}
