# ✈ Flight Tracker

Japanese-themed personal flight management app.  
Deployed on Netlify with built-in cloud save — **no Google account, no API keys, no setup**.

---

## Deploy to Netlify (5 minutes, no config needed)

### Option A — Drag and drop
1. Unzip this folder
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**
3. Drag the entire `flight-tracker` folder onto the page
4. Done ✓

### Option B — GitHub
1. Unzip and push to a new GitHub repo
2. In Netlify: **Add new site → Import from Git** → select your repo
3. Build settings are auto-detected from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Click Deploy ✓

**No environment variables needed.** Netlify Blobs works automatically on every deployed site.

---

## How cloud save works

Data is stored in **Netlify Blobs** — Netlify's own built-in key-value storage, free on all plans. There's nothing to configure; it activates automatically when the site is deployed.

| Button | What it does |
|---|---|
| **☁ Save to cloud** | Saves all flights to Netlify Blobs (persists across devices) |
| **↓ Load from cloud** | Loads the last cloud save |
| **↑ Export** | Downloads a local `.json` backup to your computer |
| **↑ Import** | Loads a `.json` file from your computer |
| **↺ Reset** | Restores the original 91 flights from the Excel file |

Data is also **auto-saved to localStorage** on every change, so you never lose work mid-session.

> **Note:** Netlify Blobs is scoped to your site — only you can access it.  
> Cloud save won't work on `localhost` without the Netlify CLI (see below).

---

## Project structure

```
flight-tracker/
  netlify/
    functions/
      store.js            ← serverless save/load using Netlify Blobs
  src/
    App.jsx               ← full React app
    initialFlights.json   ← seed data from your Excel (91 flights)
    main.jsx
  index.html
  vite.config.js
  netlify.toml
  package.json
  README.md
```

---

## Local development

```bash
npm install
npm run dev        # app runs at localhost:5173 (cloud save won't work)
```

To test cloud save locally:
```bash
npm install -g netlify-cli
netlify login
netlify link       # link to your deployed site
netlify dev        # runs at localhost:8888 with Blobs enabled
```
