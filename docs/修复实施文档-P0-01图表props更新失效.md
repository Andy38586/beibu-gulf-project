# 修复实施文档：P0-01 图表 props 更新失效

> **适用对象**：仅有 20k 上下文的 AI 实施者。**本文档完全自包含**，不需要阅读项目其他文档即可执行。
> **原则**：最小改动、行为等价、可回归验证、可回滚。修好的 bug 必须保持修好（有常驻回归测试）。
> **预计工作量**：30 分钟（含测试与验证）。

---

## 〇、任务卡（先读这个）

| 项 | 内容 |
|---|---|
| 要修的 bug | `LineChart`/`BarChart` 在 props（title/xData/series）变化后，图表画面**永远不更新** |
| 只允许改的文件 | `src/visualization/charts/composables/useChartBase.js`（修改） |
| 只允许新增的文件 | `src/visualization/charts/composables/__tests__/useChartBase.test.js`（新增） |
| **禁止触碰** | `useECharts.js`、`LineChart.vue`、`BarChart.vue`、`RadarChart.vue`、`AppLayout.vue`、任何 store、任何后端文件 |
| 完成判定 | 第七节"验收清单"全部打勾，含新增回归测试通过 + 既有测试不红 |

---

## 一、Bug 机制（证据，已人工核实）

### 1.1 当前有问题的文件全文

`src/visualization/charts/composables/useChartBase.js`（共 49 行，全文如下）：

```js
import { useECharts } from '@/visualization/composables/useECharts'

export function useChartBase(props, emit, chartType, seriesConfig) {
  function handleClick(params) {
    if (params.dataIndex == null) return
    emit('select', params.dataIndex)
  }

  const baseOption = {
    backgroundColor: 'transparent',
    grid: { top: 40, right: 16, bottom: 40, left: 40 },
    title: {
      text: props.title,
      left: 'center',
      textStyle: { color: '#303133', fontSize: 16, fontWeight: 600 },
    },
    tooltip: { trigger: 'axis' },
    legend: {
      bottom: 0,
      textStyle: { color: '#666', fontSize: 10 },
      itemWidth: 10,
      itemHeight: 6,
    },
    xAxis: {
      type: 'category',
      data: props.xData || [],
      axisLine: { lineStyle: { color: '#ddd' } },
      axisLabel: { color: '#666', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#eee' } },
      axisLabel: { color: '#666', fontSize: 10 },
    },
    series: (props.series || []).map((s) => ({
      name: s.name,
      type: chartType,
      data: s.data || [],
      ...seriesConfig,
    })),
  }

  return useECharts({
    getOption: () => baseOption,
    watchSources: [() => props.title, () => props.xData, () => props.series],
    onClick: handleClick,
  })
}
```

### 1.2 为什么图表不更新

下游 `useECharts`（`src/visualization/composables/useECharts.js`）的关键逻辑：

```js
function updateChart() {
  if (!chartInstance) return
  const option = getOption()          // ← 每次更新都调 getOption()
  chartInstance.setOption(option, true)
}
// ...
if (watchSources.length > 0) {
  watch(watchSources, updateChart)    // 浅监听：props 引用替换时会触发
}
```

故障链：`baseOption` 是普通常量对象，在组件 setup 时**只求值一次**，捕获了当时的 `props.title / props.xData / props.series`。`getOption: () => baseOption` 无论被调多少次都返回这个旧对象。所以即使 watch 正确触发 `updateChart()`，`setOption` 用的还是初始数据——**props 更新链在最后一环断掉**。

### 1.3 为什么以前没人发现

全项目目前只有 `src/core/layout/AppLayout.vue` 使用 LineChart/BarChart（第 105-111 行），喂的是模块级 `const chartData`/`const barData` 静态数据，props 从不变化。bug 处于隐身状态。**任何未来的动态数据场景（如预测分析的时间轴联动）都会被它阻断。**

### 1.4 不受影响的部分（不要动）

- `RadarChart.vue` 不使用 `useChartBase`，它走 `useRadarChart.js`，`renderRadar()` 每次现取 props（`getProps()`），工作正常。
- `useECharts.js` 本身逻辑正确（init→updateChart、watch→updateChart、卸载 dispose 齐全），**不需要改**。

---

