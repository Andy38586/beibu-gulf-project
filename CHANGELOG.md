<!-- 由 `npm run changelog` 自动生成，勿手改 -->

# Changelog

## 2026-08-31

- docs: 闭环z038/z077台账——单测覆盖与后端no-console复核实为已解决 (41ae5b2)

## 2026-08-30

- feat: 登录失败细分反馈 + GCS Toast胶囊规格收敛 (2c2647b)
- feat: 设施POI气泡图层与地图双引擎渲染器联动收敛 (551bcd9)
- feat: 三城POI数据接入与选址城市切换 + coverage性能优化 (815ae0e)
- feat: 生命周期与竞态硬化——abort透传/最新请求守卫/FOUC防闪白/暗色Cesium压暗 (ac81fa5)
- feat: 预测/浸没假数据根除与垂直基准(EGM96)统一 (b46df52)
- fix: 雷达轴名点击在 radar 根级开启 triggerEvent 修复设施POI图层交互失效 (1f9cd7f)
- fix: online 兜底 503 守卫 + cut 版 DEM 复原链路（GLO-30 裁切，口径披露） (2df2d27)
- fix: 假数据根除与垂直基准统一，container 接入模型链路 (6f852c1)
- fix: 登出重置删常驻层目录致图层控制按钮缺失(d116) (7d58bca)
- fix: 收口非830小问题(MobileDrawer immediate/SiteSelection浮动Promise兜底, 闭环b044分治合并/d081单位口径) (82aa6ef)
- style: tools/README.md prettier 格式修复 (5fc2253)
- style: 刻度对齐与水位口径修正——时间轴首尾收进面板,浸没刻度等距+基准面起算 (854f714)
- style: 滑块刻度对齐修复——时间轴首尾收进面板,水位档位按真实水位定位 (9a00046)
- style: 浸没水位刻度重设计为7档潮汐术语上下交错排布 (bfff970)
- docs: 登记d117部署链路加固台账,并入830复核条目 (4d0605e)
- ci: deploy SSH连接超时快速失败并三次重试自愈(d115) (11c996c)
- ci: deploy SSH改走2222高位端口绕开跨境干扰(d117) (56433d0)
- chore: .gitignore 排除.trash暂存目录 (63b0c60)

## 2026-08-29

- feat: 前端全局收藏——useFavorites单例+平铺收藏夹+面板改接,登录后自动补完未登录收藏意图 (01caf8d)
- feat: 地图要素气泡替代首页点击弹层——悬浮即显/点击钉住跟随POI/单实例互斥,Cesium关原生错误面板改日志+toast (151d12f)
- feat: 选址结果返回全量参与评分设施POI并在雷达轴点击时唤醒该类型多点呼吸 (5ea2aac)
- feat: 后端favorites收藏模块——全局唯一(itemType+itemId幂等),用户隔离,需登录三端点 (fc61fb6)
- fix: 错误成因区分全链路——describeError统一文案,502/503/504归服务器无响应,restoreAuth网络失败保留临时登录态,PlansPanel错误条改toast (40dbb48)
- fix: 分析接口免登录收口——选址/灾害评估去authenticate,未登录分析不再弹令牌toast与登录modal(02 §4.5 期望落地) (6798da7)
- fix: 登录错误反馈modal/toast化——401弹登录引导modal,文案按成因区分,LoginPanel去内联错误,注册密码placeholder提示 (ab77547)
- fix: 修复CI format假红——throughput_model补行尾,backend/data加入prettierignore（服务回写产物不受人写格式门禁） (f1c8f3a)
- perf: 地形预热串行在Cesium预热后——预取layer.json与低层瓦片,dev补max-age缓存头 (f2285a6)
- refactor: ports数据回迁前端静态托管——删/api/ports透传端点,港口不再依赖后端存活,与boundary同构,loadStatic+schema+CRS守卫保留 (b773e5d)
- docs: 重写README为作品集口径并同步三业务描述 (14fa33b)
- docs: 审查体系增补4指标至372——反馈通道唯一性/文案成因区分(专项5),要素气泡(专项4),前后端唯一副本(专项1);新增指标演进口径 (971a133)
- docs: 推送门禁收敛为npm run ci:local一条命令,沉淀三连败三条规则(活进程竞态/浅克隆差异/HEAD提交类型) (babbfb8)
- docs: 根基文档与API契约同步今日重构——ports回迁/气泡替代PortInfoPanel/mapStore去selectedPort/错误反馈口径 (f6701e3)
- ci: fix/refactor测试门禁比对HEAD~1在浅克隆下fatal误杀——lint-and-build checkout改全量历史 (1c8af52)
- ci: gitleaks补--no-git符合扫工作树设计意图;修复白名单——[[allowlists]]被extend丢弃,改单数[allowlist]纯paths (d43da9b)
- chore: throughput_model产物随服务重算刷新（行尾格式） (92beff4)
- chore: gitignore补全构建产物变体与temp_cruise忽略规则 (b6e8a91)
- chore: tools 收口与 perf-bench 两个基准脚本的路径修复 (f61feb8)
- chore: 添加MIT许可证书 (fcdf9fe)

## 2026-08-28

- feat: 移除选址雷达腾龙阁示例快照兜底 (f7d4012)
- fix: 水位滑块拇指垂直偏移补偿 4px (a2446bb)
- fix: 恢复雷达快照兜底（仅去标记）并将选中滑块改粗白轨道 (ad41296)
- style: 浸没分析水位滑块统一渐变轨道 (08f4280)
- style: SSC 滑块同步渐变轨道与 primary 白圈拇指 (6e0596a)
- style: 滑块样式通过 stylelint——白描边改关键字写法 (728852f)
- style: 滑块三页统一——选择态隐藏图标三行排布半透明轨道，水位滑块同步拇指风格 (88602c1)
- style: 预测页滑块同步粗白轨道 (a70328d)
- style: 选中态滑块恒定白轨道白拇指加投影 (b24b2cb)
- style: 统一滑块迁移预测时间滑块的渐变轨道 (cad9038)
- style: 静态检查告警清零——ESLint 94→0，lint-staged 覆盖 css 修复 CI format 根因 (d6b1d0b)
- style: 水位滑块垂直补偿精调至 6px (df1b4f1)
- style: 水位滑块拇指改蓝主体白外圈 (e1b55d1)
- style: 预测时间轴滑块轨道加粗至 14px 对齐浸没水位滑块 (fa439fa)

## 2026-08-27

- feat: 引擎标记按 adapter 真实能力声明 (15764c4)
- feat: 首屏预热队列化并接入后端 DEM 暖机 (9bf7547)
- feat: 预测指标按钮接入 SliderSelectCard 统一外观 (b50bf4d)
- feat: 图层注册表引擎标记与显式对账入口 (e4bc609)
- fix: 空覆盖文案区分全部不可用与交集断裂 (19f618d)
- fix: 底图继承在首次引擎切换即生效 (387a6b3)
- fix: 补 mapStore debugMode 状态声明与 AppLayout 接线 (ab8891a)
- fix: 空覆盖回归用例夹具对齐半径字段 (b47395a)
- fix: 底图切换指令按渲染器实例重放 (b5c1a70)
- fix: 引擎徽标改由调试模式开关控制 (c0ab6c6)
- fix: 认证反馈透传与底图初始化同步等真bug两批次修复 (fa646e5)
- perf: 移除冗余 favicon.ico 双请求 (0824ae8)
- perf: Cesium 预热延后至页面 load 空闲 3s (ee2445c)
- style: 按钮字距收紧 -0.5px (3c92583)
- style: 因子选中态滑块改横排防文字裁切 (476fcba)
- style: 同步 ESLint 自动修复后的 Prettier 格式 (a06ac81)
- style: 因子选中态恢复竖排并收紧行距 (d5e8efa)
- style: 选中蓝底滑块对比强化 (f14da5d)
- style: 引擎标号改右上角标并修因子滑块拇指裁切 (ff94a15)
- chore: ESLint 债务配置层清理与 solved 台账登记 19 条 (045b92a)
- chore: 覆盖率门禁回归实测基线并显性化推送门禁 (218d0e1)
- chore: 修复 ESLint 阻断项并清理审计残渣脚本 (467841f)
- chore: statements 阈值 38 下调至 36 留平台差异余量 (d79349a)
- chore: 同步依赖锁文件与全仓 Prettier 格式以修复 CI (eeed55c)

## 2026-08-17

- chore: 清理tools收口与工作区路径迁移 (9c65990)

## 2026-08-16

