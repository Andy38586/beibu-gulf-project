# 批次8 · UI 组件与工程规范硬化（13 项）

> **定位**：p1~p3 收尾硬化——错误重试（c027）、渲染 key（c028）、空态组件（c029）、伪 shared（c031）、错误上报（z046）、ESLint 三规则（z056/z069/z070）、coverage 基线（z057）、回归机制（z065）、E2E（z064）、模块 README（z066）、commitlint（z068）。
>
> **前置依赖**：批次7 完成（本批涉及的 eslint/depcruise/coverage 基线建立在前面修复后的代码上）。
>
> **边界红线（本批）**：规则启用类改动先跑 lint 摸清存量违规（存量违规可用 `// eslint-disable-next-line` 逐处标注，**不批量 disable**）；不引入新依赖（D-15 Sentry / D-16 E2E 框架除外，等拍板）。

---

## Part 1 · c027（P1）error 状态缺重试按钮

### 现状（审计）
c006/z033 已提供 refresh 能力，但数据消费组件 error 分支普遍缺"重试"按钮。

### 目标改动
1. 先 grep 数据消费组件的 error 分支（FloodAnalysisPage/SiteSelectionPage/ForecastPage/WaterLevelProfilePanel 等），确认哪些已用 useAsyncData（有 refresh）。
2. 对已有 `refresh()`/重新加载能力的组件，error 分支补按钮：
```vue
<div v-if="error" class="error-state">
  <p>{{ error }}</p>
  <GCSButton @click="retry">重试</GCSButton>
</div>
```
`retry = () => { error.value = ''; refresh() }`（或按组件现有加载函数）。
3. 无统一三态 composable 的组件：**本 Part 只补按钮**（调现有重新加载函数），不重构三态（范围控制）。

### 验证
1. typecheck + 相关组件测试全绿。
2. 手工：断网触发错误 → 点重试 → 恢复后数据加载成功。

### 完成检查
- [x] 独立 commit：`feat(c027): 数据错误态补重试按钮（复用现有 refresh）`

---

## Part 2 · c028（P1）GCSInspectionOverlay 用 index 做 key

### 现状（审计）
`GCSInspectionOverlay.vue:473` `<div v-for="(issue,index) in alignmentIssues" :key="index">`。

### 目标改动
```vue
<div v-for="(issue, index) in alignmentIssues" :key="`${issue.rule ?? 'rule'}-${index}`">
```
（issue 无唯一 id 时用 rule+index 复合 key；若 issue 有 id 字段则用 `issue.id`。）

### 验证
1. typecheck exit 0。
2. 开发审查工具打开 GCS 检查面板无渲染告警。

### 完成检查
- [x] 独立 commit：`fix(c028): GCSInspectionOverlay 列表 key 改唯一复合键`

---

## Part 3 · c029（P2）无统一 Empty 组件

### 现状（审计）
PaginatedListPanel 有分页+空状态，但无统一 Empty 组件；图表组件空数据占位未确认。

### 目标改动
1. 新建 `shared/components/EmptyState.vue`（props: `message?: string`，默认"暂无数据"；样式走 useGCS 网格/--GCS-* 变量——**注意 z054 后 useGCS 在 shared，无越层问题**）：
```vue
<template>
  <div class="empty-state"><p>{{ message }}</p></div>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), { message: '暂无数据' })
</script>
```
2. 图表组件（BarChart/LineChart/RadarChart）：`series` 为空或全空时显示 `<EmptyState />` 占位（实施时确认各图表组件数据结构，最小实现：`v-if="hasData"` 切换）。
3. PaginatedListPanel 空状态改复用 EmptyState（行为一致即可，不强求）。

### 验证
1. typecheck + 相关测试绿。
2. 手工：预测页/洪涝页无数据时显示"暂无数据"占位。

### 完成检查
- [x] 独立 commit：`feat(c029): 统一 EmptyState 组件并接入图表空态`

---

## Part 4 · c031（P3）伪 shared 组件

### 现状（审计）
`shared/composables/useScreenActions.ts` / `useAsyncData.ts` 各仅 1 个消费方（AppLayout）。

### 目标改动
`useScreenActions.ts` 与 `useAsyncData.ts` 文件头补注释：
```ts
/**
 * @internal 当前仅 AppLayout.vue 1 个消费方（c031 标注）。
 * 若后续仍无第二消费方，应下移至 core/layout/composables/。
 */
```
（不实际移动——z054 批次7 后 core 依赖方向已定，移动与否无实质收益，标注即可。）

### 验证
1. typecheck exit 0。
2. 独立 commit：`docs(c031): 伪 shared composable 标注消费方现状`

---

