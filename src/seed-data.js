// 발주관리앱 - 기본 시드 데이터 (로컬/클라우드 공용, 서버리스 안전)

// ITEM별 BUDGET & 실적 (분기별) — Yearly meeting JWA-3분기.xlsx 기준
const ITEM_BUDGET_SEED = [
  { id: "ib_01", item: "DEBEM", customers: [
    { id: "ib_01_01", name: "성진세미텍", result: 7500000, budget: 8000000, q2: 9000000, q3: 15000000, q4: null, total: 9840000 },
    { id: "ib_01_02", name: "알컴코퍼레이션", result: 2200000, budget: 2500000, q2: 4000000, q3: 4000000, q4: null, total: null },
    { id: "ib_01_03", name: "디와이플랜트", result: 8110000, budget: 8000000, q2: 8000000, q3: 10000000, q4: null, total: 2880000 },
    { id: "ib_01_04", name: "남일솔루션", result: 890000, budget: 1780000, q2: 1780000, q3: 1780000, q4: null, total: null },
    { id: "ib_01_05", name: "아이티에스", result: 17520000, budget: 3000000, q2: 3000000, q3: 3000000, q4: null, total: null },
    { id: "ib_01_06", name: "코웨이엔텍", result: null, budget: 10000000, q2: 10000000, q3: 5676000, q4: null, total: null },
    { id: "ib_01_07", name: "네오팜", result: null, budget: 10000000, q2: 10000000, q3: 10000000, q4: null, total: 5680000 },
    { id: "ib_01_08", name: "우리그린사이언스", result: null, budget: 3000000, q2: 1470000, q3: 1470000, q4: null, total: 1470000 },
    { id: "ib_01_09", name: "명성펌프랜드", result: 8551800, budget: 3000000, q2: 5000000, q3: 5000000, q4: null, total: 2100000 },
    { id: "ib_01_10", name: "테이칼튼", result: null, budget: 5000000, q2: 5000000, q3: null, q4: null, total: null },
    { id: "ib_01_11", name: "조은테크", result: null, budget: 2500000, q2: 2500000, q3: 2500000, q4: null, total: 1735800 },
    { id: "ib_01_12", name: "ETC.", result: 24252000, budget: 25000000, q2: 25000000, q3: 25000000, q4: null, total: 12400000 },
  ] },
  { id: "ib_02", item: "JESSBERGER", customers: [
    { id: "ib_02_01", name: "삼진플라텍", result: 950000, budget: 6000000, q2: 6000000, q3: 6000000, q4: null, total: null },
    { id: "ib_02_02", name: "동방코스메틱", result: 58115000, budget: 1500000, q2: 2000000, q3: 2000000, q4: null, total: 1000000 },
    { id: "ib_02_03", name: "네오팜", result: null, budget: 22000000, q2: 15820000, q3: 30000000, q4: null, total: 15820000 },
    { id: "ib_02_04", name: "고려은단", result: null, budget: 3000000, q2: 3000000, q3: 3000000, q4: null, total: 3060000 },
    { id: "ib_02_05", name: "OTCM", result: null, budget: 5790000, q2: 5800000, q3: null, q4: null, total: null },
    { id: "ib_02_06", name: "ETC", result: 13668000, budget: 12000000, q2: 25000000, q3: 35000000, q4: null, total: 27345000 },
  ] },
  { id: "ib_03", item: "ACUFLOW", customers: [
    { id: "ib_03_01", name: "케이비엔지니어링", result: null, budget: 14000000, q2: 14000000, q3: null, q4: null, total: null },
    { id: "ib_03_02", name: "ETC", result: null, budget: null, q2: null, q3: null, q4: null, total: null },
  ] },
  { id: "ib_04", item: "INJECTA", customers: [
    { id: "ib_04_01", name: "이피켐텍", result: 5120000, budget: 4240000, q2: 4240000, q3: 4240000, q4: null, total: 4240000 },
    { id: "ib_04_02", name: "삼화산업", result: 3500000, budget: 4000000, q2: 4000000, q3: 4000000, q4: null, total: 1900000 },
    { id: "ib_04_03", name: "이화오토메이션", result: 740000, budget: 800000, q2: 800000, q3: 800000, q4: null, total: null },
    { id: "ib_04_04", name: "영인에스티", result: 740000, budget: 800000, q2: 800000, q3: 800000, q4: null, total: null },
    { id: "ib_04_05", name: "피지티", result: null, budget: 4680000, q2: null, q3: null, q4: null, total: null },
    { id: "ib_04_06", name: "삼진기계", result: 2800000, budget: 3000000, q2: null, q3: null, q4: null, total: null },
    { id: "ib_04_07", name: "ETC", result: 2240000, budget: 3000000, q2: 15000000, q3: 20000000, q4: null, total: 14130000 },
  ] },
  { id: "ib_05", item: "GRIFFCO", customers: [
    { id: "ib_05_01", name: "대성테크놀로지", result: 735000, budget: 3000000, q2: 3000000, q3: 3000000, q4: null, total: 1216000 },
    { id: "ib_05_02", name: "위수M&D", result: 984000, budget: 1500000, q2: 1500000, q3: 1500000, q4: null, total: 918000 },
    { id: "ib_05_03", name: "광성산업사", result: 1040000, budget: 700000, q2: 700000, q3: 700000, q4: null, total: null },
    { id: "ib_05_04", name: "ETC", result: 12167000, budget: 5000000, q2: 5000000, q3: 10000000, q4: null, total: 2900000 },
  ] },
  { id: "ib_06", item: "BLACOH", customers: [
    { id: "ib_06_01", name: "엘에스아이솔루션", result: 4540000, budget: null, q2: null, q3: null, q4: null, total: null },
  ] },
  { id: "ib_07", item: "HIDRACAR", customers: [
    { id: "ib_07_01", name: "조은테크", result: 920000, budget: 1000000, q2: 1000000, q3: 1500000, q4: null, total: 340000 },
    { id: "ib_07_02", name: "대연", result: null, budget: 30000000, q2: 0, q3: null, q4: null, total: null },
    { id: "ib_07_03", name: "ETC", result: 22450000, budget: null, q2: 30000000, q3: 10000000, q4: null, total: 1580000 },
  ] },
];

