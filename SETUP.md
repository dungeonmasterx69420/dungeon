# Dungeon · Setup Guide

## Files
- `server.js` — Express backend (API + static serving)
- `public/index.html` — The Gate (public request form)
- `public/admin.html` — Warden's Gate (admin dashboard)
- `Dockerfile` — for your Render Docker service

---

## Step 1 — Environment variables on Render

In your Render service dashboard, add these **Environment Variables**:

| Variable              | Value                                      |
|-----------------------|--------------------------------------------|
| `GMAIL_USER`          | `dungeonmasterx69420@gmail.com`            |
| `GMAIL_APP_PASSWORD`  | your Gmail app password (16-char, no spaces) |
| `ADMIN_PASSWORD`      | your chosen admin password                 |
| `SESSION_SECRET`      | any long random string (e.g. 32+ chars)    |
| `SITE_URL`            | your Render URL e.g. `https://dungeon.onrender.com` |
| `NODE_ENV`            | `production`                               |

---

## Step 2 — Persistent disk (keeps your database across deploys)

Render's Docker services support persistent disks:

1. Go to your service → **Disks** → **Add Disk**
2. Set **Mount Path** to `/data`
3. Size: 1 GB is plenty
4. Your SQLite database lives at `/data/streamhub.db` and survives deploys

---

## Step 3 — Gmail App Password

If you haven't already:

1. Go to **myaccount.google.com** → Security
2. Enable **2-Step Verification** (required)
3. Search for **App passwords** → create one for "Mail"
4. Copy the 16-character password into `GMAIL_APP_PASSWORD`

---

## Step 4 — Deploy

Push this folder to GitHub, then in Render:

1. **New** → **Web Service** → connect your repo
2. Set **Environment** to **Docker**
3. Add the environment variables from Step 1
4. Add the persistent disk from Step 2
5. Deploy

Your site will be live at `https://your-service.onrender.com`

---

## Usage

- **The Gate** (`/`) — share this URL with friends & family
- **Warden's Gate** (`/admin.html`) — your private dashboard; log in with `ADMIN_PASSWORD`
- Submissions are saved to SQLite and emailed to your Gmail
- Click **⚡ Grant Entry** on any petition to get step-by-step account setup instructions
- Mark as **Granted** when done
