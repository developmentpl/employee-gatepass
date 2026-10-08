/**
 * Optional: fills the database with demo employees, authorities, gate passes and punches
 * so you can try the app. Run once:  npm run seed:demo
 * All demo users have password  Demo@1234
 */
import './config.js';
import { initDb } from './db.js';
import { seedDemo } from './services/demoData.js';

await initDb();
await seedDemo();
console.log('Demo data ready. Demo users: <firstname.lastname>@harman.com / Demo@1234');
console.log('e.g. rahul.patil@harman.com (employee), priya.joshi@harman.com (authority), ravi.chavan@harman.com (security)');
process.exit(0);
