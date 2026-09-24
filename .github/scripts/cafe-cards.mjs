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

const THEMES = {
  light: { bg: "#FFF8F0", border: "#EFE0CF", title: "#8A5A44", text: "#4B2E24", muted: "#B08A70", bean: "#D6A47A", beanLine: "#FFF8F0",
    heart: "#E58FA5", saucer: "#F6E7D8", cup: "#FFFDF9", rim: "#D6A47A", track: "#F3E6D8" },
  dark: { bg: "#231A17", border: "#3A2C26", title: "#F2A7B8", text: "#F8EDE2", muted: "#A48877", bean: "#C08A62", beanLine: "#231A17",
    heart: "#F2A7B8", saucer: "#2E221E", cup: "#33261F", rim: "#C08A62", track: "#3A2C26" },
};

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
  return {
    repos: langs?.total ?? stars?.total ?? null,
    languages: langs?.nodes ?? null,
    stars: stars?.nodes?.length ? stars.nodes.reduce((a, r) => a + (r.stargazerCount || 0), 0) : null,
    contrib: contrib ?? null,
  };
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
console.log(JSON.stringify({ repos: data.repos, stars: data.stars, contrib: data.contrib, langs: langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`) }));
if (!wrote) {
  console.error("no data could be fetched, keeping the previous cards");
  process.exit(1);
}
