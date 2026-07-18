// ─────────────────────────────────────────────────────────────
//  Orbit build pipeline
//  1. fetch RSS + Reddit + Hacker News
//  2. score each item against your interests, keep the best per category
//  3. ask Claude to write the daily brief + "worth trying" experiments
//  4. write data.json  (the site reads this file)
//
//  Run:  ANTHROPIC_API_KEY=sk-... npm run build
//  Works without a key too — it falls back to a heuristic brief.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIES, RSS_FEEDS, SUBREDDITS, HACKERNEWS, INTERESTS,
  KEEP_PER_CATEGORY, BRIEF_MODEL, LANGUAGE,
} from "./config.mjs";

// Reddit blocks generic User-Agents; a unique descriptive one is required.
const UA = "web:orbit-digest:1.0 (personal daily digest bot)";
const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": UA },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

// ── small helpers ────────────────────────────────────────────
const log = (...a) => console.log("·", ...a);
const clean = (s) => (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => (t = setTimeout(() => rej(new Error("timeout " + label)), ms)));
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

// Pull a real photo out of an RSS item: enclosure → media:content →
// media:thumbnail → first <img> in the HTML content.
function imageOf(it) {
  try {
    const enc = it.enclosure;
    if (enc?.url && /(image|jpe?g|png|webp|gif)/i.test((enc.type || "") + enc.url)) return enc.url;
    for (const m of [].concat(it.mediaContent || [])) {
      const u = m?.$?.url;
      if (u && !/\.(mp3|mp4|m4a)(\?|$)/i.test(u)) return u;
    }
    for (const m of [].concat(it.mediaThumbnail || [])) {
      const u = m?.$?.url;
      if (u) return u;
    }
    const html = it.contentEncoded || it.content || "";
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    if (m && /^https?:/.test(m[1])) return m[1];
  } catch { /* image is a nice-to-have */ }
  return null;
}

function scoreOf(text) {
  const t = text.toLowerCase();
  let s = 0;
  for (const kw of INTERESTS) if (t.includes(kw)) s += 1;
  return s;
}

function initials(src) {
  return src.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
}

// ── fetchers ─────────────────────────────────────────────────
async function fetchRSS() {
  const out = [];
  await Promise.all(RSS_FEEDS.map(async (feed) => {
    try {
      const parsed = await withTimeout(parser.parseURL(feed.url), 16000, feed.src);
      for (const it of (parsed.items || []).slice(0, 12)) {
        out.push({
          cat: feed.cat,
          title: clean(it.title),
          body: trim(clean(it.contentSnippet || it.content || it.summary || ""), 180),
          url: it.link || "",
          src: feed.src,
          publishedAt: it.isoDate || it.pubDate || null,
          image: imageOf(it),
        });
      }
      log(`RSS ${feed.src}: ${(parsed.items || []).length} items`);
    } catch (e) { log(`RSS ${feed.src} failed: ${e.message}`); }
  }));
  return out;
}

