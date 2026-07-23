# GCS V2 设计规范

> **版本**: 2.0
> **日期**: 2026-07-17
> **状态**: 生效
> **替代**: GCS V1

---

## 1. 设计哲学

### 1.1 一句话定义

> **Canvas 是屏幕，Grid 是尺子，Cell 是单位，Panel 是一切。**

### 1.2 iPad 桌面模型

本系统不采用传统网页布局思维（Header / Sidebar / Content / Footer），
而采用 **iPad 桌面模型**：

- 屏幕上没有容器、没有区域、没有分区
- **所有可见元素都是 Panel**
- Panel 大小不同、位置不同，但本质相同
- Panel 浮于 Canvas 之上，Canvas 主体（地图）透过 Panel 间隙可见

### 1.3 三代模型对比

| 版本     | 模型                                               | 问题                                 |
| -------- | -------------------------------------------------- | ------------------------------------ |
| V1       | Zone → Panel → Cell                                | Zone 是伪概念，导致 Zone1~5 容器泛滥 |
| V2-draft | Grid → Cell → Panel                                | Grid 随视口变化，不能当坐标系        |
| **V2**   | **Canvas + Grid(尺子) + Cell(单位) + Panel(一切)** | **无**                               |

### 1.4 四条铁律

| 编号 | 铁律            | 说明                                                    |
| ---- | --------------- | ------------------------------------------------------- |
| R1   | 一切都是 Panel  | 标题是 Panel，图表是 Panel，按钮是 Panel，Dock 是 Panel |
| R2   | 不存在容器      | 禁止 Zone、Area、Container 等任何中间层                 |
| R3   | 度量单位是 Cell | Panel 的宽高用 Cell 定义，不用 px                       |
| R4   | 间距统一 2×GAP  | 任何 Panel 到任何边缘/其他 Panel 的距离 = 2×GAP         |

---

## 2. 核心概念

系统由四层概念组成，**每层职责严格分离，不得混淆**：

```
Layer 1: Canvas   — 物理屏幕（像素）
Layer 2: Grid     — 视觉参考线（仅检查模式可见）
Layer 3: Cell     — 布局度量单位（逻辑）
Layer 4: Panel    — 业务组件实例（一切可见元素）
```

### 2.1 Canvas（画布）

**定义：** Canvas 是浏览器视口，是整个布局系统的物理边界。

| 属性   | 说明                         |
| ------ | ---------------------------- |
| 宽度 W | `window.innerWidth`（像素）  |
| 高度 H | `window.innerHeight`（像素） |
| 原点   | 左上角 (0, 0)                |
| 职责   | 提供物理像素边界             |

**Canvas 不是布局系统的一部分。** 它只是"屏幕有多大"的事实。

### 2.2 Grid（参考线）

**定义：** Grid 是覆盖 Canvas 的等距参考线网格，**仅用于视觉验收**。

| 属性      | 值              | 说明                 |
| --------- | --------------- | -------------------- |
| GRID_SIZE | 100px           | 每格像素大小（固定） |
| 列数      | ⌊W / GRID_SIZE⌋ | 随视口变化           |
| 行数      | ⌊H / GRID_SIZE⌋ | 随视口变化           |
| 可见性    | 仅检查模式      | 正常模式完全不可见   |
| 可交互    | 否              | 不可点击、不可拖拽   |

**Grid 的核心约束：**

- Grid **不是坐标系**
- Grid **不参与布局计算**
- Grid **不决定任何 Panel 的位置**
- Grid **是一把尺子**，用来量 Panel 是否对齐
- 业务代码 **禁止** 读取 Grid 尺寸

**为什么 Grid 不能当坐标系：**

```
1920px 视口 → Grid = 19 列
1366px 视口 → Grid = 13 列
 768px 视口 → Grid =  7 列
```

Grid 随视口变化，坐标不稳定。拿会变的尺子当坐标系，布局必然崩溃。

**Grid 的正确用途：**

检查模式下显示参考线，验收时目视确认 Panel 边缘是否落在 Grid 线上。
对齐 → 合格；不对齐 → 不合格。仅此而已。

### 2.3 Cell（布局单位）

**定义：** Cell 是布局系统的唯一度量单位。所有 Panel 的宽高以 Cell 为单位定义。

| 属性       | 当前值 | 说明                     |
| ---------- | ------ | ------------------------ |
| CELL_PIXEL | 80px   | 1 个 Cell 的物理像素大小 |
| 响应式     | 见下表 | 随视口宽度调整           |

**Cell 响应式查表：**

| 视口宽度 | CELL_PIXEL |
| -------- | ---------- |
| ≥ 1920   | 90px       |
| ≥ 1366   | 80px       |
| ≥ 1024   | 80px       |
| ≥ 768    | 70px       |
| < 768    | 60px       |

