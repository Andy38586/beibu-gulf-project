# 数据总清单（Data Inventory · 2026-08-14）

> 定位：**v3 开发的数据地图 + 论文「数据来源」章节底稿 + 答辩"数据哪来的"翻页答案**。
> 与《v3 发展路径》（docs/v3-发展路径-2026-08-14.md）配套：发展路径管"怎么用"，本清单管"有什么、从哪来、怎么引用"。
> 原始文件在桌面「项目数据」目录（约 25GB），详见该目录 README.md。

---

## 一、总览

| # | 数据 | 状态 | 体量 | 坐标系 | 分辨率 | 用途 |
|---|---|---|---|---|---|---|
| 1 | ASTER GDEM 30m | ✅ 已有 | 55MB | 4326→32648/4490 | 30m | 浸没分析（现状基线） |
| 2 | Copernicus GLO-30 | ✅ 已下载+已处理 | 706MB→产物 4 个 | 4326/32648/4490 | 30m | 浸没/选址底图（**升级主数据**） |
| 3 | SRTM15+ V2.6（陆海一体） | ✅ 已下载+裁剪验证 | 6.2GB | 4326 | 15弧秒≈450m | **海底 DEM**（宏观选址级） |
| 4 | OSM China PBF | ✅ 已下载（MD5 通过） | 1.5GB | 4326 | 线/面 | 路网/岸线/水体/工业区**原料** |
| 5 | beibu-roads / beibu-railways | ✅ 已提取 | 82.8+2.8MB | 4326 | — | 最短路径（pgRouting 原料） |
| 6 | coastline / water（中国+bbox 版） | ✅ 已提取 | 23.6+393MB（裁剪 1.65+9.1MB） | 4326 | — | 陆海分界、水系约束 |
| 7 | GMW 红树林 v3 | ✅ 用户下载+解压 | 1.85GB（11 时相 shp） | 4326 | 矢量 | 生态硬约束（**隐藏王牌**） |
| 8 | WDPA 保护区（中国） | ✅ 用户下载+解压 | 41MB（三格式） | 4326 | 矢量 | 生态一票否决层 |
| 9 | 港口吞吐量 2021-2026 | ✅ 已有（真实） | <1MB | — | 月度 | 预测分析（SARIMA 原料） |
| 10 | ESA WorldCover 10m（土地类型） | ✅ 已下载 | 289MB（4 瓦片） | 4326 | **10m** | 土地类型因子（**免注册替代 GlobeLand30**） |
| 11 | 工业园区多边形 | ✅ 已提取 | 2,687 个面 | 4326 | 矢量 | 最短路径终点、选址因子 |
| 12 | 平陆运河路线 | ⏳ 待手工 | geojson | 4326 | — | 运河因子（论文变量） |
| 13 | 统计年鉴城市指标 | ⏳ 待手工 | 表格 | — | — | 城市发展指数 |
| 14 | 生态保护红线（广西） | ⏳ 待人工 | 矢量 | 4490 | — | 选址一票否决（过渡用 WDPA+白海豚） |
| 15 | AIS 航线 | ⏳ 待定 | — | — | — | 航线分析（降档，可合成+标注） |

**已备齐 11/15，缺 4 项均为小活（#12-15）。**

---

## 二、逐项登记（论文引用写法）

### 1. ASTER GDEM 30m
- 来源：地理空间数据云（国内镜像）；分幅 6 瓦片（N21-22 × E107-109）
- 处理：gdalwarp 拼接→UTM48N→SAGA 填洼→4490/4326 双出（tools/dem-pipeline 01-05）
- 引用写法：`NASA/METI ASTER GDEM v3, 30m resolution, via 地理空间数据云 (geodata.cn), 2026-06 获取`
- 注：**已被 GLO-30 取代为升级主数据**，保留作对照

### 2. Copernicus GLO-30（陆地 DEM 升级主数据）
- 来源：ESA，AWS 公开桶 `copernicus-dem-30m`，19 瓦片（N20-23 × E106-110）
- 处理：gdalwarp→32648（Int16/32767）→SAGA 填洼（Wang&Liu）→4326+4490 双出（已验证：高程 -139~1914m）
- 引用写法：`European Space Agency, Copernicus DEM GLO-30 (30m), AWS Open Data, 2026-08-14 获取`
- 论文价值：比 ASTER 空洞少、质量高；**真 3D 地形瓦片（CTB）将从它生成**

### 3. SRTM15+ V2.6（海底 DEM——你已拥有）
- 来源：UCSD `topex.ucsd.edu/pub/srtm15_plus/SRTM15_V2.6.nc`（NetCDF-4，全球 15 弧秒）
- 范围：-11058~8627m 陆海一体；北部湾裁剪版实测 **-121.6m（海底）~1836m（陆地）**
- 引用写法：`Tozer et al. (2019), SRTM15+ V2.6, 15 arc-second global relief, UC San Diego, 2026-08-14 获取`
- **答辩口径（堵"水深不准"质疑）**："本研究为规划前期**宏观适宜性评价**，水深采用 SRTM15+ V2.6（15 弧秒≈450m）；近岸航道级水深不在本研究范围"

