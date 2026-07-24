/**
 * Data Adapters — 统一导出
 *
 * 所有业务模块通过此入口获取数据适配器，
 * 数据源切换集中管理，业务层无需感知。
 */

export { forecastAdapter } from './forecastAdapter'
export { floodAdapter } from './floodAdapter'
export { carbonAdapter } from './carbonAdapter'