## 二、修复方案

### 2.1 思路

把"setup 时求值一次的常量 `baseOption`"改为"每次调用时现取 props 的函数 `buildOption()`"。**option 的结构、每个 key、每个值逐字节保持不变**，只改变求值时机。这是对现有行为扰动最小的修法。

### 2.2 修改后的完整文件（逐字替换 `src/visualization/charts/composables/useChartBase.js` 全文）

```js
import { useECharts } from '@/visualization/composables/useECharts'

export function useChartBase(props, emit, chartType, seriesConfig) {
  function handleClick(params) {
    if (params.dataIndex == null) return
    emit('select', params.dataIndex)
  }

  /**
   * P0-01-FIX: option 必须在每次调用时现取 props 构建。
   * 修复前 baseOption 为 setup 时的一次性快照，导致 props 更新后图表永不刷新。
   * 注意：watch 为浅监听，父组件更新数据时必须替换数组/对象引用（不可变更新），
   * 不要原地 push/splice，否则不会触发更新。
   */
  function buildOption() {
    return {
      backgroundColor: 'transparent',
      grid: { top: 40, right: 16, bottom: 40, left: 40 },
      title: {
        text: props.title,
        left: 'center',
        textStyle: { color: '#303133', fontSize: 16, fontWeight: 600 },
      },
      tooltip: { trigger: 'axis' },
      legend: {
        bottom: 0,
        textStyle: { color: '#666', fontSize: 10 },
        itemWidth: 10,
        itemHeight: 6,
      },
      xAxis: {
        type: 'category',
        data: props.xData || [],
        axisLine: { lineStyle: { color: '#ddd' } },
        axisLabel: { color: '#666', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#eee' } },
        axisLabel: { color: '#666', fontSize: 10 },
      },
      series: (props.series || []).map((s) => ({
        name: s.name,
        type: chartType,
        data: s.data || [],
        ...seriesConfig,
      })),
    }
  }

  return useECharts({
    getOption: buildOption,
    watchSources: [() => props.title, () => props.xData, () => props.series],
    onClick: handleClick,
  })
}
```

### 2.3 逐行差异说明（供审查，不用额外操作）

| 行 | 旧 | 新 | 为什么安全 |
|---|---|---|---|
| 9-41 | `const baseOption = { ... }` 求值一次 | `function buildOption() { return { ... } }` | 对象字面量内容**逐字节相同**，只是包进函数 |
| 44 | `getOption: () => baseOption` | `getOption: buildOption` | 签名不变（仍为无参函数返回 option） |
| 45 | `watchSources: [...]` | 不变 | 浅监听语义不变 |
| 46 | `onClick: handleClick` | 不变 | 点击行为不变 |

---

## 三、影响面分析（为什么不会"修好这个、冒出那个"）

### 3.1 全部调用点清单（已穷举，仅 2 处）

`useChartBase` 仅被以下两个组件调用：

| 调用点 | 传入 chartType | props 来源 | 修复前行为 | 修复后行为 |
|---|---|---|---|---|
| `LineChart.vue`（第 19-25 行） | `'line'` + smooth 等 seriesConfig | 父组件 props | 首屏正常，之后不更新 | 首屏正常（同一 option），props 变则更新 |
| `BarChart.vue`（同构） | `'bar'` | 父组件 props | 同上 | 同上 |

这两个组件目前的**唯一父组件**是 `AppLayout.vue`（第 105-111 行），传入的是模块级常量 `chartData.labels / chartData.series / barData.*`——引用永不变化 → watch 永不触发 → **修复后与修复前行为完全等价**。

### 3.2 行为等价性论证（对现有页面零扰动）

- 首次渲染：旧代码 `initChart() → updateChart() → getOption()` 返回 setup 快照；新代码同一路径返回 `buildOption()` 的首次调用结果。此时 props 未变化，两者产出的 option **深度相等**。画面、图例、tooltip 完全一致。
- 后续渲染：AppLayout 的 props 引用不变 → watch 不触发 → 不会再 `setOption`。与旧行为一致。
- 卸载：`useECharts` 的 `disposeChart` 不变。

### 3.3 已知边界（写进契约，不算新 bug）