**Cell 的核心约束：**

- Cell 是 **布局度量单位**，不是可见元素
- Cell **不存在于 DOM 中**，不存在于渲染树中
- Cell 只回答一个问题：**"这个 Panel 占多大？"**
- Cell 尺寸可以随视口调整，但调整的是像素映射，不影响 Panel 的 Cell 定义

**示例：**

```
折线图 Panel = 4×4 Cell
  → 宽 = 4 Cell，高 = 4 Cell
  → 在 CELL_PIXEL=80 时：宽 = 320px，高 = 320px
  → 在 CELL_PIXEL=90 时：宽 = 360px，高 = 360px
  → Panel 的 Cell 定义 (4×4) 始终不变
```

### 2.4 Panel（面板）

**定义：** Panel 是系统中唯一的可见业务单元。一切可见元素都是 Panel。

| 属性         | 说明                                  |
| ------------ | ------------------------------------- |
| 尺寸         | w×h（Cell 单位）                      |
| 定位         | 由布局引擎根据锚点 + 间距规则自动计算 |
| 内部 padding | CELL_PADDING（见参数体系）            |
| 视觉         | 白色背景 + 轻阴影 / 毛玻璃效果        |

**Panel 的类型：**

| 类型       | 说明                      | 示例                          |
| ---------- | ------------------------- | ----------------------------- |
| 信息 Panel | 展示数据/图表             | 折线图(4×4)、雷达图(4×4)      |
| 按钮 Panel | 可交互的按钮              | Dock 按钮(1×1)、城市按钮(2×1) |
| 组合 Panel | 由多个按钮 Panel 逻辑组合 | Dock(7×1)                     |

**Panel 的边界规则：**

- Panel 外边界 = Panel 所占 Cell 区域的外边缘
- Panel 内部 padding = CELL_PADDING（内容与 Panel 边缘的距离）
- Panel 内部 **不得产生额外间距**
- Panel 之间的视觉间距 = PANEL_SPACING（由布局引擎保证）

---

## 3. 参数体系

### 3.1 参数定义

所有参数统一在 `config.js` 中定义，**禁止在任何组件中硬编码**。

| 参数名          | 值  | 定义                                     | 用途                               |
| --------------- | --- | ---------------------------------------- | ---------------------------------- |
| `CELL_PIXEL`    | 80  | 1 个 Cell 的像素边长                     | Cell → px 转换                     |
| `GAP`           | 10  | 基础间距单位                             | 计算 PANEL_SPACING 和 CELL_PADDING |
| `PANEL_SPACING` | 20  | Panel 之间的间距 = 2×GAP                 | 布局引擎使用                       |
| `CELL_PADDING`  | 10  | Panel 内部 padding = 1×GAP               | Panel 内容区内缩                   |
| `GRID_SIZE`     | 100 | Grid 参考线间距（px）                    | 仅检查模式使用                     |
| `SAFE_MARGIN`   | 20  | Panel 到 Canvas 边缘距离 = PANEL_SPACING | 布局引擎使用                       |

### 3.2 参数关系图

```
GAP = 10px（基础单位）
 │
 ├── CELL_PADDING = 1×GAP = 10px
 │    └── Panel 内部：内容到 Panel 边缘的距离
 │
 ├── PANEL_SPACING = 2×GAP = 20px
 │    ├── Panel 与 Panel 之间的间距
 │    └── Panel 与 Canvas 边缘的间距（SAFE_MARGIN = PANEL_SPACING）
 │
 └── GRID_SIZE = 100px（独立参数，仅用于检查模式参考线）
```

### 3.3 与 V1 参数对照

| V1 名称      | V1 值  | V2 名称       | V2 值  | 变化说明                                                                                                            |
| ------------ | ------ | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| CELL_PIXEL   | 80     | CELL_PIXEL    | 80     | 不变                                                                                                                |
| CELL_PADDING | 10     | CELL_PADDING  | 10     | 不变，含义不变                                                                                                      |
| GAP          | **20** | GAP           | **10** | **重新定义**：V1 的 GAP 是 Panel 间距(20px)；V2 的 GAP 是基础间距单位(10px)，用于派生 PANEL_SPACING 和 CELL_PADDING |
| —            | —      | PANEL_SPACING | 20     | 新增：= 2×GAP，取代 V1 的 GAP 职责                                                                                  |
| SAFE_MARGIN  | 20     | SAFE_MARGIN   | 20     | 不变（= PANEL_SPACING）                                                                                             |
| —            | —      | GRID_SIZE     | 100    | 新增：Grid 参考线参数                                                                                               |

