// Draws assets/streak.svg: current streak, longest streak, total contributions and the last
// 90 days as bars, in the same system as the header (Inter Tight, hairline rules, lime accent).
// Flat colours on purpose: the header owns the gradient.
//
//   GITHUB_TOKEN=… node .github/scripts/streak-card.mjs            → assets/streak.svg (real data)
//   node .github/scripts/streak-card.mjs --demo --out /tmp/x.svg   → made-up numbers, no network
//
// Runs daily from .github/workflows/streak-card.yml. Uses GH_TOKEN if set (a personal token
// also counts private contributions), otherwise the workflow's GITHUB_TOKEN.
import fs from 'node:fs';
import path from 'node:path';

const USER = 'sabbirsami';
const TZ = 'Asia/Dhaka';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(DIR, '../../assets/streak.svg');

// ---- data ------------------------------------------------------------------------------
async function gql(query, variables) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Set GH_TOKEN or GITHUB_TOKEN');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'streak-card' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/** Every day since the first contribution year, oldest first: [{ date: 'YYYY-MM-DD', count }]. */
async function loadDays() {
  const { user } = await gql('query($u:String!){user(login:$u){contributionsCollection{contributionYears}}}', { u: USER });
  const years = [...user.contributionsCollection.contributionYears].sort();
  const days = [];
  for (const y of years) {
    const { user: u } = await gql(
      `query($u:String!,$from:DateTime!,$to:DateTime!){user(login:$u){contributionsCollection(from:$from,to:$to){
        contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      { u: USER, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` },
    );
    for (const w of u.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const seen = new Map(days.map((d) => [d.date, d]));
  return [...seen.values()].filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
}

function demoDays() {
  const days = [];
  const end = new Date('2026-11-25T00:00:00Z');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 3 * 365; i >= 0; i--) {
    const d = new Date(end - i * 864e5);
    const count = i < 12 ? 1 + Math.floor(rnd() * 9) : rnd() < 0.3 ? 0 : Math.floor(rnd() * 14);
    days.push({ date: d.toISOString().slice(0, 10), count });
  }
  return days;
}

function stats(days) {
  const total = days.reduce((s, d) => s + d.count, 0);
  // Current streak: today doesn't break it until the day is over.
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let curEnd = i, cur = 0;
  while (i >= 0 && days[i].count > 0) { cur++; i--; }
  const current = { len: cur, from: cur ? days[curEnd - cur + 1].date : null, to: cur ? days[curEnd].date : null };
  let longest = { len: 0, from: null, to: null }, run = 0;
  days.forEach((d, k) => {
    run = d.count > 0 ? run + 1 : 0;
    if (run > longest.len) longest = { len: run, from: days[k - run + 1].date, to: d.date };
  });
  return { total, current, longest, first: days.find((d) => d.count > 0)?.date ?? days[0]?.date, last90: days.slice(-90), today: days.at(-1)?.date };
}

