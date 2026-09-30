// 발주관리앱 - 제출용 HTML 생성 (다크 대시보드 + 월간 보고서)
// 앱 데이터로 자동 생성. 차트는 Chart.js(CDN) 사용, 표/보고서는 오프라인에서도 표시됩니다.
import { snapshot, ITEMS } from "./db.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export async function buildSubmissionHtml(title, type) {
  if (type === "quarterly") return buildQuarterlyHtml(title);
  const snap = await snapshot();
  const c = snap.collections;
  const orders = c.orders || [];
  const metrics = c.annualMetrics || [];
  const plans = c.monthlyPlans || [];
  const forecasts = c.forecasts || [];

  const ITEM_CODES = ITEMS.map((i) => i.code);
  const CODE_NAME = Object.fromEntries(ITEMS.map((i) => [i.code, i.name]));
  const orderTotal = (o) => {
    const a = num(o.amount);
    if (a) return a;
    return (o.items || []).reduce((s, it) => s + num(it.amount), 0);
  };
  const yOf = (d) => (d ? Number(String(d).slice(0, 4)) : 0);
  const mOf = (d) => (d ? Number(String(d).slice(5, 7)) : 0);
  const normItems = (o) =>
    (o.items && o.items.length ? o.items : [{ item: "ETC", model: "", quantity: null, amount: orderTotal(o) }])
      .map((it) => ({
        c: ITEM_CODES.includes(it.item) ? it.item : "ETC",
        model: it.model || "",
        qty: it.quantity || null,
        amt: num(it.amount),
      }));

  // 대상 연도: 계산서 발행이 있는 가장 최근 연도(없으면 올해)
  const invYears = orders.map((o) => yOf(o.invoiceDate)).filter(Boolean);
  const YEAR = invYears.length ? Math.max(...invYears) : new Date().getFullYear();
  const PREV = YEAR - 1;

  const results = [];
  const prevByItem = {};
  ITEM_CODES.forEach((code) => (prevByItem[code] = 0));
  for (const o of orders) {
    if (yOf(o.invoiceDate) === YEAR) {
      results.push({ cust: (o.customer || "미지정").trim(), mo: mOf(o.invoiceDate), total: orderTotal(o), items: normItems(o) });
    }
    if (yOf(o.invoiceDate) === PREV) {
      for (const it of normItems(o)) prevByItem[it.c] += it.amt;
    }
  }

  const NAME_TO_CODE = Object.fromEntries(ITEMS.map((i) => [i.name, i.code]));
  // 예산은 연간영업실적의 'ITEM별 BUDGET & 실적'(itemBudgets)에서 최신값을 합산
  const itemBudgets = c.itemBudgets || [];
  const budgets = {};
  ITEM_CODES.forEach((code) => (budgets[code] = { annBud: 0, q2: 0, q3: 0, q4: 0, qBud: 0 }));
  for (const sec of itemBudgets) {
    const code = NAME_TO_CODE[(sec.item || "").trim()];
    if (!code || !budgets[code]) continue;
    const cs = sec.customers || [];
    budgets[code].annBud += cs.reduce((s, x) => s + num(x.budget), 0);
    budgets[code].q2 += cs.reduce((s, x) => s + num(x.q2), 0);
    budgets[code].q3 += cs.reduce((s, x) => s + num(x.q3), 0);
    budgets[code].q4 += cs.reduce((s, x) => s + num(x.q4), 0);
  }
  ITEM_CODES.forEach((code) => { const b = budgets[code]; b.qBud = b.q4 || b.q3 || b.q2 || b.annBud; });
  // 가장 최근에 입력된 분기(전체 합계 기준)
  const totQ2 = ITEM_CODES.reduce((s, k) => s + budgets[k].q2, 0);
  const totQ3 = ITEM_CODES.reduce((s, k) => s + budgets[k].q3, 0);
  const totQ4 = ITEM_CODES.reduce((s, k) => s + budgets[k].q4, 0);
  const qLabel = totQ4 > 0 ? "4분기" : totQ3 > 0 ? "3분기" : totQ2 > 0 ? "2분기" : "연간";

  const pipeline = [];
  for (const o of orders) {
    if (o.invoiceDate) continue;
    // 대상 연도와 관련된 미발행만 (발주일/납기/납품일 중 하나가 해당 연도)
    const rel = yOf(o.orderDate) === YEAR || yOf(o.dueDate) === YEAR || yOf(o.deliveryDate) === YEAR;
    if (!rel) continue;
    pipeline.push({
      cust: (o.customer || "미지정").trim(),
      total: orderTotal(o),
      dueMo: yOf(o.dueDate) === YEAR ? mOf(o.dueDate) : 0,
      delivered: !!o.deliveryDate,
      items: normItems(o),
    });
  }

  const orderForecasts = forecasts
    .filter((f) => f.type === "order" && yOf(f.entryMonth) === YEAR)
    .map((f) => ({
      mo: mOf(f.entryMonth),
      cust: f.customer || "",
      amt: num(f.amount) || (f.items || []).reduce((s, it) => s + num(it.amount), 0),
      note: f.note || "",
      items: (f.items || []).map((it) => ({ c: ITEM_CODES.includes(it.item) ? it.item : "ETC", model: it.model || "", qty: it.quantity || null })),
    }));
  // 직접 추가된 계산서 예상 (type invoice) — 계산서 예상월 기준
  const invoiceForecasts = forecasts
    .filter((f) => f.type === "invoice" && yOf(f.invoiceMonth || f.entryMonth) === YEAR)
    .map((f) => ({
      mo: mOf(f.invoiceMonth || f.entryMonth),
      cust: f.customer || "",
      total: num(f.amount) || (f.items || []).reduce((s, it) => s + num(it.amount), 0),
      note: f.note || "",
      items: (f.items || []).map((it) => ({ c: ITEM_CODES.includes(it.item) ? it.item : "ETC", model: it.model || "", qty: it.quantity || null })),
    }));

  const monthlyPlans = {};
  for (const p of plans) if (Number(p.year) === YEAR) monthlyPlans[Number(p.month)] = p.text || "";

  const monthsSet = results.map((r) => r.mo).concat(Object.keys(monthlyPlans).map(Number)).filter(Boolean);
  const maxMonth = monthsSet.length ? Math.max(...monthsSet) : 12;

  const safeTitle = title && title.trim() ? title.trim() : `${YEAR} JWA 실적 보고`;
  const generatedAt = new Date().toLocaleString("ko-KR");
  const payload = { title: safeTitle, generatedAt, year: YEAR, prevYear: PREV, items: ITEMS, budgets, prevByItem, results, pipeline, orderForecasts, invoiceForecasts, monthlyPlans, maxMonth, qLabel };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(safeTitle)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js"><\/script>
