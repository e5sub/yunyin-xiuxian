/**
 * SQLite 库:用户 / 云存档 / 玩家档案 / 好友 / 聊天
 * 战力与属性为 GNum(尾数+指数),全部按字符串落库,避免浮点精度丢失
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })

export const db = new Database(join(dataDir, 'yunyin.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  realm_label TEXT NOT NULL,
  realm_index INTEGER NOT NULL,
  power_m REAL NOT NULL,
  power_e INTEGER NOT NULL,
  hp_m REAL NOT NULL,
  hp_e INTEGER NOT NULL,
  atk_m REAL NOT NULL,
  atk_e INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(id DESC);
CREATE INDEX IF NOT EXISTS idx_profile_rank ON profiles(realm_index DESC, power_e DESC, power_m DESC);
`)

export interface ProfileRow {
  user_id: number
  name: string
  realm_label: string
  realm_index: number
  power_m: number
  power_e: number
  hp_m: number
  hp_e: number
  atk_m: number
  atk_e: number
  updated_at: number
}

export interface SaveSnapshot {
  version: number
  data: string
  updated_at: number
}

export const getSave = db.prepare('SELECT version, data, updated_at FROM saves WHERE user_id = ?') as Database.Statement<[number], SaveSnapshot>
export const putSave = db.prepare(
  `INSERT INTO saves (user_id, version, data, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`
)
export const deleteSave = db.prepare('DELETE FROM saves WHERE user_id = ?')
export const getProfile = db.prepare('SELECT * FROM profiles WHERE user_id = ?') as Database.Statement<[number], ProfileRow | undefined>
export const upsertProfile = db.prepare(
  `INSERT INTO profiles (user_id, name, realm_label, realm_index, power_m, power_e, hp_m, hp_e, atk_m, atk_e, updated_at)
   VALUES (@user_id, @name, @realm_label, @realm_index, @power_m, @power_e, @hp_m, @hp_e, @atk_m, @atk_e, @updated_at)
   ON CONFLICT(user_id) DO UPDATE SET
     name = excluded.name, realm_label = excluded.realm_label, realm_index = excluded.realm_index,
     power_m = excluded.power_m, power_e = excluded.power_e,
     hp_m = excluded.hp_m, hp_e = excluded.hp_e,
     atk_m = excluded.atk_m, atk_e = excluded.atk_e, updated_at = excluded.updated_at`
)
export const findUserByName = db.prepare('SELECT id, username, pass_hash, created_at FROM users WHERE username_lower = ?')
export const findUserById = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?')
export const insertUser = db.prepare('INSERT INTO users (username, username_lower, pass_hash, created_at) VALUES (?, ?, ?, ?)')
