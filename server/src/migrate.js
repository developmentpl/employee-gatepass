/**
 * Upgrades an existing Gate Pass database in place. Every step checks first, so it is safe
 * to run at every start; existing data is kept.
 */

const NEW_TABLES = [
  `CREATE TABLE IF NOT EXISTS shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_shift_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body VARCHAR(1000) NULL,
    pass_id INT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    KEY ix_notif_user (user_id, is_read, id),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS security_persons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_secperson_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const DEFAULT_SHIFTS = [
  ['General', '09:00', '17:30'],
  ['A', '06:00', '14:00'],
  ['B', '14:00', '22:00'],
  ['C', '22:00', '06:00'],
];

export async function migrate(pool, database) {
  const run = async (sql, params) => (await pool.query(sql, params))[0];
  const col = async (table, column) =>
    (await run(
      `SELECT COLUMN_TYPE t, IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [database, table, column]
    ))[0] || null;
  const addCol = async (table, column, def) => {
    if (!(await col(table, column))) {
      await run(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
      return true;
    }
    return false;
  };
  const hasIndex = async (table, name) =>
    (await run(`SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`, [database, table, name])).length > 0;

  for (const sql of NEW_TABLES) await run(sql);

  // users: email optional (security login IDs have none), new role, Solus ID
  if ((await col('users', 'email'))?.n === 'NO') await run(`ALTER TABLE users MODIFY email VARCHAR(190) NULL`);
  if (!(await col('users', 'role')).t.includes('security_admin'))
    await run(`ALTER TABLE users MODIFY role ENUM('user','admin','security','security_admin') NOT NULL DEFAULT 'user'`);
  await addCol('users', 'solus_code', 'VARCHAR(50) NULL');

  // gate passes: shift timing, staged approvals, security names, not-returned flow
  await addCol('gate_passes', 'shift_start', 'TIME NULL');
  await addCol('gate_passes', 'shift_end', 'TIME NULL');
  await addCol('gate_passes', 'escalated_seq', 'TINYINT NOT NULL DEFAULT 0');
  await addCol('gate_passes', 'out_security_login', 'VARCHAR(150) NULL');
  await addCol('gate_passes', 'in_security_login', 'VARCHAR(150) NULL');
  await addCol('gate_passes', 'nr_status', 'VARCHAR(20) NULL');
  await addCol('gate_passes', 'nr_notified_at', 'DATETIME NULL');
  await addCol('gate_passes', 'nr_reason', 'VARCHAR(500) NULL');
  await addCol('gate_passes', 'nr_reason_at', 'DATETIME NULL');
  await addCol('gate_passes', 'nr_decided_by', 'INT NULL');
  await addCol('gate_passes', 'nr_decided_by_name', 'VARCHAR(150) NULL');
  await addCol('gate_passes', 'nr_decided_at', 'DATETIME NULL');
  await addCol('gate_passes', 'nr_remark', 'VARCHAR(500) NULL');
  await addCol('gate_passes', 'raised_by_id', 'INT NULL');
  await addCol('gate_passes', 'raised_by_name', 'VARCHAR(150) NULL');
  if (!(await col('gate_passes', 'gate_status')).t.includes('not_returned'))
    await run(`ALTER TABLE gate_passes MODIFY gate_status ENUM('not_left','out','returned','not_returned') NOT NULL DEFAULT 'not_left'`);

  // pass approvers: order of escalation + when each was told
  if (await addCol('pass_approvers', 'seq', 'TINYINT NOT NULL DEFAULT 0'))
    await run(`UPDATE pass_approvers SET seq = FIELD(level,'primary','secondary','third') - 1`);
  if (await addCol('pass_approvers', 'notified_at', 'DATETIME NULL'))
    await run(`UPDATE pass_approvers SET notified_at = NOW()`); // older requests were already sent to everyone

  // attendance: Solus as a second vendor
  await addCol('attendance_punches', 'vendor', `VARCHAR(10) NOT NULL DEFAULT 'essl'`);
  if ((await col('attendance_punches', 'source')).t.startsWith('enum'))
    await run(`ALTER TABLE attendance_punches MODIFY source VARCHAR(20) NOT NULL`);
  if (!(await hasIndex('users', 'ix_users_solus'))) await run(`ALTER TABLE users ADD KEY ix_users_solus (solus_code)`);

  // shifts: seed defaults plus any shift names already used by employees
  const count = (await run(`SELECT COUNT(*) c FROM shifts`))[0].c;
  if (count === 0) {
    let order = 0;
    for (const [name, s, e] of DEFAULT_SHIFTS) await run(`INSERT IGNORE INTO shifts (name, start_time, end_time, sort_order) VALUES (?,?,?,?)`, [name, s, e, order++]);
    const used = await run(`SELECT DISTINCT shift FROM users WHERE shift IS NOT NULL AND shift<>''`);
    for (const u of used) await run(`INSERT IGNORE INTO shifts (name, sort_order) VALUES (?,?)`, [u.shift, order++]);
  }
}
