/**
 * 统一数据源配置
 *
 * 收口各 adapter 内部散落的 `_dataSource` 变量：
 * - 全局默认数据源由环境变量 VITE_DATA_SOURCE 驱动
 * - 各 adapter 可通过 setDataSource 独立覆盖
 * - 提供统一查询接口，消除各 adapter 内部 if/else 重复
 *
 * 使用方：forecastAdapter、floodAdapter、main.ts 初始化。
 */

import { logger } from '@/shared/utils/logger'

export type DataSourceMode = 'mock' | 'api' | 'online'

/** 全局默认数据源（由 main.ts 在启动时设置） */
let globalDataSource: DataSourceMode = 'mock'

/** 各 adapter 的独立覆盖（未设置时回退到全局） */
// @audit-note DAT-8：adapterOverrides 为「覆盖优先于全局」的运行时映射，当前一次性初始化
// （main.ts），无清理需求；若未来运行时动态切换数据源，需显式提供 unset 清理以免残留覆盖
// （YAGNI：暂不加清理代码，仅标注语义）。
const adapterOverrides = new Map<string, DataSourceMode>()

/**
 * 设置全局默认数据源
 * @audit-note DAT-4 预留未接入：当前无调用方（全局默认已由 main.ts 直接赋值 globalDataSource），
 * 保留作统一入口，请勿删除
 */
export function setGlobalDataSource(mode: DataSourceMode): void {
  if (mode !== 'mock' && mode !== 'api' && mode !== 'online') {
    throw new Error(
      `[DataSourceConfig] 无效的数据源模式: ${mode}，仅支持 'mock' / 'api' / 'online'`
    )
  }
  globalDataSource = mode
  logger.info(`[DataSourceConfig] 全局数据源切换为: ${mode}`)
}

/**
 * 获取全局默认数据源
 * @audit-note DAT-4 预留未接入：对应 setGlobalDataSource，当前无调用方，保留作统一入口
 */
export function getGlobalDataSource(): DataSourceMode {
  return globalDataSource
}

/**
 * 为指定 adapter 设置独立数据源覆盖
 * @param adapterName - adapter 标识（如 'forecast'、'flood'）
 * @param mode - 数据源模式
 */
export function setAdapterDataSource(adapterName: string, mode: DataSourceMode): void {
  if (mode !== 'mock' && mode !== 'api' && mode !== 'online') {
    throw new Error(
      `[DataSourceConfig] ${adapterName}: 无效的数据源模式: ${mode}，仅支持 'mock' / 'api' / 'online'`
    )
  }
  adapterOverrides.set(adapterName, mode)
  logger.info(`[DataSourceConfig] ${adapterName} 数据源切换为: ${mode}`)
}

/**
 * 获取指定 adapter 的有效数据源（优先独立覆盖，回退全局）
 * @param adapterName - adapter 标识
 */
export function resolveDataSource(adapterName: string): DataSourceMode {
  return adapterOverrides.get(adapterName) ?? globalDataSource
}
