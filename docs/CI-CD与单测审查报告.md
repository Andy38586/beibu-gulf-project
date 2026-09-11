# CI/CD 与单测体系深度审查报告

> 审查方式：只读分析，未改动任何代码、未触碰 git。
> 证据来源：`.github/workflows/ci.yml`（全量）、`Dockerfile` / `backend/Dockerfile.nest` / `docker-compose*.yml`、`.husky/*`、根及前后端 `package.json`、`frontend/vitest.config.js` / `backend/vitest.config.ts`、前后端共 80 个测试文件全量精读（前端 57 个 + 后端 23 spec + 10 e2e-spec）。
>
> **v1.1 修订说明**：本报告经第二轮独立交叉核验（另一 agent 全量复核），5 处口径偏差已修正（见 1.5 节与文末修订记录），4 条新发现的 CI 问题已并入。修订时点 2026-09-12，工作区正被实施 agent 持续修改，测试文件数与个别行号随之浮动。

---

# 第一部分：CI/CD 诊断 —— 为什么 push 这么痛苦

## 1.1 流水线现状（ci.yml 实测结构）

```
push（任意分支）+ PR(main, master)
├── audit            独立 job，npm audit high+ 阻断
├── lint-and-build   ★ 巨石 job，12 步串行
│     guard:v3 → format:check → lint → stylelint → cruise → types:check
│     → typecheck(前端) → typecheck(后端) → gitleaks → .env 检查
│     → 前端测试+coverage → tools 测试 → fix/refactor 附测试检查 → vite build
├── nest-tests       后端 vitest + coverage（真库套件全跳过）
├── build-push-images (仅 main，needs lint-and-build)  → GHCR 两个镜像
└── deploy           (仅 main，needs 全部) → SSH 直部署，30 分钟轮询窗口
```

做得好的部分（先说公道话）：

- `concurrency cancel-in-progress` 已配置（ci.yml:12-14），重复 push 会取消旧跑。
- 镜像已在 CI 构建、服务器只 pull（2026-09-10 起），服务器 OOM 根因已除（ci.yml:203-205 记录了 run#134/135/136 的翻车史）。
- Docker 层缓存已接 `type=gha, mode=max`（ci.yml:247-248），`Dockerfile.nest` 依赖层缓存写法正确（先 COPY package\*.json 再 COPY src）。
- 部署健康检查有"200 但旧容器"防误判（run#151 教训已修复）。

## 1.2 「大版本后必失败好几次」的四个结构性根因

### 根因 ①：本地门禁与 CI 检查清单严重不对齐（最直接的原因）

对比 `.husky/pre-push` 与 ci.yml：

| 检查项                      | pre-push（本地） | CI  |
| --------------------------- | ---------------- | --- |
| typecheck 前端+后端         | ✅               | ✅  |
| guard:v3                    | ✅               | ✅  |
| backend 测试                | ✅               | ✅  |
| **format:check**            | ❌               | ✅  |
| **lint**                    | ❌               | ✅  |
| **stylelint**               | ❌               | ✅  |
| **cruise（依赖架构）**      | ❌               | ✅  |
| **types:check（API 契约）** | ❌               | ✅  |
| **前端全部测试**            | ❌               | ✅  |
| **tools 测试**              | ❌               | ✅  |
| **覆盖率阈值**              | ❌               | ✅  |
| **gitleaks**                | ❌               | ✅  |

pre-push 只拦 4 项，CI 要查 13+ 项。**每次 push 失败的第一现场注定在 CI 而不是本地**——这不是你运气差，是门禁设计让 CI 成为"第一道也是唯一一道完整的防线"。大版本新增大量代码+测试后，format/lint/stylelint/契约检查的新增违规全部首次暴露在 CI。

### 根因 ②：覆盖率阈值机制在大版本时"必然追尾"

`frontend/vitest.config.js:35-43` 的注释本身就是证据链：

```
45/35/28/45 超过实测导致 CI 全红 → 回调到实测水平留余量
当前实测 38.05/30.63/27.11/40.25 → 阈值设 38/29/26/36
```