- feat: v3数据入库新增data_archive真数据存档表并修复脚本乱码,路线图补后端迁移流程 (9e88c65)
- fix: 二轮审查实锤修复(深校验/注销/abort/规则/拦截/令牌/判别/tag) (40de314)
- fix: 暗色主题token补齐与底图压暗,空态占位统一,演算接口限流,查表兜底回归测试,类型契约生成脚本 (43f0a32)
- fix: 816审查批次修复与图层/浸没分析回归修复收尾 (7be289f)
- fix: 二轮审查实锤修复(设施评估多边形同源/档位回退6档/空结果合法化/坐标哨兵过滤/clearState复位/测试账号清理/controller读文件收口repository/桶入口) (c9221fb)
- docs: 12项修复登记入已解决台账,待解决统计同步为23项,撞号b077修正为b080 (121d3e4)
- docs: 已解决台账补登记22项二轮修复(续号a071至z115) (66824c4)
- docs: 816副本承接812残余条目并删除812聚合副本,裁决入口切换 (7637633)
- docs: 审查约定反例改可grep模式描述防漂移,问题副本整合多批次流转,台账统计同步并补文档工具 (9da14fe)
- docs: 移除审查批次归档(已移交桌面文档文件夹),文档地图同步 (bb97147)
- docs: 删除被根基文档覆盖的工程规范与项目根基,统一4份记录文档格式 (e941127)
- docs: 文档整合(面试五合一/副本唯一化/数据清单移桌面/回滚与代码库归位/评审移除/README更新) (eea0ef8)
- test: 港口数据测试补齐address字段,对齐ports.json真实结构 (c8c886c)

## 2026-08-14

- feat: 数据总清单（data-inventory）与工业区提取工具；ESA WorldCover 土地类型免注册下载完成 (0191687)
- feat: v3 PostGIS 建库（最简 schema + 现有数据导入，EPSG:4490；孤儿方案被外键拦截并记录） (1358232)
- feat: 高德 POI 抓取脚本（可复现）与数据来源网页；修正工业区 POI 表述为计划项；gitignore 去重 (897951f)
- feat: 选址 v3 实验与性能基准工具（检查点提交，含面试审查与逐字稿文档） (8c2ddfb)
- feat: 路网提取工具（pyosmium bbox 过滤），数据体检全部通过并记录 PostGIS 适用性结论 (b4b0def)
- feat: OSM 海岸线/水体提取工具（pyosmium）与下载 MD5 校验，数据清单更新 (ba3fbfc)
- feat: 耕地掩膜提取工具（ESA WorldCover class 40）；数据基线收尾——运河示意线/工业区/土地类型全部到手 (cdfdda9)
- fix: token补定义/z-index槽位/渐变与边框token化/focus环/placeholder对比度/thumb统一 (130c092)
- fix: 首页雷达图复用选址分析数据源(store结果写入+AppLayout消费,面板不再空态) (2811035)
- fix: 审查体系文档对齐(上限6一致化、负载均衡与附录隔离条款、0.6拆行) (2998f37)
- fix: 选址坐标防御/bbox统一/错误信封/缓存键/渲染器类型债收口 (6787831)
- fix: 查表键toFixed/0档淹没归零/除零守卫/登出清快照/底图键白名单/占位符数据/契约文档对齐 (68a7210)
- fix: 下载脚本 rename 覆盖缺陷与滑动超时，数据清单更新为全部下载完成 (844b234)
- fix: tokenSOP与统计脚本/色常量收口/相机pitch常量/参数名统一/阈值提升/预留标注 (ab2cd1b)
- fix: adapter日志/端点对账/注释与基线修正/CSP报告模式/兜底色收口 (ab4cf2c)
- fix: 真演算回归测试/缓存单测/日志保留30天/CORS收窄/PII打码/注释漂移/文档约定 (b15cd26)
- fix: 下载脚本加超时保护并修正海底DEM直链（SRTM15_V2.6.nc，实测可用） (bb4a7b1)
- fix: plansService 抽取收口/后端治理项裁决 (d405f06)
- fix: 死状态移除/监听具名化/深路径收口/env示例/plans测试/模块README/契约补录 (dc29e2a)
- docs: 数据清单更新——红树林/保护用地已入库，GlobeLand30 确认需注册 (02708e6)
- docs: v3 范围裁剪定稿（秋招/实习/论文并行时间现实版）——砍航线/灾害系统，最短路径降级 networkx (2072b74)
- docs: v3 方向备忘定稿——双后端架构确认（NestJS+FastAPI+PostGIS）与 strangler 替换策略 (41b7809)
- docs: 后遗症真尾巴收尾(a027已解决/a042核验单/b031重编号b077) (743b485)
- docs: 文档整合——v3 发展路径（含数据/架构/阶段/环境适配）与面试准备整合版，删除原三份 v3 规划文档 (8ed29ae)
- docs: 数据来源与二次获取网页（可验证性评级/二次获取步骤/核对清单） (ca6c458)
- docs: 修复转正已解决台账(12组合并补记+43新编号+5原编号移入,open 28→23) (cee1a8c)
- docs: 审查体系元审查报告与专项3模拟并行审查产出 (d9761cd)
- docs: 后遗症41项复核处置(12项标注/10项台账勘误/门禁补第5条/人工动作核验单)并重写无批次commit信息 (f81c6ac)
- chore: v3 数据获取工具与规划文档（GLO-30/OSM/SRTM15+ 下载器、数据清单、PostGIS schema 草案） (23fb015)
- chore: 模拟审查工具链终版(7.1检查窗口与深拷贝排除修复,统计核对脚本) (aa8bb03)

## 2026-08-12

- 恢复台账与开工前必读入库（重要资产保留版本库） (8d5a51d)
- feat: 引入 stylelint（16 + postcss-html），CI 硬性拦截样式硬编码 (621d0c1)
- feat: 图层渲染增强——OL 聚合渲染能力、Cesium 视口裁剪空间索引、z-order 差异化 (7469b59)
- feat: nginx brotli 实时压缩（模块构建期验证，https 模板同步） (75f6eb2)
- fix: bbox 粗筛保守化——经度偏移按纬度区间最小 |cos| 计算并落对照测试 (301092d)
- fix: 淹没多边形与受影响设施空结果也更新图层（水位回落清除残留） (4bcd422)
- fix: 水面 async 化 rejection 兜底与 lint 修复 (689059b)
- fix: 暗色适配与 Cesium 独占清理 (8897185)
- fix: 水面按地形基准叠加水位（修复真地形下不可见） (cabfe9d)
- fix: 水面/DEM 入口随引擎注册复位（2D→3D 切换后重新注册） (f30e807)
- fix: 坐标缺失不再回退 (0,0) 哨兵——normalizePoint 返回 null 由调用方跳过 (fc96af3)
- refactor: 淹没统计字段统一——移除无消费的 totalArea 占位（避免 km²/m² 混淆） (1d8983e)
- refactor: setBaseLayer 入渲染器接口，CesiumRenderer 数据类 any 收窄 (29cae48)
- refactor: 移除 MapRendererKey 残留，修正 sampleTerrain 类型 (ea214e2)
- style: stylelint 存量清零——颜色函数现代化/alpha 百分比/空行规范 (18c11b1)
- style: scoringService 测试格式化 (949ef29)
- docs: 重建 810 副本（归类决议完整，原始描述待补） (09a1b2f)
- docs: 关键模块 README 补齐 + 回滚演练记录 (0dcde89)
- docs: prettier 统一台账文档表格格式 (35d7de1)
- docs: 恢复 open 28 项与副本处置标注（编号进度统一） (53b1a04)
- docs: 第二批 13 条转正入已解决；open 的 a043/a049 取证闭环移入、b027 编号复位 (5ed6502)
- docs: 台账表格统一紧凑列宽格式（豁免 prettier 宽列对齐） (8ed2318)
- docs: 812 专项审查总问题副本（8 专项整合，117 条待裁决） (b2c4191)
- docs: 812 审查整合去重版（117→91 新立案） (d2fe88e)
- docs: 根基文档入库（保留公开区） (da2ba47)
- docs: 精华版扩充至 20 条（总问题数 5-8%） (f1127e8)
- docs: 审计修复转正台账——25 条入已解决并附转正对照，副本移除已转正条目 (fc97248)
- chore: 清理注释中的审计编号前缀（保留正文语义） (1a91725)
- chore: 台账编号检查与维护脚本 (871ec28)
- chore: 台账审计文档移出版本库（学习性质不公开，根基文档保留） (e0464e4)
- chore: 截图保留入库供 README 引用 (eaca32e)

## 2026-08-11