<style>
:root{color-scheme:dark;}*{box-sizing:border-box;margin:0;padding:0;}
body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI','Malgun Gothic',sans-serif;font-size:12px;min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
canvas{max-width:100%!important;}
.tab-nav{background:#161b22;border-bottom:2px solid #30363d;padding:0 18px;display:flex;align-items:center;flex-wrap:wrap;}
.tab-nav .logo{font-size:13px;font-weight:700;color:#58a6ff;margin-right:24px;padding:12px 0;white-space:nowrap;}
.tab-btn{padding:12px 20px;border:none;border-bottom:2px solid transparent;background:transparent;color:#8b949e;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;margin-bottom:-2px;transition:all .2s;white-space:nowrap;}
.tab-btn:hover{color:#e6edf3;}.tab-btn.on{color:#58a6ff;border-bottom-color:#58a6ff;}
.tab-badge{background:rgba(88,166,255,.15);color:#58a6ff;font-size:9px;padding:1px 6px;border-radius:10px;margin-left:5px;font-weight:700;}
.page{display:none;}.page.on{display:block;}
.dash-header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;}
.dash-header h2{font-size:14px;font-weight:700;color:#58a6ff;}
.dash-header .sub{font-size:10px;color:#8b949e;margin-top:2px;}
.badge{background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.3);color:#58a6ff;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;}
.kpi-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:10px 18px;}
.kpi{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 13px;}
.kpi-lbl{font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
.kpi-val{font-size:14px;font-weight:700;line-height:1.2;}
.kpi-sub{font-size:9px;color:#8b949e;margin-top:3px;}
.cb{color:#58a6ff;}.cg{color:#3fb950;}.cw{color:#d29922;}.cr{color:#f85149;}
.notice{background:rgba(248,81,73,.07);border:1px solid rgba(248,81,73,.2);border-radius:6px;padding:6px 14px;font-size:10px;color:#f85149;margin:0 18px 8px;}
.filters{background:#161b22;border-top:1px solid #30363d;border-bottom:1px solid #30363d;padding:8px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.fg{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.fl{font-size:9px;color:#8b949e;font-weight:700;text-transform:uppercase;white-space:nowrap;}
.fb{padding:3px 10px;border-radius:20px;border:1px solid #30363d;background:transparent;color:#8b949e;cursor:pointer;font-size:11px;font-family:inherit;transition:all .15s;}
.fb:hover{border-color:#58a6ff;color:#58a6ff;}.fb.on{background:#58a6ff;border-color:#58a6ff;color:#0d1117;font-weight:700;}
select.fs{padding:3px 9px;border-radius:5px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:11px;font-family:inherit;min-width:140px;}
.afd{padding:4px 18px;font-size:10px;color:#8b949e;}
.afd span{background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.2);color:#58a6ff;padding:1px 7px;border-radius:10px;margin-left:3px;font-weight:600;}
.grid{padding:10px 18px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;min-width:0;}
.kpi{min-width:0;}
.card.fw{grid-column:1/-1;}
.ctitle{font-size:11px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;color:#e6edf3;}
.wtag{font-size:9px;background:rgba(248,81,73,.1);color:#f85149;border:1px solid rgba(248,81,73,.25);padding:1px 5px;border-radius:3px;}
.tgl{margin-left:auto;padding:2px 10px;border-radius:20px;border:1px solid #d29922;background:transparent;color:#d29922;cursor:pointer;font-size:10px;font-family:inherit;font-weight:600;white-space:nowrap;}
.tgl:hover{background:rgba(210,153,34,.15);}.tgl.on{background:#d29922;color:#0d1117;}
.h155{position:relative;height:155px;}.h190{position:relative;height:190px;}
.h200{position:relative;height:200px;}.h230{position:relative;height:230px;}
.ins{padding:0 18px 18px;}
.ins-card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;}
table.mt{width:100%;border-collapse:collapse;margin-top:10px;font-size:10px;}
table.mt th{background:#0d1117;border:1px solid #30363d;padding:5px 9px;text-align:center;color:#8b949e;font-weight:600;}
table.mt td{border:1px solid #30363d;padding:5px 9px;text-align:right;}
.report-wrap{padding:18px 18px 40px;max-width:980px;margin:0 auto;}
.report-hdr{background:linear-gradient(135deg,#1c2333 0%,#161b22 100%);border:1px solid #30363d;border-radius:10px;padding:18px 22px;margin-bottom:16px;}
.report-hdr h2{font-size:17px;font-weight:700;color:#58a6ff;margin-bottom:4px;}
.report-hdr .meta{font-size:11px;color:#8b949e;}
.report-hdr .meta span{color:#e6edf3;font-weight:600;}
.rmonths{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px;}
.section{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:12px;overflow:hidden;}
.sec-hdr{background:#1c2333;padding:10px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #30363d;flex-wrap:wrap;}
.sec-hdr h3{font-size:12px;font-weight:700;color:#e6edf3;}
.sec-hdr .cnt{font-size:10px;background:rgba(88,166,255,.15);color:#58a6ff;padding:1px 7px;border-radius:10px;font-weight:600;}
.sec-body{padding:12px 16px;}
table.rt{width:100%;border-collapse:collapse;font-size:11px;}
table.rt th{background:#0d1117;border:1px solid #30363d;padding:6px 10px;text-align:center;color:#8b949e;font-weight:600;white-space:nowrap;}
table.rt td{border:1px solid #30363d;padding:6px 10px;vertical-align:top;line-height:1.5;}
table.rt td:first-child{white-space:nowrap;color:#58a6ff;font-weight:600;}
table.rt tfoot td{background:#1c2333;font-weight:700;}
.brand-result{display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:4px;}
.brand-grid{border:1px solid #30363d;border-radius:6px;overflow:hidden;height:fit-content;}
.brand-grid-hdr{background:#0d1117;padding:6px 12px;font-size:10px;color:#8b949e;font-weight:600;text-transform:uppercase;}
.brand-row{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-top:1px solid #21262d;}
.brand-name{font-size:11px;font-weight:600;color:#e6edf3;}
.brand-amt{font-size:11px;font-weight:700;}
.brand-amt.zero{color:#484f58;}.brand-amt.pos{color:#3fb950;}
.brand-total{background:#1c2333;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid #30363d;}
.plan-text{white-space:pre-wrap;font-size:11px;line-height:1.7;color:#c9d1d9;}
.empty{color:#8b949e;text-align:center;padding:14px;font-size:11px;}
@media(max-width:820px){.kpi-row{grid-template-columns:repeat(2,minmax(0,1fr));}.grid{grid-template-columns:minmax(0,1fr);}.brand-result{grid-template-columns:1fr;}.tab-nav{overflow-x:auto;}}
</style></head><body>
<nav class="tab-nav">
  <div class="logo">&#128202; JWA ${YEAR}</div>
  <button class="tab-btn on" onclick="switchTab('dashboard',this)">&#128200; 실적 대시보드</button>
  <button class="tab-btn" onclick="switchTab('report',this)">&#128203; 월간 보고서</button>
</nav>

<div id="page-dashboard" class="page on">
  <div class="dash-header">
    <div><h2>${YEAR} JWA 실적·예산 요약 대시보드</h2><div class="sub">기준: 세금계산서 발행월 | 단위: 원 | 생성: ${esc(generatedAt)}</div></div>
    <div class="badge">${esc(safeTitle)}</div>
  </div>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-lbl">${YEAR} 실적 (YTD)</div><div class="kpi-val cb" id="k-ytd">-</div><div class="kpi-sub">계산서 발행 누계</div></div>
    <div class="kpi"><div class="kpi-lbl">연간 예산</div><div class="kpi-val" id="k-ann-bud">-</div><div class="kpi-sub">${YEAR} 전체 목표</div></div>
    <div class="kpi"><div class="kpi-lbl">연간 달성률</div><div class="kpi-val" id="k-ann-ach">-</div><div class="kpi-sub">연간 예산 대비</div></div>
    <div class="kpi"><div class="kpi-lbl">${qLabel} 예산</div><div class="kpi-val" id="k-q-bud">-</div><div class="kpi-sub">${qLabel} 목표(최신 분기)</div></div>
    <div class="kpi"><div class="kpi-lbl">${qLabel} 달성률</div><div class="kpi-val" id="k-q-ach">-</div><div class="kpi-sub">${qLabel} 예산 대비</div></div>
  </div>
  <div class="notice" id="notice" style="display:none"></div>
  <div class="filters">
    <div class="fg"><span class="fl">제품군</span><span id="prodFilters"></span></div>
    <div class="fg"><span class="fl">업체</span><select class="fs" id="vsel" onchange="sf('vendor',this.value)"><option value="all">전체 업체</option></select></div>
    <div class="fg"><span class="fl">월</span><span id="monthFilters"></span></div>
  </div>
  <div class="afd" id="afd">필터: <span>전체</span></div>
  <div class="grid">
    <div class="card"><div class="ctitle">&#128230; 브랜드별 실적 · 연간예산 · ${qLabel}예산 <span class="wtag">부진=빨강</span><button class="tgl" id="togPending" onclick="togglePending(this)">＋ 미발행 포함</button></div><div class="h155"><canvas id="cBrand"></canvas></div></div>
    <div class="card"><div class="ctitle">&#127919; 달성률 (연간 vs ${qLabel}) <span class="wtag">60% 미만 부진</span></div><div class="h190"><canvas id="cAch"></canvas></div></div>
    <div class="card fw"><div class="ctitle">&#128202; 브랜드별 월별 매출 추이 (단위: 원)</div><div class="h200"><canvas id="cBrandMonth"></canvas></div></div>
    <div class="card fw"><div class="ctitle">&#128200; 월별 총 매출 &amp; 누계 (단위: 원)</div><div class="h155"><canvas id="cMonth"></canvas></div></div>
    <div class="card"><div class="ctitle">&#129383; 제품군별 매출 비중</div><div class="h190"><canvas id="cProd"></canvas></div></div>
    <div class="card"><div class="ctitle">&#127942; 업체별 매출 순위 Top 10</div><div class="h230"><canvas id="cVend"></canvas></div></div>
  </div>
  <div class="ins"><div class="ins-card">
    <div class="ctitle">&#128176; ITEM별 분기 예산 · 실적 · 달성율</div>
    <table class="mt"><thead><tr><th style="text-align:left">ITEM</th><th>올해 BUDGET</th><th>2분기 NEW</th><th>3분기 NEW</th><th>4분기 NEW</th><th>실적(TOTAL)</th><th>달성율</th></tr></thead><tbody id="budgetTable"></tbody></table>
  </div></div>
  <div class="ins"><div class="ins-card">
    <div class="ctitle">&#128202; 월별 실적 요약 (계산서 발행 기준)</div>
    <table class="mt"><thead><tr><th>월</th><th>월 실적</th><th>누계</th></tr></thead><tbody id="itb"></tbody></table>
  </div></div>
</div>

<div id="page-report" class="page">
  <div class="report-wrap">
    <div class="report-hdr">
      <h2>&#128203; ${YEAR} 월간 보고서</h2>
      <div class="meta">세금계산서 결과 · 예상 · 월 주요 계획 &nbsp;|&nbsp; 생성: <span>${esc(generatedAt)}</span></div>
      <div class="rmonths" id="rmonths"></div>
    </div>
    <div id="report-body"></div>
  </div>
</div>

<script id="data" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}<\/script>
<script>
var DATA=JSON.parse(document.getElementById('data').textContent);
var YEAR=DATA.year, PREV=DATA.prevYear, MAXM=DATA.maxMonth||12;
var ITEMS=DATA.items, CODES=ITEMS.map(function(i){return i.code;});
var CNAME={}; ITEMS.forEach(function(i){CNAME[i.code]=i.name;});
var PCOL={D:'#58a6ff',F:'#39d353',G:'#ffa657',H:'#ff6e96',I:'#3fb950',J:'#bc8cff',ETC:'#8b949e'};
var mlabels=[]; for(var i=1;i<=MAXM;i++) mlabels.push(i+'월');
var POOR=0.6;

function switchTab(tab,btn){var ps=document.querySelectorAll('.page');for(var i=0;i<ps.length;i++)ps[i].classList.remove('on');var bs=document.querySelectorAll('.tab-btn');for(var j=0;j<bs.length;j++)bs[j].classList.remove('on');document.getElementById('page-'+tab).classList.add('on');btn.classList.add('on');}
function fmtA(n){if(!n)return'0';var m=n/10000;if(m>=10000)return(m/10000).toFixed(1)+'억';if(m>=1000)return(m/1000).toFixed(0)+'천만';if(m>=100)return(m/100).toFixed(1)+'백만';return m.toFixed(0)+'만';}
function fmtT(n){return (Math.round(n)).toLocaleString()+'원';}

// ----- 파생 데이터 -----
var vmap={};
DATA.results.forEach(function(r){
  if(!vmap[r.cust]) vmap[r.cust]={n:r.cust, im:{}, items:[]};
  var v=vmap[r.cust];
  r.items.forEach(function(it){
    if(!v.im[it.c]){var a=[];for(var k=0;k<MAXM;k++)a.push(0);v.im[it.c]=a;if(v.items.indexOf(it.c)<0)v.items.push(it.c);}
    if(r.mo>=1&&r.mo<=MAXM) v.im[it.c][r.mo-1]+=it.amt;
  });
});
var vendors=Object.keys(vmap).map(function(k){return vmap[k];});
var brands=CODES.map(function(code){
  var cur=[];for(var k=0;k<MAXM;k++)cur.push(0);
  vendors.forEach(function(v){if(v.im[code])for(var k=0;k<MAXM;k++)cur[k]+=v.im[code][k];});
  var curTotal=cur.reduce(function(a,b){return a+b;},0);
  var b=DATA.budgets[code]||{annBud:0,qBud:0};
  return {code:code,name:CNAME[code],cur:cur,curTotal:curTotal,prev:DATA.prevByItem[code]||0,annBud:b.annBud,qBud:b.qBud};
}).filter(function(b){return b.curTotal>0||b.annBud>0||b.prev>0;});
brands.forEach(function(b){b.annRate=b.annBud>0?b.curTotal/b.annBud:null;b.qRate=b.qBud>0?b.curTotal/b.qBud:null;});
// 세금계산서 미발행(예정) 금액을 브랜드별로 집계
var pendByCode={};CODES.forEach(function(c){pendByCode[c]=0;});
var pendByVendor={};
(DATA.pipeline||[]).forEach(function(p){if(!pendByVendor[p.cust])pendByVendor[p.cust]={};(p.items||[]).forEach(function(it){pendByCode[it.c]=(pendByCode[it.c]||0)+(it.amt||0);pendByVendor[p.cust][it.c]=(pendByVendor[p.cust][it.c]||0)+(it.amt||0);});});
var pendTotal=Object.keys(pendByCode).reduce(function(a,k){return a+pendByCode[k];},0);
var showPending=false;
// 미발행은 '월'이 없으므로 전체월(F.month==='all')일 때만 숫자에 합산
function pendActive(){return showPending&&F.month==='all';}
function pendCode(c){if(!pendActive())return 0;if(F.vendor!=='all'){var pv=pendByVendor[F.vendor]||{};return pv[c]||0;}return pendByCode[c]||0;}
function pendScopeTotal(){if(!pendActive())return 0;var codes=F.product==='all'?CODES:[F.product];var s=0;codes.forEach(function(c){s+=pendCode(c);});return s;}
function togglePending(btn){showPending=!showPending;btn.classList.toggle('on',showPending);btn.textContent=showPending?'－ 미발행 숨기기':'＋ 미발행 포함';upAll();upTable();}

var F={product:'all',vendor:'all',month:'all'};
function inScope(v){return F.product==='all'?v.items:(v.items.indexOf(F.product)>=0?[F.product]:[]);}
function vInv(v){var codes=inScope(v),s=0;for(var i=0;i<codes.length;i++){var arr=v.im[codes[i]]||[];if(F.month==='all'){for(var k=0;k<arr.length;k++)s+=arr[k];}else{s+=arr[+F.month]||0;}}return s;}
function vAmt(v){var s=vInv(v);if(pendActive()){var pv=pendByVendor[v.n]||{};var codes=F.product==='all'?Object.keys(pv):(pv[F.product]!==undefined?[F.product]:[]);codes.forEach(function(c){s+=pv[c]||0;});}return s;}
function fv(){return vendors.filter(function(v){var pm=F.product==='all'||v.items.indexOf(F.product)>=0;return pm&&(F.vendor==='all'||v.n===F.vendor);});}
function poor(b){return b.annRate!==null&&b.annBud>0&&b.annRate<POOR;}
function achC(r){if(r===null||r===undefined)return'rgba(139,148,158,.4)';return r<POOR?'#f85149':r<.8?'#d29922':'#3fb950';}

// ----- 필터 UI -----
function buildFilters(){
  var pf=document.getElementById('prodFilters');
  var html='<button class="fb on" data-f="product" data-v="all" onclick="sf(\\'product\\',\\'all\\')">전체</button>';
  brands.forEach(function(b){html+='<button class="fb" data-f="product" data-v="'+b.code+'" onclick="sf(\\'product\\',\\''+b.code+'\\')">'+b.code+'·'+b.name+'</button>';});
  pf.innerHTML=html;
  var mf=document.getElementById('monthFilters');
  var mh='<button class="fb on" data-f="month" data-v="all" onclick="sf(\\'month\\',\\'all\\')">전체</button>';
  for(var i=0;i<MAXM;i++) mh+='<button class="fb" data-f="month" data-v="'+i+'" onclick="sf(\\'month\\',\\''+i+'\\')">'+(i+1)+'월</button>';
  mf.innerHTML=mh;
  var vsel=document.getElementById('vsel');
  vendors.slice().sort(function(a,b){return a.n.localeCompare(b.n);}).forEach(function(v){var o=document.createElement('option');o.value=v.n;o.textContent=v.n+' ('+v.items.join(',')+')';vsel.appendChild(o);});
}

// ----- 차트 -----
var ch1,ch2,ch3,ch4,ch5,ch6;
var vcols=['#58a6ff','#3fb950','#bc8cff','#ffa657','#ff6e96','#39d353','#d29922','#79c0ff','#56d364','#d2a8ff'];
function initCharts(){
  if(typeof Chart==='undefined')return;
  Chart.defaults.color='#adbac7';Chart.defaults.borderColor='#30363d';Chart.defaults.font.family="'Segoe UI','Malgun Gothic',sans-serif";Chart.defaults.font.size=11;Chart.defaults.devicePixelRatio=Math.max(2,window.devicePixelRatio||1);
  ch1=new Chart(document.getElementById('cBrand'),{type:'bar',data:{labels:[],datasets:[
    {label:'실적(발행)',data:[],backgroundColor:[],borderRadius:2,barPercentage:.7,stack:'sales'},
    {label:'미발행(예정)',data:[],backgroundColor:'rgba(210,153,34,.9)',borderRadius:2,barPercentage:.7,stack:'sales',hidden:true},
    {label:'연간예산',data:[],backgroundColor:'rgba(88,166,255,.15)',borderColor:'rgba(88,166,255,.5)',borderWidth:1,borderRadius:2,barPercentage:.7,stack:'ab'},
    {label:'${qLabel}예산',data:[],backgroundColor:'rgba(188,140,255,.12)',borderColor:'rgba(188,140,255,.5)',borderWidth:1,borderRadius:2,barPercentage:.7,stack:'qb'}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+fmtT(c.raw);},footer:function(items){if(!showPending)return'';var s=0;items.forEach(function(i){if(i.dataset.stack==='sales')s+=i.raw;});return '총 발주: '+fmtT(s);}}}},scales:{x:{stacked:true,grid:{color:'#21262d'}},y:{stacked:true,ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  ch2=new Chart(document.getElementById('cAch'),{type:'bar',data:{labels:[],datasets:[{label:'연간 달성률',data:[],backgroundColor:[],borderRadius:3,barPercentage:.42},{label:'${qLabel} 달성률',data:[],backgroundColor:[],borderRadius:3,barPercentage:.42}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+(c.raw*100).toFixed(1)+'%';}}}},scales:{x:{min:0,max:1.3,ticks:{callback:function(v){return(v*100).toFixed(0)+'%';}},grid:{color:'#21262d'}}}}});
  ch3=new Chart(document.getElementById('cBrandMonth'),{type:'bar',data:{labels:mlabels,datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+fmtT(c.raw);}}}},scales:{x:{stacked:true,grid:{color:'#21262d'}},y:{stacked:true,ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  ch4=new Chart(document.getElementById('cMonth'),{type:'bar',data:{labels:mlabels,datasets:[{label:'월 실적',data:[],backgroundColor:'rgba(88,166,255,.6)',borderRadius:3,barPercentage:.5},{label:'누계',type:'line',data:[],borderColor:'#3fb950',backgroundColor:'rgba(63,185,80,.07)',fill:true,tension:.35,pointRadius:3,borderWidth:1.5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+fmtT(c.raw);}}}},scales:{x:{grid:{color:'#21262d'}},y:{ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  ch5=new Chart(document.getElementById('cProd'),{type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderColor:'#0d1117',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'right',labels:{boxWidth:10,padding:7}},tooltip:{callbacks:{label:function(c){var s=c.chart.data.datasets[0].data.reduce(function(a,b){return a+b;},0);return' '+c.label+': '+fmtT(c.raw)+' ('+((c.raw/s)*100).toFixed(1)+'%)';}}}}}});
  ch6=new Chart(document.getElementById('cVend'),{type:'bar',data:{labels:[],datasets:[{label:'매출',data:[],backgroundColor:[],borderRadius:3,barPercentage:.55}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return' '+fmtT(c.raw);}}}},scales:{x:{ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  upAll();
}
function upKPI(){var fvd=fv();var ytd=fvd.reduce(function(s,v){return s+vInv(v);},0)+pendScopeTotal();var scope=F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;});var annBud=0,qBud=0,r=0;scope.forEach(function(b){annBud+=b.annBud;qBud+=b.qBud;r+=b.curTotal;});r+=pendScopeTotal();var aA=annBud>0?r/annBud:0,qA=qBud>0?r/qBud:0;document.getElementById('k-ytd').textContent=fmtT(ytd);document.getElementById('k-ann-bud').textContent=fmtT(annBud);document.getElementById('k-q-bud').textContent=fmtT(qBud);var ka=document.getElementById('k-ann-ach');ka.textContent=(aA*100).toFixed(1)+'%';ka.className='kpi-val '+(aA>=.8?'cg':aA>=.6?'cw':'cr');var kq=document.getElementById('k-q-ach');kq.textContent=(qA*100).toFixed(1)+'%';kq.className='kpi-val '+(qA>=.8?'cg':qA>=.6?'cw':'cr');}
function upBrand(){var bd=F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;});ch1.data.labels=bd.map(function(b){return b.name;});ch1.data.datasets[0].data=bd.map(function(b){return b.curTotal;});ch1.data.datasets[0].backgroundColor=bd.map(function(b){return poor(b)?'rgba(248,81,73,.8)':'rgba(63,185,80,.8)';});ch1.data.datasets[1].data=bd.map(function(b){return pendByCode[b.code]||0;});ch1.data.datasets[1].hidden=!showPending;ch1.data.datasets[2].data=bd.map(function(b){return b.annBud;});ch1.data.datasets[3].data=bd.map(function(b){return b.qBud;});ch1.update();}
function upAch(){var bd=(F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;})).filter(function(b){return b.annBud>0;});function eff(b){return b.curTotal+(pendActive()?(pendByCode[b.code]||0):0);}ch2.data.labels=bd.map(function(b){return b.name;});ch2.data.datasets[0].data=bd.map(function(b){return eff(b)/b.annBud;});ch2.data.datasets[0].backgroundColor=bd.map(function(b){return achC(eff(b)/b.annBud);});ch2.data.datasets[1].data=bd.map(function(b){return b.qBud>0?eff(b)/b.qBud:0;});ch2.data.datasets[1].backgroundColor=bd.map(function(b){var c=achC(b.qBud>0?eff(b)/b.qBud:null);return c.charAt(0)==='#'?c+'99':c;});ch2.update();}
function upBrandMonth(){var bd=F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;});ch3.data.datasets=bd.map(function(b){var d=b.cur.slice();if(F.month!=='all'){d=d.map(function(v,i){return i===+F.month?v:0;});}return{label:b.name,data:d,backgroundColor:(PCOL[b.code]||'#8b949e'),borderRadius:2,barPercentage:.6,stack:'s'};});ch3.update();}
function upMonth(){var fvd=fv();var plot=[],cum=[],c=0;for(var i=0;i<MAXM;i++){var val=0;fvd.forEach(function(v){var codes=inScope(v);codes.forEach(function(cd){val+=(v.im[cd]||[])[i]||0;});});if(F.month!=='all'&&+F.month!==i)val=0;plot.push(val);var real=0;fvd.forEach(function(v){var codes=inScope(v);codes.forEach(function(cd){real+=(v.im[cd]||[])[i]||0;});});c+=real;cum.push(c);}ch4.data.datasets[0].data=plot;ch4.data.datasets[1].data=cum;ch4.update();}
function upProd(){var fvd=fv();var pt={};fvd.forEach(function(v){var codes=inScope(v);codes.forEach(function(cd){var arr=v.im[cd]||[];var s=0;if(F.month==='all'){for(var k=0;k<arr.length;k++)s+=arr[k];}else{s=arr[+F.month]||0;}pt[cd]=(pt[cd]||0)+s;});});if(pendActive()){var sc=F.product==='all'?CODES:[F.product];sc.forEach(function(c){pt[c]=(pt[c]||0)+pendCode(c);});}var codes=Object.keys(pt).filter(function(c){return pt[c]>0;}).sort(function(a,b){return pt[b]-pt[a];});ch5.data.labels=codes.map(function(c){return c+'·'+(CNAME[c]||c);});ch5.data.datasets[0].data=codes.map(function(c){return pt[c];});ch5.data.datasets[0].backgroundColor=codes.map(function(c){return PCOL[c]||'#8b949e';});ch5.update();}
function upVend(){var map={};fv().forEach(function(v){map[v.n]=(map[v.n]||0)+vAmt(v);});if(pendActive()){Object.keys(pendByVendor).forEach(function(n){if(F.vendor!=='all'&&n!==F.vendor)return;if(map[n]!==undefined)return;var pv=pendByVendor[n];var codes=F.product==='all'?Object.keys(pv):(pv[F.product]!==undefined?[F.product]:[]);var s=0;codes.forEach(function(c){s+=pv[c]||0;});if(s>0)map[n]=s;});}var arr=Object.keys(map).map(function(n){return{n:n,tot:map[n]};}).filter(function(x){return x.tot>0;}).sort(function(a,b){return b.tot-a.tot;}).slice(0,10);ch6.data.labels=arr.map(function(v){return v.n;});ch6.data.datasets[0].data=arr.map(function(v){return v.tot;});ch6.data.datasets[0].backgroundColor=arr.map(function(_,i){return vcols[i%vcols.length];});ch6.update();}
function upNotice(){var bad=brands.filter(function(b){return poor(b);}).map(function(b){return b.name+' '+(b.annRate*100).toFixed(1)+'%';});var n=document.getElementById('notice');if(bad.length){n.style.display='';n.innerHTML='&#9888;&#65039; 부진 제품군 (달성률 60% 미만) — '+bad.join(' · ');}else{n.style.display='none';}}
function upTable(){var tb=document.getElementById('itb');var html='',c=0;for(var i=0;i<MAXM;i++){var val=0;vendors.forEach(function(v){v.items.forEach(function(cd){val+=(v.im[cd]||[])[i]||0;});});c+=val;html+='<tr><td style="text-align:center">'+(i+1)+'월</td><td>'+fmtT(val)+'</td><td>'+fmtT(c)+'</td></tr>';}var grand=c;if(showPending){html+='<tr><td style="text-align:center;color:#d29922">미발행(예정)</td><td style="color:#d29922">'+fmtT(pendTotal)+'</td><td style="color:#8b949e">-</td></tr>';grand=c+pendTotal;}html+='<tr style="font-weight:700"><td style="text-align:center;color:#e6edf3">'+(showPending?'총 발주':'합계')+'</td><td>'+fmtT(grand)+'</td><td>'+fmtT(grand)+'</td></tr>';tb.innerHTML=html;}
function upAFD(){var parts=[];if(F.product!=='all')parts.push('제품군: '+F.product+'·'+(CNAME[F.product]||''));if(F.vendor!=='all')parts.push('업체: '+F.vendor);if(F.month!=='all')parts.push((+F.month+1)+'월');if(showPending)parts.push(pendActive()?'미발행 포함(총 발주)':'미발행 포함(전체월에서만 합산)');document.getElementById('afd').innerHTML='필터: '+(parts.length?parts.map(function(p){return'<span>'+p+'</span>';}).join(' '):'<span>전체</span>');}
function upBudgetTable(){var tb=document.getElementById('budgetTable');if(!tb)return;var html='',tA=0,t2=0,t3=0,t4=0,tR=0;brands.forEach(function(b){var bg=DATA.budgets[b.code]||{};var eff=b.curTotal+(pendActive()?(pendByCode[b.code]||0):0);var last=bg.q4||bg.q3||bg.q2||bg.annBud||0;var rate=last>0?(eff/last*100).toFixed(1)+'%':'-';html+='<tr><td style="text-align:left;color:#58a6ff;font-weight:600">'+b.code+'·'+b.name+'</td><td>'+fmtT(bg.annBud||0)+'</td><td>'+fmtT(bg.q2||0)+'</td><td>'+fmtT(bg.q3||0)+'</td><td>'+(bg.q4?fmtT(bg.q4):'-')+'</td><td style="color:#3fb950">'+fmtT(eff)+'</td><td>'+rate+'</td></tr>';tA+=bg.annBud||0;t2+=bg.q2||0;t3+=bg.q3||0;t4+=bg.q4||0;tR+=eff;});var lastT=t4||t3||t2||tA;html+='<tr style="font-weight:700;background:#1c2333"><td style="text-align:left;color:#e6edf3">TOTAL</td><td>'+fmtT(tA)+'</td><td>'+fmtT(t2)+'</td><td>'+fmtT(t3)+'</td><td>'+(t4?fmtT(t4):'-')+'</td><td style="color:#3fb950">'+fmtT(tR)+'</td><td>'+(lastT>0?(tR/lastT*100).toFixed(1)+'%':'-')+'</td></tr>';tb.innerHTML=html;}
function upAll(){upKPI();upBrand();upAch();upBrandMonth();upMonth();upProd();upVend();upBudgetTable();upAFD();}
function sf(type,val){F[type]=val;var bs=document.querySelectorAll('[data-f="'+type+'"]');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('on',bs[i].dataset.v===val);upAll();}

// ----- 보고서 -----
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function reportMonth(mo){
  var body=document.getElementById('report-body');
  var rms=document.querySelectorAll('#rmonths .fb');for(var i=0;i<rms.length;i++)rms[i].classList.toggle('on',+rms[i].dataset.m===mo);
  var html='';
  // 세금계산서 결과
  var res=DATA.results.filter(function(r){return r.mo===mo;});
  var resRows='',resTot=0,byc={};CODES.forEach(function(c){byc[c]=0;});
  res.forEach(function(r){r.items.forEach(function(it){
    var model=(it.model||'')+(it.qty?' ×'+it.qty:'');
    resRows+='<tr><td>'+esc(r.cust)+'</td><td style="color:#c9d1d9">'+esc(model||'-')+'</td><td style="text-align:right">'+fmtT(it.amt)+'</td><td style="text-align:center">'+it.c+'</td></tr>';
    resTot+=it.amt;byc[it.c]+=it.amt;
  });});
  html+='<div class="section"><div class="sec-hdr"><span>&#129534;</span><h3>'+mo+'월 세금계산서 결과</h3><span class="cnt">'+res.length+'건</span></div><div class="sec-body">';
  if(res.length){
    html+='<div class="brand-result"><table class="rt"><thead><tr><th style="width:130px">업체</th><th>모델</th><th style="width:110px">금액</th><th style="width:44px">품목</th></tr></thead><tbody>'+resRows+'</tbody><tfoot><tr><td colspan="2" style="text-align:right;color:#8b949e">합계</td><td style="text-align:right;color:#3fb950">'+fmtT(resTot)+'</td><td></td></tr></tfoot></table>';
    html+='<div class="brand-grid"><div class="brand-grid-hdr">브랜드별 집계</div>';
    CODES.forEach(function(c){if(byc[c]>0||DATA.budgets[c]&&DATA.budgets[c].annBud>0){html+='<div class="brand-row"><span class="brand-name">'+(CNAME[c]||c)+' ('+c+')</span><span class="brand-amt '+(byc[c]>0?'pos':'zero')+'">'+fmtT(byc[c])+'</span></div>';}});
    html+='<div class="brand-total"><span>합계</span><span style="color:#3fb950;font-weight:700">'+fmtT(resTot)+'</span></div></div></div>';
  } else { html+='<div class="empty">해당 월 세금계산서 결과가 없습니다.</div>'; }
  html+='</div></div>';
  // 발주 예상 · 계산서 예상은 '작성월(선택월)의 다음 달' 기준
  var nmo=mo+1; var nlbl=nmo>12?'다음달':(nmo+'월');
  // 발주 예상 (다음 달)
  var of=DATA.orderForecasts.filter(function(f){return f.mo===nmo;});
  html+='<div class="section"><div class="sec-hdr"><span>&#128230;</span><h3>'+nlbl+' 발주 예상 <span style="font-size:11px;color:#6e7681;font-weight:400">(다음 달)</span></h3><span class="cnt">'+of.length+'건</span></div><div class="sec-body">';
  if(of.length){html+='<table class="rt"><thead><tr><th style="width:130px">업체</th><th>모델</th><th style="width:110px">예상금액</th></tr></thead><tbody>';var oft=0;of.forEach(function(f){var md=f.items.map(function(it){return (it.model||'')+(it.qty?' ×'+it.qty:'');}).join(', ');html+='<tr><td>'+esc(f.cust)+'</td><td style="color:#c9d1d9">'+esc(md||'-')+'</td><td style="text-align:right">'+fmtT(f.amt)+'</td></tr>';oft+=f.amt;});html+='</tbody><tfoot><tr><td colspan="2" style="text-align:right;color:#8b949e">합계</td><td style="text-align:right;color:#3fb950">'+fmtT(oft)+'</td></tr></tfoot></table>';}else{html+='<div class="empty">'+nlbl+' 발주 예상이 없습니다.</div>';}
  html+='</div></div>';
  // 계산서 예상 (다음 달 납기 미계산서 + 직접 추가된 계산서 예상)
  var pe=DATA.pipeline.filter(function(p){return p.dueMo===nmo;}).map(function(p){return {cust:p.cust,total:p.total,items:p.items,src:'납기'};});
  var invf=(DATA.invoiceForecasts||[]).filter(function(f){return f.mo===nmo;}).map(function(f){return {cust:f.cust,total:f.total,items:f.items,src:'직접'};});
  var pall=pe.concat(invf);
  html+='<div class="section"><div class="sec-hdr"><span>&#128196;</span><h3>'+nlbl+' 세금계산서 예상 <span style="font-size:11px;color:#6e7681;font-weight:400">(다음 달)</span></h3><span class="cnt">'+pall.length+'건</span></div><div class="sec-body">';
  if(pall.length){html+='<table class="rt"><thead><tr><th style="width:140px">업체</th><th>모델</th><th style="width:60px">근거</th><th style="width:120px">예상금액</th></tr></thead><tbody>';var pet=0;pall.forEach(function(p){var md=p.items.map(function(it){return (it.model||'')+(it.qty?' ×'+it.qty:'');}).join(', ');html+='<tr><td>'+esc(p.cust)+'</td><td style="color:#c9d1d9">'+esc(md||'-')+'</td><td style="text-align:center;color:#8b949e;font-size:11px">'+p.src+'</td><td style="text-align:right">'+fmtT(p.total)+'</td></tr>';pet+=p.total;});html+='</tbody><tfoot><tr><td colspan="3" style="text-align:right;color:#8b949e">합계</td><td style="text-align:right;color:#3fb950">'+fmtT(pet)+'</td></tr></tfoot></table>';}else{html+='<div class="empty">'+nlbl+' 세금계산서 예상이 없습니다.</div>';}
  html+='</div></div>';
  // 월 주요 계획
  var plan=DATA.monthlyPlans[mo]||'';
  html+='<div class="section"><div class="sec-hdr"><span>&#128197;</span><h3>'+mo+'월 주요 계획</h3></div><div class="sec-body">'+(plan?'<div class="plan-text">'+esc(plan)+'</div>':'<div class="empty">등록된 월 계획이 없습니다.</div>')+'</div></div>';
  body.innerHTML=html;
}
function buildReportMonths(){
  var rm=document.getElementById('rmonths');var html='';
  for(var i=1;i<=MAXM;i++) html+='<button class="fb" data-m="'+i+'" onclick="reportMonth('+i+')">'+i+'월</button>';
  rm.innerHTML=html;
}

window.addEventListener('DOMContentLoaded',function(){
  buildFilters();buildReportMonths();upNotice();upTable();initCharts();reportMonth(MAXM);
});
<\/script>
</body>
</html>`;
}



async function buildQuarterlyHtml(title) {
  const snap = await snapshot();
  const c = snap.collections;
  const orders = c.orders || [];
  const itemBudgets = c.itemBudgets || [];
  const ITEM_CODES = ITEMS.map((i) => i.code);
  const CODE_NAME = Object.fromEntries(ITEMS.map((i) => [i.code, i.name]));
  const yOf = (d) => (d ? Number(String(d).slice(0, 4)) : 0);
  const orderTotal = (o) => { const a = num(o.amount); if (a) return a; return (o.items || []).reduce((s, it) => s + num(it.amount), 0); };
  const invYears = orders.map((o) => yOf(o.invoiceDate)).filter(Boolean);
  const YEAR = invYears.length ? Math.max(...invYears) : new Date().getFullYear();
  const norm = (s) => String(s || "").trim().replace(/[.．\s]+$/g, "").replace(/\s+/g, " ").toLowerCase();
  function distByItem(filterFn) {
    const map = new Map();
    const add = (itemName, cust, amt) => { const k = String(itemName).toUpperCase(); if (!map.has(k)) map.set(k, new Map()); const m = map.get(k); const nk = norm(cust); if (!m.has(nk)) m.set(nk, { name: cust, amount: 0 }); m.get(nk).amount += amt; };
    for (const o of orders) {
      if (!filterFn(o)) continue;
      const cust = (o.customer || "").trim() || "미지정";
      const linesA = (o.items && o.items.length) ? o.items : [{ item: "ETC", amount: orderTotal(o) }];
      const nonEtc = linesA.filter((it) => ITEM_CODES.includes(it.item) && it.item !== "ETC");
      const etcAmt = linesA.reduce((s, it) => s + ((!ITEM_CODES.includes(it.item) || it.item === "ETC") ? num(it.amount) : 0), 0);
      const nonEtcSum = nonEtc.reduce((s, it) => s + num(it.amount), 0);
      if (nonEtc.length) { for (const it of nonEtc) { const base = num(it.amount); const share = nonEtcSum > 0 ? etcAmt * (base / nonEtcSum) : etcAmt / nonEtc.length; add(CODE_NAME[it.item] || it.item, cust, base + share); } }
    }
    return map;
  }
  const invMap = distByItem((o) => yOf(o.invoiceDate) === YEAR);
  const unpaidMap = distByItem((o) => !o.invoiceDate && (yOf(o.orderDate) === YEAR || yOf(o.dueDate) === YEAR || yOf(o.deliveryDate) === YEAR));
  const BRANDS = [], BD = {}, COMPS = [], UNPAID = {};
  let T = { r25: 0, b: 0, q2b: 0, q3b: 0, q4b: 0, r26: 0 }, UNPAID_TOTAL = 0;
  for (const sec of itemBudgets) {
    const name = (sec.item || "").trim(); if (!name) continue;
    BRANDS.push(name);
    const key = name.toUpperCase();
    const secInv = invMap.get(key) || new Map();
    const custs = sec.customers || [];
    const etcIdx = custs.findIndex((x) => norm(x.name) === "etc");
    const matched = new Set();
    const compRows = [];
    let r25 = 0, b = 0, q2b = 0, q3b = 0, q4b = 0;
    custs.forEach((x, i) => {
      const cr25 = num(x.result), cb = num(x.budget), cq2 = num(x.q2), cq3 = num(x.q3), cq4 = num(x.q4);
      r25 += cr25; b += cb; q2b += cq2; q3b += cq3; q4b += cq4;
      const ov = (x.totalOverride !== null && x.totalOverride !== undefined && x.totalOverride !== "");
      let cr26;
      if (ov) cr26 = num(x.totalOverride);
      else if (i === etcIdx) cr26 = 0;
      else { const nk = norm(x.name); if (nk && secInv.has(nk)) { cr26 = secInv.get(nk).amount; matched.add(nk); } else cr26 = 0; }
      compRows.push({ brand: name, name: x.name || "", r25: cr25, b: cb, q2b: cq2, q3b: cq3, q4b: cq4, r26: cr26, _etc: i === etcIdx, _ov: ov });
    });
    let leftover = 0; for (const [nk, v] of secInv) if (!matched.has(nk)) leftover += v.amount;
    if (etcIdx >= 0) { if (!compRows[etcIdx]._ov) compRows[etcIdx].r26 = leftover; }
    else if (leftover > 0) compRows.push({ brand: name, name: "ETC", r25: 0, b: 0, q2b: 0, q3b: 0, q4b: 0, r26: leftover });
    let r26 = 0;
    compRows.forEach((r) => { r26 += r.r26; COMPS.push({ brand: r.brand, name: r.name, r25: Math.round(r.r25), b: Math.round(r.b), q2b: Math.round(r.q2b), q3b: Math.round(r.q3b), q4b: Math.round(r.q4b), r26: Math.round(r.r26) }); });
    BD[name] = { r25: Math.round(r25), b: Math.round(b), q2b: Math.round(q2b), q3b: Math.round(q3b), q4b: Math.round(q4b), r26: Math.round(r26) };
    const secUn = unpaidMap.get(key) || new Map();
    let un = 0; for (const v of secUn.values()) un += v.amount;
    UNPAID[name] = Math.round(un); UNPAID_TOTAL += un;
    T.r25 += r25; T.b += b; T.q2b += q2b; T.q3b += q3b; T.q4b += q4b; T.r26 += r26;
  }
  const TOTAL = { r25: Math.round(T.r25), b: Math.round(T.b), q2b: Math.round(T.q2b), q3b: Math.round(T.q3b), q4b: Math.round(T.q4b), r26: Math.round(T.r26) };
  UNPAID_TOTAL = Math.round(UNPAID_TOTAL);
  const LASTQLBL = T.q4b > 0 ? "4분기" : T.q3b > 0 ? "3분기" : T.q2b > 0 ? "2분기" : "연간";
  const docTitle = (title && title.trim()) ? title.trim() : (YEAR + " JWA 분기 회의 대시보드");
  const today = new Date().toLocaleDateString("ko-KR");
  const j = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
  const dataJs = "const TOTAL=" + j(TOTAL) + ";\nconst BRANDS=" + j(BRANDS) + ";\nconst BD=" + j(BD) + ";\nconst UNPAID=" + j(UNPAID) + ";\nconst UNPAID_TOTAL=" + UNPAID_TOTAL + ";\nconst COMPS=" + j(COMPS) + ";";
  return `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(docTitle)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js" integrity="sha384-iU8HYtnGQ8Cy4zl7gbNMOhsDTTKX02BTXptVP/vqAWIaTfM7isw76iyZCsjL2eVi" crossorigin="anonymous"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5}
header{background:linear-gradient(135deg,#161b22,#0a0d14);border-bottom:1px solid #21262d;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
header h1{font-size:15px;font-weight:700;color:#58a6ff}
.sub{color:#8b949e;font-size:11px}
.hright{display:flex;align-items:center;gap:10px}
.crumb{font-size:12px;color:#58a6ff;font-weight:600}
.hdate{font-size:11px;color:#6e7681}
.upbtn{padding:6px 15px;border-radius:20px;border:1px solid #30363d;background:#161b22;color:#8b949e;cursor:pointer;font-size:11px;font-weight:700;display:flex;align-items:center;gap:7px;transition:all .25s;white-space:nowrap}
.upbtn:hover{border-color:#f0b800;color:#e6edf3}
.upbtn.on{background:#1c1400;border-color:#f0b800;color:#f0c050;box-shadow:0 0 18px 3px rgba(240,184,0,.4)}
.updot{width:7px;height:7px;border-radius:50%;background:#6e7681;flex-shrink:0;transition:all .25s}
.upbtn.on .updot{background:#f0c050;box-shadow:0 0 10px 4px rgba(240,184,0,.95)}
@keyframes kG{0%{box-shadow:0 0 0 0 rgba(240,184,0,.9)}50%{box-shadow:0 0 30px 10px rgba(240,184,0,.5)}100%{box-shadow:0 0 0 0 rgba(240,184,0,0)}}
@keyframes vP{0%{transform:scale(1)}35%{transform:scale(1.14);color:#f0c050;text-shadow:0 0 18px rgba(240,184,0,1)}100%{transform:scale(1);text-shadow:none}}
@keyframes cG{0%{border-color:#21262d}50%{border-color:#f0b800;box-shadow:0 0 20px 4px rgba(240,184,0,.3)}100%{border-color:#21262d;box-shadow:none}}
.kpi.kg{animation:kG 1.3s ease-out}
.kval.vp{animation:vP 1s ease-out}
.cc.cg,.cc-full.cg{animation:cG 1.4s ease-out}
.kpi-row{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;padding:10px 20px;border-bottom:1px solid #21262d}
.kpi{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:10px 13px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%;background:var(--ac,#388bfd)}
.klbl{color:#8b949e;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.kval{font-size:15px;font-weight:700;margin-top:3px;line-height:1.1}
.ksub{color:#6e7681;font-size:10px;margin-top:2px}
.pb{height:3px;background:#21262d;border-radius:2px;margin-top:5px;overflow:hidden}
.pbf{height:100%;border-radius:2px;transition:width .5s ease}
.filters{padding:8px 20px;border-bottom:1px solid #21262d;background:#090c11}
.frow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.frow+.frow{margin-top:6px}
.flbl{font-size:10px;font-weight:700;color:#6e7681;text-transform:uppercase;letter-spacing:.6px;white-space:nowrap;min-width:48px}
.pills{display:flex;flex-wrap:wrap;gap:4px}
.pill{padding:3px 9px;border-radius:20px;border:1px solid #30363d;background:#161b22;color:#8b949e;cursor:pointer;font-size:11px;font-weight:600;transition:all .15s;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;user-select:none}
.pill:hover{border-color:#58a6ff;color:#e6edf3;background:#1c2128}
.pill.active{background:#1f6feb;border-color:#388bfd;color:#fff}
.pill.bad{border-color:rgba(218,54,51,.5);color:#c9615e}
.pill.bad.active{background:#da3633;border-color:#f85149;color:#fff}
.badge{font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;line-height:1.4}
.br{background:rgba(248,81,73,.2);color:#f85149}
.bg{background:rgba(63,185,80,.2);color:#3fb950}
.bn{background:rgba(110,118,129,.2);color:#8b949e}
.cgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:10px 20px 0}
.cc{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:13px}
.ctitle{font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:9px;display:flex;align-items:center;justify-content:space-between}
.ctitle-left{display:flex;align-items:center;gap:6px}
.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.cw{position:relative;height:200px}
.leg{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}
.li{display:flex;align-items:center;gap:4px;font-size:10px;color:#8b949e}
.ld{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.tscroll{max-height:200px;overflow-y:auto;overflow-x:auto}
.tscroll::-webkit-scrollbar{width:3px;height:3px}
.tscroll::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
.tbl{width:100%;border-collapse:collapse;font-size:11px;min-width:530px}
.tbl th{color:#6e7681;font-weight:600;text-align:left;padding:4px 6px;border-bottom:1px solid #21262d;font-size:10px;text-transform:uppercase;white-space:nowrap;position:sticky;top:0;background:#161b22;z-index:1}
.tbl td{padding:5px 6px;border-bottom:1px solid rgba(33,38,45,.6);white-space:nowrap}
.tbl tr:hover td{background:rgba(88,166,255,.04)}
.n{text-align:right;color:#8b949e;font-variant-numeric:tabular-nums}
.nw{text-align:right;font-variant-numeric:tabular-nums}
.rc{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.br-row{background:rgba(248,81,73,.03)}
.br-row td:first-child{color:#f85149}
.nm{font-weight:600;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:9px;padding:1px 4px;border-radius:4px;font-weight:700;display:inline-block}
.tag-up{background:rgba(63,185,80,.15);color:#3fb950}
.tag-dn{background:rgba(248,81,73,.15);color:#f85149}
.tag-eq{background:rgba(110,118,129,.15);color:#8b949e}
.sec-full{padding:10px 20px 0}
.cc-full{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:13px;margin-bottom:9px}
.cw-top{position:relative;height:188px}
.cw-mid{position:relative;height:248px}
.cgrid-bot{padding:9px 20px 14px}
.up-bar-leg{display:none;align-items:center;gap:6px;font-size:10px;font-weight:700;color:#f0c050;margin-top:8px}
.up-bar-leg.show{display:flex}
.up-bar-leg-dot{width:12px;height:8px;border-radius:2px;background:#f0c050;box-shadow:0 0 8px 3px rgba(240,184,0,.7);flex-shrink:0}
.cb{color:#58a6ff}.cg2{color:#3fb950}.cr{color:#f85149}.cw2{color:#e6edf3}.cy{color:#d29922}.cgr{color:#8b949e}
</style>
</head>
<body>
<header>
  <div>
    <h1>&#128202; AJW &#48516;&#44592; &#54924;&#51032; &#45824;&#49884;&#48372;&#46300;</h1>
    <div class="sub">${YEAR}년 ${LASTQLBL} · 단위: 원 · 2025 실적 = 세금계산서 발행 기준</div>
  </div>
  <div class="hright">
    <div><div class="crumb" id="crumb">전체 브랜드</div><div class="hdate">기준일: ${today}</div></div>
    <button class="upbtn" id="upBtn" onclick="toggleUp()">
      <span class="updot"></span>&#49464;&#44552;&#44228;&#49328;&#49436; &#48120;&#48156;&#54665; &#54252;&#54632;
    </button>
  </div>
</header>
<div class="kpi-row" id="kpiRow"></div>
<div class="filters">
  <div class="frow"><span class="flbl">&#51228;&#54408;&#44392;</span><div class="pills" id="bPills"></div></div>
  <div class="frow" id="cRow" style="display:none"><span class="flbl">&#50629;&#52404;</span><div class="pills" id="cPills"></div></div>
</div>
<div class="sec-full">
  <div class="cc-full" id="cc6">
    <div class="ctitle"><div class="ctitle-left"><div class="dot" style="background:#56d364"></div><span id="t6">&#51204;&#52404; &#50696;&#49328; &#44396;&#49457; &#48320;&#54868;</span></div></div>
    <div class="cw-top"><canvas id="c6"></canvas></div>
    <div class="leg" id="leg6"></div>
  </div>
</div>
<div class="cgrid">
  <div class="cc" id="cc1">
    <div class="ctitle"><div class="ctitle-left"><div class="dot" style="background:#388bfd"></div><span id="t1">&#48652;&#47353;&#46300;&#48324; &#49892;&#51201; &#48708;&#44368;</span></div></div>
    <div class="cw"><canvas id="c1"></canvas></div>
    <div class="up-bar-leg" id="ul1"><div class="up-bar-leg-dot"></div>&#9651; &#48120;&#48156;&#54665;&#48516; (&#44552;&#49353; = &#49464;&#44552;&#44228;&#49328;&#49436; &#48120;&#48156;&#54665;)</div>
    <div class="leg">
      <div class="li"><div class="ld" style="background:#6e7681"></div>2025&#49892;&#51201;</div>
      <div class="li"><div class="ld" style="background:rgba(56,139,253,.5)"></div>&#50672;&#44036;&#50696;&#49328;</div>
      <div class="li"><div class="ld" style="background:#3fb950"></div>&#48156;&#54665;&#49892;&#51201;</div>
      <div class="li"><div class="ld" style="background:#f85149"></div>&#48156;&#54665;(&#48512;&#51652;)</div>
      <div class="li" id="upLeg1" style="display:none"><div class="ld" style="background:#f0c050;box-shadow:0 0 5px #f0b800"></div>&#48120;&#48156;&#54665;</div>
    </div>
  </div>
  <div class="cc" id="cc2">
    <div class="ctitle"><div class="ctitle-left"><div class="dot" style="background:#da3633"></div><span id="t2">&#45813;&#49457;&#47960; &#48708;&#44368;</span></div></div>
    <div class="cw"><canvas id="c2"></canvas></div>
    <div class="leg" id="leg2"></div>
  </div>
  <div class="cc" id="cc3">
    <div class="ctitle"><div class="ctitle-left"><div class="dot" style="background:#a371f7"></div><span id="t3">&#48516;&#44592;&#48324; &#50696;&#49328; &#48320;&#54868;</span></div></div>
    <div class="cw"><canvas id="c3"></canvas></div>
    <div class="leg" id="leg3"></div>
  </div>
  <div class="cc" id="cc4">
    <div class="ctitle"><div class="ctitle-left"><div class="dot" style="background:#58a6ff"></div><span id="t4">&#50629;&#52404;&#48324; &#49345;&#49464;</span></div></div>
    <div class="tscroll" id="tbox"></div>
  </div>
</div>
<div class="cgrid-bot">
  <div class="cc-full" id="cc5" style="margin-top:9px">
    <div class="ctitle"><div class="ctitle-left"><div class="dot" style="background:#388bfd"></div><span id="t5">&#48516;&#44592;&#48324; &#50696;&#49328; &#48320;&#54868; &#47589;&#45824;</span></div><span style="font-size:10px;color:#6e7681">&#9650;&#9660; = &#50672;&#44036;&#50696;&#49328; &#45824;&#48708;</span></div>
    <div class="cw-mid"><canvas id="c5"></canvas></div>
    <div class="leg" id="leg5"></div>
  </div>
</div>
<script>

${dataJs}
const fmt=v=>v==null?'-':Number(v).toLocaleString('ko-KR')+'원';
const pct=r=>r==null?'N/A':(r*100).toFixed(1)+'%';
const rCls=r=>r==null?'cgr':r>=1?'cb':r>=.5?'cg2':'cr';
const QDEFS=[{k:'q2b',lbl:'2분기',s:'2Q'},{k:'q3b',lbl:'3분기',s:'3Q'},{k:'q4b',lbl:'4분기',s:'4Q'}];
const QS=QDEFS.filter(q=>BRANDS.some(b=>(BD[b][q.k]||0)>0)||COMPS.some(c=>(c[q.k]||0)>0));
const LASTQ=QS.length?QS[QS.length-1]:{k:'b',lbl:'연간',s:'연간'};
const CC=['rgba(56,139,253,.75)','rgba(63,185,80,.75)','rgba(210,153,34,.75)','rgba(163,113,247,.75)','rgba(86,211,100,.75)','rgba(121,192,255,.75)','rgba(248,81,73,.75)','rgba(255,166,87,.75)'];
const QC=['rgba(56,139,253,.75)','rgba(210,153,34,.75)','rgba(163,113,247,.75)','rgba(63,185,80,.75)'];
const BC={};BRANDS.forEach(function(b,i){BC[b]=CC[i%CC.length];});
let selB='ALL',selC='ALL',showUp=false,ch1,ch2,ch3,ch5,ch6;
const UC='rgba(240,184,0,0.92)';
const isBad=br=>BD[br].b>0&&BD[br].r26/BD[br].b<.5;
const upAmt=br=>showUp?UNPAID[br]||0:0;
const r26Br=br=>BD[br].r26+upAmt(br);
function triggerGlow(){
  ['cc1','cc2','cc4','cc6'].forEach(function(id){var el=document.getElementById(id);if(!el)return;el.classList.remove('cg');void el.offsetWidth;el.classList.add('cg');el.addEventListener('animationend',function(){el.classList.remove('cg');},{once:true});});
  document.querySelectorAll('.kval').forEach(function(el){el.classList.remove('vp');void el.offsetWidth;el.classList.add('vp');el.addEventListener('animationend',function(){el.classList.remove('vp');},{once:true});});
  document.querySelectorAll('.kpi').forEach(function(el){el.classList.remove('kg');void el.offsetWidth;el.classList.add('kg');el.addEventListener('animationend',function(){el.classList.remove('kg');},{once:true});});
}
function toggleUp(){showUp=!showUp;document.getElementById('upBtn').classList.toggle('on',showUp);document.getElementById('ul1').classList.toggle('show',showUp);document.getElementById('upLeg1').style.display=showUp?'flex':'none';buildBPills();updateAll();if(showUp)triggerGlow();}
const BW={categoryPercentage:.42,barPercentage:.75,maxBarThickness:26};
const pctPlugin={id:'pct',afterDatasetsDraw:function(chart){var ctx=chart.ctx,data=chart.data;for(var di=1;di<data.datasets.length;di++){var meta=chart.getDatasetMeta(di);if(!meta||meta.hidden)continue;meta.data.forEach(function(bar,i){var base=data.datasets[0].data[i]||0,val=data.datasets[di].data[i]||0;if(!base||!val)return;var p=(val-base)/base*100;ctx.save();ctx.font='bold 8px sans-serif';ctx.fillStyle=p>=0?'#3fb950':'#f85149';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText((p>=0?'+':'')+p.toFixed(0)+'%',bar.x,bar.y-2);ctx.restore();});}}};
const stkPlugin={id:'stk',afterDatasetsDraw:function(chart){var ctx=chart.ctx,data=chart.data;if(!data.datasets.length)return;var n=data.datasets.length;var tots=data.datasets[0].data.map(function(_,i){return data.datasets.reduce(function(s,ds){return s+(ds.data[i]||0);},0);});var base=tots[0]||1;chart.getDatasetMeta(n-1).data.forEach(function(bar,i){if(!tots[i])return;var vt=(tots[i]/10000).toLocaleString('ko-KR')+'만';var p=(tots[i]-base)/base*100;var pt=i===0?'':(p>=0?'+':'')+p.toFixed(1)+'%';ctx.save();ctx.textAlign='center';ctx.textBaseline='bottom';if(pt){ctx.font='bold 10px sans-serif';ctx.fillStyle=p>=0?'#3fb950':'#f85149';ctx.fillText(pt,bar.x,bar.y-14);}ctx.font='bold 10px sans-serif';ctx.fillStyle='#e6edf3';ctx.fillText(vt,bar.x,bar.y-2);ctx.restore();});}};
const glowPlugin={id:'glow',beforeDatasetsDraw:function(chart,args){if(!showUp||args.index<3)return;var ctx=chart.ctx,meta=chart.getDatasetMeta(args.index);ctx.save();ctx.shadowColor='rgba(240,184,0,.85)';ctx.shadowBlur=16;meta.data.forEach(function(b){if(b.height&&b.height>0){ctx.fillStyle=UC;ctx.fillRect(b.x-b.width/2,b.y,b.width,b.height);}});ctx.restore();}};
const TTP=cb=>({backgroundColor:'#1c2128',borderColor:'#30363d',borderWidth:1,titleColor:'#8b949e',bodyColor:'#e6edf3',padding:10,callbacks:{label:cb}});
const SXY={x:{ticks:{color:'#8b949e',font:{size:10}},grid:{color:'rgba(48,54,61,.5)'}},y:{ticks:{color:'#8b949e',font:{size:10},callback:v=>v===0?'0':(v/10000).toLocaleString('ko-KR')+'만'},grid:{color:'rgba(48,54,61,.4)'}}};
const BASE={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}};
function legHtml(pairs){return pairs.map(function(p){return '<div class="li"><div class="ld" style="background:'+p.c+'"></div>'+p.t+'</div>';}).join('');}
function qLeg(){return [{t:'연간',c:QC[0]}].concat(QS.map(function(q,i){return {t:q.lbl,c:QC[i+1]};}));}
function init(){
  buildBPills();
  ch6=new Chart(document.getElementById('c6'),{type:'bar',data:{labels:[],datasets:[]},options:Object.assign({},BASE,{layout:{padding:{top:36}},scales:{x:{ticks:{color:'#8b949e',font:{size:11}},grid:{color:'rgba(48,54,61,.4)'},stacked:true},y:{ticks:{color:'#8b949e',font:{size:10},callback:v=>v===0?'0':(v/10000).toLocaleString('ko-KR')+'만'},grid:{color:'rgba(48,54,61,.4)'},stacked:true}},plugins:Object.assign({},BASE.plugins,{tooltip:TTP(ctx=>' '+ctx.dataset.label+': '+fmt(ctx.parsed.y))})}),plugins:[stkPlugin]});
  ch1=new Chart(document.getElementById('c1'),{type:'bar',data:{labels:[],datasets:[]},options:Object.assign({},BASE,{scales:SXY,plugins:Object.assign({},BASE.plugins,{tooltip:Object.assign({},TTP(ctx=>' '+ctx.dataset.label+': '+fmt(ctx.parsed.y)),{filter:item=>item.parsed.y>0})})}),plugins:[glowPlugin]});
  ch2=new Chart(document.getElementById('c2'),{type:'bar',data:{labels:[],datasets:[]},options:Object.assign({},BASE,{indexAxis:'y',scales:{x:{ticks:{color:'#8b949e',font:{size:10},callback:v=>(v*100).toFixed(0)+'%'},grid:{color:'rgba(48,54,61,.5)'},min:0,max:1.1},y:{ticks:{color:'#8b949e',font:{size:10}},grid:{display:false}}},plugins:Object.assign({},BASE.plugins,{tooltip:TTP(ctx=>' '+ctx.dataset.label+': '+pct(ctx.raw))})})});
  ch3=new Chart(document.getElementById('c3'),{type:'bar',data:{labels:[],datasets:[]},options:Object.assign({},BASE,{scales:SXY,plugins:Object.assign({},BASE.plugins,{tooltip:TTP(ctx=>' '+ctx.dataset.label+': '+fmt(ctx.parsed.y))})})});
  ch5=new Chart(document.getElementById('c5'),{type:'bar',data:{labels:[],datasets:[]},options:Object.assign({},BASE,{layout:{padding:{top:22}},scales:SXY,plugins:Object.assign({},BASE.plugins,{tooltip:TTP(ctx=>' '+ctx.dataset.label+': '+fmt(ctx.parsed.y))})}),plugins:[pctPlugin]});
  document.getElementById('leg2').innerHTML=legHtml(qLeg());
  document.getElementById('leg3').innerHTML=legHtml(qLeg());
  document.getElementById('leg5').innerHTML=legHtml(qLeg());
  updateAll();
}
function buildBPills(){
  var el=document.getElementById('bPills');el.innerHTML='';
  var add=function(lbl,val,cls){var b=document.createElement('button');b.className='pill'+(cls?' '+cls:'')+(selB===val?' active':'');b.innerHTML=lbl;b.onclick=function(){selB=val;selC='ALL';buildBPills();updateAll();};el.appendChild(b);};
  add('전체','ALL','');
  BRANDS.forEach(function(br){var v=r26Br(br),bgt=BD[br].b,r=bgt>0?v/bgt:null;var rl=r==null?'<span class="badge bn">N/A</span>':r<.5?'<span class="badge br">'+(r*100).toFixed(0)+'%</span>':'<span class="badge bg">'+(r*100).toFixed(0)+'%</span>';add(br+' '+rl,br,isBad(br)?'bad':'');});
}
function buildCPills(comps){
  var row=document.getElementById('cRow'),el=document.getElementById('cPills');
  if(selB==='ALL'){row.style.display='none';return;}
  row.style.display='flex';el.innerHTML='';
  ['ALL'].concat(comps.map(function(c){return c.name;})).forEach(function(n,i){var b=document.createElement('button');b.className='pill'+(selC===n?' active':'');b.textContent=i===0?'전체':n;b.onclick=function(){selC=n;buildCPills(comps);updateAll();};el.appendChild(b);});
}
function updateAll(){
  var comps=selB==='ALL'?COMPS:COMPS.filter(function(c){return c.brand===selB;});
  buildCPills(comps);
  var data=selC==='ALL'?comps:comps.filter(function(c){return c.name===selC;});
  updateKPI(data);updateC6(data);updateC1(data);updateC2(data);updateC3(data);updateC5(data);updateTable(data);
  document.getElementById('crumb').textContent=selB==='ALL'?'전체 브랜드':selB+(selC!=='ALL'?' > '+selC:'');
}
function scopeObj(data){
  if(selB==='ALL'&&selC==='ALL')return Object.assign({},TOTAL,{_up:showUp?UNPAID_TOTAL:0});
  if(selB!=='ALL'&&selC==='ALL')return Object.assign({},BD[selB],{_up:showUp?UNPAID[selB]||0:0});
  var c=data[0]||{};return Object.assign({r25:0,b:0,q2b:0,q3b:0,q4b:0,r26:0},c,{_up:0});
}
function updateKPI(data){
  var o=scopeObj(data);
  var r26eff=(o.r26||0)+(o._up||0);
  var rate=o.b>0?r26eff/o.b:null;
  var lq=o[LASTQ.k]||0,lqr=lq>0?r26eff/lq:null;
  var rc=r=>r==null?'#8b949e':r>=.5?'#3fb950':'#f85149';
  var pf=r=>r==null?0:Math.min(r,1)*100;
  var yoy=o.r25>0?((o.b-o.r25)/o.r25*100).toFixed(1):null;
  var isUp=showUp&&(o._up||0)>0;
  document.getElementById('kpiRow').innerHTML=
    '<div class="kpi" style="--ac:#58a6ff"><div class="klbl">2025 총 실적</div><div class="kval cb">'+fmt(o.r25)+'</div><div class="ksub">'+(yoy?'예산 YoY '+(yoy>0?'+':'')+yoy+'%':'')+'</div></div>'+
    '<div class="kpi" style="--ac:#388bfd"><div class="klbl">2026 연간예산</div><div class="kval cw2">'+fmt(o.b)+'</div></div>'+
    '<div class="kpi" style="--ac:#d29922"><div class="klbl">'+LASTQ.lbl+' 예산</div><div class="kval cy">'+fmt(lq)+'</div><div class="ksub">'+(lq&&o.b?'연간대비 '+((lq-o.b)/o.b*100).toFixed(1)+'%':'미편성')+'</div></div>'+
    '<div class="kpi" style="--ac:'+(isUp?'#f0b800':'#3fb950')+'"><div class="klbl">2026 실적'+(isUp?' <span style="color:#f0c050;font-size:9px">&#x2605;미발행포함</span>':'')+'</div><div class="kval" style="color:'+(isUp?'#f0c050':'#3fb950')+'">'+fmt(r26eff)+'</div><div class="ksub">'+(isUp?'발행 '+fmt(o.r26)+' + 미발행 '+fmt(o._up):'잔여 '+fmt(Math.max(o.b-r26eff,0)))+'</div></div>'+
    '<div class="kpi" style="--ac:'+rc(rate)+'"><div class="klbl">연간 달성률</div><div class="kval" style="color:'+rc(rate)+'">'+pct(rate)+'</div><div class="pb"><div class="pbf" style="width:'+pf(rate)+'%;background:'+rc(rate)+'"></div></div></div>'+
    '<div class="kpi" style="--ac:'+rc(lqr)+'"><div class="klbl">'+LASTQ.lbl+' 달성률</div><div class="kval" style="color:'+rc(lqr)+'">'+pct(lqr)+'</div><div class="pb"><div class="pbf" style="width:'+pf(lqr)+'%;background:'+rc(lqr)+'"></div></div></div>';
}
function updateC6(data){
  var labels=['연간예산'].concat(QS.map(function(q){return q.lbl+'예산';}));
  var ds,title;
  if(selB==='ALL'){ds=BRANDS.map(function(b){return {label:b,data:[BD[b].b||0].concat(QS.map(function(q){return BD[b][q.k]||0;})),backgroundColor:BC[b],borderRadius:3,stack:'s',maxBarThickness:55};});title='전체 예산 구성 변화 (브랜드별)';}
  else{var it=data.filter(function(c){return c.b>0||QS.some(function(q){return c[q.k]>0;});});ds=it.map(function(c,i){return {label:c.name,data:[c.b||0].concat(QS.map(function(q){return c[q.k]||0;})),backgroundColor:CC[i%CC.length],borderRadius:3,stack:'s',maxBarThickness:55};});title=selB+' 예산 구성 변화';}
  document.getElementById('t6').textContent=title;ch6.data.labels=labels;ch6.data.datasets=ds;ch6.update();
  document.getElementById('leg6').innerHTML=legHtml(ds.map(function(d){return {t:d.label,c:d.backgroundColor};}));
}
function updateC1(data){
  var labels,d25,dB,dR,dU,colors;
  var colorOf=function(r26,b){var r=b>0?r26/b:null;return r==null?'rgba(110,118,129,.6)':r>=.5?'rgba(63,185,80,.75)':'rgba(248,81,73,.75)';};
  if(selB==='ALL'){labels=BRANDS;d25=BRANDS.map(function(b){return BD[b].r25;});dB=BRANDS.map(function(b){return BD[b].b;});dR=BRANDS.map(function(b){return BD[b].r26;});dU=BRANDS.map(function(b){return showUp?UNPAID[b]||0:0;});colors=BRANDS.map(function(b){return colorOf(BD[b].r26,BD[b].b);});document.getElementById('t1').textContent='브랜드별 실적 비교';}
  else{labels=data.map(function(c){return c.name;});d25=data.map(function(c){return c.r25;});dB=data.map(function(c){return c.b;});dR=data.map(function(c){return c.r26;});dU=data.map(function(){return 0;});colors=data.map(function(c){return colorOf(c.r26,c.b);});document.getElementById('t1').textContent=selB+' 업체별 실적';}
  ch1.data.labels=labels;
  ch1.data.datasets=[
    {label:'2025 실적',data:d25,backgroundColor:'rgba(110,118,129,.55)',borderRadius:3,categoryPercentage:.42,barPercentage:.75,maxBarThickness:26},
    {label:'2026 연간예산',data:dB,backgroundColor:'rgba(56,139,253,.45)',borderRadius:3,categoryPercentage:.42,barPercentage:.75,maxBarThickness:26},
    {label:'발행 실적',data:dR,backgroundColor:colors,borderRadius:[3,3,0,0],stack:'act',categoryPercentage:.42,barPercentage:.75,maxBarThickness:26},
    {label:'미발행',data:dU,backgroundColor:UC,borderRadius:[3,3,0,0],stack:'act',borderWidth:0,categoryPercentage:.42,barPercentage:.75,maxBarThickness:26}
  ];ch1.update();
}
function rateSet(entity){var o={ann:entity.b>0?entity.r26/entity.b:null};QS.forEach(function(q){o[q.k]=entity[q.k]>0?entity.r26/entity[q.k]:null;});return o;}
function updateC2(data){
  var items;
  if(selB==='ALL'){items=BRANDS.map(function(b){var v=r26Br(b);var e=Object.assign({},BD[b],{r26:v});var rs=rateSet(e);return Object.assign({name:b},rs);});document.getElementById('t2').textContent='브랜드별 달성률 비교';}
  else{items=data.filter(function(c){return c.b>0||c.r26>0;}).map(function(c){var rs=rateSet(c);return Object.assign({name:c.name},rs);});document.getElementById('t2').textContent=selB+' 업체별 달성률';}
  items.sort(function(a,b){return (b.ann!=null?b.ann:-1)-(a.ann!=null?a.ann:-1);});
  var allR=[];items.forEach(function(i){allR.push(i.ann||0);QS.forEach(function(q){allR.push(i[q.k]||0);});});
  var ax=Math.min(Math.max(Math.max.apply(null,allR.concat([0]))*1.1,.15),2.5);
  var cap=function(r){return r==null?0:Math.min(r,ax);};
  document.getElementById('c2').parentElement.style.height=Math.max(180,items.length*38)+'px';
  ch2.data.labels=items.map(function(i){return i.name;});
  var dss=[{label:'연간',data:items.map(function(i){return cap(i.ann);}),backgroundColor:QC[0],categoryPercentage:.5,barPercentage:.8,borderRadius:3,_key:'ann'}];
  QS.forEach(function(q,qi){dss.push({label:q.s,data:items.map(function(i){return cap(i[q.k]);}),backgroundColor:QC[qi+1],categoryPercentage:.5,barPercentage:.8,borderRadius:3,_key:q.k});});
  ch2.data.datasets=dss;
  ch2.options.scales.x.max=ax;
  ch2.options.plugins.legend={display:true,labels:{color:'#8b949e',font:{size:10},boxWidth:8,padding:8}};
  ch2.options.plugins.tooltip.callbacks.label=function(ctx){var k=ctx.dataset._key;return ' '+ctx.dataset.label+': '+pct(items[ctx.dataIndex][k]);};
  ch2.update();
}
function budgetChart(chart,data,tid,title){
  var labels,series;
  if(selB==='ALL'){labels=BRANDS;series=function(key){return BRANDS.map(function(b){return BD[b][key];});};}
  else{labels=data.map(function(c){return c.name;});series=function(key){return data.map(function(c){return c[key];});};}
  chart.data.labels=labels;
  var dss=[{label:'연간',data:series('b'),backgroundColor:QC[0],borderRadius:3,categoryPercentage:.42,barPercentage:.75,maxBarThickness:26}];
  QS.forEach(function(q,qi){dss.push({label:q.lbl,data:series(q.k),backgroundColor:QC[qi+1],borderRadius:3,categoryPercentage:.42,barPercentage:.75,maxBarThickness:26});});
  chart.data.datasets=dss;chart.update();
  if(tid)document.getElementById(tid).textContent=title;
}
function updateC3(data){budgetChart(ch3,data,'t3',selB==='ALL'?'브랜드별 예산 변화':selB+' 예산 변화');}
function updateC5(data){
  var d=selB==='ALL'?null:data.filter(function(c){return c.b>0||QS.some(function(q){return c[q.k]>0;});});
  budgetChart(ch5,d||data,'t5',selB==='ALL'?'브랜드별 분기 예산 변화':selB+' 분기 예산 변화');
}
function bTag(b,q){if(!b||!q)return'<span class="tag tag-eq">-</span>';var d=((q-b)/b*100).toFixed(0);if(Math.abs(d)<1)return'<span class="tag tag-eq">0%</span>';return d>0?'<span class="tag tag-up">+'+d+'%</span>':'<span class="tag tag-dn">'+d+'%</span>';}
function updateTable(data){
  var rows;
  if(selB==='ALL'){rows=BRANDS.map(function(b){var v=r26Br(b);var e=Object.assign({},BD[b],{r26:v});var rs=rateSet(e);return Object.assign({n:b,b:BD[b].b,r26:v},BD[b],{rate:rs.ann},qmap(rs));});document.getElementById('t4').textContent='브랜드별 요약';}
  else{rows=data.map(function(c){var rs=rateSet(c);return Object.assign({n:c.name,b:c.b,r26:c.r26},c,{rate:rs.ann},qmap(rs));});document.getElementById('t4').textContent=selB+' 업체 상세';}
  var h='<table class="tbl"><thead><tr><th>이름</th><th class="n">연간예산</th>';
  QS.forEach(function(q){h+='<th class="n">'+q.s+'</th><th></th>';});
  h+='<th class="n">실적</th><th class="rc">연간%</th>';
  QS.forEach(function(q){h+='<th class="rc">'+q.s+'%</th>';});
  h+='</tr></thead><tbody>';
  rows.forEach(function(r){
    var lo=r.rate!==null&&r.rate<.5;
    h+='<tr class="'+(lo?'br-row':'')+'"><td class="nm" title="'+r.n+'">'+r.n+'</td><td class="n">'+fmt(r.b)+'</td>';
    QS.forEach(function(q){h+='<td class="n">'+fmt(r[q.k])+'</td><td>'+bTag(r.b,r[q.k])+'</td>';});
    h+='<td class="nw">'+fmt(r.r26)+'</td><td class="rc '+rCls(r.rate)+'">'+pct(r.rate)+'</td>';
    QS.forEach(function(q){var rr=r['rate_'+q.k];h+='<td class="rc '+rCls(rr)+'">'+pct(rr)+'</td>';});
    h+='</tr>';
  });
  h+='</tbody></table>';document.getElementById('tbox').innerHTML=h;
}
function qmap(rs){var o={};QS.forEach(function(q){o['rate_'+q.k]=rs[q.k];});return o;}
window.addEventListener('DOMContentLoaded',init);

</script>
</body>
</html>
`;
}
