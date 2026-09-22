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
    // 业务模块互不依赖：每模块一条全称规则（from 本模块 → to 任何其它业务目录）。
    // 04-E2：禁止"逐个枚举模块名"表达全称约束——覆盖面由 cruise-coverage 守卫断言
    // （规则模块集合 == business/ 实际目录集合，新增目录未建规则即红，z055）。
    // 2026-09-22 重构：原 3 条两两互引规则只覆盖 flood/site/forecast，
    // route-analysis 自落地起无守护（z051/z053 在册）；且枚举式 to 每加模块要改 N 处。
    {
      name: 'business-cross-import-flood-analysis',
      comment:
        'flood-analysis 不应依赖其他业务模块（经 manifest 注册；2026-08-10 P1-2：warn→error）',
      severity: 'error',
      from: { path: '^frontend/src/business/flood-analysis/' },
      to: {
        path: '^frontend/src/business/',
        pathNot: '^frontend/src/business/flood-analysis/',
      },
    },
    {
      name: 'business-cross-import-site-selection',
      comment: 'site-selection 不应依赖其他业务模块（z055 补双向；2026-08-10 P1-2：warn→error）',
      severity: 'error',
      from: { path: '^frontend/src/business/site-selection/' },
      to: {
        path: '^frontend/src/business/',
        pathNot: '^frontend/src/business/site-selection/',
      },
    },
    {
      name: 'business-cross-import-forecast',
      comment: 'forecast 不应依赖其他业务模块（z055 补双向；2026-08-10 P1-2：warn→error）',
      severity: 'error',
      from: { path: '^frontend/src/business/forecast/' },
      to: {
        path: '^frontend/src/business/',
        pathNot: '^frontend/src/business/forecast/',
      },
    },
    {
      name: 'business-cross-import-route-analysis',
      comment:
        'route-analysis 不应依赖其他业务模块（2026-09-22 补：该模块落地起无互引守护，z051/z053）',
      severity: 'error',
      from: { path: '^frontend/src/business/route-analysis/' },
      to: {
        path: '^frontend/src/business/',
        pathNot: '^frontend/src/business/route-analysis/',
      },
    },
    {
      name: 'renderers-cross-reference',
      comment:
        '渲染器间不应互相引用（OLRenderer 与 CesiumRenderer 各自独立；CesiumRenderer 内部 helper 不算互引）',
      severity: 'error',
      from: { path: 'frontend/src/core/map/renderers/', pathNot: 'index\\.(js|ts)' },
      to: {
        path: 'frontend/src/core/map/renderers/',
        pathNot: '(MapRenderer|index\\.(js|ts))',
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
    // ===== 后端模块分层契约（Nest 形态：modules/<域>/{controllers,services,repositories}）=====
    // 层间单向约束：controller 只向下委托 service，service 不得反向依赖 controller，
    // repositories 是数据访问叶子层。
    {
      name: 'nest-controllers-not-import-repositories',
      comment: 'controller 经 service 委托业务，不得越层直接 import repositories',
      severity: 'error',
      from: { path: '^backend/src/modules/[^/]+/controllers/' },
      to: { path: '^backend/src/modules/[^/]+/repositories/' },
    },
    {
      name: 'nest-services-not-import-controllers',
      comment: 'services 不得反向依赖 controllers（上层只向下委托）',
      severity: 'error',
      from: { path: '^backend/src/modules/[^/]+/services/' },
      to: { path: '^backend/src/modules/[^/]+/controllers/' },
    },
    {
      name: 'nest-repositories-not-import-upper-layers',
      comment: 'repositories 是数据访问叶子层，不得 import controllers/services',
      severity: 'error',
      from: { path: '^backend/src/modules/[^/]+/repositories/' },
      to: { path: '^backend/src/modules/[^/]+/(controllers|services)/' },
    },
    // DB 访问收口：pg 仅允许 repository 层与 infra/db（连接池 provider）import，
    // 其余层禁止直接依赖 pg，防止裸 SQL 散落到 service/controller。
    {
      name: 'nest-db-access-only-in-repository',
      severity: 'error',
      from: { path: '^backend/src/', pathNot: '(repositories/|infra/db/)' },
      to: { path: 'node_modules/pg' },
    },
  ],
  options: {
    doNotFollow: 'node_modules',
    // 解析 @/ 别名（vite alias 定义在 frontend/tsconfig.app.json 的 paths），否则规则匹配不到
    tsConfig: { fileName: 'tsconfig.cruise.json' },
    tsPreCompilationDeps: true,
    // ⚠️ node_modules 不得进 exclude.path（z055）：exclude 会把命中模块整体移出结果，
    // nest-db-access-only-in-repository 的 to 正是 node_modules/pg ⇒ 该规则恒不报告
    // （19 条里唯一不能红的一条）。doNotFollow 已保证不爬进 node_modules，
    // 移除 exclude 后它们仅作为依赖边终点出现在图里（+17 个叶子模块），规则恢复可红。
    exclude: {
      path: '(__tests__|dist|\\.test\\.)',
    },
    includeOnly: '^(frontend/src|backend)',
  },
}
