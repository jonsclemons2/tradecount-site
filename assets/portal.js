const C = window.TC_CONFIG, sb = supabase.createClient(C.supabaseUrl, C.supabaseKey);
const $ = s => document.querySelector(s), esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const TRADES = [["hvac","HVAC","var(--hvac)"],["plumbing","Plumbing","var(--plumbing)"],["electrical","Electrical","var(--electrical)"],["roofing","Roofing","var(--roofing)"]];
const AREA = new Proxy({ "Miami-Dade": "Miami-Dade County" }, { get: (o, k) => o[k] || (typeof k === "string" ? k + " County" : undefined) });
const SRC = { "Orange": "City of Orlando permits", "Miami-Dade": "Miami-Dade County permits", "Lee": "City of Cape Coral permits" };
const COV = { "Orange": "City of Orlando permits since 2021, plus state records. Permits pulled outside Orlando city limits aren't in the free file.",
  "Miami-Dade": "Miami-Dade County permits since 2021, plus state records. Cities that issue their own permits, such as Miami, aren't included.",
  "Lee": "City of Cape Coral permits since 2021, plus state records. Fort Myers and unincorporated Lee County aren't in the free file." };
const COV_STATE = "State records only: workers' comp sites, equipment on the tax roll and licenses. This county publishes no free permit file that names the contractor.";
const GRADE = { permits: ["Permit history", "Permits and state records for most years"], state: ["State records", "Workers' comp or equipment on file for three years or more"], thin: ["Thin record", "Little on file beyond the license"] };
const GROWTH_TRADES = new Set(["hvac"]);
const UNIT = { hvac: "change-outs", plumbing: "plumbing permits", electrical: "electrical permits", roofing: "roofing permits" };
let me, counties = [], county, trade = "hvac", cache = {}, hist = {}, feed = [], watch = new Set(), sel = null, map, pins, area, view = "growth", q = "";
const TL = t => ({ hvac: "HVAC", mechanical: "Mechanical", plumbing: "Plumbing", electrical: "Electrical", roofing: "Roofing", building: "Building", general: "General" }[t] || t[0].toUpperCase() + t.slice(1));
const fmt = n => (+n || 0).toLocaleString("en-US");
const n0 = c => c.card.n0 ?? +c.card.facts[0].v, n1 = c => c.card.n1 ?? +c.card.facts[1].v;
const pct = c => { const a = n0(c), b = n1(c); return b ? Math.round(100 * (a - b) / b) : null; };