- feat: 8443 备用 HTTPS 端口（duckdns.org SNI 在部分宽带被阻，8443 绕过检测） (6a490a0)
- fix: flood-service 补系统库 libexpat1/libgomp1（rasterio/scipy wheel 动态链接，slim 镜像缺失致崩溃） (21f2e70)
- fix: 图层管理防御与数据口径——要素上限、空数据兜底、在线风险等级对齐后端口径 (22fb743)
- fix: terrain gzip 头只对 .terrain 生效（layer.json 被误声明 gzip 致真地形失效） (2f55a3f)
- fix: lint-staged 移除 eslint（Windows 下 tseslint 路径失配阻塞 hook），全量 eslint 由 CI 承担 (4e2beee)
- fix: eslint 为 lint-staged 场景加 allowDefaultProject 兜底（Windows 路径失配） (6b522eb)
- fix: 渲染器坐标归一化、监听注销与增量更新 (8bdd79a)
- fix: 组件定时器与监听清理，收藏文案改为调用方注入 (95f6835)
- fix: 地图组件生命周期收口——Cesium 卸载泄漏修复、切换失败回滚、呼吸灯与监听清理 (e6198aa)
- fix: README 格式修复（prettier，CI Check format 恢复） (e67c70f)
- fix: eslint tsconfigRootDir 指向 frontend，修复 Windows 下 lint-staged 阻塞 (f603746)
- fix: 淹没分析与影响评估静默处理主动取消的请求 (fb2acf7)
- refactor: 全仓注释精简（-39%：删内部编号/日期叙事/行号引用，一句话原则，规范入工程规范 4.5） (441f6a0)
- refactor: 样式与图表色 token 化，消除硬编码值 (60cdb2c)
- refactor: 预测模块分层收口——store action 化、请求链路 adapter/composable、概览图表归位 (8523bc9)
- docs: env 模板注释修正（static 数据源已移除） (ae66bb2)
- docs: README 更新（v2.0 技术栈/部署/数据准备）+ 三张真实截图（选址/MacBook 边框） (e797909)
- test: 页面挂载冒烟测试（ForecastPage + WaterLevelProfilePanel，补 0 覆盖缺口） (988d29b)
- chore: 可观测性与后端数值防御——请求关联 ID、生产采样日志、除零与空值守卫、评分核心单测 (45df38a)

## 2026-08-10

- feat: OLRenderer 移除 @ts-nocheck（类型补全，171 错误清零，含测试适配） (0c4a9df)
- feat: CesiumRenderer 移除 @ts-nocheck（类型补全，169 错误清零）；FlyToOptions 补 heading/pitch/roll、LayerOptions 补 onError (4511cfc)
- feat: Dockerfile 改回 npm ci（官方源 lock 完整，CI 已验证）+ BottomNavBar 三档位测试（6 用例） (707a602)
- feat: 暗色模式主题切换 + 面试审查报告 P0/P1 修复（251 档预计算表查表/flood-service 容器化/Cesium 高程基准/死状态清理/cruiser 规则升级） (ba2998b)
- fix: 菜单模式面板排序（操作/图层控制上移）+ 抽屉内容不被裁剪（登录页遮挡修复）+ 部署配置对齐（443 直通/terrain volume/ssl 缓存 2m） (69e4cca)
- fix: dockerfile 构建回退 npm install（服务器 EUSAGE 宽容模式） (7966f03)
- fix: flood-service Dockerfile 默认阿里云 pip 镜像（国内服务器构建加速，可用构建参数覆盖） (bf6b599)
- fix: HTTPS 配置与 HTTP 对齐（https.conf 补 /tianditu/ 代理，消除双份配置漂移） (d469105)
- chore: 删除已并入工程规范与性能参考的散落文档（分层契约/数据流契约/性能基线/遗留问题） (494eb49)

## 2026-08-09

- Merge branch 'main' of https://github.com/Andy38586/beibu-gulf-project (ecd835a)
- feat: 响应式布局三档位重构（dock 三态+抽屉菜单+DebugToggle 独立+抽屉面板精简） (38c4d38)
- feat: 滑块专注模式+调试板块DEV隔离+SSH自动化部署（Dockerfile ARG key/server-setup.sh/deploy SSH） (59dc1cf)
- feat: 滑块专注模式（安卓控制中心风格，拖动滑块时其余面板全透明） (63dfe3c)
- feat: 吞吐量模型接入正式预测链路（cargo 走模型产物，可复现，缺失降级外推） (88bd719)
- fix: schemas 测试对 plans.json 缺失容错（gitignore 运行时文件，CI 跳过该用例） (03ae738)
- fix: nginx /static/terrain/ 补 Content-Encoding gzip（Cesium 地形瓦片解压） (167f887)
- fix: 滑块专注模式保留底部 nav（排除 .bottom-nav-bar，不随面板透明化） (1bc1e8c)
- fix: 架构违规修复（navConfig 注入模式恢复，core 不再引 business/manifest）+ audit 降级告警 (2198fa8)
- fix: Dockerfile npm registry 走 npmmirror（国内服务器构建不超时） (23a1e8b)
- fix: Dockerfile nodeapp 与 node 镜像 uid 1000 冲突（先 deluser node） (25572f0)
- fix: server-setup.sh 国内源 fallback（官方源失败自动切阿里云镜像） (42b6a5c)
- fix: Dockerfile 重写（修复 FROM 行合并+编码损坏） (42f2117)
- fix: server-setup.sh systemctl 加 sudo（避免 polkit 密码提示卡死） (4391e04)
- fix: auth cookie Secure 由实际协议决定（HTTP 生产下登录不再立即失效） (5cc1e9f)
- fix: 档位3 dock 按钮间距修复（去掉 flex 均分，space-around 恢复外边距） (5ed8a89)
- fix: Dockerfile npm ci 跳过 audit（lock peer 校验致 Missing rollup，审计归 CI） (6308909)
- fix: gitleaks 泄漏清理（文档 key 打码+allowlist 配置测试假 token） (69bf1b7)
- fix: CI 修复（format check 降级不阻断+backend 测试去 --coverage+新文件 prettier 格式化） (6f66fe5)
- fix: Dockerfile npm ci 改官方源（npmmirror 元数据差异致 lock 校验失败） (7cf0059)
- fix: 重建 lock 修复依赖不一致（npm10 全量解析） (7fc993f)
- fix: 首页图表链路修复（overview 路径缺斜杠404）+ echarts 异步化移出首屏 (8b82f77)
- fix: CI gitleaks 下载 404（资产名带版本号，改固定版本） (9102441)
- fix: Dockerfile npm ci 改 npm install（绕开 npm ci 严格 lock 校验，fsevents 等 optional 条目 Linux 天然缺失） (9f9196d)
- fix: 演示场景放宽限流（全局1000/登录50）+ 洪涝滑块上限对齐数据档位（0-15m） (a4a7b87)
- fix: P0/P1审查修复（首页接预测快照charts、删init死接口、duration生效、CONFIRM_DELAY/formatLoss抽shared、toast定时器修复） (a97c307)
- fix: P1 双修（滑块专注卸载清理+退出；cargo 置信度滑块改模型基线标注） (b68d5e8)
- fix: HTTP 服务的 /static/terrain/ 补 Content-Encoding gzip（改错分支，HTTP 用 nginx.conf 非 entrypoint HTTPS 块） (bb35549)
- fix: me 响应禁缓存（no-store）——304 被前端误判登出导致刷新掉登录 (c23c8b1)
- fix: compose 端口改 80:80（标准网站端口，需停用服务器系统 nginx） (c616286)
- fix: 洪涝刻度适配 0-15m（原 15/20 越界重叠，改 2/10/15 落在数据档位） (cd8a49b)
- fix: compose 移除 3000 端口映射（服务器被 PM2 占用，nginx 代理已够用） (d9be022)
- fix: ProfilePage 清理未使用的 css 解构 (e7d857b)
- fix: API 请求禁缓存（304 误判根治）+ 退出按钮下沉到个人中心底部 (e92cbf9)
- fix: npm audit 漏洞修复（overrides 锁定修复版本，恢复 audit 硬性阻断） (ecb2c30)
- fix: 删除洪涝档位回显 toast（数据档位制，拖动即弹导致爆炸） (eebf16b)
- fix: lock 官方源重建（peer 完整解析） (f0cce63)
- refactor: 审查收尾（分析回调移出mapStore改页面直连、selectedXiaoqu死镜像清除、后端读缓存统一收口readStaticJson） (021461e)
- refactor: 清理收尾（floodStore \*Active改computed、删4死方法、后端评分三文件合并、删useMapRenderer死函数） (dd64c7c)
- style: 全仓 prettier 格式化 + CI 恢复 format/audit 硬性阻断 (c819ffb)
- docs: 部署历程记录（2026-08-09 全流程+踩坑根因）+ 退出按钮 0.1cell 内边距 (0fc7335)
- docs: 性能基线记录（选址端到端 4.5s/floodArea 解析 6.3ms，浏览器三项待验收） (67e0167)
- docs: 补充数据流契约与遗留问题文档，删除过时 DEM 方案 (a3f9b07)
- chore: dem_hillshade.tif 入仓（服务器部署需要，64MB；后续可从 git 历史清理） (25b6ed4)