> **重要提示：** V2 重新定义了 `GAP` 的含义。V1 代码中 `GAP = 20`，V2 中 `GAP = 10`。
> 实施时必须同步修改 `config.js`，将原 `GAP = 20` 改为 `GAP = 10`，并新增 `PANEL_SPACING = 20`。

### 3.4 工具函数

```
cellToPx(cellCount) → cellCount × CELL_PIXEL
  将 Cell 单位转换为像素

panelOuterPx(w, h) → { width: w × CELL_PIXEL, height: h × CELL_PIXEL }
  Panel 外边界像素尺寸

panelInnerPx(w, h) → { width: w × CELL_PIXEL - 2 × CELL_PADDING,
                        height: h × CELL_PIXEL - 2 × CELL_PADDING }
  Panel 内容区域像素尺寸
```

---

## 4. 间距规则

**这是本规范最核心的章节。所有布局必须严格遵守。**

### 4.1 规则定义

> **任何 Panel 的任意边缘，到 Canvas 边缘或其他 Panel 的最近边缘，距离必须 = 2×GAP（20px）。**

### 4.2 两条子规则

| 规则         | 描述                         | 距离         |
| ------------ | ---------------------------- | ------------ |
| **边缘间距** | Panel 边缘 → Canvas 边缘     | 2×GAP = 20px |
| **面板间距** | Panel 边缘 → 相邻 Panel 边缘 | 2×GAP = 20px |

### 4.3 间距示意图

**Panel 到 Canvas 边缘：**

```
Canvas 顶边缘
├─ 20px (2×GAP) ─┤
┌──────────────────┐
│    Panel         │
└──────────────────┘

Canvas 左边缘
├ 20px ┤┌──────────┐
│2×GAP ││  Panel   │
├──────┤│          │
        └──────────┘
```

**Panel 到 Panel（同组垂直排列）：**

```
┌──────────────────┐
│  Panel A (4×4)   │
└──────────────────┘
├─ 20px (2×GAP) ─┤
┌──────────────────┐
│  Panel B (4×5)   │
└──────────────────┘
```

**Panel 到 Panel（水平排列）：**

```
┌────────┐        ┌────────┐
│ Panel  │ 20px   │ Panel  │
│ Left   │(2×GAP) │ Right  │
└────────┘        └────────┘
```

### 4.4 间距规则的本质

```
GAP = 10px = CELL_PADDING

Panel 内部 padding = 1×GAP = 10px
Panel 外部间距   = 2×GAP = 20px

外部间距 = 2 × 内部 padding
```

这意味着：**Panel 之间的间隙 = 两个 Panel 各出一个 padding 的宽度。**

视觉上，Panel 之间的间隙和 Panel 内部的 padding 保持统一的节奏感。

### 4.5 禁止事项

| 禁止                       | 原因                   |
| -------------------------- | ---------------------- |
| Panel 之间使用 0px 间距    | 违反 2×GAP 规则        |
| Panel 之间使用 10px 间距   | 应为 2×GAP=20px        |
| Panel 之间使用 30px 间距   | 应为 2×GAP=20px        |
| 不同 Panel 对使用不同间距  | 间距必须全局统一       |
| 用 CSS margin 手动设置间距 | 间距由布局引擎统一计算 |

---

## 5. 面板定位系统（Panel Position System）

### 5.1 系统概述

Panel Position System（PPS）是本布局系统的核心引擎。

**输入：** Panel 注册表（每个 Panel 的 id、w、h、锚点）
**输出：** 每个 Panel 的像素位置 (left, top) 和尺寸 (width, height)

**核心思想：**

- Panel 用 Cell 单位定义尺寸
- 布局引擎根据锚点和间距规则计算像素位置
- 不存在容器、不存在区域、不存在分组
- 只有 Panel 实例 + 布局规则

### 5.2 Panel 定义

每个 Panel 由以下属性定义：

```
Panel = {
  id:      string    唯一标识
  w:       number    宽度（Cell 单位）
  h:       number    高度（Cell 单位）
  anchor:  enum      锚定边缘
  offsetX: number    水平偏移（Cell 单位，默认 0）
  offsetY: number    垂直偏移（Cell 单位，默认 0）
}
```

**anchor 可选值：**

| 锚点            | 含义     | offsetX 方向 | offsetY 方向 |
| --------------- | -------- | ------------ | ------------ |
| `top-left`      | 左上角   | 向右         | 向下         |
| `top-right`     | 右上角   | 向左         | 向下         |
| `top-center`    | 顶部居中 | —            | 向下         |
| `bottom-center` | 底部居中 | —            | 向上         |
| `bottom-left`   | 左下角   | 向右         | 向上         |
| `bottom-right`  | 右下角   | 向左         | 向上         |

