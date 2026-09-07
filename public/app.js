// 발주관리앱 - 프론트엔드 로직
// 순수 ES 모듈. 서버(/api)와 통신하며 모든 화면을 렌더링합니다.

/* =========================================================
 * 기본 유틸 / 상수
 * =======================================================*/
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ITEMS = [
  { code: "D", name: "DEBEM" },
  { code: "F", name: "FLUIMAC" },
  { code: "G", name: "GRIFFCO" },
  { code: "H", name: "HIDRACAR" },
  { code: "I", name: "INJECTA" },
  { code: "J", name: "JESSBERGER" },
  { code: "ETC", name: "ETC" },
];
const ITEM_CODES = ITEMS.map((i) => i.code);
const ITEM_NAME = Object.fromEntries(ITEMS.map((i) => [i.code, i.name]));
const NAME_TO_CODE = Object.fromEntries(ITEMS.map((i) => [i.name, i.code]));

const nf = new Intl.NumberFormat("ko-KR");
const won = (n) => nf.format(Math.round(Number(n) || 0));
const parseNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) || null : null);
const monthOf = (d) => {
  if (!d) return null;
  const m = Number(String(d).slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
};
const todayStr = () => new Date().toISOString().slice(0, 10);

function orderTotal(o) {
  const a = parseNum(o.amount);
  if (a) return a;
  return (o.items || []).reduce((s, it) => s + parseNum(it.amount), 0);
}
function statusOf(o) {
  if (o.invoiceDate) return "complete";
  // 계산서 일자가 없으면(납품 여부와 무관하게) 계산서 대기
  return "invoice_pending";
}
const STATUS_LABEL = { in_progress: "진행 중", invoice_pending: "계산서 대기", complete: "처리 완료" };

/* =========================================================
 * API 클라이언트 (선택적 비밀번호 인증)
 * =======================================================*/
let APP_KEY = "";
try { APP_KEY = localStorage.getItem("appKey") || ""; } catch { APP_KEY = ""; }
function authHeaders() {
  return APP_KEY ? { "x-app-password": APP_KEY } : {};
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let msg = `요청 실패 (${res.status})`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

/* =========================================================
 * 전역 상태
 * =======================================================*/
const store = {
  orders: [],
  annualMetrics: [],
  planValues: [],
  recurringForecasts: [],
  forecasts: [],
  monthlyPlans: [],
  yearlyAnalysis: [],
};

const ui = {
  view: "orders",
  year: new Date().getFullYear(),
  // 발주 필터
  search: "",
  statusFilter: new Set(),
  itemFilter: new Set(),
  dueYear: "",
  dueMonths: new Set(),
  page: 1,
  pageSize: 100,
  selected: new Set(),
  auditTab: "issues",
  // 통합분석
  customerSearch: "",
  // 실적
  planItem: "D",
  // 월간회의
  resultMonth: new Date().getMonth() + 1,
  forecastMonth: new Date().getMonth() + 1,
  forecastType: "invoice",
  planMonth: new Date().getMonth() + 1,
  editingOrderId: null,
  editingForecastId: null,
  completeContext: null,
  recurringEdit: null,
};

/* =========================================================
 * 토스트
 * =======================================================*/
let toastTimer;
function toast(msg, kind = "info") {
  const el = $("toast");
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* =========================================================
 * 데이터 로드
 * =======================================================*/
async function refreshAll() {
  // 단일 호출로 모든 데이터 로드 (콜드스타트/왕복 최소화)
  const d = await api("/api/bootstrap");
  Object.assign(store, {
    orders: d.orders || [],
    annualMetrics: d.annualMetrics || [],
    planValues: d.planValues || [],
    recurringForecasts: d.recurringForecasts || [],
    forecasts: d.forecasts || [],
    monthlyPlans: d.monthlyPlans || [],
    yearlyAnalysis: d.yearlyAnalysis || [],
  });
  ensureRecurringDefaults();
}

// 사용 가능한 연도 목록
function availableYears() {
  const set = new Set();
  for (const o of store.orders) {
    if (yearOf(o.orderDate)) set.add(yearOf(o.orderDate));
    if (yearOf(o.invoiceDate)) set.add(yearOf(o.invoiceDate));
  }
  for (const m of store.annualMetrics) set.add(Number(m.year));
  set.add(new Date().getFullYear());
  return [...set].filter(Boolean).sort((a, b) => b - a);
}

function customerNames() {
  return [...new Set(store.orders.map((o) => (o.customer || "").trim()).filter(Boolean))].sort();
}

/* =========================================================
 * 뷰 전환
 * =======================================================*/
const VIEW_META = {
  orders: { title: "발주 및 납품 관리", sub: "발주 진행상태와 납기, 세금계산서를 한 화면에서 관리합니다.", year: false },
  analytics: { title: "통합분석", sub: "발주·세금계산서 데이터를 월별·거래처별로 분석합니다.", year: true },
  performance: { title: "연간영업실적 및 계획", sub: "BUDGET 대비 실적과 ITEM별 계획을 관리합니다.", year: true },
  forecast: { title: "월간회의", sub: "월 결과와 예상, 주요 계획을 한 곳에서 준비합니다.", year: false },
};

function setView(view) {
  ui.view = view;
  $$(".view-section").forEach((s) => (s.hidden = true));
  const map = { orders: "ordersView", analytics: "analyticsView", performance: "performanceView", forecast: "forecastView" };
  const sec = $(map[view]);
  if (sec) sec.hidden = false;
  $$(".nav-item[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const meta = VIEW_META[view];
  $("pageTitle").textContent = meta.title;
  $("pageSubtitle").textContent = meta.sub;
  $("breadcrumbText").textContent = meta.title;
  $("yearControl").hidden = !meta.year;
  $("exportButton").hidden = view === "forecast";
  renderView();
}

function renderView() {
  switch (ui.view) {
    case "orders": renderOrders(); renderAudit(); break;
    case "analytics": renderAnalytics(); break;
    case "performance": renderPerformance(); break;
    case "forecast": renderForecast(); break;
  }
}

/* =========================================================
 * 발주 목록 (orders view)
 * =======================================================*/
function filteredOrders() {
  let rows = store.orders.slice();
  const q = ui.search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((o) => {
      const hay = [
        o.customer, o.memo, o.owner, o.id,
        ...(o.items || []).map((it) => `${it.model} ${ITEM_NAME[it.item] || it.item}`),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  if (ui.statusFilter.size) rows = rows.filter((o) => ui.statusFilter.has(statusOf(o)));
  if (ui.itemFilter.size) rows = rows.filter((o) => (o.items || []).some((it) => ui.itemFilter.has(it.item)));
  if (ui.dueYear) rows = rows.filter((o) => yearOf(o.dueDate) === Number(ui.dueYear));
  if (ui.dueMonths.size) rows = rows.filter((o) => ui.dueMonths.has(monthOf(o.dueDate)));
  rows.sort((a, b) => String(b.orderDate || "").localeCompare(String(a.orderDate || "")));
  return rows;
}

function renderStatusOverview() {
  const counts = { in_progress: 0, invoice_pending: 0, complete: 0 };
  let amount = { in_progress: 0, invoice_pending: 0, complete: 0 };
  for (const o of store.orders) {
    const s = statusOf(o);
    counts[s] += 1;
    amount[s] += orderTotal(o);
  }
  const cards = [
    ["in_progress", "진행 중", "main-progress"],
    ["invoice_pending", "계산서 대기", "main-invoice"],
    ["complete", "처리 완료", "main-complete"],
  ];
  $("statusOverview").innerHTML = cards
    .map(
      ([key, label, cls]) => `
      <button class="status-card ${cls} ${ui.statusFilter.has(key) ? "active" : ""}" data-status-card="${key}">
        <span class="status-dot"></span>
        <div><span>${label}</span><strong>${counts[key]}건</strong><small>${won(amount[key])}</small></div>
      </button>`
    )
    .join("");
}

function renderOrders() {
  renderStatusOverview();
  // 상태/아이템 칩 활성화 표시
  $$("#statusFilterButtons .filter-chip").forEach((b) => b.classList.toggle("active", ui.statusFilter.has(b.dataset.status)));
  $$("#itemFilterButtons .filter-chip").forEach((b) => b.classList.toggle("active", ui.itemFilter.has(b.dataset.item)));

  const rows = filteredOrders();
  const totalAmount = rows.reduce((s, o) => s + orderTotal(o), 0);
  $("resultCount").textContent = `${rows.length}건`;
  $("filteredAmount").textContent = won(totalAmount);

  const pages = Math.max(1, Math.ceil(rows.length / ui.pageSize));
  if (ui.page > pages) ui.page = pages;
  const start = (ui.page - 1) * ui.pageSize;
  const pageRows = rows.slice(start, start + ui.pageSize);
  $("pageInfo").textContent = `${ui.page} / ${pages}`;

  const body = $("ordersBody");
  $("ordersEmpty").hidden = rows.length > 0;
  body.innerHTML = pageRows
    .map((o) => {
      const s = statusOf(o);
      const items = (o.items || [])
        .map((it) => `<span class="item-pill item-${it.item}">${it.item}</span> ${it.model || ""}${it.quantity ? ` ×${it.quantity}` : ""}`)
        .join("<br>");
      return `<tr data-id="${o.id}">
        <td class="check-column"><input type="checkbox" class="row-check" data-id="${o.id}" ${ui.selected.has(o.id) ? "checked" : ""}/></td>
        <td><span class="status-badge status-${s}">${STATUS_LABEL[s]}</span></td>
        <td class="cust-cell">${escapeHtml(o.customer || "-")}</td>
        <td class="model-cell">${items || "-"}</td>
        <td class="number">${won(orderTotal(o))}</td>
        <td>${o.orderDate || "-"}</td>
        <td>${o.dueDate || "-"}</td>
        <td>${o.deliveryDate || '<span class="muted">-</span>'}</td>
        <td>${o.invoiceDate || '<span class="muted">-</span>'}</td>
        <td class="memo-cell" title="${escapeHtml(o.memo || "")}">${escapeHtml((o.memo || "").slice(0, 24))}</td>
        <td class="action-cell">
          <button class="mini-btn" data-edit="${o.id}">수정</button>
          ${!o.deliveryDate ? `<button class="mini-btn delivery" data-deliver="${o.id}">납품</button>` : ""}
          ${o.deliveryDate && !o.invoiceDate ? `<button class="mini-btn invoice" data-invoice="${o.id}">계산서</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  const visIds = pageRows.map((o) => o.id);
  const allChecked = visIds.length > 0 && visIds.every((id) => ui.selected.has(id));
  $("selectAllVisible").checked = allChecked;
  renderBulkBar();
}

function renderBulkBar() {
  const ids = [...ui.selected];
  const bar = $("bulkBar");
  bar.hidden = ids.length === 0;
  if (!ids.length) return;
  const chosen = store.orders.filter((o) => ui.selected.has(o.id));
  $("selectedCount").textContent = `${ids.length}건 선택`;
  $("selectedAmount").textContent = won(chosen.reduce((s, o) => s + orderTotal(o), 0));
}

/* =========================================================
 * 발주 데이터 점검 (audit)
 * =======================================================*/
function computeAudit() {
  const issues = [];
  const seen = new Map();
  const dupGroups = [];
  for (const o of store.orders) {
    const problems = [];
    if (!o.customer) problems.push("업체명 없음");
    if (!o.orderDate) problems.push("발주일 없음");
    if (!o.dueDate) problems.push("납기일 없음");
    if (orderTotal(o) <= 0) problems.push("금액 0 또는 누락");
    if (o.deliveryDate && o.orderDate && o.deliveryDate < o.orderDate) problems.push("납품일이 발주일보다 빠름");
    if (o.invoiceDate && !o.deliveryDate) problems.push("계산서 있으나 납품일 없음");
    const sumItems = (o.items || []).reduce((s, it) => s + parseNum(it.amount), 0);
    if (o.amount && sumItems && Math.abs(parseNum(o.amount) - sumItems) > 1) problems.push("TOTAL과 아이템 합계 불일치");
    if (problems.length) issues.push({ order: o, problems });

    const key = `${(o.customer || "").trim()}|${o.orderDate}|${orderTotal(o)}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(o);
  }
  for (const [key, list] of seen) if (list.length > 1) dupGroups.push({ key, list });
  return { issues, dupGroups };
}

function renderAudit() {
  const { issues, dupGroups } = computeAudit();
  $("auditSummary").innerHTML = `
    <div class="audit-chip ${issues.length ? "warn" : "ok"}"><span>확인 필요</span><strong>${issues.length}건</strong></div>
    <div class="audit-chip ${dupGroups.length ? "warn" : "ok"}"><span>중복 가능 그룹</span><strong>${dupGroups.length}그룹</strong></div>
    <div class="audit-chip"><span>전체 발주</span><strong>${store.orders.length}건</strong></div>`;
  $("auditNote").textContent = issues.length || dupGroups.length
    ? "아래 탭에서 항목을 눌러 해당 발주를 수정할 수 있습니다."
    : "점검 결과 특별한 문제가 발견되지 않았습니다.";
  $$(".audit-tab").forEach((t) => t.classList.toggle("active", t.dataset.auditTab === ui.auditTab));

  const head = $("auditTableHead");
  const body = $("auditTableBody");
  if (ui.auditTab === "issues") {
    head.innerHTML = "<tr><th>업체</th><th>발주일</th><th class='number'>금액</th><th>확인 필요 사유</th><th>작업</th></tr>";
    body.innerHTML = issues.length
      ? issues.map(({ order, problems }) => `<tr>
          <td>${escapeHtml(order.customer || "-")}</td><td>${order.orderDate || "-"}</td>
          <td class="number">${won(orderTotal(order))}</td>
          <td>${problems.map((p) => `<span class="issue-tag">${p}</span>`).join(" ")}</td>
          <td><button class="mini-btn" data-edit="${order.id}">수정</button></td></tr>`).join("")
      : "<tr><td colspan='5' class='muted'>확인이 필요한 항목이 없습니다.</td></tr>";
  } else {
    head.innerHTML = "<tr><th>중복 키 (업체·발주일·금액)</th><th class='number'>건수</th><th>발주 ID</th></tr>";
    body.innerHTML = dupGroups.length
      ? dupGroups.map(({ key, list }) => `<tr>
          <td>${escapeHtml(key.replace(/\|/g, " · "))}</td>
          <td class="number">${list.length}건</td>
          <td>${list.map((o) => `<button class="mini-btn" data-edit="${o.id}">${o.id.slice(-6)}</button>`).join(" ")}</td></tr>`).join("")
      : "<tr><td colspan='3' class='muted'>중복 가능 그룹이 없습니다.</td></tr>";
  }
}

/* =========================================================
 * 통합분석 (analytics view)
 * =======================================================*/
function renderAnalytics() {
  const year = ui.year;
  const yearOrders = store.orders.filter((o) => yearOf(o.orderDate) === year);
  const invOrders = store.orders.filter((o) => yearOf(o.invoiceDate) === year);
  const orderAmt = yearOrders.reduce((s, o) => s + orderTotal(o), 0);
  const invAmt = invOrders.reduce((s, o) => s + orderTotal(o), 0);

  $("allOrderCount").textContent = `${yearOrders.length}건`;
  $("allOrderAmount").textContent = won(orderAmt);
  $("allInvoiceAmount").textContent = won(invAmt);
  $("yearInvoiceCountTop").textContent = `${invOrders.length}건`;
  $("yearInvoiceMeta").textContent = `${year}년 기준`;
  $("yearSummaryTitle").textContent = `${year}년 연간 요약`;
  $("yearOrderCount").textContent = `${yearOrders.length}건`;
  $("yearOrderAmount").textContent = won(orderAmt);
  $("yearInvoiceCount").textContent = `${invOrders.length}건`;
  $("yearInvoiceAmountSide").textContent = won(invAmt);

  // 월별 차트
  const monthly = Array.from({ length: 12 }, () => ({ o: 0, i: 0 }));
  for (const o of store.orders) {
    if (yearOf(o.orderDate) === year && monthOf(o.orderDate)) monthly[monthOf(o.orderDate) - 1].o += orderTotal(o);
    if (yearOf(o.invoiceDate) === year && monthOf(o.invoiceDate)) monthly[monthOf(o.invoiceDate) - 1].i += orderTotal(o);
  }
  const max = Math.max(1, ...monthly.flatMap((m) => [m.o, m.i]));
  $("monthlyChart").innerHTML = monthly
    .map((m, idx) => `
      <button class="chart-col" data-month="${idx + 1}" title="${idx + 1}월 세금계산서 상세">
        <div class="chart-bars">
          <span class="bar order" style="height:${(m.o / max) * 100}%"></span>
          <span class="bar invoice" style="height:${(m.i / max) * 100}%"></span>
        </div>
        <span class="chart-label">${idx + 1}월</span>
      </button>`)
    .join("");

  renderCustomerAnalysis();
}

function renderCustomerAnalysis() {
  const year = ui.year;
  const q = ui.customerSearch.trim().toLowerCase();
  const map = new Map();
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    if (q && !name.toLowerCase().includes(q)) continue;
    if (!map.has(name)) map.set(name, { name, total: 0, count: 0, months: Array(12).fill(0) });
    const row = map.get(name);
    row.total += orderTotal(o);
    row.count += 1;
    const im = monthOf(o.invoiceDate);
    if (im) row.months[im - 1] += orderTotal(o);
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  $("customerEmpty").hidden = rows.length > 0;

  // 월 버튼 바
  $("customerMonthBar").innerHTML = Array.from({ length: 12 }, (_, i) =>
    `<button class="month-pill" data-cust-month="${i + 1}">${i + 1}월</button>`).join("");

  $("customerTableHead").innerHTML =
    `<tr><th>거래처</th><th class="number">건수</th>${Array.from({ length: 12 }, (_, i) => `<th class="number">${i + 1}월</th>`).join("")}<th class="number">합계</th></tr>`;
  $("customerTableBody").innerHTML = rows
    .map((r) => `<tr>
      <td>${escapeHtml(r.name)}</td><td class="number">${r.count}</td>
      ${r.months.map((v) => `<td class="number">${v ? won(v) : "-"}</td>`).join("")}
      <td class="number strong">${won(r.total)}</td></tr>`)
    .join("");
}

function openMonthDetail(month) {
  const year = ui.year;
  const map = new Map();
  let total = 0;
  let count = 0;
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year || monthOf(o.invoiceDate) !== month) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    if (!map.has(name)) map.set(name, { name, count: 0, amount: 0 });
    const r = map.get(name);
    r.count += 1;
    r.amount += orderTotal(o);
    total += orderTotal(o);
    count += 1;
  }
  const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
  $("monthDetailTitle").textContent = `${year}년 ${month}월 세금계산서 거래처`;
  $("monthDetailSubtitle").textContent = `계산서 발행일 기준`;
  $("monthDetailSummary").innerHTML = `
    <div><span>거래처</span><strong>${rows.length}곳</strong></div>
    <div><span>계산서 건수</span><strong>${count}건</strong></div>
    <div class="amount"><span>계산서 금액</span><strong>${won(total)}</strong></div>`;
  $("monthDetailTableBody").innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="number">${r.count}건</td><td class="number">${won(r.amount)}</td></tr>`).join("")
    : "<tr><td colspan='3' class='muted'>해당 월 계산서 내역이 없습니다.</td></tr>";
  $("monthDetailDialog").showModal();
}

/* =========================================================
 * 연간영업실적 및 계획 (performance view)
 * =======================================================*/
function metricFor(year, code) {
  return store.annualMetrics.find((m) => Number(m.year) === year && m.item === code);
}
function planValuesFor(year) {
  return store.planValues.filter((p) => Number(p.year) === year);
}
// ITEM별 4분기 NEW BUDGET = 해당 ITEM 업체들의 next_budget 합계
function q4SumForItem(year, code) {
  const label = ITEM_NAME[code];
  return planValuesFor(year)
    .filter((p) => (NAME_TO_CODE[p.item_label] || p.item_label) === code || p.item_label === label)
    .reduce((s, p) => s + parseNum(p.next_budget), 0);
}
function invoiceTotalsByItem(year) {
  const totals = {};
  const custs = {};
  for (const c of ITEM_CODES) { totals[c] = 0; custs[c] = new Set(); }
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year) continue;
    const name = (o.customer || "미지정").trim();
    const items = o.items && o.items.length ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
    for (const it of items) {
      const c = ITEM_CODES.includes(it.item) ? it.item : "ETC";
      totals[c] += parseNum(it.amount);
      custs[c].add(name);
    }
  }
  return { totals, custs };
}

function renderPerformance() {
  const year = ui.year;
  const { totals, custs } = invoiceTotalsByItem(year);
  const budgetSum = ITEM_CODES.reduce((s, c) => s + (metricFor(year, c) ? parseNum(metricFor(year, c).budget) : 0), 0);
  const invAmt = ITEM_CODES.reduce((s, c) => s + totals[c], 0);
  const invOrders = store.orders.filter((o) => yearOf(o.invoiceDate) === year);
  const custCount = new Set(invOrders.map((o) => (o.customer || "").trim()).filter(Boolean)).size;

  $("perfBudgetAmount").textContent = budgetSum ? won(budgetSum) : "-";
  $("perfBudgetYearLabel").textContent = `${year}년`;
  $("perfInvoiceAmount").textContent = won(invAmt);
  $("perfYearLabel").textContent = `${year}년 세금계산서 기준`;
  $("perfAchievementRate").textContent = budgetSum ? `${Math.round((invAmt / budgetSum) * 1000) / 10}%` : "-";
  $("perfInvoiceCount").textContent = `${invOrders.length}건`;
  $("perfCustomerCount").textContent = `${custCount}곳`;

  // ITEM별 실적 테이블
  let itemMatch = true;
  $("itemPerformanceBody").innerHTML = ITEM_CODES.map((c) => {
    const m = metricFor(year, c);
    const budget = m ? parseNum(m.budget) : 0;
    const q2 = m ? parseNum(m.q2_new_budget) : 0;
    const q3 = m ? parseNum(m.q3_new_budget) : 0;
    const q4 = q4SumForItem(year, c);
    const total = totals[c];
    const lastBudget = q4 || q3 || q2 || budget;
    const rate = lastBudget ? `${Math.round((total / lastBudget) * 1000) / 10}%` : "-";
    return `<tr class="item-row" data-item-detail="${c}">
      <td><span class="item-pill item-${c}">${c}</span> ${ITEM_NAME[c]}</td>
      <td class="number">${custs[c].size}</td>
      <td class="number">${won(budget)}</td>
      <td class="number">${won(q2)}</td>
      <td class="number">${won(q3)}</td>
      <td class="number">${q4 ? won(q4) : "-"}</td>
      <td class="number strong">${won(total)}</td>
      <td class="number">${rate}</td></tr>`;
  }).join("");
  $("itemReconcileBadge").textContent = itemMatch ? "금액 일치" : "금액 확인 필요";
  $("itemReconcileBadge").className = `reconcile-badge ${itemMatch ? "ok" : "warn"}`;

  renderAmountBuckets(year);
  renderPlanItemFilters();
  renderFuturePlan(year);
  renderYearlyAnalysis();
}

const BUCKETS = [
  { key: "b1", label: "5천만~1억원", min: 50000000, max: 100000000 },
  { key: "b2", label: "1천만~5천만원", min: 10000000, max: 50000000 },
  { key: "b3", label: "100만~1천만원", min: 1000000, max: 10000000 },
  { key: "b4", label: "100만원 미만", min: 0, max: 1000000 },
];
function customerInvoiceTotals(year) {
  const map = new Map();
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    if (!map.has(name)) map.set(name, { name, count: 0, amount: 0 });
    const r = map.get(name);
    r.count += 1;
    r.amount += orderTotal(o);
  }
  return [...map.values()];
}
function renderAmountBuckets(year) {
  const custs = customerInvoiceTotals(year);
  const grid = $("amountBucketGrid");
  grid.innerHTML = BUCKETS.map((b) => {
    const list = custs.filter((c) => c.amount >= b.min && c.amount < b.max);
    const sum = list.reduce((s, c) => s + c.amount, 0);
    return `<button class="bucket-card" data-bucket="${b.key}">
      <span class="bucket-label">${b.label}</span>
      <strong>${list.length}곳</strong>
      <small>${won(sum)}</small></button>`;
  }).join("");
}
function openBucketDialog(key) {
  const b = BUCKETS.find((x) => x.key === key);
  const custs = customerInvoiceTotals(ui.year).filter((c) => c.amount >= b.min && c.amount < b.max)
    .sort((a, c) => c.amount - a.amount);
  $("bucketDialogTitle").textContent = `${b.label} 거래업체`;
  $("bucketDialogSubtitle").textContent = `${ui.year}년 세금계산서 기준 · ${custs.length}곳`;
  $("bucketDialogBody").innerHTML = custs.length
    ? custs.map((c, i) => `<tr><td class="number">${i + 1}</td><td>${escapeHtml(c.name)}</td><td class="number">${c.count}건</td><td class="number">${won(c.amount)}</td></tr>`).join("")
    : "<tr><td colspan='4' class='muted'>해당 구간 업체가 없습니다.</td></tr>";
  $("bucketDialog").showModal();
}

function renderPlanItemFilters() {
  $("planItemFilters").innerHTML = ITEM_CODES.map((c) =>
    `<button class="plan-item-chip item-${c} ${ui.planItem === c ? "active" : ""}" data-plan-item="${c}">
      <b>${c}</b><span>${ITEM_NAME[c]}</span></button>`).join("");
}

function renderFuturePlan(year) {
  const code = ui.planItem;
  const label = ITEM_NAME[code];
  const rows = planValuesFor(year).filter((p) => (NAME_TO_CODE[p.item_label] || p.item_label) === code || p.item_label === label);
  // 현재 TOTAL(거래처별, 해당 ITEM 세금계산서)
  const custTotals = new Map();
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year) continue;
    const name = (o.customer || "미지정").trim();
    const items = o.items && o.items.length ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
    for (const it of items) {
      const c = ITEM_CODES.includes(it.item) ? it.item : "ETC";
      if (c !== code) continue;
      custTotals.set(name, (custTotals.get(name) || 0) + parseNum(it.amount));
    }
  }

  const body = $("futurePlanBody");
  const list = rows.slice();
  // ETC의 경우 실제 계산서 거래처도 병합 표시
  if (code === "ETC") {
    for (const [name] of custTotals) {
      if (!list.some((r) => (r.customer || "") === name)) {
        list.push({ year, item_label: "ETC", customer: name, budget: null, q2_budget: null, q3_budget: null, next_budget: null, _actual: true });
      }
    }
  }

  body.innerHTML = list.length
    ? list.map((p) => {
        const cur = custTotals.get(p.customer) || 0;
        const q4 = parseNum(p.next_budget);
        const last = q4 || parseNum(p.q3_budget) || parseNum(p.q2_budget) || parseNum(p.budget);
        const rate = last ? `${Math.round((cur / last) * 1000) / 10}%` : "-";
        return `<tr>
          <td>${escapeHtml(p.customer || "-")}</td>
          <td class="number">${p.budget != null ? won(p.budget) : "-"}</td>
          <td class="number">${p.q2_budget != null ? won(p.q2_budget) : "-"}</td>
          <td class="number">${p.q3_budget != null ? won(p.q3_budget) : "-"}</td>
          <td class="number"><input class="plan-next-input" data-plan-customer="${escapeHtml(p.customer || "")}" data-plan-label="${escapeHtml(p.item_label)}" value="${q4 ? won(q4) : ""}" inputmode="numeric" placeholder="0"/></td>
          <td class="number strong">${won(cur)}</td>
          <td class="number">${rate}</td></tr>`;
      }).join("")
    : `<tr><td colspan="7" class="muted">${code} BUDGET 업체가 없습니다.</td></tr>`;

  const totalNext = list.reduce((s, p) => s + parseNum(p.next_budget), 0);
  $("budgetPlanReconcileBadge").textContent = totalNext ? `4분기 합계 ${won(totalNext)}` : "4분기 미입력";
  $("budgetPlanReconcileBadge").className = "reconcile-badge ok";
}

async function savePlanNext(customer, label, value) {
  const year = ui.year;
  const rows = store.planValues.slice();
  let row = rows.find((p) => Number(p.year) === year && p.item_label === label && (p.customer || "") === customer);
  if (!row) {
    row = { year, item_label: label, customer, budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "직접 입력" };
    rows.push(row);
  }
  row.next_budget = parseNum(value) || null;
  store.planValues = rows;
  await api("/api/plan-values", { method: "PUT", body: rows });
  renderPerformance();
}

function openItemPerformanceDialog(code) {
  const year = ui.year;
  const map = new Map();
  let total = 0;
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year) continue;
    const name = (o.customer || "미지정").trim();
    const items = o.items && o.items.length ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
    for (const it of items) {
      const c = ITEM_CODES.includes(it.item) ? it.item : "ETC";
      if (c !== code) continue;
      if (!map.has(name)) map.set(name, { name, count: 0, amount: 0 });
      const r = map.get(name);
      r.count += 1;
      r.amount += parseNum(it.amount);
      total += parseNum(it.amount);
    }
  }
  const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
  const dlg = $("itemPerformanceDialog");
  dlg.dataset.itemTheme = code;
  $("itemPerformanceDialogTitle").textContent = `${code} · ${ITEM_NAME[code]} 거래처 실적`;
  $("itemPerformanceDialogSubtitle").textContent = `${year}년 세금계산서 기준 · 합계 ${won(total)}`;
  $("itemPerformanceDialogBody").innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="number">${r.count}건</td><td class="number">${won(r.amount)}</td><td class="number">${total ? Math.round((r.amount / total) * 1000) / 10 : 0}%</td></tr>`).join("")
    : "<tr><td colspan='4' class='muted'>해당 ITEM 계산서 내역이 없습니다.</td></tr>";
  dlg.showModal();
}

/* 연도별 업무분석 */
function yearlyAnalysisRow(year) {
  return store.yearlyAnalysis.find((r) => Number(r.year) === year);
}
function renderYearlyAnalysis() {
  const years = availableYears();
  const body = $("yearlyAnalysisBody");
  body.innerHTML = years.map((y) => {
    const orders = store.orders.filter((o) => yearOf(o.orderDate) === y);
    const invOrders = store.orders.filter((o) => yearOf(o.invoiceDate) === y);
    const custCount = new Set(orders.map((o) => (o.customer || "").trim()).filter(Boolean)).size;
    const invAmt = invOrders.reduce((s, o) => s + orderTotal(o), 0);
    const extra = yearlyAnalysisRow(y) || {};
    return `<tr>
      <td>${y}년</td>
      <td><input class="yearly-input" data-yearly-field="quoteCount" data-year="${y}" value="${extra.quoteCount ?? ""}" inputmode="numeric" placeholder="0"/></td>
      <td class="number">${orders.length}건</td>
      <td class="number">${custCount}곳</td>
      <td><input class="yearly-input" data-yearly-field="visitCount" data-year="${y}" value="${extra.visitCount ?? ""}" inputmode="numeric" placeholder="0"/></td>
      <td class="number">${invOrders.length}건</td>
      <td class="number strong">${won(invAmt)}</td></tr>`;
  }).join("");

  const chartData = years.map((y) => ({
    y, amount: store.orders.filter((o) => yearOf(o.invoiceDate) === y).reduce((s, o) => s + orderTotal(o), 0),
  })).sort((a, b) => a.y - b.y);
  const max = Math.max(1, ...chartData.map((d) => d.amount));
  $("yearlyAmountChart").innerHTML = chartData.map((d) =>
    `<div class="year-bar-row"><span class="year-bar-label">${d.y}</span>
      <div class="year-bar-track"><span class="year-bar" style="width:${(d.amount / max) * 100}%"></span></div>
      <span class="year-bar-value">${won(d.amount)}</span></div>`).join("");
}
async function saveYearlyAnalysis(year, field, value) {
  const rows = store.yearlyAnalysis.slice();
  let row = rows.find((r) => Number(r.year) === year);
  if (!row) { row = { year }; rows.push(row); }
  row[field] = parseNum(value) || 0;
  store.yearlyAnalysis = rows;
  await api("/api/yearly-analysis", { method: "PUT", body: rows });
}

/* =========================================================
 * 월간회의 (forecast view)
 * =======================================================*/
const DEFAULT_RECURRING = [
  { customer: "반복 거래처 1", item: "D", model: "정기 납품", quantity: 1, amount: 0 },
  { customer: "반복 거래처 2", item: "F", model: "정기 납품", quantity: 1, amount: 0 },
  { customer: "반복 거래처 3", item: "G", model: "정기 납품", quantity: 1, amount: 0 },
  { customer: "반복 거래처 4", item: "H", model: "정기 납품", quantity: 1, amount: 0 },
];
function ensureRecurringDefaults() {
  // recurringForecasts는 월별 override만 저장. base는 DEFAULT_RECURRING.
  if (!Array.isArray(store.recurringForecasts)) store.recurringForecasts = [];
}
function recurringForMonth(month) {
  return DEFAULT_RECURRING.map((base, index) => {
    const ov = store.recurringForecasts.find((r) => Number(r.month) === month && Number(r.index) === index);
    return { ...base, ...(ov || {}), index, month, amount: parseNum(ov ? ov.amount : base.amount) };
  });
}

function renderForecast() {
  // 연도 셀렉트 채우기
  fillYearSelect("resultYearFilter", ui.year, (v) => { ui.year = v; renderForecast(); });
  fillYearSelect("forecastYearFilter", ui.year, (v) => { ui.year = v; renderForecast(); });
  fillYearSelect("planYearFilter", ui.year, (v) => { ui.year = v; renderForecast(); });
  renderMonthChips("resultMonthButtons", ui.resultMonth, (m) => { ui.resultMonth = m; renderPreviousResult(); });
  renderMonthChips("forecastMonthButtons", ui.forecastMonth, (m) => { ui.forecastMonth = m; renderForecastPanel(); });
  renderMonthChips("planMonthButtons", ui.planMonth, (m) => { ui.planMonth = m; renderMonthlyPlan(); });
  renderPreviousResult();
  renderForecastPanel();
  renderMonthlyPlan();
}

function renderPreviousResult() {
  const year = ui.year;
  const month = ui.resultMonth;
  $("previousResultTitle").textContent = `${month}월 결과`;
  const rows = store.orders.filter((o) => yearOf(o.invoiceDate) === year && monthOf(o.invoiceDate) === month);
  const total = rows.reduce((s, o) => s + orderTotal(o), 0);
  $("previousInvoiceCount").textContent = `${rows.length}건`;
  $("previousInvoiceAmount").textContent = won(total);

  const groups = new Map();
  const itemSum = {};
  for (const c of ITEM_CODES) itemSum[c] = 0;
  for (const o of rows) {
    const name = (o.customer || "미지정").trim();
    const items = o.items && o.items.length ? o.items : [{ item: "ETC", model: "", quantity: "", amount: orderTotal(o) }];
    for (const it of items) {
      const c = ITEM_CODES.includes(it.item) ? it.item : "ETC";
      const key = `${name}|${c}`;
      if (!groups.has(key)) groups.set(key, { name, item: c, models: [], amount: 0 });
      const g = groups.get(key);
      if (it.model) g.models.push(`${it.model}${it.quantity ? ` ×${it.quantity}` : ""}`);
      g.amount += parseNum(it.amount);
      itemSum[c] += parseNum(it.amount);
    }
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || b.amount - a.amount);
  $("previousResultEmpty").hidden = list.length > 0;
  $("previousResultBody").innerHTML = list.map((g) =>
    `<tr><td>${escapeHtml(g.name)}</td><td><span class="item-pill item-${g.item}">${g.item}</span></td>
      <td>${escapeHtml(g.models.join(", ") || "-")}</td><td class="number">${won(g.amount)}</td></tr>`).join("");

  $("previousItemSummaryBody").innerHTML = ITEM_CODES.map((c) =>
    `<tr><td><span class="item-pill item-${c}">${c}</span></td><td class="number">${won(itemSum[c])}</td></tr>`)
    .concat(`<tr class="sum-row"><td>TOTAL</td><td class="number strong">${won(total)}</td></tr>`).join("");
}

function renderForecastPanel() {
  const month = ui.forecastMonth;
  $("currentForecastTitle").textContent = `${month}월 예상`;
  $$(".forecast-tab").forEach((t) => t.classList.toggle("active", t.dataset.forecastType === ui.forecastType));

  const recurring = recurringForMonth(month);
  const recurringAmt = recurring.reduce((s, r) => s + parseNum(r.amount), 0);
  $("recurringForecastAmount").textContent = won(recurringAmt);

  let entries = [];
  if (ui.forecastType === "order") {
    // 발주 예상: 직접 추가된 order 예상(해당 월) + 반복
    const manual = store.forecasts.filter((f) => f.type === "order" && monthOf(f.entryMonth) === month && yearOf(f.entryMonth) === ui.year);
    entries = manual.map((f) => ({
      id: f.id, kind: "manual", name: f.customer, note: f.note || "직접 추가",
      items: f.items || [], amount: parseNum(f.amount) || (f.items || []).reduce((s, it) => s + parseNum(it.amount), 0),
    }));
  } else {
    // 계산서 예상: 납품완료·미계산서 + 선택월까지 납기인 미계산서 + 직접추가(invoice) + 반복
    const target = `${ui.year}-${String(month).padStart(2, "0")}`;
    const auto = store.orders.filter((o) => {
      if (o.invoiceDate) return false;
      if (o.deliveryDate) return true; // 납품완료·미계산서
      if (o.dueDate && o.dueDate.slice(0, 7) <= target) return true; // 선택월까지 납기
      return false;
    });
    entries = auto.map((o) => ({
      id: o.id, kind: "auto", name: o.customer, note: o.deliveryDate ? "납품완료·미계산서" : "납기도래 미계산서",
      items: o.items || [], amount: orderTotal(o),
    }));
    const manual = store.forecasts.filter((f) => f.type === "invoice" && monthOf(f.invoiceMonth || f.entryMonth) === month && yearOf(f.invoiceMonth || f.entryMonth) === ui.year);
    entries = entries.concat(manual.map((f) => ({
      id: f.id, kind: "manual", name: f.customer, note: f.note || "직접 추가",
      items: f.items || [], amount: parseNum(f.amount) || (f.items || []).reduce((s, it) => s + parseNum(it.amount), 0),
    })));
  }

  // 반복 예상 추가
  const recurringEntries = recurring.map((r) => ({
    kind: "recurring", index: r.index, name: r.customer, note: "매월 반복예상",
    items: [{ item: r.item, model: r.model, quantity: r.quantity, amount: r.amount }], amount: parseNum(r.amount),
  }));
  const all = [...recurringEntries, ...entries];
  const totalAmt = all.reduce((s, e) => s + e.amount, 0);
  $("forecastCount").textContent = `${entries.length}건`;
  $("forecastAmount").textContent = won(totalAmt);

  $("forecastEmpty").hidden = all.length > 0;
  $("forecastBody").innerHTML = all.map((e) => {
    const itemPills = (e.items || []).map((it) =>
      `<span class="item-pill item-${ITEM_CODES.includes(it.item) ? it.item : "ETC"}">${it.item}</span>`).join(" ");
    const models = (e.items || []).map((it) => `${it.model || ""}${it.quantity ? ` ×${it.quantity}` : ""}`).join(", ");
    let action = "";
    if (e.kind === "recurring") action = `<button class="mini-btn" data-recurring-edit="${e.index}">수정</button>`;
    else if (e.kind === "manual") action = `<button class="mini-btn" data-forecast-edit="${e.id}">수정</button>`;
    else action = `<span class="muted">자동</span>`;
    return `<tr class="forecast-row kind-${e.kind}">
      <td>${escapeHtml(e.name || "-")}</td>
      <td>${itemPills}</td>
      <td>${escapeHtml(models || "-")}</td>
      <td><span class="forecast-note">${escapeHtml(e.note)}</span></td>
      <td class="number">${won(e.amount)}</td>
      <td class="action-cell">${action}</td></tr>`;
  }).join("");
}

function renderMonthlyPlan() {
  const year = ui.year;
  const month = ui.planMonth;
  $("monthlyPlanTitle").textContent = `${month}월 주요 계획`;
  const row = store.monthlyPlans.find((p) => Number(p.year) === year && Number(p.month) === month);
  $("monthlyPlanText").value = row ? row.text : "";
  $("monthlyPlanSavedAt").textContent = row && row.savedAt ? `저장됨: ${new Date(row.savedAt).toLocaleString("ko-KR")}` : "";
}

/* =========================================================
 * 셀렉트/칩 헬퍼
 * =======================================================*/
function fillYearSelect(id, selected, onChange) {
  const sel = $(id);
  if (!sel) return;
  const years = availableYears();
  sel.innerHTML = years.map((y) => `<option value="${y}" ${y === selected ? "selected" : ""}>${y}년</option>`).join("");
  sel.onchange = () => onChange(Number(sel.value));
}
function renderMonthChips(id, selected, onChange) {
  const box = $(id);
  if (!box) return;
  box.innerHTML = Array.from({ length: 12 }, (_, i) =>
    `<button class="month-chip ${i + 1 === selected ? "active" : ""}" data-month-chip="${i + 1}">${i + 1}월</button>`).join("");
  box.onclick = (e) => {
    const btn = e.target.closest("[data-month-chip]");
    if (!btn) return;
    onChange(Number(btn.dataset.monthChip));
  };
}

/* =========================================================
 * 발주 등록/수정 다이얼로그
 * =======================================================*/
let orderItemsDraft = [];
function renderOrderItemGroups() {
  const box = $("orderItemGroups");
  $("orderItemEmptyGuide").hidden = orderItemsDraft.length > 0;
  box.innerHTML = orderItemsDraft.map((g, idx) => `
    <div class="item-group item-${g.item}" data-group="${idx}">
      <div class="item-group-tag"><span class="item-pill item-${g.item}">${g.item}</span>${ITEM_NAME[g.item]}</div>
      <input class="ig-model" data-group="${idx}" placeholder="모델명" value="${escapeHtml(g.model || "")}"/>
      <input class="ig-qty" data-group="${idx}" type="number" min="0" placeholder="수량" value="${g.quantity ?? ""}"/>
      <input class="ig-amount" data-group="${idx}" inputmode="numeric" placeholder="금액" value="${g.amount ? won(g.amount) : ""}"/>
      <button type="button" class="ig-remove" data-group="${idx}">×</button>
    </div>`).join("");
  updateItemReconcile();
}
function updateItemReconcile() {
  const sum = orderItemsDraft.reduce((s, g) => s + parseNum(g.amount), 0);
  const total = parseNum($("amount").value);
  $("itemAmountSum").textContent = won(sum);
  const box = $("itemAmountReconcile");
  if (!total) {
    $("itemAmountStatus").textContent = "TOTAL 미입력";
    box.className = "item-amount-reconcile";
  } else if (Math.abs(sum - total) <= 1) {
    $("itemAmountStatus").textContent = "TOTAL과 일치";
    box.className = "item-amount-reconcile is-match";
  } else {
    $("itemAmountStatus").textContent = `차이 ${won(total - sum)}`;
    box.className = "item-amount-reconcile is-diff";
  }
}
function openOrderDialog(order) {
  ui.editingOrderId = order ? order.id : null;
  $("orderDialogTitle").textContent = order ? "발주 수정" : "신규 발주 등록";
  $("customer").value = order?.customer || "";
  $("amount").value = order?.amount ? won(order.amount) : "";
  $("orderDate").value = order?.orderDate || todayStr();
  $("dueDate").value = order?.dueDate || "";
  $("deliveryDate").value = order?.deliveryDate || "";
  $("invoiceDate").value = order?.invoiceDate || "";
  $("memo").value = order?.memo || "";
  $("owner").value = order?.owner || "나";
  orderItemsDraft = (order?.items || []).map((it) => ({ ...it }));
  renderOrderItemGroups();
  $("deleteButton").hidden = !order;
  $("orderDialog").showModal();
}
async function saveOrder() {
  const customer = $("customer").value.trim();
  if (!customer) return toast("업체명을 입력해주세요.", "error");
  const orderDate = $("orderDate").value;
  const dueDate = $("dueDate").value;
  if (!orderDate || !dueDate) return toast("발주일과 납기일을 입력해주세요.", "error");
  if (!orderItemsDraft.length) return toast("아이템을 1개 이상 추가해주세요.", "error");

  const items = orderItemsDraft.map((g) => ({
    item: g.item, model: g.model || "", quantity: parseNum(g.quantity) || null, amount: parseNum(g.amount) || 0,
  }));
  let amount = parseNum($("amount").value);
  if (!amount) amount = items.reduce((s, it) => s + it.amount, 0);

  const payload = {
    customer, amount, items, orderDate, dueDate,
    deliveryDate: $("deliveryDate").value || null,
    invoiceDate: $("invoiceDate").value || null,
    memo: $("memo").value.trim(),
    owner: $("owner").value.trim() || "나",
  };
  try {
    if (ui.editingOrderId) await api(`/api/orders/${ui.editingOrderId}`, { method: "PUT", body: payload });
    else await api("/api/orders", { method: "POST", body: payload });
    $("orderDialog").close();
    await refreshAll();
    renderView();
    fillAnalysisYearSelect();
    toast(ui.editingOrderId ? "발주를 수정했습니다." : "발주를 등록했습니다.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function deleteOrder() {
  if (!ui.editingOrderId) return;
  if (!confirm("이 발주를 삭제할까요?")) return;
  await api(`/api/orders/${ui.editingOrderId}`, { method: "DELETE" });
  $("orderDialog").close();
  ui.selected.delete(ui.editingOrderId);
  await refreshAll();
  renderView();
  toast("발주를 삭제했습니다.", "success");
}

/* 완료 처리 다이얼로그 (납품/계산서) */
function openCompleteDialog(context) {
  ui.completeContext = context; // { ids:[], field:'deliveryDate'|'invoiceDate' }
  const isDelivery = context.field === "deliveryDate";
  $("completeDialogTitle").textContent = isDelivery ? "납품 완료 처리" : "세금계산서 완료 처리";
  $("completeDescription").textContent = `${context.ids.length}건을 ${isDelivery ? "납품 완료" : "계산서 발행"} 처리합니다. 날짜를 선택하세요.`;
  $("completeDate").value = todayStr();
  $("completeDialog").showModal();
}
async function applyComplete() {
  const ctx = ui.completeContext;
  if (!ctx) return;
  const date = $("completeDate").value;
  if (!date) return toast("날짜를 선택해주세요.", "error");
  const body = { ids: ctx.ids };
  body[ctx.field] = date;
  await api("/api/orders/bulk", { method: "POST", body });
  $("completeDialog").close();
  ui.selected.clear();
  await refreshAll();
  renderView();
  toast("처리를 완료했습니다.", "success");
}

/* =========================================================
 * 예상 직접 추가 다이얼로그
 * =======================================================*/
let forecastItemsDraft = [];
function renderForecastItemGroups() {
  const box = $("forecastItemGroups");
  $("forecastItemEmptyGuide").hidden = forecastItemsDraft.length > 0;
  box.innerHTML = forecastItemsDraft.map((g, idx) => `
    <div class="item-group item-${g.item}" data-fgroup="${idx}">
      <div class="item-group-tag"><span class="item-pill item-${g.item}">${g.item}</span>${ITEM_NAME[g.item]}</div>
      <input class="fg-model" data-fgroup="${idx}" placeholder="모델명" value="${escapeHtml(g.model || "")}"/>
      <input class="fg-qty" data-fgroup="${idx}" type="number" min="0" placeholder="수량" value="${g.quantity ?? ""}"/>
      <button type="button" class="fg-remove" data-fgroup="${idx}">×</button>
    </div>`).join("");
}
function openForecastDialog(forecast) {
  ui.editingForecastId = forecast ? forecast.id : null;
  const type = forecast ? forecast.type : (ui.forecastType === "order" ? "order" : "invoice");
  $("forecastType").value = type;
  $("forecastDialogTitle").textContent = forecast ? "예상 수정" : (type === "order" ? "발주 예상 직접 추가" : "계산서 예상 직접 추가");
  const ym = `${ui.year}-${String(ui.forecastMonth).padStart(2, "0")}`;
  $("forecastEntryMonth").value = forecast?.entryMonth || ym;
  $("forecastInvoiceMonth").value = forecast?.invoiceMonth || (type === "invoice" ? ym : "");
  $("forecastCustomer").value = forecast?.customer || "";
  $("forecastEntryAmount").value = forecast?.amount ? won(forecast.amount) : "";
  $("forecastNote").value = forecast?.note || "";
  forecastItemsDraft = (forecast?.items || []).map((it) => ({ ...it }));
  renderForecastItemGroups();
  $("deleteForecastButton").hidden = !forecast;
  $("forecastDialog").showModal();
}
async function saveForecast(e) {
  e.preventDefault();
  const customer = $("forecastCustomer").value.trim();
  if (!customer) return toast("업체명을 입력해주세요.", "error");
  const type = $("forecastType").value;
  const items = forecastItemsDraft.map((g) => ({ item: g.item, model: g.model || "", quantity: parseNum(g.quantity) || null }));
  if (!items.length) return toast("아이템을 1개 이상 추가해주세요.", "error");
  const payload = {
    type, customer,
    entryMonth: $("forecastEntryMonth").value,
    invoiceMonth: $("forecastInvoiceMonth").value || null,
    amount: parseNum($("forecastEntryAmount").value) || 0,
    items, note: $("forecastNote").value.trim(),
  };
  if (ui.editingForecastId) await api(`/api/forecasts/${ui.editingForecastId}`, { method: "PUT", body: payload });
  else await api("/api/forecasts", { method: "POST", body: payload });
  $("forecastDialog").close();
  await refreshAll();
  renderForecast();
  toast("예상을 저장했습니다.", "success");
}
async function deleteForecast() {
  if (!ui.editingForecastId) return;
  await api(`/api/forecasts/${ui.editingForecastId}`, { method: "DELETE" });
  $("forecastDialog").close();
  await refreshAll();
  renderForecast();
  toast("예상을 삭제했습니다.", "success");
}

/* 반복 예상 수정 */
function openRecurringDialog(index) {
  const month = ui.forecastMonth;
  const cur = recurringForMonth(month)[index];
  ui.recurringEdit = { index, month };
  $("recurringEditMonthLabel").textContent = `${ui.year}년 ${month}월`;
  $("recurringCustomer").value = cur.customer || "";
  $("recurringItem").value = cur.item || "D";
  $("recurringQuantity").value = cur.quantity ?? 1;
  $("recurringModel").value = cur.model || "";
  const amtEl = $("recurringAmount");
  amtEl.removeAttribute("readonly");
  amtEl.value = cur.amount ? won(cur.amount) : "";
  $("recurringUnitPriceHint").textContent = cur.quantity ? `단가 ≈ ${won(parseNum(cur.amount) / cur.quantity)}` : "";
  $("recurringForecastDialog").showModal();
}
async function saveRecurring(e) {
  e.preventDefault();
  const { index, month } = ui.recurringEdit;
  const rows = store.recurringForecasts.filter((r) => !(Number(r.month) === month && Number(r.index) === index));
  rows.push({
    month, index,
    customer: $("recurringCustomer").value.trim(),
    item: $("recurringItem").value,
    quantity: parseNum($("recurringQuantity").value) || 1,
    model: $("recurringModel").value.trim(),
    amount: parseNum($("recurringAmount").value) || 0,
  });
  store.recurringForecasts = rows;
  await api("/api/recurring-forecasts", { method: "PUT", body: rows });
  $("recurringForecastDialog").close();
  renderForecast();
  toast("이 달 반복 예상을 저장했습니다.", "success");
}
async function resetRecurring() {
  const { index, month } = ui.recurringEdit;
  const rows = store.recurringForecasts.filter((r) => !(Number(r.month) === month && Number(r.index) === index));
  store.recurringForecasts = rows;
  await api("/api/recurring-forecasts", { method: "PUT", body: rows });
  $("recurringForecastDialog").close();
  renderForecast();
  toast("이 달 반복 예상을 기본값으로 되돌렸습니다.", "success");
}

/* =========================================================
 * 백업 / 복원 / 내보내기 / 제출본
 * =======================================================*/
async function backupNow() {
  await api("/api/backups", { method: "POST" });
  toast("백업을 생성했습니다.", "success");
}
async function openBackupManager() {
  await renderBackupList();
  $("backupManagerDialog").showModal();
}
async function renderBackupList() {
  const rows = await api("/api/backups");
  $("backupListEmpty").hidden = rows.length > 0;
  $("backupListBody").innerHTML = rows.map((b) => {
    const d = new Date(b.createdAt);
    return `<tr>
      <td>${d.toLocaleDateString("ko-KR")}</td>
      <td>${d.toLocaleTimeString("ko-KR")}</td>
      <td>${b.typeLabel}</td>
      <td class="number">${(b.size / 1024).toFixed(1)} KB</td>
      <td><button class="mini-btn" data-restore="${escapeHtml(b.name)}">복원</button></td></tr>`;
  }).join("");
}
async function restoreBackup(name) {
  if (!confirm("이 시점으로 복원할까요? 현재 상태는 복원 전 백업으로 보관됩니다.")) return;
  await api("/api/backups/restore", { method: "POST", body: { name } });
  await refreshAll();
  renderView();
  toast("복원을 완료했습니다.", "success");
}
async function downloadJsonBackup() {
  const snap = await api("/api/export");
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  triggerDownload(blob, `발주관리앱-백업-${todayStr()}.json`);
  toast("JSON 백업을 다운로드했습니다.", "success");
}
function restoreFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm("이 파일로 데이터를 복원할까요? 현재 상태는 복원 전 백업으로 보관됩니다.")) return;
      await api("/api/import", { method: "POST", body: data });
      await refreshAll();
      renderView();
      toast("복원을 완료했습니다.", "success");
    } catch (e) {
      toast("복원 실패: " + e.message, "error");
    }
  };
  reader.readAsText(file);
}
async function createSubmissionHtml() {
  const title = $("submissionTitle").value.trim();
  $("submissionHtmlStatus").textContent = "생성 중...";
  try {
    const res = await api("/api/submission", { method: "POST", body: { title } });
    const blob = new Blob([res.html], { type: "text/html;charset=utf-8" });
    const name = (title || "발주관리앱-제출본").replace(/[\\/:*?"<>|]/g, "_") + ".html";
    triggerDownload(blob, name);
    $("submissionHtmlStatus").textContent = "생성 완료! 다운로드된 .html 파일을 이메일에 첨부하세요.";
    toast("제출용 HTML을 생성했습니다.", "success");
  } catch (e) {
    $("submissionHtmlStatus").textContent = "생성 실패: " + e.message;
  }
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =========================================================
 * 엑셀 내보내기 / 가져오기 (XLSX 전역)
 * =======================================================*/
function exportExcel() {
  if (typeof XLSX === "undefined") return toast("엑셀 기능이 준비되지 않았습니다. (xlsx 라이브러리 없음)", "error");
  const rows = filteredOrders().map((o) => ({
    상태: STATUS_LABEL[statusOf(o)],
    업체: o.customer,
    아이템: (o.items || []).map((it) => it.item).join(","),
    모델: (o.items || []).map((it) => `${it.model || ""}${it.quantity ? ` x${it.quantity}` : ""}`).join(" / "),
    "TOTAL 금액": orderTotal(o),
    발주일: o.orderDate,
    납기일: o.dueDate,
    납품일: o.deliveryDate || "",
    계산서발행일: o.invoiceDate || "",
    메모: o.memo || "",
    담당자: o.owner || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "발주목록");
  XLSX.writeFile(wb, `발주목록-${todayStr()}.xlsx`);
  toast("엑셀 파일을 내보냈습니다.", "success");
}
function importExcel(file) {
  if (typeof XLSX === "undefined") return toast("엑셀 기능이 준비되지 않았습니다.", "error");
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const wb = XLSX.read(reader.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      let added = 0;
      for (const r of rows) {
        const customer = r["업체"] || r["업체명"] || r["거래처"];
        if (!customer) continue;
        const itemCode = (r["아이템"] || r["ITEM"] || "ETC").toString().split(/[,/]/)[0].trim().toUpperCase();
        const payload = {
          customer: String(customer).trim(),
          amount: parseNum(r["TOTAL 금액"] || r["금액"]),
          items: [{ item: ITEM_CODES.includes(itemCode) ? itemCode : "ETC", model: String(r["모델"] || ""), quantity: parseNum(r["수량"]) || null, amount: parseNum(r["TOTAL 금액"] || r["금액"]) }],
          orderDate: normalizeDate(r["발주일"]) || todayStr(),
          dueDate: normalizeDate(r["납기일"]) || todayStr(),
          deliveryDate: normalizeDate(r["납품일"]) || null,
          invoiceDate: normalizeDate(r["계산서발행일"] || r["계산서"]) || null,
          memo: String(r["메모"] || ""),
          owner: String(r["담당자"] || "나"),
        };
        await api("/api/orders", { method: "POST", body: payload });
        added += 1;
      }
      await refreshAll();
      renderView();
      fillAnalysisYearSelect();
      toast(`엑셀에서 ${added}건을 가져왔습니다.`, "success");
    } catch (e) {
      toast("엑셀 가져오기 실패: " + e.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}
function normalizeDate(v) {
  if (!v) return null;
  if (typeof v === "number") {
    // 엑셀 시리얼 날짜
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim().replace(/[./]/g, "-");
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

/* =========================================================
 * 자동완성
 * =======================================================*/
function setupAutocomplete(inputId, listId, onPick) {
  const input = $(inputId);
  const list = $(listId);
  if (!input || !list) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    const matches = customerNames().filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { list.hidden = true; return; }
    list.innerHTML = matches.map((n) => `<button type="button" class="ac-item">${escapeHtml(n)}</button>`).join("");
    list.hidden = false;
    $$(".ac-item", list).forEach((b) => b.onclick = () => { input.value = b.textContent; list.hidden = true; onPick?.(b.textContent); });
  });
  input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
}

/* =========================================================
 * 유틸
 * =======================================================*/
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function attachThousands(el) {
  if (!el) return;
  el.addEventListener("input", () => {
    const caretEnd = el.selectionStart === el.value.length;
    const n = parseNum(el.value);
    el.value = n ? won(n) : "";
    if (caretEnd) el.setSelectionRange(el.value.length, el.value.length);
  });
}

/* =========================================================
 * 발주 필터 UI 초기화
 * =======================================================*/
function initDueFilters() {
  const sel = $("dueYearFilter");
  const years = availableYears();
  sel.innerHTML = `<option value="">전체 연도</option>` + years.map((y) => `<option value="${y}">${y}년</option>`).join("");
  sel.value = ui.dueYear;
  $("dueMonthButtons").innerHTML = Array.from({ length: 12 }, (_, i) =>
    `<button class="filter-chip month-chip ${ui.dueMonths.has(i + 1) ? "active" : ""}" data-due-month="${i + 1}">${i + 1}월</button>`).join("");
}

function fillAnalysisYearSelect() {
  fillYearSelect("analysisYear", ui.year, (v) => { ui.year = v; renderView(); });
  initDueFilters();
}

/* =========================================================
 * 이벤트 바인딩
 * =======================================================*/
function bindEvents() {
  // 사이드바 뷰 전환
  $$(".nav-item[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("sidebarNewOrderButton").addEventListener("click", () => openOrderDialog(null));
  $("newOrderButton").addEventListener("click", () => openOrderDialog(null));

  // 데이터 도구
  $("nowBackupButton").addEventListener("click", backupNow);
  $("backupManagerButton").addEventListener("click", openBackupManager);
  $("backupButton").addEventListener("click", downloadJsonBackup);
  $("restoreButton").addEventListener("click", () => $("restoreFile").click());
  $("restoreFile").addEventListener("change", (e) => { if (e.target.files[0]) restoreFromFile(e.target.files[0]); e.target.value = ""; });
  $("submissionButton").addEventListener("click", () => $("submissionDialog").showModal());
  $("createSubmissionHtmlButton").addEventListener("click", createSubmissionHtml);
  $("importButton").addEventListener("click", () => $("excelFile").click());
  $("excelFile").addEventListener("change", (e) => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ""; });
  $("exportButton").addEventListener("click", exportExcel);

  // 다이얼로그 닫기 버튼
  $$("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => $(b.dataset.closeDialog).close()));

  // 연도 컨트롤
  $("analysisYear").addEventListener("change", (e) => { ui.year = Number(e.target.value); renderView(); });

  /* ---- 발주 목록 상호작용 ---- */
  $("searchInput").addEventListener("input", (e) => { ui.search = e.target.value; ui.page = 1; renderOrders(); });
  $("clearSearchButton").addEventListener("click", () => { ui.search = ""; $("searchInput").value = ""; renderOrders(); });
  $("resetFilterButton").addEventListener("click", () => {
    ui.search = ""; $("searchInput").value = "";
    ui.statusFilter.clear(); ui.itemFilter.clear(); ui.dueMonths.clear(); ui.dueYear = "";
    ui.page = 1; initDueFilters(); renderOrders();
  });
  $("statusFilterButtons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status]"); if (!btn) return;
    toggleSet(ui.statusFilter, btn.dataset.status); ui.page = 1; renderOrders();
  });
  $("itemFilterButtons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-item]"); if (!btn) return;
    toggleSet(ui.itemFilter, btn.dataset.item); ui.page = 1; renderOrders();
  });
  $("statusOverview").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status-card]"); if (!btn) return;
    toggleSet(ui.statusFilter, btn.dataset.statusCard); ui.page = 1; renderOrders();
  });
  $("dueYearFilter").addEventListener("change", (e) => { ui.dueYear = e.target.value; ui.page = 1; renderOrders(); });
  $("dueMonthButtons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-due-month]"); if (!btn) return;
    toggleSet(ui.dueMonths, Number(btn.dataset.dueMonth)); ui.page = 1; renderOrders();
  });
  $("pageSize").addEventListener("change", (e) => { ui.pageSize = Number(e.target.value); ui.page = 1; renderOrders(); });
  $("prevPage").addEventListener("click", () => { if (ui.page > 1) { ui.page -= 1; renderOrders(); } });
  $("nextPage").addEventListener("click", () => { ui.page += 1; renderOrders(); });

  $("ordersBody").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    const deliver = e.target.closest("[data-deliver]");
    const invoice = e.target.closest("[data-invoice]");
    const check = e.target.closest(".row-check");
    if (edit) { const o = store.orders.find((x) => x.id === edit.dataset.edit); if (o) openOrderDialog(o); }
    else if (deliver) openCompleteDialog({ ids: [deliver.dataset.deliver], field: "deliveryDate" });
    else if (invoice) openCompleteDialog({ ids: [invoice.dataset.invoice], field: "invoiceDate" });
    else if (check) { toggleSet(ui.selected, check.dataset.id); renderBulkBar(); }
  });
  $("selectAllVisible").addEventListener("change", (e) => {
    const rows = filteredOrders().slice((ui.page - 1) * ui.pageSize, (ui.page - 1) * ui.pageSize + ui.pageSize);
    if (e.target.checked) rows.forEach((o) => ui.selected.add(o.id));
    else rows.forEach((o) => ui.selected.delete(o.id));
    renderOrders();
  });
  $("clearSelectionButton").addEventListener("click", () => { ui.selected.clear(); renderOrders(); });
  $("bulkDeliveryButton").addEventListener("click", () => { if (ui.selected.size) openCompleteDialog({ ids: [...ui.selected], field: "deliveryDate" }); });
  $("bulkInvoiceButton").addEventListener("click", () => { if (ui.selected.size) openCompleteDialog({ ids: [...ui.selected], field: "invoiceDate" }); });

  // 점검 탭
  $$(".audit-tab").forEach((t) => t.addEventListener("click", () => { ui.auditTab = t.dataset.auditTab; renderAudit(); }));
  $("refreshAuditButton").addEventListener("click", renderAudit);
  $("auditTableBody").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]"); if (!edit) return;
    const o = store.orders.find((x) => x.id === edit.dataset.edit); if (o) openOrderDialog(o);
  });

  /* ---- 발주 다이얼로그 ---- */
  $("orderItemSelector").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-order-item]"); if (!btn) return;
    orderItemsDraft.push({ item: btn.dataset.addOrderItem, model: "", quantity: null, amount: 0 });
    renderOrderItemGroups();
  });
  $("orderItemGroups").addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.group);
    if (Number.isNaN(idx)) return;
    if (e.target.classList.contains("ig-model")) orderItemsDraft[idx].model = e.target.value;
    if (e.target.classList.contains("ig-qty")) orderItemsDraft[idx].quantity = e.target.value;
    if (e.target.classList.contains("ig-amount")) {
      orderItemsDraft[idx].amount = parseNum(e.target.value);
      e.target.value = orderItemsDraft[idx].amount ? won(orderItemsDraft[idx].amount) : "";
    }
    updateItemReconcile();
  });
  $("orderItemGroups").addEventListener("click", (e) => {
    const rm = e.target.closest(".ig-remove"); if (!rm) return;
    orderItemsDraft.splice(Number(rm.dataset.group), 1);
    renderOrderItemGroups();
  });
  $("amount").addEventListener("input", () => { const n = parseNum($("amount").value); $("amount").value = n ? won(n) : ""; updateItemReconcile(); });
  $("saveOrderButton").addEventListener("click", saveOrder);
  $("deleteButton").addEventListener("click", deleteOrder);

  // 완료 다이얼로그
  $("completeForm").addEventListener("submit", (e) => { e.preventDefault(); applyComplete(); });

  /* ---- 통합분석 ---- */
  $("monthlyChart").addEventListener("click", (e) => {
    const col = e.target.closest("[data-month]"); if (!col) return;
    openMonthDetail(Number(col.dataset.month));
  });
  $("customerAnalysisSearch").addEventListener("input", (e) => { ui.customerSearch = e.target.value; renderCustomerAnalysis(); });
  $("customerMonthBar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cust-month]"); if (!btn) return;
    openMonthDetail(Number(btn.dataset.custMonth));
  });

  /* ---- 실적 ---- */
  $("itemPerformanceBody").addEventListener("click", (e) => {
    const row = e.target.closest("[data-item-detail]"); if (!row) return;
    openItemPerformanceDialog(row.dataset.itemDetail);
  });
  $("amountBucketGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bucket]"); if (!btn) return;
    openBucketDialog(btn.dataset.bucket);
  });
  $("planItemFilters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-plan-item]"); if (!btn) return;
    ui.planItem = btn.dataset.planItem; renderPlanItemFilters(); renderFuturePlan(ui.year);
  });
  $("futurePlanBody").addEventListener("change", (e) => {
    const input = e.target.closest(".plan-next-input"); if (!input) return;
    savePlanNext(input.dataset.planCustomer, input.dataset.planLabel, input.value);
  });
  $("yearlyAnalysisBody").addEventListener("change", (e) => {
    const input = e.target.closest(".yearly-input"); if (!input) return;
    saveYearlyAnalysis(Number(input.dataset.year), input.dataset.yearlyField, input.value);
  });

  /* ---- 월간회의 ---- */
  $$(".forecast-tab").forEach((t) => t.addEventListener("click", () => { ui.forecastType = t.dataset.forecastType; renderForecastPanel(); }));
  $("newForecastButton").addEventListener("click", () => openForecastDialog(null));
  $("forecastBody").addEventListener("click", (e) => {
    const rec = e.target.closest("[data-recurring-edit]");
    const man = e.target.closest("[data-forecast-edit]");
    if (rec) openRecurringDialog(Number(rec.dataset.recurringEdit));
    else if (man) { const f = store.forecasts.find((x) => x.id === man.dataset.forecastEdit); if (f) openForecastDialog(f); }
  });
  $("forecastForm").addEventListener("submit", saveForecast);
  $("deleteForecastButton").addEventListener("click", deleteForecast);
  $("forecastItemSelector").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-forecast-item]"); if (!btn) return;
    forecastItemsDraft.push({ item: btn.dataset.addForecastItem, model: "", quantity: null });
    renderForecastItemGroups();
  });
  $("forecastItemGroups").addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.fgroup); if (Number.isNaN(idx)) return;
    if (e.target.classList.contains("fg-model")) forecastItemsDraft[idx].model = e.target.value;
    if (e.target.classList.contains("fg-qty")) forecastItemsDraft[idx].quantity = e.target.value;
  });
  $("forecastItemGroups").addEventListener("click", (e) => {
    const rm = e.target.closest(".fg-remove"); if (!rm) return;
    forecastItemsDraft.splice(Number(rm.dataset.fgroup), 1);
    renderForecastItemGroups();
  });
  $("recurringForecastForm").addEventListener("submit", saveRecurring);
  $("resetRecurringOverrideButton").addEventListener("click", resetRecurring);
  $("saveMonthlyPlanButton").addEventListener("click", async () => {
    await api("/api/monthly-plans", { method: "PUT", body: { year: ui.year, month: ui.planMonth, text: $("monthlyPlanText").value } });
    await refreshAll();
    renderMonthlyPlan();
    toast("월 계획을 저장했습니다.", "success");
  });

  // 백업 관리 다이얼로그
  $("dialogNowBackupButton").addEventListener("click", async () => { await backupNow(); await renderBackupList(); });
  $("refreshBackupListButton").addEventListener("click", renderBackupList);
  $("backupListBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-restore]"); if (!btn) return;
    restoreBackup(btn.dataset.restore);
  });

  // 금액 입력 포맷
  attachThousands($("forecastEntryAmount"));

  // 자동완성
  setupAutocomplete("customer", "customerEntryAutocomplete");
  setupAutocomplete("forecastCustomer", "forecastCustomerAutocomplete");
  setupAutocomplete("recurringCustomer", null);

  // dialog 바깥 클릭 시 닫기
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
}

function toggleSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

/* =========================================================
 * 부팅
 * =======================================================*/
async function ensureAuth() {
  let health;
  try {
    health = await (await fetch("/api/health")).json();
  } catch {
    return;
  }
  if (!health || !health.authRequired) return;
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await fetch("/api/orders", { headers: authHeaders() });
      if (r.status !== 401) return; // 인증 통과
    } catch {
      return;
    }
    const pw = window.prompt("발주관리앱 비밀번호를 입력하세요:");
    if (pw === null) return; // 취소
    APP_KEY = pw;
    try { localStorage.setItem("appKey", pw); } catch { /* ignore */ }
  }
}

async function boot() {
  bindEvents();
  await ensureAuth();
  try {
    await refreshAll();
  } catch (e) {
    toast("서버 연결 실패: " + e.message, "error");
  }
  ui.year = availableYears()[0] || new Date().getFullYear();
  fillAnalysisYearSelect();
  setView("orders");
  // 서버 연결 표시
  const dot = document.querySelector(".online-dot");
  if (dot) dot.classList.add("connected");
}

document.addEventListener("DOMContentLoaded", boot);
