/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-imports-business',
      comment: 'core 层不应依赖业务层',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/(business|views)/' },
    },
    {
      name: 'services-imports-business',
      comment: 'services 层不应依赖业务层',
      severity: 'error',
      from: { path: '^src/services/' },
      to: { path: '^src/(business|views)/' },
    },
    {
      name: 'business-cross-import',
      comment: '业务模块间不应交叉引用',
      severity: 'warn',
      from: { path: '^src/business/flood-analysis/' },
      to: { path: '^src/business/site-selection/' },
    },
    {
      name: 'renderers-cross-reference',
      comment: '渲染器间不应互相引用（各自独立）',
      severity: 'error',
      from: { path: 'src/core/map/renderers/', pathNot: 'index\\.js' },
      to: { path: 'src/core/map/renderers/', pathNot: '(MapRenderer|index\\.js)' },
    },
    {
      name: 'stores-imports-business',
      comment: 'store 不应导入业务模块',
      severity: 'error',
      from: { path: '^src/stores/' },
      to: { path: '^src/(business|views)/' },
    },
    {
      name: 'visualization-should-not-import-business',
      comment: '可视化层是通用资产，不应反向依赖具体业务',
      severity: 'warn',
      from: { path: '^src/visualization/' },
      to: { path: '^src/business/' },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: '禁止循环依赖',
      from: { },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: 'node_modules',
    exclude: {
      path: '(node_modules|__tests__|dist|\\.test\\.)',
    },
    includeOnly: '^(src|server)',
  },
}