**offset 含义：**

- `offsetX` / `offsetY` 是 Panel 相对于锚点的 Cell 偏移量
- 对于大多数 Panel，offset = 0（直接贴边）
- 当同一锚点有多个 Panel 时，通过 offset 实现堆叠

### 5.3 布局算法

布局引擎按以下步骤计算每个 Panel 的像素位置：

#### 步骤 1：基础参数

```
C = CELL_PIXEL（当前视口对应的 Cell 像素值）
S = PANEL_SPACING = 2 × GAP = 20px
W = Canvas 宽度（px）
H = Canvas 高度（px）
```

#### 步骤 2：计算各锚点位置

```
left_edge   = S                          // 20px
top_edge    = S                          // 20px
right_edge  = W - S                      // W - 20px
bottom_edge = H - S                      // H - 20px
```

#### 步骤 3：根据 anchor 计算 Panel 位置

**anchor = top-left：**

```
left = S + offsetX × C       // offsetX 控制水平偏移（向右）
top  = S + offsetY × C       // offsetY 控制垂直偏移（向下）
```

**anchor = top-right：**

```
left = W - S - (offsetX + w) × C   // offsetX 控制水平偏移（向左）
top  = S + offsetY × C             // offsetY 控制垂直偏移（向下）
```

**anchor = top-center：**

```
left = (W - w × C) / 2
top  = S + offsetY × C
```

**anchor = bottom-center：**

```
left = (W - w × C) / 2
top  = H - S - (offsetY + h) × C   // offsetY 控制垂直偏移（向上）
```

#### 步骤 4：计算 Panel 尺寸

```
width  = w × C
height = h × C
```

### 5.4 同锚点多 Panel 堆叠规则

当多个 Panel 共享同一锚点时（如左侧 2 个 Panel 都锚定 top-left），
通过 offsetY 实现垂直堆叠：

```
Panel A: offsetY = 0
Panel B: offsetY = A.h + spacingInCells

其中 spacingInCells = PANEL_SPACING / CELL_PIXEL = 20 / 80 = 0.25 Cell
```

**通用堆叠公式：**

```
第 N 个 Panel 的 offsetY = Σ(前 N-1 个 Panel 的 h) + (N-1) × spacingInCells
```

**示例（左侧 2 个 Panel，4×4 + 4×5）：**

```
Panel 1 (4×4): offsetY = 0
Panel 2 (4×5): offsetY = 4 + 0.25 = 4.25 Cell
```

**像素验证（CELL_PIXEL=80）：**

```
Panel 1: top = 20 + 0 × 80 = 20px
Panel 1: bottom = 20 + 4 × 80 = 340px
Panel 2: top = 20 + 4.25 × 80 = 360px    // 340 + 20 = 360 ✓
Panel 2: bottom = 360 + 5 × 80 = 760px
```

**间距验证：**

```
Panel 1 bottom → Panel 2 top = 360 - 340 = 20px = 2×GAP ✓
```

**注意：** 如果上方有其他 Panel（如 Title），offsetY 需要加上那些 Panel 的高度和间距。
例如 Title(1×1) + line-chart(4×4) 堆叠：

```
Title: offsetY = 0
line-chart: offsetY = 1 + 0.25 = 1.25 Cell
            top = 20 + 1.25 × 80 = 120px ✓
```

bar-chart 在 line-chart 下方：

```
bar-chart: offsetY = 1.25 + 4 + 0.25 = 5.5 Cell
           top = 20 + 5.5 × 80 = 460px ✓
```

---

## 6. 首页面板注册表

### 6.1 Panel 清单

首页共 10 个 Panel 实例：

| #   | id              | 内容     | w    | h   | anchor        | 说明                  |
| --- | --------------- | -------- | ---- | --- | ------------- | --------------------- |
| 1   | `title`         | 页面标题 | 动态 | 1   | top-center    | 读取 route.meta.title |
| 2   | `btn-qinzhou`   | 钦州     | 1    | 1   | top-right     | 城市按钮 1            |
| 3   | `btn-beihai`    | 北海     | 1    | 1   | top-right     | 城市按钮 2            |
| 4   | `btn-fangcheng` | 防城港   | 1    | 1   | top-right     | 城市按钮 3            |
| 5   | `btn-profile`   | 个人中心 | 1    | 1   | top-right     | 城市按钮 4            |
| 6   | `line-chart`    | 折线图   | 4    | 4   | top-left      | 左上                  |
| 7   | `bar-chart`     | 柱状图   | 4    | 5   | top-left      | 左下                  |
| 8   | `radar-chart`   | 雷达图   | 4    | 4   | top-right     | 右上                  |
| 9   | `layer-control` | 图层控制 | 4    | 5   | top-right     | 右下                  |
| 10  | `dock`          | 业务导航 | 动态 | 1   | bottom-center | 宽度 = 按钮数 × 1     |

