// 발주관리앱 - Vercel 서버리스 API 진입점 (단일 함수)
// vercel.json 의 rewrite 로 모든 /api/* 요청이 이 함수로 들어옵니다.
// 원래 경로는 __apipath 쿼리로 전달됩니다.
import { handleApi } from "../src/api.js";

export default async function handler(req, res) {
  const u = new URL(req.url, "http://localhost");
  const pathname = u.searchParams.get("__apipath") || u.pathname;
  const handled = await handleApi(req, res, pathname);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }
}
