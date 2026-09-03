// 발주관리앱 - 분석 로직 (서버/제출본 공용)
// 발주 데이터로부터 상태, 월별·거래처별·ITEM별 집계를 계산합니다.
import { ITEMS } from "./db.js";

export const ITEM_CODES = ITEMS.map((it) => it.code);

// 발주 진행 상태 파생
//  - 계산서 발행일 있음 -> complete (처리 완료)
//  - 납품일 있음 / 계산서 없음 -> invoice_pending (계산서 대기)
//  - 그 외 -> in_progress (진행 중)
export function deriveStatus(order) {
  if (order?.invoiceDate) return "complete";
  if (order?.deliveryDate) return "invoice_pending";
  return "in_progress";
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 발주 TOTAL 금액: amount 우선, 없으면 아이템 합계
export function orderTotal(order) {
  const amt = toNumber(order?.amount);
  if (amt) return amt;
  return (order?.items || []).reduce((sum, it) => sum + toNumber(it.amount), 0);
}

function yearOf(dateStr) {
  if (!dateStr) return null;
  const y = Number(String(dateStr).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function monthOf(dateStr) {
  if (!dateStr) return null;
  const m = Number(String(dateStr).slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : null;
}

export function orderYear(order) {
  return yearOf(order?.orderDate);
}
export function invoiceYear(order) {
  return yearOf(order?.invoiceDate);
}
export function invoiceMonth(order) {
  return monthOf(order?.invoiceDate);
}

// 사용 가능한 연도 목록 (발주일/계산서일/현재연도)
export function collectYears(orders, extraYears = []) {
  const set = new Set();
  for (const o of orders) {
    const oy = orderYear(o);
    const iy = invoiceYear(o);
    if (oy) set.add(oy);
    if (iy) set.add(iy);
  }
  for (const y of extraYears) if (y) set.add(Number(y));
  set.add(new Date().getFullYear());
  return [...set].filter(Boolean).sort((a, b) => b - a);
}

// 연도 통합분석 요약
export function yearSummary(orders, year) {
  let orderCount = 0;
  let orderAmount = 0;
  let invoiceCount = 0;
  let invoiceAmount = 0;
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    orderAmount: 0,
    invoiceAmount: 0,
  }));

  for (const o of orders) {
    const oy = orderYear(o);
    const total = orderTotal(o);
    if (oy === year) {
      orderCount += 1;
      orderAmount += total;
      const om = monthOf(o.orderDate);
      if (om) monthly[om - 1].orderAmount += total;
    }
    if (invoiceYear(o) === year) {
      invoiceCount += 1;
      invoiceAmount += total;
      const im = invoiceMonth(o);
      if (im) monthly[im - 1].invoiceAmount += total;
    }
  }
  return { orderCount, orderAmount, invoiceCount, invoiceAmount, monthly };
}

// 거래처별 세금계산서 집계 (연도 기준, 월별 컬럼 포함)
export function customerInvoiceMatrix(orders, year) {
  const map = new Map();
  for (const o of orders) {
    if (invoiceYear(o) !== year) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    const im = invoiceMonth(o);
    const total = orderTotal(o);
    if (!map.has(name)) {
      map.set(name, {
        customer: name,
        total: 0,
        count: 0,
        months: Array.from({ length: 12 }, () => 0),
      });
    }
    const row = map.get(name);
    row.total += total;
    row.count += 1;
    if (im) row.months[im - 1] += total;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ITEM별 세금계산서 실적 (연도)
export function itemInvoiceTotals(orders, year) {
  const totals = {};
  const counts = {};
  const customers = {};
  for (const code of ITEM_CODES) {
    totals[code] = 0;
    counts[code] = 0;
    customers[code] = new Set();
  }
  for (const o of orders) {
    if (invoiceYear(o) !== year) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    const items = o.items && o.items.length ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
    for (const it of items) {
      const code = ITEM_CODES.includes(it.item) ? it.item : "ETC";
      totals[code] += toNumber(it.amount);
      counts[code] += 1;
      customers[code].add(name);
    }
  }
  const result = {};
  for (const code of ITEM_CODES) {
    result[code] = {
      total: totals[code],
      count: counts[code],
      customerCount: customers[code].size,
    };
  }
  return result;
}

// ITEM별 거래처 상세 (팝업용)
export function itemCustomerDetail(orders, year, code) {
  const map = new Map();
  for (const o of orders) {
    if (invoiceYear(o) !== year) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    const items = o.items && o.items.length ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
    for (const it of items) {
      const c = ITEM_CODES.includes(it.item) ? it.item : "ETC";
      if (c !== code) continue;
      if (!map.has(name)) map.set(name, { customer: name, count: 0, amount: 0 });
      const row = map.get(name);
      row.count += 1;
      row.amount += toNumber(it.amount);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// 거래금액별 업체 구간 (세금계산서 연간 금액)
export const AMOUNT_BUCKETS = [
  { key: "over100m", label: "1억원 이상", min: 100000000, max: Infinity },
  { key: "50to100m", label: "5천만~1억원", min: 50000000, max: 100000000 },
  { key: "10to50m", label: "1천만~5천만원", min: 10000000, max: 50000000 },
  { key: "under10m", label: "1천만원 미만", min: 0, max: 10000000 },
];

export function amountBuckets(orders, year) {
  const perCustomer = new Map();
  for (const o of orders) {
    if (invoiceYear(o) !== year) continue;
    const name = (o.customer || "미지정").trim() || "미지정";
    if (!perCustomer.has(name)) perCustomer.set(name, { customer: name, count: 0, amount: 0 });
    const row = perCustomer.get(name);
    row.count += 1;
    row.amount += orderTotal(o);
  }
  const buckets = AMOUNT_BUCKETS.map((b) => ({ ...b, customers: [] }));
  for (const row of perCustomer.values()) {
    const bucket = buckets.find((b) => row.amount >= b.min && row.amount < b.max)
      || buckets[buckets.length - 1];
    bucket.customers.push(row);
  }
  for (const b of buckets) b.customers.sort((a, c) => c.amount - a.amount);
  return buckets;
}