**右上角 4 个按钮说明：**

4 个 1×1 按钮水平排列，锚定 top-right，通过 offsetX 实现水平堆叠（offsetX 向左偏移）：

```
top-right 锚点公式: left = W - S - (offsetX + w) × C

btn-qinzhou:   offsetX = 0       → left = 1920 - 20 - (0+1)×80 = 1820px
btn-beihai:    offsetX = 1.25    → left = 1920 - 20 - (1.25+1)×80 = 1720px  // 间距 20px ✓
btn-fangcheng: offsetX = 2.5     → left = 1920 - 20 - (2.5+1)×80 = 1620px   // 间距 20px ✓
btn-profile:   offsetX = 3.75    → left = 1920 - 20 - (3.75+1)×80 = 1520px  // 间距 20px ✓
```

> **注意：** top-right 锚点的 offsetX 方向为向左。
> 水平堆叠公式：每个按钮的 offsetX = 前一个 offsetX + 按钮宽度(1) + 间距(0.25 Cell)。

雷达图在这些按钮下方：

```
radar-chart: offsetY = 1 + 0.25 = 1.25 Cell
             top = 20 + 1.25×80 = 120px
```

### 6.2 布局计算（1920×1080，CELL_PIXEL=80）

**Title Panel：**

```
w = 动态（根据标题文字自适应）
h = 1 Cell = 80px
anchor = top-center
left = (1920 - w×80) / 2
top  = 20px
```

**左侧 Panel 组：**

```
line-chart (4×4):
  left  = 20px
  top   = 120px                        // Title底(20+80=100) + 间距20 = 120
  width  = 320px
  height = 320px

bar-chart (4×5):
  left  = 20px
  top   = 460px                        // line-chart底(120+320=440) + 间距20 = 460
  width  = 320px
  height = 400px
```

**右侧 Panel 组：**

```
radar-chart (4×4):
  left  = 1580px                       // 1920 - 20 - 4×80 = 1580
  top   = 120px                        // 与 line-chart 对称
  width  = 320px
  height = 320px

layer-control (4×5):
  left  = 1580px
  top   = 460px                        // 与 bar-chart 对称
  width  = 320px
  height = 400px
```

**Dock Panel：**

```
w = 按钮数（例如 7 个按钮 → w = 7）
h = 1 Cell = 80px
anchor = bottom-center
left = (1920 - 7×80) / 2 = (1920 - 560) / 2 = 680px
top  = 1080 - 20 - 80 = 980px
width  = 560px
height = 80px
```

### 6.3 间距验证

| 检查项                      | 计算                | 结果         | 合规 |
| --------------------------- | ------------------- | ------------ | ---- |
| Title → Canvas 顶           | top = 20px          | 20px = 2×GAP | ✓    |
| line-chart → Canvas 左      | left = 20px         | 20px = 2×GAP | ✓    |
| line-chart → Title 垂直     | 120 - 100 = 20px    | 20px = 2×GAP | ✓    |
| bar-chart → line-chart      | 460 - 440 = 20px    | 20px = 2×GAP | ✓    |
| radar-chart → Canvas 右     | 1920 - 1900 = 20px  | 20px = 2×GAP | ✓    |
| layer-control → radar-chart | 460 - 440 = 20px    | 20px = 2×GAP | ✓    |
| dock → Canvas 底            | 1080 - 1060 = 20px  | 20px = 2×GAP | ✓    |
| 左右 Panel 对称             | 左 320px = 右 320px | 对称         | ✓    |

### 6.4 地图区域

地图不是 Panel。地图是 Canvas 的主体内容。

地图填充左右 Panel 组之间的剩余空间：

```
地图 left   = 20 + 320 + 20 = 360px
地图 right  = 1920 - 20 - 320 = 1580px
地图 width  = 1580 - 360 = 1220px
地图 top    = 0（全屏铺底）
地图 height = 1080px
```

地图作为底层背景，Panel 浮于其上。

