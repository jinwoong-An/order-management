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

export async function buildSubmissionHtml(title) {
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

  const budgets = {};
  ITEM_CODES.forEach((code) => {
    const m = metrics.find((x) => Number(x.year) === YEAR && x.item === code);
    budgets[code] = {
      annBud: m ? num(m.budget) : 0,
      qBud: m ? (num(m.q3_new_budget) || num(m.q2_new_budget) || num(m.budget)) : 0,
    };
  });

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

  const monthlyPlans = {};
  for (const p of plans) if (Number(p.year) === YEAR) monthlyPlans[Number(p.month)] = p.text || "";

  const monthsSet = results.map((r) => r.mo).concat(Object.keys(monthlyPlans).map(Number)).filter(Boolean);
  const maxMonth = monthsSet.length ? Math.max(...monthsSet) : 12;

  const safeTitle = title && title.trim() ? title.trim() : `${YEAR} JWA 실적 보고`;
  const generatedAt = new Date().toLocaleString("ko-KR");
  const payload = { title: safeTitle, generatedAt, year: YEAR, prevYear: PREV, items: ITEMS, budgets, prevByItem, results, pipeline, orderForecasts, monthlyPlans, maxMonth };

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
    <div class="kpi"><div class="kpi-lbl">3분기 예산</div><div class="kpi-val" id="k-q-bud">-</div><div class="kpi-sub">3분기 목표</div></div>
    <div class="kpi"><div class="kpi-lbl">3분기 달성률</div><div class="kpi-val" id="k-q-ach">-</div><div class="kpi-sub">3분기 예산 대비</div></div>
  </div>
  <div class="notice" id="notice" style="display:none"></div>
  <div class="filters">
    <div class="fg"><span class="fl">제품군</span><span id="prodFilters"></span></div>
    <div class="fg"><span class="fl">업체</span><select class="fs" id="vsel" onchange="sf('vendor',this.value)"><option value="all">전체 업체</option></select></div>
    <div class="fg"><span class="fl">월</span><span id="monthFilters"></span></div>
  </div>
  <div class="afd" id="afd">필터: <span>전체</span></div>
  <div class="grid">
    <div class="card"><div class="ctitle">&#128230; 브랜드별 실적 · 연간예산 · 3분기예산 <span class="wtag">부진=빨강</span><button class="tgl" id="togPending" onclick="togglePending(this)">＋ 미발행 포함</button></div><div class="h155"><canvas id="cBrand"></canvas></div></div>
    <div class="card"><div class="ctitle">&#127919; 달성률 (연간 vs 3분기) <span class="wtag">60% 미만 부진</span></div><div class="h190"><canvas id="cAch"></canvas></div></div>
    <div class="card fw"><div class="ctitle">&#128202; 브랜드별 월별 매출 추이 (단위: 원)</div><div class="h200"><canvas id="cBrandMonth"></canvas></div></div>
    <div class="card fw"><div class="ctitle">&#128200; 월별 총 매출 &amp; 누계 (단위: 원)</div><div class="h155"><canvas id="cMonth"></canvas></div></div>
    <div class="card"><div class="ctitle">&#129383; 제품군별 매출 비중</div><div class="h190"><canvas id="cProd"></canvas></div></div>
    <div class="card"><div class="ctitle">&#127942; 업체별 매출 순위 Top 10</div><div class="h230"><canvas id="cVend"></canvas></div></div>
  </div>
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
(DATA.pipeline||[]).forEach(function(p){(p.items||[]).forEach(function(it){pendByCode[it.c]=(pendByCode[it.c]||0)+(it.amt||0);});});
var pendTotal=Object.keys(pendByCode).reduce(function(a,k){return a+pendByCode[k];},0);
var showPending=false;
function togglePending(btn){showPending=!showPending;btn.classList.toggle('on',showPending);btn.textContent=showPending?'－ 미발행 숨기기':'＋ 미발행 포함';upBrand();}

var F={product:'all',vendor:'all',month:'all'};
function inScope(v){return F.product==='all'?v.items:(v.items.indexOf(F.product)>=0?[F.product]:[]);}
function vAmt(v){var codes=inScope(v),s=0;for(var i=0;i<codes.length;i++){var arr=v.im[codes[i]]||[];if(F.month==='all'){for(var k=0;k<arr.length;k++)s+=arr[k];}else{s+=arr[+F.month]||0;}}return s;}
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
    {label:'3분기예산',data:[],backgroundColor:'rgba(188,140,255,.12)',borderColor:'rgba(188,140,255,.5)',borderWidth:1,borderRadius:2,barPercentage:.7,stack:'qb'}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+fmtT(c.raw);},footer:function(items){if(!showPending)return'';var s=0;items.forEach(function(i){if(i.dataset.stack==='sales')s+=i.raw;});return '총 발주: '+fmtT(s);}}}},scales:{x:{stacked:true,grid:{color:'#21262d'}},y:{stacked:true,ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  ch2=new Chart(document.getElementById('cAch'),{type:'bar',data:{labels:[],datasets:[{label:'연간 달성률',data:[],backgroundColor:[],borderRadius:3,barPercentage:.42},{label:'3분기 달성률',data:[],backgroundColor:[],borderRadius:3,barPercentage:.42}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+(c.raw*100).toFixed(1)+'%';}}}},scales:{x:{min:0,max:1.3,ticks:{callback:function(v){return(v*100).toFixed(0)+'%';}},grid:{color:'#21262d'}}}}});
  ch3=new Chart(document.getElementById('cBrandMonth'),{type:'bar',data:{labels:mlabels,datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+fmtT(c.raw);}}}},scales:{x:{stacked:true,grid:{color:'#21262d'}},y:{stacked:true,ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  ch4=new Chart(document.getElementById('cMonth'),{type:'bar',data:{labels:mlabels,datasets:[{label:'월 실적',data:[],backgroundColor:'rgba(88,166,255,.6)',borderRadius:3,barPercentage:.5},{label:'누계',type:'line',data:[],borderColor:'#3fb950',backgroundColor:'rgba(63,185,80,.07)',fill:true,tension:.35,pointRadius:3,borderWidth:1.5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:10,padding:8}},tooltip:{callbacks:{label:function(c){return' '+c.dataset.label+': '+fmtT(c.raw);}}}},scales:{x:{grid:{color:'#21262d'}},y:{ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  ch5=new Chart(document.getElementById('cProd'),{type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderColor:'#0d1117',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'right',labels:{boxWidth:10,padding:7}},tooltip:{callbacks:{label:function(c){var s=c.chart.data.datasets[0].data.reduce(function(a,b){return a+b;},0);return' '+c.label+': '+fmtT(c.raw)+' ('+((c.raw/s)*100).toFixed(1)+'%)';}}}}}});
  ch6=new Chart(document.getElementById('cVend'),{type:'bar',data:{labels:[],datasets:[{label:'매출',data:[],backgroundColor:[],borderRadius:3,barPercentage:.55}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return' '+fmtT(c.raw);}}}},scales:{x:{ticks:{callback:function(v){return fmtA(v);}},grid:{color:'#21262d'}}}}});
  upAll();
}
function upKPI(){var fvd=fv();var ytd=fvd.reduce(function(s,v){return s+vAmt(v);},0);var scope=F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;});var annBud=0,qBud=0,r=0;scope.forEach(function(b){annBud+=b.annBud;qBud+=b.qBud;r+=b.curTotal;});var aA=annBud>0?r/annBud:0,qA=qBud>0?r/qBud:0;document.getElementById('k-ytd').textContent=fmtT(ytd);document.getElementById('k-ann-bud').textContent=fmtT(annBud);document.getElementById('k-q-bud').textContent=fmtT(qBud);var ka=document.getElementById('k-ann-ach');ka.textContent=(aA*100).toFixed(1)+'%';ka.className='kpi-val '+(aA>=.8?'cg':aA>=.6?'cw':'cr');var kq=document.getElementById('k-q-ach');kq.textContent=(qA*100).toFixed(1)+'%';kq.className='kpi-val '+(qA>=.8?'cg':qA>=.6?'cw':'cr');}
function upBrand(){var bd=F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;});ch1.data.labels=bd.map(function(b){return b.name;});ch1.data.datasets[0].data=bd.map(function(b){return b.curTotal;});ch1.data.datasets[0].backgroundColor=bd.map(function(b){return poor(b)?'rgba(248,81,73,.8)':'rgba(63,185,80,.8)';});ch1.data.datasets[1].data=bd.map(function(b){return pendByCode[b.code]||0;});ch1.data.datasets[1].hidden=!showPending;ch1.data.datasets[2].data=bd.map(function(b){return b.annBud;});ch1.data.datasets[3].data=bd.map(function(b){return b.qBud;});ch1.update();}
function upAch(){var bd=(F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;})).filter(function(b){return b.annRate!==null;});ch2.data.labels=bd.map(function(b){return b.name;});ch2.data.datasets[0].data=bd.map(function(b){return b.annRate;});ch2.data.datasets[0].backgroundColor=bd.map(function(b){return achC(b.annRate);});ch2.data.datasets[1].data=bd.map(function(b){return b.qRate||0;});ch2.data.datasets[1].backgroundColor=bd.map(function(b){var c=achC(b.qRate);return c.charAt(0)==='#'?c+'99':c;});ch2.update();}
function upBrandMonth(){var bd=F.product==='all'?brands:brands.filter(function(b){return b.code===F.product;});ch3.data.datasets=bd.map(function(b){var d=b.cur.slice();if(F.month!=='all'){d=d.map(function(v,i){return i===+F.month?v:0;});}return{label:b.name,data:d,backgroundColor:(PCOL[b.code]||'#8b949e'),borderRadius:2,barPercentage:.6,stack:'s'};});ch3.update();}
function upMonth(){var fvd=fv();var plot=[],cum=[],c=0;for(var i=0;i<MAXM;i++){var val=0;fvd.forEach(function(v){var codes=inScope(v);codes.forEach(function(cd){val+=(v.im[cd]||[])[i]||0;});});if(F.month!=='all'&&+F.month!==i)val=0;plot.push(val);var real=0;fvd.forEach(function(v){var codes=inScope(v);codes.forEach(function(cd){real+=(v.im[cd]||[])[i]||0;});});c+=real;cum.push(c);}ch4.data.datasets[0].data=plot;ch4.data.datasets[1].data=cum;ch4.update();}
function upProd(){var fvd=fv();var pt={};fvd.forEach(function(v){var codes=inScope(v);codes.forEach(function(cd){var arr=v.im[cd]||[];var s=0;if(F.month==='all'){for(var k=0;k<arr.length;k++)s+=arr[k];}else{s=arr[+F.month]||0;}pt[cd]=(pt[cd]||0)+s;});});var codes=Object.keys(pt).filter(function(c){return pt[c]>0;}).sort(function(a,b){return pt[b]-pt[a];});ch5.data.labels=codes.map(function(c){return c+'·'+(CNAME[c]||c);});ch5.data.datasets[0].data=codes.map(function(c){return pt[c];});ch5.data.datasets[0].backgroundColor=codes.map(function(c){return PCOL[c]||'#8b949e';});ch5.update();}
function upVend(){var fvd=fv().map(function(v){return{n:v.n,items:v.items,tot:vAmt(v)};}).filter(function(v){return v.tot>0;}).sort(function(a,b){return b.tot-a.tot;}).slice(0,10);ch6.data.labels=fvd.map(function(v){return v.n+' ('+v.items.join(',')+')';});ch6.data.datasets[0].data=fvd.map(function(v){return v.tot;});ch6.data.datasets[0].backgroundColor=fvd.map(function(_,i){return vcols[i%vcols.length];});ch6.update();}
function upNotice(){var bad=brands.filter(function(b){return poor(b);}).map(function(b){return b.name+' '+(b.annRate*100).toFixed(1)+'%';});var n=document.getElementById('notice');if(bad.length){n.style.display='';n.innerHTML='&#9888;&#65039; 부진 제품군 (달성률 60% 미만) — '+bad.join(' · ');}else{n.style.display='none';}}
function upTable(){var tb=document.getElementById('itb');var html='',c=0;for(var i=0;i<MAXM;i++){var val=0;vendors.forEach(function(v){v.items.forEach(function(cd){val+=(v.im[cd]||[])[i]||0;});});c+=val;html+='<tr><td style="text-align:center">'+(i+1)+'월</td><td>'+fmtT(val)+'</td><td>'+fmtT(c)+'</td></tr>';}html+='<tr style="font-weight:700"><td style="text-align:center;color:#e6edf3">합계</td><td>'+fmtT(c)+'</td><td>'+fmtT(c)+'</td></tr>';tb.innerHTML=html;}
function upAFD(){var parts=[];if(F.product!=='all')parts.push('제품군: '+F.product+'·'+(CNAME[F.product]||''));if(F.vendor!=='all')parts.push('업체: '+F.vendor);if(F.month!=='all')parts.push((+F.month+1)+'월');document.getElementById('afd').innerHTML='필터: '+(parts.length?parts.map(function(p){return'<span>'+p+'</span>';}).join(' '):'<span>전체</span>');}
function upAll(){upKPI();upBrand();upAch();upBrandMonth();upMonth();upProd();upVend();upAFD();}
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
  // 발주 예상
  var of=DATA.orderForecasts.filter(function(f){return f.mo===mo;});
  html+='<div class="section"><div class="sec-hdr"><span>&#128230;</span><h3>'+mo+'월 발주 예상</h3><span class="cnt">'+of.length+'건</span></div><div class="sec-body">';
  if(of.length){html+='<table class="rt"><thead><tr><th style="width:130px">업체</th><th>모델</th><th style="width:110px">예상금액</th></tr></thead><tbody>';var oft=0;of.forEach(function(f){var md=f.items.map(function(it){return (it.model||'')+(it.qty?' ×'+it.qty:'');}).join(', ');html+='<tr><td>'+esc(f.cust)+'</td><td style="color:#c9d1d9">'+esc(md||'-')+'</td><td style="text-align:right">'+fmtT(f.amt)+'</td></tr>';oft+=f.amt;});html+='</tbody><tfoot><tr><td colspan="2" style="text-align:right;color:#8b949e">합계</td><td style="text-align:right;color:#3fb950">'+fmtT(oft)+'</td></tr></tfoot></table>';}else{html+='<div class="empty">직접 추가된 발주 예상이 없습니다.</div>';}
  html+='</div></div>';
  // 계산서 예상 (납기 그 달, 미계산서)
  var pe=DATA.pipeline.filter(function(p){return p.dueMo===mo;});
  html+='<div class="section"><div class="sec-hdr"><span>&#128196;</span><h3>'+mo+'월 세금계산서 예상</h3><span class="cnt">'+pe.length+'건</span></div><div class="sec-body">';
  if(pe.length){html+='<table class="rt"><thead><tr><th style="width:140px">업체</th><th>모델</th><th style="width:130px">예상금액</th></tr></thead><tbody>';var pet=0;pe.forEach(function(p){var md=p.items.map(function(it){return (it.model||'')+(it.qty?' ×'+it.qty:'');}).join(', ');html+='<tr><td>'+esc(p.cust)+'</td><td style="color:#c9d1d9">'+esc(md||'-')+'</td><td style="text-align:right">'+fmtT(p.total)+'</td></tr>';pet+=p.total;});html+='</tbody><tfoot><tr><td colspan="2" style="text-align:right;color:#8b949e">합계</td><td style="text-align:right;color:#3fb950">'+fmtT(pet)+'</td></tr></tfoot></table>';}else{html+='<div class="empty">해당 월 납기 예정(미계산서) 발주가 없습니다.</div>';}
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
