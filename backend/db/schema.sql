CREATE EXTENSION IF NOT EXISTS postgis;
 
-- Xoa sach neu chay lai (an toan khi tao lai tu dau)
DROP TABLE IF EXISTS events, positions, geofences, devices, subjects, users CASCADE;
 
-- users: nguoi giam sat (caregiver), nguoi se dang nhap
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(80)  UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,        -- mat khau da bam, KHONG luu tho
  role          VARCHAR(20)  NOT NULL DEFAULT 'caregiver',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
 
-- subjects: doi tuong duoc bao ve
CREATE TABLE subjects (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- chan xoa user con doi tuong
  name       VARCHAR(120) NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subjects_user ON subjects(user_id);
 
-- devices: thiet bi / tracker (dung tu Tuan 3 / Lop 2)
CREATE TABLE devices (
  id           SERIAL PRIMARY KEY,
  subject_id   INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  device_token VARCHAR(128) UNIQUE NOT NULL,  -- ma bi mat thiet bi dung khi gui vi tri
  name         VARCHAR(120),
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_subject ON devices(subject_id);
 
-- geofences: vung an toan (Tuan 2 moi ve)
CREATE TABLE geofences (
  id         SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  geom       GEOMETRY(POLYGON, 4326) NOT NULL,            -- da giac, he toa do WGS84
  type       VARCHAR(20) NOT NULL DEFAULT 'polygon'
             CHECK (type IN ('polygon', 'circle')),       -- vung tron (L2) cung luu bang geom
  active     BOOLEAN NOT NULL DEFAULT TRUE,                -- bat/tat giam sat ma khong xoa
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_geofences_subject ON geofences(subject_id);
CREATE INDEX idx_geofences_geom ON geofences USING GIST (geom);  -- index khong gian
 
-- positions: vi tri GPS nhan duoc
-- Giu CA device_id lan subject_id: Tuan 1-2 chi dien subject_id; Tuan 3/L2 dien them device_id.
CREATE TABLE positions (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER REFERENCES devices(id) ON DELETE CASCADE,   -- de trong o Tuan 1-2
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  geom        GEOMETRY(POINT, 4326) NOT NULL,
  accuracy    REAL CHECK (accuracy >= 0),                          -- do chinh xac GPS (met)
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_positions_geom ON positions USING GIST (geom);
CREATE INDEX idx_positions_subject_time ON positions(subject_id, recorded_at DESC);
 
-- events: nhat ky canh bao
-- geofence_id cho phep NULL + ON DELETE SET NULL: giu lich su su kien du vung bi xoa.
CREATE TABLE events (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  geofence_id INTEGER REFERENCES geofences(id) ON DELETE SET NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('EXIT', 'ENTER')),
  confidence  REAL CHECK (confidence >= 0 AND confidence <= 1),    -- muc tin cay (L2), de trong o L1
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_subject_time ON events(subject_id, occurred_at DESC);