### 6.5 布局示意图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Canvas 顶边缘                            │
│  ┌───────────────────────────────────────────────────────┐  ↑   │
│  │              20px (2×GAP)                             │  │   │
│  │  ┌─────────────────────────────────────┐              │  │   │
│  │  │        Title Panel (动态×1)          │              │  │   │
│  │  └─────────────────────────────────────┘              │  │   │
│  │  ├─ 20px (2×GAP) ─┤                                  │  │   │
│  │                                                          │   │
│  │  ┌──── 4×4 ────┐                  ┌──── 4×4 ────┐     │  │   │
│  │  │            │                    │            │     │  │   │
│  │  │  折线图     │     MAP          │  雷达图     │     │  │ Canvas
│  │  │            │    (地图主体)      │            │     │  │ 1080px
│  │  └────────────┘                    └────────────┘     │  │   │
│  │  ├─ 20px (2×GAP) ─┤                                  │  │   │
│  │  ┌──── 4×5 ────┐                  ┌──── 4×5 ────┐     │  │   │
│  │  │            │                    │            │     │  │   │
│  │  │  柱状图     │                    │  图层控制   │     │  │   │
│  │  │            │                    │            │     │  │   │
│  │  └────────────┘                    └────────────┘     │  │   │
│  │                                                          │   │
│  │              20px (2×GAP)                             │  │   │
│  └───────────────────────────────────────────────────────┘  ↓   │
│  ┌───────────────────────────────────────────────────────┐  ↑   │
│  │              20px (2×GAP)                             │  │   │
│  │         ┌──┬──┬──┬──┬──┬──┬──┐                       │  │   │
│  │         │B1│B2│B3│B4│B5│B6│B7│  Dock (7×1)          │  │   │
│  │         └──┴──┴──┴──┴──┴──┴──┘                       │  │   │
│  │              20px (2×GAP)                             │  ↓   │
│  └───────────────────────────────────────────────────────┘      │
│                         Canvas 底边缘                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. 检查模式

### 7.1 定义

检查模式（Inspection Mode）是开发工具，用于可视化验证布局合规性。
通过快捷键或配置开启，正常用户不可见。

### 7.2 可视化内容

开启后，Canvas 上叠加显示：

| 元素        | 样式                        | 说明                        |
| ----------- | --------------------------- | --------------------------- |
| Grid 参考线 | 1px 虚线，100px 间距        | 验收对齐用                  |
| Cell 网格   | 0.5px 细线，CELL_PIXEL 间距 | 显示 Cell 边界              |
| Panel 边界  | 2px 实线，颜色区分          | 每个 Panel 不同颜色         |
| 间距标注    | 箭头 + 数值                 | 标注 Panel 间距是否为 2×GAP |
| 坐标标注    | Panel 左上角显示 (w×h)      | 如 "4×4"                    |

### 7.3 验收检查项

| 检查项               | 验证方法                          | 合格标准                    |
| -------------------- | --------------------------------- | --------------------------- |
| Panel 到 Canvas 边缘 | 测量 Panel 外边缘到 Canvas 边缘   | = 2×GAP ± 1px               |
| Panel 到 Panel 间距  | 测量相邻 Panel 外边缘之间         | = 2×GAP ± 1px               |
| Panel Cell 对齐      | 检查 Panel 边界是否落在 Cell 线上 | 偏差 ≤ 1px                  |
| 左右对称             | 比较左右 Panel 组的尺寸和位置     | 像素级对称                  |
| Grid 对齐            | Panel 边界是否落在 Grid 线上      | 允许偏差（Grid 不是坐标系） |
| 硬编码检测           | 扫描组件 CSS                      | 除 config.js 外无硬编码 px  |
| Dock 宽度            | Dock 宽度 / CELL_PIXEL / 按钮数   | = 1（每个按钮 1 Cell 宽）   |

### 7.4 不合规标记

- 合规项：绿色标注
- 不合规项：红色标注 + 闪烁提示
- 偏差 ≤ 1px：黄色警告（亚像素渲染误差，可接受）
- 偏差 > 1px：红色错误（必须修复）

---

## 8. 约束总表

### 8.1 强制约束

| 编号 | 约束                                         | 级别 |
| ---- | -------------------------------------------- | ---- |
| C01  | 一切可见元素必须是 Panel 实例                | 强制 |
| C02  | 禁止 Zone、Area、Container 等容器概念        | 强制 |
| C03  | Panel 尺寸必须用 Cell 单位（w×h），禁止 px   | 强制 |
| C04  | Panel 间距必须 = 2×GAP（20px），禁止其他值   | 强制 |
| C05  | Panel 到 Canvas 边缘距离必须 = 2×GAP（20px） | 强制 |
| C06  | Grid 仅用于检查模式，禁止参与布局计算        | 强制 |
| C07  | 所有像素值必须来自 config.js，禁止硬编码     | 强制 |
| C08  | Dock 宽度必须 = 按钮数 × 1 Cell              | 强制 |
| C09  | Title Panel 内容必须读取 route.meta.title    | 强制 |
| C10  | 地图不是 Panel，是 Canvas 主体内容           | 强制 |
| C11  | Button 本质是 Panel，遵循相同规则            | 强制 |
| C12  | Panel 内部不得产生额外间距                   | 强制 |

