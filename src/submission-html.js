// 발주관리앱 - 제출용(오프라인 읽기전용) HTML 생성
// 현재 데이터를 하나의 HTML 파일로 고정합니다. PC/서버가 없어도 더블클릭으로 열립니다.
import { snapshot, ITEMS } from "./db.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export async function buildSubmissionHtml(title) {
  const snap = await snapshot();
  const safeTitle = title && title.trim() ? title.trim() : "발주관리앱 제출본";
  const generatedAt = new Date().toLocaleString("ko-KR");
  const payload = {
    title: safeTitle,
    generatedAt,
    items: ITEMS,
    orders: snap.collections.orders || [],
    annualMetrics: snap.collections.annualMetrics || [],
    planValues: snap.collections.planValues || [],
  };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(safeTitle)}</title>
<style>
:root{--bg:#f4f6fb;--panel:#fff;--ink:#1e2740;--muted:#68718c;--line:#e6e9f2;--brand:#5565f2;--teal:#12b3a6;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Segoe UI','Malgun Gothic',sans-serif;padding:28px;}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:0}
.sub{color:var(--muted);font-size:13px;margin:0 0 20px}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px}
select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:14px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;cursor:pointer;font-size:13px}
.chip.active{background:var(--brand);color:#fff;border-color:var(--brand)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.kpi span{color:var(--muted);font-size:12px;display:block}
.kpi strong{font-size:20px;display:block;margin-top:6px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:18px}
.panel-head{margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}
th.n,td.n{text-align:right}
thead th{color:var(--muted);font-weight:600;font-size:12px}
.bar-row{display:flex;align-items:center;gap:10px;margin:4px 0}
.bar-row .lbl{width:44px;color:var(--muted);font-size:12px}
.bar{height:16px;border-radius:5px}
.bar.o{background:#a9b4ff}
.bar.i{background:var(--teal)}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-bottom:8px}
.legend b{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:middle;margin-right:4px}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
</style>
</head>
<body>
<h1>${esc(safeTitle)}</h1>
<p class="sub">생성 시각: ${esc(generatedAt)} · 읽기 전용 제출본</p>
<div class="controls">
  <label>연도 <select id="yearSel"></select></label>
  <div class="chips" id="monthChips"></div>
</div>
<div class="kpis" id="kpis"></div>
<div class="panel">
  <div class="panel-head"><h2>월별 발주 · 세금계산서 금액</h2></div>
  <div class="legend"><span><b style="background:#a9b4ff"></b>발주 금액</span><span><b style="background:#12b3a6"></b>세금계산서 금액</span></div>
  <div id="monthlyChart"></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>ITEM별 실적 (세금계산서 기준)</h2></div>
  <table><thead><tr><th>ITEM</th><th class="n">거래처수</th><th class="n">올해 BUDGET</th><th class="n">TOTAL 금액</th><th class="n">달성율</th></tr></thead><tbody id="itemBody"></tbody></table>
</div>
<div class="panel">
  <div class="panel-head"><h2>거래처별 세금계산서 (선택 연도)</h2></div>
  <table><thead><tr><th>거래처</th><th class="n">건수</th><th class="n">금액</th></tr></thead><tbody id="custBody"></tbody></table>
</div>
<div class="panel">
  <div class="panel-head"><h2 id="monthTitle">월 결과 (세금계산서 발행일 기준)</h2></div>
  <table><thead><tr><th>거래처</th><th>ITEM</th><th>모델 · 수량</th><th class="n">ITEM 합계</th></tr></thead><tbody id="resultBody"></tbody></table>
</div>
<p class="foot">발주관리앱 · 제출 시점 데이터로 고정된 오프라인 파일입니다.</p>
<script id="data" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>
<script>
const DATA = JSON.parse(document.getElementById("data").textContent);
const ITEM_CODES = DATA.items.map(i=>i.code);
const won = n => new Intl.NumberFormat("ko-KR").format(Math.round(n||0));
const num = v => { if(v==null||v==="")return 0; const n=Number(String(v).replace(/[^\\d.-]/g,"")); return isFinite(n)?n:0; };
const total = o => { const a=num(o.amount); if(a)return a; return (o.items||[]).reduce((s,i)=>s+num(i.amount),0); };
const iy = o => o.invoiceDate?Number(String(o.invoiceDate).slice(0,4)):null;
const im = o => o.invoiceDate?Number(String(o.invoiceDate).slice(5,7)):null;
const oy = o => o.orderDate?Number(String(o.orderDate).slice(0,4)):null;
const om = o => o.orderDate?Number(String(o.orderDate).slice(5,7)):null;

let state = { year: null, month: 0 };

function years(){
  const s=new Set();
  DATA.orders.forEach(o=>{ if(oy(o))s.add(oy(o)); if(iy(o))s.add(iy(o)); });
  DATA.annualMetrics.forEach(m=>s.add(Number(m.year)));
  s.add(new Date().getFullYear());
  return [...s].filter(Boolean).sort((a,b)=>b-a);
}

function render(){
  const y=state.year;
  const yearOrders=DATA.orders.filter(o=>oy(o)===y);
  const invOrders=DATA.orders.filter(o=>iy(o)===y);
  const orderAmt=yearOrders.reduce((s,o)=>s+total(o),0);
  const invAmt=invOrders.reduce((s,o)=>s+total(o),0);
  document.getElementById("kpis").innerHTML=[
    ["발주 건수",yearOrders.length+"건"],["발주 금액",won(orderAmt)],
    ["세금계산서 금액",won(invAmt)],["세금계산서 건수",invOrders.length+"건"]
  ].map(([k,v])=>'<div class="kpi"><span>'+k+'</span><strong>'+v+'</strong></div>').join("");

  // 월별 차트
  const mo=Array.from({length:12},()=>({o:0,i:0}));
  DATA.orders.forEach(o=>{ if(oy(o)===y&&om(o))mo[om(o)-1].o+=total(o); if(iy(o)===y&&im(o))mo[im(o)-1].i+=total(o); });
  const max=Math.max(1,...mo.flatMap(m=>[m.o,m.i]));
  document.getElementById("monthlyChart").innerHTML=mo.map((m,idx)=>
    '<div class="bar-row"><span class="lbl">'+(idx+1)+'월</span>'+
    '<div class="bar o" style="width:'+(m.o/max*70)+'%"></div>'+
    '<div class="bar i" style="width:'+(m.i/max*70)+'%"></div>'+
    '<span style="font-size:11px;color:#68718c">'+won(m.i)+'</span></div>').join("");

  // ITEM별
  const it={}; ITEM_CODES.forEach(c=>it[c]={total:0,cust:new Set()});
  invOrders.forEach(o=>{ const items=(o.items&&o.items.length)?o.items:[{item:"ETC",amount:total(o)}];
    items.forEach(x=>{ const c=ITEM_CODES.includes(x.item)?x.item:"ETC"; it[c].total+=num(x.amount); it[c].cust.add((o.customer||"미지정").trim()); }); });
  document.getElementById("itemBody").innerHTML=ITEM_CODES.map(c=>{
    const m=DATA.annualMetrics.find(a=>Number(a.year)===y&&a.item===c);
    const budget=m?num(m.budget):0;
    const rate=budget?Math.round(it[c].total/budget*1000)/10+"%":"-";
    return '<tr><td>'+c+'</td><td class="n">'+it[c].cust.size+'</td><td class="n">'+won(budget)+'</td><td class="n">'+won(it[c].total)+'</td><td class="n">'+rate+'</td></tr>';
  }).join("");

  // 거래처별
  const cm=new Map();
  invOrders.forEach(o=>{ const n=(o.customer||"미지정").trim(); if(!cm.has(n))cm.set(n,{c:0,a:0}); const r=cm.get(n); r.c++; r.a+=total(o); });
  const custRows=[...cm.entries()].sort((a,b)=>b[1].a-a[1].a);
  document.getElementById("custBody").innerHTML=custRows.length?custRows.map(([n,r])=>
    '<tr><td>'+n+'</td><td class="n">'+r.c+'건</td><td class="n">'+won(r.a)+'</td></tr>').join(""):'<tr><td colspan="3" style="color:#68718c">데이터 없음</td></tr>';

  renderMonth();
}

function renderMonth(){
  const y=state.year, mm=state.month;
  document.getElementById("monthTitle").textContent=(mm?mm+"월":"연간")+" 결과 (세금계산서 발행일 기준)";
  const rows=DATA.orders.filter(o=>iy(o)===y&&(mm===0||im(o)===mm));
  const grp=new Map();
  rows.forEach(o=>{ const n=(o.customer||"미지정").trim();
    const items=(o.items&&o.items.length)?o.items:[{item:"ETC",model:"",quantity:"",amount:total(o)}];
    items.forEach(x=>{ const key=n+"|"+(ITEM_CODES.includes(x.item)?x.item:"ETC");
      if(!grp.has(key))grp.set(key,{cust:n,item:(ITEM_CODES.includes(x.item)?x.item:"ETC"),models:[],amt:0});
      const g=grp.get(key); if(x.model)g.models.push(x.model+(x.quantity?" ×"+x.quantity:"")); g.amt+=num(x.amount); }); });
  const list=[...grp.values()].sort((a,b)=>a.cust.localeCompare(b.cust)||b.amt-a.amt);
  document.getElementById("resultBody").innerHTML=list.length?list.map(g=>
    '<tr><td>'+g.cust+'</td><td>'+g.item+'</td><td>'+(g.models.join(", ")||"-")+'</td><td class="n">'+won(g.amt)+'</td></tr>').join(""):'<tr><td colspan="4" style="color:#68718c">데이터 없음</td></tr>';
}

function init(){
  const ys=years(); state.year=ys[0];
  const ysel=document.getElementById("yearSel");
  ysel.innerHTML=ys.map(y=>'<option value="'+y+'">'+y+'년</option>').join("");
  ysel.onchange=()=>{ state.year=Number(ysel.value); render(); };
  const chips=['<button class="chip active" data-m="0">연간</button>']
    .concat(Array.from({length:12},(_,i)=>'<button class="chip" data-m="'+(i+1)+'">'+(i+1)+'월</button>'));
  const mc=document.getElementById("monthChips");
  mc.innerHTML=chips.join("");
  mc.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{
    mc.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));
    b.classList.add("active"); state.month=Number(b.dataset.m); renderMonth();
  });
  render();
}
init();
</script>
</body>
</html>`;
}