全局百分比阈值 = 分母是全部源码。大版本迭代：新增大量源码（分母暴涨）+ 新增测试（但新代码覆盖率通常低于存量）→ **总体百分比必然下滑 → 跌破阈值 → CI 红**。而且阈值是"追着实测人工回调"的，每次大版本都要人肉重调一次——这就是你"每次大更新都要失败好几次"中固定贡献 1-2 次失败的机制。

后端阈值 50/45/50/50（`backend/vitest.config.ts:20`）同理。

### 根因 ③：巨石 job 串行 12 步，失败反馈慢且全有全无

lint-and-build 把 3 秒能出结果的 `format:check` 和 8 分钟的 `vite build` 串在同一个 job 里。format 在第 2 步，vite build 在第 12 步——**任何一步失败，你都要等前面所有步骤跑完才知道**，而且一次只能修一个问题、push 一次、等 20+ 分钟、再修下一个。"失败好几次才能成功"很大程度是**反馈回路太长**造成的，不是代码质量差。

### 根因 ④：全分支全量跑，无路径过滤

`on: push: branches: ['**']`（ci.yml:7-8）。改一个 `docs/*.md` 也要：双份 npm ci → 全部静态检查 → 前端全量测试 → vite 全量构建。大版本迭代期 push 频率高，每次都是全价。

## 1.3 「全量构建、无增量」的真相

- **vite build / nest build 本质没有增量模式**，"增量构建"对这个技术栈不是正确方向。Docker 层缓存（已配 gha cache）在"源码每次都变"时收益有限——vite build 是单个 RUN 层，源码一变即失效，缓存只能省 `npm ci` 层。
- CI 里 `npm run build`（ci.yml:161-165）在 lint-and-build 内每 push 必跑，且 build-push-images（仅 main）又构建一次镜像——**vite 构建每轮 main 实际执行两次**（一次在 lint-and-build，一次在 Docker build 内）。
- `tsc --noEmit` 有 `incremental` + tsbuildinfo 可用，但 GitHub runner 每次全新环境，不配 `actions/cache` 就等于每次冷启。
- 真正的杠杆不是增量，是**跳过**和**早失败**（见 1.4）。

## 1.4 「卡服务器」剩余问题

镜像改 CI 构建后服务器只剩 pull+up（内存峰值 1G 内），方向正确。剩余摩擦：

- deploy 轮询窗口 90×20s=30 分钟（ci.yml:366），其中大量时间是跨境 SSH/HTTP 抖动等待；
- `build-push-images` 只 needs `lint-and-build`，`deploy` needs 全部——关键路径 = 最慢的 lint-and-build → build-push → deploy 串行；
- 服务器 40G 磁盘 + 每次全量 pull 两个镜像，`image prune` 已有但 GHCR 上历史 tag 无清理策略。

## 1.5 二次交叉核验新确认的 4 条 CI 问题（v1.1 新增）

以下 4 条来自第二轮独立核验，已对照 ci.yml 逐条复核确认成立：

1. **push 与 pull_request 双触发且互不取消**：`on.push: ['**']` 与 `on.pull_request: [main, master]`（ci.yml:6-10）使同一提交跑两轮全量流水线；concurrency group 为 `workflow-ref`（push=refs/heads/x，PR=refs/pull/N/merge），两组不同互不取消。修法：group 改用 `github.sha`，或既然 push 已覆盖全分支，直接去掉 pull_request 触发——单此一项可省近一半 CI 时长。
2. **audit job 无缓存 + 双份 npm ci**：audit 是唯一没配 `setup-node cache: 'npm'` 的 job，且 root + backend 各跑一次完整 npm ci（ci.yml:22-46）。多 job 并行后这是纯粹重复成本。
3. **部署链路仍耦合服务器 git 工作树**：镜像虽已改 CI 构建，deploy 阶段一仍要求服务器 `git pull --ff-only` 成功（ci.yml:333-342），users.json 的"备份/还原" workaround 正是这个耦合的症状。长期方向：部署只依赖镜像 tag（服务器 compose 用 IMAGE_TAG 覆盖 + 预拉），彻底脱离服务器端 git 状态。
4. **"Make package public" 失败被 `|| echo warn` 吞掉**（ci.yml:267-274）：首次建包时若 PAT 权限不足导致 public 化失败，服务器匿名 pull nest 镜像必挂——CI 会红，但报错指向部署健康检查阶段而非根因，排障绕远路。建议失败时显式 `::error::` 并在 build-push 阶段中断。

