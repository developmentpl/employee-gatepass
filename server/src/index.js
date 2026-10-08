import config from './config.js';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { initDb } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { UPLOAD_DIR } from './services/photos.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import authorityRoutes from './routes/authorities.js';
import passRoutes from './routes/passes.js';
import logRoutes from './routes/logs.js';
import metaRoutes from './routes/meta.js';
import attendanceRoutes from './routes/attendance.js';
import admsRoutes from './essl/adms.js';
import { startScheduler } from './essl/scheduler.js';
import { seedDemo, hasDemoData } from './services/demoData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* =====================================================================
 * Backend  (API_PORT, default 5124): REST API + photos + eSSL machines
 * ===================================================================== */
const api = express();
api.set('trust proxy', true);
api.disable('x-powered-by');

// eSSL devices push here (must stay at /iclock and come before the JSON parser)
api.use('/iclock', admsRoutes);

api.use(express.json({ limit: '15mb' }));
api.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

api.use('/api/auth', authRoutes);
api.use('/api/meta', requireAuth, metaRoutes);
api.use('/api/users', requireAuth, userRoutes);
api.use('/api/authorities', requireAuth, authorityRoutes);
api.use('/api/passes', requireAuth, passRoutes);
api.use('/api/logs', requireAuth, logRoutes);
api.use('/api/attendance', requireAuth, attendanceRoutes);
api.get('/api/health', (_req, res) => res.json({ ok: true, service: 'backend' }));
api.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const dist = path.resolve(__dirname, '../../client/dist');
function serveWebApp(target) {
  if (fs.existsSync(dist)) {
    target.use(express.static(dist, { index: false }));
    target.get('/{*any}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    target.use((_req, res) =>
      res.status(503).type('text/plain').send('The web app is not built yet. Run "npm run build" in the Software folder, then restart.')
    );
  }
}

if (config.hosted) {
  // Hosted (Railway): one public port carries the web app too
  serveWebApp(api);
} else {
  api.use((_req, res) => res.status(404).type('text/plain').send('Gate Pass backend. Open the web app on port ' + config.appPort));
}

// eslint-disable-next-line no-unused-vars
api.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on the server' : err.message, ...(err.extra || {}) });
});

/* =====================================================================
 * Web app  (APP_PORT, default 5123): the React UI. Its /api and /uploads
 * calls are passed through to the backend, so browsers only use this port.
 * ===================================================================== */
const app = express();
app.disable('x-powered-by');

function forwardToBackend(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${config.apiPort}` };
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${ip}` : ip;
  const upstream = http.request(
    { host: '127.0.0.1', port: config.apiPort, method: req.method, path: req.originalUrl, headers },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'Backend is not reachable' });
  });
  req.pipe(upstream);
}
app.use(['/api', '/uploads'], forwardToBackend);

serveWebApp(app);

/* ===================================================================== */

const listen = (server, port, label) =>
  new Promise((resolve, reject) => {
    server
      .listen(port, '0.0.0.0', () => {
        console.log(label);
        resolve();
      })
      .on('error', (e) => {
        console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use (is the app already running?)` : `Could not open port ${port}: ${e.message}`);
        reject(e);
      });
  });

initDb()
  .then(async () => {
    if (config.seedDemo && !(await hasDemoData())) {
      await seedDemo();
      console.log('[setup] Demo data added (SEED_DEMO=true). Demo users sign in with password Demo@1234');
    }
    if (config.hosted) {
      if (config.jwtSecret === 'change-me-to-a-long-random-string') console.warn('[warning] JWT_SECRET is not set - set it in the Railway variables');
      await listen(api, config.publicPort, `Hosted mode: web app + API + eSSL on port ${config.publicPort}${config.appUrl.startsWith('https') ? `  (${config.appUrl})` : ''}`);
    } else {
      await listen(api, config.apiPort, `Backend API + eSSL running on port ${config.apiPort}  (eSSL machines: Server port = ${config.apiPort})`);
      await listen(app, config.appPort, `Web app running on http://localhost:${config.appPort}`);
    }
    startScheduler();
  })
  .catch((e) => {
    if (e.code === 'EADDRINUSE' || e.syscall === 'listen') process.exit(1);
    console.error('Could not start: database connection failed →', e.message);
    console.error('Check DB_HOST / DB_USER / DB_PASSWORD in server/.env');
    process.exit(1);
  });