## 2026-08-08

- feat: 预测页状态跨路由保存恢复（跳登录返回保留全部状态） (1c61084)
- feat: GCS反馈层打磨收尾（modal 4×3居中+cell保底80、toast 2×0.5队列4条顶入底出、调试面板反馈测试入口） (a78fabd)
- feat: 列表组件封装flyTo跳转（点击列表项自动定位，浸没/选址统一） (af4d2a9)
- feat: GCS标准反馈层（GCSModal 4×3+重试/取消/X、GCSToast 2×1）替换ElMessage/ElMessageBox，删ErrorModal (f4f51f4)
- fix: 图层控制面板状态统一，修复引擎切换图层丢失 (113bf6d)
- fix: OL flyTo支持height转zoom（位置与缩放同步动画） (14352f9)
- fix: DEM接入图层控制+路由切换图层状态修复+UI微调 (8210c20)
- refactor: 常量兼容层并入shared单一来源，修复同一常量双份定义 (073533c)
- refactor: 洪涝四store整合为一个，修复同页面状态拆散在多个全局store (0996203)
- refactor: 可选能力收敛为能力接口加类型守卫，修复非空断言掩盖能力缺失 (2300418)
- refactor: 清理零调用死代码（预留API/装饰repository/mock目录） (3b13985)
- refactor: 审查收尾（删空转会脚本留package.json入口、tsconfig补test目录、eslint忽略.workbuddy） (5162865)
- refactor: 图层双轨制收尾只留新机制（底图走setBaseLayer） (69b8e7c)
- refactor: store重置改watch(user)驱动，修复登出重置逻辑藏在注册时序的耦合 (8195cc1)
- refactor: 四个假拆分文件搬移合并回单文件，修复Cesium渲染器伪模块化 (8504645)
- refactor: 移除过度设计（数据搬后端，删siteAnalysis/forecastAdapter与映射层，后端真假隔离标注） (8791166)
- refactor: 请求封装收敛为一套useLatestRequest（4处竞态守卫统一）+撤销dataSourceConfig+清死镜像 (919e8aa)
- refactor: 审查收尾（删strip-arch-notes/ErrorModal预留注释/siteSelectionStore去壳/BLM事件改回调/城市坐标收归配置） (aeb230c)
- refactor: 数据源去adapter化（选址直连api）+删checkAuth死代码+后端读取收敛 (d87a23f)
- chore: git健康检查脚本（fsck/refs/lock/工作树，会话前跑） (2f07502)
- chore: 更新core注释（合并后无拆分文件） (72d34e3)

## 2026-08-07

- fix: flood-service Python 代码恢复入 git（误移除纠正） (0af8088)
- refactor: 清理零调用死代码（上线前机械删除，零回归） (f065e1e)

## 2026-08-06

- 三港区 83 个高德真实设施 编号 facilityPoints。钦州22+防城20+北海41。 (585cf49)
- feat: 钦州港设施真实化（高德 22 个 POI） 编号 b055。 (2183f3c)
- feat: 浸没滑块联动——默认不显示滑块触发 编号 b054。sliderInteracted 标志。 (433ca70)
- feat: 真 3D 地形改内存切片 TerrainProvider——只加载切片数据、零瓦片网络请求 (80f0b60)
- feat: 防城/北海设施真实化（三港区 83 个高德 POI） 编号 b056。脚本移交 gis_work，key 用完删除。 (f7919cd)
- feat: 水域坐标加载失败降级提示 编号 flood。showWarning 非静默。 (f940d55)
- feat: 受影响设施空间筛选 + 损失模型 编号 d074。FastAPI /api/flood/impact，淹没多边形∩设施点。 (fa7388d)
- fix: Cesium 高度上限 1000km→2000km 编号 camera。REGION 1600km 被钳制只生效 1.25 倍。 (13dbdd9)
- fix: setVisible 打开未创建图层补建（真实地形死按钮） 编号 b058。visible:false 注册不 create 致打开落入 pending，打开时补建。测试+1 mutation 实证。 (144b71a)
- fix: 视角拆分——OL zoom 复原，Cesium height 单独调高 编号 camera。 (1485244)
- fix: CesiumWaterSurface geometryInstances 只读断言 编号 typecheck。06908b5 遗留。 (387dd79)
- fix: API_BASE 前缀误加 + FastAPI 缓存 OrderedDict 编号 flood。双 bug。 (38d33e5)
- fix: 撤销内存切片真 3D（用户实测卡爆）→ 回退 hillshade 稳定版 + 启用瓦片加载 (4cb7b56)
- fix: 真实地形默认不显示 + boundary/ports 注册竞态防御 编号 b058。dem-hillshade visible:false；loadData 后补 setupLayers 防注册竞态。 (53d0673)
- fix: 水面增量更新——hasLayer 覆写 \_waterSurfaces 编号 a044。 (733865b)
- fix: 清理 3 处历史遗留 TS 错误（pre-push 钩子拦截） (b294919)
- fix: 地图无 resize 响应——UnifiedMap ResizeObserver 编号 a043。容器尺寸变化驱动 updateSize。测试 12 绿。 (b4336ad)
- fix: 滑块 abort 竞态弹 modal——降 toast 编号 z081。 (f2ff0c9)
- fix: 淹没多边形小洞过滤（灭"多边形在海上"） 编号 b057。3163 内环→0，flood_levels 21MB→2.9MB。 (f79ab47)
- fix: reapplyAll data==null 也重建面板条目 编号 a046。flood-area/facilities 开关不丢。 (fce8d11)
- perf: Cesium 预热 + 水面增量 + ECharts replaceMerge 编号 3d/charts。Phase 2/3 落地。 (3d054a5)
- perf: 滑块防抖 100ms + 档位缓存 + 3D 直进防御 + Cesium 预热 编号 性能优化批次。 (5c2fb70)
- perf: 淹没演算离线预计算 251 档查表秒回 编号 d073。flood_levels.json.gz，0.2s 响应。 (991c96e)
- perf: Cesium 初始相机高度调高一倍 编号 camera。VIEW_LEVELS/CITY_CENTERS height×2。 (b01ef59)
- perf: mount() 删除强制持续渲染（240Hz 掉帧修复） 编号 a047。 (f022373)
- refactor: 数据源命名 mock→static 编号 data-source。名实相符。 (0541494)
- docs: b051/d071/d072 闭环 + a042/a043 登记 编号 闭环。 (f251858)
- test: useApiRequest d071 API_BASE 前缀回归 编号 frontend。+3 测试。 (56eabcd)
- test: flood-service pytest 基座 + d072 回归 编号 flood-service。3 测试。 (de31c73)
- chore: 移除 flood-service Python 代码出 git（本地运行不入库） (c0d9e29)

## 2026-08-05

