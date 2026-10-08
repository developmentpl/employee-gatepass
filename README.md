# Harman Employee Gate Pass

Digital version of the paper **Employee Gate Pass** used at Harman International (India), Mahalunge plant.
An employee raises a gate pass → it goes to their assigned authorities → the **first authority to approve or reject decides it** → security marks the employee out/in at the gate. Attendance comes in from the eSSL biometric machines.

```
Software/
├── server/   Node.js + Express API, MySQL, eSSL connector
└── client/   React (Vite) web app
```

---

## 1. What you need on the server PC

| Software | Version | Download |
|---|---|---|
| Node.js | 20 or newer (LTS) | https://nodejs.org |
| MySQL Server | 8.x (MariaDB 10.6+ also works) | https://dev.mysql.com/downloads/installer/ |

The database and all tables are created automatically on first start — you only need a MySQL user.

## 2. First-time setup (Windows)

Open **Command Prompt** in the `Software` folder:

```bat
:: 1. install libraries for both parts
npm run setup

:: 2. create the config file and edit it
copy server\.env.example server\.env
notepad server\.env
```

In `server\.env` set at least:

* `DB_USER` / `DB_PASSWORD` – your MySQL login
* `APP_PORT` (web app employees open, default 5123) and `API_PORT` (backend API + eSSL machines, default 5124).
  Both start together with `npm start`; the web app passes its API calls to the backend internally.
* `JWT_SECRET` – any long random text
* `ADMIN_EMAIL` / `ADMIN_PASSWORD` – the first admin account (created automatically)
* `DEFAULT_USER_PASSWORD` – temporary password for users added by admin / bulk upload

```bat
:: 3. build the web app
npm run build

:: 4. start
npm start
```

Open **http://localhost:5123** and sign in with the admin email/password from `.env`. You will be asked to set a new password.

> **Want sample data to try it out?** Run `npm run seed:demo` once. It adds 11 demo employees
> (password `Demo@1234`, e.g. `rahul.patil@harman.com`, `priya.joshi@harman.com`, `ravi.chavan@harman.com`), authorities,
> gate passes and punches. Don't run it on the live database.

### Keep it running as a Windows service

```bat
npm install -g pm2 pm2-windows-startup
pm2-startup install
pm2 start server\src\index.js --name gatepass
pm2 save
```

### Developing / changing the UI

Run the API and the UI in two terminals:

```bat
cd server && npm run dev
cd client && npm run dev      :: opens http://localhost:5173 with live reload (talks to the backend on 5124)
```

## 3. Using HTTPS (needed for webcam and Microsoft login on the network)

Browsers only allow the **webcam** and **Microsoft sign-in** on `https://` addresses (or `http://localhost`).
On the plant network, put the app behind HTTPS, e.g. with IIS (URL Rewrite + ARR reverse proxy to `http://localhost:5123`)
or nginx, using a certificate from IT. Everything else works over plain http.

## 4. Microsoft (Office 365) sign-in

Users can sign in with **email + password** or **Sign in with Microsoft**. Microsoft sign-in only works for emails already
added in User Management (no self-registration).

IT needs to do this once in **Azure Portal → Microsoft Entra ID → App registrations → New registration**:

1. Name: `Gate Pass`. Supported account types: *this organization only*.
2. Redirect URI → platform **Single-page application (SPA)** → the app address, e.g. `https://gatepass.harman.local`.
3. Copy **Directory (tenant) ID** and **Application (client) ID** into `server\.env`:
   ```
   MS_TENANT_ID=xxxxxxxx-....
   MS_CLIENT_ID=xxxxxxxx-....
   ```
4. Restart the app. The "Sign in with Microsoft" button appears on the login page.

## 5. eSSL attendance

Admin → **Attendance (eSSL)** shows punches and has three ways to get data in. Use any combination; duplicate punches are ignored.

**a) Real-time push (recommended).** On each eSSL machine: *Menu → Comm. → Cloud Server Setting (ADMS)*
→ Server address = IP of the server PC, Server port = `5124` (API_PORT in `.env`), HTTPS off. Punches arrive within seconds.
The device appears under "Devices seen". Optionally list allowed serial numbers to ignore other machines.
Allow the port through Windows Firewall: `netsh advfirewall firewall add rule name="GatePass" dir=in action=allow protocol=TCP localport=5123,5124` (5123 = web app for employees, 5124 = backend + eSSL machines)

