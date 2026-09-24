// Brews the latte themed stats and language cards for the profile README.
// Runs in GitHub Actions with the default GITHUB_TOKEN, so it only asks for data that token can read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(fs.readFileSync(path.join(here, "fredoka-glyphs.json"), "utf8"));
const LOGIN = process.env.LOGIN;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || "profile";
const HIDE = new Set(["cmake", "c++", "c", "swift", "makefile", "jupyter notebook", "dockerfile", "batchfile", "objective-c", "ruby"]);
const LANG_COUNT = 6;

// light cappuccino palette, used in both light and dark GitHub themes
const LATTE = { bg: "#FFF8F0", border: "#EFE0CF", title: "#8A5A44", text: "#4B2E24", muted: "#B08A70", bean: "#D6A47A", beanLine: "#FFF8F0", heart: "#E58FA5", saucer: "#F6E7D8", cup: "#FFFDF9", rim: "#D6A47A", track: "#F3E6D8" };
const DEFAULT_THEMES = { light: LATTE, dark: LATTE };
const THEMES = process.env.THEMES_JSON ? JSON.parse(fs.readFileSync(process.env.THEMES_JSON, "utf8")) : DEFAULT_THEMES;

// ---------- data ----------
async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "cafe-cards" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) console.warn("graphql errors:", JSON.stringify(json.errors).slice(0, 400));
  return json.data;
}

