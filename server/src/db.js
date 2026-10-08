import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import config from './config.js';

let pool;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    emp_code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(190) NOT NULL,
    phone VARCHAR(30) NULL,
    department VARCHAR(100) NULL,
    designation VARCHAR(100) NULL,
    shift VARCHAR(50) NULL,
    photo VARCHAR(255) NULL,
    role ENUM('user','admin','security') NOT NULL DEFAULT 'user',
    password_hash VARCHAR(255) NULL,
    must_change_password TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    essl_code VARCHAR(50) NULL,
    last_login DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_emp_code (emp_code),
    UNIQUE KEY uq_users_email (email),
    KEY ix_users_essl (essl_code),
    KEY ix_users_dept (department)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS authorities (
    user_id INT NOT NULL PRIMARY KEY,
    primary_id INT NOT NULL,
    secondary_id INT NULL,
    third_id INT NULL,
    updated_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_auth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_auth_p FOREIGN KEY (primary_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_auth_s FOREIGN KEY (secondary_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_auth_t FOREIGN KEY (third_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS gate_passes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pass_no VARCHAR(30) NULL,
    user_id INT NOT NULL,
    emp_code VARCHAR(50) NOT NULL,
    emp_name VARCHAR(150) NOT NULL,
    department VARCHAR(100) NULL,
    shift VARCHAR(50) NULL,
    pass_date DATE NOT NULL,
    reason_type VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    out_time TIME NOT NULL,
    coming_back TINYINT(1) NOT NULL DEFAULT 1,
    expected_in_time TIME NULL,
    status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
    decided_by INT NULL,
    decided_by_name VARCHAR(150) NULL,
    decided_level VARCHAR(20) NULL,
    decided_at DATETIME NULL,
    decision_remark VARCHAR(500) NULL,
    gate_status ENUM('not_left','out','returned') NOT NULL DEFAULT 'not_left',
    actual_out DATETIME NULL,
    actual_in DATETIME NULL,
    out_marked_by VARCHAR(150) NULL,
    in_marked_by VARCHAR(150) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pass_no (pass_no),
    KEY ix_pass_user (user_id),
    KEY ix_pass_status (status),
    KEY ix_pass_date (pass_date),
    CONSTRAINT fk_pass_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pass_approvers (
    pass_id INT NOT NULL,
    approver_id INT NOT NULL,
    level ENUM('primary','secondary','third') NOT NULL,
    PRIMARY KEY (pass_id, approver_id),
    KEY ix_pa_approver (approver_id),
    CONSTRAINT fk_pa_pass FOREIGN KEY (pass_id) REFERENCES gate_passes(id) ON DELETE CASCADE,
    CONSTRAINT fk_pa_user FOREIGN KEY (approver_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL,
    actor_id INT NULL,
    actor_name VARCHAR(150) NULL,
    actor_code VARCHAR(50) NULL,
    module VARCHAR(40) NOT NULL,
    action VARCHAR(60) NOT NULL,
    entity_id VARCHAR(60) NULL,
    description VARCHAR(1000) NULL,
    meta TEXT NULL,
    ip VARCHAR(64) NULL,
    KEY ix_logs_created (created_at),
    KEY ix_logs_module (module, action)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS attendance_punches (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    essl_code VARCHAR(50) NOT NULL,
    punch_time DATETIME NOT NULL,
    direction ENUM('in','out','unknown') NOT NULL DEFAULT 'unknown',
    verify_mode VARCHAR(20) NULL,
    device_sn VARCHAR(60) NULL,
    source ENUM('push','pull','usb','manual') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_punch (essl_code, punch_time),
    KEY ix_punch_time (punch_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS device_users (
    essl_code VARCHAR(50) NOT NULL PRIMARY KEY,
    name VARCHAR(150) NULL,
    card_no VARCHAR(50) NULL,
    privilege VARCHAR(10) NULL,
    device_sn VARCHAR(60) NULL,
    source VARCHAR(10) NOT NULL,
    last_seen DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(100) NOT NULL PRIMARY KEY,
    v TEXT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function initDb() {
  const { host, port, user, password, database } = config.db;
  const conn = await mysql.createConnection({ host, port, user, password });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 10,
    dateStrings: true,
    charset: 'utf8mb4',
  });

  // Keep MySQL's CURRENT_TIMESTAMP in the same zone as the app (TZ in .env)
  const off = -new Date().getTimezoneOffset();
  const tz = `${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  pool.pool.on('connection', (c) => c.query(`SET time_zone='${tz}'`));

  for (const sql of SCHEMA) await pool.query(sql);
  await seedAdmin();
}

async function seedAdmin() {
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM users WHERE role='admin' AND is_deleted=0`);
  if (rows[0].c > 0) return;
  const hash = await bcrypt.hash(config.admin.password, 10);
  await pool.query(
    `INSERT INTO users (emp_code, name, email, role, password_hash, must_change_password, department)
     VALUES (?,?,?,?,?,1,'Administration')
     ON DUPLICATE KEY UPDATE role='admin', is_active=1, is_deleted=0`,
    [config.admin.empCode, config.admin.name, config.admin.email, 'admin', hash]
  );
  console.log(`[setup] Admin created: ${config.admin.email} / ${config.admin.password} (change it after first login)`);
}

export async function q(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function one(sql, params) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const run = async (sql, params) => (await conn.query(sql, params))[0];
    const result = await fn(run, conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function getSetting(k, def = null) {
  const r = await one(`SELECT v FROM settings WHERE k=?`, [k]);
  return r ? r.v : def;
}

export async function setSetting(k, v) {
  await q(`INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)`, [k, v == null ? null : String(v)]);
}