## 1.6 改造建议（按性价比排序，供 agent 实施，本报告只提方案）

**P0-1 拆掉 lint-and-build 巨石 job（改动小、收益最大）**
拆成三个并行 job：

- `static-checks`：guard:v3 + format + lint + stylelint + cruise + types:check + typecheck×2 + gitleaks + .env 检查（全部纯静态，3-5 分钟内全红，还可用 matrix 进一步并行）；
- `frontend-tests`：测试 + coverage；
- `backend-tests`：现有 nest-tests。
  失败反馈从"串行等 20 分钟"变"3-5 分钟全量快检结果"。

**P0-2 pre-push 与 CI 对齐（消除"push 前已知会红还 push"）**
在 pre-push（或新增 `npm run ci:fast`）中补上 format:check / lint / stylelint / cruise / types:check。这些全是秒级静态检查，push 前 1-2 分钟可跑完。这样大版本迭代时，90% 的低级失败在本地就被拦截，push 到 CI 的一次通过率会显著上升。副作用是 push 稍慢——可用 `--no-verify` 逃生，或只在改动相关文件时触发。

**P1-3 覆盖率阈值改为"棘轮"而非固定百分比**
不再设全局阈值（大版本必追尾），改为：CI 产出覆盖率报告 → 与 main 基线比较 → 只在"下降超过容差（如 0.5pt）"时红。前端覆盖率本来就被定位为"回归基线而非上线门禁"（vitest.config.js:35 注释原话），棘轮模式与这个定位一致，且从机制上消灭"大版本第一次 CI 必红"。

**P1-4 路径过滤**

- `docs/**`、`*.md`、`性能测评-*` 变更 → 只跑 static-checks，跳过测试与 build；
- 仅 `backend/**` 变更 → 跳过前端测试（nest-tests 已独立 job，只需给 lint-and-build 里的前端部分加条件或用 dorny/paths-filter）；
- 仅 `frontend/**` 变更 → 跳过 nest-tests。

**P2-5 缩短部署确认链**

- 镜像构建后立即并行预拉（服务器后台 `docker pull` 与测试/部署确认并行），把 pull 时间从关键路径挪走；
- deploy 轮询 30 分钟可降到 15 分钟并保留现有双通道判定；
- GHCR 加 tag 保留策略（只留最近 N 个 run_number tag）。

**P2-6 main 上重复的 vite 构建砍掉一次**
lint-and-build 的 `npm run build` 步骤主要价值是"验证可构建"。可将其移到仅 main 分支（与镜像构建同一处验证），或改为仅在 frontend 源码变更时执行，feature 分支 push 省下 8 分钟。

---

# 第二部分：单测体系审查 —— 约束、过拟合还是无效？

## 2.1 总体判定

**你的单测是真的在"约束项目"，不是摆设。** 综合评级：

|                              | 前端（57 文件，v1.1 快照） | 后端（23 spec + 10 e2e-spec） |
| ---------------------------- | -------------------------- | ----------------------------- |
| 强约束（改歪必红）           | ~55-60%                    | ~40%                          |
| 中等（行为级但耦合内部形状） | ~25%                       | ~35%                          |
| 过拟合负担                   | ~15%                       | ~20%                          |
| 基本无效                     | <2%                        | ~5%（且全部藏在 CI 跳过区）   |

特征：大量测试由**真实事故编号驱动**（b058/P0-2/d116/z049/run#134-151/2026-09-10 pid 符号事故/2026-09-11 SRID 事故），文件头注释普遍写明"病灶→修复→本测试锁什么"。这是回归守卫型测试，不是覆盖率工程——质量文化高于平均水平。

## 2.2 强约束的证据（单测确实在防"长歪"）

