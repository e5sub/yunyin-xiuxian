/**
 * 数据访问层:SQLite(默认) / MySQL(DB_DRIVER=mysql) 双方言
 * 全部查询走 ? 占位符,统一异步接口;表结构按方言建,字段一致
 * 战力与属性为 GNum(尾数+指数),全部按字符串落库,避免浮点精度丢失
 *
 * env:
 *   DB_DRIVER=sqlite|mysql
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME   (mysql 时必填)
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Row = Record<string, unknown>

export interface RunResult {
  insertId: number
  affectedRows: number
}

const DRIVER = (process.env.DB_DRIVER ?? 'sqlite').toLowerCase() === 'mysql' ? 'mysql' : 'sqlite'

/* ---------------- SQLite ---------------- */

type SqliteDb = {
  prepare(sql: string): {
    run(...p: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint }
    get(...p: unknown[]): unknown
    all(...p: unknown[]): unknown[]
  }
  exec(sql: string): void
}

let sqlite: SqliteDb | null = null

async function sqliteDb(): Promise<SqliteDb> {
  if (sqlite !== null) return sqlite
  const mod = await import('better-sqlite3')
  const Database = (mod.default ?? mod) as unknown as new (path: string) => SqliteDb
  const here = dirname(fileURLToPath(import.meta.url))
  const dataDir = join(here, '..', 'data')
  mkdirSync(dataDir, { recursive: true })
  sqlite = new Database(join(dataDir, 'yunyin.db'))
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  return sqlite
}

/* ---------------- MySQL ---------------- */

type MySqlDb = {
  query(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>
}

let mysqlDb: MySqlDb | null = null

async function mysqlPool(): Promise<MySqlDb> {
  if (mysqlDb !== null) return mysqlDb
  const mod = await import('mysql2/promise')
  mysqlDb = mod.default.createPool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'yunyin',
    waitForConnections: true,
    connectionLimit: 10,
    // 返回 JSON 数值而不是 Buffer
    typeCast(field: { type: string; string(): string | null }, next: () => unknown) {
      const t = field.type
      if (t === 'BIGINT' || t === 'NEWDECIMAL') return String(field.string())
      return next()
    }
  }) as unknown as MySqlDb
  return mysqlDb
}

/* ---------------- 统一接口 ---------------- */

export function driverName(): 'sqlite' | 'mysql' {
  return DRIVER
}

/** 查多行 */
export async function all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (DRIVER === 'sqlite') {
    const d = await sqliteDb()
    return d.prepare(sql).all(...params) as T[]
  }
  const d = await mysqlPool()
  const [rows] = await d.query(sql, params)
  return rows as T[]
}

/** 查单行,没有返回 undefined */
export async function get<T = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  if (DRIVER === 'sqlite') {
    const d = await sqliteDb()
    return d.prepare(sql).get(...params) as T | undefined
  }
  const d = await mysqlPool()
  const [rows] = await d.query(sql, params)
  return (rows as T[])[0]
}

/** 写入/更新/删除,返回 insertId 与影响行数 */
export async function run(sql: string, params: unknown[] = []): Promise<RunResult> {
  if (DRIVER === 'sqlite') {
    const d = await sqliteDb()
    const info = d.prepare(sql).run(...params)
    return { insertId: Number(info.lastInsertRowid), affectedRows: Number(info.changes) }
  }
  const d = await mysqlPool()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result] = await d.query(sql, params)
  const r = result as { insertId?: number; affectedRows?: number }
  return { insertId: r.insertId ?? 0, affectedRows: r.affectedRows ?? 0 }
}

/** 执行 DDL / 事务语句 */
export async function exec(sql: string): Promise<void> {
  if (DRIVER === 'sqlite') {
    const d = await sqliteDb()
    d.exec(sql)
    return
  }
  const d = await mysqlPool()
  await d.query(sql)
}

/** upsert 单主键行:REPLACE INTO 两种方言同语义 */
export async function upsertByPk(table: string, row: Record<string, unknown>): Promise<RunResult> {
  const keys = Object.keys(row)
  const holders = keys.map(() => '?').join(', ')
  const sql = `REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${holders})`
  return run(sql, keys.map(k => row[k]))
}

/* ---------------- 表结构 ---------------- */

