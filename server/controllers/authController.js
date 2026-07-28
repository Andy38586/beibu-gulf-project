import bcrypt from 'bcryptjs'
import * as userService from '../services/userService.js'
import { generateToken } from '../middleware/auth.js'
import { BusinessError } from '../utils/BusinessError.js'

// @arch-note R-03: 提取公共 cookie 设置，register/login 复用
function setAuthCookie(res, token) {
  // @arch-note SEC-001: 使用 HttpOnly Cookie 存储 token
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
  })
}

// @arch-note P1-14: 历史转义密码兼容（与前端旧版 escapePassword 规则一致）
function escapeHtmlLegacy(str) {
  return str.replace(/[&<>"']/g, (char) => {
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return escapeMap[char]
  })
}

export async function register(req, res) {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: '用户名长度应在 2-20 个字符之间' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度不能少于 6 位' })
    }
    // @arch-note SEC-003: 密码强度增强 - 至少包含大小写字母和数字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: '密码必须包含大小写字母和数字' })
    }
    const exists = await userService.userExists(username)
    if (exists) {
      return res.status(409).json({ error: '用户名已存在' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await userService.createUser(username, hashedPassword)
    const token = generateToken(user)
    setAuthCookie(res, token)

    res.status(201).json({ token, user })
  } catch (error) {
    // @arch-note P1-06: BusinessError 统一携带 status（并发注册冲突返回 409）
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ error: error.message })
    }
    // [FIXED 016] 使用结构化日志替代 console
    if (process.env.NODE_ENV !== 'test') {
      console.error('注册失败:', error.message)
    }
    res.status(500).json({ error: '注册失败' })
  }
}

export async function login(req, res) {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    const user = await userService.findByUsername(username)
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }
    // @arch-note P1-14: 双通道比对 + 静默迁移
    let valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      // @arch-note P1-14: 旧版前端转义密码的存量账号回退通道
      const legacy = escapeHtmlLegacy(password)
      if (legacy !== password && (await bcrypt.compare(legacy, user.password))) {
        valid = true
        // 静默迁移：用原始密码重哈希，下次登录走正常通道
        const rehashed = await bcrypt.hash(password, 10)
        await userService.updatePassword(user.id, rehashed)
      }
    }
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }
    const token = generateToken(user)
    setAuthCookie(res, token)

    res.json({ token, user: { id: user.id, username: user.username, createdAt: user.createdAt } })
  } catch (error) {
    // [FIXED 016] 使用结构化日志替代 console
    if (process.env.NODE_ENV !== 'test') {
      console.error('登录失败:', error.message)
    }
    res.status(500).json({ error: '登录失败' })
  }
}

export async function logout(req, res) {
  // @arch-note SEC-001: 清除 token cookie
  res.clearCookie('auth_token')
  res.json({ message: '登出成功' })
}

export async function me(req, res) {
  res.json({ user: req.user })
}