$("#sform").onsubmit = async e => { e.preventDefault();
  const { error } = await sb.auth.signInWithOtp({ email: $("#email").value.trim(), options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
  $("#sent").textContent = error ? "That link didn't send: " + error.message : "Check your email for the sign-in link."; };
$("#out").onclick = async e => { e.preventDefault(); await sb.auth.signOut(); location.reload(); };
document.addEventListener("copy", e => e.preventDefault());

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("#signin").hidden = false; return; }
  me = session.user; $("#me").textContent = me.email;
  $("#wm").textContent = Array(70).fill(Array(9).fill(me.email + "      ").join("")).join("\n");
  const [a, f, w] = await Promise.all([sb.from("tc_account").select("counties").maybeSingle(),
    sb.from("tc_change_feed").select("*").order("id").limit(1000), sb.from("tc_watch").select("firm_id")]);
  counties = (a.data && a.data.counties) || []; feed = f.data || []; (w.data || []).forEach(r => watch.add(r.firm_id));
  $("#app").hidden = false;
  if (!counties.length) { $("#main").innerHTML = '<p class="empty">Your account has no counties yet. Ask Tradecount to add one.</p>'; return; }
  county = counties[0];
  const h = new URLSearchParams(location.hash.slice(1)); if (h.get("t")) trade = h.get("t"); if (counties.includes(h.get("c"))) county = h.get("c"); if (h.get("v")) view = h.get("v");
  tabs(); show();
}
function tabs() {
  $("#tabs").innerHTML = TRADES.map(([k, l, c]) => `<button role="tab" data-t="${k}" style="--c:${c}" aria-selected="${trade === k}"><i></i>${l}</button>`).join("")
    + `<button role="tab" data-t="watch" style="--c:#9AA6B2" aria-selected="${trade === "watch"}"><i></i>Watchlist <small>${watch.size}</small></button>`;
  $("#tabs").querySelectorAll("button").forEach(b => b.onclick = () => { trade = b.dataset.t; sel = null; tabs(); show(); });
}
async function load(t) {
  if (!cache[t]) { const { data } = await sb.from("tc_firm_card").select("firm_id,county,trade,rank,name,card,as_of").eq("trade", t).order("rank").limit(1000); cache[t] = data || []; }
  return cache[t];
}
async function show() {
  document.body.dataset.trade = trade; history.replaceState(null, "", "#t=" + trade + "&c=" + encodeURIComponent(county) + "&v=" + view);
  if (trade === "watch") return showWatch();
  if (GROWTH_TRADES.has(trade) && view === "growth") return showGrowth();
  const all = await load(trade), cs = all.filter(c => c.county === county), label = TRADES.find(t => t[0] === trade)[1];
  const ar = cs[0] && cs[0].card.area;
  const opts = counties.map(c => `<option value="${esc(c)}" ${c === county ? "selected" : ""}>${esc(AREA[c] || c)}</option>`).join("");
  $("#main").innerHTML = `<div class="head"><h1>${label} in<select id="cty" aria-label="County">${opts}</select></h1>${GROWTH_TRADES.has(trade) ? toggle_() : ""}
    ${cs.length ? `<dl class="facts"><div><dt>Firms pulling permits</dt><dd>${ar ? fmt(ar.firms) : fmt(cs.length) + "+"}</dd></div>
    <div><dt>${UNIT[trade][0].toUpperCase() + UNIT[trade].slice(1)}, last 12 months</dt><dd>${ar ? fmt(ar.permits0) : "n/a"}</dd></div>
    <div><dt>Against the year before</dt><dd>${ar && ar.permits1 ? (ar.permits0 >= ar.permits1 ? "+" : "−") + Math.abs(Math.round(100 * (ar.permits0 - ar.permits1) / ar.permits1)) + "%" : "n/a"}</dd></div>
    <div><dt>Share held by the top 10</dt><dd>${ar ? Math.round(100 * cs.slice(0, 10).reduce((s, c) => s + n0(c), 0) / Math.max(ar.permits0, 1)) + "%" : "n/a"}</dd></div></dl>` : ""}</div>
    ${cs.length ? `<div class="grid">
      <section class="panel"><div class="ph"><h2>Where they work</h2><span id="mapnote">Each pin is a firm's busiest ZIP. Bigger pins pulled more permits.</span></div><div id="map"></div></section>
      <section class="panel"><div class="ph"><h2>Top firms by ${UNIT[trade]}</h2><span>Last 12 months against the year before</span></div>
        <div class="listwrap"><table class="rank"><thead><tr><th></th><th>Firm</th><th>Last 12 mo</th><th>Prior vs now</th><th>Change</th></tr></thead><tbody id="rows"></tbody></table></div></section>
    </div>
    <div class="lower">
      <section class="panel"><div class="ph"><h2>What changed</h2><span>Against the same months a year earlier</span></div><ul class="feed" id="feed"></ul></section>
      <section class="panel"><div class="ph"><h2>Firm profile</h2><span>Pick a firm on the map or the list</span></div><div class="plate" id="plate"><span class="r1"></span><span class="r2"></span></div></section>
    </div>
    <p class="note">${esc(SRC[county])} and Florida state records, as of ${esc(cs[0].as_of)}. Rankings count permits each firm's license pulled from Dec 2025 to Nov 2026. Growth and activity only; nothing here predicts a sale.</p>`
    : `<section class="panel"><p class="empty">${GROWTH_TRADES.has(trade) ? `The last-12-months view needs a free permit file, and ${esc(AREA[county])} doesn't publish one. Switch to Five-year growth for this county.` : `${label} data for ${esc(AREA[county] || county)} is still loading. HVAC is ready now.`}</p></section>`}`;
  $("#cty").onchange = e => { county = e.target.value; sel = null; show(); }; wireToggle();
  if (!cs.length) return;
  const mx = Math.max(...cs.map(n0));
  $("#rows").innerHTML = cs.slice(0, 100).map(c => { const p = pct(c), a = n0(c), b = n1(c), m = Math.max(a, b, 1);
    return `<tr data-id="${c.firm_id}"><td>${c.rank}</td><td>${esc(c.name)}${c.card.call_first ? '<span class="cf" title="Growing fastest on the public record">Call First</span>' : ""}</td><td>${fmt(a)}</td>
    <td><span class="bars" title="${fmt(b)} then, ${fmt(a)} now"><b style="width:${100 * b / m}%"></b><b style="width:${100 * a / m}%"></b></span></td>
    <td class="${p === null || p >= 0 ? "up" : "dn"}">${p === null ? "New" : (p >= 0 ? "+" : "−") + Math.abs(p) + "%"}</td></tr>`; }).join("");
  $("#rows").onclick = e => { const r = e.target.closest("tr"); if (r) pick(+r.dataset.id, true); };
  const fs = feed.filter(x => x.county === county && (x.trade || "hvac") === trade).slice(0, 12);
  $("#feed").innerHTML = fs.length ? fs.map(x => { const k = /^New/.test(x.headline) ? ["New firm", "n"] : /down/.test(x.headline) ? ["Slowing", ""] : ["Rising", "n"];
    return `<li><span class="k ${k[1]}">${k[0]}</span><div><button data-id="${x.firm_id}">${esc(x.firm_name)}</button><p>${esc(x.headline)}</p></div></li>`; }).join("") : '<li class="empty">No changes flagged this month.</li>';
  $("#feed").querySelectorAll("button").forEach(b => b.onclick = () => pick(+b.dataset.id, true));
  drawMap(cs, mx);
  pick(sel && cs.some(c => c.firm_id === sel) ? sel : cs[0].firm_id, false);
}
function drawMap(cs, mx) {
  if (map) { map.remove(); map = null; }
  if (!window.L) { $("#mapnote").textContent = "The map didn't load. The list has the same firms."; return; }
  map = L.map("map", { scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 16, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  pins = L.layerGroup().addTo(map); area = L.layerGroup().addTo(map);
  const pts = [], seen = {};
  cs.slice(0, 100).reverse().forEach(c => { const p = c.card.pin; if (!p) return;
    const n = seen[p[2]] = (seen[p[2]] || 0) + 1, d = n > 1 ? .004 * Math.sqrt(n) : 0, ll = [p[0] + d * Math.sin(n * 2.4), p[1] + d * Math.cos(n * 2.4)];
    L.circleMarker(ll, { radius: 5 + 15 * Math.sqrt(n0(c) / mx), color: "#fff", weight: 1.5, fillColor: c.card.call_first ? "var(--trade)" : "#3D6F8E", fillOpacity: .82 })
      .bindTooltip(`${esc(c.name)}: ${fmt(n0(c))}`).on("click", () => pick(c.firm_id, false)).addTo(pins);
    pts.push(ll); });
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.08)); else { map.setView(county === "Orange" ? [28.54, -81.38] : [25.76, -80.3], 10); $("#mapnote").textContent = "ZIP locations for this trade are still loading."; }
}
function pick(id, scroll) {
  const c = (cache[trade] || []).find(x => x.firm_id === id && x.county === county); if (!c) return; sel = id;
  document.querySelectorAll("#rows tr").forEach(r => r.classList.toggle("on", +r.dataset.id === id));
  if (scroll) { const r = document.querySelector(`#rows tr[data-id="${id}"]`); r && r.scrollIntoView({ block: "nearest" }); }
  const F = c.card.facts, get = re => (F.find(f => re.test(f.k)) || {}).v, p = pct(c);
  const z = c.card.pin ? c.card.pin[2] : "n/a", lic = c.card.licenses || [];
  $("#plate").innerHTML = `<span class="r1"></span><span class="r2"></span><p class="nm">${esc(c.name)}</p>
    <p class="sub">${esc(AREA[county])} ${TRADES.find(t => t[0] === trade)[1]}, rank ${c.rank}${c.card.area ? " of " + fmt(c.card.area.firms) : ""}${c.card.call_first ? ", Call First " + c.card.call_first : ""}</p>
    <dl><div><dt>License</dt><dd>${esc(lic[0] || "n/a")}${lic.length > 1 ? " +" + (lic.length - 1) : ""}</dd></div>
    <div><dt>First licensed</dt><dd>${esc(String(get(/^First license/) || "n/a").slice(0, 4))}</dd></div><div><dt>Busiest ZIP</dt><dd>${esc(z)}</dd></div>
    <div><dt>${UNIT[trade][0].toUpperCase() + UNIT[trade].slice(1)}, 12 months</dt><dd>${fmt(n0(c))}</dd></div><div><dt>Against prior year</dt><dd>${p === null ? "New" : (p >= 0 ? "+" : "−") + Math.abs(p) + "%"}</dd></div>
    <div><dt>Workers' comp sites</dt><dd>${esc(get(/^Workers/) || "n/a")}</dd></div><div><dt>Equipment on tax roll</dt><dd>${esc(get(/^Equipment/) || "n/a")}</dd></div>
    <div><dt>Trades licensed</dt><dd>${esc((c.card.trades || []).map(TL).join(", ") || "n/a")}</dd></div><div><dt>Match grade</dt><dd>${esc(c.card.match_grade[0].toUpperCase() + c.card.match_grade.slice(1))}</dd></div></dl>
    ${c.card.why && c.card.why.length ? `<p class="why">Why it stands out: ${c.card.why.map(esc).join("; ")}.</p>` : ""}
    <div class="acts"><button class="btn" id="wbtn">${watch.has(id) ? "Remove from watchlist" : "Add to watchlist"}</button><button class="btn quiet" id="abtn">Show work area</button></div>
    <p class="src">Sources: ${esc(SRC[county])}, FL DBPR licenses, FL workers' comp, FL DOR tangible property roll.</p>`;
  $("#wbtn").onclick = () => toggle(id); $("#abtn").onclick = () => workArea(c);
  area && area.clearLayers();
}
function workArea(c) {
  if (!map || !c.card.zips || !c.card.zips.length) return; area.clearLayers();
  const mx = Math.max(...c.card.zips.map(z => z[1]));
  c.card.zips.forEach(([z, n, la, lo]) => L.circle([la, lo], { radius: 700 + 1800 * Math.sqrt(n / mx), color: "var(--trade)", weight: 1, fillOpacity: .18 }).bindTooltip(`${esc(z)}: ${n}`).addTo(area));
  map.fitBounds(L.latLngBounds(c.card.zips.map(z => [z[2], z[3]])).pad(.3));
  $("#mapnote").textContent = `${c.name}: permits by ZIP, last 12 months. Circles show ZIP areas, not addresses.`;
}
async function toggle(id) {
  if (watch.has(id)) { await sb.from("tc_watch").delete().eq("firm_id", id); watch.delete(id); }
  else { if (watch.size >= 100) { $("#plate .src").textContent = "Your watchlist is full at 100 firms. Remove one to add another."; return; }
    const { error } = await sb.from("tc_watch").insert({ user_id: me.id, firm_id: id }); if (!error) watch.add(id); }
  tabs(); if (!(GROWTH_TRADES.has(trade) && view === "growth")) pick(id, false);
}
async function showWatch() {
  const rows = []; for (const [t] of TRADES) (await load(t)).forEach(c => { if (watch.has(c.firm_id)) rows.push(c); });
  const have = new Set(rows.map(c => c.firm_id)), rest = [...watch].filter(id => !have.has(id));
  if (rest.length) { const { data } = await sb.from("tc_firm_history").select("firm_id,county,trade,name,series").in("firm_id", rest).eq("trade", "hvac");
    (data || []).forEach(h => { const s = h.series, i = s.y.indexOf(s.full); rows.push({ firm_id: h.firm_id, county: h.county, trade: h.trade, name: h.name, rank: "", card: { n0: s.p ? s.p[i] : "", n1: "", match_grade: "", licenses: [] } }); }); }
  $("#main").innerHTML = `<div class="head"><h1>Watchlist</h1><button class="btn quiet" id="csv"${rows.length ? "" : " disabled"}>Download watchlist CSV</button></div>
    <section class="panel">${rows.length ? `<table class="wtable"><thead><tr><th>Firm</th><th>Trade</th><th>County</th><th>Rank</th><th>Last 12 mo</th><th>Change</th></tr></thead><tbody>${rows.map(c => { const p = pct(c);
      return `<tr><td>${esc(c.name)}</td><td>${TRADES.find(t => t[0] === c.trade)[1]}</td><td>${esc(AREA[c.county] || c.county)}</td><td>${c.rank}</td><td>${fmt(n0(c))}</td><td>${c.rank === "" ? "Five-year view" : p === null ? "New" : (p >= 0 ? "+" : "−") + Math.abs(p) + "%"}</td></tr>`; }).join("")}</tbody></table>`
      : '<p class="empty">No firms yet. Open a firm on any trade tab and press Add to watchlist.</p>'}</section>
    <p class="note" style="margin-top:14px">Up to 100 firms. The CSV holds your watchlist only, stamped with your email.</p>`;
  if (rows.length) $("#csv").onclick = () => {
    const head = ["firm", "trade", "county", "rank", "permits_12m", "permits_prior_12m", "match_grade", "licenses", "exported_by", "exported_at"];
    const out = rows.slice(0, 100).map(c => [c.name, c.trade, c.county, c.rank, n0(c), n1(c), c.card.match_grade, (c.card.licenses || []).join(" "), me.email, new Date().toISOString()]);
    const csv = [head, ...out].map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "tradecount-watchlist.csv"; a.click(); };
}

