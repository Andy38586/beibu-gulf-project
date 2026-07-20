import bcrypt from 'bcryptjs'
import * as userService from '../services/userService.js'
import { generateToken } from '../middleware/auth.js'

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
    // AUDIT-SEC-003: 密码强度增强 - 至少包含大小写字母和数字
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
    
    // AUDIT-SEC-001: 使用 HttpOnly Cookie 存储 token
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
    })
    
    res.status(201).json({ token, user })
  } catch (error) {
    // AUDIT-016 (错误): 使用结构化日志替代 console
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
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }
    const token = generateToken(user)
    
    // AUDIT-SEC-001: 使用 HttpOnly Cookie 存储 token
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
    })
    
    res.json({ token, user: { id: user.id, username: user.username, createdAt: user.createdAt } })
  } catch (error) {
    // AUDIT-016 (错误): 使用结构化日志替代 console
    if (process.env.NODE_ENV !== 'test') {
      console.error('登录失败:', error.message)
    }
    res.status(500).json({ error: '登录失败' })
  }
}

export async function logout(req, res) {
  // AUDIT-SEC-001: 清除 token cookie
  res.clearCookie('auth_token')
  res.json({ message: '登出成功' })
}

export async function me(req, res) {
  res.json({ user: req.user })
}