async function fetchOneSubreddit({ cat, sub }) {
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  // Try the JSON API first…
  try {
    const r = await withTimeout(
      fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=10`, { headers }),
      15000, "r/" + sub);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const items = (j.data?.children || []).filter((c) => !c.data.stickied).map((c) => {
      const d = c.data;
      const preview = d.preview?.images?.[0]?.source?.url;
      return {
        cat,
        title: clean(d.title),
        body: trim(clean(d.selftext || ""), 180),
        url: "https://reddit.com" + d.permalink,
        src: "r/" + sub,
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        boost: Math.min(3, Math.floor((d.ups || 0) / 400)),
        image: preview ? preview.replace(/&amp;/g, "&")
          : (/^https?:/.test(d.thumbnail || "") ? d.thumbnail : null),
      };
    });
    log(`Reddit r/${sub}: ${items.length} items`);
    return items;
  } catch (e1) {
    // …then fall back to the RSS endpoint, which is blocked less often.
    try {
      const parsed = await withTimeout(
        parser.parseURL(`https://www.reddit.com/r/${sub}/top/.rss?t=day`), 15000, "r/" + sub + " rss");
      const items = (parsed.items || []).slice(0, 10).map((it) => ({
        cat,
        title: clean(it.title),
        body: "",
        url: it.link || "",
        src: "r/" + sub,
        publishedAt: it.isoDate || it.pubDate || null,
        image: imageOf(it),
      }));
      log(`Reddit r/${sub}: ${items.length} items (rss fallback)`);
      return items;
    } catch (e2) {
      log(`Reddit r/${sub} failed: ${e1.message} / rss: ${e2.message}`);
      return [];
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchReddit() {
  // Sequential with a delay — Reddit rate-limits bursts with 429.
  const out = [];
  for (const s of SUBREDDITS) {
    out.push(...await fetchOneSubreddit(s));
    await sleep(3000);
  }
  return out;
}

async function fetchHN() {
  if (!HACKERNEWS.enabled) return [];
  try {
    const r = await withTimeout(
      fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30", { headers: { "User-Agent": UA } }),
      15000, "HN");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const out = [];
    for (const h of (j.hits || [])) {
      if ((h.points || 0) < HACKERNEWS.minPoints) continue;
      out.push({
        cat: HACKERNEWS.cat,
        title: clean(h.title),
        body: "",
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        src: HACKERNEWS.src,
        publishedAt: h.created_at || null,
        boost: Math.min(3, Math.floor((h.points || 0) / 200)),
      });
    }
    log(`HN: ${out.length} items over ${HACKERNEWS.minPoints} pts`);
    return out;
  } catch (e) { log(`HN failed: ${e.message}`); return []; }
}

// ── ranking ──────────────────────────────────────────────────
function selectTop(all) {
  const seen = new Set();
  const deduped = [];
  for (const it of all) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    it.score = scoreOf(it.title + " " + it.body) + (it.boost || 0);
    deduped.push(it);
  }
  const kept = [];
  for (const cat of Object.keys(CATEGORIES)) {
    const inCat = deduped.filter((x) => x.cat === cat)
      .sort((a, b) => b.score - a.score || (Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)));
    kept.push(...inCat.slice(0, KEEP_PER_CATEGORY));
  }
  return { kept, scanned: deduped.length, deduped };
}

function toFeedItem(it) {
  // tone: high score → "rising"; strong social boost → "hot"
  let tone = "";
  if (it.cat === "social" && (it.boost || 0) >= 2) tone = "hot";
  else if (it.score >= 3) tone = "rising";
  return {
    cat: it.cat,
    label: CATEGORIES[it.cat].label,
    tone,
    title: trim(it.title, 110),
    body: it.body || "—",
    src: it.src,
    fav: initials(it.src),
    url: it.url,
    publishedAt: it.publishedAt,
    image: it.image || null,
  };
}

// ── og:image enrichment ──────────────────────────────────────
// Kept items without an RSS photo get one more chance: fetch the
// article page and pull its og:image / twitter:image meta tag.
async function enrichImages(items) {
  const missing = items.filter((x) => !x.image && x.url && /^https?:/.test(x.url));
  await Promise.all(missing.map(async (it) => {
    try {
      const r = await withTimeout(fetch(it.url, {
        headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow",
      }), 10000, "og:" + it.src);
      if (!r.ok) return;
      const html = (await r.text()).slice(0, 200000);
      const m =
        /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["']/i.exec(html);
      if (m && /^https?:/.test(m[1])) it.image = m[1].replace(/&amp;/g, "&");
    } catch { /* keep the tinted placeholder */ }
  }));
  const got = missing.filter((x) => x.image).length;
  if (missing.length) log(`og:image: found ${got} of ${missing.length} missing photos.`);
}

// ── the brief (Claude, with heuristic fallback) ──────────────
async function writeBrief(items) {
  const key = process.env.ANTHROPIC_API_KEY;
  const list = items.map((x, i) => `${i + 1}. [${x.label}] ${x.title}${x.body && x.body !== "—" ? " — " + x.body : ""} (${x.src})`).join("\n");

  if (!key) {
    log("No ANTHROPIC_API_KEY — using heuristic brief.");
    return heuristicBrief(items);
  }

  const anthropic = new Anthropic({ apiKey: key });
  const prompt =
`You are the editor of "Orbit", a personal daily digest. Below are today's top items, already filtered to the reader's interests (tech & AI, personal growth, social trends, business & money).

Write the daily brief in ${LANGUAGE}. Be concrete and specific — name the actual thread of the day. No hype, no filler.

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "lede": "2-4 sentence paragraph on the single most important thread today. Use plain text.",
  "bullets": [ { "head": "3-6 word bold takeaway", "detail": "one sentence why it matters to the reader" } ],   // exactly 4
  "signal": { "tech": "one of: busy|steady|calm|hot", "social": "...", "growth": "...", "business": "..." },
  "experiments": [ { "title": "3-5 words", "who": "who is trying it", "why": "1-2 sentences: what it is + why it works", "effort": 1, "payoff": "3-5 words" } ]  // 3 to 4, effort is 1-4
}

Today's items:
${list}`;

  try {
    const msg = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 1600,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    log(`Brief written by ${BRIEF_MODEL}.`);
    return json;
  } catch (e) {
    log(`Claude brief failed (${e.message}) — using heuristic brief.`);
    return heuristicBrief(items);
  }
}

function heuristicBrief(items) {
  const top = items.slice(0, 4);
  return {
    lede: `Today Orbit kept ${items.length} items across your topics. The lead story: "${top[0]?.title || "—"}". Scan the feed below for the rest.`,
    bullets: top.map((x) => ({ head: (CATEGORIES[x.cat] && CATEGORIES[x.cat].label) || x.cat, detail: x.title })),
    signal: { tech: "steady", social: "steady", growth: "steady", business: "calm" },
    experiments: [
      { title: "The 1-hour ship", who: "Solo builders", why: "Pick something tiny, set a public 60-minute timer, ship what exists at the end. Small scope plus a deadline beats a perfect plan.", effort: 2, payoff: "Fast momentum" },
      { title: "Morning attention reset", who: "Focus circles", why: "First 30 minutes: no phone, no feed, one page of writing. It anchors the whole day's focus.", effort: 1, payoff: "Sharper focus" },
      { title: "One local AI helper", who: "Indie hackers", why: "Run a small model offline for one repetitive task. Free, private, and a fast way to feel where AI helps you.", effort: 3, payoff: "Real time saved" },
    ],
  };
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  log("Fetching sources…");
  const [rss, reddit, hn] = await Promise.all([fetchRSS(), fetchReddit(), fetchHN()]);
  const all = [...rss, ...reddit, ...hn];
  log(`Collected ${all.length} raw items.`);

  const { kept, scanned, deduped } = selectTop(all);
  await enrichImages(kept);
  const feed = kept.map(toFeedItem)
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  log(`Kept ${feed.length} of ${scanned} (${feed.filter((x) => x.image).length} with photos).`);

  const brief = await writeBrief(kept);

  // Real analytics for the dashboard: category volume, source volume, interest hits.
  const byCategory = {};
  for (const cat of Object.keys(CATEGORIES)) byCategory[cat] = { label: CATEGORIES[cat].label, scanned: 0, kept: 0 };
  for (const it of deduped) byCategory[it.cat].scanned++;
  for (const it of kept) byCategory[it.cat].kept++;

  const srcCount = {};
  for (const it of deduped) srcCount[it.src] = (srcCount[it.src] || 0) + 1;
  const topSources = Object.entries(srcCount).sort((a, b) => b[1] - a[1]).slice(0, 7)
    .map(([src, count]) => ({ src, count }));

  const kwCount = {};
  for (const it of deduped) {
    const t = (it.title + " " + it.body).toLowerCase();
    for (const kw of INTERESTS) if (t.includes(kw)) kwCount[kw] = (kwCount[kw] || 0) + 1;
  }
  const topKeywords = Object.entries(kwCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([word, hits]) => ({ word, hits }));

  const data = {
    generatedAt: new Date().toISOString(),
    brief: {
      ...brief,
      scanned,
      kept: feed.length,
    },
    feed,
    experiments: brief.experiments || [],
    analytics: { byCategory, topSources, topKeywords },
  };

  fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
  log(`Wrote data.json (${feed.length} items, ${scanned} scanned).`);

  // Append today's numbers to history.json so the dashboard sparklines
  // become real data once a few days accumulate. One entry per day.
  const today = new Date().toISOString().slice(0, 10);
  let history = [];
  try { history = JSON.parse(fs.readFileSync("history.json", "utf8")); } catch { /* first run */ }
  history = history.filter((h) => h.date !== today);
  history.push({
    date: today,
    scanned,
    kept: feed.length,
    sources: topSources.length,
    photos: feed.filter((x) => x.image).length,
  });
  history = history.slice(-30);
  fs.writeFileSync("history.json", JSON.stringify(history, null, 2));
  log(`Wrote history.json (${history.length} day${history.length === 1 ? "" : "s"}).`);
}

main().catch((e) => { console.error("Build failed:", e); process.exit(1); });