/* ---------- Five-year growth view ---------- */
const money = v => v == null ? "" : v >= 1e6 ? "$" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "k" : "$" + v;
const toggle_ = () => `<div class="seg" role="group" aria-label="View"><button data-v="growth" aria-pressed="${view === "growth"}">Five-year growth</button><button data-v="year" aria-pressed="${view !== "growth"}">Last 12 months</button></div>`;
function wireToggle() { document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { view = b.dataset.v; sel = null; show(); }); }
async function loadHist(c, t) {
  const k = c + "|" + t; if (hist[k]) return hist[k];
  let all = [], from = 0;
  for (;;) { const { data, error } = await sb.from("tc_firm_history").select("firm_id,county,trade,name,since,coverage,growth_rank,score,series")
      .eq("county", c).eq("trade", t).order("growth_rank", { ascending: true, nullsFirst: false }).order("firm_id").range(from, from + 999);
    if (error || !data) break; all = all.concat(data); if (data.length < 1000) break; from += 1000; }
  return hist[k] = all;
}
function lead(h) {
  const s = h.series, y0 = s.y[0], i0 = 0, iF = s.y.indexOf(s.full), last = s.y.length - 1, up = s.up || [];
  if (up.includes("permits")) return [`${fmt(s.p[i0])} to ${fmt(s.p[iF])} permits`, `${y0} to ${s.full}`];
  if (up.includes("comp sites")) return [`${s.wc[i0] || 0} to ${s.wc[last]} comp sites`, `${y0} to now`];
  if (up.includes("equipment")) { const e = s.eq.filter(v => v).pop(); return [`${money(s.eq[i0])} to ${money(e)} equipment`, `${y0} to latest roll`]; }
  return ["", ""];
}
async function showGrowth() {
  const label = TRADES.find(t => t[0] === trade)[1], opts = counties.map(c => `<option value="${esc(c)}" ${c === county ? "selected" : ""}>${esc(AREA[c])}</option>`).join("");
  $("#main").innerHTML = `<div class="head"><h1>${label} in<select id="cty" aria-label="County">${opts}</select></h1>${toggle_()}</div><section class="panel"><p class="empty">Loading the five-year record…</p></section>`;
  $("#cty").onchange = e => { county = e.target.value; sel = null; q = ""; show(); }; wireToggle();
  const hs = await loadHist(county, trade);
  if (!hs.length) { $("#main .panel").innerHTML = `<p class="empty">No five-year record for ${esc(AREA[county])} yet.</p>`; return; }
  const ranked = hs.filter(h => h.growth_rank), withRec = hs.filter(h => h.coverage !== "thin").length, y0 = hs[0].series.y[0], hasP = !!COV[county];
  $("#main").innerHTML = `<div class="head"><h1>${label} in<select id="cty" aria-label="County">${opts}</select></h1>${toggle_()}
    <dl class="facts"><div><dt>Licensed ${label} firms</dt><dd>${fmt(hs.length)}</dd></div><div><dt>With a five-year record</dt><dd>${fmt(withRec)}</dd></div>
    <div><dt>Growing on the record</dt><dd>${fmt(ranked.length)}</dd></div><div><dt>What we can see here</dt><dd class="cov ${hasP ? "p" : ""}">${hasP ? "Permits and state records" : "State records only"}</dd></div></dl></div>
    <p class="covnote">${esc(COV[county] || COV_STATE)}</p>
    <div class="lower g5">
      <section class="panel"><div class="ph"><h2>Fastest growing, ${y0} to now</h2><input id="find" type="search" placeholder="Find any ${label} firm" aria-label="Find a firm" value="${esc(q)}"></div>
        <div class="listwrap"><table class="rank grow"><thead><tr><th></th><th>Firm</th><th>What grew</th><th>Start to now</th></tr></thead><tbody id="rows"></tbody></table></div></section>
      <section class="panel"><div class="ph"><h2>Five-year record</h2><span>Pick a firm on the list</span></div><div class="plate" id="plate"><span class="r1"></span><span class="r2"></span></div></section>
    </div>
    <p class="note">Ranked by how many signals grew from ${y0} to now and by how much: ${hasP ? "permits pulled (full years), " : ""}workers' comp work sites and equipment on the county tax roll. A firm needs real size to rank: ${hasP ? "20 or more permits in its last full year, " : ""}2 or more comp sites, or $50k or more in equipment. Florida DBPR licenses, FL workers' comp, FL DOR tangible property roll${hasP ? ", " + esc(SRC[county]) : ""}. Growth and activity only; nothing here predicts a sale.</p>`;
  $("#cty").onchange = e => { county = e.target.value; sel = null; q = ""; show(); }; wireToggle();
  const draw = () => {
    const term = q.trim().toUpperCase(), list = term ? hs.filter(h => h.name.toUpperCase().includes(term)).slice(0, 100) : ranked.slice(0, 100);
    $("#rows").innerHTML = list.length ? list.map(h => { const [a, b] = lead(h), g = GRADE[h.coverage];
      return `<tr data-id="${h.firm_id}"><td>${h.growth_rank || ""}</td><td>${esc(h.name)}${h.coverage === "thin" ? `<span class="thin" title="${g[1]}">Thin record</span>` : ""}</td>
      <td class="chips">${(h.series.up || []).map(u => `<i>${esc(u[0].toUpperCase() + u.slice(1))}</i>`).join("") || '<span class="dn">None on file</span>'}</td><td>${esc(a)}${b ? `<small>${esc(b)}</small>` : ""}</td></tr>`; }).join("")
      : `<tr><td></td><td colspan="3" class="dn">${term ? "No firm by that name in this county." : "No firm grew on the record here."}</td></tr>`;
    $("#rows").onclick = e => { const r = e.target.closest("tr[data-id]"); if (r) pickH(+r.dataset.id, hs); };
    if (list.length) pickH(sel && hs.some(h => h.firm_id === sel) ? sel : list[0].firm_id, hs);
  };
  $("#find").oninput = e => { q = e.target.value; draw(); };
  draw();
}
function bars(title, ys, vals, f, full, note) {
  const has = vals && vals.some(v => v), mx = Math.max(1, ...(vals || []).map(v => v || 0)), w = 300 / ys.length;
  if (!has) return `<figure class="tl"><figcaption>${title}</figcaption><p class="none">${note || "None on file"}</p></figure>`;
  return `<figure class="tl"><figcaption>${title}</figcaption><svg viewBox="0 0 300 96" role="img" aria-label="${esc(title)} by year">${ys.map((y, i) => {
    const v = vals[i], h = v ? Math.max(2, 52 * v / mx) : 0, x = i * w + 6, part = y > full;
    return `${v ? `<rect x="${x}" y="${74 - h}" width="${w - 12}" height="${h}" rx="2" class="${part ? "part" : ""}"></rect><text x="${x + (w - 12) / 2}" y="${68 - h}" class="v">${esc(f(v))}</text>`
      : `<line x1="${x}" x2="${x + w - 12}" y1="74" y2="74" class="nil"></line>`}<text x="${x + (w - 12) / 2}" y="90" class="yr">${y}${part ? "*" : ""}</text>`; }).join("")}</svg></figure>`;
}
function pickH(id, hs) {
  const h = hs.find(x => x.firm_id === id); if (!h) return; sel = id;
  document.querySelectorAll("#rows tr").forEach(r => r.classList.toggle("on", +r.dataset.id === id));
  const s = h.series, g = GRADE[h.coverage], full = s.full, part = s.y[s.y.length - 1] > full;
  $("#plate").innerHTML = `<span class="r1"></span><span class="r2"></span><p class="nm">${esc(h.name)}</p>
    <p class="sub">${esc(AREA[county])} ${TRADES.find(t => t[0] === trade)[1]}${h.growth_rank ? ", number " + h.growth_rank + " fastest growing" : ""}${h.since ? ", licensed by " + h.since : ""}</p>
    <p class="grade ${h.coverage}"><b>${g[0]}</b> ${g[1]}.</p>
    <div class="tls">${s.p ? bars("Permits pulled", s.y, s.p, fmt, full, "No permits matched to this firm's license") : ""}
      ${bars("Workers' comp work sites", s.y, s.wc, v => String(v), 9999, "No workers' comp policy under this name. Many small firms carry none.")}
      ${bars("Equipment on the tax roll", s.y, s.eq, money, 9999, "No equipment filing under this name")}
      ${bars("Active trade licenses", s.y, s.lic, v => String(v), 9999)}</div>
    ${part && s.p ? `<p class="src">*${s.y[s.y.length - 1]} permits run through today, so the year isn't complete.</p>` : ""}
    <div class="acts"><button class="btn" id="wbtn">${watch.has(id) ? "Remove from watchlist" : "Add to watchlist"}</button></div>
    <p class="src">Comp sites are policies in force at year end. Equipment is the final county roll for that year. ${s.p ? esc(SRC[county]) + " are counted by the license that pulled them." : ""}</p>`;
  $("#wbtn").onclick = async () => { await toggle(id); pickH(id, hs); };
}
start();