- **防提权**：`auth.dto.spec.ts:102-112` 断言 DTO 白名单剔除后 `Object.keys` 只剩 `['password','username']`——多传 `role:'admin'` 必须被丢弃。
- **架构决策反回退锁**：`LoginPanel.test.ts:177-209` 断言前端**不再有**密码强度校验副本（权威在后端 DTO）——前端将来若"又抄一份正则"，此用例直接红。这是少见的"锁决策而非锁行为"的写法。
- **数据权威源锁**：`forecast.anchors.spec.ts:59-104` 断言所有热力锚点必须等于 `ports.json` 权威源，并显式禁止历史 mock 坐标 `[108.62,21.95]` 复活（"同一港口三套坐标"事故的防回归）。
- **错误码契约**：`business-error.spec.ts:7-17` 表驱动锁定 9 个错误码的 code/status/中文文案，与老 Express 逐项对齐。
- **假绿灯防线**：`spatial.repository.errors.spec.ts:64-95` 锁"连接级故障必须上抛，不得吞成 null/[]"——防"灾害评估以 200 返回零受损"。
- **请求语义**：`useApiRequest.test.ts:63-69` 锁"HTTP 200 但 code≥400 必须显式失败"；`useRouteApi.test.ts:103-122` 锁"取消≠业务失败，不伪造 unreachable"；`FloodAnalysisPage.unmount.test.ts` 锁卸载后迟到响应不重注册图层。
- **生命周期**：`CesiumViewerManager.idleDestroy.test.ts:131-152` fake timers 精确锁 29s/30s 销毁边界。

## 2.3 过拟合的证据（真实存在，是"大版本易碎"的测试侧原因）

**前端：**

1. **Cesium mock 五份复制 + 曾产出假绿**：5 个测试文件各内联 40-60 行 chainable Proxy mock；`CesiumRenderer.waterSurface.test.ts:42-44` 自证旧 mock 返回裸对象导致真实调用链从未执行（假绿），现已纠偏但 5 份复制无共享 factory 仍是长期负担。
2. **白盒断言私有状态**：`OLRenderer.culling.test.ts:176-212` 直用类型断言访问 `_cullLayers`、`_refreshCulledLayer`；`CesiumRenderer.waterSurface.test.ts:70-98` 直注 `_waterSurfaces` 私有 Map。重命名内部成员即碎，尽管行为没变。
3. **逐字节样式断言**：`useChartBase.test.ts:96-114` 锁 `backgroundColor:'transparent'` 等 10+ 样式字面量——锁样式而非行为。
4. **全量 toEqual 手抄返回树**：`forecastAdapter.test.ts:125-159` 与 fixture 1:1 耦合，后端加一个透传字段就红。
5. **setTimeout 竞态窗口**：`UnifiedMap.test.ts` 全文 **15 组 / 30 处**复制 `await new Promise(r => setTimeout(r, 50)) + flushPromises + 再 50ms` 三连（v1.1 实测修正：初版子代理报告写 8 处系低估）；`UnifiedMap.cesiumRecreate.test.ts:155-161` 的 `settle()` 自注"~160ms 后超时放行"——flaky 温床。
6. **常量断言**：`spatialIndex.test.ts:111-114` `expect(VIEWPORT_CULL_THRESHOLD).toBe(1000)`——锁死数值无行为含义。

**后端：**

1. **SQL 字符串 1:1 耦合（最重一块）**：`route.repository.spec.ts:53` 自造 `countDollarQuotes` 工具，断言 `$$` 包裹恰好 4 个、`ST_LineSubstring(r.geom, t.lo, t.hi)` 逐字符匹配、甚至 `not.toContain('AS dp(g, g_ord)')` 负向断言历史错误写法。**作者在文件头自认这是"明知真行为要连真库才验得了"的代理护栏**——是绑定 2026-09-10 线上事故的自觉过拟合，但任何等价 SQL 重写（改别名、改 CTE）都会红。
2. **缓存实现锁**：`forecast.service.spec.ts:136-150` 用 `mockReadFile` 调用次数锁 cacheKey 逻辑——改缓存策略即红。
3. **时钟源锁**：`flood.controller.spec.ts:504-518` `spyOn(Date,'now')` 手推 6 分钟 TTL——TTL 改 5 分钟即红。

