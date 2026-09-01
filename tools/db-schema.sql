-- v3 最简版 schema —— 存储坐标系 EPSG:4490 (CGCS2000)
-- 数据源为 WGS84(4326)；CGCS2000 与 WGS84 在中国区域厘米级一致，直接赋值存储，项目尺度可接受
-- 用法: docker exec -i beibu-postgis psql -U postgres -d v3_dev -f /tmp/db-schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- 用户(迁移自 users.json，password 为 bcrypt 哈希)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  password     TEXT NOT NULL,
  token_version INT NOT NULL DEFAULT 0,
  created_at   TEXT
);

-- 方案收藏(迁移自 plans.json)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name         TEXT,
  payload      JSONB,
  created_at   TEXT,
  updated_at   TEXT
);

-- 港口(3 个)
CREATE TABLE IF NOT EXISTS ports (
  id TEXT PRIMARY KEY,
  name    TEXT,
  address TEXT,
  type    TEXT,
  phone   TEXT,
  geom    geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_ports_geom ON ports USING GIST (geom);

-- 设施 POI（v2：三城化 qz/bh/fcg，city 列区分；type 区分设施类）
CREATE TABLE IF NOT EXISTS poi_facilities (
  id TEXT PRIMARY KEY,
  type     TEXT,
  name     TEXT,
  district TEXT,
  city     TEXT,
  geom     geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_poi_geom ON poi_facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_type ON poi_facilities (type);
CREATE INDEX IF NOT EXISTS idx_poi_city_type ON poi_facilities (city, type);

-- 小区（v2：三城化，city 列区分；选址候选）
CREATE TABLE IF NOT EXISTS xiaoqu (
  id TEXT PRIMARY KEY,
  name     TEXT,
  district TEXT,
  city     TEXT,
  geom     geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_xiaoqu_geom ON xiaoqu USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_xiaoqu_city ON xiaoqu (city);

-- 洪涝设施(83 个，含 elevation/value/damage_rate)
CREATE TABLE IF NOT EXISTS flood_facilities (
  id TEXT PRIMARY KEY,
  name        TEXT,
  type        TEXT,
  port        TEXT,
  elevation   DOUBLE PRECISION,
  value       DOUBLE PRECISION,
  damage_rate DOUBLE PRECISION,
  risk_level  TEXT,
  geom        geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_flood_geom ON flood_facilities USING GIST (geom);

-- data_archive 表之后追加 favorites（v2 新增）：全局收藏（迁移自运行时 favorites.json）
-- 幂等添加语义 = 主键 (user_id, item_type, item_id) 冲突忽略，对齐 favoritesRepository 既有行为
CREATE TABLE IF NOT EXISTS favorites (
  user_id    TEXT NOT NULL REFERENCES users(id),
  item_type  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (user_id, item_type, item_id)
);

-- v2 追加 city 列（历史数据由重导填充）
ALTER TABLE poi_facilities ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE xiaoqu        ADD COLUMN IF NOT EXISTS city TEXT;

-- 真数据 JSON 存档（2026-08-14 加）：backend/data 全部静态真数据原样复制一份，
-- 供 v3 Nest/FastAPI 接入时建模；假数据（mock/合成）不入库，留在文件系统。
CREATE TABLE IF NOT EXISTS data_archive (
  name        TEXT PRIMARY KEY,          -- 相对路径标识，如 forecast/cargo.json
  payload     JSONB NOT NULL,            -- 原样 JSON
  sha256      TEXT NOT NULL,             -- 内容校验（防漂移）
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
