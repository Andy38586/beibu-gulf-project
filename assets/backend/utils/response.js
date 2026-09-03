/**
 * 统一成功响应：所有 controller 经 sendSuccess 返回 envelope（接口响应信封 {code, data}），
 * 前端 useApiRequest 检测到 code + data 字段即自动解包返回 data
 */

/**
 * 发送统一信封式成功响应
 * @param {import('express').Response} res - Express 响应对象
 * @param {unknown} data - 业务数据
 * @param {number} [statusCode=200] - HTTP 状态码（创建资源用 201）
 */
export function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json({ code: statusCode, data })
}
