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
  created_at INTEGER NOT NULL,
  pass_changed_at INTEGER NOT NULL DEFAULT 0,
  -- 单设备登录:每次登录自增,旧 token 据此作废(挤下线)
  login_seq INTEGER NOT NULL DEFAULT 0,
  login_seq_at INTEGER NOT NULL DEFAULT 0,
  -- VIP 到期时间(毫秒时间戳,0 = 未开通);特权为客户端托管自动化,服务端只管发放与下发
  vip_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  started INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
-- 存档历史:每次覆盖前留一份旧档,换设备/误覆盖后可回滚
CREATE TABLE IF NOT EXISTS save_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  realm_index INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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
  def_m REAL NOT NULL,
  def_e INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  /** 已见最大世号:道果/天赋的乘数基线(1.58.1 起),只在存档上传时抬高 */
  rebirths INTEGER NOT NULL DEFAULT 0
);
-- 存档审计:落库前归一化改动过哪些分片 / 境界跳变。不拦存档,只留痕供 GM 判定
CREATE TABLE IF NOT EXISTS save_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  realm_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 掉落台账:行囊里每件装备的 uid 须由此签发(/api/loot/claim),上传存档时验源,非签发件移除
CREATE TABLE IF NOT EXISTS loot_ledger (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  src TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  -- 物件类别:equip(行囊装备)/ artifact(法宝,键为 defId)/ soul(器魂,键为 uid)
  kind TEXT NOT NULL DEFAULT 'equip',
  PRIMARY KEY (user_id, uid)
);
-- 坊市购买账(1.58.1):每笔成交记成本,上传存档时从「本窗口可增长量」里扣掉 ——
-- 扣款在客户端,不记账就等于可以白拿(货架本身按 (major, stockedAt) 确定性再生,物是真的)
CREATE TABLE IF NOT EXISTS market_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_m REAL NOT NULL,
  cost_e INTEGER NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 首次验源播种标记:存量档的旧件首传一次性入账,此后只认签发;删档重传不重播(否则删档→播种成作弊环)
CREATE TABLE IF NOT EXISTS loot_seed (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seeded_at INTEGER NOT NULL
);
-- 装备状态台账(1.58.3):强化/重铸/词条转移的唯一写入口是 POST /api/forge/op,
-- 签发后把该件的等级与词条记在此处;上传存档时以台账为准 —— 客户端自报的等级/词条不作数。
-- 只管「原地改件」的那几个字段(level/affixes/sealed/reforgeCount/transferCount/invested),
-- 模板/品质/阶数由签发时确定,不在这里重复保管。
CREATE TABLE IF NOT EXISTS equip_state (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, uid)
);
-- 首次登记标记:存量档的旧件首传一次性按当时的件入账(与 loot_seed 同思路,删档重传不重播)
CREATE TABLE IF NOT EXISTS equip_seed (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seeded_at INTEGER NOT NULL
);
-- 炼器支出账(1.58.3):强化/重铸/词条转移的料耗由服务端复算,但扣款写在客户端 ——
-- 与坊市同一套机制:上传时从「本窗口可增长量」里扣掉,扣不出来就压回付得起的位置
CREATE TABLE IF NOT EXISTS forge_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_dust REAL NOT NULL DEFAULT 0,
  cost_stone_m REAL NOT NULL DEFAULT 0,
  cost_stone_e INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 升级支出账(1.59.0):功法进修(悟道点/残页)与建筑升级(灵石/玄铁)的价目由服务端复算,
