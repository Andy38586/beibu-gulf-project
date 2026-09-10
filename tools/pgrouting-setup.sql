-- pgRouting 拓扑与权重 —— route 域下沉（阶段 3）
-- 依据：docs/算法服务下沉PostGIS-设计-2026-09-10.md
-- 前置：postgis 容器须使用带 pgrouting 的镜像（local/postgis-pgrouting:16-3.4，已构建）
--
-- 目的：把 route/path 的「构图 + 最短路」从 Python 侧（networkx，全量拉 165,111 条边进内存、
-- 峰值 612MB、预热 179.5s）下沉为 pgRouting 的 SQL 查询。
--
-- 口径对齐（复现 backend/algorithm-service/route/graph.py，勿凭感觉改）：
--   · 权重 distance → cost_m   = round(length_m, 2)                        （graph.py:224）
--   · 权重 time     → cost_min = round(length_m/1000/speed*60, 4)          （graph.py:225）
--     注意分子必须先除 1000 折算千米，否则把米当千米、时长放大 1000 倍（原实现单测已固化）
--   · speed 取自 road_class_speed（原为 Python 侧 CLASS_SPEED_KMH 字典，迁移后权威移至 PG）
--   · 不可通行分类 → cost = -1（pgRouting 约定：负代价边不可通行），对齐 EXCLUDED_CLASSES
--   · 两口径「同源不混算」：同一路径同时返回 distanceM 与 durationMin（由本次选择出发，
--     但两个值都基于同一条路径的实际边集计算）
--
-- ⚠️ 已知偏差风险：原实现用「端点投影切分」（精确），pgr_createTopology 用「容差吸附」
--    （近似）。tolerance 取值会影响断点连接完整性 → 阶段 3 验收必须用 5 组起终点比对
--    distanceM（相对偏差 < 1%）与 durationMin（< 2%）实测校准。

