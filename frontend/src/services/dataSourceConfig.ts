/**
 * 统一数据源配置
 * 收口各 adapter 内部散落的 `_dataSource` 变量：
 * - 全局默认数据源由环境变量 VITE_DATA_SOURCE 驱动
 * - 各 adapter 可通过 setDataSource 独立覆盖
 * - 提供统一查询接口，消除各 adapter 内部 if/else 重复
 * 使用方：floodAdapter、main.ts 初始化。（2026-08-08：forecastAdapter/siteAnalysisAdapter 已删）
 *
 * 数据源三态（2026-08-06 规范命名，原 'mock' 更名为 'static'——名实相符：
 * 前端直读 public/data 静态资源（boundary/berth/traffic 等真实数据），
 * 非"假数据"；api=Express 后端静态接口；online=FastAPI 实时演算）。
 */

import { logger } from '@/shared'

export type DataSourceMode = 'static' | 'api' | 'online'

/** 全局默认数据源（由 main.ts 在启动时经 adapter.setDataSource 驱动；此处默认值与代码默认 api 保持一致，D-1=A） */
const globalDataSource: DataSourceMode = 'api'

/** 各 adapter 的独立覆盖（未设置时回退到全局） */
// 为「覆盖优先于全局」的运行时映射，当前一次性初始化
// （main.ts），无清理需求；若未来运行时动态切换数据源，需显式提供 unset 清理以免残留覆盖
// （YAGNI：暂不加清理代码，仅标注语义）。
const adapterOverrides = new Map<string, DataSourceMode>()

// DAT-4 预留的 setGlobalDataSource/getGlobalDataSource 已移除（z059 / D-5=A）：
// 全仓零调用方；全局默认由 main.ts 经各 adapter.setDataSource(dataSource) 直接驱动（见 main.ts）。

/**
 * 为指定 adapter 设置独立数据源覆盖
 * @param adapterName - adapter 标识（如 'forecast'、'flood'）
 * @param mode - 数据源模式
 */
export function setAdapterDataSource(adapterName: string, mode: DataSourceMode): void {
  if (mode !== 'static' && mode !== 'api' && mode !== 'online') {
    throw new Error(
      `[DataSourceConfig] ${adapterName}: 无效的数据源模式: ${mode}，仅支持 'static' / 'api' / 'online'`
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
