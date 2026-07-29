/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-imports-business',
      comment: 'core 层不应依赖业务层',
      severity: 'error',
      from: { path: '^frontend/src/core/' },
      to: { path: '^frontend/src/(business|views)/' },
    },
    {
      name: 'services-imports-business',
      comment: 'services 层不应依赖业务层',
      severity: 'error',
      from: { path: '^frontend/src/services/' },
      to: { path: '^frontend/src/(business|views)/' },
    },
    {
      name: 'business-cross-import',
      comment: '业务模块间不应交叉引用',
      severity: 'warn',
      from: { path: '^frontend/src/business/flood-analysis/' },
      to: { path: '^frontend/src/business/site-selection/' },
    },
    {
      name: 'renderers-cross-reference',
      comment: '渲染器间不应互相引用（各自独立）',
      severity: 'error',
      from: { path: 'frontend/src/core/map/renderers/', pathNot: 'index\\.js' },
      to: { path: 'frontend/src/core/map/renderers/', pathNot: '(MapRenderer|index\\.js)' },
    },
    {
      name: 'stores-imports-business',
      comment: 'store 不应导入业务模块',
      severity: 'error',
      from: { path: '^frontend/src/stores/' },
      to: { path: '^frontend/src/(business|views)/' },
    },
    {
      name: 'shared-imports-business',
      comment: 'shared 层是通用基础设施，不应反向依赖业务层',
      severity: 'error',
      from: { path: '^frontend/src/shared/' },
      to: { path: '^frontend/src/(business|views)/' },
    },
    {
      name: 'visualization-should-not-import-business',
      comment: '可视化层是通用资产，不应反向依赖具体业务',
      severity: 'error',
      from: { path: '^frontend/src/visualization/' },
      to: { path: '^frontend/src/business/' },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: '禁止循环依赖',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: 'node_modules',
    // 解析 @/ 别名（vite alias 定义在 frontend/tsconfig.app.json 的 paths），否则规则匹配不到
    tsConfig: { fileName: 'tsconfig.cruise.json' },
    tsPreCompilationDeps: true,
    exclude: {
      path: '(node_modules|__tests__|dist|\\.test\\.)',
    },
    includeOnly: '^(frontend/src|backend)',
  },
}
