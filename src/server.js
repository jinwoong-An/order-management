// 발주관리앱 - 로컬 HTTP 서버 (의존성 없는 순수 Node.js)
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOT, init, USE_SUPABASE } from "./db.js";
import { createBackup, pruneAutoBackups } from "./backup.js";
import { handleApi } from "./api.js";

const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    if (!rel.startsWith("/api") && !path.extname(rel)) {
      try {
        const data = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        return res.end(data);
      } catch { /* fallthrough */ }
    }
    res.writeHead(404);
    res.end("Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    return res.end("Method Not Allowed");
  }
  await serveStatic(req, res, pathname);
});

async function start() {
  await init();
  try {
    await createBackup("auto");
    await pruneAutoBackups(20);
  } catch { /* 백업 실패는 실행을 막지 않음 */ }

  server.listen(PORT, HOST, () => {
    console.log(`발주관리앱 서버 실행 중: http://${HOST}:${PORT}`);
    console.log(`저장 백엔드: ${USE_SUPABASE ? "Supabase" : "로컬 파일(data/)"}`);
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`포트 ${PORT}가 이미 사용 중입니다.`);
  else console.error("서버 오류:", err);
  process.exit(1);
});

start();
