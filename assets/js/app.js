/* =========================================================
   山河志 · app
   Vanilla JS, no build step, works from file://
   ========================================================= */
(function () {
  "use strict";

  var MANIFEST = window.CHINA_MANIFEST || { provinces: [], totalCities: 0 };
  var MAP = window.CHINA_MAP || { width: 1000, height: 760, features: [] };
  var TOPICS = window.CHINA_TOPICS || [];
  var SEARCH_INDEX = window.SEARCH_INDEX || [];
  window.PROVINCES = window.PROVINCES || {};

  var REGION_COLORS = {
    "华北": "#b56a4f", "东北": "#5e7d6d", "华东": "#8a9a5b", "华中": "#c08a3e",
    "华南": "#4f7d7a", "西南": "#8b6b8f", "西北": "#b08a5a", "港澳台": "#b3544c"
  };
  var REGION_ORDER = ["华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台"];
  var CATEGORY_ORDER = ["古建", "遗址", "山水", "文博", "非遗", "民俗", "风物", "名人", "之最"];
  var LABEL_ADJUST = {
    beijing: [-13, -12], tianjin: [19, 2], shanghai: [14, 19], xianggang: [16, 9],
    aomen: [0, 16], hainan: [-4, 15], ningxia: [-7, -2], taiwan: [8, 3]
  };
  var SMALL_LABELS = { beijing: 1, tianjin: 1, shanghai: 1, xianggang: 1, aomen: 1, hainan: 1, ningxia: 1 };
  var QUICK_SEARCHES = ["元曲", "官窑", "五岳", "长江", "景德镇", "世界遗产"];

  var els = {
    panel: document.getElementById("panel"),
    panelInner: document.getElementById("panel-inner"),
    map: document.getElementById("china-map"),
    mapFrame: document.getElementById("map-frame"),
    mapTooltip: document.getElementById("map-tooltip"),
    searchOverlay: document.getElementById("search-overlay"),
    searchInput: document.getElementById("search-input"),
    searchResults: document.getElementById("search-results"),
    provincesOverlay: document.getElementById("provinces-overlay"),
    provinceIndex: document.getElementById("province-index"),
    topicsOverlay: document.getElementById("topics-overlay"),
    topicGrid: document.getElementById("topic-grid"),
    aboutOverlay: document.getElementById("about-overlay"),
    mobileMapBtn: document.getElementById("mobile-map-btn")
  };

  var state = {
    pid: null,
    cid: null,
    filter: "全部",
    searchItems: [],
    searchCursor: -1,
    pendingItem: null
  };
  var loadCache = {};
  var lastHash = null;
  var lastFocused = null;
  var searchIndexCache = null;
  var mobileQuery = window.matchMedia("(max-width: 980px)");

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function text(s) {
    return esc(s).replace(/\n+/g, "<br>");
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function metaOf(pid) {
    return MANIFEST.provinces.filter(function (p) { return p.id === pid; })[0] || null;
  }
  function cityCountOf(pid) {
    var p = window.PROVINCES[pid];
    if (p && p.cities) return p.cities.length;
    var m = metaOf(pid);
    return m ? m.cityCount : 0;
  }
  function itemCountOf(pid) {
    var p = window.PROVINCES[pid];
    if (!p || !p.cities) return 0;
    return p.cities.reduce(function (n, c) { return n + (c.items ? c.items.length : 0); }, 0);
  }
  function isMobile() { return mobileQuery.matches; }
  function regionColor(r) { return REGION_COLORS[r] || "#7c8b7d"; }
  function provinceImage(pid) { return "assets/img/provinces/" + pid + ".webp"; }
  function cityImage(pid, cid) { return "assets/img/cities/" + pid + "-" + cid + ".webp"; }
  function itemImage(pid, cid, idx) { return "assets/img/items/" + pid + "-" + cid + "-" + pad(idx) + ".webp"; }
  function provinceIndex() {
    var out = {};
    MANIFEST.provinces.forEach(function (p, i) { out[p.id] = i; });
    return out;
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, s = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(s, a); }, ms);
    };
  }

  /* ---------------- map ---------------- */
  function buildMap() {
    var svg = els.map;
    var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(g);

    MAP.features.forEach(function (f) {
      var count = cityCountOf(f.id);
      var c = regionColor(f.region);
      if (f.d) {
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", f.d);
        path.setAttribute("class", "province");
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        path.setAttribute("aria-label", f.name + "，" + count + " 座城市，点击查看");
        path.dataset.id = f.id;
        path.style.setProperty("--c", c);
        bindProvinceHit(path, f);
        g.appendChild(path);
      }
      if (!f.d || f.id === "xianggang" || f.id === "aomen") {
        var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", f.label[0]);
        dot.setAttribute("cy", f.label[1]);
        dot.setAttribute("r", f.id === "aomen" ? 3.2 : 4);
        dot.setAttribute("class", "province-marker");
        dot.setAttribute("tabindex", "0");
        dot.setAttribute("role", "button");
        dot.setAttribute("aria-label", f.name + "，点击查看");
        dot.dataset.id = f.id;
        dot.style.setProperty("--c", c);
        bindProvinceHit(dot, f);
        g.appendChild(dot);
      }
    });

    // labels above hit areas
    MAP.features.forEach(function (f) {
      var adj = LABEL_ADJUST[f.id] || [0, 0];
      var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", f.label[0] + adj[0]);
      t.setAttribute("y", f.label[1] + adj[1]);
      t.setAttribute("class", "province-label" + (SMALL_LABELS[f.id] ? " is-small" : ""));
      t.dataset.id = f.id;
      t.textContent = f.name;
      t.setAttribute("aria-hidden", "true");
      g.appendChild(t);
    });
  }

  function bindProvinceHit(el, f) {
    el.addEventListener("mouseenter", function () { showTooltip(f, el); });
    el.addEventListener("mousemove", moveTooltip);
    el.addEventListener("mouseleave", hideTooltip);
    el.addEventListener("focus", function () { showTooltip(f, el); });
    el.addEventListener("blur", hideTooltip);
    el.addEventListener("click", function () {
      if (state.pid === f.id && !state.cid) return;
      openProvince(f.id);
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openProvince(f.id);
      }
    });
  }

  function showTooltip(f, el) {
    var m = metaOf(f.id) || {};
    var count = cityCountOf(f.id);
    els.mapTooltip.innerHTML =
      '<strong>' + esc(f.name) + '<span>' + esc(f.region) + '</span></strong>' +
      '<p>' + esc(m.tagline || "山河之间，自有文脉") + '</p>' +
      '<div class="tt-meta">' + count + " 座城市 · 点击进入</div>";
    var rect = els.mapFrame.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    placeTooltip(r.left + r.width / 2 - rect.left, r.top - rect.top + 4);
    els.mapTooltip.classList.add("is-visible");
  }
  function placeTooltip(x, y) {
    var w = els.mapTooltip.offsetWidth || 200;
    var max = els.mapFrame.clientWidth - 10;
    x = Math.max(w / 2 + 8, Math.min(max - w / 2, x));
    y = Math.max(70, y);
    els.mapTooltip.style.left = x + "px";
    els.mapTooltip.style.top = y + "px";
  }
  function moveTooltip(e) {
    var rect = els.mapFrame.getBoundingClientRect();
    if (!els.mapTooltip.classList.contains("is-visible")) return;
    placeTooltip(e.clientX - rect.left, e.clientY - rect.top - 10);
  }
  function hideTooltip() { els.mapTooltip.classList.remove("is-visible"); }

  function setActiveProvince(pid) {
    document.querySelectorAll(".province, .province-marker").forEach(function (el) {
      el.classList.toggle("is-active", el.dataset.id === pid);
    });
    document.querySelectorAll(".province-label").forEach(function (el) {
      el.style.opacity = pid && el.dataset.id !== pid ? ".55" : "1";
    });
  }

  /* ---------------- data loading ---------------- */
  function loadProvince(pid) {
    if (window.PROVINCES[pid]) return Promise.resolve(window.PROVINCES[pid]);
    if (loadCache[pid]) return loadCache[pid];
    loadCache[pid] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "assets/data/province-" + pid + ".js";
      s.async = true;
      s.onload = function () {
        if (window.PROVINCES[pid]) resolve(window.PROVINCES[pid]);
        else reject(new Error("province data missing"));
      };
      s.onerror = function () { reject(new Error("province data failed")); };
      document.head.appendChild(s);
    });
    return loadCache[pid];
  }

  /* ---------------- panel states ---------------- */
  function renderInitial() {
    var totalCities = MANIFEST.totalCities || 384;
    var itemTotal = MANIFEST.totalItems || MANIFEST.provinces.reduce(function (n, p) { return n + itemCountOf(p.id); }, 0);
    if (!itemTotal) itemTotal = "1,000+";
    else if (typeof itemTotal === "number") itemTotal = itemTotal.toLocaleString("en-US");
    els.panelInner.innerHTML =
      '<div class="panel-empty">' +
        '<div class="empty-index"><span>ATLAS / 01</span><b>从省界开始</b></div>' +
        "<h2>读一座城<br><em>先读它的山河</em></h2>" +
        "<p>中国有 34 个省级行政区、三百多座城市。这里不按榜单排列，而是把古建、山水、器物、戏曲与人物放回它们诞生的地理与历史里。第一次了解中国，也可以从一个省界开始。</p>" +
        '<div class="empty-stats">' +
          "<div><strong>34</strong><span>省级行政区</span></div>" +
          "<div><strong>" + totalCities + "</strong><span>城市与地区</span></div>" +
          "<div><strong>" + itemTotal + "</strong><span>文化坐标</span></div>" +
        "</div>" +
        '<div class="empty-suggestions">' +
          '<div class="mini-heading">如果不知道从哪里开始</div>' +
          '<div class="suggestion-list">' +
            suggestion("shanxi", "01", "山西", "古建博物馆 · 从唐构到元曲") +
            suggestion("fujian", "02", "福建", "土楼、海丝与闽南烟火") +
            suggestion("xinjiang", "03", "新疆", "天山南北 · 丝路与绿洲") +
            suggestion("yunnan", "04", "云南", "民族走廊 · 茶与梯田") +
          "</div>" +
          '<p class="empty-quote">“山河远阔，行而知之。”</p>' +
        "</div>" +
      "</div>";
  }
  function suggestion(pid, num, name, sub) {
    return '<button class="suggestion" data-province="' + pid + '">' +
      '<span class="num">' + num + "</span>" +
      "<span><strong>" + esc(name) + "</strong><span>" + esc(sub) + "</span></span>" +
      '<svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg>' +
      "</button>";
  }

  function renderSkeleton() {
    els.panelInner.innerHTML =
      '<div class="skeleton">' +
        '<div class="sk-media"></div>' +
        '<div class="sk-line w40"></div><div class="sk-line w90"></div>' +
        '<div class="sk-line w70"></div><div class="sk-line w90"></div>' +
        '<div class="sk-line w40"></div><div class="sk-line w70"></div>' +
      "</div>";
  }

  function renderError(title, msg) {
    els.panelInner.innerHTML =
      '<div class="panel-error">' +
        '<svg class="icon" aria-hidden="true"><use href="#i-mountain"></use></svg>' +
        "<h3>" + esc(title) + "</h3>" +
        "<p>" + esc(msg) + "</p>" +
        '<button class="btn is-dark" data-back="home">返回全国地图</button>' +
      "</div>";
  }

  /* ---------------- province view ---------------- */
  function renderProvince(p) {
    var m = metaOf(p.id) || {};
    var name = p.name || m.name || "未名";
    var region = p.region || m.region || "";
    var tagline = p.tagline || m.tagline || "";
    var overview = p.overview || "这片山河的内容正在整理中。你可以先从地图进入相邻省份，或打开文化专题进行横向阅读。";
    var cities = p.cities || [];
    var stats = (p.stats && p.stats.length ? p.stats : []).slice(0, 3);
    if (stats.length < 3) {
      stats = stats.concat([
        { label: "城市与地区", value: cities.length + " 座" },
        { label: "文化坐标", value: itemCountOf(p.id) + " 个" },
        { label: "地理区域", value: region }
      ]).slice(0, 3);
    }
    var chars = (p.character || []).slice(0, 6);
    var count = cities.length || (m.cityCount || 0);

    var html =
      '<section class="province-view">' +
        heroMarkup({
          image: provinceImage(p.id),
          char: (p.abbr || name).slice(0, 1),
          region: region + " · " + (p.fullName || name),
          title: name,
          subtitle: tagline,
          back: "home",
          backLabel: "全国地图",
          seal: p.abbr || name.slice(0, 1)
        }) +
        '<div class="panel-body">' +
          (cities.length ? '<div class="city-jump"><span class="city-jump-label">CITIES / 城市 · ' + cities.length + ' 座</span><div class="city-jump-track">' +
            cities.map(function (c) {
              return '<button data-city="' + esc(c.id) + '">' + esc(c.name) + "</button>";
            }).join("") + "</div></div>" : "") +
          '<p class="lede">' + text(overview) + "</p>" +
          '<div class="stat-row">' + stats.map(function (s) {
            var long = String(s.value).length > 7 ? " is-long" : "";
            return "<div><strong class=\"" + long.trim() + "\">" + esc(s.value) + "</strong><span>" + esc(s.label) + "</span></div>";
          }).join("") + "</div>" +
          (chars.length ? '<div class="chip-row">' + chars.map(function (c, i) {
            return '<span class="chip' + (i === 0 ? " is-accent" : "") + '">' + esc(c) + "</span>";
          }).join("") + "</div>" : "") +
          '<div class="meta-grid">' +
            "<div><div class=\"meta-label\">Best season / 最佳季节</div><div class=\"meta-value\">" + esc(p.bestSeason || "四季皆可，春秋更佳") + "</div></div>" +
            "<div><div class=\"meta-label\">Cities / 城市</div><div class=\"meta-value\">" + count + " 座城市与地区</div></div>" +
            '<div class="full"><div class="meta-label">Route / 一条建议线路</div><div class="meta-value">' + esc(p.route || "从省会出发，沿一条河或一条古道展开。") + "</div></div>" +
          "</div>" +
          '<div class="section-head"><h2>CITIES / 城市与风物</h2><span>点开一座城</span></div>' +
          (cities.length ? '<div class="city-grid">' + cities.map(function (c, i) {
            return cityCard(p, c, i);
          }).join("") + "</div>" :
            '<div class="panel-empty" style="padding:24px 0;min-height:0"><p>该省城市内容正在整理。你可以先阅读全省概况，或从地图进入其他省份。</p><button class="btn" data-action="topics" style="margin-top:16px">去读文化专题</button></div>') +
          '<div class="province-footer">' +
            "<span>资料为编辑整理 · 出行以官方信息为准</span>" +
            '<button class="text-link" data-action="topics">读文化专题 <svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></button>' +
          "</div>" +
        "</div>" +
      "</section>";
    els.panelInner.innerHTML = html;
  }

  function heroMarkup(o) {
    return '<div class="hero" data-char="' + esc(o.char) + '">' +
      '<img src="' + esc(o.image) + '" alt="' + esc(o.title) + '风光" loading="eager" />' +
      '<div class="hero-top">' +
        '<button class="hero-back" data-back="' + esc(o.back) + '">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-back"></use></svg>' + esc(o.backLabel) +
        "</button>" +
        '<span class="hero-region">' + esc(o.region) + "</span>" +
      "</div>" +
      '<div class="hero-copy"><h1>' + esc(o.title) + "</h1><p>" + esc(o.subtitle) + "</p></div>" +
      '<div class="hero-seal" aria-hidden="true">' + esc(o.seal) + "</div>" +
    "</div>";
  }

  function cityCard(p, c, i) {
    var tags = (c.titles || []).slice(0, 2);
    return '<button class="city-card" data-city="' + esc(c.id) + '">' +
      '<div class="city-card-media" data-char="' + esc((c.name || "城").slice(0, 1)) + '">' +
        '<span class="city-card-index">' + pad(i + 1) + "</span>" +
        '<img src="' + cityImage(p.id, c.id) + '" alt="' + esc(c.name) + '" loading="lazy" />' +
      "</div>" +
      "<h3>" + esc(c.name) + "</h3>" +
      '<p class="city-card-sub">' + esc(c.subtitle || c.intro || "") + "</p>" +
      (tags.length ? '<div class="city-card-tags">' + tags.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>" : "") +
    "</button>";
  }

  /* ---------------- city view ---------------- */
  function renderCity(p, c) {
    var items = c.items || [];
    var categories = [];
    items.forEach(function (it) {
      if (it.category && categories.indexOf(it.category) < 0) categories.push(it.category);
    });
    categories.sort(function (a, b) {
      var ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var idx = (p.cities || []).findIndex(function (x) { return x.id === c.id; });
    var next = (p.cities || [])[(idx + 1) % Math.max(1, (p.cities || []).length)];
    if (next && next.id === c.id) next = null;
    var featuredIndex = items.findIndex(function (it) { return it.featured; });
    if (featuredIndex < 0 && items.length) featuredIndex = 0;

    var html =
      '<section class="city-view">' +
        heroMarkup({
          image: cityImage(p.id, c.id),
          char: (c.name || "城").replace(/·.*/, "").slice(0, 1),
          region: p.name + " · " + (p.region || ""),
          title: c.name,
          subtitle: c.subtitle || "",
          back: "province",
          backLabel: "返回" + p.name,
          seal: (c.name || "城").replace(/·.*/, "").slice(0, 1)
        }) +
        '<div class="panel-body city-body">' +
          '<div class="city-titles">' + (c.titles || []).map(function (t) {
            return "<span>" + esc(t) + "</span>";
          }).join("") + "</div>" +
          '<p class="city-intro">' + text(c.intro || "") + "</p>" +
          '<div class="city-quick">' +
            "<div><div class=\"meta-label\">Food / 吃什么</div><div class=\"meta-value food\">" +
              ((c.foods || []).length ? (c.foods || []).map(function (f) { return '<span class="chip">' + esc(f) + "</span>"; }).join("") : '<span class="chip is-plain">当地风物</span>') +
            "</div></div>" +
            "<div><div class=\"meta-label\">Titles / 城市名片</div><div class=\"meta-value\">" +
              ((c.titles || []).slice(0, 3).join(" · ") || "待你发现") +
            "</div></div>" +
            '<div class="full"><div class="meta-label">Tip / 怎么走</div><div class="meta-value">' + esc(c.tip || "放慢一点，把一座古建或一条老街读透。") + "</div></div>" +
          "</div>" +
          (categories.length ? '<div class="filter-bar" role="tablist" aria-label="按类别筛选"><button class="filter-chip is-active" data-filter="全部">全部<span class="count">' + items.length + "</span></button>" +
            categories.map(function (cat) {
              var n = items.filter(function (x) { return x.category === cat; }).length;
              return '<button class="filter-chip" data-filter="' + esc(cat) + '">' + esc(cat) + '<span class="count">' + n + "</span></button>";
            }).join("") + "</div>" : "") +
          '<div class="item-list">' + items.map(function (it, i) {
            return itemCard(p, c, it, i, featuredIndex === i);
          }).join("") + "</div>" +
          (next ? '<div class="next-city"><div><small>NEXT / 同省下一站</small><strong>' + esc(next.name) + "</strong></div>" +
            '<button class="text-link" data-city="' + esc(next.id) + '">继续走 <svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></button></div>' : "") +
        "</div>" +
      "</section>";
    els.panelInner.innerHTML = html;
    state.filter = "全部";
    if (state.pendingItem) {
      var wanted = state.pendingItem;
      state.pendingItem = null;
      setTimeout(function () {
        var cards = els.panel.querySelectorAll(".item-card");
        for (var i = 0; i < cards.length; i++) {
          var h = cards[i].querySelector("h3");
          if (h && h.textContent.trim().indexOf(wanted) >= 0) {
            cards[i].scrollIntoView({ behavior: "smooth", block: "center" });
            var btn = cards[i].querySelector(".culture-toggle");
            if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
            break;
          }
        }
      }, 180);
    }
  }

  function itemCard(p, c, it, i, featured) {
    var cat = it.category || "风物";
    var badge = it.badge ? '<span class="item-badge">' + esc(it.badge) + "</span>" : "";
    var facts = (it.facts || []).filter(Boolean).slice(0, 3);
    var showImage = !!(featured && it.imageQuery !== false);
    var cultureTitle = it.cultureTitle || "它背后的文化";
    return '<article class="item-card" data-cat="' + esc(cat) + '" data-item-index="' + i + '">' +
      '<div class="item-top">' +
        '<div class="item-num">' + pad(i + 1) + "</div>" +
        '<div class="item-head"><h3>' + esc(it.name) + "</h3>" +
          '<div class="item-sub"><span class="item-cat">' + esc(cat) + "</span>" + badge + "</div>" +
        "</div>" +
      "</div>" +
      (showImage ? '<div class="item-media" data-char="' + esc((it.name || "景").slice(0, 1)) + '">' +
        '<img src="' + itemImage(p.id, c.id, i + 1) + '" alt="' + esc(it.name) + '" loading="lazy" />' +
      "</div>" : "") +
      '<p class="item-summary">' + text(it.summary || "") + "</p>" +
      (facts.length ? '<div class="fact-list">' + facts.map(function (f) { return '<span class="fact">' + esc(f) + "</span>"; }).join("") + "</div>" : "") +
      '<button class="culture-toggle" data-culture="' + i + '" aria-expanded="false" aria-controls="culture-' + esc(c.id) + "-" + i + '">' +
        '文化深读 · ' + esc(cultureTitle) +
        '<svg class="icon" aria-hidden="true"><use href="#i-chevron"></use></svg>' +
      "</button>" +
      '<div class="culture-wrap" id="culture-' + esc(c.id) + "-" + i + '"><div class="culture-inner">' +
        '<div class="culture-block"><h4>' + esc(cultureTitle) + "</h4><p>" + text(it.culture || "") + "</p>" +
          '<div class="culture-note">文化深读 · 来自公开史志与博物馆资料的编辑整理</div>' +
        "</div>" +
      "</div></div>" +
    "</article>";
  }

  /* ---------------- routing ---------------- */
  function updateHash(path) {
    var h = "#" + path;
    if (window.location.hash === h) { lastHash = h; return; }
    try { history.pushState(null, "", h); } catch (e) { window.location.hash = h; }
    lastHash = h;
  }

  function openProvince(pid, cid) {
    var m = metaOf(pid);
    if (!m) return;
    state.pid = pid;
    state.cid = cid || null;
    state.filter = "全部";
    setActiveProvince(pid);
    document.body.classList.toggle("show-detail", isMobile());
    renderSkeleton();
    els.panel.scrollTop = 0;
    updateHash("p/" + pid + (cid ? "/" + cid : ""));
    document.title = (m.name || "中国") + " · 山河志";
    loadProvince(pid).then(function (p) {
      if (state.pid !== pid) return;
      if (cid) {
        var city = (p.cities || []).filter(function (x) { return x.id === cid; })[0];
        if (!city) { renderProvince(p); state.cid = null; updateHash("p/" + pid); return; }
        renderCity(p, city);
        document.title = city.name + " · " + p.name + " · 山河志";
      } else {
        renderProvince(p);
      }
      if (isMobile()) {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    }).catch(function () {
      if (state.pid !== pid) return;
      var fallback = {
        id: pid, name: m.name, fullName: m.fullName, abbr: m.abbr, region: m.region,
        tagline: m.tagline, overview: "这片山河的深度内容正在整理中。你可以先从地图进入相邻省份，或打开文化专题进行横向阅读。",
        cities: []
      };
      renderProvince(fallback);
      setTimeout(function () {
        var msg = els.panelInner.querySelector(".panel-empty p");
        if (msg) msg.textContent = "内容文件尚未生成。请先运行 tools/build_data.py，或稍后再来。";
      }, 0);
    });
    updateMobileMapButton();
  }

  function route(force) {
    var h = window.location.hash || "";
    if (!force && h === lastHash) return;
    lastHash = h;
    var m = h.match(/^#\/p\/([a-z]+)(?:\/(c\d+))?/);
    if (m) {
      openProvince(m[1], m[2] || null);
    } else {
      state.pid = null;
      state.cid = null;
      setActiveProvince(null);
      document.body.classList.remove("show-detail");
      renderInitial();
      document.title = "山河志 · 中国人文旅行图鉴";
      updateMobileMapButton();
    }
  }

  /* ---------------- filter / culture ---------------- */
  function bindPanel() {
    els.panel.addEventListener("click", function (e) {
      var provinceBtn = e.target.closest("[data-province]");
      if (provinceBtn) { closeAllOverlays(); openProvince(provinceBtn.dataset.province); return; }

      var cityBtn = e.target.closest("[data-city]");
      if (cityBtn && state.pid) { openProvince(state.pid, cityBtn.dataset.city); return; }

      var back = e.target.closest("[data-back]");
      if (back) {
        if (back.dataset.back === "home") {
          state.pid = null; state.cid = null; setActiveProvince(null);
          document.body.classList.remove("show-detail");
          updateHash(""); lastHash = window.location.hash;
          renderInitial(); document.title = "山河志 · 中国人文旅行图鉴";
          updateMobileMapButton();
        } else if (state.pid) {
          openProvince(state.pid);
        }
        return;
      }

      var filter = e.target.closest("[data-filter]");
      if (filter) {
        state.filter = filter.dataset.filter;
        els.panel.querySelectorAll(".filter-chip").forEach(function (b) {
          b.classList.toggle("is-active", b === filter);
        });
        els.panel.querySelectorAll(".item-card").forEach(function (card) {
          card.style.display = (state.filter === "全部" || card.dataset.cat === state.filter) ? "" : "none";
        });
        return;
      }

      var culture = e.target.closest("[data-culture]");
      if (culture) {
        var wrap = document.getElementById(culture.getAttribute("aria-controls"));
        var open = culture.getAttribute("aria-expanded") === "true";
        culture.setAttribute("aria-expanded", open ? "false" : "true");
        if (wrap) wrap.classList.toggle("is-open", !open);
        return;
      }

      var action = e.target.closest("[data-action]");
      if (action) {
        var a = action.dataset.action;
        if (a === "topics") openTopics();
        else if (a === "search") openSearch();
        else if (a === "provinces") openProvinces();
        else if (a === "about") openAbout();
        else if (a === "atlas") closeAllOverlays();
      }
    });

    document.addEventListener("error", function (e) {
      if (e.target && e.target.tagName === "IMG") {
        var box = e.target.closest(".hero, .city-card-media, .item-media");
        if (box) {
          box.classList.add("is-fallback");
          e.target.remove();
        }
      }
    }, true);
  }

  /* ---------------- overlays ---------------- */
  function openOverlay(el, focusEl) {
    if (!el) return;
    lastFocused = document.activeElement;
    document.querySelectorAll(".overlay").forEach(function (o) { if (o !== el) o.hidden = true; });
    el.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () {
      var f = focusEl || el.querySelector("input, button, [tabindex]");
      if (f) f.focus({ preventScroll: true });
    }, 30);
  }
  function closeOverlay(el) {
    if (!el) return;
    el.hidden = true;
    var any = Array.prototype.some.call(document.querySelectorAll(".overlay"), function (o) { return !o.hidden; });
    if (!any) document.body.style.overflow = "";
    if (lastFocused && lastFocused.focus) { try { lastFocused.focus({ preventScroll: true }); } catch (e) {} }
  }
  function closeAllOverlays() {
    document.querySelectorAll(".overlay").forEach(function (o) { o.hidden = true; });
    document.body.style.overflow = "";
    var reader = document.getElementById("topic-reader");
    if (reader) reader.hidden = true;
  }
  function trapFocus(e) {
    if (e.key !== "Tab") return;
    var overlay = e.target.closest(".overlay");
    if (!overlay || overlay.hidden) return;
    var f = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var list = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openProvinces() {
    renderProvinceIndex();
    openOverlay(els.provincesOverlay, els.provincesOverlay.querySelector(".close-btn"));
  }
  function renderProvinceIndex() {
    var groups = {};
    MANIFEST.provinces.forEach(function (p) {
      (groups[p.region] = groups[p.region] || []).push(p);
    });
    els.provinceIndex.innerHTML = REGION_ORDER.filter(function (r) { return groups[r]; }).map(function (r) {
      return '<div class="region-group"><h3>' + esc(r) + "</h3>" +
        groups[r].map(function (p) {
          return '<button data-province="' + esc(p.id) + '"><strong>' + esc(p.name) + "</strong><span>" + (p.cityCount || 0) + " 城</span></button>";
        }).join("") + "</div>";
    }).join("");
  }

  function openTopics() {
    renderTopics();
    openOverlay(els.topicsOverlay, els.topicsOverlay.querySelector(".close-btn"));
  }
  function renderTopics() {
    if (!TOPICS.length) {
      els.topicGrid.innerHTML = '<div class="search-empty"><strong>专题正在整理</strong>稍后回来，读元曲、官窑、五岳与长江。</div>';
      return;
    }
    els.topicGrid.innerHTML = TOPICS.map(function (t, i) {
      return '<button class="topic-card" data-topic="' + i + '" data-num="' + pad(i + 1) + '">' +
        '<span class="topic-kicker">' + esc(t.kicker || "LONG READ") + "</span>" +
        "<h3>" + esc(t.title) + "</h3>" +
        "<p>" + esc(t.summary) + "</p>" +
        '<span class="topic-places">' + (t.places || []).slice(0, 4).map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</span>" +
      "</button>";
    }).join("");
  }

  function openTopic(i) {
    var t = TOPICS[i];
    if (!t) return;
    var reader = document.getElementById("topic-reader");
    if (!reader) {
      reader = document.createElement("section");
      reader.id = "topic-reader";
      reader.className = "overlay";
      reader.setAttribute("role", "dialog");
      reader.setAttribute("aria-modal", "true");
      document.body.appendChild(reader);
    }
    reader.innerHTML = '<div class="sheet topic-reader">' +
      '<div class="sheet-head"><div><span class="eyebrow">' + esc(t.kicker || "Long read") + '</span></div>' +
        '<button class="close-btn" data-close-topic aria-label="关闭专题">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg></button></div>' +
      '<div class="topic-hero"><h2>' + esc(t.title) + "</h2><p>" + esc(t.summary) + "</p></div>" +
      '<div class="topic-body">' + (t.body || []).map(function (b) {
        if (typeof b === "string") return "<p>" + text(b) + "</p>";
        if (b.h) return "<h3>" + esc(b.h) + "</h3>";
        if (b.quote) return "<blockquote>" + text(b.quote) + "</blockquote>";
        return "<p>" + text(b.p || "") + "</p>";
      }).join("") + "</div>" +
      ((t.related || []).length ? '<div class="topic-related"><h3>RELATED / 去这些地方继续读</h3><div class="related-links">' +
        t.related.map(function (r) {
          return '<button data-related-pid="' + esc(r.pid) + '" data-related-cid="' + esc(r.cid || "") + '">' + esc(r.label) + "</button>";
        }).join("") + "</div></div>" : "") +
    "</div>";
    openOverlay(reader, reader.querySelector(".close-btn"));
    reader.scrollTop = 0;
  }

  function openAbout() { openOverlay(els.aboutOverlay, els.aboutOverlay.querySelector(".close-btn")); }

  /* ---------------- search ---------------- */
  function buildSearchIndex() {
    if (searchIndexCache) return searchIndexCache;
    var base = (SEARCH_INDEX && SEARCH_INDEX.length) ? SEARCH_INDEX.slice() : MANIFEST.provinces.map(function (p) {
      return { t: "p", p: p.id, n: p.name, s: p.tagline, k: p.fullName + " " + p.abbr };
    });
    TOPICS.forEach(function (t, i) {
      var body = (t.body || []).map(function (b) {
        return typeof b === "string" ? b : (b.h || b.quote || b.p || "");
      }).join(" ");
      base.push({
        t: "topic", i: i, n: t.title, s: t.summary,
        k: [t.kicker || "", (t.places || []).join(" "), body.slice(0, 700)].join(" ")
      });
    });
    searchIndexCache = base;
    return base;
  }
  function openSearch() {
    renderSearchDefault();
    openOverlay(els.searchOverlay, els.searchInput);
    els.searchInput.value = "";
    els.searchInput.focus();
  }
  function renderSearchDefault() {
    els.searchResults.innerHTML =
      '<div class="search-tips">' + QUICK_SEARCHES.map(function (q) {
        return '<button data-query="' + esc(q) + '">' + esc(q) + "</button>";
      }).join("") + "</div>" +
      '<div class="search-empty"><strong>搜一座城，或一种文化</strong>例如“元曲四大家”“汝官哥钧定”“湘江入洞庭”“世界文化遗产”</div>';
  }
  function renderSearch(q) {
    q = q.trim();
    if (!q) { renderSearchDefault(); state.searchItems = []; return; }
    var index = buildSearchIndex();
    var qq = q.toLowerCase();
    var scored = index.map(function (it) {
      var n = (it.n || "").toLowerCase();
      var s = (it.s || "").toLowerCase();
      var k = (it.k || "").toLowerCase();
      var score = 0;
      if (n === qq) score += 100;
      else if (n.indexOf(qq) === 0) score += 70;
      else if (n.indexOf(qq) >= 0) score += 45;
      if (s.indexOf(qq) >= 0) score += 12;
      if (k.indexOf(qq) >= 0) score += 2;
      if (score > 0) {
        if (it.t === "p") score += 4;
        else if (it.t === "c") score += 2;
        else if (it.t === "topic") score += 7;
      }
      return { it: it, score: score, direct: score >= 12 };
    }).filter(function (x) { return x.score > 0; });
    var strict = scored.filter(function (x) { return x.direct; });
    var chosen = strict.length >= 1 ? strict : scored;
    chosen.sort(function (a, b) { return b.score - a.score; });
    var hits = chosen.slice(0, 40).map(function (x) { return x.it; });
    state.searchCursor = -1;
    if (!hits.length) {
      els.searchResults.innerHTML = '<div class="search-empty"><strong>没有找到“' + esc(q) + '”</strong>试试省份、城市、古建、山水、非遗或“之最”。</div>';
      return;
    }
    var groups = { p: [], c: [], topic: [], i: [] };
    hits.forEach(function (h) { (groups[h.t] || groups.i).push(h); });
    var order = ["p", "c", "topic", "i"];
    var lowerQ = q.toLowerCase();
    if (hits.some(function (h) { return h.t === "p" && h.n.toLowerCase() === lowerQ; })) {
      order = ["p", "c", "topic", "i"];
    } else if (hits.some(function (h) { return h.t === "i" && h.n.toLowerCase().indexOf(lowerQ) >= 0; })) {
      order = ["i", "p", "c", "topic"];
    } else if (hits.some(function (h) { return h.t === "topic" && ((h.n || "") + " " + (h.s || "")).toLowerCase().indexOf(lowerQ) >= 0; })) {
      order = ["topic", "p", "c", "i"];
    }
    var ordered = [];
    order.forEach(function (k) { ordered = ordered.concat(groups[k] || []); });
    state.searchItems = ordered;
    var labels = { p: "PROVINCE / 省域", c: "CITY / 城市", topic: "TOPIC / 文化专题", i: "CULTURE / 文化坐标" };
    var flatIndex = 0;
    els.searchResults.innerHTML = order.filter(function (k) { return groups[k].length; }).map(function (k) {
      return '<div class="search-group"><div class="search-group-title">' + labels[k] + "</div>" +
        groups[k].map(function (h) {
          var sub = h.s || (h.p ? (metaOf(h.p) || {}).name : "");
          var html = '<button class="search-result" data-idx="' + flatIndex + '">' +
            '<span class="sr-main"><strong>' + highlight(h.n, q) + "</strong><span>" + esc(sub) + "</span></span>" +
            '<span class="sr-type">' + (h.t === "p" ? "省" : h.t === "c" ? "城" : h.t === "topic" ? "题" : "读") + "</span></button>";
          flatIndex++;
          return html;
        }).join("") + "</div>";
    }).join("");
  }
  function highlight(s, q) {
    if (!q) return esc(s);
    var i = String(s).toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length));
  }
  function openSearchResult(h) {
    if (!h) return;
    closeOverlay(els.searchOverlay);
    if (h.t === "topic") { openTopics(); openTopic(Number(h.i)); return; }
    if (h.t === "p") { openProvince(h.p); return; }
    state.pendingItem = h.t === "i" ? h.n : null;
    openProvince(h.p, h.c);
  }
  function moveSearchCursor(delta) {
    var max = state.searchItems.length;
    if (!max) return;
    state.searchCursor = (state.searchCursor + delta + max) % max;
    els.searchResults.querySelectorAll(".search-result").forEach(function (el) {
      el.classList.toggle("is-cursor", Number(el.dataset.idx) === state.searchCursor);
    });
    var cur = els.searchResults.querySelector(".search-result.is-cursor");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  /* ---------------- global events ---------------- */
  function bindGlobal() {
    document.addEventListener("click", function (e) {
      var close = e.target.closest("[data-close]");
      if (close) { closeOverlay(document.getElementById(close.dataset.close)); return; }
      var closeTopic = e.target.closest("[data-close-topic]");
      if (closeTopic) { closeOverlay(document.getElementById("topic-reader")); return; }

      var action = e.target.closest("[data-action]");
      if (action) {
        var a = action.dataset.action;
        if (a === "search") { e.preventDefault(); openSearch(); }
        else if (a === "provinces") { e.preventDefault(); openProvinces(); }
        else if (a === "topics") { e.preventDefault(); openTopics(); }
        else if (a === "about") { e.preventDefault(); openAbout(); }
        else if (a === "atlas") { e.preventDefault(); closeAllOverlays(); window.scrollTo({ top: 0, behavior: "smooth" }); }
        return;
      }

      var mapReset = e.target.closest('[data-map-action="reset"]');
      if (mapReset) {
        document.querySelectorAll(".province, .province-marker").forEach(function (el) { el.classList.remove("is-active"); });
        state.pid = null; state.cid = null; setActiveProvince(null);
        renderInitial(); updateHash(""); lastHash = window.location.hash;
        document.title = "山河志 · 中国人文旅行图鉴";
        updateMobileMapButton();
        return;
      }

      var topic = e.target.closest("[data-topic]");
      if (topic) { openTopic(Number(topic.dataset.topic)); return; }

      var rel = e.target.closest("[data-related-pid]");
      if (rel) {
        var reader = document.getElementById("topic-reader");
        if (reader) reader.hidden = true;
        closeAllOverlays();
        openProvince(rel.dataset.relatedPid, rel.dataset.relatedCid || null);
        return;
      }

      // close overlay when clicking backdrop (not the sheet)
      if (e.target.classList && e.target.classList.contains("overlay")) {
        if (e.target.id === "topic-reader") closeOverlay(e.target);
        else closeOverlay(e.target);
      }
    });

    document.addEventListener("input", function (e) {
      if (e.target === els.searchInput) renderSearch(e.target.value);
    });

    els.searchResults.addEventListener("click", function (e) {
      var tip = e.target.closest("[data-query]");
      if (tip) { els.searchInput.value = tip.dataset.query; renderSearch(tip.dataset.query); els.searchInput.focus(); return; }
      var res = e.target.closest(".search-result");
      if (res) {
        var idx = Number(res.dataset.idx);
        openSearchResult(state.searchItems[idx]);
      }
    });

    els.searchInput.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveSearchCursor(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSearchCursor(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (state.searchCursor >= 0 && state.searchItems[state.searchCursor]) openSearchResult(state.searchItems[state.searchCursor]);
        else if (state.searchItems.length) openSearchResult(state.searchItems[0]);
      }
    });

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      } else if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        openSearch();
      } else if (e.key === "Escape") {
        var open = Array.prototype.filter.call(document.querySelectorAll(".overlay"), function (o) { return !o.hidden; });
        if (open.length) {
          closeOverlay(open[open.length - 1]);
        } else if (state.cid && state.pid) {
          openProvince(state.pid);
        }
      }
      trapFocus(e);
    });

    window.addEventListener("popstate", function () { route(true); });
    window.addEventListener("hashchange", function () { route(false); });

    els.mobileMapBtn.addEventListener("click", function () {
      document.body.classList.remove("show-detail");
      updateMobileMapButton();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeOverlay(document.getElementById(btn.dataset.close)); });
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!isMobile()) document.body.classList.remove("show-detail");
        else if (state.pid) document.body.classList.add("show-detail");
        updateMobileMapButton();
      }, 150);
    });
  }

  function updateMobileMapButton() {
    var show = isMobile() && document.body.classList.contains("show-detail");
    els.mobileMapBtn.classList.toggle("is-visible", show);
  }

  /* ---------------- boot ---------------- */
  function init() {
    if (window.CHINA_MAP && MAP.features.length) buildMap();
    renderInitial();
    renderProvinceIndex();
    renderTopics();
    bindPanel();
    bindGlobal();
    route(true);
    try {
      var params = new URLSearchParams(window.location.search);
      var q = params.get("q");
      if (q) {
        setTimeout(function () {
          openSearch();
          els.searchInput.value = q;
          renderSearch(q);
          if (params.get("open") === "1" && state.searchItems.length) {
            setTimeout(function () { openSearchResult(state.searchItems[0]); }, 260);
          }
        }, 120);
      }
      var topic = params.get("topic");
      if (topic !== null && topic !== "") {
        setTimeout(function () { openTopics(); openTopic(Number(topic)); }, 180);
      }
      var panel = params.get("panel");
      if (panel === "provinces") setTimeout(openProvinces, 180);
      else if (panel === "topics") setTimeout(openTopics, 180);
      else if (panel === "about") setTimeout(openAbout, 180);
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