### 8.2 反模式（禁止清单）

| 反模式                              | 为什么错                 | 正确做法                       |
| ----------------------------------- | ------------------------ | ------------------------------ |
| 创建 Zone1~5 组件                   | Zone 是容器思维，违反 R2 | 直接定义 Panel 实例            |
| 创建 LeftContainer / RightContainer | 容器思维，违反 R2        | 用 anchor 定位 Panel           |
| 用 Grid 坐标定位 Panel              | Grid 会随视口变化        | 用锚点 + 间距规则定位          |
| 用 px 定义 Panel 尺寸               | 违反 R3                  | 用 Cell 单位                   |
| 用 CSS margin 控制 Panel 间距       | 绕过布局引擎             | 由引擎统一计算 2×GAP           |
| 写死 Title 文字                     | 违反 C09                 | 读取 route.meta.title          |
| 固定 Dock 宽度                      | 违反 C08                 | 宽度 = 按钮数 × 1 Cell         |
| Panel 内部加 padding/margin         | 违反 C12                 | 内部 padding 统一 CELL_PADDING |
| 用百分比布局                        | 非 Cell 单位             | 用 Cell 单位                   |
| 用 flexbox/grid 布局 Panel          | 传统网页思维             | 用 PPS 定位系统                |

---

## 9. 术语对照表

| 术语          | 定义                                             | 不是什么              |
| ------------- | ------------------------------------------------ | --------------------- |
| Canvas        | 浏览器视口，物理像素边界                         | 不是布局系统          |
| Grid          | 100px 间距的参考线网格                           | 不是坐标系            |
| Cell          | 布局度量单位（80px）                             | 不是可见元素          |
| Panel         | 可见业务组件实例                                 | 不是容器              |
| GAP           | 基础间距单位（10px）                             | 不是 Panel 间距       |
| PANEL_SPACING | Panel 之间/边缘的间距（20px = 2×GAP）            | 不是 CELL_PADDING     |
| CELL_PADDING  | Panel 内部 padding（10px = 1×GAP）               | 不是 Panel 间距       |
| GRID_SIZE     | Grid 参考线间距（100px）                         | 不是 Cell 尺寸        |
| SAFE_MARGIN   | Panel 到 Canvas 边缘距离（20px = PANEL_SPACING） | 不是内部 padding      |
| PPS           | Panel Position System，面板定位系统              | 不是 CSS Grid/Flexbox |
| anchor        | Panel 的锚定边缘                                 | 不是绝对坐标          |
| Dock          | 底部导航，由 N 个 1×1 Button Panel 组成          | 不是 Area             |

---

## 附录 A：不同视口下的布局参数

| 视口      | CELL_PIXEL | Grid 列×行 | 左侧 Panel 宽 | 右侧 Panel 宽 | 地图宽 |
| --------- | ---------- | ---------- | ------------- | ------------- | ------ |
| 1920×1080 | 90         | 19×12      | 360px         | 360px         | 1160px |
| 1366×768  | 80         | 13×9       | 320px         | 320px         | 706px  |
| 1024×768  | 80         | 10×9       | 320px         | 320px         | 364px  |
| 768×1024  | 70         | 7×10       | 280px         | 280px         | 188px  |

## 附录 B：首页 Panel 注册表（机器可读格式）

```
panels:
  - id: title
    w: auto
    h: 1
    anchor: top-center
    offsetY: 0

  - id: btn-qinzhou
    w: 1
    h: 1
    anchor: top-right
    offsetX: 0
    offsetY: 0

  - id: btn-beihai
    w: 1
    h: 1
    anchor: top-right
    offsetX: 1.25
    offsetY: 0

  - id: btn-fangcheng
    w: 1
    h: 1
    anchor: top-right
    offsetX: 2.5
    offsetY: 0

  - id: btn-profile
    w: 1
    h: 1
    anchor: top-right
    offsetX: 3.75
    offsetY: 0

  - id: line-chart
    w: 4
    h: 4
    anchor: top-left
    offsetY: 1.25        // Title(1 Cell) + spacing(0.25 Cell)

  - id: bar-chart
    w: 4
    h: 5
    anchor: top-left
    offsetY: 5.5          // 1.25 + 4 + 0.25

  - id: radar-chart
    w: 4
    h: 4
    anchor: top-right
    offsetY: 1.25         // 按钮底(1 Cell) + spacing(0.25 Cell)

  - id: layer-control
    w: 4
    h: 5
    anchor: top-right
    offsetY: 5.5          // 1.25 + 4 + 0.25

  - id: dock
    w: auto               // = 按钮数
    h: 1
    anchor: bottom-center
    offsetY: 0
```