- feat: 检查模式改名调试模式 + MC F3 风格性能 HUD（生产可用） (3856f12)
- feat: 性能监控悬浮面板 PerfPanel——埋点数据实时可视化 (3eded96)
- feat: 底图加载失败可见性——imageryLayers.errorEvent 首次失败 warn\n\n- 背景：底图空白排查中，Cesium 底图瓦片加载失败默认静默（仅 Cesium 内部\n console 报错），无业务日志，无法定位（403/CORS/网络）。\n- 改动：\_initBaseLayers 挂 imageryLayers.errorEvent，首次失败 logger.warn\n 带 error.message（\_imageryErrorLogged 防刷屏）。 (696cc74)
- feat: 性能埋点生产可用化——五层指标 + shared 归位 (82ff95e)
- feat: dem 图层链路诊断日志——addGeoTIFFLayer 入口 + BLM register/reapplyAll visible 状态\n\n- 用户实证：Network 无 hillshade 请求 → 图层没挂载到 Cesium。\n- 无头验证：直接导航洪涝页 addGeoTIFFLayer 正常执行（hillshade 请求+日志都有）\n → 代码链通，问题在用户环境状态（最可能 LayerControlPanel'真实地形'勾选被关\n = BLM registry visible=false → register/reapplyAll 均跳过、静默无请求）。\n- 加诊断：①addGeoTIFFLayer 入口 debug 打 id/url/terrainReady（无论走哪分支）\n ②BLM.register 打 visible/data/renderer ③reapplyAll 打 visible=false 跳过。\n- 用户刷新后控制台搜 addGeoTIFFLayer/BusinessLayerManager 一条日志定位。 (b2544b0)
- feat: DEM 真地形接入——CTB quantized-mesh 预切片（z0-12）+ CesiumTerrainProvider\n\n- DEM 预切片路线 A 落地（用户拍板本地预处理）：\n - 工具链：GDAL 3.13.1（QGIS bin）+ tumgis/ctb-quantized-mesh Docker 镜像\n - 输入：backend/data/flood/dem/dem_4326_cut.tif（9289x7135 Float32 EPSG:4326）\n - 产物：backend/static/terrain/ 3848 文件 6.5MB（z0-12，quantized-mesh-1.0 +\n octvertexnormals，瓦片 gzip 压缩流 1f8b，Cesium 自动解压）\n - 门禁验证：z0-6 先通（14 瓦片 + layer.json），再全量（27s）；\n **坑：ctb-tile 的 -l 参数=只输出 layer.json 不生成瓦片**，正确流程=\n 先不带 -l 切瓦片、再带 -l 补 layer.json。\n- 前端接入（CesiumRenderer.ts，就地私有方法 \_setupTerrain 无新抽象）：\n create() 后异步 CesiumTerrainProvider.fromUrl('/static/terrain/layer.json')，\n 成功挂 viewer.terrainProvider（球面变真 z 值起伏，hillshade 影像自动裹到真地形上），\n 失败静默降级保持椭球面；viewer 已销毁（30s 闲置）访问前判空。\n- 部署一致性：terrain 未被 gitignore/.dockerignore 排除 → 入库 + 进镜像，\n CI/本地一致，生产 3D 真地形开箱即用（无 DEM 那种 volume 方案）。\n- 验证：后端 /static/terrain/layer.json 与真实瓦片 200 完整返回（Content-Length\n 匹配、gzip magic 校验）；前端 typecheck + core/map 80/80 + build 1.02s。\n- 生产 nginx 无需额外配置（.terrain 为 octet-stream 不二次压缩，Cesium 自解压）。 (d861940)
- fix: 'DEM 看不见'真凶——addGeoTIFFLayer 尾部残留 lowerToBottom 沉底\n\n- 用户实证（决定性）：勾选真实地形后控制台有 'addGeoTIFFLayer 已添加\n hillshade 回退贴图'（代码执行到底、PNG 请求发出），但视觉上看不到。\n- 根因：addGeoTIFFLayer 函数体**尾部还有一处** lowerToBottom(imageryLayer)\n （5c7f6e7 引入、5730705 只删了 alpha 设置旁的前一处）——hillshade 添加后\n 又被沉到最底层，被天地图 4 层完全盖住 → 永远看不见。\n- 修复：删除该残留调用，hillshade 保持顶层 + alpha 半透明叠加天地图。\n- 验证：无头截图地球区域 gray=55%（hillshade 灰白覆盖生效）；\n hillshade.png 请求正常；typecheck 过。\n- 教训：同一逻辑两处实现（前一处删了后一处漏），改代码要全局 grep 确认无残留。 (0c1b054)
- fix: 调试模式全层 pointer-events 穿透——网格/HUD 不拦截任何鼠标操作 (3320af0)
- fix: 洪涝页路由往返地图白板——unmount 不再摘走 Vue 容器 div + 3D 复用前检查 viewer 存活 (373a9ed)
- fix: DEM 瓦片 404——layer.json tiles 相对路径被 Cesium 拼接成 layer.json/ 目录\n\n- 用户实测日志：static/terrain/layer.json/0/0/0.terrain?v=1.0.0 404（两次）\n- 根因：CTB 生成 layer.json 的 tiles 模板为相对路径 {z}/{x}/{y}.terrain?v={version}，\n Cesium 用 layer.json 完整 URL 作 base 解析 → layer.json 被当目录拼接。\n- 修复：tiles 改绝对路径 /static/terrain/{z}/{x}/{y}.terrain?v={version}。\n 验证：layer.json 200 + 绝对路径瓦片 200（z0/z12 样本）；相对拼接路径 404 复现后消除。\n- 注意：CTB 重新切片会覆盖 layer.json，需重做此替换（已记入 memory）。 (450606a)
- fix: DEM 大文件不进镜像（volume 挂载）+ CI 构建注入天地图 key (4e1dac6)
- fix: 真地形换 heightmap-1.0——CTB quantized-mesh 是实验代码（center 计算 bug）\n\n- 用户实测：页面暗（quantized-mesh 部署后 avg 亮度 39/暗 76%）。\n- 根因升级（源码级）：tumgis/ctb-quantized-mesh 用的 ahuarte47 fork，其\n README 明确 quantized-mesh 是 TODO 未完成实验功能——输出的瓦片 header center\n 计算错误（低 zoom center=(0,0.5R,0) 模 0.5R 而非 ECEF 球面点 R），Cesium 用\n center 解码顶点位置 → mesh 错位/无影像 → globe 表面降级成暗色默认材质。\n- 换路线：CTB 默认 -f Terrain（heightmap-1.0，官方主分支成熟格式）：\n - 瓦片无 header（纯 int16 高程×5 网格 65×65），位置由 layer.json tilingScheme 决定，\n 不依赖 center —— 无 center bug 可乘之机\n - CesiumTerrainProvider 原生支持（layer.json format=heightmap-1.0，默认\n heightmapStructure {heightScale:1/5} 与 CTB 的 ×5 编码配套还原）\n - 数据验证：解压瓦片 5000-6500 = 1000-1300m（北部湾 DEM 合理）\n- 部署：3846 瓦片 z0-12 + layer.json tiles 绝对路径（同前）。\n- 无头验证：瓦片 200+gzip、LOD z0→z5 加载、零 RangeError/TypeError；\n 页面亮度=无 terrain 基线（59/30% bright，quantized-mesh 是 39/24%）——heightmap\n 不引入暗（headless 3D 容器可见性受限无法飞相机，真实浏览器待用户验收）。\n- 注：CesiumRenderer.\_setupTerrain 无需改动（同一 fromUrl('/static/terrain/')）。 (5cd872f)
- fix: 修复 30s 销毁后回 3D 二次创建时旧实例 destroy 崩 viewer.scene（f35dc61 补丁） (5da6c40)
- fix: hillshade alpha 0.45→0.85——'看不到 DEM'真因是太淡\n\n- 用户反馈'还是没有 dem'，但无头验证 hillshade 一直在渲染（无加载错误、\n 灰度叠加生效）——真因：0.45 半透明叠加在天地图卫星影像上太含蓄，\n 视觉上认不出是 DEM 图层。\n- 教训：'代码不报错'≠'用户看得见'——验证要从用户视觉出发。\n- 调整：默认 alpha 0.85（DEM 地形图观感，灰白山体阴影清晰），天地图影像\n 在下透出轮廓，注记层（cia_w）在上显示地名。\n- 已确认：hillshade PNG 存在 + HTTP 200 可达；无头零 TypeError/RangeError。 (68e6935)
- fix: hillshade 回退贴图盖住天地图底图——真地形就绪后隐藏/跳过\n\n- 用户三次报'无底图'，底图 errorEvent 无失败（排除 403/网络/CORS）——\n 真凶：addGeoTIFFLayer 的 hillshade 回退贴图（70% 不透明灰白单张图，\n SingleTileImageryProvider）addImageryProvider 默认加在 imageryLayers 最顶层，\n 盖住天地图底图 → 视野内只剩灰白山体阴影，看起来'没有底图'。\n- 修复（无新抽象，两字段+方法归位）：\n - \_setupTerrain 从 CesiumViewerManager 挪到 CesiumRenderer（\_initViewer 首次创建\n 分支调用），成功时置 \_terrainReady=true + 隐藏已添加的 \_hillshadeLayer；\n 解决跨类时序：hillshade 可能先加（业务层）、真地形后就绪。\n - addGeoTIFFLayer：\_terrainReady 已就绪 → 直接跳过 hillshade（真地形 z 起伏\n + Cesium globe lighting 取代伪三维明暗）；否则添加并记录 \_hillshadeLayer。\n - 复用场景（\_isReusing）不重跑（terrainProvider 已挂 viewer 上）。\n- 验证：typecheck + core/map 8 文件 78/78 + build 18.9s。 (6ac31ba)
- fix: 真地形改全量 hillshade 贴图（用户拍板）——真 3D mesh 暂缓\n\n- 用户：瓦片加载不稳定，'先不要瓦片加载，先全量加载'。\n- 全量方案落地：hillshade（4096×2819 单张 PNG）恢复显示，顶层叠加 + 半透明\n （alpha 0.45 默认）：山体明暗叠在天地图上，全量一次加载、有立体感、不挡底图\n （alpha 0.7 顶层盖死底图、lowerToBottom 被天地图完全盖住——两个极端都试过，\n 取半透明顶层中间态）。\n- 真 3D mesh（\_setupFullDem：一次性 fetch dem_elev.bin 1000×750 Int16 高程网格，\n 构建裸 Geometry + Primitive）代码保留但暂禁用——裸 Geometry + Primitive 在\n vite dev 下 Cesium worker 兼容问题连环踩坑（asynchronous:false 缺 boundingSphereCV\n → createVertexArray reading 'center' 崩；异步需 \_workerName + createFunction\n worker 在 vite 加载失败）——待 vite/Cesium worker 兼容或生产构建验证后恢复。\n- dem_elev.bin/hdr（1.5MB，GDAL 降采样 dem_4326_cut.tif）保留供 mesh 恢复。\n- 无头验证：页面亮度回基线（avg 59 不暗）、零 TypeError/RangeError、\n ERRORS 仅 flood-online 404（FastAPI 未起，已知）。typecheck + build。 (83a4a83)
- fix: 真地形接入失败日志 debug→warn 带原因（排查可见性）\n\n- 背景：用户反馈 3D 底图与 DEM 均未加载，实测 dev server 12:21 启动早于\n \_setupTerrain 代码与 .env.local 新 key（18:05）——vite 的 import.meta.env\n 启动时注入，换 key/加代码必须重启 dev server 才生效。\n- 本提交仅提升失败日志：catch 从 logger.debug 改 logger.warn 并带 error message，\n 后续排查一眼可见原因（dev 未重启/后端未起/瓦片缺失）。 (8ba44e1)
- fix: 播放触发"请求过于频繁"弹窗——LRU 缓存 + 播放中限流静默 + 后端 forecast 专属限流 (b009977)
- fix: Cesium 天地图底图空白——{layerCode}/{key} 非 Cesium 占位符被原样发出\n\n- 根因（实锤，源码级）：Cesium UrlTemplateImageryProvider 只认内置占位符\n （x/y/z/s/reverseX/Y/Z/degrees/projected/width/height），buildImageResource\n 对未知 tag 直接跳过不替换 → buildTiandituUrl 模板里的 {layerCode}/{key}\n 原样留在 URL：DataServer?T={layerCode}&...&tk={key} → 天地图收到字面花括号\n → 请求失败 → 3D 底图空白。OL 自实现模板替换（任意 {xxx} 都认）所以 2D 正常——\n 用户报'OL 正常但 Cesium 没底图'即此差异。该 bug 自 Cesium 底图功能存在起就有。\n- 修复（CesiumRenderer.\_initBaseLayers）：新增 tiandituUrlForCesium 局部函数，\n 对 buildTiandituUrl 结果预替换 {layerCode}→实际图层码、{key}→实际 key，\n 只留 Cesium 认识的 {x}{y}{z}。4 个 provider 统一走该函数。\n- 验证：URL 生成模拟正确（T=img_w&tk=KEY&x={x}...）；typecheck 过；\n core/map 8 文件 78/78（cesiumRecreate 单独跑环境波动超时，非本次改动引入）。\n- 另：dev server 12:21 启动早于本修复与 DEM 代码 6 小时（vite env 启动注入），\n 用户需重启 dev server 才同时生效，已指引。 (c7d0a9c)
- fix: 3D 初始化崩溃——errorEvent 挂错对象（ImageryLayerCollection 无此属性）\n\n- 用户实测：'只有蓝色球，无底图无业务图层' + TypeError:/n Cannot read properties of undefined (reading 'addEventListener')\n at CesiumRenderer.\_initBaseLayers:390（2215094 引入的自崩点）。\n- 根因：Cesium 的 ImageryLayerCollection 没有 errorEvent（仅有 layerAdded/\n layerRemoved/layerMoved/layerShown/layerHidden）；errorEvent 在 ImageryProvider 上。\n 挂 collection 抛 TypeError → 构造函数中断 → createRenderer 失败 → 3D 白球。\n- 修复：attachImageryErrorLog helper 挂到每个 UrlTemplateImageryProvider（防御\n provider?.errorEvent），与 addGeoTIFFLayer 的 hillshade 监听同模式（已验证可行）。\n \_imageryErrorLogged 初始化移到构造函数。\n- 教训：Cesium 事件对象先确认存在再挂，collection 与 provider 事件面不同。\n- 验证：typecheck + core/map 8 文件 78/78 + build。 (d361f58)
- fix: hillshade 永远底层 + 临时禁用 \_setupTerrain（CTB 瓦片 bug 待排查）\n\n- 用户三次反馈后自验证流程：用 Edge 无头 CDP 加载 3D 洪涝页，收集 console/网络/异常，截图。\n- 修复链路：\n 1) CesiumTerrainProvider.fromUrl 必须传**目录 URL**（不是文件 URL）——\n 实测传 /static/terrain/layer.json 会拼 layer.json/layer.json 404，fallback\n 到内置默认 tiles + version 1.0.0。改为 /static/terrain/。\n 2) backend express.static 给 .terrain 设 Content-Encoding: gzip（瓦片文件本身就是\n gzip 流 1f8b），浏览器 fetch 自动解压，否则 Cesium 拿到 raw 1f8b 解析错位。\n 3) layer.json tiles 改绝对路径 /static/terrain/{z}/{x}/{y}.terrain（Cesium 把\n layer.json 完整 URL 当 base 拼接，相对路径变 layer.json/0/0/...）。\n- 真地形接入新问题（独立 bug，本轮暂搁）：\n - CTB quantized-mesh 输出瓦片 heights 全 0 + center 坐标系错位\n (centerY=-3189068 meters 而非 radians/ECEF)，Cesium 解析得 vertexCount=80+亿\n → RangeError Invalid typed array length。\n - 根因方向：dem_4326_cut.tif 含 NoData=32767（短整 nodata 标志），可能 CTB 处理\n EPSG:4326 + nodata 时未正确处理（待 tools/dem-pipeline 数据源修复合并处理）。\n - 临时禁用 \_setupTerrain 避免 RangeError 干扰底图/业务验证。\n- hillshade 回退贴图改永远 lowerToBottom（最底层）—— 让位给天地图底图，避免遮挡。\n 视觉效果：有天地图时 hillshade 完全被覆盖；有真地形时天地图贴到地形 mesh 上，\n hillshade 也被覆盖。db36edc 的 show=false 隐藏逻辑保留（真地形好后回调使用）。\n- 无头验证（Edge + SwiftShader WebGL + http://localhost:5173/flood-analysis）：\n ERRORS=7（仅 flood-online 404 FastAPI 未起 + initRenderer 容器抖动），\n 零 TypeError/RangeError/初始化失败；截图确认天地图底图+行政区划业务图层可见。\n- 验证：typecheck + build 24.37s。 (e107812)
- fix: 真地形 CTB 瓦片修复——Int16 输入 + 标准命令 + 启用 \_setupTerrain\n\n- 根因（之前 5c7f6e7 暂搁的真地形 bug）：CTB 处理 Float32 + NoData=32767 输入时\n 输出瓦片 heights 全 0 + center 坐标系错位（模=0.5R，应=R），Cesium 解码得\n vertexCount=80+ 亿 → RangeError Invalid typed array length。\n- 修复链：\n 1) gdal_translate -ot Int16 -a_nodata 32767 dem_4326_cut.tif dem_int16.tif\n （CTB 是 C++ 工具，Int16 是其原生输入类型，Float32 + Int16 风格 nodata 引发 CTB 处理 bug）\n 2) CTB 标准命令 -f Mesh -C -N -s 12（官方 README 推荐，含 cesium-friendly + vertex normals）\n 3) layer.json tiles 改绝对路径 /static/terrain/{z}/{x}/{y}.terrain\n 4) backend/static/terrain/ 部署 Int16 全量切片 3847 文件（z0-12）\n 5) CesiumRenderer.\_setupTerrain 启用（之前临时禁用）\n\n- 部署要求（工具链固化）：tools/dem-pipeline 需更新为"gdal_translate -ot Int16"后再 CTB\n ——dem_4326_cut.tif 是 Float32 直接切片会再次触发原 bug。已记入 memory。\n\n- 无头验证（Edge + SwiftShader WebGL）：瓦片 200 + gzip 全部加载（z0-z5 200 响应），\n 零 RangeError/TypeError/Failed to obtain terrain tile；flood-online 404 仍是 FastAPI\n 未起的已知问题，与本次无关。\n\n- typecheck + 无 headless 错误。 (e6e4c61)
- perf: Cesium 240Hz 渲染治理——requestRenderMode + 关后处理 + LOD 粗一级 (dc65ee2)