- **浅监听契约**：父组件必须**替换引用**（`lineXData.value = [...]`），不能原地修改（`lineXData.value.push(...)`）。这是修复前就存在的语义（watch 本来就是浅的），本次不扩大改动范围去加 deep watch（会对大数组产生不必要的深遍历开销）。
- **内联字面量风险**：若未来有父组件写 `:x-data="['a','b']"`（每次渲染新引用），会导致每次渲染都 setOption。当前代码库**没有**这种写法（已 grep 确认 AppLayout 用常量）。第三节验收清单里有一条人工检查兜底。

---

## 四、实施步骤（按顺序执行）

```bash
# 0. 确认在项目根目录 C:\mypython\beibu-gulf-project，且工作区干净
git status --short
# 如果有未提交改动，先 stash 或提交，保证可回滚

# 1. 用 2.2 节的完整内容替换 src/visualization/charts/composables/useChartBase.js

# 2. 新增测试文件（第五节内容）：
#    src/visualization/charts/composables/__tests__/useChartBase.test.js

# 3. 跑全部测试（既有测试必须保持绿色）
npm run test

# 4. 跑 lint（本项目 lint 会 --fix，注意检查它有没有改动你的文件）
npm run lint

# 5. 构建验证
npm run build

# 6. 手动验证（第七节清单）
npm run dev
```

**注意**：如果第 5 步构建在清空 `dist/` 时报 `safe-delete` / `trash` 相关错误，那是当前沙箱环境拦截删除导致的**环境问题**，与本次修改无关——用 `npx vite build --outDir dist-check` 换输出目录验证即可。

---

## 五、回归测试（新增文件全文）

新增 `src/visualization/charts/composables/__tests__/useChartBase.test.js`：

```js
/**
 * P0-01 回归测试：图表 props 更新必须反映到 getOption 输出
 *
 * 策略：mock useECharts，捕获 useChartBase 传入的 getOption，
 * 验证其在 props 变化前后返回不同的（新的）数据。
 * 这样测试聚焦"快照 bug"本身，不依赖 jsdom 中 echarts 的真实渲染。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// vi.hoisted 保证变量在 vi.mock 工厂提升后可用
const { captured } = vi.hoisted(() => ({
  captured: { getOption: null, updateChartCalls: 0 },
}))

vi.mock('@/visualization/composables/useECharts', () => ({
  useECharts: (opts) => {
    captured.getOption = opts.getOption
    return {
      chartRef: { value: null },
      updateChart: () => {
        captured.updateChartCalls++
      },
      getInstance: () => null,
    }
  },
}))

import LineChart from '../../LineChart.vue'
import BarChart from '../../BarChart.vue'

describe('P0-01 回归：useChartBase 不得返回过期快照', () => {
  it('LineChart：xData/series 更新后 getOption 返回新数据', async () => {
    const wrapper = mount(LineChart, {
      props: {
        title: '趋势',
        xData: ['2024'],
        series: [{ name: '钦州港', data: [100] }],
      },
    })

    const before = captured.getOption()
    expect(before.xAxis.data).toEqual(['2024'])
    expect(before.series[0].data).toEqual([100])

    await wrapper.setProps({
      xData: ['2024', '2025'],
      series: [{ name: '钦州港', data: [100, 230] }],
    })

    const after = captured.getOption()
    expect(after.xAxis.data).toEqual(['2024', '2025'])
    expect(after.series[0].data).toEqual([100, 230])

    wrapper.unmount()
  })

  it('BarChart：title 更新后 getOption 返回新标题', async () => {
    const wrapper = mount(BarChart, {
      props: { title: '旧标题', xData: ['A'], series: [{ name: 's', data: [1] }] },
    })
    expect(captured.getOption().title.text).toBe('旧标题')

    await wrapper.setProps({ title: '新标题' })
    expect(captured.getOption().title.text).toBe('新标题')

    wrapper.unmount()
  })

  it('结构不变量：option 的静态结构与修复前保持一致', () => {
    mount(LineChart, {
      props: { title: 'T', xData: ['x'], series: [{ name: 'n', data: [1] }] },
    })
    const option = captured.getOption()

    // 以下键值与修复前逐字节一致（防止修复时手滑改结构）
    expect(option.backgroundColor).toBe('transparent')
    expect(option.grid).toEqual({ top: 40, right: 16, bottom: 40, left: 40 })
    expect(option.title.left).toBe('center')
    expect(option.title.textStyle).toEqual({ color: '#303133', fontSize: 16, fontWeight: 600 })
    expect(option.tooltip).toEqual({ trigger: 'axis' })
    expect(option.legend.bottom).toBe(0)
    expect(option.xAxis.type).toBe('category')
    expect(option.yAxis.type).toBe('value')
    expect(option.series[0].type).toBe('line')
    // LineChart 的 seriesConfig 透传检查
    expect(option.series[0].smooth).toBe(true)
  })

  it('空 props 防御：缺省 xData/series 不报错', () => {
    mount(LineChart, { props: { title: 'T', xData: [], series: [] } })
    const option = captured.getOption()
    expect(option.xAxis.data).toEqual([])
    expect(option.series).toEqual([])
  })
})
```