**定性**：后端的过拟合多数是"自觉的"（注释写明动机、绑定真实事故），起的是临时护栏作用；前端的白盒断言和 mock 手抄则是纯粹的脆性资产。

## 2.4 系统性盲区：守门人在编，但 CI 从不让它上班（最高风险发现）

后端 **12 个测试文件**（6 个单测 spec + 6 个 e2e-spec：auth/flood/favorites/plans/route/site-analysis 的 supertest 全链路用例；v1.1 修正：初版按 spec 口径写"6 个套件"，漏计 e2e-spec，**盲区实为双倍**——连 HTTP 层全链路验证也整体休眠）用 `describe.skipIf(process.env.V3_INTEGRATION_DB === undefined)` 门控真库测试，而 **ci.yml 全文没有任何地方设置 `V3_INTEGRATION_DB`**（nest-tests job ci.yml:192-197 注释也明说"整体跳过"）。被跳过的是 repository 层几乎全部真实行为：

- PostGIS 空间算子正确性（spatial.repository.spec.ts 全部，文件头自称"唯一空间正确性守门人"）；
- turf→PostGIS 迁移验收（site-analysis.parity.spec.ts，`expect(diff).toBeLessThan(0.005)`）;
- pgRouting 寻路 SQL 语义、flood 向上取档、JSONB 存取、用户隔离。

**历史印证**：2026-09-10 的 pgRouting pid 符号 bug（静默返 0 行）和 2026-09-11 的 SRID 混用 bug（浸没设施恒 0）都落在这个盲区，CI 全绿，是靠本地起 PostGIS 联调才发现的。讽刺的是，修复它们的回归测试（spatial.repository.spec.ts:312-348 的 mixed SRID reject）本身也在跳过区。此外跳过区还藏着两处恒真断言 bug（`plans.repository.spec.ts:87` 拿时间戳与数组比较、`spatial.repository.spec.ts:342` 凑数断言），正因为从不运行所以从未暴露。

**修法（成本极低、收益极高）**：给 nest-tests job 挂一个 `services: postgis` service container（仓库已有 `docker-compose.v3.yml` 可照抄配置），设 `V3_INTEGRATION_DB=1`，跑前 seed schema。~20% 最强约束立即从"沉睡"变"站岗"，route.repository 的 SQL 字符串断言也可逐步退役成行为断言，顺带消解过拟合。

## 2.5 前端盲区（次要）

- Cesium 真实渲染路径 jsdom 层零验证，E2E 只在注释里"口头承诺"（`MapRenderer.interface.test.ts:217-220`）；
- SiteSelectionPage / RouteAnalysisPage / ProfilePage / LayerControlPanel 页面级零测试（ForecastPage 只有 `wrapper.exists()` 级冒烟）；
- `schemas.test.ts:33` 的 `skipIf(!plansExist)` 在 CI 上恒跳过 = 永远绿。

## 2.6 直接回答你的三个问题

**1. 单测是否合理？** 合理且质量高于平均：真事故驱动、断言精确到错误码/文案/形状、无快照、无空洞断言（仅查获 2 处恒真断言且都在 CI 跳过区）。

**2. 是约束、过拟合还是无效果？** **以约束为主**（前后端各约 40-60% 是"改歪必红"的强约束）；**过拟合真实存在但占 ~15-20%**，且后端部分是有意的临时护栏（真库测试不可用时的代偿），前端部分（白盒私有状态、mock 手抄、逐字节样式断言）是应清理的脆性资产；**基本无效的 <5%**。

**3. 大版本后 CI 失败好几次，是测试的锅吗？** 不是主因。主因是流程：①本地门禁 4 项 vs CI 13 项不对齐（低级违规首次暴露必在 CI）；②全局覆盖率阈值在大版本分母变化时机制性追尾；③巨石 job 串行导致修一个错要跑一轮 20 分钟。测试侧的放大因素是脆弱测试（白盒/时序/mock 手抄）随测试量增长而增长——拆巨石 job + 对齐本地门禁 + 覆盖率棘轮 + PostGIS service container 四件事做完，"失败好几次"会变成"本地红一次、CI 绿一次"。

---

# 附：优先级行动清单（供 agent 实施）