### 4-6. OSM 派生（路网/岸线/水系）
- 来源：Geofabrik `china-latest.osm.pbf`（官方 MD5 校验通过）；pyosmium 提取（tools/extract-roads.py / extract-coastline.py）
- 引用写法：`© OpenStreetMap contributors, ODbL, via Geofabrik, 2026-08-14 获取`
- 注意：**入库前必须 bbox 裁剪**（已产出裁剪版）；roads 入 pgRouting 需**拓扑化**（节点/边拆分、自相交修复——管线脚本待写）

### 7. GMW 红树林 v3（隐藏王牌）
- 来源：UNEP-WCMC 全球红树林观察 v3，**11 时相**（1996, 2007-2010, 2015-2020），2020 年全球 107 万要素
- 引用写法：`Bunting et al. (2022), Global Mangrove Watch v3.0, UNEP-WCMC`
- **价值**：不只是"禁建区"——可做**岸线生态敏感性变化图层**（1996→2020 逐期），答辩讲"选址方案对红树林的避让"，评审最认的环保维度

### 8. WDPA 保护区（中国）
- 来源：UNEP-WCMC 世界保护区数据库，中国 34 个多边形（points+polygons 双图层）
- 引用写法：`UNEP-WCMC & IUCN, WDPA-WDOECM (2026-08 release, China subset)`
- 注：与广西生态保护红线（待人工）并用；三娘湾中华白海豚保护区边界可补充

### 9. 港口吞吐量 2021-2026（真实数据）
- 来源：公开统计（原始数据来源.txt 留档）；货物+集装箱双序列，月度 xlsx→清洗 csv
- 引用写法：`中华人民共和国交通运输部港口吞吐量统计（月度），2021-01 至 2026-06，北部湾港`
- **价值**：预测分析从"合成数据"升级"真实数据+诚实标注"只差 SARIMA 拟合一步

### 10. ESA WorldCover 10m（土地类型，🔄 下载中）
- 来源：ESA，AWS 公开桶 `esa-worldcover`（eu-central-1），3°×3° 瓦片（注意：**经纬度需为 3 的倍数**）
- 范围：N18/N21 × E105/E108 共 4 瓦片 ≈ 290MB；耕地=class 40（GDAL 重分类提取）
- 引用写法：`Zanaga et al. (2022), ESA WorldCover 10m v200, 2021`
- **为何不用 GlobeLand30**：免注册直下、分辨率更高（10m vs 30m）；GlobeLand30 保留为备选

---

## 三、缺的 4 样获取步骤（都是小活）

### A. 平陆运河路线（半天）
1. 公开资料：广西平陆运河集团环评公示/新闻报道（起点横州平塘江口 ~109.3E,22.7N → 终点钦州沙井 ~108.6E,21.9N，全长约 134km）
2. 在 QGIS/geojson.io 沿郁江-钦江河道画中心线（参考天地图影像）
3. 输出 `多边形\平陆运河\canal.geojson`（LineString, 4326）
4. 属性建议：name、section、status（在建/建成）、设计通航吨级（5000t）

### B. 统计年鉴城市指标（一天）
1. 来源：广西统计年鉴/钦州、防城港、北海市统计公报
2. 指标建议：GDP、常住人口、工业产值、外贸额、固定资产投资（2015-2025 年度）
3. 录入 `预测分析\城市发展指数\city_index.csv`（year, city, gdp, population, ...）
4. 与吞吐量合并构造"城市发展指数"（主成分或加权）

### C. 工业园区多边形（🔄 正在提取）
- 已写 `tools/extract-industrial.py`：OSM `landuse=industrial` + bbox 过滤 → `多边形\工业园区\beibu-industrial.geojson`
- 补充：高德 POI（`tools/.amap_key` 已有）抓"产业园区/工业园区"名称点，与 OSM 面合并

### D. 生态保护红线（人工申请）
- 广西自然资源厅申请或公开图件勾绘；**过渡方案**：WDPA + 三娘湾中华白海豚保护区边界（公开）先行

---

## 四、技术注意（管线工作，非数据问题）

1. **beibu-roads 入 pgRouting 必须拓扑化**：节点/边拆分（pgr_nodeNetwork 或 osm2pgrouting）、自相交修复——管线脚本待写（阶段 3）
2. **全国级数据入库前必须裁剪**：water 392MB、OSM 1.5GB 整包入库是反模式；一律 bbox 裁剪后入库（裁剪版已产出）
3. **坐标系**：存储 4490（CGCS2000，行业标准），数据源 4326 直接赋值（厘米级一致）；展示层转 4326/3857
4. **栅格策略**：DEM/土地类型栅格不入 PostGIS raster，文件 + GDAL 读取；PostGIS 管矢量/路由/拓扑

---

## 五、获取命令速查（可复现）

```bash
# ESA WorldCover（土地类型）
node --use-env-proxy -e "..."  # 4 瓦片: N18E105/N18E108/N21E105/N21E108
#   URL: https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{lat}E{lon}_Map.tif

# 工业区提取
python tools/extract-industrial.py   # 输入: .tmp-pip/china.osm.pbf (ASCII 硬链接)

# 耕地类提取（下载后）
gdal_calc.py -A ESA_WorldCover_*.tif --outfile=cropland.tif --calc="A==40"  # class 40 = cropland
```
