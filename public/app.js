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
// 천단위 콤마 포맷 + 마이너스(-) 입력 허용
function formatMoney(value) {
  let s = String(value).replace(/[^0-9-]/g, "");
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (s === "") return neg ? "-" : "";
  return (neg ? "-" : "") + won(Number(s));
}
const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) || null : null);
const monthOf = (d) => {
  if (!d) return null;
  const m = Number(String(d).slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
};
const todayStr = () => new Date().toISOString().slice(0, 10);
function addMonths(dateStr, n) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
  events: [],
  todos: [],
  itemBudgets: [],
};

const ui = {
  view: "orders",
  year: new Date().getFullYear(),
  // 발주 필터
  search: "",
  orderYear: new Date().getFullYear(), // 발주 목록 기본 연도 = 올해
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
  // 캘린더
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  editingEventId: null,
  openTodoId: null,
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
    events: d.events || [],
    todos: d.todos || [],
    itemBudgets: d.itemBudgets || [],
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
  calendar: { title: "캘린더", sub: "일정을 날짜별로 관리하고 급한 순서로 확인합니다.", year: false },
};

function setView(view) {
  ui.view = view;
  $$(".view-section").forEach((s) => (s.hidden = true));
  const map = { orders: "ordersView", analytics: "analyticsView", performance: "performanceView", forecast: "forecastView", calendar: "calendarView" };
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
    case "calendar": renderCalendar(); renderUrgentList(); renderTodoList(); break;
  }
}

/* =========================================================
 * 발주 목록 (orders view)
 * =======================================================*/
