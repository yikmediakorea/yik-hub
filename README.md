# YIK Media — Influencer Hub

YIK Media Inc. 내부용 인플루언서 관리 시스템

## 기능
- YouTube 채널 실시간 검색 (YouTube Data API v3)
- AI 채널 인사이트 분석 (Claude AI)
- 인플루언서 DB 관리 + 엑셀 내보내기
- 캠페인 생성 및 인플루언서 배정
- 섭외 상태 트래킹 (미응답/협의중/수락/거절/완료)
- AI 캠페인 제안서 자동 생성

## 배포 방법 (Vercel)

### 1. GitHub에 올리기
1. github.com 접속 → New Repository → 이름: `yik-hub` → Create
2. 이 폴더 전체를 업로드

### 2. Vercel 연결
1. vercel.com 접속 → GitHub 계정으로 로그인
2. "Add New Project" → `yik-hub` 선택
3. Framework: Vite 자동 감지됨
4. Deploy 클릭

### 3. 사용
- 배포 완료 후 URL 접속
- YouTube Data API 키 입력 (우측 상단)
- 채널 검색 시작

## YouTube API 키 발급
1. console.cloud.google.com 접속
2. 새 프로젝트 생성
3. YouTube Data API v3 활성화
4. 사용자 인증 정보 → API 키 생성 (공개 데이터 선택)