## Part 5 · z046（P1）错误上报 SDK 未接入 —— ⏸️ 等 D-15

### 现状（实码核实）
`logger.ts` 有 addLogTransport 钩子（z029 已解决）；`main.ts:71` 注释"可以集成错误上报服务（如 Sentry）"未实际接入。

### 目标改动（视 D-15 拍板）
- **若 D-15=A（暂缓+文档化，推荐）**：`main.ts:71` 注释补全接入路径说明：
```ts
// z046: 错误上报接入路径（暂缓）：Sentry 账号 + DSN 就绪后——
// 1) 安装 @sentry/vue；2) import * as Sentry from '@sentry/vue'；
// 3) Sentry.init({ app, dsn, release: __APP_VERSION__, environment: import.meta.env.MODE })；
// 4) logger.addLogTransport((level, args) => Sentry.captureMessage(...)) 一行接入。
```
- **若 D-15=B（接入）**：按上述路径实施，需用户提供 DSN（含 release/version/environment 三要素）。

### 验证
1. typecheck exit 0（A 纯注释）。
2. 独立 commit：`docs(z046): 错误上报接入路径文档化（按 D-15 决策）`

---

## Part 6 · z056（P1）ESLint 未启用 no-floating-promises

### 现状（审计）
`eslint.config.js:117-152` 未启用 `@typescript-eslint/no-floating-promises`；如 `App.vue:117` `restoreAuth()` 浮动调用。

### 目标改动
1. `eslint.config.js` typescript 规则块追加：
```js
'@typescript-eslint/no-floating-promises': 'error',
```
2. 跑 `npm run lint` 摸清存量违规（预期数十处）——逐处处理：有意的 `void fn()`；无意的补 `await`/`.catch`。**存量违规处理完后**再让该规则生效阻断新增（或先 `'warn'` 观察一批，再升级 error——审计要求 error，按 error 处理但分 2 个 commit：先 warn 清存量 → 升 error）。

### 验证
1. `npm run lint` exit 0。
2. typecheck 不受影响。

### 完成检查
- [x] 独立 commit：`chore(z056): 启用 no-floating-promises 并清理存量浮动 Promise`

---

## Part 7 · z057（P1）CI 不跑 coverage、无阈值

### 现状（审计）
`frontend/vitest.config.js:10-12` coverage provider v8 无阈值；`backend/vitest.config.js` 无 coverage；`ci.yml:48` 只跑 npm test。

### 目标改动
1. `frontend/vitest.config.js` coverage 增加阈值：
```js
coverage: {
  provider: 'v8',
  thresholds: {
    lines: 60,
    functions: 60,
    branches: 50,
    statements: 60,
  },
}
```
> 先跑一次 `npx vitest run --coverage` 看当前基线，阈值取**略低于基线**（防止 CI 直接红），日志记录基线数值。
2. `ci.yml` test 步骤追加 `--coverage`（前端）与后端 coverage（若 backend vitest 支持）。
3. 后端 vitest.config.js 按前端同款补 coverage 配置（或注明后端用 node:test 无 coverage 工具——实施时确认，若 node:test 则记录并跳过，不强行引框架）。

### 验证
1. `npx vitest run --coverage` 通过阈值。
2. CI YAML 语法正确。

### 完成检查
- [x] 独立 commit：`ci(z057): vitest coverage 阈值 + CI 跑 coverage`

---

## Part 8 · z064（P2）无集成/E2E 测试 —— ⏸️ 暂缓（D-16=C 用户决策）

### 现状（审计）
仅单元测试；无集成测试目录、无 E2E 框架。

### 目标改动（视 D-16 拍板；D-16=A 后端集成测试，推荐）
- **若 D-16=A**：`backend/test/integration/` 新增 API 层集成测试（node:test 串联 controller+service+数据文件）：
  - 用例 1：`GET /api/ports` → 200 + 数组（真实数据文件）
  - 用例 2：`POST /api/flood/analysis/disaster` → 200 + 契约字段（b033 联动）
  - 用例 3：`POST /api/auth/login`（测试账号）→ 200 + cookie 设置
  - 启动方式：测试内 `createApp()` 起临时 server 或直接 supertest 风格（node:test 自带 fetch 即可）。
- **若 D-16=B（Playwright）**：引入框架 + 浏览器安装 + CI 集成，工作量 3~5 天，列为演进路线。

### 验证
1. `node --test backend/test/integration` 全绿。
2. 独立 commit：`test(z064): 后端 API 层集成测试（3 条核心链路）`

---

## Part 9 · z065（P2）无回归测试机制