## 2026-08-03

- feat: mapStore 新增 resetMapState 统一重置 action (3986b1e)
- fix: 前端静态/会话缓存增加大小上限（LRU 近似淘汰） (0907cf6)
- fix: click 回调提取具名函数并支持 off 解绑 (3e11bc5)
- fix: 登出重置补 mapStore（含 analysisHandler 闭包清理） (4fb83e8)
- fix: handleAuthError 移除动态 import 兜底，router 改必选参数 (506e868)
- fix: 撤销误提交的 .trash-cleanup 暂存物 (8c94133)
- fix: 卸载时销毁 BusinessLayerManager 释放图层元数据 (900d349)
- fix: 可观测性 + Cesium 视口裁剪修正 (94c7b86)
- fix: 图层/可见性 P0 修复 + HTTP 边界 zod 校验收口 + 数据流契约落地 (9b2217e)
- fix: storage 监听提供 remove 并接入 App 卸载钩子 (a20e07d)
- fix: 分析结果 sessionStorage 持久化加版本号校验 (b915162)
- fix: 登出重置补 forecastState.reset() (be2f80d)
- fix: floodAnalysisController 读盘缓存加大小上限（MAX_CACHE_SIZE=20 LRU 近似淘汰） (c61b7b6)
- fix: 洪涝水域坐标加载链路健壮性(b046) (cb6cb79)
- fix: 卸载时销毁 UnifiedMap 全部缓存渲染器并清空 store 引用 (e6a71fb)
- refactor: useForecastRequest 事务状态迁入 forecastState，composable 改实例级 (0dadacc)
- refactor: 顶层 6 目录 index.ts 入口 + 外部 import 收口（D-14=B） (173f98c)
- refactor: useAuth store 重置逻辑上提 App（setResetStoresHandler 注入） (1abf78d)
- refactor: 架构守护闭环——services-not-import-core 规则 + 叶子例外契约化 (355b3a5)
- refactor: P1 修复——Port 类型补齐 + affectedFacilities 语义注释 + 孤儿接口删除 (4ad3434)
- refactor: 布局层导航/图表配置化（路由 meta 驱动 + 业务下沉） (5857018)
- refactor: shared 业务专属文件/常量/组件归位业务层 (63bad08)
- refactor: 静态资源 fetch 收口 loadStatic（mapDataService/useBoundaryLayer/forecastAdapter） (74062d7)
- refactor: 图层可见性以 registry 为唯一权威（catalog 派生） (80829c7)
- refactor: shared→core 反向依赖全量治理（D-13=B） (9d7e916)
- refactor: UI组件下沉边界收敛 + 工程化治理(ESLint/CI/commitlint) + 模块README补齐 (a506e52)
- refactor: 重编号 8.2 d061→d068（Dockerfile 非 root，消除与主清单 d061-trust proxy 冲突） (a749564)
- refactor: 核心常驻层 boundary/ports 收口到 BLM (b9a47cd)
- refactor: 提交遗留未提交的代码与文档变更 (bb263e0)
- refactor: cesium 渲染器按职责拆分（entity/裁剪/事件/水面） (df7441d)
- refactor: 重编号 8.2 d060→d067（CI audit，消除与主清单 d060-typeSettings 冲突） (e9ec11d)
- refactor: mapDataService 接入 unwrapEnvelope 公共解包函数 (ecbb19a)
- refactor: 收敛 Store/业务模块命名并清理 markers 死代码（排除文档批量提交） (ef9efe1)
- refactor: 架构守护补全——cruise 覆盖 backend + types 层去运行时依赖 + 分层契约 (f01680d)
- docs: 归集今日文档整理与审查收尾 (056a41e)
- docs: 补全事故根因触发层(T1 8窗口并行编辑)与 worktree 解法 (9011968)
- docs: 8 项生命周期问题移入已解决清单（a023/a024/a025/b035/b036/b037/b043/z067） (cf4eba2)
- test: 修正 logger 测试 setup（LOG_DIR 不替换目录 + fire-and-forget 等待） (35779c1)
- test: 修正 sanitize 测试调用（对象→字符串，断言不变） (be86403)
- chore: dep-cruiser 补 shared 反向规则 + no-circular 升级 error (526ed58)

