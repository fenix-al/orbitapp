# 🪐 Orbit — your personal daily digest

A single-page site that pulls interesting things from **RSS / newsletters, Reddit, and Hacker News**, tunes them to *your* interests (tech & AI, personal growth, social trends, business & money), and summarizes the day with **Claude** — plus a "Worth trying" section of experiments other people are running that actually work.

It refreshes itself **every morning** via a free GitHub Action. No server to run.

```
sources ──▶ build.mjs ──▶ data.json ──▶ index.html (static site)
  RSS          fetch          the         reads data.json,
  Reddit       score          only         renders the brief
  Hacker News  summarize      file          + feed + experiments
                 │
                 └─ Claude writes the brief
```

---

## Quick start (local)

```bash
npm install
npm run build      # generates data.json from your sources
npm run serve      # open http://localhost:4000
```

> Without an API key it still works — the brief falls back to a simple summary.
> For the Claude-written brief, set your key first:
> ```bash
> ANTHROPIC_API_KEY=sk-ant-... npm run build
> ```
> Get a key at https://console.anthropic.com → API Keys.

---

## Make it live & auto-updating (GitHub, free)

1. **Create a repo and push this folder.**
   ```bash
   git init
   git add .
   git commit -m "Orbit: initial digest"
   git branch -M main
   git remote add origin https://github.com/<you>/orbit.git
   git push -u origin main
   ```

2. **Add your Claude key as a secret.**
   Repo → **Settings → Secrets and variables → Actions → New repository secret**
   Name: `ANTHROPIC_API_KEY`  ·  Value: your `sk-ant-…` key.

3. **Turn on the daily job.**
   It's already defined in [`.github/workflows/daily.yml`](.github/workflows/daily.yml) (runs 05:00 UTC).
   Go to the **Actions** tab, enable workflows, and click **Run workflow** once to generate the first real `data.json`.

4. **Publish the page with GitHub Pages.**
   Repo → **Settings → Pages** → Source: **Deploy from a branch** → `main` / root.
   Your digest is now at `https://<you>.github.io/orbit/`.

That's it — every morning the Action fetches your sources, writes a fresh brief, commits `data.json` + `history.json`, and Pages serves the updated page.

> `history.json` keeps one entry per day (last 30). Once it has 2+ days, the trend lines in the stat tiles switch from sample data to your real history automatically.

---

## Tuning it — everything lives in [`config.mjs`](config.mjs)

| What | Where | Notes |
|------|-------|-------|
| RSS / newsletter feeds | `RSS_FEEDS` | Add any feed URL, tag it with a category. |
| Subreddits | `SUBREDDITS` | Public JSON, no key. |
| Hacker News threshold | `HACKERNEWS.minPoints` | Only keep stories above N points. |
| **Your interests** | `INTERESTS` | Keywords that make items rank higher. Make this yours. |
| Items kept per topic | `KEEP_PER_CATEGORY` | Default 3. |
| Brief quality/cost | `BRIEF_MODEL` | `claude-haiku-4-5-20251001` (cheap) · `claude-sonnet-5` (default) · `claude-opus-4-8` (best). |

Change the schedule by editing the `cron` line in the workflow (times are UTC).

---

## Roadmap — Phase 2 (social platforms)

`X / Instagram / TikTok` need paid or restricted APIs, so Phase 1 approximates "social trends" through subreddits, HN, and social-focused newsletters. When you're ready, Phase 2 wires in the official APIs (or a provider) behind the same `data.json` shape — the site won't need to change.

---

*Sample content ships in `data.json` so the page renders before your first build. It's replaced the moment the pipeline runs.*