export async function initDb(): Promise<void> {
  if (DRIVER === 'sqlite') {
    const d = await sqliteDb()
    d.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  email TEXT,
  email_lower TEXT,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'active',
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
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_lower TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dungeon_teams (
  code TEXT PRIMARY KEY,
  dungeon TEXT NOT NULL,
  leader_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dungeon_team_members (
  code TEXT NOT NULL REFERENCES dungeon_teams(code) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_member_user ON dungeon_team_members(user_id);
CREATE TABLE IF NOT EXISTS game_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS boss_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  realm_index INTEGER NOT NULL,
  max_hp_m REAL NOT NULL,
  max_hp_e INTEGER NOT NULL,
  hp_m REAL NOT NULL,
  hp_e INTEGER NOT NULL,
  spawned_at INTEGER NOT NULL,
  dead_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS boss_damage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dmg_m REAL NOT NULL,
  dmg_e INTEGER NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dungeon_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dungeon TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dungeon, day)
);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(id DESC);
CREATE INDEX IF NOT EXISTS idx_profile_rank ON profiles(realm_index DESC, power_e DESC, power_m DESC);
`)
    // 老库迁移:补邮箱/角色/状态列(已存在则忽略)
    for (const stmt of [
      'ALTER TABLE users ADD COLUMN email TEXT',
      'ALTER TABLE users ADD COLUMN email_lower TEXT',
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'",
      "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
    ]) {
      try {
        d.exec(stmt)
      } catch {
        /* 列已存在 */
      }
    }
    // 老库补列之后才能建邮箱索引
    d.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_lower)')
    await seedConfig()
    return
  }

  // MySQL
  const d = await mysqlPool()
  await d.query(`
CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  username_lower VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(190) DEFAULT NULL,
  email_lower VARCHAR(190) DEFAULT NULL,
  pass_hash VARCHAR(128) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'player',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS saves (
  user_id BIGINT PRIMARY KEY,
  version INT NOT NULL,
  data MEDIUMTEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_saves_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS profiles (
  user_id BIGINT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  realm_label VARCHAR(64) NOT NULL,
  realm_index INT NOT NULL,
  power_m DOUBLE NOT NULL,
  power_e INT NOT NULL,
  hp_m DOUBLE NOT NULL,
  hp_e INT NOT NULL,
  atk_m DOUBLE NOT NULL,
  atk_e INT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_profile_rank (realm_index DESC, power_e DESC, power_m DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS friends (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  friend_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_friend (user_id, friend_id),
  CONSTRAINT fk_friends_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friends_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL,
  content VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_chat_created (id DESC),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS email_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email_lower VARCHAR(190) NOT NULL,
  code VARCHAR(8) NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  used INT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_code_email (email_lower, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dungeon_teams (
  code VARCHAR(8) PRIMARY KEY,
  dungeon VARCHAR(16) NOT NULL,
  leader_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dungeon_team_members (
  code VARCHAR(8) NOT NULL,
  user_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (code, user_id),
  INDEX idx_team_member_user (user_id),
  CONSTRAINT fk_team_code FOREIGN KEY (code) REFERENCES dungeon_teams(code) ON DELETE CASCADE,
  CONSTRAINT fk_team_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS game_config (
  config_key VARCHAR(64) PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS boss_state (
  id BIGINT PRIMARY KEY CHECK (id = 1),
  name VARCHAR(64) NOT NULL,
  realm_index INT NOT NULL,
  max_hp_m DOUBLE NOT NULL,
  max_hp_e INT NOT NULL,
  hp_m DOUBLE NOT NULL,
  hp_e INT NOT NULL,
  spawned_at BIGINT NOT NULL,
  dead_at BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS boss_damage (
  user_id BIGINT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  dmg_m DOUBLE NOT NULL,
  dmg_e INT NOT NULL,
  strikes INT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_bossdmg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dungeon_daily (
  user_id BIGINT NOT NULL,
  dungeon VARCHAR(32) NOT NULL,
  day CHAR(10) NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dungeon, day),
  CONSTRAINT fk_dungeon_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_users_email ON users(email_lower);
`) as unknown as void

  await seedConfig()
}

/** 游戏关键参数种子值(已存在不覆盖);邮件类种子值取环境变量,便于容器部署无缝迁移 */
async function seedConfig(): Promise<void> {
  const now = Date.now()
  const env = (k: string, dflt = ''): string => (process.env[k] ?? '').trim() || dflt
  const defaults: Array<[string, string]> = [
    ['announcement', ''],
    ['chat_min_interval_ms', '1200'],
    ['chat_max_len', '120'],
    ['leaderboard_size', '50'],
    ['chat_history_size', '50'],
    ['boss_daily_attempts', '1'],
    ['boss_hp_atk_mult', '20'],
    ['boss_strike_rounds', '10'],
    ['boss_respawn_sec', '86400'],
    ['boss_reward_stone', '30'],
    ['boss_reward_herb', '2'],
    // 副本 · 心魔镜像(攻倍率为百分比:60 = 最高攻×0.6)
    ['demon_daily_attempts', '1'],
    ['demon_hp_mult', '10'],
    ['demon_atk_mult', '60'],
    ['demon_reward_stone', '60'],
    ['demon_reward_herb', '4'],
    // 副本 · 秘境共探
    ['explore_daily_attempts', '1'],
    ['explore_nodes', '6'],
    ['explore_reward_stone', '40'],
    ['explore_reward_herb', '3'],
    // 副本 · 洞天守卫
    ['guard_daily_attempts', '1'],
    ['guard_max_waves', '9'],
    ['guard_reward_stone', '10'],
    ['guard_reward_herb', '1'],
    // 副本 · 共修大阵
    ['array_daily_attempts', '1'],
    ['array_reward_stone', '25'],
    ['array_reward_herb', '2'],
    ['email_enabled', env('EMAIL_ENABLED', 'false')],
    ['email_code_required', env('EMAIL_CODE_REQUIRED', 'false')],
    ['smtp_host', env('SMTP_HOST')],
    ['smtp_port', env('SMTP_PORT', '465')],
    ['smtp_user', env('SMTP_USER')],
    ['smtp_pass', env('SMTP_PASS')],
    ['smtp_from', env('SMTP_FROM')]
  ]
  if (DRIVER === 'sqlite') {
    for (const [k, v] of defaults) {
      await run('INSERT OR IGNORE INTO game_config (config_key, config_value, updated_at) VALUES (?, ?, ?)', [k, v, now])
    }
    return
  }
  for (const [k, v] of defaults) {
    await run('INSERT IGNORE INTO game_config (config_key, config_value, updated_at) VALUES (?, ?, ?)', [k, v, now])
  }
}
