/**
 * 统一成功响应工具
 *
 * 所有 controller 的成功响应统一使用 sendSuccess，保证信封格式一致：
 * { code: 200, data: <payload> }
 *
 * 前端 useApiRequest 的自动解包依赖此契约：
 * 检测到 `code` + `data` 字段时自动返回 data 部分。
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
