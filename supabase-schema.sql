-- 발주관리앱 - Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 1) 업무 데이터: 컬렉션별 JSON 배열 한 행씩
create table if not exists public.collections (
  name        text primary key,
  data        jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) 백업 스냅샷
create table if not exists public.backups (
  id          bigint generated always as identity primary key,
  name        text not null,
  type        text not null,
  size        integer not null default 0,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists backups_created_idx on public.backups (created_at desc);

-- 3) 보안: RLS 활성화 + 공개 정책 없음
--    => 익명(anon) 키로는 접근 불가. 서버(서비스 롤 키)만 접근합니다.
alter table public.collections enable row level security;
alter table public.backups enable row level security;

-- 4) 기본 시드 데이터 (이미 있으면 유지)
insert into public.collections (name, data) values
  ('orders', '[]'::jsonb),
  ('customerPlans', '[]'::jsonb),
  ('recurringForecasts', '[]'::jsonb),
  ('forecasts', '[]'::jsonb),
  ('monthlyPlans', '[]'::jsonb),
  ('yearlyAnalysis', '[]'::jsonb)
on conflict (name) do nothing;

insert into public.collections (name, data) values
  ('annualMetrics', '[
    {"year":2026,"item":"D","budget":660000000,"q2_new_budget":654600000,"q3_new_budget":616690000,"q4_new_budget":null,"source":"2026(2).xlsx"},
    {"year":2026,"item":"F","budget":845000000,"q2_new_budget":865000000,"q3_new_budget":835000000,"q4_new_budget":null,"source":"2026(2).xlsx"},
    {"year":2026,"item":"G","budget":126000000,"q2_new_budget":133000000,"q3_new_budget":148990000,"q4_new_budget":null,"source":"2026(2).xlsx"},
    {"year":2026,"item":"H","budget":140000000,"q2_new_budget":161000000,"q3_new_budget":241600000,"q4_new_budget":null,"source":"2026(2).xlsx"},
    {"year":2026,"item":"I","budget":10000000,"q2_new_budget":10000000,"q3_new_budget":15000000,"q4_new_budget":null,"source":"2026(2).xlsx"},
    {"year":2026,"item":"J","budget":85000000,"q2_new_budget":95000000,"q3_new_budget":75000000,"q4_new_budget":null,"source":"2026(2).xlsx"},
    {"year":2026,"item":"ETC","budget":40000000,"q2_new_budget":30000000,"q3_new_budget":5000000,"q4_new_budget":null,"source":"2026(2).xlsx"}
  ]'::jsonb)
on conflict (name) do nothing;

insert into public.collections (name, data) values
  ('planValues', '[
    {"year":2026,"item_label":"DEBEM","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"},
    {"year":2026,"item_label":"FLUIMAC","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"},
    {"year":2026,"item_label":"GRIFFCO","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"},
    {"year":2026,"item_label":"HIDRACAR","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"},
    {"year":2026,"item_label":"INJECTA","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"},
    {"year":2026,"item_label":"JESSBERGER","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"},
    {"year":2026,"item_label":"ETC","customer":"ETC","budget":null,"q2_budget":null,"q3_budget":null,"q4_budget":null,"next_budget":null,"source":"배포용 기본 구조"}
  ]'::jsonb)
on conflict (name) do nothing;
