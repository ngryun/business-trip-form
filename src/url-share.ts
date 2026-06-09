/**
 * URL 로 양식 값을 공유하는 헬퍼.
 *
 * - 폼 입력값을 URL 해시 프래그먼트(#소속=...&성명=...)에 담는다. 해시는 HTTP 요청에
 *   포함되지 않으므로 정적 호스팅 서버의 접근 로그에 개인정보가 남지 않는다
 *   (쿼리스트링 ? 는 서버로 전송되어 로그에 기록된다).
 * - 페이지 로드 시 해시(또는 과거에 공유된 쿼리스트링 URL)가 있으면 폼에 채워 넣는다.
 * - localStorage 의 복원본보다 URL 우선순위가 높다 (공유 URL 의 의도를 존중).
 *
 * 키는 form input 의 `name` 속성과 1:1 대응한다 — 소속, 직급, 성명, 시작일시, 종료일시,
 * 출장지, 갈때일자, 갈때교통편, ... 등.
 */

/** 빈 값이 아닌 항목만 모아 해시 프래그먼트를 만든다. path 만 남기고 hash 만 갱신한다. */
export function buildShareUrl(values: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const trimmed = (value ?? '').trim();
    if (!trimmed) continue;
    params.append(key, trimmed);
  }
  const base = `${window.location.origin}${window.location.pathname}`;
  const qs = params.toString();
  return qs ? `${base}#${qs}` : base;
}

/** 해시 우선, 과거 공유 URL 과의 호환을 위해 쿼리스트링도 읽는다. */
function readShareParams(): URLSearchParams | null {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash.includes('=')) return new URLSearchParams(hash);
    if (window.location.search) return new URLSearchParams(window.location.search);
  } catch {
    /* 잘못된 URL 이면 무시 */
  }
  return null;
}

/** 현재 URL 에서 폼에 채울 값들을 읽는다. 키는 form input name 과 동일. */
export function readUrlFormValues(): Record<string, string> {
  const out: Record<string, string> = {};
  readShareParams()?.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** URL 에 공유 값이 있는지 가볍게 검사. 키가 하나라도 있어야 true. */
export function hasUrlFormValues(): boolean {
  let count = 0;
  readShareParams()?.forEach(() => { count += 1; });
  return count > 0;
}

/** 현재 페이지 URL 의 해시·쿼리를 빈 상태로 갈아치워, 브라우저 주소창의 노이즈를 줄인다. */
export function clearUrlFormValues(): void {
  try {
    const url = `${window.location.origin}${window.location.pathname}`;
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