-- ============================================================================
-- ① pgRouting 扩展
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- ============================================================================
-- ② 限速与可通行表（迁移后成为 time 口径的单一事实源）
-- ============================================================================
CREATE TABLE IF NOT EXISTS road_class_speed (
  class       TEXT PRIMARY KEY,
  speed_kmh   INTEGER NOT NULL,
  traversable BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE road_class_speed IS
  'OSM highway class → 限速(km/h) 与可通行性；对齐 algorithm-service route/graph.py 的 CLASS_SPEED_KMH 与 EXCLUDED_CLASSES。**未列出的 class 走默认 30km/h 且可通行**';
COMMENT ON COLUMN road_class_speed.traversable IS
  'FALSE 的 class 其边 cost 置 -1（不可通行）。依据：construction/proposed 属未建成（参与寻路会产生"穿越工地"假路径）；pedestrian/platform/corridor/elevator/escape/ladder 属步行设施；bus_stop/busway 社会车辆禁行；raceway/rest_area/services/disused/passing_place/no 无语义或废弃';

-- 可通行 + 限速（值取自 graph.py:71-87 CLASS_SPEED_KMH，逐条对齐）
INSERT INTO road_class_speed (class, speed_kmh, traversable) VALUES
  ('motorway',       100, TRUE),
  ('motorway_link',   60, TRUE),
  ('trunk',           80, TRUE),
  ('trunk_link',      50, TRUE),
  ('primary',         60, TRUE),
  ('primary_link',    40, TRUE),
  ('secondary',       50, TRUE),
  ('secondary_link',  30, TRUE),
  ('tertiary',        40, TRUE),
  ('tertiary_link',   30, TRUE),
  ('residential',     30, TRUE),
  ('service',         20, TRUE),
  ('unclassified',    30, TRUE),
  ('road',            30, TRUE),
  ('living_street',   20, TRUE)
ON CONFLICT (class) DO UPDATE
  SET speed_kmh = EXCLUDED.speed_kmh, traversable = EXCLUDED.traversable;

-- 不可通行分类（对齐 graph.py:91-108 EXCLUDED_CLASSES，共 16 项）
-- speed_kmh 对不可通行边无意义，填 0 以示语义
INSERT INTO road_class_speed (class, speed_kmh, traversable) VALUES
  ('construction',    0, FALSE),
  ('proposed',        0, FALSE),
  ('pedestrian',      0, FALSE),
  ('platform',        0, FALSE),
  ('corridor',        0, FALSE),
  ('elevator',        0, FALSE),
  ('escape',          0, FALSE),
  ('ladder',          0, FALSE),
  ('bus_stop',        0, FALSE),
  ('busway',          0, FALSE),
  ('raceway',         0, FALSE),
  ('rest_area',       0, FALSE),
  ('services',        0, FALSE),
  ('disused',         0, FALSE),
  ('passing_place',   0, FALSE),
  ('no',              0, FALSE)
ON CONFLICT (class) DO UPDATE
  SET speed_kmh = EXCLUDED.speed_kmh, traversable = EXCLUDED.traversable;

-- ============================================================================
-- ③ roads 追加拓扑列与权重列（只追加，不改既有结构）
-- ============================================================================
ALTER TABLE roads ADD COLUMN IF NOT EXISTS source   INTEGER;
ALTER TABLE roads ADD COLUMN IF NOT EXISTS target   INTEGER;
ALTER TABLE roads ADD COLUMN IF NOT EXISTS cost_m   DOUBLE PRECISION;
ALTER TABLE roads ADD COLUMN IF NOT EXISTS cost_min DOUBLE PRECISION;

COMMENT ON COLUMN roads.source   IS 'pgRouting 拓扑起点顶点 id（pgr_createTopology 产出）';
COMMENT ON COLUMN roads.target   IS 'pgRouting 拓扑终点顶点 id';
COMMENT ON COLUMN roads.cost_m   IS 'distance 口径权重 = length_m；不可通行 = -1';
COMMENT ON COLUMN roads.cost_min IS 'time 口径权重（分钟）= length_m/1000/speed*60；不可通行 = -1';

-- 权重计算：先按限速表匹配，再对未匹配项（含 class 为 NULL）走默认 30km/h
-- 分两步写是为了让「默认兜底」显式可见——单条 UPDATE ... FROM 会让未匹配行保持 NULL，
-- 后续查询静默丢边（NULL cost 的边被 pgr_dijkstra 忽略），属隐蔽故障
UPDATE roads r SET
  cost_m   = CASE WHEN cs.traversable THEN round(r.length_m::numeric, 2) ELSE -1 END,
  cost_min = CASE WHEN cs.traversable
                  THEN round((r.length_m / 1000.0 / cs.speed_kmh * 60)::numeric, 4)
                  ELSE -1 END
FROM road_class_speed cs
WHERE cs.class = r.class;

UPDATE roads SET
  cost_m   = round(length_m::numeric, 2),
  cost_min = round((length_m / 1000.0 / 30 * 60)::numeric, 4)
WHERE cost_m IS NULL;

-- ============================================================================
-- ④ 建拓扑
-- ============================================================================
-- ⛔ **本节已被取代，不要照跑**（2026-09-10）
--
-- 原做法 `pgr_createTopology('roads', 0.00001, 'geom', 'id')` 的容差吸附**依赖边的
-- 处理顺序**：同一份数据两次重建得到不同拓扑（实测 246,941 vs 193,135 顶点），
-- 不可复现，且连通性明显更差（最大连通分量只盖住 ~30% 的可通行边，而 networkx
-- 时代是 95%）。
--
-- 现行做法（仓库内已固化，见对应脚本）：
--   · tools/roads-topology-build.sql  —— 网格法（端点量化到 60m 网格，确定性）
--                                        重建 source / target
--   · tools/roads-derive.sql          —— class/length_m/cost_m/cost_min 回填
--                                        + main_comp = 全量可通行边的最大连通分量
--
-- 保留本节仅为留痕：说明「为什么不用容差吸附」这件事已经踩过、别再退回去。
-- ============================================================================
-- SELECT pgr_createTopology('roads', 0.00001, 'geom', 'id');

CREATE INDEX IF NOT EXISTS idx_roads_source ON roads (source);
CREATE INDEX IF NOT EXISTS idx_roads_target ON roads (target);
CREATE INDEX IF NOT EXISTS idx_roads_cost_m ON roads (cost_m) WHERE cost_m > 0;

-- ============================================================================
-- 灌后自检（手工执行）
-- ============================================================================
-- 1) 扩张成功
--    SELECT pgr_version();
-- 2) 拓扑顶点数（应远大于 0；原 networkx 构图为 194,456 节点）
--    SELECT count(*) FROM roads_vertices_pgr;
-- 3) 已连接边数（source/target 非空的比例，应接近全量）
--    SELECT count(*) FILTER (WHERE source IS NOT NULL AND target IS NOT NULL) AS connected,
--           count(*) AS total FROM roads;
-- 4) 权重分布抽样（cost_m 应约等于 length_m；cost_min 应正比于长度）
--    SELECT class, count(*), round(avg(length_m)::numeric,1) AS avg_len,
--           round(avg(cost_min)::numeric,3) AS avg_min, min(cost_m) AS min_cost
--    FROM roads GROUP BY class ORDER BY count(*) DESC LIMIT 12;
--    → 不可通行 class（construction 等）的 min_cost 应为 -1
-- 5) 不可通行边数（应与原构图 excluded 合计同量级：约 7,700 条）
--    SELECT count(*) FROM roads WHERE cost_m < 0;