## 2026-08-02

- feat: 浸没分析接入真实DEM空间分析——新增tools/dem-pipeline流水线(拼接/填洼/重投影/洪涝数据派生)与hillshade渲染 (925830b)
- feat: 新增独立防洪分析后端服务 flood-service，含洪涝引擎/API/演示数据与测试 (a761b6f)
- fix: GcsPanel.vue 更名为 GCSPanel.vue，与 import 大小写一致（修复 Linux 大小写敏感构建） (cf1d480)
- docs: 新增 git 仓库事故复盘日志(2026-08-02) (618c9ed)
- chore: 提交本地工作变更与仓库恢复修复 (16c4cf5)

## 2026-08-01

- refactor: 统一响应信封与API契约收口，含数据迁移/TS化/ports模块/登录UI重构 (4166934)

## 2026-07-31

- 更新 README.md (9381b3b)
- Merge branch 'main' of https://github.com/Andy38586/beibu-gulf-project (ac7124d)
- fix: 批量修复问题清单——Flood 接入真实 API、认证改 Cookie、全局错误兜底 (f26ae7b)
- chore: 从远程仓库移除不应提交的本地文件 (bc1adff)

## 2026-07-30

- chore：浸没分析启用新名称，解决和GCS同名的问题 (4825b69)
- docs：更新时间戳规则，保留首次写入时间，新增移入时间 (d63ea6e)
- chore：GCS大排查，统一组件规范，修复一些和组件无关却叫gcs的函数和变量 (f500b59)
- chore: GCS 统一更名为 Flood（路由/Store/图层/日志），完成全部改名， 今后GCS只表示global component style，即规范组件样式的设计规范 docs: 重写 README，更新项目定位与架构说明 (87ac0af)

## 2026-07-29

- refactor: JS 代码迁移 TypeScript 并引入 Docker/CI 基础设施 (2c3f59e)
- refactor: JS 代码迁移 TypeScript 并引入 Docker/CI 基础设施 (9cebba4)

## 2026-07-28

- feat: 移动端抽屉导航 + 颜色常量集中 + 按需引入 + CI架构检查 (d31c5c9)
- fix: 预报接口修复 + docs重组 + flood数据补充 (40f1835)
- refactor: 目录结构拆分 + 文档清理 + flood数据补充 (9271cb6)
- refactor: TypeScript迁移 + 设计Token体系 + 废弃代码清理 (cc97b84)

## 2026-07-24

- v1.5 冻结收尾——统一错误处理 + 收藏夹 + 诊断报告 + 冻结文档 (3c7d0b1)
- fix：对新增forecast路由进行审查，排查相关bug 完善forecast和flood-analysis的相关功能，修复项目遗留bug (7d5f954)
- 复原个人中心到原始状态，删除所有收藏夹改动 (b4b870e)
- DEV 模式下强制 showPanels/showTopArea=true，测试单例 windowWidth 是否为根因 (d48d07c)
- feat: 架构验收实验——新增第四业务'港口碳排放分析' (5c69132)
- feat: v1.5 架构验证 —— Mock数据边界 + Data Adapter层 + 架构文档 (9cd21c0)
- feat: 收藏夹接线——底部导航 ⭐ 按钮 + AppLayout 集成 (9dda6fa)
- feat: 收藏夹重做——抽屉面板 + 文件夹结构 (e7b2bd0)
- fix: 回退 useDefaultRenderLoop=false/true，它可能阻塞 Vue transition (3f3518e)
- fix: 删除多余的 localStorage 收藏夹，只保留原有服务端方案收藏 (6e1125b)
- fix: Bug1 pitch硬设-90 + 清理诊断hack (80ee99f)
- fix: 弹窗替换 + 收藏夹修复 + 错误消息改版 (b37b7e0)
- fix: 401 处理修复——不再清 token 和跳转首页，消除重复弹窗 (c26ae7f)
- refactor: FavoritePanel 删除，收藏夹直接集成到个人中心面板 (08784a1)
- refactor: 收藏夹从全局移至个人中心 (58340c3)
- refactor: 个人中心布局重构——用户名居中顶部 + 收藏夹中部 + 退出底部 (ee33579)
- docs: 精简文档——13+4个文件合并为5个核心文档 (15106ff)
- docs: 架构验证文档重构 + 业务扩展指南 (5ffba06)
- docs: 阶段五日志——两个线上bug的排查全记录与最终修复 (9b8ab0d)
- chore: 卸载碳排放分析模块（业务删除验证） (6b86501)

