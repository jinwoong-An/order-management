// 발주관리앱 - 데이터 계층 (로컬 JSON 파일 / Supabase 이중 백엔드)
// 환경변수 SUPABASE_URL + SUPABASE_SERVICE_KEY 가 있으면 Supabase(Postgres)를 사용하고,
// 없으면 로컬 data/ 폴더의 JSON 파일을 사용합니다.
import { promises as fs } from "node:fs";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED, COLLECTION_NAMES } from "./seed-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const BACKUP_DIR = path.join(ROOT, "backup");

export { COLLECTION_NAMES };

// ---- 백엔드 선택 ----
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  "";
export const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

// 아이템 코드 <-> 명칭 매핑
export const ITEMS = [
  { code: "D", name: "DEBEM" },
  { code: "F", name: "FLUIMAC" },
  { code: "G", name: "GRIFFCO" },
  { code: "H", name: "HIDRACAR" },
  { code: "I", name: "INJECTA" },
  { code: "J", name: "JESSBERGER" },
  { code: "ETC", name: "ETC" },
];

/* =========================================================
 * Supabase (PostgREST) 헬퍼 - 별도 의존성 없이 fetch 사용
 * =======================================================*/
function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}
async function sbSelectCollection(name) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/collections?name=eq.${encodeURIComponent(name)}&select=data`,
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error(`Supabase 읽기 실패 (${res.status})`);
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0].data ?? [] : null;
}
async function sbUpsertCollection(name, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/collections`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({ name, data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Supabase 쓰기 실패 (${res.status}) ${t}`);
  }
}

/* =========================================================
 * 로컬 파일 헬퍼
 * =======================================================*/
function dataPath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}
async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/* =========================================================
 * 공개 API (백엔드 무관)
 * =======================================================*/
export async function init() {
  if (USE_SUPABASE) {
    // Supabase는 스키마 SQL(supabase-schema.sql)에서 이미 시드됨.
    // 매 요청마다 8회 존재 확인을 하면 느려지므로 여기서는 아무것도 하지 않는다.
    // (행이 없어도 readCollection은 []를 반환하고, writeCollection이 upsert로 생성함)
    return;
  }
  await ensureDirs();
  for (const name of COLLECTION_NAMES) {
    const target = dataPath(name);
    if (!fssync.existsSync(target)) {
      await fs.writeFile(target, JSON.stringify(SEED[name] ?? [], null, 2), "utf8");
    }
  }
}

export async function readCollection(name) {
  if (USE_SUPABASE) {
    const data = await sbSelectCollection(name);
    return Array.isArray(data) ? data : [];
  }
  try {
    const text = await fs.readFile(dataPath(name), "utf8");
    const parsed = JSON.parse(text.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeCollection(name, rows) {
  const data = rows ?? [];
  if (USE_SUPABASE) {
    await sbUpsertCollection(name, data);
    return data;
  }
  await ensureDirs();
  const target = dataPath(name);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, target);
  return data;
}

export async function snapshot() {
  const out = { version: 1, exportedAt: new Date().toISOString(), collections: {} };
  for (const name of COLLECTION_NAMES) out.collections[name] = await readCollection(name);
  return out;
}

export async function restoreSnapshot(snap) {
  if (!snap || typeof snap !== "object") throw new Error("잘못된 백업 파일입니다.");
  const collections = snap.collections || snap;
  for (const name of COLLECTION_NAMES) {
    if (Array.isArray(collections[name])) await writeCollection(name, collections[name]);
  }
  return true;
}

export function newId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
