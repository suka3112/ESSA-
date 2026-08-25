# Hosting ESSA AP Automation (V2) for a client demo — Render (free)

The app runs as **one free web service** on Render: the Express API and the
built React portal are served from the same process, the demo dataset seeds
itself on start, and there is **no database to set up**.

Result: a public URL like `https://essa-ap-automation.onrender.com` that you
can send to the client.

Total time: ~15 minutes. Everything below is free.

---

## What was changed in the project (already done)

| File | Change |
|---|---|
| `server/src/serve.ts` | **Hosted entrypoint.** Boots like `index.ts`, then serves `web/dist` with an SPA fallback (so `/invoices/123` and browser refresh work). Kept in its own file so regenerating `app.ts`/`index.ts` cannot break hosting. |
| `package.json` | New script `start:hosted` → `node server/dist/serve.js` (this is what Render runs). |
| `render.yaml` | Render "Blueprint": free Node web service, Singapore region, build + start commands, health check on `/api/v1/health`. |
| `.nvmrc` | Pins Node 22 so Render builds with the same version. |

Local development is unchanged: `npm run dev` still runs the API on :4400 and
Vite on :5173/:3200.

---

## Step 1 — Push the code to GitHub

You need the project in a GitHub repository (Render deploys from GitHub).
A `.git` folder already exists in `essa-ap-automation` with one commit and
uncommitted changes, so:

1. Open **Terminal** and go to the project:
   ```bash
   cd "/Users/suka_3112/Documents/Avensys AI/ESSA/essa-v1-v2-update/Final New build/essa-ap-automation"
   ```
2. Commit everything (the latest UI/UX changes + the hosting changes):
   ```bash
   git add -A
   git commit -m "Hosting: single-service build for Render + latest UI/UX changes"
   ```
3. Create the GitHub repository (skip if `suka3112/ESSA-` already exists and is
   the one you want): go to https://github.com/new → name `ESSA-` (or any
   name) → **Private** → Create repository. Do **not** add a README.
4. Push. Either double-click **`push-v2-to-github.command`** (it asks for your
   GitHub token), or run:
   ```bash
   git remote add origin https://github.com/suka3112/ESSA-.git   # skip if it says "already exists"
   git branch -M main
   git push -u origin main
   ```
   GitHub will prompt for username + a **Personal Access Token** (not your
   password). Create one at https://github.com/settings/tokens → *Generate new
   token (classic)* → tick `repo` → copy it.

Check: https://github.com/suka3112/ESSA- shows `server/`, `web/`,
`render.yaml`, `package.json`.

> **Important**: `node_modules/`, `dist/` and `server/data/db.json` are in
> `.gitignore` and must **not** be pushed — Render builds and seeds them itself.

---

## Step 2 — Create the Render account and connect GitHub

1. Go to https://render.com → **Get Started** → sign up **with GitHub**
   (free, no credit card).
2. When asked, grant Render access to the `ESSA-` repository
   (*Only select repositories* is fine).

---

## Step 3 — Deploy with the Blueprint (one click)

1. In the Render dashboard click **New +** → **Blueprint**.
2. Select the `ESSA-` repository → **Connect**.
3. Render reads `render.yaml` and shows one service:
   `essa-ap-automation` · Web Service · Free. Click **Apply** / **Deploy Blueprint**.
4. Watch the build log. First build takes **3–5 minutes**
   (`npm install` → `tsc` for the server → `vite build` for the web).
   The log ends with:
   ```
   ESSA AP Automation API listening on :10000 (demo dataset seeded)
   ==> Your service is live 🎉
   ```
5. The public URL is shown at the top of the service page, e.g.
   **https://essa-ap-automation.onrender.com**

### If you prefer to click through instead of the Blueprint

**New +** → **Web Service** → pick the repo → set:

| Field | Value |
|---|---|
| Runtime | Node |
| Region | Singapore |
| Branch | main |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm run start:hosted` |
| Instance type | **Free** |
| Environment variables | `NODE_VERSION=22.12.0`, `NODE_ENV=production` |
| Health Check Path (Advanced) | `/api/v1/health` |

---

## Step 4 — Verify it is live

1. Open `https://<your-service>.onrender.com/api/v1/health` → you should see
   `{"status":"ok","service":"essa-ap-automation",...}`.
2. Open `https://<your-service>.onrender.com/` → the EAPA sign-in page appears,
   simulates the Microsoft Entra redirect and lands on the AP Processor
   dashboard (Putri Anggraini). Use *"Demo environment · continue as a specific
   persona"* to switch to Reviewer / Approver / Tax Reviewer / Manager / Admin.
3. Refresh on any inner page (e.g. `/vendors`) — it must reload correctly, not 404.

---

## Step 5 — Before the client demo (read this)

* **Free tier sleeps after 15 minutes without traffic.** The first request
  after that takes **30–60 seconds** to wake up. **Open the URL 2–3 minutes
  before the meeting starts** so it is warm. (Optional: a free uptime pinger
  such as https://uptimerobot.com hitting `/api/v1/health` every 5 minutes
  keeps it awake.)
* **Data resets on every restart/redeploy.** The demo dataset is re-seeded
  from code (37 invoices, 15 vendors, rules, DoA matrix…), so anything you
  upload or approve during a demo disappears after the service sleeps or
  redeploys. For a demo that is a feature — every client sees a clean dataset.
* **Updating the app**: commit + `git push` → Render redeploys automatically
  (`autoDeploy: true`). Takes ~3 minutes; the old version stays up until the
  new build passes the health check.
* **Custom domain (optional)**: Service → Settings → Custom Domains → add
  e.g. `essa-demo.aven-sys.com` and create the CNAME Render shows. HTTPS is
  automatic.
* **Privacy**: the URL is public but unlisted. If the client needs a gate,
  the simplest option is a shared password — ask and it can be added as a
  10-line Express middleware.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails with `tsc: not found` / `vite: not found` | Build command must include `--include=dev` (devDependencies hold the compilers). |
| Build fails on a TypeScript error | Run `npm run build` locally first; fix the reported file; push again. |
| Page shows `Cannot GET /` | Start Command on Render must be `npm run start:hosted` (Settings → Build & Deploy). `npm start` runs the API only. |
| `502` for the first minute | Normal cold start on the free tier — wait and refresh. |
| Health check failing | Path must be exactly `/api/v1/health`; the server must listen on `process.env.PORT` (it does). |
| Blank page, console shows 404 on `/assets/…` | Deploy is mid-restart; wait 30 s. If persistent, redeploy with *Clear build cache*. |

---

## Alternatives (if Render is not acceptable)

* **Railway** (https://railway.app): New Project → Deploy from GitHub → same
  build/start commands → Settings → Generate Domain. Free trial credit
  (~$5/month), then paid.
* **Azure App Service (Free F1)**: matches the client's Azure/Entra target
  architecture; more clicks (App Service → Node 22 → Deployment Center →
  GitHub → set `SCM_DO_BUILD_DURING_DEPLOYMENT=true`, startup command
  `npm start`). Useful later for UAT, overkill for a demo.
* **Fly.io / Koyeb**: similar to Render; Koyeb has a permanent free tier with
  no sleep, if the wake-up delay is a concern.
