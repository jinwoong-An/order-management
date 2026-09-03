// 발주관리앱 - API 라우터 (로컬 서버 & Vercel 서버리스 공용)
import {
  init,
  readCollection,
  writeCollection,
  snapshot,
  restoreSnapshot,
  newId,
  ITEMS,
  USE_SUPABASE,
} from "./db.js";
import { createBackup, listBackups, restoreBackup, pruneAutoBackups } from "./backup.js";
import { buildSubmissionHtml } from "./submission-html.js";

export const APP_ID = "order-management-clean-distribution";
export const APP_VERSION = "64.0.0";
const APP_PASSWORD = process.env.APP_PASSWORD || "";

let inited = false;
async function ensureInit() {
  if (inited) return;
  await init();
  inited = true;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null) {
      // Vercel 등에서 이미 파싱된 경우
      if (typeof req.body === "object") return resolve(req.body);
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 60 * 1024 * 1024) reject(new Error("요청이 너무 큽니다."));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("잘못된 JSON 요청입니다.")); }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const key = req.headers["x-app-password"] || "";
  return key === APP_PASSWORD;
}

async function upsertMonthlyPlan(body) {
  const rows = await readCollection("monthlyPlans");
  const year = Number(body.year);
  const month = Number(body.month);
  const idx = rows.findIndex((r) => Number(r.year) === year && Number(r.month) === month);
  const entry = { year, month, text: String(body.text ?? ""), savedAt: new Date().toISOString() };
  if (idx >= 0) rows[idx] = entry; else rows.push(entry);
  await writeCollection("monthlyPlans", rows);
  return entry;
}

