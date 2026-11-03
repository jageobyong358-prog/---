// ============================================================================
//  사이트 설정 (README.md 의 "설정" 항목 참고)
// ============================================================================
export const CONFIG = {
  // AI 중계 서버(worker/ai-proxy.js 를 배포한 Cloudflare Worker) 주소.
  // NVIDIA API 키는 이 중계 서버의 비밀 변수에만 보관하고, 이 파일(공개)에는 넣지 않습니다.
  aiProxyUrl: '',

  // 사용할 모델 (worker/ai-proxy.js 의 ALLOWED_MODELS 중 하나)
  aiModel: 'minimaxai/minimax-m3.1-flash',

  // 관리자 코드의 SHA-256 해시. 관리자 탭에서 이 코드를 입력하면 관리자 기능이 켜집니다.
  // (코드 원문은 저장소에 두지 않습니다.)
  adminPasswordHash: '6659f3609fade954e535200e8a2599781d15434b24c9726ed2d8561cb543da4e',
};

// 현재 서버: ?server=test 로 접속하면 테스트 서버 콘텐츠를 함께 사용합니다.
export function currentServer() {
  const q = new URLSearchParams(location.search).get('server');
  return q === 'test' ? 'test' : 'live';
}