**b) Network pull.** Enter the machine's IP (port 4370) and click *Pull now*, or tick *Pull automatically every N minutes*.
Uses the same protocol as eTimeTrackLite. (Two programs pulling the same machine at the same moment can collide — stagger them.)

**c) USB pen drive.** On the machine: *Menu → USB Manager / Data Mgt. → Download → Attendance Data*. Plug the pen drive
into the PC and upload the `…attlog.dat` file. CSV/Excel attendance exports from eTimeTrackLite also work.

**Users on the machine.** With push, the machine sends its user list automatically when it connects (or click *Ask machine*).
With network pull, click *Read via network*. Then *Download for bulk upload*, fill in emails, and upload it in User Management → Bulk upload.

**Not connecting?** The server window prints a line `[eSSL] … from <ip> SN=…` for every request a machine makes. If nothing appears:
the address must go in *Cloud Server Setting* (not Comm → Ethernet, which is the machine's own IP); the machine and PC must be on the
same network (e.g. both `192.168.0.x`); open the firewall port (command above); and check `http://<PC-IP>:5124/api/health` from a phone.

**Matching punches to employees:** the device user ID is matched to the user's *eSSL User ID*, or to the Employee ID if that's blank.
Unmatched IDs are listed after an import.

## 6. Email notifications (optional)

Fill the `SMTP_*` settings in `.env` (e.g. Office 365: `smtp.office365.com`, port 587). Authorities get an email when a
request is raised; the employee gets one when it's approved or rejected. Leave `SMTP_HOST` blank to turn emails off.

## 7. Roles

| Role | Sees |
|---|---|
| Employee | Requests (raise + track). **Approvals** tab appears automatically when someone has them as an authority. |
| Security | Requests + **Gate Desk** (today's approved passes, Mark Out / Mark In). |
| Admin | Everything: User Management, Access Management, Approvals (can decide on behalf of authorities), Logs, Attendance. |

## 8. Bulk uploads

User Management and Access Management each have **Bulk upload → Download sample**. After choosing a file you see a preview:
*New* rows are imported, *Duplicate* rows (same Employee ID or email already in the system, or repeated in the file) and *Error* rows are skipped.

## 9. Backups

Back up the MySQL database (`mysqldump harman_gatepass > backup.sql`) and the `server\uploads` folder (employee photos).

## 10. Online test site on Railway

The same code runs on [Railway](https://railway.com) for client testing. Nothing changes on the on-prem server:
hosted mode switches on **only** when Railway's own variables are present.

| | On-prem (local PC / plant server) | Railway test site |
|---|---|---|
| Ports | 5123 web app, 5124 backend + eSSL | One public HTTPS address (Railway's `PORT`, default 8080) |
| Database | MySQL from `DB_*` in `server/.env` | Railway MySQL via `MYSQL_URL` |
| Photos | `server/uploads/photos` | Railway volume (if attached), else lost on each redeploy |
| eSSL | Push / pull / USB | USB import only (plant machines can't reach the cloud) |
| HTTPS | Add IIS / nginx | Built in, so webcam and Microsoft sign-in work |

Railway reads `railway.json` (build with `npm run railway:build`, start with `npm start`, health check `/api/health`)
and uses Node 24 (`engines` in `package.json`).

**One-time setup**

1. In Railway: **New Project → Database → MySQL**.
2. Add the app to the same project, either:
   - **CLI (no GitHub needed):** in the `Software` folder run `npm i -g @railway/cli`, `railway login`, `railway link` (pick the project), then `railway up`.
     Files listed in `.gitignore` (`node_modules`, `server\.env`, photos) are not uploaded.
   - **GitHub:** push the `Software` folder to a private repo, then **New → GitHub Repo**.
3. On the app service → **Variables**, add:
   ```
   MYSQL_URL=${{MySQL.MYSQL_URL}}
   JWT_SECRET=<any long random text>
   ADMIN_EMAIL=admin@harman.com
   ADMIN_PASSWORD=<temporary admin password>
   SEED_DEMO=true
   ```
   `SEED_DEMO=true` adds the 11 demo employees once (password `Demo@1234`). Leave it out for an empty site.
4. Optional, so photos survive redeploys: **right-click the service → Attach Volume**, mount path `/data`.
5. **Settings → Networking → Generate Domain** (if asked for a port, enter `8080`). Send that `https://….up.railway.app` link to the client.

**Updating the test site:** run `railway up` again (or push to GitHub). The on-prem install is unaffected; update it as in section 2.
