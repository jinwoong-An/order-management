// 발주관리앱 - 기본 시드 데이터 (로컬/클라우드 공용, 서버리스 안전)
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
};

export const COLLECTION_NAMES = Object.keys(SEED);
