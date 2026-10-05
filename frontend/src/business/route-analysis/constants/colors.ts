/**
 * 航线分析模块色值收口：与全站色值集中管理约定一致，模块内不写裸色值。
 * 路径线/端点标记用品牌蓝（双引擎通用：OL stroke / Cesium polyline 同值）。
 * 单一来源在 `shared/constants/colors.ts` 的 RENDER_BLUE，本文件只做模块别名
 * （G3 收口：原先 #3b82f6 与 LayerIR 域色手抄两处）。
 */
import { RENDER_BLUE } from '@/shared/constants/colors'

export const ROUTE_COLOR = RENDER_BLUE
