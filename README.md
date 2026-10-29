# Harman Employee Gate Pass

Digital version of the paper **Employee Gate Pass** used at Harman International (India), Mahalunge plant.
An employee picks their shift and raises a gate pass → it goes to their **primary authority**; if nobody answers within 15 minutes
(adjustable) the **secondary** also sees it, then the **third** after another 15 minutes — whoever answers first decides it →
security checks the employee out and back in at the gate with the guard's name → if the employee does not come back in time they are
asked for a reason, which their authorities accept or reject. Attendance comes in from eSSL and Solus biometric machines.
Every user has a dashboard with charts (downloadable as PNG / Excel / PDF); admin and security also get a "Gate passes per person" table (this month / this year / dates, search, Excel).

```
Software/
├── server/   Node.js + Express API, MySQL, eSSL connector
└── client/   React (Vite) web app
```

---

## 1. What you need on the server PC

| Software | Version | Download |
|---|---|---|
| Node.js | 24 LTS (20.19 or newer works) | https://nodejs.org |
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

> **Want sample data to try it out?** Run `npm run seed:demo` once. It adds demo employees, shifts, authorities,
> two weeks of gate passes and punches. Password for all: `Demo@1234`
> * employee `rahul.patil@harman.com`, authority `priya.joshi@harman.com`
> * security admin `ravi.chavan@harman.com`
> * gate logins `GATE1` and `GATE2` (sign in with the login ID instead of an email)
>
> Don't run it on the live database.

**Updating an existing installation:** copy the new files over, then run `npm run setup`, `npm run build` and `npm start`.
New tables and columns are added to the existing database automatically at start; nothing is lost.

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

Admin → **Attendance (eSSL / Solus)** → eSSL tab shows punches and has three ways to get data in. Use any combination; duplicate punches are ignored.

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

### Solus (iSOLUS ATTENDANCE)

Admin → **Attendance (eSSL / Solus)** → Solus tab. Solus does not publish its machine protocol, so three ways are provided
(not yet tested against a real Solus system — confirm with Solus / IT which one applies):

* **Push URL (API)** – Solus or an integrator POSTs punches to `http://<server-IP>:5124/solus/punches` with the API key shown
  on the page in the `X-API-Key` header. Body: JSON `[{"employeeId":"10234","time":"2026-10-24 09:01:00","direction":"IN","device":"Main gate"}]` or CSV.
* **Read from the iSOLUS database** – SQL Server or MySQL. Enter server, database, user, password and a query that returns
  `code` and `time` columns (`{since}` = last punch already read). *Test query*, *Read now*, or read automatically every N minutes.
* **Import Solus export file** – CSV / Excel from the iSOLUS software.

Solus punches are matched by the user's *Solus User ID*, or the Employee ID if blank.

## 6. Email notifications (optional)

Admin → **Settings → Email notifications**. Enter the SMTP details of the mailbox the emails should come from, click
**Save and send test**, and check the inbox (and spam). Leave *SMTP server* blank to turn emails off. (The `SMTP_*` values in
`server\.env` still work; values saved on the Settings page take priority.)

| Mail provider | SMTP server | Port / encryption | Username | Password |
|---|---|---|---|---|
| Microsoft 365 / Outlook (company mail) | `smtp.office365.com` | 587 / STARTTLS | full email address | the mailbox password, or an app password if MFA is on. IT must allow *Authenticated SMTP* for the mailbox. |
| Gmail / Google Workspace | `smtp.gmail.com` | 587 / STARTTLS | full email address | a 16-letter **app password** (Google Account → Security → 2-Step Verification → App passwords) |
| Other (cPanel / hosting / company server) | from your provider, e.g. `mail.yourdomain.com` | 587 STARTTLS or 465 SSL | usually the full email address | the mailbox password |

Emails (and in-app bell notifications) go to: the authority when a request reaches them, the employee when it is approved,
rejected or cancelled automatically, the employee when an admin raises a pass for them, the employee when they have not
returned in time, and all their authorities when the reason is submitted.

## 7. Roles

| Role | Sees |
|---|---|
| Employee | Dashboard, Requests. **Approvals** appears automatically when someone has them as an authority. |
| Security (gate login) | A shared login per gate (e.g. `GATE1`). **Gate Desk**: the guard on duty types or picks their name, then checks employees out and back in. |
| Security admin | Like an employee, plus Gate Desk and **Security Setup** (add gate logins and security persons) and the plant dashboard. |
| Admin | Everything: Dashboard, User Access Management, Approvals (decide or send on to the next authority), Logs, Attendance, Settings, Security. |

**Settings (admin):** shifts with start/end times (employees pick one on every request; shown on the pass), minutes before a
request goes to the next authority (default 15), hours after which a request nobody answered is **cancelled automatically**
(default 8), minutes after the expected arrival before an employee is marked as not returned (default 60), and email.

**Raising a pass for someone else:** admins use *Raise for an employee* (on Approvals or Requests). The pass is in the
employee's name, goes to their authorities, shows "Raised by …", and the employee is notified.

**Duplicates:** Employee ID (login ID) and email must be unique across all users and gate logins. The user form flags a clash
while typing and will not save; a matching name only shows a warning. The default shift timings are examples — change them to the plant's real timings.

## 8. Bulk uploads

User Access Management → **Bulk upload → Download sample**. One file holds the employee details and their primary / secondary /
third authority (by Employee ID). After choosing a file you see a preview:
*New* rows are added, *Access update* rows (existing employee, new authorities) update the authorities, *Already exists* rows
change nothing, *Error* rows are skipped. An authority must already be a user or be a new row in the same file; otherwise the
row says to add them as a user first.

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
   `SEED_DEMO=true` adds the demo employees, gate logins `GATE1`/`GATE2`, shifts and two weeks of history to an empty
   database (password `Demo@1234`). Leave it out for an empty site.
   `SEED_DEMO=reset` (test sites only) clears all users except the admin, all gate passes, punches and logs, and loads the
   current demo data. It runs once per demo version, so later restarts and redeploys keep what testers add. Use it when the
   site still has older demo data.
4. Optional, so photos survive redeploys: **right-click the service → Attach Volume**, mount path `/data`.
5. **Settings → Networking → Generate Domain** (if asked for a port, enter `8080`). Send that `https://….up.railway.app` link to the client.

**Updating the test site:** run `railway up` again (or push to GitHub). The on-prem install is unaffected; update it as in section 2.
New tables and columns are added to the Railway database automatically when the new version starts.

**Email on Railway:** Railway allows outgoing SMTP only on its **Pro** plan; on Free, Trial and Hobby plans the test email on
Settings → Email fails with a timeout. In-app notifications (the bell) work on every plan.