async function allRepos(fields) {
  const nodes = [];
  let after = null;
  let total = null;
  for (let page = 0; page < 10; page++) {
    const data = await gql(
      `query($login:String!,$after:String){user(login:$login){repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{${fields}}}}}`,
      { login: LOGIN, after },
    );
    const conn = data?.user?.repositories;
    if (!conn) break;
    total = conn.totalCount;
    nodes.push(...conn.nodes.filter(Boolean));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return { nodes, total };
}

async function safe(fn) {
  try { return await fn(); } catch (e) { console.warn(e.message); return null; }
}

async function loadData() {
  if (process.env.MOCK) return JSON.parse(fs.readFileSync(process.env.MOCK, "utf8"));
  const langs = await safe(() => allRepos("name languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}"));
  const stars = await safe(() => allRepos("stargazerCount"));
  const contrib = await safe(async () => (await gql(
    `query($login:String!){user(login:$login){contributionsCollection{totalCommitContributions totalPullRequestContributions totalIssueContributions contributionCalendar{totalContributions}}}}`,
    { login: LOGIN },
  ))?.user?.contributionsCollection);
  const calendar = await safe(loadCalendar);
  const loc = await safe(() => loadLinesOfCode((langs?.nodes || []).map((r) => r.name)));
  return {
    repos: langs?.total ?? stars?.total ?? null,
    languages: langs?.nodes ?? null,
    stars: stars?.nodes?.length ? stars.nodes.reduce((a, r) => a + (r.stargazerCount || 0), 0) : null,
    contrib: contrib ?? null,
    calendar: calendar ?? null,
    loc: loc ?? null,
  };
}

async function rest(url) {
  const res = await fetch(`https://api.github.com${url}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "cafe-cards" },
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

// net lines (added minus deleted) the owner wrote across their own public repos
async function loadLinesOfCode(names) {
  let net = 0;
  let counted = 0;
  for (const name of names) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { status, body } = await rest(`/repos/${LOGIN}/${name}/stats/contributors`);
      if (status === 202) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      if (Array.isArray(body)) {
        const me = body.find((c) => c.author?.login?.toLowerCase() === LOGIN.toLowerCase());
        if (me) net += me.weeks.reduce((a, w) => a + w.a - w.d, 0);
        counted++;
      }
      break;
    }
  }
  return counted ? Math.max(net, 0) : null;
}

async function loadCalendar() {
  const created = (await gql(`query($login:String!){user(login:$login){createdAt}}`, { login: LOGIN }))?.user?.createdAt;
  if (!created) return null;
  const now = new Date();
  const byDate = new Map();
  let commits = 0;
  for (let y = new Date(created).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
    const from = `${y}-01-01T00:00:00Z`;
    const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
    const data = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){totalCommitContributions contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      { login: LOGIN, from, to },
    );
    commits += data?.user?.contributionsCollection?.totalCommitContributions || 0;
    for (const w of data?.user?.contributionsCollection?.contributionCalendar?.weeks || [])
      for (const d of w.contributionDays) byDate.set(d.date, d.contributionCount);
  }
  const today = now.toISOString().slice(0, 10);
  const days = [...byDate.entries()].filter(([d]) => d <= today).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count }));
  return { days, commits };
}

// ---------- drawing helpers ----------
const r2 = (v) => Math.round(v * 100) / 100;
function text(str, { x, y, size, weight = 500, fill, anchor = "start" }) {
  const table = G[weight];
  let adv = 0;
  const parts = [];
  for (const ch of String(str)) {
    const g = table[ch] || table["?"];
    if (g[1]) parts.push(`<path transform="translate(${adv})" d="${g[1]}"/>`);
    adv += g[0];
  }
  const s = size / 1000;
  const width = adv * s;
  const x0 = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return { svg: `<g fill="${fill}" transform="translate(${r2(x0)} ${r2(y)}) scale(${r2(s * 1000) / 1000} ${-r2(s * 1000) / 1000})">${parts.join("")}</g>`, width };
}
const heart = (x, y, s, fill) =>
  `<path fill="${fill}" transform="translate(${x} ${y}) scale(${s})" d="M0 3.2C-4.2 0.2-6.4-3.2-4.4-5.6C-2.9-7.3-0.8-6.8 0-5C0.8-6.8 2.9-7.3 4.4-5.6C6.4-3.2 4.2 0.2 0 3.2Z"/>`;
const bean = (x, y, t) =>
  `<g transform="translate(${x} ${y}) rotate(-35)"><ellipse rx="4.6" ry="6.4" fill="${t.bean}"/><path d="M0.4 -5.6C-2 -2 2 2 -0.4 5.6" stroke="${t.beanLine}" stroke-width="1.3" fill="none" stroke-linecap="round"/></g>`;
const fmt = (n) => Number(n).toLocaleString("en-US");
const frame = (w, h, t, inner, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
<title>${label}</title>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="16" fill="${t.bg}" stroke="${t.border}" stroke-width="1.5"/>
${inner}
</svg>
`;

// ---------- cards ----------
function statsCard(d, t) {
  const W = 480, H = 200;
  const out = [];
  const title = text("brewing stats", { x: 26, y: 40, size: 19, weight: 600, fill: t.title });
  out.push(title.svg, heart(r2(26 + title.width + 14), 33, 1.25, t.heart));

  const rows = [];
  if (d.contrib) {
    rows.push(["commits, past year", d.contrib.totalCommitContributions]);
    rows.push(["pull requests, past year", d.contrib.totalPullRequestContributions]);
    rows.push(["issues, past year", d.contrib.totalIssueContributions]);
  }
  if (d.stars != null) rows.push(["stars earned", d.stars]);
  if (d.repos != null) rows.push(["public repos", d.repos]);
  rows.slice(0, 5).forEach(([label, value], i) => {
    const y = 74 + i * 26;
    out.push(bean(34, y - 5, t));
    out.push(text(label, { x: 48, y, size: 14, weight: 500, fill: t.text }).svg);
    out.push(text(fmt(value), { x: 276, y, size: 14.5, weight: 600, fill: t.text, anchor: "end" }).svg);
  });

  const cx = 382, cy = 104;
  out.push(`<circle cx="${cx}" cy="${cy}" r="66" fill="${t.saucer}"/>`);
  out.push(`<path d="M${cx + 44} ${cy - 13}h13a13 13 0 0 1 0 26h-13" fill="none" stroke="${t.rim}" stroke-width="6" stroke-linecap="round"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="50" fill="${t.cup}" stroke="${t.rim}" stroke-width="5"/>`);
  if (d.contrib) {
    out.push(heart(cx, cy - 27, 1.35, t.heart));
    out.push(text(fmt(d.contrib.contributionCalendar.totalContributions), { x: cx, y: cy + 8, size: 27, weight: 600, fill: t.text, anchor: "middle" }).svg);
    out.push(text("contributions", { x: cx, y: cy + 25, size: 11.5, weight: 500, fill: t.muted, anchor: "middle" }).svg);
    out.push(text("past year", { x: cx, y: cy + 38, size: 10.5, weight: 500, fill: t.muted, anchor: "middle" }).svg);
  } else {
    out.push(heart(cx, cy + 2, 3, t.heart));
  }
  return frame(W, H, t, out.join("\n"), "brewing stats");
}

function langsData(repos) {
  const agg = new Map();
  for (const repo of repos) {
    for (const e of repo.languages?.edges || []) {
      const name = e.node.name;
      if (HIDE.has(name.toLowerCase())) continue;
      const cur = agg.get(name) || { name, color: e.node.color || "#B08A70", size: 0, count: 0 };
      cur.size += e.size;
      cur.count += 1;
      agg.set(name, cur);
    }
  }
  const list = [...agg.values()].map((l) => ({ ...l, score: Math.sqrt(l.size) * Math.sqrt(l.count) }))
    .sort((a, b) => b.score - a.score).slice(0, LANG_COUNT);
  const total = list.reduce((a, l) => a + l.score, 0) || 1;
  return list.map((l) => ({ ...l, pct: (l.score / total) * 100 }));
}

function langsCard(langs, t) {
  const W = 340, H = 200;
  const out = [text("most brewed languages", { x: 24, y: 40, size: 18, weight: 600, fill: t.title }).svg];
  const bx = 24, bw = W - 48, by = 56;
  out.push(`<clipPath id="bar"><rect x="${bx}" y="${by}" width="${bw}" height="10" rx="5"/></clipPath>`);
  out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="10" rx="5" fill="${t.track}"/>`);
  let x = bx;
  const segs = langs.map((l) => {
    const w = (l.pct / 100) * bw;
    const s = `<rect x="${r2(x)}" y="${by}" width="${r2(w + 0.5)}" height="10" fill="${l.color}"/>`;
    x += w;
    return s;
  });
  out.push(`<g clip-path="url(#bar)">${segs.join("")}</g>`);
  langs.forEach((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 30 + col * 150, ly = 96 + row * 28;
    out.push(`<circle cx="${lx}" cy="${ly - 4.5}" r="5" fill="${l.color}"/>`);
    const name = text(l.name, { x: lx + 12, y: ly, size: 13.5, weight: 500, fill: t.text });
    out.push(name.svg);
    out.push(text(`${l.pct.toFixed(1)}%`, { x: lx + 12 + name.width + 6, y: ly, size: 12, weight: 500, fill: t.muted }).svg);
  });
  out.push(text("weighted by code size and repo count", { x: 24, y: 182, size: 10.5, weight: 500, fill: t.muted }).svg);
  return frame(W, H, t, out.join("\n"), "most brewed languages");
}

function streakData(days) {
  if (!days?.length) return null;
  const total = days.reduce((a, d) => a + d.count, 0);
  const first = days.find((d) => d.count > 0)?.date ?? days[0].date;
  let best = { len: 0, start: null, end: null };
  let run = { len: 0, start: null };
  for (const d of days) {
    if (d.count > 0) {
      if (!run.len) run.start = d.date;
      run.len++;
      if (run.len > best.len) best = { len: run.len, start: run.start, end: d.date };
    } else run = { len: 0, start: null };
  }
  let i = days.length - 1;
  if (days[i].count === 0) i--; // today can still be saved, so it does not break the streak yet
  let cur = { len: 0, start: null, end: i >= 0 ? days[i].date : null };
  while (i >= 0 && days[i].count > 0) { cur.len++; cur.start = days[i].date; i--; }
  return { total, first, best, cur };
}

const fmtDate = (iso, withYear = true) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
const range = (a, b) => {
  if (!a) return "no streak yet";
  const thisYear = String(new Date().getUTCFullYear());
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  if (a === b) return fmtDate(a, a.slice(0, 4) !== thisYear);
  if (!sameYear) return `${fmtDate(a)} to ${fmtDate(b)}`;
  return `${fmtDate(a, false)} to ${fmtDate(b, false)}${a.slice(0, 4) === thisYear ? "" : `, ${a.slice(0, 4)}`}`;
};

function streakCard(s, t) {
  const W = 520, H = 170;
  const cols = [96, 260, 424];
  const out = [
    `<path d="M178 34V136M342 34V136" stroke="${t.border}" stroke-width="1.5"/>`,
    text(fmt(s.total), { x: cols[0], y: 82, size: 30, weight: 600, fill: t.text, anchor: "middle" }).svg,
    text("total contributions", { x: cols[0], y: 108, size: 13, weight: 500, fill: t.text, anchor: "middle" }).svg,
    text(`since ${fmtDate(s.first)}`, { x: cols[0], y: 128, size: 11, weight: 500, fill: t.muted, anchor: "middle" }).svg,
    `<circle cx="${cols[1]}" cy="66" r="44" fill="${t.saucer}"/>`,
    `<path d="M${cols[1] + 30} 55h9a11 11 0 0 1 0 22h-9" fill="none" stroke="${t.rim}" stroke-width="5" stroke-linecap="round"/>`,
    `<circle cx="${cols[1]}" cy="66" r="33" fill="${t.cup}" stroke="${t.heart}" stroke-width="4.5"/>`,
    heart(cols[1], 26, 1.6, t.heart),
    text(fmt(s.cur.len), { x: cols[1], y: 77, size: 28, weight: 600, fill: t.text, anchor: "middle" }).svg,
    text("current streak", { x: cols[1], y: 130, size: 13.5, weight: 600, fill: t.title, anchor: "middle" }).svg,
    text(range(s.cur.start, s.cur.end), { x: cols[1], y: 150, size: 11, weight: 500, fill: t.muted, anchor: "middle" }).svg,
    text(fmt(s.best.len), { x: cols[2], y: 82, size: 30, weight: 600, fill: t.text, anchor: "middle" }).svg,
    text("longest streak", { x: cols[2], y: 108, size: 13, weight: 500, fill: t.text, anchor: "middle" }).svg,
    text(range(s.best.start, s.best.end), { x: cols[2], y: 128, size: 11, weight: 500, fill: t.muted, anchor: "middle" }).svg,
  ];
  return frame(W, H, t, out.join("\n"), "contribution streak");
}

// ---------- main ----------
const data = await loadData();
fs.mkdirSync(OUT, { recursive: true });
let wrote = 0;
if (data.contrib || data.stars != null || data.repos != null) {
  for (const [name, t] of Object.entries(THEMES)) fs.writeFileSync(path.join(OUT, `stats-${name}.svg`), statsCard(data, t));
  wrote++;
}
const langs = data.languages ? langsData(data.languages) : [];
if (langs.length) {
  for (const [name, t] of Object.entries(THEMES)) fs.writeFileSync(path.join(OUT, `top-langs-${name}.svg`), langsCard(langs, t));
  wrote++;
}
const streak = streakData(data.calendar?.days);
if (streak) {
  for (const [name, t] of Object.entries(THEMES)) fs.writeFileSync(path.join(OUT, `streak-${name}.svg`), streakCard(streak, t));
  wrote++;
}
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : fmt(n));
const badgePath = path.join(OUT, "badges.json");
let badges = {};
try { badges = JSON.parse(fs.readFileSync(badgePath, "utf8")); } catch {}
if (data.calendar?.commits) badges.commits = fmt(data.calendar.commits);
if (data.loc != null) badges.loc = compact(data.loc);
if (Object.keys(badges).length) { fs.writeFileSync(badgePath, JSON.stringify(badges, null, 2) + "\n"); wrote++; }
console.log(JSON.stringify({ badges }));
console.log(JSON.stringify({ streak: streak && { total: streak.total, first: streak.first, cur: streak.cur, best: streak.best } }));
console.log(JSON.stringify({ repos: data.repos, stars: data.stars, contrib: data.contrib, langs: langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`) }));
if (!wrote) {
  console.error("no data could be fetched, keeping the previous cards");
  process.exit(1);
}