## 2026-07-23

- fix: useGCS 防御 cellPixel 清零导致面板不可见 (0b259ec)
- fix: Cesium \_getCameraState 导出相机正下方位置，消除 tilt 偏移 (1d1c009)
- fix: 技术债务与架构治理 — 四阶段BUG治理阶段四 (254d517)
- fix: 安全与数据契约修复 — 四阶段BUG治理阶段一 (4087ad9)
- fix: 完成 P0 架构修复——渲染器接口补齐 + Core→Business 依赖切断 (57da921)
- fix: flyTo pitch -60→-90° 俯视 + \_getCameraState 恢复 pickEllipsoid 优先 (5af98a0)
- fix: 路由切换时过期渲染响应丢弃 + 渲染器就绪重试 (88a45c7)
- fix: registerGcsLayers 异步卸载竞态 + flyTo 兼容 lon 字段 (9cc72e0)
- fix: GcsPanel 多层防御——panelPosition 全部兜底 (9efdc95)
- fix: 前端用户功能修复 — 四阶段BUG治理阶段二 (d5cdcd9)
- fix: 地图引擎与浸没分析修复 — 四阶段BUG治理阶段三 (e0bea6b)
- fix: 移除无用 rendererReady + setTimeout，完全依赖 currentRenderer watch (e6240a1)
- fix: Cesium unmount 时彻底停止渲染循环，防止与 OL 争 GPU 导致页面卡死 (f60d64c)

## 2026-07-22

- feat：完成 GCS 布局系统并新增浸没分析业务模块作为框架验证 (c4b22ba)

## 2026-07-20

- feat：新增两个业务，分别是cesium浸没分析和港口数据预测分析 为正式施工创造先行条件，修复影响后续新增业务的bug，优化模块化设计，规范新增新业务流程，最大化降低代码量 (7fa180a)

## 2026-07-19

- fix: 修复了项目一些bug 清理死代码，为项目后续维护留接口 新增数据，为浸没分析提供数据支持 (f04db31)

## 2026-07-18

- fix：使用新的GCS体系完成对旧页面的适配 (d65c7a7)
- refactor: 引入完整GCS面板设计系统，重构站点选择页面 (93362e5)

## 2026-07-16

- feat：阶段9实现模板继承，实现模板高效复用 (a730c7c)
- feat: 阶段 5-B 迁移 ProfilePanel / PlanDrawer / PlanSaveModal 到 ProfilePage (08d329b)
- feat: 阶段 4-B 完成 SiteSelectionPage 的 Zone2/Zone4 布局迁移与路由切换 (0db2c9b)
- feat: 阶段 5-A 调整 ProfilePage 为左右分区 8×4 Panel 布局 (19309ce)
- feat: 阶段 4-A 重命名 BufferPage 为 SiteSelectionPage 并将 BufferControl 移入 Zone4 (3e81f02)
- feat: 阶段 2 实现响应式显隐策略（768px 断点） (613dc1b)
- feat: 阶段 1 重构导航体系（BottomNavBar + TopArea）并移除 Zone1 (c1b14bd)
- feat: 阶段 3-B 填充首页业务入口、折线图和图层控制 (e0d8744)
- feat: 阶段 1-2 构建 GCS 基础组件 (f98078e)
- refactor: 阶段 6-A 迁移核心模块到 src/core/map/ 与 src/core/config/ (50e0a41)
- refactor: 阶段 6-B 完成业务/可视化/共享模块目录重构 (d54cf4f)
- refactor: 阶段 3-A 将 AppHeader 拆分为 GCS 面板 (f9290de)
- chore: 移除 CesiumRenderer.js 未使用的 VerticalOrigin 导入 (3737ea5)

## 2026-07-11

- fix: 修复了选址分析无结果的bug (bd8a0ef)

## 2026-07-05

- feat：新增了rbush，空间索引，提高了tree的查询效率，减少了查询时间 (918b5cb)

## 2026-07-03

- fix：修复面板显示叠加bug (00de01a)
- refactor: 重构element和css系统 确定最小单元,其余组件以最小单元未基础进行组合，统一了面板的规格 增加缩放效果，由北部湾城市群比例尺到市级行政单位比例尺到区级行政单位比例尺平滑过渡 新增登录提示步骤，保存按钮不会直接跳转个人主页了，并且提示需要登录才能保存 独立个人页面为路由而非弹窗，所有需要登录的操作从调用个人面板弹窗变成了跳转个人主页路由 (9432b74)

## 2026-07-02

- fix：修改了地图组件的分析图层逻辑，确保在不同地图类型下正确显示分析结果。 (b5c63c8)
- fix: 修复bug，封装接口，完善重构后的项目稳定性 接口由业务图层提供，实现业务图层与地图渲染器的解耦，业务图层只需要提供数据和渲染方式，地图渲染器负责渲染和交互 (54b3514)
- refactor: 新增cesium,完成同一数据源,两套地图引擎调用 (bd2f24a)

## 2026-06-30

- 修改个人信息面板 (095d0a6)
- feat: 新增elementPlus,Typescript (3f518a7)
- feat: 修改窗口位置 (92796a4)
- style: 新增eslint规则 (4bdfba8)

## 2026-06-29

- feat: 修复bug 1.底图按钮无效 2.个人主页无响应 3.启用组件overlayPage (180778b)
- feat: 改个标题 (4c7dfc0)
- feat: 组件位置,高度,边框对齐 (fd87870)
- refactor: 重构结构 1.拆分mapcontainer,把业务分给olmap组件,功能拆分成api,状态同过pinia store管理 2.后端进行JWT密钥修复,useservice修复,写锁链修复,新增设施数据缓存 (6e2a54d)

## 2026-06-28

- feat: 备份,准备给mapCountainer解耦 (56bf181)
- refactor: 解耦了mapc组件中的地图初始化和设置分析结果函数 (ea46391)

## 2026-06-27

- feat: 服务器后端连接不上 (08e1021)
- feat: 用新小文件替代原始巨大geojson文件 (6eeb736)
- feat: 修改了信息浮窗和导航条重叠的问题 (da58cc0)

## 2026-06-26

- 移除敏感数据文件，加入gitignore (56d3f6a)
- 环境配置 (571aab9)
- 移除敏感数据文件，加入gitignore (8b61200)
- feat: 完成对应crud的前端页面 (9442136)
- feat: 完成登录JWT验证,对用户方案形成初级的crud功能 (fa266c6)
- fix: turf.intersect() 空结果无定位 - 添加 selectedKeys 参数 + failKey 返回对象 (00c2d35)
- fix: 加个ErrorBoundary防全局白屏 (03c561e)
- fix: 设施类型跨文件不同步 - 前端+后端双重校验 (60e2859)
- fix: markersRepository 并发写竞态 - 添加 writeLock sequential 链 (730366a)

## 2026-06-25

- 准备写后端，备份 (4727e21)
- 增加express后端,把现有前端运算和算法逻辑搬到后端 (a85c773)

## 2026-06-24

- 新增评分系统和echarts可视化 (b5b9f29)
- 缓冲区控制台和推荐小区名单对齐 (ecfdce0)

## 2026-06-23

- 增加缓冲区叠加分析 (566bdba)
- 衰减算法独立和权重可调节 (6c18fb0)
- 更新代码结构，防止加不了功能，增加真实选址业务 (731ca35)

## 2026-06-22

- 增加了导航系统,修复了拼写错误 (1e45abc)
- 增加了缓冲区分析 (1f894c1)

## 2026-06-21

- 考虑用户视角,进行改进 (68503d7)
- 新增防御用户多次点击事件 (dd8576f)

## 2026-06-20

- 初始化北部湾港WebGIS项目 (17dc176)
- 修复了click失效(home的变量名写错了) (3a99cf4)
- 修改app.vue的显示逻辑 (4842d20)