// ---- drawing ---------------------------------------------------------------------------
const C = { ink: '#05031a', white: '#ffffff', lilac: '#c8c2fc', lime: '#dbff83', rule: 'rgba(200,196,255,.22)' };
const font = (w) => fs.readFileSync(path.join(DIR, `fonts/InterTight-${w}.woff2`)).toString('base64');
const MARK = fs.readFileSync(path.join(DIR, 'lettermark.svg'), 'utf8').match(/<path[^>]*\/>/g).join('');
const fmt = (n) => n.toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso, withYear) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}${withYear ? ` ${y}` : ''}`; };
const range = (a, b) => (a === b ? day(a, true) : `${day(a, a.slice(0, 4) !== b.slice(0, 4))} – ${day(b, true)}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function card(s) {
  const W = 1280, H = 440, L = 72, R = W - 72, MID = 640;
  const label = (x, y, t, anchor = 'start', fill = C.lilac, op = 0.75) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" class="lb" fill="${fill}" fill-opacity="${op}">${esc(t).toUpperCase()}</text>`;
  const streakDays = new Set();
  if (s.current.len) for (const d of s.last90) if (d.date >= s.current.from && d.date <= s.current.to) streakDays.add(d.date);
  const max = Math.max(1, ...s.last90.map((d) => d.count));
  const busiest = s.last90.reduce((a, d) => (d.count > a.count ? d : a), s.last90[0]);
  const step = (R - L) / s.last90.length, bw = Math.min(6, step * 0.5), base = 410, bh = 54;
  const bars = s.last90.map((d, k) => {
    const x = (L + k * step + (step - bw) / 2).toFixed(2);
    if (!d.count) return `<rect x="${x}" y="${base - 2}" width="${bw}" height="2" fill="${C.lilac}" fill-opacity=".28"/>`;
    const h = Math.max(4, (d.count / max) * bh);
    const on = streakDays.has(d.date);
    return `<rect x="${x}" y="${(base - h).toFixed(2)}" width="${bw}" height="${h.toFixed(2)}" rx="1" fill="${on ? C.lime : C.lilac}" fill-opacity="${on ? 1 : 0.55}"/>`;
  }).join('');
  const big = (x, y, n, size, fill, unit) =>
    `<text x="${x}" y="${y}" class="num" fill="${fill}" font-size="${size}">${n}${unit ? `<tspan class="unit" fill="${C.white}" fill-opacity=".7" font-size="${Math.round(size * 0.17 + 10)}" dx="${Math.round(size * 0.08)}">${unit}</tspan>` : ''}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Current streak ${s.current.len} days, longest streak ${s.longest.len} days, ${fmt(s.total)} total contributions">
  <style>
    @font-face{font-family:IT;src:url(data:font/woff2;base64,${font(400)}) format('woff2');font-weight:400}
    @font-face{font-family:IT;src:url(data:font/woff2;base64,${font(500)}) format('woff2');font-weight:500}
    text{font-family:IT,'Inter Tight',Inter,'Segoe UI',Arial,sans-serif}
    .lb{font-size:14px;font-weight:500;letter-spacing:1.6px}
    .num{font-weight:400;letter-spacing:-.02em}
    .unit{letter-spacing:0}
    .sub{font-size:17px;font-weight:400}
  </style>
  <rect width="${W}" height="${H}" fill="${C.ink}"/>
  <g stroke="${C.rule}" stroke-width="1">
    <path d="M40 0V${H}M${W - 40} 0V${H}M0 64.5H${W}M0 300.5H${W}M${MID}.5 64V300M${MID} 182.5H${W - 40}"/>
  </g>

  <g transform="translate(${L} 25) scale(${15 / 169})" fill="${C.white}">${MARK}</g>
  <text x="${L + 44}" y="39" class="sub" fill="${C.white}" font-weight="500">Contributions</text>
  ${label(R, 37, `Updated ${day(s.today, true)}`, 'end', C.lilac, 0.6)}

  ${label(L, 104, 'Current streak')}
  ${s.current.len ? label(MID - 32, 104, range(s.current.from, s.current.to), 'end', C.lilac, 0.55) : ''}
  ${big(L - 6, 268, s.current.len, 168, C.lime, s.current.len === 1 ? 'day' : 'days')}

  ${label(MID + 40, 104, 'Longest streak')}
  ${big(MID + 38, 160, s.longest.len, 52, C.white, 'days')}
  ${s.longest.len ? `<text x="${R}" y="160" text-anchor="end" class="sub" fill="${C.lilac}" fill-opacity=".7">${range(s.longest.from, s.longest.to)}</text>` : ''}

  ${label(MID + 40, 222, 'Total contributions')}
  ${big(MID + 38, 278, fmt(s.total), 52, C.white)}
  <text x="${R}" y="278" text-anchor="end" class="sub" fill="${C.lilac}" fill-opacity=".7">since ${day(s.first, true)}</text>

  ${label(L, 336, 'Last 90 days')}
  ${busiest?.count ? label(R, 336, `Busiest day · ${busiest.count} on ${day(busiest.date)}`, 'end', C.lilac, 0.55) : ''}
  <path d="M${L} ${base + 0.5}H${R}" stroke="${C.rule}"/>
  ${bars}
</svg>
`;
}

const days = DEMO ? demoDays() : await loadDays();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, card(stats(days)));
console.log(`wrote ${OUT}`);
