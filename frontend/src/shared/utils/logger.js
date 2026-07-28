// 统一 logger，生产环境自动静默 debug/info
const isDev = import.meta.env.DEV

export const logger = {
  debug: (...args) => isDev && console.log(...args),
  info: (...args) => isDev && console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