const API = {
  "GET /api/health": async (_req, res) => {
    sendJson(res, 200, {
      ok: true, app_id: APP_ID, version: APP_VERSION, items: ITEMS,
      backend: USE_SUPABASE ? "supabase" : "local",
      authRequired: Boolean(APP_PASSWORD),
    });
  },

  "GET /api/orders": async (_req, res) => sendJson(res, 200, await readCollection("orders")),
  "POST /api/orders": async (req, res) => {
    const body = await readBody(req);
    const rows = await readCollection("orders");
    const now = new Date().toISOString();
    const order = { ...body, id: newId("ord"), createdAt: now, updatedAt: now };
    rows.push(order);
    await writeCollection("orders", rows);
    sendJson(res, 201, order);
  },
  "PUT /api/orders/:id": async (req, res, { id }) => {
    const body = await readBody(req);
    const rows = await readCollection("orders");
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return sendJson(res, 404, { error: "발주를 찾을 수 없습니다." });
    rows[idx] = { ...rows[idx], ...body, id, updatedAt: new Date().toISOString() };
    await writeCollection("orders", rows);
    sendJson(res, 200, rows[idx]);
  },
  "DELETE /api/orders/:id": async (_req, res, { id }) => {
    const rows = await readCollection("orders");
    const next = rows.filter((r) => r.id !== id);
    await writeCollection("orders", next);
    sendJson(res, 200, { ok: true, removed: rows.length - next.length });
  },
  "POST /api/orders/bulk": async (req, res) => {
    const body = await readBody(req);
    const ids = new Set(body.ids || []);
    const rows = await readCollection("orders");
    let changed = 0;
    for (const r of rows) {
      if (!ids.has(r.id)) continue;
      if (body.deliveryDate !== undefined) r.deliveryDate = body.deliveryDate;
      if (body.invoiceDate !== undefined) r.invoiceDate = body.invoiceDate;
      r.updatedAt = new Date().toISOString();
      changed += 1;
    }
    await writeCollection("orders", rows);
    sendJson(res, 200, { ok: true, changed });
  },

  "GET /api/annual-metrics": async (_req, res) => sendJson(res, 200, await readCollection("annualMetrics")),
  "PUT /api/annual-metrics": async (req, res) => {
    const body = await readBody(req);
    await writeCollection("annualMetrics", Array.isArray(body) ? body : body.rows || []);
    sendJson(res, 200, { ok: true });
  },
  "GET /api/plan-values": async (_req, res) => sendJson(res, 200, await readCollection("planValues")),
  "PUT /api/plan-values": async (req, res) => {
    const body = await readBody(req);
    await writeCollection("planValues", Array.isArray(body) ? body : body.rows || []);
    sendJson(res, 200, { ok: true });
  },
  "GET /api/recurring-forecasts": async (_req, res) => sendJson(res, 200, await readCollection("recurringForecasts")),
  "PUT /api/recurring-forecasts": async (req, res) => {
    const body = await readBody(req);
    await writeCollection("recurringForecasts", Array.isArray(body) ? body : body.rows || []);
    sendJson(res, 200, { ok: true });
  },
  "GET /api/yearly-analysis": async (_req, res) => sendJson(res, 200, await readCollection("yearlyAnalysis")),
  "PUT /api/yearly-analysis": async (req, res) => {
    const body = await readBody(req);
    await writeCollection("yearlyAnalysis", Array.isArray(body) ? body : body.rows || []);
    sendJson(res, 200, { ok: true });
  },
  "GET /api/customer-plans": async (_req, res) => sendJson(res, 200, await readCollection("customerPlans")),
  "PUT /api/customer-plans": async (req, res) => {
    const body = await readBody(req);
    await writeCollection("customerPlans", Array.isArray(body) ? body : body.rows || []);
    sendJson(res, 200, { ok: true });
  },

  "GET /api/forecasts": async (_req, res) => sendJson(res, 200, await readCollection("forecasts")),
  "POST /api/forecasts": async (req, res) => {
    const body = await readBody(req);
    const rows = await readCollection("forecasts");
    const entry = { ...body, id: newId("fc"), createdAt: new Date().toISOString() };
    rows.push(entry);
    await writeCollection("forecasts", rows);
    sendJson(res, 201, entry);
  },
  "PUT /api/forecasts/:id": async (req, res, { id }) => {
    const body = await readBody(req);
    const rows = await readCollection("forecasts");
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return sendJson(res, 404, { error: "예상 항목을 찾을 수 없습니다." });
    rows[idx] = { ...rows[idx], ...body, id };
    await writeCollection("forecasts", rows);
    sendJson(res, 200, rows[idx]);
  },
  "DELETE /api/forecasts/:id": async (_req, res, { id }) => {
    const rows = await readCollection("forecasts");
    await writeCollection("forecasts", rows.filter((r) => r.id !== id));
    sendJson(res, 200, { ok: true });
  },

  "GET /api/monthly-plans": async (_req, res) => sendJson(res, 200, await readCollection("monthlyPlans")),
  "PUT /api/monthly-plans": async (req, res) => {
    const body = await readBody(req);
    sendJson(res, 200, await upsertMonthlyPlan(body));
  },

  "GET /api/backups": async (_req, res) => sendJson(res, 200, await listBackups()),
  "POST /api/backups": async (_req, res) => sendJson(res, 201, await createBackup("manual")),
  "POST /api/backups/shutdown": async (_req, res) => sendJson(res, 200, { ok: true, ...(await createBackup("shutdown")) }),
  "POST /api/backups/restore": async (req, res) => {
    const body = await readBody(req);
    await restoreBackup(body.name);
    sendJson(res, 200, { ok: true });
  },

  "GET /api/export": async (_req, res) => {
    const snap = await snapshot();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="order-backup-${Date.now()}.json"`,
    });
    res.end(JSON.stringify(snap, null, 2));
  },
  "POST /api/import": async (req, res) => {
    const body = await readBody(req);
    await createBackup("pre-restore");
    await restoreSnapshot(body);
    sendJson(res, 200, { ok: true });
  },

  "POST /api/submission": async (req, res) => {
    const body = await readBody(req);
    const html = await buildSubmissionHtml(body.title);
    sendJson(res, 200, { ok: true, html });
  },
};

function matchRoute(method, pathname) {
  const key = `${method} ${pathname}`;
  if (API[key]) return { handler: API[key], params: {} };
  for (const route of Object.keys(API)) {
    const [rMethod, rPath] = route.split(" ");
    if (rMethod !== method || !rPath.includes(":")) continue;
    const rParts = rPath.split("/");
    const pParts = pathname.split("/");
    if (rParts.length !== pParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rParts.length; i += 1) {
      if (rParts[i].startsWith(":")) params[rParts[i].slice(1)] = decodeURIComponent(pParts[i]);
      else if (rParts[i] !== pParts[i]) { ok = false; break; }
    }
    if (ok) return { handler: API[route], params };
  }
  return null;
}

// 로컬 서버 & 서버리스 공용 진입점. 처리하면 true 반환.
export async function handleApi(req, res, pathname) {
  if (!pathname.startsWith("/api/")) return false;
  try {
    await ensureInit();
    // 인증 (APP_PASSWORD 설정 시). health 는 항상 허용.
    if (pathname !== "/api/health" && !authorized(req)) {
      sendJson(res, 401, { error: "인증이 필요합니다.", authRequired: true });
      return true;
    }
    const route = matchRoute(req.method, pathname);
    if (!route) {
      sendJson(res, 404, { error: "알 수 없는 API 경로입니다." });
      return true;
    }
    await route.handler(req, res, route.params);
  } catch (err) {
    sendJson(res, 500, { error: err.message || "서버 오류" });
  }
  return true;
}
