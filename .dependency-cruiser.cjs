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
      name: 'business-cross-import-flood',
      comment: 'flood-analysis 不应依赖其他业务模块（z055 补双向）',
      severity: 'warn',
      from: { path: '^frontend/src/business/flood-analysis/' },
      to: { path: '^frontend/src/business/(site-selection|forecast)/' },
    },
    {
      name: 'business-cross-import-site',
      comment: 'site-selection 不应依赖其他业务模块（z055 补双向）',
      severity: 'warn',
      from: { path: '^frontend/src/business/site-selection/' },
      to: { path: '^frontend/src/business/(flood-analysis|forecast)/' },
    },
    {
      name: 'business-cross-import-forecast',
      comment: 'forecast 不应依赖其他业务模块（z055 补双向）',
      severity: 'warn',
      from: { path: '^frontend/src/business/forecast/' },
      to: { path: '^frontend/src/business/(flood-analysis|site-selection)/' },
    },
    {
      name: 'renderers-cross-reference',
      comment:
        '渲染器间不应互相引用（OLRenderer 与 CesiumRenderer 各自独立；CesiumRenderer 内部 helper 不算互引）',
      severity: 'error',
      from: { path: 'frontend/src/core/map/renderers/', pathNot: 'index\\.(js|ts)' },
      to: {
        path: 'frontend/src/core/map/renderers/',
        pathNot:
          '(MapRenderer|index\\.(js|ts)|CesiumWaterSurface|CesiumViewportCulling|CesiumLayerRegistrar|CesiumEvents)',
      },
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
      name: 'shared-not-import-core',
      comment: 'shared 层不应依赖 core 层（z054：8 处违规）',
      severity: 'error',
      from: { path: '^frontend/src/shared/' },
      to: { path: '^frontend/src/core/' },
    },
    {
      name: 'shared-not-import-stores',
      comment: 'shared 层不应依赖 stores 层（z053：useAuth 重置 5 store）',
      severity: 'error',
      from: { path: '^frontend/src/shared/' },
      to: { path: '^frontend/src/stores/' },
    },
    {
      name: 'visualization-should-not-import-business',
      comment: '可视化层是通用资产，不应反向依赖具体业务',
      severity: 'error',
      from: { path: '^frontend/src/visualization/' },
      to: { path: '^frontend/src/business/' },
    },
    {
      name: 'types-not-import-shared',
      comment:
        '分层契约（架构审查收口）：types/ 为纯类型层,禁止 import shared 运行时工具——' +
        '曾发生 types/crs.ts 引 logger 的反向依赖（normalizePoint 等已移 shared/utils/crs）。',
      severity: 'error',
      from: { path: '^frontend/src/types/' },
      to: { path: '^frontend/src/shared/' },
    },
    {
      name: 'services-not-import-core',
      comment:
        '分层契约：services 禁止 import core。唯一例外为叶子配置 core/config/map' +
        '（mapDataService 深路径引用,走 @/core 会形成 core↔services 循环,详见该文件注释）。',
      severity: 'error',
      from: { path: '^frontend/src/services/' },
      to: { path: '^frontend/src/core/', pathNot: '^frontend/src/core/config/map' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: '禁止循环依赖（z055 升级 error）',
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