-- 扣款写在客户端 —— 与 forge_spend 同一套机制:上传时从「本窗口可增长量」里扣掉
CREATE TABLE IF NOT EXISTS progress_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_stone_m REAL NOT NULL DEFAULT 0,
  cost_stone_e INTEGER NOT NULL DEFAULT 0,
  cost_ore REAL NOT NULL DEFAULT 0,
  cost_wudao REAL NOT NULL DEFAULT 0,
  cost_page REAL NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 等级台账(1.59.1):功法进修与建筑升到几级以服务端为准(唯一写入口 POST /api/progress/op,
-- 签发后把新等级记在这里);上传时自报等级超台账的一律按台账压回 —— 拦「绕过接口直接改档」。
-- kind: 'gongfa' | 'building';item_id 为功法/建筑 id
CREATE TABLE IF NOT EXISTS level_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, kind, item_id)
);
-- 首次登记标记:存量档的等级首传一次性按当时的等级入账(与 equip_seed/loot_seed 同思路,删档重传不重播)
CREATE TABLE IF NOT EXISTS level_seed (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seeded_at INTEGER NOT NULL
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
  difficulty TEXT NOT NULL DEFAULT 'normal',
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
  dead_at INTEGER NOT NULL DEFAULT 0,
  -- 妖王成长:本周期击杀次数;period_start 为周期起点,过 reset 窗口归零
  kill_count INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS boss_damage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dmg_m REAL NOT NULL,
  dmg_e INTEGER NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 0,
  -- 该道友最后一次出剑所选难度:击杀分发时按它定各人的赏格
  difficulty TEXT NOT NULL DEFAULT 'normal',
  updated_at INTEGER NOT NULL
);
-- 击杀赏待领台账:妖王被推倒时按功分发,玩家上线领取(离线道友也不落空)
CREATE TABLE IF NOT EXISTS boss_loot (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stone_m REAL NOT NULL DEFAULT 0,
  stone_e INTEGER NOT NULL DEFAULT 0,
  herb INTEGER NOT NULL DEFAULT 0,
  -- 1 = 本轮装备抽中了我,领取时生成装备
  equip INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dungeon_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dungeon TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dungeon, day)
);
-- 秘境成长:每副本按个人本周期击杀数提升妖物强度,过周期清零
CREATE TABLE IF NOT EXISTS dungeon_growth (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dungeon TEXT NOT NULL,
  kill_count INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dungeon)
);
-- 周天七会:每人每日每会的进度;claimed=1 后不再累加(赏只发一次)
CREATE TABLE IF NOT EXISTS event_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  event_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, event_id)
);
-- 闲趣三则:每人每日每项一行;tries=已用次数,value=状态(签号/答谜结果),payload=垂钓篓
CREATE TABLE IF NOT EXISTS leisure_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '',
  claimed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, kind)
);
-- VIP 激活码:days=0 表示永久;一码一用
CREATE TABLE IF NOT EXISTS vip_codes (
  code TEXT PRIMARY KEY,
  days INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  used_by INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- VIP 支付订单(当面付):status = pending | paid | closed
CREATE TABLE IF NOT EXISTS vip_orders (
  out_trade_no TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  days INTEGER NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0
);
-- VIP 托管设置 + 离线讨伐所得台账(玩家下次上线领取)
CREATE TABLE IF NOT EXISTS autoops_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_boss INTEGER NOT NULL DEFAULT 0,
  auto_retreat INTEGER NOT NULL DEFAULT 0,
  auto_adventure INTEGER NOT NULL DEFAULT 0,
  region_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  -- 托管出剑所选难度(离线代打按它算赏格)
  boss_difficulty TEXT NOT NULL DEFAULT 'normal',
  ledger_stone_m REAL NOT NULL DEFAULT 0,
  ledger_stone_e INTEGER NOT NULL DEFAULT 0,
  ledger_herb INTEGER NOT NULL DEFAULT 0,
  ledger_strikes INTEGER NOT NULL DEFAULT 0,
  ledger_tier INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(id DESC);
CREATE INDEX IF NOT EXISTS idx_profile_rank ON profiles(realm_index DESC, power_e DESC, power_m DESC);
CREATE INDEX IF NOT EXISTS idx_save_history_user ON save_history(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_save_flags_user ON save_flags(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_loot_ledger_seed ON loot_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_equip_state_user ON equip_state(user_id, updated_at DESC);
`)
    // 老库迁移:补邮箱/角色/状态列(已存在则忽略)
    for (const stmt of [
      'ALTER TABLE users ADD COLUMN email TEXT',
      'ALTER TABLE users ADD COLUMN email_lower TEXT',
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'",
      "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
      'ALTER TABLE users ADD COLUMN pass_changed_at INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN login_seq INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN login_seq_at INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN vip_until INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE saves ADD COLUMN started INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE profiles ADD COLUMN def_m REAL NOT NULL DEFAULT 0',
      'ALTER TABLE profiles ADD COLUMN def_e INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE profiles ADD COLUMN rebirths INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE loot_ledger ADD COLUMN kind TEXT NOT NULL DEFAULT 'equip'",
      'ALTER TABLE boss_state ADD COLUMN kill_count INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE boss_state ADD COLUMN period_start INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE dungeon_teams ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'normal'",
      "ALTER TABLE boss_damage ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'normal'",
      "ALTER TABLE autoops_state ADD COLUMN boss_difficulty TEXT NOT NULL DEFAULT 'normal'"
    ]) {
      try {
        d.exec(stmt)
      } catch {
        /* 列已存在 */
      }
    }
    // 老库补列之后才能建邮箱索引
    d.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_lower)')
    // 老库 saves.started 回填(JSON.stringify 无空格,按子串判定)
    try {
      d.exec(`UPDATE saves SET started = 1 WHERE started = 0 AND data LIKE '%"started":true%'`)
    } catch {
      /* 空表或列刚加 */
    }
    await seedConfig()
    return
  }

  // MySQL:连接未开 multipleStatements,DDL 需逐条执行;按 ';' 切分(表定义内部无分号)
  const d = await mysqlPool()
  const ddl = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  username_lower VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(190) DEFAULT NULL,
  email_lower VARCHAR(190) DEFAULT NULL,
  pass_hash VARCHAR(128) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'player',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  pass_changed_at BIGINT NOT NULL DEFAULT 0,
  -- 单设备登录:每次登录自增,旧 token 据此作废(挤下线)
  login_seq BIGINT NOT NULL DEFAULT 0,
  login_seq_at BIGINT NOT NULL DEFAULT 0,
  -- VIP 到期时间(毫秒时间戳,0 = 未开通)
  vip_until BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS saves (
  user_id BIGINT PRIMARY KEY,
  version INT NOT NULL,
  data MEDIUMTEXT NOT NULL,
  started TINYINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_saves_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS save_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  version INT NOT NULL,
  data MEDIUMTEXT NOT NULL,
  realm_index INT NOT NULL DEFAULT 0,
  size INT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_save_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_save_history_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS save_flags (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  kind VARCHAR(24) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  realm_index INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_save_flags_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_save_flags_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS loot_ledger (
  user_id BIGINT NOT NULL,
  uid VARCHAR(64) NOT NULL,
  src VARCHAR(16) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'equip',
  PRIMARY KEY (user_id, uid),
  CONSTRAINT fk_loot_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS market_purchases (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  cost_m DOUBLE NOT NULL,
  cost_e INT NOT NULL,
  settled TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_market_purchases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS loot_seed (
  user_id BIGINT PRIMARY KEY,
  seeded_at BIGINT NOT NULL,
  CONSTRAINT fk_loot_seed_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS equip_state (
  user_id BIGINT NOT NULL,
  uid VARCHAR(64) NOT NULL,
  level INT NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, uid),
  CONSTRAINT fk_equip_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS equip_seed (
  user_id BIGINT PRIMARY KEY,
  seeded_at BIGINT NOT NULL,
  CONSTRAINT fk_equip_seed_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS forge_spend (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  cost_dust DOUBLE NOT NULL DEFAULT 0,
  cost_stone_m DOUBLE NOT NULL DEFAULT 0,
  cost_stone_e INT NOT NULL DEFAULT 0,
  settled TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_forge_spend_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS progress_spend (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  cost_stone_m DOUBLE NOT NULL DEFAULT 0,
  cost_stone_e INT NOT NULL DEFAULT 0,
  cost_ore DOUBLE NOT NULL DEFAULT 0,
  cost_wudao DOUBLE NOT NULL DEFAULT 0,
  cost_page DOUBLE NOT NULL DEFAULT 0,
  settled TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_progress_spend_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS level_state (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  level INT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uk_level_state (user_id, kind, item_id),
  CONSTRAINT fk_level_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS level_seed (
  user_id BIGINT PRIMARY KEY,
  seeded_at BIGINT NOT NULL,
  CONSTRAINT fk_level_seed_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  def_m DOUBLE NOT NULL,
  def_e INT NOT NULL,
  updated_at BIGINT NOT NULL,
  rebirths INT NOT NULL DEFAULT 0,
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
  difficulty VARCHAR(16) NOT NULL DEFAULT 'normal',
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
  dead_at BIGINT NOT NULL DEFAULT 0,
  kill_count INT NOT NULL DEFAULT 0,
  period_start BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS boss_damage (
  user_id BIGINT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  dmg_m DOUBLE NOT NULL,
  dmg_e INT NOT NULL,
  strikes INT NOT NULL DEFAULT 0,
  -- 该道友最后一次出剑所选难度:击杀分发时按它定各人的赏格
  difficulty VARCHAR(16) NOT NULL DEFAULT 'normal',
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_bossdmg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- 击杀赏待领台账:妖王被推倒时按功分发,玩家上线领取(离线道友也不落空)
CREATE TABLE IF NOT EXISTS boss_loot (
  user_id BIGINT PRIMARY KEY,
  stone_m DOUBLE NOT NULL DEFAULT 0,
  stone_e INT NOT NULL DEFAULT 0,
  herb INT NOT NULL DEFAULT 0,
  -- 1 = 本轮装备抽中了我,领取时生成装备
  equip TINYINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_bossloot_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dungeon_daily (
  user_id BIGINT NOT NULL,
  dungeon VARCHAR(32) NOT NULL,
  day CHAR(10) NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dungeon, day),
  CONSTRAINT fk_dungeon_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS dungeon_growth (
  user_id BIGINT NOT NULL,
  dungeon VARCHAR(32) NOT NULL,
  kill_count INT NOT NULL DEFAULT 0,
  period_start BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dungeon),
  CONSTRAINT fk_dgrowth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS event_progress (
  user_id BIGINT NOT NULL,
  day CHAR(10) NOT NULL,
  event_id VARCHAR(32) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  claimed TINYINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, day, event_id),
  CONSTRAINT fk_eventprog_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS leisure_log (
  user_id BIGINT NOT NULL,
  day CHAR(10) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  tries INT NOT NULL DEFAULT 0,
  value INT NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  claimed TINYINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, day, kind),
  CONSTRAINT fk_leisure_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS vip_codes (
  code VARCHAR(20) PRIMARY KEY,
  days INT NOT NULL,
  note VARCHAR(64) NOT NULL DEFAULT '',
  used_by BIGINT NOT NULL DEFAULT 0,
  used_at BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  INDEX idx_vip_code_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS vip_orders (
  out_trade_no VARCHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(16) NOT NULL,
  days INT NOT NULL,
  amount VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  paid_at BIGINT NOT NULL DEFAULT 0,
  INDEX idx_vip_order_user (user_id, created_at),
  CONSTRAINT fk_vip_order_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS autoops_state (
  user_id BIGINT PRIMARY KEY,
  auto_boss TINYINT NOT NULL DEFAULT 0,
  auto_retreat TINYINT NOT NULL DEFAULT 0,
  auto_adventure TINYINT NOT NULL DEFAULT 0,
  region_id VARCHAR(64) NOT NULL DEFAULT '',
  mode VARCHAR(16) NOT NULL DEFAULT '',
  -- 托管出剑所选难度(离线代打按它算赏格)
  boss_difficulty VARCHAR(16) NOT NULL DEFAULT 'normal',
  -- 离线托管讨伐所得台账(玩家下次上线领取):数量单位与出剑次数
  ledger_stone_m DOUBLE NOT NULL DEFAULT 0,
  ledger_stone_e INT NOT NULL DEFAULT 0,
  ledger_herb INT NOT NULL DEFAULT 0,
  ledger_strikes INT NOT NULL DEFAULT 0,
  ledger_tier INT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_autoops_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
` // CREATE INDEX 放后面单独跑(MySQL 无 IF NOT EXISTS,重复启动要容错)
  for (const stmt of ddl.split(';').map(s => s.trim()).filter(Boolean)) {
    await d.query(stmt)
  }
  // 老库迁移:补邮箱/角色/状态列(已存在则忽略),之后才能建邮箱索引
  for (const stmt of [
    'ALTER TABLE users ADD COLUMN email VARCHAR(190) DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN email_lower VARCHAR(190) DEFAULT NULL',
    "ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'player'",
    "ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'",
    'ALTER TABLE users ADD COLUMN pass_changed_at BIGINT NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN login_seq BIGINT NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN login_seq_at BIGINT NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN vip_until BIGINT NOT NULL DEFAULT 0',
    'ALTER TABLE saves ADD COLUMN started TINYINT NOT NULL DEFAULT 0',
    'ALTER TABLE profiles ADD COLUMN def_m DOUBLE NOT NULL DEFAULT 0',
    'ALTER TABLE profiles ADD COLUMN def_e INT NOT NULL DEFAULT 0',
    'ALTER TABLE profiles ADD COLUMN rebirths INT NOT NULL DEFAULT 0',
    "ALTER TABLE loot_ledger ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'equip'",
    'ALTER TABLE boss_state ADD COLUMN kill_count INT NOT NULL DEFAULT 0',
    'ALTER TABLE boss_state ADD COLUMN period_start BIGINT NOT NULL DEFAULT 0',
    "ALTER TABLE dungeon_teams ADD COLUMN difficulty VARCHAR(16) NOT NULL DEFAULT 'normal'",
    "ALTER TABLE boss_damage ADD COLUMN difficulty VARCHAR(16) NOT NULL DEFAULT 'normal'",
    "ALTER TABLE autoops_state ADD COLUMN boss_difficulty VARCHAR(16) NOT NULL DEFAULT 'normal'"
  ]) {
    try {
      await d.query(stmt)
    } catch {
      /* 列已存在 */
    }
  }
  try {
    await d.query('CREATE INDEX idx_users_email ON users(email_lower)')
  } catch {
    /* 索引已存在 */
  }
  // 老库 saves.started 回填(同 SQLite 判定)
  try {
    await d.query(`UPDATE saves SET started = 1 WHERE started = 0 AND data LIKE '%"started":true%'`)
  } catch {
    /* 空表或列刚加 */
  }

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
    ['chat_history_size', '200'],
    // 聊天留档天数:启动 + 每 6 小时清理更早的记录
    ['chat_retention_days', '7'],
    // 云存档自动上传间隔(秒);客户端登录时取一次
    ['save_push_interval_sec', '5'],
    // 云存档留档份数上限(每玩家;现行档之外的历史备份,钳 1~96)
    ['save_history_keep', '3'],
    // Turnstile 人机验证(注册/找回口令/发验证码);站点密钥公开给前端,私钥保密,二者齐全才生效
    ['turnstile_enabled', 'false'],
    ['turnstile_site_key', ''],
    ['turnstile_secret_key', ''],
    ['boss_daily_attempts', '1'],
    ['boss_hp_atk_mult', '20'],
    ['boss_strike_rounds', '10'],
    ['boss_respawn_sec', '86400'],
    ['boss_reward_stone', '30'],
    ['boss_reward_herb', '2'],
    // 妖王成长:每被击杀一次,下只血量/攻势按比例增强;击杀数每 N 天清零重来
    ['boss_growth_per_kill', '5'],
    ['boss_growth_reset_days', '30'],
    // 托管量力而行:1=能打/能补刀才出剑,打不过蓄势留剑;0=有次数就打
    ['boss_autoops_smart', 'true'],
    // 击杀赏:出剑不再发资粮,妖王被推倒时所有出过剑的道友均分;装备每杀掷一次(60% 中)
    ['boss_kill_equip_drop', '60'],
    // 副本 · 心魔镜像(血基数=最高攻×N×人数^0.8;atk 倍率为百分比:60 = 最高攻×0.6)
    ['demon_daily_attempts', '1'],
    ['demon_hp_base', '13'],
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
    // 副本 · 境界难度:房内平均大境界每高一层,妖物强度 +N%(战获 +M%),三档难度(循境/常探/绝境)另在上叠加
    ['dungeon_realm_power_pct', '4'],
    ['dungeon_realm_reward_pct', '2'],
    // 秘境成长:本周期每通杀一次,妖物强度 +N%(封顶 ×2);每 30 天重置,组队以房主为准
    ['dungeon_growth_power_pct', '2'],
    ['dungeon_growth_reset_days', '30'],
    // 副本 · 高难掉装备:绝境/炼狱获胜后的装备掉率(%)
    ['dungeon_equip_drop_peril', '25'],
    ['dungeon_equip_drop_abyss', '60'],
    // 周天七会:每日轮值活动总开关(false = 全站关停);活动定义与赏格在 server/src/eventCore.ts
    ['event_enabled', 'true'],
    // 闲趣三则(观星/垂钓/猜谜)总开关;定义与赏格在 server/src/leisureCore.ts
    ['leisure_enabled', 'true'],
    ['email_enabled', env('EMAIL_ENABLED', 'false')],
    ['email_code_required', env('EMAIL_CODE_REQUIRED', 'false')],
    ['smtp_host', env('SMTP_HOST')],
    ['smtp_port', env('SMTP_PORT', '465')],
    ['smtp_user', env('SMTP_USER')],
    ['smtp_pass', env('SMTP_PASS')],
    ['smtp_from', env('SMTP_FROM')],
    // 发件人显示名(收件人信箱里地址前那串字);留空只显示地址
    ['smtp_from_name', env('SMTP_FROM_NAME', '云隐修仙录')],
    // 支付宝当面付:开关 / 密钥 / VIP 各档定价(元)
    ['alipay_enabled', env('ALIPAY_ENABLED', 'false')],
    ['alipay_app_id', env('ALIPAY_APP_ID')],
    ['alipay_merchant_private_key', env('ALIPAY_MERCHANT_PRIVATE_KEY')],
    ['alipay_alipay_public_key', env('ALIPAY_ALIPAY_PUBLIC_KEY')],
    ['vip_price_month', '18'],
    ['vip_price_half', '50'],
    ['vip_price_year', '88'],
    ['vip_price_forever', '168']
  ]
  if (DRIVER === 'sqlite') {
    for (const [k, v] of defaults) {
      await run('INSERT OR IGNORE INTO game_config (config_key, config_value, updated_at) VALUES (?, ?, ?)', [k, v, now])
    }
  } else {
    for (const [k, v] of defaults) {
      await run('INSERT IGNORE INTO game_config (config_key, config_value, updated_at) VALUES (?, ?, ?)', [k, v, now])
    }
  }
  // 老库一次性升级:聊天历史条数仍是旧默认 50 时抬到 200(留存 7 天却只回 50 条,刷新像「记录丢了」)
  await run('UPDATE game_config SET config_value = ?, updated_at = ? WHERE config_key = ? AND config_value = ?', [
    '200',
    now,
    'chat_history_size',
    '50'
  ])
}
