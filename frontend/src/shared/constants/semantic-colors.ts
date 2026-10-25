/**
 * 语义色单源表（2026-10-25 用户裁决 Q-C1 B：独立文件，不放进 colors.ts）。
 *
 * 同一语义在两条渲染通道各需一份表示，允许值不同，但必须同源于此表，不得各写一份副本。
 *
 * · `ui`  —— DOM/CSS 通道。**逐值等于** `style.css` 亮色主题的 `--GCS-color-*`
 *   （success rgb(24 122 48) / warning rgb(163 99 0) / danger rgb(204 58 77)，
 *   白底对比度 5.43 / 4.84 / 4.91，均为 WCAG AA）。
 *   改这里等于改 CSS：`tools/v3-guard/color-channel-parity.mjs` 判严格相等，任一侧单改即红。
 * · `map` —— canvas/Cesium 通道。风险面/线叠在底图与海面上，背景不是面板白
 *   （`--GCS-bg-*` 不适用），故按 `SEMANTIC_MAP_BACKGROUND` 取 ≥3:1；为达标允许比 ui 更深。
 *
 * 为什么不是两套独立副本：两套副本会各自演化——W67 实测的 2.24 / 2.19 / 2.90 就是
 * canvas 侧没跟上 CSS 提深留下的。这里只有一个表、两个变体，消费侧按所在通道取值。
 *
 * ⚠️ 机器可读契约：`tools/v3-guard/color-channel-parity.mjs` 按
 * `key: { ui: '#rrggbb', map: '#rrggbb' }` 的单行形态解析本表。格式化可以（多空格/换行），
 * 但键名、字段名与引号形态不要改；改了不起作用会红，不会静默放过。
 */
export const SEMANTIC_COLORS = {
  // 白底 5.43；地图背景 #409eff 上 3.35
  success: { ui: '#187a30', map: '#125223' },
  // 白底 4.84；地图背景 #409eff 上 3.17
  warning: { ui: '#a36300', map: '#6b4100' },
  // 白底 4.91；地图背景 #409eff 上 3.21
  danger: { ui: '#cc3a4d', map: '#8a2230' },
} as const

/**
 * 地图侧对比度的代表背景（可逐值复核的常量，不是从截图取样）。
 *
 * 取色依据：洪涝风险面/线叠加在 3D 水面与海面上，而 `LAYER_FILL_WATER`
 * （`colors.ts` 的 `rgba(64, 158, 255, 0.5)`）是仓库内**唯一具名的水面色**。这里取它的
 * RGB 分量（alpha 合成前的图层本色）作为代表背景：
 *   · 不依赖天地图影像像素 —— 截图不可复现，无法作为门禁输入；
 *   · 比 50% 叠在浅色海面影像上的合成结果更深 —— 对深色 stroke 更不利，取判据偏保守。
 * 不用 `--GCS-bg`（面板白）当背景：地图画布不是面板，白底会把可读性算高。
 *
 * 守卫会核对本常量与 `LAYER_FILL_WATER` 的 RGB 相等；水面层换色时二者必须同步。
 */
export const SEMANTIC_MAP_BACKGROUND = '#409eff'

/**
 * 洪涝「无风险」档中性灰（地图变体）。
 *
 * 它不是语义状态色：UI 侧没有 `--GCS-color-neutral`，故不进 `SEMANTIC_COLORS`
 * （那张表的每个 `ui` 都必须能在 style.css 找到对应 token，否则对账失去对象）。
 * 原 `#909399` 在 `#409eff` 水面上只有 1.11:1，按地图侧 ≥3:1 提到 `#44474c`（3.35:1）。
 */
export const FLOOD_RISK_NEUTRAL_COLOR = '#44474c'

/**
 * 给 `#rrggbb` 加透明度，产出 `rgba(r, g, b, a)`。
 * 用途：风险档位的 fill 从同一 stroke 派生（stroke 改了 fill 自动跟，不再手抄两份 rgba）。
 */
export function withAlpha(hex: string, alpha: number): string {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
