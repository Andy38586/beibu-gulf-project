// 统一 logger，生产环境自动静默 debug/info
const isDev = import.meta.env.DEV

export const logger = {
  debug: (...args: unknown[]): boolean | void => isDev && console.log(...args),
  info: (...args: unknown[]): boolean | void => isDev && console.info(...args),
  warn: (...args: unknown[]): void => console.warn(...args),
  error: (...args: unknown[]): void => console.error(...args),
}