### 目标改动
1. 工程规范文档（`docs/开工前必读/` 下或本批日志）：明确"**bug 修复必须附带回归测试**"（修复的缺陷有可测断言则必补）。
2. 建立回归测试集标记：前端 vitest 中 `describe('regression: ...')` 命名约定 + 后端 `test('regression-xxx')`；CI 单独 step 跑 `--testNamePattern regression`（或标注即可，不强求独立 step）。
3. 本批次起，前面 7 个批次修复的每个编号在移入已解决问题.md 时，其回归测试已随各 Part 补入（本 Part 只是把约定固化）。

### 验证
1. 文档产出。
2. 独立 commit：`docs(z065): 回归测试约定（修复必附回归测试 + 命名规范）`

---

## Part 10 · z066（P2）关键模块缺独立 README

### 目标改动
为以下模块各补 100~150 行 README（职责/入口/依赖/约束）：
- `frontend/src/core/README.md`（UnifiedMap 生命周期、BLM registry、渲染器复用语义）
- `frontend/src/shared/README.md`（工具/composable 清单、分层约束——shared 不得依赖 core/stores/business）
- `backend/services/README.md`（forecastEngine/floodService 职责、算法说明）
- `backend/middleware/README.md`（鉴权/限流/脱敏中间件清单）
- `backend/data/README.md`（JSON 存储说明、字段结构、扩展方式）
> 内容以**现状为准**（照代码写，不写愿景）；引用关键 @arch-note 注释。

### 验证
1. 文档产出，无代码改动。
2. 独立 commit：`docs(z066): core/shared/backend 模块 README`

---

## Part 11 · z068（P3）无 commitlint 规范

### 现状（审计）
无 commitlint/commitizen，husky 未校验 commit-msg。

### 目标改动
1. 根 package.json devDependencies 新增 `@commitlint/cli` + `@commitlint/config-conventional`（**本批允许的依赖新增**）。
2. 新建 `commitlint.config.js`：
```js
module.exports = { extends: ['@commitlint/config-conventional'] }
```
3. husky 增加 commit-msg hook：`npx husky add .husky/commit-msg 'npx --no -- commitlint --edit "$1"'`。
> ⚠️ **git 历史哲学红线**：只对**新 commit** 生效，历史 commit 不整理（用户明令不 squash/不规范化历史）。

### 验证
1. 造一个不合规 commit message → hook 拦截。
2. 独立 commit：`chore(z068): 接入 commitlint（仅约束新 commit）`

---

## Part 12 · z069（P3）ESLint 未启用 prefer-const

### 目标改动
`eslint.config.js` 基础规则块追加 `'prefer-const': 'error'`；跑 lint 清理存量（未重新赋值的 let → const，纯机械替换）；存量清完 exit 0。

### 验证
1. `npm run lint` exit 0。
2. typecheck 不受影响。
3. 独立 commit：`chore(z069): 启用 prefer-const 并清理存量`

---

## Part 13 · z070（P3）ESLint 未启用 vue/no-ref-as-operand

### 目标改动
`eslint.config.js` vue 规则块追加 `'vue/no-ref-as-operand': 'error'`；跑 lint 修复 script 中 ref 漏 `.value`（**⚠️ 该规则修复可能改变运行时行为**——漏 .value 的代码实际是 bug，修复后行为变化属预期；每处修复后跑相关测试）。

### 验证
1. `npm run lint` exit 0。
2. 前端全量测试全绿（修复漏 .value 后行为可能变化，全量回归必要）。
3. 独立 commit：`fix(z070): 启用 vue/no-ref-as-operand 并修复漏 .value 处`

---

## 批次收尾验证

1. `npm run typecheck` exit 0。
2. `npm run lint` exit 0（三规则启用后）。
3. 前端全量 vitest 全绿 + coverage 过阈值。
4. 后端 node --test 全绿。
5. `npx depcruise` exit 0（批次7 后基线保持）。
6. 本批编号（c027 c028 c029 c031 z046 z056 z057 z064 z065 z066 z068 z069 z070）从 8.2 清单删除，移入 `已解决问题.md`（补 solve）。
7. 日志追加 `logs/批次8-UI组件与工程规范硬化-执行日志.md`，记录 D-15/D-16 决策与 coverage 基线数值。

## 批次全部完成后（8 批收尾）

- `待解决问题-8.2审计专项.md` 应只剩「已解决」空壳（全部编号移入 `已解决问题.md`），更新其头部状态说明或归档。
- 汇总各批日志到 `logs/汇总报告.md`：8 批完成情况、决策拍板表、coverage 基线、depcruise 违规数变化曲线、typecheck/测试数字。
- 同步更新 `00-总览与批次规划.md` 状态（全部 ✅）。