| 优先级 | 动作                                                                                                             | 预期效果                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P0     | 拆 lint-and-build 为 static-checks / frontend-tests / backend-tests 三个并行 job                                 | 快检 3-5 分钟全红，反馈回路缩短 4-5 倍                  |
| P0     | pre-push 补 format/lint/stylelint/cruise/types:check（秒级项）                                                   | push 一次通过率大幅上升                                 |
| P0     | nest-tests 加 PostGIS service container + `V3_INTEGRATION_DB=1` + seed                                           | SQL 语义盲区消除（12 个门控文件含 6 个 e2e 全链路激活） |
| P1     | 覆盖率改棘轮（对基线比降，不设固定阈值）                                                                         | 大版本"第一次 CI 必红"根除                              |
| P1     | 路径过滤（docs 只跑静态检查；前端/后端变更分别触发对应测试）                                                     | 无关 push 提速 50%+                                     |
| P2     | 前端 Cesium/OL mock 抽共享 factory；UnifiedMap 的 setTimeout 竞态改 fake timers/确定性等待                       | 消 flaky、降 mock 维护成本                              |
| P2     | 清理：UnifiedMap mock 手抄 buildPortGeoJson、useChartBase 样式逐字节断言、forecastAdapter 全量 toEqual、常量断言 | 降过拟合面                                              |
| P2     | main 分支砍掉重复 vite 构建；deploy 预拉镜像并行化；GHCR tag 保留策略                                            | 关键路径再缩 5-10 分钟                                  |
| P1     | concurrency group 改 `github.sha` 或去掉 pull_request 触发（见 1.5-1）                                           | 消除同提交双跑，省近一半 CI 时长                        |
| P1     | "Make package public" 失败显式 `::error::` 中断（见 1.5-4）                                                      | 首次建包失败不再绕路排障                                |
| P2     | audit job 补 `cache: 'npm'`（见 1.5-2）                                                                          | 消除重复安装                                            |
| P2     | 服务器部署脱钩 git：compose 只按 IMAGE_TAG 拉镜像（见 1.5-3）                                                    | 消除 users.json 备份/还原类 workaround                  |

> ⚠️ **联动顺序提醒（v1.1）**：实施 P0-PostGIS 激活之前，必须先修掉两处恒真断言——`plans.repository.spec.ts:87`（时间戳与数组比较）与 `spatial.repository.spec.ts:342`（凑数断言），否则激活的是假绿。且 12 个门控文件真库首跑可能翻出一批红（历史上 pid 符号、SRID 两类事故正是这个盲区），建议单独 PR、与实施节奏协调。

---

# v1.1 修订记录（2026-09-12）

第二轮独立交叉核验（另一 agent 全量复核本报告 ~50 条主张）结论：报告高度属实，5 处口径偏差均为"往保守方向写错"，已全部亲手复核后修正：

| #   | 偏差                                       | 修正                                                                                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | PR 触发分支漏写 master                     | 已补（ci.yml:10 为 `[main, master]`）                                                                             |
| 2   | 前端测试文件数写 55                        | 当前快照实测 57（实施 agent 新增 useAuth.authState.test.ts、CesiumRenderer.terrain.test.ts 等，数字随工作区浮动） |
| 3   | 真库门控写"6 个套件"                       | 实为 **12 个文件**（6 spec + 6 e2e-spec），盲区双倍，已在 2.4 修正                                                |
| 4   | UnifiedMap setTimeout 三连写"8 处"         | 实测 **15 组 / 30 处**（写法为 `setTimeout(resolve, 50)`，初版字面量统计漏计），已在 2.3 修正                     |
| 5   | 未提 deploy 服务器 git 耦合等 4 条 CI 问题 | 已核实成立并新增 1.5 节                                                                                           |

另：核验确认实施 agent 已修复若干代码问题（H-1 3D 水位重建、H-2 吞 DB 故障改分级上抛、H-3 年→月 NaN、M-3 限流 @SkipThrottle + route.e2e-spec 新增等），修复质量抽查良好；其中 H-1 修复后 `CesiumRenderer.ts:1849-1850、:1037` 两处旧注释未同步，可顺手清理。
