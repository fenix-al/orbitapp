// ─────────────────────────────────────────────────────────────
//  Orbit — sources & tuning
//  Edit this file to change what your digest pays attention to.
// ─────────────────────────────────────────────────────────────

export const CATEGORIES = {
  tech:     { label: "Tech & AI",       fav: "color: #eaa42a" },
  social:   { label: "Social",          fav: "color: #f2706e" },
  growth:   { label: "Growth",          fav: "color: #3fca8f" },
  business: { label: "Business",        fav: "color: #98a1b3" },
};

// RSS / newsletter feeds. Add any feed URL and tag it with a category.
// (These are well-known public feeds — swap in the ones you actually read.)
export const RSS_FEEDS = [
  { cat: "tech",     url: "https://hnrss.org/frontpage",                         src: "Hacker News" },
  { cat: "tech",     url: "https://www.theverge.com/rss/index.xml",             src: "The Verge" },
  { cat: "tech",     url: "https://techcrunch.com/feed/",                        src: "TechCrunch" },
  { cat: "growth",   url: "https://jamesclear.com/feed",                         src: "James Clear" },
  { cat: "growth",   url: "https://www.nirandfar.com/feed",                      src: "Nir & Far" },
  { cat: "business", url: "https://feeds.bbci.co.uk/news/business/rss.xml",      src: "BBC Business" },
  { cat: "tech",     url: "https://feeds.arstechnica.com/arstechnica/technology-lab", src: "Ars Technica" },
  { cat: "social",   url: "https://www.socialmediatoday.com/feeds/news/",       src: "Social Media Today" },
];

// Reddit — public JSON, no key needed. Tag each subreddit with a category.
export const SUBREDDITS = [
  { cat: "tech",     sub: "artificial" },
  { cat: "tech",     sub: "LocalLLaMA" },
  { cat: "growth",   sub: "productivity" },
  { cat: "growth",   sub: "getdisciplined" },
  { cat: "business", sub: "Entrepreneur" },
  { cat: "social",   sub: "socialmedia" },
];

// Hacker News front page (via Algolia). Good for tech + "what people are building".
export const HACKERNEWS = { enabled: true, cat: "tech", src: "Hacker News", minPoints: 80 };

// Your interests — items matching these keywords score higher and rise to the top.
// Add words that matter to you; remove what doesn't.
export const INTERESTS = [
  "ai", "agent", "llm", "open source", "local", "on-device", "model",
  "startup", "indie", "build in public", "side project", "saas", "micro",
  "habit", "focus", "productivity", "discipline", "learning", "mindset",
  "revenue", "growth", "marketing", "creator", "trend", "viral",
];

// How many items to keep per category in the final feed.
export const KEEP_PER_CATEGORY = 3;

// Claude model used to write the daily brief. Swap for cost/quality:
//   claude-haiku-4-5-20251001  (cheapest)
//   claude-sonnet-5            (balanced — default)
//   claude-opus-4-8            (highest quality)
export const BRIEF_MODEL = "claude-sonnet-5";

// Site language for the generated brief.
export const LANGUAGE = "English";
