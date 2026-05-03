# StreamHub — Setup Guide

## What you got
- `index.html` — the public request form your friends & family will visit
- `admin.html` — your private admin dashboard (password protected)
- `SETUP.md` — this file

---

## Step 1: Set your admin password

Open `admin.html` and find this line near the bottom:

```js
const ADMIN_PASSWORD = 'admin123'; // Change this!
```

Change `admin123` to anything you want. This is what you'll type to get into the admin panel.

---

## Step 2: Set up EmailJS (free — sends form to your Gmail)

EmailJS lets the form email you without a backend server.

1. Go to **https://www.emailjs.com** and create a free account
2. Click **Add New Service** → choose **Gmail** → connect your Gmail account (`dungeonmasterx69420@gmail.com`)
3. Note your **Service ID** (looks like `service_xxxxxxx`)
4. Click **Email Templates** → **Create New Template**
5. Paste this as your template body:

```
New Stremio account request from {{from_name}}

Name:       {{first_name}} {{last_name}}
Email:      {{email}}
Phone:      {{phone}}
Language:   {{language}}
Referred by: {{referral}}
Notes:      {{notes}}
Submitted:  {{submitted_at}}
```

6. Save the template. Note your **Template ID** (looks like `template_xxxxxxx`)
7. Go to **Account** → copy your **Public Key**

Now open `index.html` and fill in these 3 lines:

```js
const EMAILJS_PUBLIC_KEY  = 'YOUR_PUBLIC_KEY';    // ← paste here
const EMAILJS_SERVICE_ID  = 'YOUR_SERVICE_ID';    // ← paste here
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';   // ← paste here
```

---

## Step 3: Deploy (host the site for free)

### Option A — Netlify (easiest, recommended)
1. Go to **https://netlify.com** → sign up free
2. Drag & drop your folder (containing `index.html` + `admin.html`) onto the Netlify deploy area
3. You get a URL like `https://your-site.netlify.app` instantly
4. Optionally set a custom domain

### Option B — GitHub Pages
1. Push the folder to a GitHub repo
2. Go to repo Settings → Pages → deploy from main branch
3. Your site will be at `https://yourusername.github.io/repo-name`

---

## How it works day-to-day

1. Share `index.html` URL with friends/family
2. They fill out the form → you get an email + it appears in your admin panel
3. Go to `admin.html` → log in → click **⚡ Setup account** on any pending request
4. Follow the in-panel steps to create their Stremio account & clone your addons
5. Click **✓ Mark as done**

---

## Admin panel password

Default: `admin123` — **change it** in `admin.html` before deploying!