---

## 补丁 A：CSS 工具集（实践补充）

> 本补丁记录规范发布后在 `useGCS.js` 实现中新增的工具函数和约定。  
> 不修改原有规范内容，仅追加说明。

### A.1 背景

Vue 3 的 `v-bind()` 在 CSS 中不支持对象属性访问（如 `v-bind(css.cell8px)` 在旧版本会报错）。  
为了解决此问题，`useGCS.js` 在 V2 实现中新增了 `css` 对象和一组平铺变量。

### A.2 `css` 对象

```js
const { css } = useGCS()
// 在 CSS 中：v-bind(css.cell8px)
```

`css` 对象包含以下属性：

| 属性 | 计算方式 | 默认值 (CELL_PIXEL=80) | 用途 |
|---|---|---|---|
| `cell8px` | `cellPixel × 0.1` | 8px | 极小的间距/内边距 |
| `cell16px` | `cellPixel × 0.2` | 16px | 中等间距/内边距 |
| `cell40px` | `cellPixel × 0.5` | 40px | 大间距/面板内部区块间距 |
| `fontSizeTitle` | **固定 16px** | 16px | 面板标题字号 |
| `fontSizeBody` | **固定 14px** | 14px | 正文/列表字号 |
| `fontSizeSmall` | **固定 12px** | 12px | 辅助/标注字号 |

**命名说明**：`cell8px` 的名称为习惯命名（表示"常用于 8px 场景"），实际值随 `CELL_PIXEL` 响应式变化。  
当 `CELL_PIXEL=90` 时 `cell8px` 实际为 9px，`CELL_PIXEL=70` 时为 7px。

### A.3 字号标准（与响应式解耦）

**设计决策**：字号不参与响应式缩放。与 Panel 尺寸不同，字号适用于固定档位：

| 层级 | 值 | CSS 变量名 | 场景 |
|---|---|---|---|
| 标题 | 16px | `fontSizeTitle` | 面板标题、GcsPanel 标题栏 |
| 正文 | 14px | `fontSizeBody` | 列表项、统计数字、描述文字 |
| 辅助 | 12px | `fontSizeSmall` | 标注、时间戳、次要信息 |

**理由**：字号跟随 `CELL_PIXEL` 变化会导致：
- 1920px 视口下标题变成 18px（`90 × 0.2`），过大
- 768px 视口下正文变成 11.5px（`70 × 0.165`），过小
- 用户感知的"字号一致性"比"比例一致性"更重要

在 `useGCS.js` 实现中，字号当前使用 `cellPixel × 倍数` 计算（响应式），**建议改为固定 `px` 值**：

```js
// 建议修改为固定值（当前为响应式，不够合理）
fontSizeTitle: computed(() => '16px'),
fontSizeBody: computed(() => '14px'),
fontSizeSmall: computed(() => '12px'),
```

### A.4 平铺变量（Flattened Variables）

为了减少组件的重复解构代码，`useGCS` 的返回值直接平铺了常用 CSS 变量：

```js
return {
  css,                       // 对象形式，通过解构获取
  cell8px: css.cell8px,      // 平铺形式，直接解构
  cell16px: css.cell16px,
  cell40px: css.cell40px,
  fontSizeTitle: css.fontSizeTitle,
  fontSizeBody: css.fontSizeBody,
  fontSizeSmall: css.fontSizeSmall,
}
```

**两种使用方式等价**：

```js
// 方式 A：通过 css 对象
const { css } = useGCS()
// → v-bind(css.cell8px)

// 方式 B：直接解构（推荐，更简洁）
const { cell8px } = useGCS()
// → v-bind(cell8px)
```

**推荐使用方式 B**，减少一层嵌套。

### A.5 `GRID_SIZE` 导出状态

`config.js` 中定义了 `GRID_SIZE = 100`，但当前未在 `useGCS` 返回值中导出。  
原因：检查模式（Inspection Mode）尚未完整实现。实现时需补加。

对 GcsInspectionOverlay.vue 的提示：
```js
// 届时在 useGCS 中追加
const gridSize = computed(() => GRID_SIZE)  // 100px（固定值，不响应式）
```

---

**文档结束。**

**核心回顾：**

1. Canvas 是屏幕，Grid 是尺子，Cell 是单位，Panel 是一切
2. 不存在容器，不存在区域，只有 Panel 实例
3. 间距统一 2×GAP = 20px，无例外
4. Panel 用 Cell 定义尺寸，布局引擎计算像素位置
5. 字号固定档位（16/14/12px），不参与响应式缩放
6. CSS 变量通过 `useGCS().css` 或平铺形式获取