export const SEED = {
  orders: [],
  annualMetrics: [
    { year: 2026, item: "D", budget: 660000000, q2_new_budget: 654600000, q3_new_budget: 616690000, q4_new_budget: null, source: "2026(2).xlsx" },
    { year: 2026, item: "F", budget: 845000000, q2_new_budget: 865000000, q3_new_budget: 835000000, q4_new_budget: null, source: "2026(2).xlsx" },
    { year: 2026, item: "G", budget: 126000000, q2_new_budget: 133000000, q3_new_budget: 148990000, q4_new_budget: null, source: "2026(2).xlsx" },
    { year: 2026, item: "H", budget: 140000000, q2_new_budget: 161000000, q3_new_budget: 241600000, q4_new_budget: null, source: "2026(2).xlsx" },
    { year: 2026, item: "I", budget: 10000000, q2_new_budget: 10000000, q3_new_budget: 15000000, q4_new_budget: null, source: "2026(2).xlsx" },
    { year: 2026, item: "J", budget: 85000000, q2_new_budget: 95000000, q3_new_budget: 75000000, q4_new_budget: null, source: "2026(2).xlsx" },
    { year: 2026, item: "ETC", budget: 40000000, q2_new_budget: 30000000, q3_new_budget: 5000000, q4_new_budget: null, source: "2026(2).xlsx" },
  ],
  planValues: [
    { year: 2026, item_label: "DEBEM", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
    { year: 2026, item_label: "FLUIMAC", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
    { year: 2026, item_label: "GRIFFCO", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
    { year: 2026, item_label: "HIDRACAR", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
    { year: 2026, item_label: "INJECTA", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
    { year: 2026, item_label: "JESSBERGER", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
    { year: 2026, item_label: "ETC", customer: "ETC", budget: null, q2_budget: null, q3_budget: null, q4_budget: null, next_budget: null, source: "배포용 기본 구조" },
  ],
  customerPlans: [],
  recurringForecasts: [],
  forecasts: [],
  monthlyPlans: [],
  yearlyAnalysis: [],
  events: [],
  todos: [],
  itemBudgets: ITEM_BUDGET_SEED,
};

export const COLLECTION_NAMES = Object.keys(SEED);
