# tools/gis-import — GIS 矢量数据入库流水线

P4 数据入库（T4.1/T4.2）的可复现工具集。原则：**先验证、后导入、验证器优先**——数据链路的护栏比导入本身更值得先建。

## 组成

| 文件                                      | 职责                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| [db-schema-gis.sql](../db-schema-gis.sql) | 空间库 6 表 schema（与业务表 db-schema.sql 分离，独立演进）      |
| `verify.mjs`                              | **质检验证器**——连 PG 跑质检四件套，JSON 对账输出，可进 CI       |
| `import-gis.ps1`                          | 统一 ogr2ogr 入库（EPSG:4490，GEOMETRY_NAME=geom），每类一条命令 |

## 步骤

```bash
# 1. 启动 PostGIS
docker compose -f docker-compose.v3.yml up -d postgis

# 2. 建表
docker cp tools/db-schema-gis.sql beibu-postgis:/tmp/
docker exec beibu-postgis psql -U postgres -d v3_dev -f /tmp/db-schema-gis.sql

# 3. 导入（可按 Section 单跑）
powershell -File tools/gis-import/import-gis.ps1 -Section all

# 4. 质检（机器可读 JSON：-json）
npm run verify-gis
```

## 质检项（verify.mjs）

| 检查              | 语义                                            |
| ----------------- | ----------------------------------------------- |
| count > 0         | 表非空                                          |
| srid == 4490      | 坐标系正确（首要素采样，可细化）                |
| invalid_geom == 0 | 无无效几何（ST_IsValid 全过）                   |
| bbox_ok           | 无几何越出北部湾业务边界（105-115/18-25）       |
| geom_type_ok      | 几何类型与表声明一致（LineString/MultiPolygon） |

失败即 exit 1（`npm run verify-gis` 可直接挂 CI）；`--table=roads` 单表、`--json` 机器输出。

## 设计备忘

- **坐标系**：4490 存、4326 出（`-t_srs EPSG:4490` 统一转换）。
- **roads 不上 pgRouting**：路径引擎 networkx 在应用侧构图（T5.2），PG 只做数据源；source/target/cost 等拓扑列无消费者，不建。
- **红树林全时相**：11 时相每份 ~900MB 全球数据，`-spat` 广西 bbox 先裁剪再逐时相 `-append` 入库；`year` BTree + `geom` GiST 分开建（优化器 BitmapAnd 合并，比复合 GiST 灵活）。
- **length_m 预计算**：roads 的 length_m 入库后回填（UTM48N ST_Length），构图免重算——与 db-schema-gis.sql 内注释一致。
- **数据源断言**：源 roads 仅含 osm_id/name/highway（无 maxspeed/oneway）——列建而以 NULL 留存，time 权重走 class 限速系数表（应用侧）。
