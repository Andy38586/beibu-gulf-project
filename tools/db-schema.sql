-- v3 鏈€绠€鐗?schema 鈥斺€?瀛樺偍鍧愭爣绯?EPSG:4490 (CGCS2000)
-- 鏁版嵁婧愪负 WGS84(4326);CGCS2000 涓?WGS84 鍦ㄤ腑鍥藉尯鍩熷帢绫崇骇涓€鑷?鐩存帴璧嬪€煎瓨鍌?椤圭洰灏哄害鍙帴鍙?
-- 鐢ㄦ硶: docker exec -i beibu-postgis psql -U postgres -d v3_dev -f /tmp/db-schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- 鐢ㄦ埛(杩佺Щ鑷?users.json,password 涓?bcrypt 鍝堝笇)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  password     TEXT NOT NULL,
  token_version INT NOT NULL DEFAULT 0,
  created_at   TEXT
);

-- 鏂规鏀惰棌(杩佺Щ鑷?plans.json)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name         TEXT,
  payload      JSONB,
  created_at   TEXT,
  updated_at   TEXT
);

-- 娓彛(3 涓?
CREATE TABLE IF NOT EXISTS ports (
  id TEXT PRIMARY KEY,
  name    TEXT,
  address TEXT,
  type    TEXT,
  phone   TEXT,
  geom    geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_ports_geom ON ports USING GIST (geom);

-- 璁炬柦 POI(6 绫? hospital/school/park/bus_station/mall 绛?type 鍖哄垎)
CREATE TABLE IF NOT EXISTS poi_facilities (
  id TEXT PRIMARY KEY,
  type     TEXT,
  name     TEXT,
  district TEXT,
  geom     geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_poi_geom ON poi_facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_type ON poi_facilities (type);

-- 灏忓尯(557 涓?閫夊潃鍊欓€?
CREATE TABLE IF NOT EXISTS xiaoqu (
  id TEXT PRIMARY KEY,
  name     TEXT,
  district TEXT,
  geom     geometry(Point, 4490)
);
CREATE INDEX IF NOT EXISTS idx_xiaoqu_geom ON xiaoqu USING GIST (geom);

-- 娲稘璁炬柦(83 涓?鍚?elevation/value/damage_rate)
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

