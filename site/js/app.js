/* Reading the City — static demo of the GeoAI Morpho-Risque prototype. No server, no model: pre-computed data only. */
(function () {
  "use strict";
  const CLASSES = ["très faible", "faible", "moyen", "fort", "très fort"];
  const RISK_COL = ["--risk-1", "--risk-2", "--risk-3", "--risk-4", "--risk-5"].map(cssVar);
  const DEPTH_COL = ["--depth-0", "--depth-1", "--depth-2", "--depth-3"].map(cssVar);
  const AUDIT_COL = cssVar("--audit");
  const DEPTH_BREAKS = [0.05, 0.3, 1.0];
  const CHIPS = ["tuile", "sam3", "contexte", "hydro", "figure_fond"];

  const state = {
    lang: pick(() => localStorage.getItem("rtc_lang"), "en"),
    run: null, tab: "overview", colorBy: "risk", showBld: true, cell: null,
    rain: { p: 100, arc: "moyen", h100: 1.0 },
  };
  const loaded = {};
  let map, cellLayer, bldLayer, rainMap, rainLayer;

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function pick(f, d) { try { return f() || d; } catch (e) { return d; } }
  const T = (k, ...a) => { const v = (I18N[state.lang] || I18N.en)[k] ?? I18N.en[k]; return typeof v === "function" ? v(...a) : v; };
  const L = (v) => {
    if (v == null) return "—";
    const s = String(v);
    return state.lang === "en" ? (VALUE_LABELS.en[s] || s.replace(/_/g, " ")) : s.replace(/_/g, " ");
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d = 0) => v == null || Number.isNaN(v) ? "—" :
    Number(v).toLocaleString(state.lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (v) => v == null ? "—" : nf(v * 100) + " %".replace(" ", state.lang === "fr" ? " " : "");
  const run = () => loaded[state.run];

  /* ------------------------------------------------------------------ data loading (works from file:// too) */
  function loadRun(id) {
    if (loaded[id]) return Promise.resolve(loaded[id]);
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `data/${id}/data.js`;
      s.onload = () => { loaded[id] = window.RUNS[id]; res(loaded[id]); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------------ chrome */
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = T(el.dataset.i18nHtml); });
    document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
    document.title = `${T("app_title")} — Kinshasa`;
    const sel = document.getElementById("runSelect");
    sel.innerHTML = RUN_INDEX.map((r) => `<option value="${r.id}">${esc(r.quartier)} · ${esc(r.commune)}${r.rue ? " · " + (state.lang === "fr" ? "ciel + rue" : "sky + street") : ""}</option>`).join("");
    sel.value = state.run;
  }

  function setTab(t) {
    state.tab = t;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === t));
    try { history.replaceState(null, "", `#${t}/${state.run}`); } catch (e) { /* file:// */ }
    render();
  }

  function render() {
    if (!run()) return;
    ({ overview: renderOverview, explore: renderExplore, street: renderStreet, rain: renderRain,
       reliability: renderReliability, method: renderMethod, contact: renderContact })[state.tab]();
  }

  /* ------------------------------------------------------------------ overview */
  function kpiTile(v, l, n, flag) {
    return `<div class="kpi${flag ? " flag" : ""}"><div class="v">${v}</div><div class="l">${esc(l)}</div>${n ? `<div class="n">${esc(n)}</div>` : ""}</div>`;
  }
  function renderOverview() {
    const d = run(), k = d.kpi, r = d.run;
    const tiles = [
      kpiTile(`${nf(k.area_km2, 2)} km²`, T("k_area"), T("ov_where", r.quartier, r.commune)),
      kpiTile(nf(k.cells), T("k_cells"), `${k.cells_read} ${T("k_read")}`),
      kpiTile(nf(k.buildings), T("k_buildings"), `${nf(k.low_buildings)} ${T("k_low")}`),
      kpiTile(nf(k.population), T("k_pop"), "WorldPop"),
      kpiTile(pct(k.fabric_agreement), T("k_agree"), `${k.cells_read} ${T("k_read")}`),
      kpiTile(pct(k.audit_share), T("k_audit"), T("k_audit_n", k.audit_n, k.cells), true),
      kpiTile(k.vlm_reliability == null ? "—" : nf(k.vlm_reliability * 0.3, 2) + " / " + nf(0.3, 2), T("k_rel"),
        k.vlm_reliability === 0 ? T("k_rel_zero") : T("k_rel_n"), k.vlm_reliability === 0),
      r.rue ? kpiTile(nf(k.changed_by_street), T("k_street"), T("k_street_n", k.street_cells))
            : kpiTile("—", T("k_street"), T("k_nostreet")),
    ].join("");
    const max = Math.max(1, ...CLASSES.map((c) => k.classes[c] || 0));
    const bars = CLASSES.map((c, i) => {
      const n = k.classes[c] || 0;
      return `<div class="bar-row" data-tip="${esc(L(c))}: ${n} / ${k.cells}"><span>${esc(L(c))}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(n / max) * 100}%;background:${RISK_COL[i]}"></div></div>
        <span class="c">${n}</span></div>`;
    }).join("");
    const rows = RUN_INDEX.map((ri) => {
      const kk = ri.kpi;
      return `<tr class="${ri.id === state.run ? "cur" : ""}" data-run="${ri.id}" style="cursor:pointer">
        <td>${esc(ri.quartier)} <span class="hint">${esc(ri.commune)}</span></td><td class="num">${kk.cells}</td>
        <td class="num">${nf(kk.buildings)}</td><td class="num">${nf(kk.population)}</td>
        <td class="num">${pct(kk.fabric_agreement)}</td><td class="num">${pct(kk.audit_share)}</td>
        <td class="num">${kk.rho_observed ? nf(kk.rho_observed.rho, 2) : esc(T("na"))}</td>
        <td>${ri.rue ? T("yes") : T("no")}</td></tr>`;
    }).join("");
    document.getElementById("overview").innerHTML = `
      <h2>${esc(T("ov_where", r.quartier, r.commune))}</h2>
      <p class="lead">${esc(T("ov_lead"))}</p>
      <div class="kpis">${tiles}</div>
      <div class="grid g2">
        <div class="card"><h3 style="margin-top:0">${esc(T("risk_dist"))}</h3><div class="bars">${bars}</div></div>
        <div class="card"><h3 style="margin-top:0">${esc(T("ov_next"))}</h3>
          <ul>${T("ov_next_list").map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <h3>${esc(T("all_runs"))}</h3>
      <div class="card" style="overflow-x:auto"><table class="t"><thead><tr><th>${T("th_nb")}</th><th class="num">${T("th_cells")}</th>
        <th class="num">${T("th_bld")}</th><th class="num">${T("th_pop")}</th><th class="num">${T("th_agree")}</th>
        <th class="num">${T("th_audit")}</th><th class="num">${T("th_obs")}</th><th>${T("th_street")}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    document.querySelectorAll("#overview tr[data-run]").forEach((tr) => tr.addEventListener("click", () => switchRun(tr.dataset.run)));
  }

  /* ------------------------------------------------------------------ explore */
  function baseLayers(m) {
    const esri = L_.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "Imagery © Esri" }).addTo(m);
    const osm = L_.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap contributors" });
    L_.control.layers({ "Esri imagery": esri, OpenStreetMap: osm }, null, { position: "topright" }).addTo(m);
  }
  const L_ = window.L;

  function cellColor(p) {
    if (state.colorBy === "risk") { const i = CLASSES.indexOf(p.classe_risque); return i < 0 ? "#999" : RISK_COL[i]; }
    if (state.colorBy === "vuln") { const v = p.vuln_percue_vlm; return v == null ? "#9a9994" : RISK_COL[Math.max(0, Math.min(4, Math.round(v) - 1))]; }
    return p.a_auditer_v4 ? AUDIT_COL : "#c9c8c3";
  }
  function legendHtml() {
    if (state.colorBy === "risk")
      return `<b>${T("lg_risk")}</b>` + CLASSES.map((c, i) => `<div class="row"><span class="sw" style="background:${RISK_COL[i]}"></span>${esc(L(c))}</div>`).join("");
    if (state.colorBy === "vuln")
      return `<b>${T("lg_vuln")}</b>` + [1, 2, 3, 4, 5].map((v, i) => `<div class="row"><span class="sw" style="background:${RISK_COL[i]}"></span>${v}</div>`).join("") +
        `<div class="row"><span class="sw" style="background:#9a9994"></span>${T("lg_na")}</div>`;
    return `<b>${T("lg_audit")}</b><div class="row"><span class="sw" style="background:${AUDIT_COL}"></span>${T("lg_audit_yes")}</div>
      <div class="row"><span class="sw" style="background:#c9c8c3"></span>${T("lg_audit_no")}</div>`;
  }

  function renderExplore() {
    const d = run();
    if (!map) {
      map = L_.map("map", { zoomControl: true, preferCanvas: false });
      baseLayers(map);
    }
    map.invalidateSize();
    if (cellLayer) cellLayer.remove();
    if (bldLayer) bldLayer.remove();
    bldLayer = L_.geoJSON(d.buildings, { interactive: false,
      style: { color: "#ffffff", weight: 0.8, fillOpacity: 0, opacity: 0.85 } });
    cellLayer = L_.geoJSON(d.cells, {
      style: (f) => ({ color: f.properties.h3 === state.cell ? "#0b0b0b" : "#fcfcfb", weight: f.properties.h3 === state.cell ? 3 : 1.2,
        fillColor: cellColor(f.properties), fillOpacity: f.properties.h3 === state.cell ? 0.3 : 0.5 }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindTooltip(`<b>${esc(L(p.classe_risque))}</b> · ${T("s_risk").toLowerCase()} ${nf(p.risque_v4, 2)}${p.a_auditer_v4 ? " · " + T("lg_audit_yes") : ""}`, { sticky: true });
        lyr.on("click", () => { state.cell = p.h3; renderExplore(); });
      },
    }).addTo(map);
    if (state.showBld) bldLayer.addTo(map);
    if (!map._fitted || map._fitted !== state.run) { map.fitBounds(cellLayer.getBounds(), { padding: [20, 20] }); map._fitted = state.run; }
    document.getElementById("legend").innerHTML = legendHtml();
    document.querySelectorAll("#colorBy button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.colorBy));
    renderCellPanel();
  }

  function aiField(k, v) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
    const val = Array.isArray(v) ? v.map((x) => `<span class="pill">${esc(L(x))}</span>`).join("") : esc(typeof v === "string" ? v : L(v));
    return `<div class="k">${esc(T(k))}</div><p>${val}</p>`;
  }
  function renderCellPanel() {
    const el = document.getElementById("cellPanel");
    const f = run().cells.features.find((x) => x.properties.h3 === state.cell);
    if (!f) { el.innerHTML = `<div class="empty">${esc(T("click_cell"))}</div>`; return; }
    const p = f.properties, v = (p.vlm && p.vlm.final) || {}, o = (p.vlm && p.vlm.observation) || {};
    const ci = CLASSES.indexOf(p.classe_risque);
    const chips = (p.chips || []).map((k) => `<figure><img src="data/${state.run}/img/${p.h3}_${k}.jpg" alt="${esc(T("chip_" + k))}" data-cap="${esc(T("chip_" + k))}"><figcaption>${esc(T("chip_" + k))}</figcaption></figure>`).join("");
    const meter = (x) => `<div class="meter"><div style="width:${Math.max(0, Math.min(1, x || 0)) * 100}%"></div></div>`;
    const vvlm = p.vuln_percue_vlm != null ? (p.vuln_percue_vlm - 1) / 4 : null;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <h3 style="margin:0">${T("cell")} <span class="hint">${p.h3}</span></h3>
        <span class="pill" style="background:${ci >= 0 ? RISK_COL[ci] : "#ccc"};color:${ci >= 2 ? "#fff" : "#0b0b0b"}">${esc(L(p.classe_risque))}</span>
      </div>
      ${p.a_auditer_v4 ? `<p><span class="pill audit">${esc(T("audit_yes"))}</span><span class="hint">${esc(T("audit_why"))}</span></p>` : ""}
      <h4>${esc(T("images"))}</h4><div class="chips">${chips}</div>
      <h4>${esc(T("ai_reading"))} <span class="pill ai">${esc(T("ai_label"))}</span></h4>
      <div class="ai-block">
        <div class="k">${esc(T("f_fabric"))}</div><p>${esc(L(v.tissu || p.tissu_vlm))} · ${esc(T("f_vuln"))} <b>${v.vulnerabilite_percue ?? p.vuln_percue_vlm ?? "—"}/5</b> · ${esc(T("f_conf"))} ${esc(L(v.confiance ?? p.confiance_vlm))}</p>
        ${aiField("f_factors", v.facteurs_aggravants)}${aiField("f_caps", v.capacites)}
        ${aiField("f_hyp", v.hypothese_eau)}${aiField("f_scen", v.scenario_forte_pluie)}${aiField("f_reco", v.recommandation)}
        ${aiField("f_just", v.justification)}${aiField("f_check", v.a_verifier_terrain)}
        ${o.description ? `<details><summary class="hint">${esc(T("f_obs"))}</summary><p>${esc(o.description)}</p></details>` : ""}
      </div>
      <h4>${esc(T("score"))}</h4>
      <div class="score">
        <span>${esc(T("s_hazard"))}</span><span class="v">${nf(p.alea, 2)}</span>${meter(p.alea)}
        <span>${esc(T("s_vmes"))}</span><span class="v">${nf(p.vuln_mesuree, 2)}</span>${meter(p.vuln_mesuree)}
        <span>${esc(T("s_vvlm"))}</span><span class="v">${vvlm == null ? "—" : nf(vvlm, 2)}</span>${meter(vvlm)}
        <span>${esc(T("s_w"))}</span><span class="v">${nf(p.poids_vlm_effectif, 2)}</span>${meter(p.poids_vlm_effectif / 0.3)}
        <span><b>${esc(T("s_v"))}</b></span><span class="v"><b>${nf(p.vulnerabilite_v4, 2)}</b></span>${meter(p.vulnerabilite_v4)}
        <span><b>${esc(T("s_risk"))}</b></span><span class="v"><b>${nf(p.risque_v4, 3)}</b></span>${meter(p.risque_v4 / 0.6)}
        <span>${esc(T("s_unc"))}</span><span class="v">± ${nf(p.incertitude_v4, 2)}</span>
      </div>
      <div class="formula" style="margin-top:8px">V = (1 − w)·V<sub>mes</sub> + w·V<sub>AI</sub> · risk = hazard × (0.4 + 0.6·V)</div>
      <h4>${esc(T("measures"))}</h4>
      <dl class="dl">
        <dt>${T("m_hand")}</dt><dd>${nf(p.hand_m, 1)} m</dd>
        <dt>${T("m_built")}</dt><dd>${pct(p.emprise_bati)}</dd>
        <dt>${T("m_dens")}</dt><dd>${nf(p.densite_bat_ha, 1)} /ha</dd>
        <dt>${T("m_low")}</dt><dd>${pct(p.part_bati_bas)}</dd>
        <dt>${T("m_road")}</dt><dd>${pct(p.part_road)}</dd>
        <dt>${T("m_open")}</dt><dd>${pct(p.espace_ouvert)}</dd>
        <dt>${T("m_imperv")}</dt><dd>${pct(p.imperv_micro)}</dd>
        <dt>${T("m_pop")}</dt><dd>${nf(p.pop_ha)} /ha</dd>
        <dt>${T("m_assets")}</dt><dd>${nf(p.n_enjeux)}</dd>
        <dt>${T("m_health")}</dt><dd>${nf(p.dist_sante_m)} m</dd>
        <dt>${T("m_refuge")}</dt><dd>${nf(p.dist_refuge_m)} m</dd>
        <dt>${T("m_clay")}</dt><dd>${nf(p.argile_pct)} %</dd>
        <dt>${T("m_obs")}</dt><dd>${pct(p.p_inond_composite)}</dd>
      </dl>`;
    el.querySelectorAll(".chips img").forEach((img) => img.addEventListener("click", () => lightbox(img.src, img.dataset.cap)));
  }

  function lightbox(src, cap) {
    const lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = `<div><img src="${src}" alt=""><div>${esc(cap || "")}</div></div>`;
    lb.addEventListener("click", () => lb.remove());
    document.body.appendChild(lb);
  }

  /* ------------------------------------------------------------------ sky vs street */
  function renderStreet() {
    const d = run(), el = document.getElementById("street");
    if (!d.run.rue) { el.innerHTML = `<h2>${esc(T("tab_street"))}</h2><p class="lead">${esc(T("st_lead"))}</p><div class="card">${esc(T("st_none"))}</div>`; return; }
    const ag = d.agreement || [];
    const cols = ag.length ? Object.keys(ag[0]) : [];
    const agTable = ag.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th>${esc(L(c))}</th>`).join("")}</tr></thead>
      <tbody>${ag.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] === "NaN" ? "—" : /^[\d.]+$/.test(r[c]) ? r[c] : L(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";
    const cards = d.cells.features.filter((f) => f.properties.street).sort((a, b) => (b.properties.risque_v4 || 0) - (a.properties.risque_v4 || 0)).map((f) => {
      const p = f.properties, s = p.street;
      const photos = s.photo_files && s.photo_files.some(Boolean)
        ? s.photo_files.filter(Boolean).map((fn) => `<img src="data/${state.run}/img/${fn}" alt="street photo" data-cap="© Mapillary contributors, CC BY-SA 4.0">`).join("")
        : "";
      const links = s.photos.map((id) => `<a href="https://www.mapillary.com/app/?pKey=${id}" target="_blank" rel="noopener">${esc(T("st_open"))} ↗</a>`).join("");
      return `<div class="card scard">
        <div class="imgs"><img src="data/${state.run}/img/${p.h3}_tuile.jpg" alt="aerial" data-cap="${esc(T("chip_tuile"))}">${photos}
          <div class="photo-links">${links}</div></div>
        <div>
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${T("cell")} <span class="hint">${p.h3}</span></b>
            <span>${p.avis_change_rue ? `<span class="chg">● ${esc(T("st_changed"))}</span>` : ""} <span class="pill">${esc(L(p.classe_risque))}</span></span></div>
          <table class="t" style="margin-top:6px"><thead><tr><th></th><th>${T("st_sky")}</th><th>${T("st_street")}</th><th>${T("st_final")}</th></tr></thead>
            <tbody>${s.rows.map((r) => `<tr><td><b>${esc(L(r[0]))}</b></td>${r.slice(1).map((x) => `<td>${esc(String(x ?? "—").includes(" : ") ? String(x).replace(/_/g, " ") : String(x ?? "—").split(";").map(L).join(", "))}</td>`).join("")}</tr>`).join("")}</tbody></table>
          <div class="ai-block"><span class="pill ai">${esc(T("ai_label"))}</span>
            <div class="k">${esc(T("st_street"))} · ${esc(T("st_date"))} ${esc(s.date || "")}</div><p>${esc(s.street_text || "")}</p>
            <div class="k">${esc(T("f_just"))}</div><p>${esc(s.justification || "")}</p></div>
        </div></div>`;
    }).join("");
    el.innerHTML = `<h2>${esc(T("tab_street"))}</h2><p class="lead">${esc(T("st_lead"))}</p>
      <div class="note" style="margin-bottom:14px">${esc(T("st_cov"))}</div>
      <h3>${esc(T("st_agree"))}</h3><div class="card" style="overflow-x:auto">${agTable}</div>
      <h3>${esc(T("st_photos"))}</h3>${cards}`;
    el.querySelectorAll(".imgs img").forEach((img) => img.addEventListener("click", () => lightbox(img.src, img.dataset.cap)));
  }

  /* ------------------------------------------------------------------ rainfall scenario (port of restitution.scenario) */
  function scs(p, cn) {
    cn = Math.min(99, Math.max(30, cn));
    const s = 25400 / cn - 254;
    return p > 0.2 * s ? (p - 0.2 * s) ** 2 / (p + 0.8 * s) : 0;
  }
  function cnUrb(c, arc, hasArc) {
    const imp = c.imperv_micro ?? 0.5;
    const cn = (hasArc ? c["cn_" + arc] : c.cn_sol) ?? 85;
    return Math.min(99, Math.max(30, imp * 98 + (1 - imp) * cn));
  }
  const r1 = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  function scenario(d, p, arc, h100) {
    const cells = d.cells.features.map((f) => f.properties);
    const hasArc = cells.some((c) => ("cn_" + arc) in c);
    const hasRef = cells.some((c) => "cn_moyen" in c);
    const byCell = {};
    cells.forEach((c) => {
      const cn = r1(cnUrb(c, arc, hasArc), 1), cnRef = cnUrb(c, "moyen", hasRef);
      const q = scs(p, cn), q100 = scs(100, cnRef);
      byCell[c.h3] = { h: r1(q100 > 0 ? h100 * (q / q100) ** 0.6 : 0, 2), pop: c.pop_cellule || 0, n: 0, wet: 0 };
    });
    let wet = 0, deep = 0, low = 0;
    const depth = d.buildings.features.map((f) => {
      const b = f.properties, c = byCell[b.h3];
      const z = b.hand_m == null || !c ? null : r1(Math.max(0, c.h - b.hand_m), 2);
      const t = (z || 0) > DEPTH_BREAKS[0];
      if (c) { c.n++; if (t) c.wet++; }
      if (t) { wet++; if (b.classe_hauteur === "bas") low++; }
      if (z > 1) deep++;
      return z;
    });
    let popWet = 0;
    Object.values(byCell).forEach((c) => { popWet += Math.round(c.pop * (c.n ? r1(c.wet / c.n, 2) : 0)); });
    return { depth, wet, deep, low, popWet, total: d.buildings.features.length };
  }
  const depthClass = (z) => z == null || z <= DEPTH_BREAKS[0] ? 0 : z <= DEPTH_BREAKS[1] ? 1 : z <= DEPTH_BREAKS[2] ? 2 : 3;

  function renderRain() {
    const d = run(), s = state.rain;
    if (!rainMap) { rainMap = L_.map("rainMap"); baseLayers(rainMap); }
    rainMap.invalidateSize();
    const res = scenario(d, s.p, s.arc, s.h100);
    if (!rainLayer || rainLayer._run !== state.run) {
      if (rainLayer) rainLayer.remove();
      rainLayer = L_.geoJSON(d.buildings, { interactive: false }).addTo(rainMap);
      rainLayer._run = state.run;
    }
    let i = 0;
    rainLayer.eachLayer((lyr) => {
      const k = depthClass(res.depth[i++]);
      lyr.setStyle({ color: "#fcfcfb", weight: 0.5, fillColor: DEPTH_COL[k], fillOpacity: k ? 0.9 : 0.55 });
    });
    if (rainMap._fitted !== state.run) { rainMap.fitBounds(rainLayer.getBounds(), { padding: [20, 20] }); rainMap._fitted = state.run; }
    document.getElementById("rainLegend").innerHTML = [0, 1, 2, 3].map((k) => `<div class="row"><span class="sw" style="background:${DEPTH_COL[k]}"></span>${esc(T("d" + k))}</div>`).join("");
    const cmp = ["sec", "moyen", "humide"].map((a) => { const x = scenario(d, s.p, a, s.h100); return `<tr class="${a === s.arc ? "cur" : ""}"><td>${esc(T("soil_" + a))}</td><td class="num">${x.wet}</td><td class="num">${x.deep}</td><td class="num">${x.low}</td><td class="num">${nf(x.popWet)}</td></tr>`; }).join("");
    const panel = document.getElementById("rainPanel");
    const key = state.run + state.lang;
    if (panel.dataset.key !== key) {          // build controls once per run/language; sliders are never re-created
      panel.dataset.key = key;
      panel.innerHTML = `
        <h3 style="margin-top:0">${esc(T("tab_rain"))}</h3>
        <p class="hint">${esc(T("rain_lead"))}</p>
        <div class="field"><label>${esc(T("rain_mm"))} : <b id="rainPv"></b></label>
          <input class="slider" type="range" min="0" max="200" step="5" value="${s.p}" id="rainP"></div>
        <div class="field"><label>${esc(T("soil"))}</label><div class="seg" id="rainArc">
          ${["sec", "moyen", "humide"].map((a) => `<button data-arc="${a}">${esc(T("soil_" + a))}</button>`).join("")}</div></div>
        <div id="rainOut"></div>
        <div class="field"><label>${esc(T("h100"))} : <b id="rainHv"></b></label>
          <input class="slider" type="range" min="0.3" max="2" step="0.1" value="${s.h100}" id="rainH">
          <div class="note">${esc(T("h100_hint"))}</div></div>
        <p>${d.has_vue3d ? `<a href="data/${state.run}/vue3d.html" target="_blank" rel="noopener">${esc(T("r_3d"))} ↗</a>` : ""}
          ${d.has_planche ? ` · <a href="data/${state.run}/planche.jpg" target="_blank" rel="noopener">${esc(T("r_poster"))} ↗</a>` : ""}</p>`;
      panel.querySelector("#rainP").addEventListener("input", (e) => { s.p = +e.target.value; renderRain(); });
      panel.querySelector("#rainH").addEventListener("input", (e) => { s.h100 = +e.target.value; renderRain(); });
      panel.querySelectorAll("#rainArc button").forEach((b) => b.addEventListener("click", () => { s.arc = b.dataset.arc; renderRain(); }));
    }
    panel.querySelector("#rainPv").textContent = `${s.p} mm`;
    panel.querySelector("#rainHv").textContent = `${nf(s.h100, 1)} m`;
    panel.querySelectorAll("#rainArc button").forEach((b) => b.classList.toggle("on", b.dataset.arc === s.arc));
    panel.querySelector("#rainOut").innerHTML = `
      <div class="kpis" style="grid-template-columns:1fr 1fr">
        ${kpiTile(nf(res.wet), T("r_bld"), T("r_of", res.total))}
        ${kpiTile(nf(res.popWet), T("r_pop"), "")}
        ${kpiTile(nf(res.deep), T("r_deep"), "")}
        ${kpiTile(nf(res.low), T("r_low"), "")}
      </div>
      <h4>${esc(T("r_cmp"))} (${s.p} mm)</h4>
      <table class="t"><thead><tr><th>${T("soil")}</th><th class="num">${T("r_bld")}</th><th class="num">&gt; 1 m</th><th class="num">${T("m_low")}</th><th class="num">${T("th_pop")}</th></tr></thead><tbody>${cmp}</tbody></table>`;
  }

  /* ------------------------------------------------------------------ reliability */
  function renderReliability() {
    const k = run().kpi;
    const rho = (x) => x ? `${nf(x.rho, 2)} <span class="hint">(p ${x.p < 0.001 ? "< " + nf(0.001, 3) : "= " + nf(x.p, 2)})</span>` : esc(T("na"));
    const rows = [
      ["v_agree", pct(k.fabric_agreement)], ["v_incoh", `${k.incoherent} / ${k.cells_read}`],
      ["v_rho_obs", rho(k.rho_observed)], ["v_rho_v3", rho(k.rho_v3)],
      ["v_audit", `${pct(k.audit_share)} <span class="hint">(${k.audit_n} / ${k.cells})</span>`],
      ["v_rel", k.vlm_reliability == null ? "—" : nf(k.vlm_reliability, 2)],
      ["v_neigh", `${k.changed_by_neighbours} / ${k.cells_read}`],
      ...(run().run.rue ? [["v_street", `${k.changed_by_street} / ${k.street_cells}`]] : []),
    ].map(([key, v]) => `<tr><td>${esc(T(key))}</td><td class="num">${v}</td><td class="hint">${esc(T(key + "_r"))}</td></tr>`).join("");
    document.getElementById("reliability").innerHTML = `
      <h2>${esc(T("tab_reliability"))} — ${esc(run().run.quartier)}</h2><p class="lead">${esc(T("rel_lead"))}</p>
      <h3>${esc(T("rel_tab"))}</h3>
      <div class="card" style="overflow-x:auto"><table class="t"><thead><tr><th>${T("th_ind")}</th><th class="num">${T("th_val")}</th><th>${T("th_read")}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3 style="margin-top:0">${esc(T("rel_limits"))}</h3><ul>${T("rel_limits_list").map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="card"><h3 style="margin-top:0">${esc(T("rel_pilot"))}</h3><ul>${T("rel_pilot_list").map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>`;
  }

  /* ------------------------------------------------------------------ method */
  function renderMethod() {
    document.getElementById("method").innerHTML = `
      <h2>${esc(T("tab_method"))}</h2><p class="lead">${esc(T("me_lead"))}</p>
      <ol class="steps">${T("me_steps").map(([h, t, ai]) => `<li class="${ai ? "ai" : ""}"><b>${esc(h)}</b>${ai ? ` <span class="pill ai">frontier AI</span>` : ""}<br><span>${esc(t)}</span></li>`).join("")}</ol>
      <h3>${esc(T("me_formula"))}</h3>
      <div class="formula">V_measured = ⅓ (exposure + sensitivity + 1 − capacity)<br>
        V = (1 − w) · V_measured + w · V_AI,  w = 0.3 × reliability × confidence<br>
        risk = hazard × (1 − 0.6 + 0.6 · V)  ·  classes: &lt; 0.10 · 0.10–0.20 · 0.20–0.30 · 0.30–0.45 · ≥ 0.45</div>
      <h3>${esc(T("me_resp"))}</h3>
      <div class="grid g2">${T("me_resp_list").map(([h, t]) => `<div class="card"><b>${esc(h)}</b><br><span class="hint" style="font-size:14px;color:var(--text-secondary)">${esc(t)}</span></div>`).join("")}</div>
      <h3>${esc(T("me_data"))}</h3><p>${esc(T("me_data_list"))}</p><p>${esc(T("me_models"))}</p>`;
  }

  /* ------------------------------------------------------------------ work with us */
  function renderContact() {
    const C = window.CONTACT || {};
    const lines = (C.address || []).map(esc).join("<br>");
    const mail = C.email ? `<a class="btn" href="mailto:${esc(C.email)}?subject=${encodeURIComponent(T("co_subject"))}">${esc(T("co_write"))} — ${esc(C.email)}</a>` : "";
    const links = (C.links || []).map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join("");
    document.getElementById("contact").innerHTML = `
      <h2>${esc(T("tab_contact"))}</h2><p class="lead">${esc(T("co_lead"))}</p>
      <div class="grid g3">${T("co_ways").map(([h, t]) => `<div class="card"><b>${esc(h)}</b><p class="muted">${esc(t)}</p></div>`).join("")}</div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card contact-card">
          <img src="img/logo-cus.png" alt="CUS — Center of Urban Systems" width="171" height="38">
          <h3>${esc(C.name || "")}</h3>
          <p>${esc(C.org || "")}<br>${lines}</p>
          <dl class="dl">
            ${C.phone ? `<dt>${esc(T("co_phone"))}</dt><dd><a href="tel:${esc(C.phone.replace(/\s/g, ""))}">${esc(C.phone)}</a></dd>` : ""}
            ${C.email ? `<dt>${esc(T("co_email"))}</dt><dd><a href="mailto:${esc(C.email)}">${esc(C.email)}</a></dd>` : ""}
          </dl>
          ${mail}
          ${links ? `<ul class="links">${links}</ul>` : ""}
        </div>
        <div class="card"><h3 style="margin-top:0">${esc(T("co_what"))}</h3>
          <ul>${T("co_what_list").map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>`;
  }

  /* ------------------------------------------------------------------ events & boot */
  function switchRun(id) {
    loadRun(id).then(() => { state.run = id; state.cell = null; applyI18n(); setTab(state.tab); });
  }
  function bind() {
    document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
    document.getElementById("runSelect").addEventListener("change", (e) => switchRun(e.target.value));
    document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => {
      state.lang = b.dataset.lang; try { localStorage.setItem("rtc_lang", state.lang); } catch (e) { /* ignore */ }
      applyI18n(); render();
    }));
    document.querySelectorAll("#colorBy button").forEach((b) => b.addEventListener("click", () => { state.colorBy = b.dataset.mode; renderExplore(); }));
    document.getElementById("showBld").addEventListener("change", (e) => { state.showBld = e.target.checked; renderExplore(); });
    const tip = document.getElementById("tip");
    document.addEventListener("mousemove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) { tip.style.opacity = 0; return; }
      tip.textContent = t.dataset.tip; tip.style.opacity = 1;
      tip.style.left = Math.min(window.innerWidth - 270, e.clientX + 12) + "px"; tip.style.top = e.clientY + 14 + "px";
    });
  }
  function boot() {
    const [tab, rid] = (location.hash || "").replace("#", "").split("/");
    state.run = RUN_INDEX.some((r) => r.id === rid) ? rid : RUN_INDEX[0].id;
    if (["overview", "explore", "street", "rain", "reliability", "method", "contact"].includes(tab)) state.tab = tab;
    bind();
    loadRun(state.run).then(() => { applyI18n(); setTab(state.tab); });
  }
  boot();
})();
