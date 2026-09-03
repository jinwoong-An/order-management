// 발주관리앱 - Vercel 서버리스 API 진입점
// /api/* 요청을 모두 이 함수가 처리합니다. (저장은 Supabase 사용)
import { handleApi } from "../src/api.js";

export default async function handler(req, res) {
  const pathname = (req.url || "").split("?")[0];
  const handled = await handleApi(req, res, pathname);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }
}
