/**
 * URL 로 양식 값을 공유하는 헬퍼.
 *
 * - 폼 입력값을 URL 쿼리스트링에 담는다. 한글 키는 URL-encode 되어 그대로 사용 가능.
 * - 페이지 로드 시 쿼리스트링이 있으면 폼에 채워 넣을 수 있다.
 * - localStorage 의 복원본보다 URL 우선순위가 높다 (공유 URL 의 의도를 존중).
 *
 * 키는 form input 의 `name` 속성과 1:1 대응한다 — 소속, 직급, 성명, 시작일시, 종료일시,
 * 출장지, 갈때일자, 갈때교통편, ... 등.
 */

/** 빈 값이 아닌 항목만 모아 쿼리스트링을 만든다. 짧은 URL 을 위해 path 만 남기고 query 만 갱신한다. */
export function buildShareUrl(values: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const trimmed = (value ?? '').trim();
    if (!trimmed) continue;
    params.append(key, trimmed);
  }
  const base = `${window.location.origin}${window.location.pathname}`;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** 현재 URL 의 쿼리스트링에서 폼에 채울 값들을 읽는다. 키는 form input name 과 동일. */
export function readUrlFormValues(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    params.forEach((value, key) => {
      out[key] = value;
    });
  } catch {
    /* 잘못된 URL 이면 무시 */
  }
  return out;
}

/** URL 에 쿼리스트링이 있는지 가볍게 검사. 키가 하나라도 있어야 true. */
export function hasUrlFormValues(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    let count = 0;
    params.forEach(() => { count += 1; });
    return count > 0;
  } catch {
    return false;
  }
}

/** 현재 페이지 URL 의 쿼리스트링을 빈 상태로 갈아치워, 브라우저 주소창의 노이즈를 줄인다. */
export function clearUrlFormValues(): void {
  try {
    const url = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  } catch {
    /* 일부 환경에서 history API 미지원 시 무시 */
  }
}

/**
 * 텍스트를 클립보드에 복사한다.
 *
 * - 일반적으로 navigator.clipboard.writeText 사용 (HTTPS 또는 localhost 필요)
 * - 권한 거부 / 비보안 컨텍스트일 때 textarea + execCommand('copy') 폴백
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallthrough */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