function filteredOrders() {
  let rows = store.orders.slice();
  // 발주 연도 필터 (발주일 기준, 기본값 올해)
  if (ui.orderYear !== "all") rows = rows.filter((o) => yearOf(o.orderDate) === Number(ui.orderYear));
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
  // 발주 받은 순서 = 발주일 오름차순 (날짜 없는 건은 뒤로), 같은 날짜는 입력순
  rows.sort((a, b) => {
    const da = a.orderDate || "9999-99-99";
    const db = b.orderDate || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  return rows;
}

function populateOrderYearFilter() {
  const sel = $("orderYearFilter");
  if (!sel) return;
  const years = availableYears();
  sel.innerHTML = `<option value="all">전체 연도</option>` +
    years.map((y) => `<option value="${y}">${y}년</option>`).join("");
  // 올해가 목록에 없으면 전체로
  if (ui.orderYear !== "all" && !years.includes(Number(ui.orderYear))) ui.orderYear = "all";
  sel.value = String(ui.orderYear);
}

function renderStatusOverview() {
  const counts = { in_progress: 0, invoice_pending: 0, complete: 0 };
  let amount = { in_progress: 0, invoice_pending: 0, complete: 0 };
  // 선택한 발주 연도(발주일 기준)만 집계
  const yearOrders = ui.orderYear === "all"
    ? store.orders
    : store.orders.filter((o) => yearOf(o.orderDate) === Number(ui.orderYear));
  for (const o of yearOrders) {
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
  populateOrderYearFilter();
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
        <td>${o.dueDate || '<span class="stock-badge">재고 보유</span>'}</td>
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
    // 납기일 없음 = 재고 보유 제품이므로 정상 (문제로 보지 않음)
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
  const secs = store.itemBudgets || [];
  const actualsMap = ibActualsByItem(year);
  const invOrders = store.orders.filter((o) => yearOf(o.invoiceDate) === year);
  const custCount = new Set(invOrders.map((o) => (o.customer || "").trim()).filter(Boolean)).size;

  // ITEM별 실적 테이블 — 새 ITEM별 BUDGET(엑셀) 기준 · ETC 상품은 동반 품목에 배분됨
  let budgetSum = 0;
  let invAmt = 0;
  let q2Sum = 0; let q3Sum = 0; let q4Sum = 0;
  $("itemPerformanceBody").innerHTML = secs.map((sec) => {
    const cs = sec.customers || [];
    const budget = cs.reduce((s, c) => s + parseNum(c.budget), 0);
    const q2 = cs.reduce((s, c) => s + parseNum(c.q2), 0);
    const q3 = cs.reduce((s, c) => s + parseNum(c.q3), 0);
    const q4 = cs.reduce((s, c) => s + parseNum(c.q4), 0);
    q2Sum += q2; q3Sum += q3; q4Sum += q4;
    const secActuals = actualsMap.get((sec.item || "").trim().toUpperCase()) || new Map();
    let total = 0; let custN = 0;
    for (const v of secActuals.values()) { total += v.amount; if (v.amount > 0) custN += 1; }
    budgetSum += budget; invAmt += total;
    const lastBudget = q4 || q3 || q2 || budget;
    const rate = lastBudget ? `${Math.round((total / lastBudget) * 1000) / 10}%` : "-";
    const code = NAME_TO_CODE[sec.item] || "ETC";
    const pill = NAME_TO_CODE[sec.item] || (sec.item || "?").slice(0, 2).toUpperCase();
    return `<tr class="item-row" data-item-detail="${escapeHtml(sec.item)}">
      <td><span class="item-pill item-${code}">${escapeHtml(pill)}</span> ${escapeHtml(sec.item)}</td>
      <td class="number">${custN}</td>
      <td class="number">${won(budget)}</td>
      <td class="number">${won(q2)}</td>
      <td class="number">${won(q3)}</td>
      <td class="number">${q4 ? won(q4) : "-"}</td>
      <td class="number strong">${won(total)}</td>
      <td class="number">${rate}</td></tr>`;
  }).join("") || `<tr><td colspan="8" class="muted">ITEM별 BUDGET에서 ITEM을 추가하세요.</td></tr>`;
  $("itemReconcileBadge").textContent = `실적 합계 ${won(invAmt)}`;
  $("itemReconcileBadge").className = "reconcile-badge ok";

  // 가장 최근 입력 분기의 BUDGET & 달성률
  const qLabel = q4Sum > 0 ? "4분기" : q3Sum > 0 ? "3분기" : q2Sum > 0 ? "2분기" : "연간";
  const qBudget = q4Sum > 0 ? q4Sum : q3Sum > 0 ? q3Sum : q2Sum > 0 ? q2Sum : budgetSum;

  $("perfBudgetAmount").textContent = budgetSum ? won(budgetSum) : "-";
  $("perfBudgetYearLabel").textContent = `${year}년`;
  $("perfQBudgetLabel").textContent = `${qLabel} BUDGET`;
  $("perfQBudgetAmount").textContent = qBudget ? won(qBudget) : "-";
  $("perfQAchLabel").textContent = `${qLabel} 달성률`;
  $("perfQAchievementRate").textContent = qBudget ? `${Math.round((invAmt / qBudget) * 1000) / 10}%` : "-";
  $("perfInvoiceAmount").textContent = won(invAmt);
  $("perfYearLabel").textContent = `${year}년 세금계산서 기준`;
  $("perfAchievementRate").textContent = budgetSum ? `${Math.round((invAmt / budgetSum) * 1000) / 10}%` : "-";
  $("perfInvoiceCount").textContent = `${invOrders.length}건`;
  $("perfCustomerCount").textContent = `${custCount}곳`;

  renderAmountBuckets(year);
  renderItemBudgets();
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

/* ---- ITEM별 BUDGET & 실적 (분기별) 편집 그리드 ---- */
// 편집 가능한 예산 열 (TOTAL은 발주 실적에서 자동 계산 → 읽기전용)
const IB_EDIT_FIELDS = [
  { key: "result", label: "2025 실적" },
  { key: "budget", label: "2026 예산" },
  { key: "q2", label: "2분기 예산" },
  { key: "q3", label: "3분기 예산" },
  { key: "q4", label: "4분기 예산" },
];
function ibNewId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }
function ibCellVal(v) { return (v === null || v === undefined || v === "") ? "" : won(v); }
// 업체명 정규화(끝의 마침표/공백 제거, 소문자) — ETC 및 업체 매칭용
function ibNorm(s) { return String(s || "").trim().replace(/[.．\s]+$/g, "").replace(/\s+/g, " ").toLowerCase(); }
// 발주 실적: 세금계산서 발행(처리 완료) 건을 ITEM명 → 업체명 → {금액,건수} 로 집계.
// ETC 상품 금액은 같은 발주에 함께 나온 다른 품목에 (금액 비율로) 배분한다.
function ibActualsByItem(year) {
  const map = new Map(); // itemNameUpper -> Map(custNorm -> {name, amount, count})
  const add = (itemName, cust, amount, countInc) => {
    const key = String(itemName).toUpperCase();
    if (!map.has(key)) map.set(key, new Map());
    const m = map.get(key);
    const k = ibNorm(cust);
    if (!m.has(k)) m.set(k, { name: cust, amount: 0, count: 0 });
    m.get(k).amount += amount;
    m.get(k).count += countInc;
  };
  for (const o of store.orders) {
    if (yearOf(o.invoiceDate) !== year) continue; // 처리 완료(계산서 발행)만
    const cust = (o.customer || "").trim() || "미지정";
    const lines = (o.items && o.items.length) ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
    const nonEtc = lines.filter((it) => ITEM_CODES.includes(it.item) && it.item !== "ETC");
    const etcAmt = lines.reduce((s, it) => s + ((!ITEM_CODES.includes(it.item) || it.item === "ETC") ? parseNum(it.amount) : 0), 0);
    const nonEtcSum = nonEtc.reduce((s, it) => s + parseNum(it.amount), 0);
    if (nonEtc.length) {
      for (const it of nonEtc) {
        const base = parseNum(it.amount);
        const share = nonEtcSum > 0 ? etcAmt * (base / nonEtcSum) : etcAmt / nonEtc.length;
        add(ITEM_NAME[it.item] || it.item, cust, base + share, 1);
      }
    }
    // ETC만 있는 발주(배분할 품목이 없음)는 ITEM별 집계에서 제외
  }
  return map;
}
// 섹션별 실적 계산.
// autoById: 발주 자동집계 값(업체별), totalsById: 실제 표시/합계용(수동 입력이 있으면 그 값 우선),
// etcExtra: ETC행이 없을 때 남는 미매칭 금액, colTotal: 섹션 합계(수동 반영)
function ibIsManual(c) { return c && c.totalOverride !== null && c.totalOverride !== undefined && c.totalOverride !== ""; }
function ibComputeSection(sec, actualsMap) {
  const secActuals = actualsMap.get((sec.item || "").trim().toUpperCase()) || new Map();
  const custs = sec.customers || [];
  const etcIdx = custs.findIndex((c) => ibNorm(c.name) === "etc");
  const matched = new Set();
  const autoById = {};
  custs.forEach((c, i) => {
    if (i === etcIdx) return;
    const k = ibNorm(c.name);
    if (k && secActuals.has(k)) { autoById[c.id] = secActuals.get(k).amount; matched.add(k); }
    else autoById[c.id] = 0;
  });
  let leftover = 0;
  for (const [k, v] of secActuals) if (!matched.has(k)) leftover += v.amount;
  let etcExtra = 0;
  if (etcIdx >= 0) autoById[custs[etcIdx].id] = leftover;
  else etcExtra = leftover;
  const totalsById = {};
  custs.forEach((c) => { totalsById[c.id] = ibIsManual(c) ? parseNum(c.totalOverride) : (autoById[c.id] || 0); });
  const colTotal = Object.values(totalsById).reduce((s, v) => s + v, 0) + etcExtra;
  return { autoById, totalsById, etcExtra, colTotal };
}
function renderItemBudgets() {
  const grid = $("itemBudgetGrid");
  if (!grid) return;
  const secs = store.itemBudgets || [];
  const actualsMap = ibActualsByItem(ui.year);

  grid.innerHTML = secs.map((sec) => {
    const comp = ibComputeSection(sec, actualsMap);
    const editTotals = {};
    for (const f of IB_EDIT_FIELDS) editTotals[f.key] = (sec.customers || []).reduce((s, c) => s + parseNum(c[f.key]), 0);

    const rows = (sec.customers || []).map((c) => {
      const manual = ibIsManual(c);
      const auto = comp.autoById[c.id] || 0;
      const shown = manual ? parseNum(c.totalOverride) : auto;
      return `<tr data-ib-cust="${c.id}">
        <td><input class="ib-cell-name" value="${escapeHtml(c.name || "")}" placeholder="업체명"/></td>
        ${IB_EDIT_FIELDS.map((f) => `<td class="number"><input class="ib-cell" data-ib-field="${f.key}" inputmode="numeric" value="${ibCellVal(c[f.key])}" placeholder="0"/></td>`).join("")}
        <td class="number"><input class="ib-total-input ${manual ? "ib-total-manual" : "ib-total-auto"}" data-ib-auto="${manual ? "0" : "1"}" data-ib-autoval="${auto}" inputmode="numeric" value="${shown ? won(shown) : ""}" placeholder="자동${auto ? " " + won(auto) : ""}" title="발주 자동집계값입니다. 직접 입력하면 그 값이 우선되고, 비우면 다시 자동집계로 돌아갑니다."/></td>
        <td class="ib-rowdel"><button class="mini-btn danger" data-ib-del-cust title="업체 삭제">✕</button></td>
      </tr>`;
    }).join("");
    // ETC 행이 없는데 미매칭 실적이 있으면 자동집계 행 표시(읽기전용)
    const synth = comp.etcExtra > 0
      ? `<tr class="ib-synth"><td>ETC <small>(자동집계)</small></td>${IB_EDIT_FIELDS.map(() => `<td class="number muted">-</td>`).join("")}<td class="number ib-total-cell strong" data-ib-synthtotal="${comp.etcExtra}">${won(comp.etcExtra)}</td><td class="ib-rowdel"></td></tr>`
      : "";

    return `<div class="ib-section" data-ib-section="${sec.id}">
      <div class="ib-section-head">
        <input class="ib-item-name" value="${escapeHtml(sec.item || "")}" placeholder="ITEM 명"/>
        <button class="mini-btn danger" data-ib-del-item title="ITEM 삭제">ITEM 삭제 ✕</button>
      </div>
      <div class="table-scroll">
      <table class="data-table ib-table">
        <thead><tr><th>업체</th>${IB_EDIT_FIELDS.map((f) => `<th class="number">${f.label}</th>`).join("")}<th class="number ib-total-head">2026 TOTAL<br><small>발주 자동집계·수정가능</small></th><th class="ib-rowdel"></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="muted">업체를 추가하세요.</td></tr>`}${synth}</tbody>
        <tfoot><tr class="ib-total-row"><td>TOTAL</td>${IB_EDIT_FIELDS.map((f) => `<td class="number strong" data-ib-foot="${f.key}">${won(editTotals[f.key])}</td>`).join("")}<td class="number strong" data-ib-foot-total>${won(comp.colTotal)}</td><td class="ib-rowdel"></td></tr></tfoot>
      </table>
      </div>
      <button class="button subtle small ib-add-cust" data-ib-add-cust type="button">+ 업체 추가</button>
    </div>`;
  }).join("") || `<p class="muted">아래 'ITEM 추가'로 시작하세요.</p>`;

  // 전체 2026 예산 합계 배지
  const grand = secs.reduce((s, sec) => s + (sec.customers || []).reduce((a, c) => a + parseNum(c.budget), 0), 0);
  $("itemBudgetGrandBadge").textContent = `2026 예산 합계 ${won(grand)}`;
}
// DOM → store 로 현재 그리드 상태 수집(구조 변경 전 미저장 편집 보존)
function collectItemBudgets() {
  const secs = [];
  $$("#itemBudgetGrid .ib-section").forEach((secEl) => {
    const id = secEl.dataset.ibSection;
    const item = secEl.querySelector(".ib-item-name").value.trim();
    const customers = [];
    secEl.querySelectorAll("tr[data-ib-cust]").forEach((tr) => {
      const cid = tr.dataset.ibCust;
      const cust = { id: cid, name: tr.querySelector(".ib-cell-name").value.trim() };
      tr.querySelectorAll(".ib-cell").forEach((inp) => {
        const raw = inp.value.trim();
        cust[inp.dataset.ibField] = raw === "" ? null : parseNum(raw);
      });
      // TOTAL: 자동집계(data-ib-auto=1)면 null(계속 자동), 수동 입력이면 그 값을 override로 저장
      const tot = tr.querySelector(".ib-total-input");
      const raw = tot ? tot.value.trim() : "";
      cust.totalOverride = (!tot || tot.dataset.ibAuto === "1" || raw === "") ? null : parseNum(raw);
      customers.push(cust);
    });
    secs.push({ id, item, customers });
  });
  return secs;
}
async function saveItemBudgets() {
  store.itemBudgets = collectItemBudgets();
  await api("/api/item-budgets", { method: "PUT", body: store.itemBudgets });
}
function recalcIbSection(secEl) {
  const t = {};
  for (const f of IB_EDIT_FIELDS) t[f.key] = 0;
  secEl.querySelectorAll("tr[data-ib-cust]").forEach((tr) => {
    tr.querySelectorAll(".ib-cell").forEach((inp) => { t[inp.dataset.ibField] += parseNum(inp.value); });
  });
  secEl.querySelectorAll("[data-ib-foot]").forEach((td) => { td.textContent = won(t[td.dataset.ibFoot]); });
  // TOTAL 열 합계(수동 입력 반영) = 각 행 total-input 값 + ETC 자동집계 행
  let colTotal = 0;
  secEl.querySelectorAll(".ib-total-input").forEach((inp) => { colTotal += parseNum(inp.value); });
  const synth = secEl.querySelector("[data-ib-synthtotal]");
  if (synth) colTotal += parseNum(synth.dataset.ibSynthtotal);
  const footTotal = secEl.querySelector("[data-ib-foot-total]");
  if (footTotal) footTotal.textContent = won(colTotal);
  const grand = $$("#itemBudgetGrid .ib-section").reduce((s, el) => {
    let b = 0; el.querySelectorAll('.ib-cell[data-ib-field="budget"]').forEach((i) => { b += parseNum(i.value); }); return s + b;
  }, 0);
  $("itemBudgetGrandBadge").textContent = `2026 예산 합계 ${won(grand)}`;
}
async function ibAddCustomer(secId) {
  store.itemBudgets = collectItemBudgets();
  const sec = store.itemBudgets.find((s) => s.id === secId);
  if (!sec) return;
  sec.customers = sec.customers || [];
  sec.customers.push({ id: ibNewId("ibc"), name: "", result: null, budget: null, q2: null, q3: null, q4: null, totalOverride: null });
  await api("/api/item-budgets", { method: "PUT", body: store.itemBudgets });
  renderItemBudgets();
}
async function ibDeleteCustomer(secId, custId) {
  store.itemBudgets = collectItemBudgets();
  const sec = store.itemBudgets.find((s) => s.id === secId);
  if (!sec) return;
  sec.customers = (sec.customers || []).filter((c) => c.id !== custId);
  await api("/api/item-budgets", { method: "PUT", body: store.itemBudgets });
  renderItemBudgets();
}
async function ibAddItem() {
  store.itemBudgets = collectItemBudgets();
  store.itemBudgets.push({ id: ibNewId("ib"), item: "새 ITEM", customers: [{ id: ibNewId("ibc"), name: "", result: null, budget: null, q2: null, q3: null, q4: null, totalOverride: null }] });
  await api("/api/item-budgets", { method: "PUT", body: store.itemBudgets });
  renderItemBudgets();
}
async function ibDeleteItem(secId) {
  const sec = (store.itemBudgets || []).find((s) => s.id === secId);
  if (!confirm(`'${sec ? sec.item : "이 ITEM"}' 전체를 삭제할까요?`)) return;
  store.itemBudgets = collectItemBudgets().filter((s) => s.id !== secId);
  await api("/api/item-budgets", { method: "PUT", body: store.itemBudgets });
  renderItemBudgets();
}

function openItemPerformanceDialog(itemName) {
  const year = ui.year;
  const secActuals = ibActualsByItem(year).get((itemName || "").toUpperCase()) || new Map();
  const rows = [...secActuals.values()].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const code = NAME_TO_CODE[itemName] || "ETC";
  const dlg = $("itemPerformanceDialog");
  dlg.dataset.itemTheme = code;
  $("itemPerformanceDialogTitle").textContent = `${itemName} 거래처 실적`;
  $("itemPerformanceDialogSubtitle").textContent = `${year}년 세금계산서 기준 · 합계 ${won(total)} · ETC 상품 배분 포함`;
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
    // 계산서 예상: 선택한 달에 '납기'가 있는 미계산서 발주만 (그 달만)
    const auto = store.orders.filter((o) =>
      !o.invoiceDate && yearOf(o.dueDate) === ui.year && monthOf(o.dueDate) === month
    );
    entries = auto.map((o) => ({
      id: o.id, kind: "auto", name: o.customer, note: `${month}월 납기 예정`,
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
    else action = `<button class="mini-btn" data-order-forecast-edit="${e.id}">수정</button>`;
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
 * 캘린더 (calendar view)
 * =======================================================*/
const PRIO_RANK = { high: 0, normal: 1, low: 2 };
const PRIO_LABEL = { high: "높음", normal: "보통", low: "낮음" };
function prioRank(e) { return PRIO_RANK[e.priority] ?? 1; }

/* 대한민국 공휴일 (대체공휴일 포함) — 2025~2027 */
const HOLIDAYS = {
  // 2025
  "2025-01-01": "신정",
  "2025-01-27": "임시공휴일",
  "2025-01-28": "설날 연휴", "2025-01-29": "설날", "2025-01-30": "설날 연휴",
  "2025-03-01": "삼일절", "2025-03-03": "대체공휴일",
  "2025-05-05": "어린이날·부처님오신날", "2025-05-06": "대체공휴일",
  "2025-06-03": "대통령선거일",
  "2025-06-06": "현충일",
  "2025-08-15": "광복절",
  "2025-10-03": "개천절",
  "2025-10-05": "추석 연휴", "2025-10-06": "추석", "2025-10-07": "추석 연휴", "2025-10-08": "대체공휴일",
  "2025-10-09": "한글날",
  "2025-12-25": "성탄절",
  // 2026
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절", "2026-03-02": "대체공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절", "2026-08-17": "대체공휴일",
  "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절", "2026-10-05": "대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  // 2027
  "2027-01-01": "신정",
  "2027-02-05": "설날 연휴", "2027-02-06": "설날", "2027-02-07": "설날 연휴", "2027-02-08": "대체공휴일",
  "2027-03-01": "삼일절",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일",
  "2027-08-15": "광복절", "2027-08-16": "대체공휴일",
  "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴",
  "2027-10-03": "개천절", "2027-10-04": "대체공휴일",
  "2027-10-09": "한글날", "2027-10-11": "대체공휴일",
  "2027-12-25": "성탄절", "2027-12-27": "대체공휴일",
};
function holidayName(dateStr) { return HOLIDAYS[dateStr] || null; }
function dday(dateStr) {
  const a = new Date(dateStr + "T00:00:00");
  const b = new Date(todayStr() + "T00:00:00");
  const diff = Math.round((a - b) / 86400000);
  if (diff < 0) return { label: `지남 ${-diff}일`, cls: "overdue", diff };
  if (diff === 0) return { label: "오늘", cls: "today", diff };
  if (diff <= 3) return { label: `D-${diff}`, cls: "soon", diff };
  return { label: `D-${diff}`, cls: "later", diff };
}

function renderCalendar() {
  $("calTitle").textContent = `${ui.calYear}년 ${ui.calMonth}월`;
  const wd = ["일", "월", "화", "수", "목", "금", "토"];
  $("calWeekdays").innerHTML = wd.map((d, i) => `<div class="cal-wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("");
  const startDow = new Date(ui.calYear, ui.calMonth - 1, 1).getDay();
  const daysInMonth = new Date(ui.calYear, ui.calMonth, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const today = todayStr();
  const byDate = {};
  for (const e of store.events) (byDate[e.date] || (byDate[e.date] = [])).push(e);
  $("calendarGrid").innerHTML = cells.map((d, idx) => {
    if (d === null) return `<div class="cal-cell empty"></div>`;
    const dateStr = `${ui.calYear}-${String(ui.calMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = idx % 7;
    const holiday = holidayName(dateStr);
    const evs = (byDate[dateStr] || []).slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || prioRank(a) - prioRank(b));
    const chips = evs.slice(0, holiday ? 3 : 4).map((e) =>
      `<div class="cal-ev prio-${e.priority || "normal"} ${e.done ? "done" : ""}" data-event-chip="${e.id}" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</div>`).join("");
    const shown = holiday ? 3 : 4;
    const more = evs.length > shown ? `<div class="cal-more">+${evs.length - shown}건</div>` : "";
    const dayCls = holiday ? "sun" : (dow === 0 ? "sun" : dow === 6 ? "sat" : "");
    const holBadge = holiday ? `<div class="cal-holiday" title="${escapeHtml(holiday)}">${escapeHtml(holiday)}</div>` : "";
    return `<div class="cal-cell ${dateStr === today ? "today" : ""} ${holiday ? "holiday" : ""}" data-cal-date="${dateStr}">
      <div class="cal-daynum ${dayCls}">${d}</div>${holBadge}${chips}${more}</div>`;
  }).join("");
}

function renderUrgentList() {
  const showDone = $("urgentShowDone").checked;
  let evs = store.events.slice();
  if (!showDone) evs = evs.filter((e) => !e.done);
  evs.sort((a, b) => {
    if ((a.done ? 1 : 0) !== (b.done ? 1 : 0)) return (a.done ? 1 : 0) - (b.done ? 1 : 0);
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return prioRank(a) - prioRank(b);
  });
  $("urgentEmpty").hidden = evs.length > 0;
  $("urgentList").innerHTML = evs.map((e) => {
    const dd = dday(e.date);
    return `<div class="urgent-item ${e.done ? "done" : dd.cls}">
      <span class="dday-badge ${e.done ? "donebadge" : dd.cls}">${e.done ? "완료" : dd.label}</span>
      <div class="urgent-main"><strong>${escapeHtml(e.title)}</strong>
        <span>${e.date} · <em class="prio-dot prio-${e.priority || "normal"}"></em>${PRIO_LABEL[e.priority] || "보통"}${e.memo ? " · " + escapeHtml(e.memo.slice(0, 50)) : ""}</span></div>
      <div class="urgent-actions"><button class="mini-btn" data-event-done="${e.id}">${e.done ? "되돌리기" : "완료"}</button><button class="mini-btn" data-event-edit="${e.id}">수정</button></div>
    </div>`;
  }).join("");
}

function openEventDialog(ev) {
  ui.editingEventId = ev && ev.id ? ev.id : null;
  $("eventDialogTitle").textContent = ui.editingEventId ? "일정 수정" : "일정 추가";
  $("eventDate").value = (ev && ev.date) || todayStr();
  $("eventTitle").value = (ev && ev.title) || "";
  $("eventMemo").value = (ev && ev.memo) || "";
  $("eventPriority").value = (ev && ev.priority) || "normal";
  $("eventDone").checked = !!(ev && ev.done);
  $("deleteEventButton").hidden = !ui.editingEventId;
  $("eventDialog").showModal();
}
async function saveEvent(e) {
  e.preventDefault();
  const date = $("eventDate").value;
  const title = $("eventTitle").value.trim();
  if (!date || !title) return toast("날짜와 일정 내용을 입력하세요.", "error");
  const payload = { date, title, memo: $("eventMemo").value.trim(), priority: $("eventPriority").value, done: $("eventDone").checked };
  if (ui.editingEventId) await api(`/api/events/${ui.editingEventId}`, { method: "PUT", body: payload });
  else await api("/api/events", { method: "POST", body: payload });
  $("eventDialog").close();
  await refreshAll();
  renderCalendar();
  renderUrgentList();
  toast("일정을 저장했습니다.", "success");
}
async function deleteEvent() {
  if (!ui.editingEventId) return;
  if (!confirm("이 일정을 삭제할까요?")) return;
  await api(`/api/events/${ui.editingEventId}`, { method: "DELETE" });
  $("eventDialog").close();
  await refreshAll();
  renderCalendar();
  renderUrgentList();
  toast("일정을 삭제했습니다.", "success");
}
async function toggleEventDone(id) {
  const ev = store.events.find((x) => x.id === id);
  if (!ev) return;
  await api(`/api/events/${id}`, { method: "PUT", body: { done: !ev.done } });
  await refreshAll();
  renderCalendar();
  renderUrgentList();
}

/* ---- 할일 메모 (todos) ---- */
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderTodoList() {
  const showDone = $("todoShowDone").checked;
  let items = store.todos.slice();
  if (!showDone) items = items.filter((t) => !t.done);
  items.sort((a, b) => {
    if ((a.done ? 1 : 0) !== (b.done ? 1 : 0)) return (a.done ? 1 : 0) - (b.done ? 1 : 0);
    return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
  });
  $("todoEmpty").hidden = items.length > 0;
  $("todoList").innerHTML = items.map((t) => {
    const title = (t.title || "").trim();
    const body = (t.text || "").trim();
    const fuCount = Array.isArray(t.followups) ? t.followups.length : 0;
    const prio = t.priority || "normal";
    const prioBadge = `<span class="todo-prio prio-${prio}"><em class="prio-dot prio-${prio}"></em>${PRIO_LABEL[prio] || "보통"}</span>`;
    return `<div class="todo-item prio-border-${prio} ${t.done ? "done" : ""}" data-todo-open="${t.id}">
      <label class="todo-check"><input type="checkbox" data-todo-done="${t.id}" ${t.done ? "checked" : ""}/><span></span></label>
      <div class="todo-body">
        <div class="todo-head-row">${prioBadge}${title ? `<strong class="todo-title">${escapeHtml(title)}</strong>` : ""}</div>
        ${body ? `<span class="todo-text">${escapeHtml(body).replace(/\n/g, "<br>")}</span>` : ""}
        <span class="todo-meta">${fmtDateTime(t.createdAt)}${fuCount ? ` · 팔로우업 ${fuCount}` : ""}</span>
      </div>
      <button class="mini-btn danger" data-todo-del="${t.id}" title="삭제">✕</button>
    </div>`;
  }).join("");
}
async function addTodo(e) {
  e.preventDefault();
  const title = $("todoTitle").value.trim();
  const text = $("todoInput").value.trim();
  if (!title && !text) return;
  const priority = $("todoPriority").value || "normal";
  await api("/api/todos", { method: "POST", body: { title, text, priority, done: false } });
  $("todoTitle").value = "";
  $("todoInput").value = "";
  $("todoPriority").value = "normal";
  await refreshAll();
  renderTodoList();
}
async function setTodoPriority(id, priority) {
  await api(`/api/todos/${id}`, { method: "PUT", body: { priority } });
  await refreshAll();
  renderTodoList();
  if (ui.openTodoId === id) renderTodoDialog();
}
async function toggleTodoDone(id) {
  const t = store.todos.find((x) => x.id === id);
  if (!t) return;
  await api(`/api/todos/${id}`, { method: "PUT", body: { done: !t.done } });
  await refreshAll();
  renderTodoList();
  if (ui.openTodoId === id) renderTodoDialog();
}
async function deleteTodo(id) {
  if (!confirm("이 할일을 삭제할까요? (팔로우업도 함께 삭제됩니다)")) return;
  await api(`/api/todos/${id}`, { method: "DELETE" });
  if (ui.openTodoId === id) { ui.openTodoId = null; $("todoDialog").close(); }
  await refreshAll();
  renderTodoList();
}

/* ---- 할일 상세 창 (팔로우업) ---- */
function openTodoDialog(id) {
  ui.openTodoId = id;
  renderTodoDialog();
  $("todoFollowupInput").value = "";
  $("todoDialog").showModal();
}
function renderTodoDialog() {
  const t = store.todos.find((x) => x.id === ui.openTodoId);
  if (!t) { $("todoDialog").close(); return; }
  const title = (t.title || "").trim();
  const body = (t.text || "").trim();
  const prio = t.priority || "normal";
  $("todoDialogTitle").textContent = title || "할일";
  const prioSel = `<select class="todo-dialog-prio prio-${prio}" id="todoDialogPrio">
    <option value="high" ${prio === "high" ? "selected" : ""}>🔴 높음</option>
    <option value="normal" ${prio === "normal" ? "selected" : ""}>🔵 보통</option>
    <option value="low" ${prio === "low" ? "selected" : ""}>⚪ 낮음</option></select>`;
  $("todoDialogOrigin").innerHTML = `
    <div class="todo-origin-head"><span class="todo-prio-caption">중요도</span>${prioSel}</div>
    ${body ? `<div class="todo-origin-text">${escapeHtml(body).replace(/\n/g, "<br>")}</div>` : `<div class="todo-origin-text muted">내용 없음</div>`}
    <div class="todo-origin-meta">작성 ${fmtDateTime(t.createdAt)}${t.done ? " · ✅ 완료" : ""}</div>`;
  // 최신 팔로우업이 맨 위로 (강조)
  const fus = (Array.isArray(t.followups) ? t.followups : []).slice().reverse();
  $("todoThreadEmpty").hidden = fus.length > 0;
  $("todoThread").innerHTML = fus.map((f, i) => `
    <div class="todo-fu ${i === 0 ? "latest" : ""}">
      ${i === 0 ? `<span class="todo-fu-badge">최신</span>` : ""}
      <div class="todo-fu-text">${escapeHtml(f.text).replace(/\n/g, "<br>")}</div>
      <div class="todo-fu-foot"><span class="todo-fu-meta">${fmtDateTime(f.at)}</span><button class="mini-btn danger" data-fu-del="${f.id}" title="삭제">✕</button></div>
    </div>`).join("");
  $("todoDialogDone").textContent = t.done ? "완료 취소" : "완료 처리";
}
async function addFollowup(e) {
  e.preventDefault();
  if (!ui.openTodoId) return;
  const text = $("todoFollowupInput").value.trim();
  if (!text) return;
  await api(`/api/todos/${ui.openTodoId}/followups`, { method: "POST", body: { text } });
  $("todoFollowupInput").value = "";
  await refreshAll();
  renderTodoDialog();
  renderTodoList();
}
async function deleteFollowup(fid) {
  if (!ui.openTodoId) return;
  await api(`/api/todos/${ui.openTodoId}/followups/${fid}`, { method: "DELETE" });
  await refreshAll();
  renderTodoDialog();
  renderTodoList();
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
    // 눌린 달로 활성 표시 즉시 이동
    box.querySelectorAll(".month-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    onChange(Number(btn.dataset.monthChip));
  };
}

/* =========================================================
 * 발주 등록/수정 다이얼로그
 * =======================================================*/
let orderItemsDraft = [];
// 계산서 발행일이 납품일을 자동으로 따라갈지 여부 (사용자가 계산서일을 직접 수정하면 해제)
let invoiceLinked = true;
// 납기일이 발주일+2개월을 자동으로 따라갈지 여부 (사용자가 납기일을 직접 수정하면 해제)
let dueLinked = true;
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
  const discount = parseNum($("discount").value);
  const net = sum - discount;
  $("itemAmountSum").textContent = discount
    ? `${won(sum)} − 할인 ${won(discount)} = ${won(net)}`
    : won(sum);
  const total = parseNum($("amount").value);
  const box = $("itemAmountReconcile");
  if (!total) {
    $("itemAmountStatus").textContent = discount ? "할인 적용가로 저장됩니다" : "TOTAL 미입력";
    box.className = "item-amount-reconcile";
  } else if (Math.abs(net - total) <= 1) {
    $("itemAmountStatus").textContent = "TOTAL과 일치";
    box.className = "item-amount-reconcile is-match";
  } else {
    $("itemAmountStatus").textContent = `차이 ${won(total - net)}`;
    box.className = "item-amount-reconcile is-diff";
  }
}
function openOrderDialog(order) {
  ui.editingOrderId = order ? order.id : null;
  $("orderDialogTitle").textContent = order ? "발주 수정" : "신규 발주 등록";
  $("customer").value = order?.customer || "";
  $("amount").value = order?.amount ? won(order.amount) : "";
  $("discount").value = order?.discount ? won(order.discount) : "";
  $("orderDate").value = order?.orderDate || todayStr();
  // 기존 발주에 납기일이 없으면 '재고 있어 바로'로 표시
  const dueIsStock = order ? !order.dueDate : false;
  $("dueStock").checked = dueIsStock;
  $("dueDate").disabled = dueIsStock;
  if (order) {
    // 기존 발주는 저장된 납기일 유지, 자동연동 해제
    $("dueDate").value = order.dueDate || "";
    dueLinked = false;
  } else {
    // 신규는 발주일 + 2개월 자동 설정, 자동연동 유지
    $("dueDate").value = dueIsStock ? "" : addMonths($("orderDate").value, 2);
    dueLinked = true;
  }
  $("deliveryDate").value = order?.deliveryDate || "";
  $("invoiceDate").value = order?.invoiceDate || "";
  // 신규거나, 계산서일이 납품일과 같으면 자동 연동 유지. 다르면 연동 해제(각각 유지).
  invoiceLinked = !order || !order.invoiceDate || order.invoiceDate === order.deliveryDate;
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
  if (!orderDate) return toast("발주일을 입력해주세요.", "error");
  // 재고 있어 바로 = 납기 없음(null), 아니면 선택한 날짜
  const dueDate = $("dueStock").checked ? null : ($("dueDate").value || null);
  if (!orderItemsDraft.length) return toast("아이템을 1개 이상 추가해주세요.", "error");

  const items = orderItemsDraft.map((g) => ({
    item: g.item, model: g.model || "", quantity: parseNum(g.quantity) || null, amount: parseNum(g.amount) || 0,
  }));
  const discount = parseNum($("discount").value);
  let amount = parseNum($("amount").value);
  if (!amount) amount = items.reduce((s, it) => s + it.amount, 0) - discount;

  const payload = {
    customer, amount, discount, items, orderDate, dueDate,
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
function openForecastDialog(forecast, forcedType) {
  ui.editingForecastId = forecast ? forecast.id : null;
  const type = forecast ? forecast.type : (forcedType || (ui.forecastType === "order" ? "order" : "invoice"));
  $("forecastType").value = type;
  const isInv = type === "invoice";
  $("forecastDialogTitle").textContent = forecast ? "예상 수정" : (isInv ? "계산서 예상 직접 추가" : "발주 예상 직접 추가");
  const ym = `${ui.year}-${String(ui.forecastMonth).padStart(2, "0")}`;
  $("forecastEntryMonth").value = forecast?.entryMonth || ym;
  $("forecastInvoiceMonth").value = forecast?.invoiceMonth || (isInv ? ym : "");
  // 계산서 예상: 계산서 예상월을 주 입력으로, 발주 예상월 숨김 / 발주 예상: 그 반대
  $("forecastEntryMonthLabel").hidden = isInv;
  $("forecastInvoiceMonthLabel").hidden = !isInv;
  $("forecastEntryMonth").required = !isInv;
  $("forecastInvoiceMonth").required = isInv;
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
async function createSubmissionHtml(type) {
  const title = $("submissionTitle").value.trim();
  const kind = type === "quarterly" ? "분기회의" : "월간회의";
  $("submissionHtmlStatus").textContent = `${kind} 제출용 생성 중...`;
  try {
    const res = await api("/api/submission", { method: "POST", body: { title, type: type || "monthly" } });
    const blob = new Blob([res.html], { type: "text/html;charset=utf-8" });
    const base = title || `발주관리앱-${kind}-제출본`;
    const name = base.replace(/[\\/:*?"<>|]/g, "_") + ".html";
    triggerDownload(blob, name);
    $("submissionHtmlStatus").textContent = `${kind} 제출용 생성 완료! 다운로드된 .html 파일을 이메일에 첨부하세요.`;
    toast(`${kind} 제출용 HTML을 생성했습니다.`, "success");
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
  $("createMonthlyHtmlButton").addEventListener("click", () => createSubmissionHtml("monthly"));
  $("createQuarterlyHtmlButton").addEventListener("click", () => createSubmissionHtml("quarterly"));
  $("importButton").addEventListener("click", () => $("excelFile").click());
  $("excelFile").addEventListener("change", (e) => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ""; });
  $("exportButton").addEventListener("click", exportExcel);

  // 다이얼로그 닫기 버튼
  $$("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => $(b.dataset.closeDialog).close()));

  // 연도 컨트롤
  $("analysisYear").addEventListener("change", (e) => { ui.year = Number(e.target.value); renderView(); });

  /* ---- 발주 목록 상호작용 ---- */
  $("orderYearFilter").addEventListener("change", (e) => { ui.orderYear = e.target.value; ui.page = 1; renderOrders(); });
  $("searchInput").addEventListener("input", (e) => { ui.search = e.target.value; ui.page = 1; renderOrders(); });
  $("clearSearchButton").addEventListener("click", () => { ui.search = ""; $("searchInput").value = ""; renderOrders(); });
  $("resetFilterButton").addEventListener("click", () => {
    ui.search = ""; $("searchInput").value = "";
    ui.statusFilter.clear(); ui.itemFilter.clear(); ui.dueMonths.clear(); ui.dueYear = "";
    ui.orderYear = new Date().getFullYear();
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
    // 방금 추가된 그룹의 모델명 입력칸으로 커서 이동
    const models = $("orderItemGroups").querySelectorAll(".ig-model");
    if (models.length) models[models.length - 1].focus();
  });
  $("orderItemGroups").addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.group);
    if (Number.isNaN(idx)) return;
    if (e.target.classList.contains("ig-model")) orderItemsDraft[idx].model = e.target.value;
    if (e.target.classList.contains("ig-qty")) orderItemsDraft[idx].quantity = e.target.value;
    if (e.target.classList.contains("ig-amount")) {
      e.target.value = formatMoney(e.target.value);
      orderItemsDraft[idx].amount = parseNum(e.target.value);
    }
    updateItemReconcile();
  });
  $("orderItemGroups").addEventListener("click", (e) => {
    const rm = e.target.closest(".ig-remove"); if (!rm) return;
    orderItemsDraft.splice(Number(rm.dataset.group), 1);
    renderOrderItemGroups();
  });
  $("amount").addEventListener("input", () => { $("amount").value = formatMoney($("amount").value); updateItemReconcile(); });
  $("discount").addEventListener("input", () => { $("discount").value = formatMoney($("discount").value); updateItemReconcile(); });
  // 납품일 입력 시 계산서 발행일 자동 동기화 (사용자가 계산서일을 직접 바꾸기 전까지)
  $("deliveryDate").addEventListener("change", () => {
    if (invoiceLinked && $("deliveryDate").value) $("invoiceDate").value = $("deliveryDate").value;
  });
  $("invoiceDate").addEventListener("change", () => { invoiceLinked = false; });
  // 발주일 변경 시 납기일 = 발주일 + 2개월 자동 (사용자가 납기일 직접 수정 전까지)
  $("orderDate").addEventListener("change", () => {
    if (dueLinked && !$("dueStock").checked && $("orderDate").value) {
      $("dueDate").value = addMonths($("orderDate").value, 2);
    }
  });
  // 납기일 직접 수정 시 자동연동 해제
  $("dueDate").addEventListener("change", () => { dueLinked = false; });
  // '재고 있어 바로' 체크 시 납기일 입력 비활성화(납기 없음), 해제 시 발주일+2개월 복원
  $("dueStock").addEventListener("change", () => {
    const on = $("dueStock").checked;
    $("dueDate").disabled = on;
    if (on) $("dueDate").value = "";
    else if (dueLinked) $("dueDate").value = addMonths($("orderDate").value, 2);
  });
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
  // ITEM별 BUDGET & 실적 (분기별) 편집 그리드
  $("addItemBudgetBtn").addEventListener("click", ibAddItem);
  const ibGrid = $("itemBudgetGrid");
  ibGrid.addEventListener("input", (e) => {
    const cell = e.target.closest(".ib-cell, .ib-total-input");
    if (!cell) return;
    const caretEnd = cell.selectionStart === cell.value.length;
    const n = parseNum(cell.value);
    cell.value = cell.value.trim() === "" ? "" : (n ? won(n) : "");
    if (caretEnd) cell.setSelectionRange(cell.value.length, cell.value.length);
    // TOTAL 칸: 입력하면 수동(우선), 비우면 자동집계로 표시
    if (cell.classList.contains("ib-total-input")) {
      const empty = cell.value.trim() === "";
      cell.dataset.ibAuto = empty ? "1" : "0";
      cell.classList.toggle("ib-total-manual", !empty);
      cell.classList.toggle("ib-total-auto", empty);
    }
    const secEl = cell.closest(".ib-section");
    if (secEl) recalcIbSection(secEl);
  });
  ibGrid.addEventListener("change", (e) => {
    if (e.target.closest(".ib-total-input")) { saveItemBudgets().then(renderItemBudgets); return; }
    if (e.target.closest(".ib-cell, .ib-cell-name, .ib-item-name")) saveItemBudgets();
  });
  ibGrid.addEventListener("click", (e) => {
    const addC = e.target.closest("[data-ib-add-cust]");
    if (addC) { ibAddCustomer(addC.closest(".ib-section").dataset.ibSection); return; }
    const delC = e.target.closest("[data-ib-del-cust]");
    if (delC) { const tr = delC.closest("tr"); ibDeleteCustomer(delC.closest(".ib-section").dataset.ibSection, tr.dataset.ibCust); return; }
    const delI = e.target.closest("[data-ib-del-item]");
    if (delI) { ibDeleteItem(delI.closest(".ib-section").dataset.ibSection); return; }
  });
  $("yearlyAnalysisBody").addEventListener("change", (e) => {
    const input = e.target.closest(".yearly-input"); if (!input) return;
    saveYearlyAnalysis(Number(input.dataset.year), input.dataset.yearlyField, input.value);
  });

  /* ---- 월간회의 ---- */
  $$(".forecast-tab").forEach((t) => t.addEventListener("click", () => { ui.forecastType = t.dataset.forecastType; renderForecastPanel(); }));
  $("newForecastButton").addEventListener("click", () => openForecastDialog(null, "order"));
  $("newInvoiceForecastButton").addEventListener("click", () => openForecastDialog(null, "invoice"));
  $("forecastBody").addEventListener("click", (e) => {
    const rec = e.target.closest("[data-recurring-edit]");
    const man = e.target.closest("[data-forecast-edit]");
    const ord = e.target.closest("[data-order-forecast-edit]");
    if (rec) openRecurringDialog(Number(rec.dataset.recurringEdit));
    else if (man) { const f = store.forecasts.find((x) => x.id === man.dataset.forecastEdit); if (f) openForecastDialog(f); }
    else if (ord) { const o = store.orders.find((x) => x.id === ord.dataset.orderForecastEdit); if (o) openOrderDialog(o); }
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

  // 캘린더
  $("addEventButton").addEventListener("click", () => openEventDialog(null));
  $("calPrev").addEventListener("click", () => { ui.calMonth -= 1; if (ui.calMonth < 1) { ui.calMonth = 12; ui.calYear -= 1; } renderCalendar(); });
  $("calNext").addEventListener("click", () => { ui.calMonth += 1; if (ui.calMonth > 12) { ui.calMonth = 1; ui.calYear += 1; } renderCalendar(); });
  $("calToday").addEventListener("click", () => { const d = new Date(); ui.calYear = d.getFullYear(); ui.calMonth = d.getMonth() + 1; renderCalendar(); });
  $("calendarGrid").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-event-chip]");
    if (chip) { const ev = store.events.find((x) => x.id === chip.dataset.eventChip); if (ev) openEventDialog(ev); return; }
    const cell = e.target.closest("[data-cal-date]");
    if (cell) openEventDialog({ date: cell.dataset.calDate });
  });
  $("eventForm").addEventListener("submit", saveEvent);
  $("deleteEventButton").addEventListener("click", deleteEvent);
  $("urgentShowDone").addEventListener("change", renderUrgentList);
  $("urgentList").addEventListener("click", (e) => {
    const done = e.target.closest("[data-event-done]");
    const edit = e.target.closest("[data-event-edit]");
    if (done) toggleEventDone(done.dataset.eventDone);
    else if (edit) { const ev = store.events.find((x) => x.id === edit.dataset.eventEdit); if (ev) openEventDialog(ev); }
  });

  // 할일 메모
  $("todoForm").addEventListener("submit", addTodo);
  // 제목에서 Enter → 폼 제출 대신 내용 칸으로 이동 (제목만 추가되는 것 방지)
  $("todoTitle").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("todoInput").focus(); }
  });
  // 내용 칸에서 Ctrl/Cmd+Enter → 바로 추가
  $("todoInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addTodo(e); }
  });
  $("todoShowDone").addEventListener("change", renderTodoList);
  $("todoList").addEventListener("click", (e) => {
    const del = e.target.closest("[data-todo-del]");
    if (del) { deleteTodo(del.dataset.todoDel); return; }
    if (e.target.closest(".todo-check")) return; // 체크박스 클릭은 무시
    const open = e.target.closest("[data-todo-open]");
    if (open) openTodoDialog(open.dataset.todoOpen);
  });
  $("todoList").addEventListener("change", (e) => {
    const done = e.target.closest("[data-todo-done]");
    if (done) toggleTodoDone(done.dataset.todoDone);
  });
  // 할일 상세 창: 중요도 변경
  $("todoDialogOrigin").addEventListener("change", (e) => {
    const sel = e.target.closest("#todoDialogPrio");
    if (sel && ui.openTodoId) setTodoPriority(ui.openTodoId, sel.value);
  });
  // 할일 상세 창(팔로우업)
  $("todoFollowupForm").addEventListener("submit", addFollowup);
  $("todoFollowupInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addFollowup(e); }
  });
  $("todoThread").addEventListener("click", (e) => {
    const del = e.target.closest("[data-fu-del]");
    if (del) deleteFollowup(del.dataset.fuDel);
  });
  $("todoDialogDone").addEventListener("click", () => { if (ui.openTodoId) toggleTodoDone(ui.openTodoId); });
  $("todoDialogDelete").addEventListener("click", () => { if (ui.openTodoId) deleteTodo(ui.openTodoId); });

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
