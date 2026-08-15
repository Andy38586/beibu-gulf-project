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

-- 设施 POI(6 类 hospital/school/park/bus_station/mall 等，type 区分)
CREATE TABLE IF NOT EXISTS poi_facilities (
  id TEXT PRIMARY KEY,
  type     TEXT,
  name     TEXT,
  district TEXT,
  geom     geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_poi_geom ON poi_facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_type ON poi_facilities (type);

-- 小区(557 个，选址候选)
CREATE TABLE IF NOT EXISTS xiaoqu (
  id TEXT PRIMARY KEY,
  name     TEXT,
  district TEXT,
  geom     geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_xiaoqu_geom ON xiaoqu USING GIST (geom);

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

-- 真数据 JSON 存档（2026-08-14 加）：backend/data 全部静态真数据原样复制一份，
-- 供 v3 Nest/FastAPI 接入时建模；假数据（mock/合成）不入库，留在文件系统。
CREATE TABLE IF NOT EXISTS data_archive (
  name        TEXT PRIMARY KEY,          -- 相对路径标识，如 forecast/cargo.json
  payload     JSONB NOT NULL,            -- 原样 JSON
  sha256      TEXT NOT NULL,             -- 内容校验（防漂移）
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
