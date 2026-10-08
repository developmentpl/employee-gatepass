import 'dotenv/config';

process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const env = process.env;

/**
 * Hosted (cloud) mode — used for the Railway test site.
 * Turned on automatically when Railway's own variables are present, or by SINGLE_PORT=true.
 * On the on-prem server none of these are set, so the app runs exactly as before
 * (web app on APP_PORT 5123, backend + eSSL on API_PORT 5124, MySQL from DB_* settings).
 */
const hosted = !!(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_SERVICE_ID || env.SINGLE_PORT === 'true');

// Database: DB_* always wins. In hosted mode only, fall back to Railway's MySQL variables.
function parseDbUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    return {
      host: x.hostname,
      port: x.port,
      user: decodeURIComponent(x.username),
      password: decodeURIComponent(x.password),
      database: x.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}
const urlDb = parseDbUrl(env.DB_URL || (hosted ? env.MYSQL_URL || env.DATABASE_URL : ''));
const pick = (own, fromUrl, railway, def) => own || fromUrl || (hosted ? railway : '') || def;

const publicDomain = env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '';

const config = {
  hosted,
  // Hosted mode: everything (web app, API, eSSL) on the single port the platform gives us
  publicPort: Number(env.PORT || 8080),
  // Web app employees open in the browser
  appPort: Number(env.APP_PORT || 5123),
  // Backend API + eSSL machine communication
  apiPort: Number(env.API_PORT || 5124),
  jwtSecret: env.JWT_SECRET || 'change-me-to-a-long-random-string',
  jwtExpires: env.JWT_EXPIRES || '12h',
  db: {
    host: pick(env.DB_HOST, urlDb?.host, env.MYSQLHOST, 'localhost'),
    port: Number(pick(env.DB_PORT, urlDb?.port, env.MYSQLPORT, 3306)),
    user: pick(env.DB_USER, urlDb?.user, env.MYSQLUSER, 'root'),
    password: pick(env.DB_PASSWORD, urlDb?.password, env.MYSQLPASSWORD, ''),
    database: pick(env.DB_NAME, urlDb?.database, env.MYSQLDATABASE, 'harman_gatepass'),
  },
  // Where employee photos are stored. Hosted: a Railway volume if one is attached.
  uploadDir: env.UPLOAD_DIR || (hosted && env.RAILWAY_VOLUME_MOUNT_PATH ? `${env.RAILWAY_VOLUME_MOUNT_PATH}/uploads` : ''),
  // Fill the database with demo employees on first start (test site only)
  seedDemo: env.SEED_DEMO === 'true',
  admin: {
    email: (env.ADMIN_EMAIL || 'admin@harman.com').toLowerCase(),
    password: env.ADMIN_PASSWORD || 'Admin@123',
    name: env.ADMIN_NAME || 'System Administrator',
    empCode: env.ADMIN_EMP_CODE || 'ADMIN001',
  },
  defaultUserPassword: env.DEFAULT_USER_PASSWORD || 'Harman@123',
  microsoft: {
    tenantId: env.MS_TENANT_ID || '',
    clientId: env.MS_CLIENT_ID || '',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || 'false') === 'true',
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    from: env.SMTP_FROM || 'Gate Pass <gatepass@localhost>',
  },
  appUrl: env.APP_URL || (hosted && publicDomain) || `http://localhost:${env.APP_PORT || 5123}`,
};

export default config;
