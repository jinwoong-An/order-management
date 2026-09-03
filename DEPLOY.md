# 발주관리앱 클라우드 배포 가이드 (Supabase + Vercel)

PC가 꺼져 있어도 인터넷만 있으면 어디서든 접속 가능한 상태로 만드는 방법입니다.
- **Vercel**: 앱(화면 + API) 호스팅 — 무료
- **Supabase**: 데이터베이스(Postgres) — 무료

준비물: GitHub 계정, Supabase 계정, Vercel 계정 (모두 무료)

---

## 1단계 — Supabase 데이터베이스 만들기

1. https://supabase.com 접속 → 로그인 → **New project**
2. 프로젝트 이름 입력, **Database Password** 설정(따로 메모), 리전은 `Northeast Asia (Seoul)` 권장 → 생성 (1~2분 소요)
3. 왼쪽 메뉴 **SQL Editor** → **New query** → 이 폴더의 **`supabase-schema.sql`** 파일 내용을 전부 붙여넣고 **Run**
   - "Success. No rows returned" 이 나오면 정상입니다. (테이블 2개 + 기본 데이터 생성)
4. 왼쪽 메뉴 **Project Settings → API** 에서 아래 2개 값을 복사해 둡니다.
   - **Project URL**  → 환경변수 `SUPABASE_URL`
   - **service_role** key (`Project API keys` 아래, "secret" 표시) → 환경변수 `SUPABASE_SERVICE_KEY`
   - ⚠️ **service_role 키는 비밀입니다.** 절대 화면 공유·깃허브·카톡 등에 올리지 마세요.

---

## 2단계 — 코드를 GitHub에 올리기

이 폴더(`발주 관리 어플`)를 GitHub 저장소로 올립니다. 터미널(PowerShell)에서:

```bash
cd "C:\Users\agh27\OneDrive\Desktop\발주 관리 어플"
git init
git add .
git commit -m "발주관리앱 초기 배포"
```

그다음 GitHub에서 새 저장소(New repository)를 만들고, 안내에 나오는 명령으로 push 합니다:

```bash
git remote add origin https://github.com/<your-id>/<repo>.git
git branch -M main
git push -u origin main
```

> `.gitignore`가 이미 있어 `data/`, `backup/`, `logs/` 등 로컬 데이터는 업로드되지 않습니다.
> (GitHub 없이 하려면 `npm i -g vercel` 후 폴더에서 `vercel` 명령으로도 가능합니다.)

---

## 3단계 — Vercel에 배포하기

1. https://vercel.com 접속 → 로그인 → **Add New… → Project**
2. 2단계에서 만든 GitHub 저장소를 **Import**
3. **Framework Preset**: `Other` (자동 감지됨). Build/Output 설정은 그대로 두세요.
4. **Environment Variables** 섹션에 아래 3개를 추가:

   | Name | Value |
   |------|-------|
   | `SUPABASE_URL` | 1단계에서 복사한 Project URL |
   | `SUPABASE_SERVICE_KEY` | 1단계에서 복사한 service_role key |
   | `APP_PASSWORD` | 원하는 접속 비밀번호 (예: 회사 공용 비번) |

   > `APP_PASSWORD`는 **꼭 설정하시길 권장**합니다. 설정하지 않으면 URL을 아는 누구나 데이터를 보고 수정할 수 있습니다.

5. **Deploy** 클릭 → 1~2분 후 완료. `https://<프로젝트>.vercel.app` 주소가 나옵니다.

---

## 4단계 — 접속 & 확인

- 배포된 주소(`https://<프로젝트>.vercel.app`)로 접속합니다.
- `APP_PASSWORD`를 설정했다면 첫 접속 시 비밀번호를 물어봅니다. (브라우저에 1회 저장됨)
- 스마트폰·태블릿·다른 PC에서도 같은 주소로 접속하면 동일한 데이터가 보입니다.

---

## 5단계 — 기존 로컬 데이터 옮기기 (선택)

이미 로컬 앱에서 입력한 데이터가 있다면:
1. **로컬 앱**(앱시작.cmd) 실행 → 왼쪽 **"JSON 백업 다운로드"** 클릭 → 파일 저장
2. **클라우드 앱**(vercel 주소) 접속 → **"JSON 파일 복원"** → 방금 받은 파일 선택
3. 완료. 이제 클라우드에 데이터가 올라갑니다.

---

## 보안 요약
- `service_role` 키와 `APP_PASSWORD`는 **Vercel 환경변수에만** 넣습니다. 코드에는 없습니다.
- Supabase는 **RLS(행 수준 보안)** 가 켜져 있어, 공개 anon 키로는 데이터에 접근할 수 없습니다. 서버(서비스 롤)만 접근합니다.
- 비밀번호를 바꾸려면 Vercel 환경변수 `APP_PASSWORD` 수정 후 재배포하세요.

## 자주 묻는 문제
- **접속 시 500 오류** → Vercel 환경변수 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` 오타 확인 후 재배포.
- **비밀번호가 계속 틀림** → `APP_PASSWORD` 값 확인. 브라우저 저장값 초기화는 새로고침 후 다시 입력.
- **데이터가 비어 있음** → 1단계의 `supabase-schema.sql`을 실행했는지 확인.
- **로컬은 그대로** → 환경변수가 없으면 자동으로 로컬 `data/` 폴더를 쓰므로, `앱시작.cmd`는 예전처럼 동작합니다.
