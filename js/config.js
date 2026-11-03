// ============================================================================
//  사이트 설정 (README.md 의 "설정" 항목 참고)
// ============================================================================
export const CONFIG = {
  // 사이트 공용 Anthropic API 키 (sk-ant-… 로 시작).
  // ⚠ 여기에 넣은 키는 사이트에 접속한 누구나 볼 수 있습니다. Anthropic 콘솔에서
  //   이 사이트 전용 키를 만들고 월 사용 한도(Spend limit)를 꼭 걸어 두세요.
  // 비워 두면 각 사용자가 설정 탭에서 자기 키를 입력해야 합니다.
  anthropicApiKey: '',

  // 관리자 코드의 SHA-256 해시. 관리자 탭에서 이 코드를 입력하면 관리자 기능이 켜집니다.
  // (코드 원문은 저장소에 두지 않습니다.)
  adminPasswordHash: '6659f3609fade954e535200e8a2599781d15434b24c9726ed2d8561cb543da4e',

  // 기본 Claude 모델
  model: 'claude-opus-5-5',
};

// 현재 서버: ?server=test 로 접속하면 테스트 서버 콘텐츠를 함께 사용합니다.
export function currentServer() {
  const q = new URLSearchParams(location.search).get('server');
  return q === 'test' ? 'test' : 'live';
}
