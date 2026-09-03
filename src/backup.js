// 발주관리앱 - 백업/복원 (로컬 파일 / Supabase 이중 백엔드)
import { promises as fs } from "node:fs";
import path from "node:path";
import { BACKUP_DIR, snapshot, restoreSnapshot, USE_SUPABASE } from "./db.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  "";

const TYPE_LABEL = {
  manual: "수동 백업",
  auto: "자동 백업",
  shutdown: "종료 백업",
  "pre-restore": "복원 전 백업",
};

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}
function sbHeaders(extra = {}) {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}

export async function createBackup(type = "manual") {
  const snap = await snapshot();
  snap.backupType = type;
  const name = `backup_${type}_${stamp()}.json`;
  const payload = JSON.stringify(snap);

  if (USE_SUPABASE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/backups`, {
      method: "POST",
      headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ name, type, size: payload.length, data: snap }),
    });
    if (!res.ok) throw new Error(`백업 저장 실패 (${res.status})`);
    return { name, type };
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.writeFile(path.join(BACKUP_DIR, name), JSON.stringify(snap, null, 2), "utf8");
  return { name, type };
}

export async function listBackups() {
  if (USE_SUPABASE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/backups?select=name,type,size,created_at&order=created_at.desc`,
      { headers: sbHeaders() }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      typeLabel: TYPE_LABEL[r.type] || r.type,
      size: r.size || 0,
      createdAt: r.created_at,
    }));
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const files = await fs.readdir(BACKUP_DIR);
  const rows = [];
  for (const file of files) {
    if (!file.endsWith(".json") || !file.startsWith("backup_")) continue;
    let stat;
    try {
      stat = await fs.stat(path.join(BACKUP_DIR, file));
    } catch {
      continue;
    }
    const m = file.match(/^backup_([a-z-]+)_/);
    const type = m ? m[1] : "manual";
    rows.push({
      name: file,
      type,
      typeLabel: TYPE_LABEL[type] || type,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
    });
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}

export async function restoreBackup(name) {
  if (!name) throw new Error("백업 이름이 필요합니다.");
  await createBackup("pre-restore");

  if (USE_SUPABASE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/backups?name=eq.${encodeURIComponent(name)}&select=data&limit=1`,
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error(`백업 조회 실패 (${res.status})`);
    const rows = await res.json();
    if (!rows[0]) throw new Error("백업을 찾을 수 없습니다.");
    await restoreSnapshot(rows[0].data);
    return true;
  }

  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("잘못된 백업 파일명입니다.");
  }
  const text = await fs.readFile(path.join(BACKUP_DIR, name), "utf8");
  await restoreSnapshot(JSON.parse(text));
  return true;
}

export async function pruneAutoBackups(keep = 20) {
  if (USE_SUPABASE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/backups?type=eq.auto&select=id&order=created_at.desc`,
      { headers: sbHeaders() }
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    const remove = rows.slice(keep);
    for (const r of remove) {
      await fetch(`${SUPABASE_URL}/rest/v1/backups?id=eq.${r.id}`, {
        method: "DELETE",
        headers: sbHeaders({ Prefer: "return=minimal" }),
      }).catch(() => {});
    }
    return remove.length;
  }

  const rows = (await listBackups()).filter((r) => r.type === "auto");
  const remove = rows.slice(keep);
  for (const r of remove) {
    try {
      await fs.unlink(path.join(BACKUP_DIR, r.name));
    } catch {
      /* 무시 */
    }
  }
  return remove.length;
}