**为什么这个测试能"修好了就保持修好"**：它直接断言 `getOption()` 在 props 变化后返回新数据。任何人将来把 `buildOption` 改回快照模式（或引入类似的求值时机错误），第 1、2 个用例会立刻变红。

---

## 六、风险清单与缓解

| # | 风险 | 概率 | 缓解 | 验证方式 |
|---|---|---|---|---|
| 1 | 修复时改错 option 结构（手滑） | 低 | 2.2 节为完整文件，逐字替换，不要手工"优化"任何样式值 | 测试用例 3（结构不变量） |
| 2 | mock 的 useECharts 与真实签名漂移导致测试假绿 | 低 | mock 返回了 `chartRef/updateChart/getInstance` 三件套，与真实返回值同构；若真实 useECharts 改签名，其他既有测试也会暴露 | `npm run test` 全量 |
| 3 | 某父组件原地修改数组导致不更新 | 现存语义 | 契约已写入 buildOption 注释；当前无此写法 | 人工检查 AppLayout（用常量） |
| 4 | lint --fix 改写新文件格式 | 低 | 执行 `npm run lint` 后 `git diff` 检查被改了什么 | git diff |
| 5 | setOption(option, true)（notMerge）全量替换导致动画重置 | 无变化 | 修复前就是 notMerge=true，行为不变 | 无 |

---

## 七、验收清单（Definition of Done，全部打勾才算完成）

- [ ] `useChartBase.js` 已替换为 2.2 节内容，`git diff` 只显示这一个文件被修改（外加新增测试）
- [ ] `npm run test` 全绿：新增的 4 个用例通过，且**既有的** MapRenderer/UnifiedMap 等测试不红
- [ ] `npm run lint` 无 error
- [ ] `npm run build`（或 `npx vite build --outDir dist-check`）成功
- [ ] 手动验证 1：首页（`/`）左侧折线图、柱状图正常渲染，标题为"港口吞吐量趋势/对比"，与修复前画面一致
- [ ] 手动验证 2：在 Vue DevTools 里修改 AppLayout 的 `chartData.series[0].data`（替换整个数组引用），折线图随之刷新——这证明更新链路已通
- [ ] 手动验证 3：切换到 `/site-selection`，选一个分析结果点小区，雷达图仍正常（本次未动它，验证无连带影响）
- [ ] 测试文件已提交进仓库（防回退的常驻 guard）

---

## 八、回滚方案

```bash
# 单文件级别回滚（测试文件保留无妨，但严格回滚就一起删）
git checkout -- src/visualization/charts/composables/useChartBase.js
rm -r src/visualization/charts/composables/__tests__
npm run test   # 确认回到修复前状态（既有测试绿）
```

回滚成本：1 个修改文件 + 1 个新增目录，无数据迁移、无配置变更、无依赖变更。

---

## 九、禁止事项（违反任何一条即视为实施失败）

1. 禁止修改 `useECharts.js`——它是对的，动了会引入新变量
2. 禁止给 watch 加 `deep: true`——改变现存浅监听语义，大数组有性能代价
3. 禁止"顺手"重构 LineChart/BarChart/RadarChart/AppLayout
4. 禁止改动 option 里的任何样式数值（颜色、尺寸、边距）——本次只修求值时机
5. 禁止把测试写成依赖真实 echarts 渲染的断言（jsdom 下尺寸为 0，脆弱且慢）
