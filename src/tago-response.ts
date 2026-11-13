/**
 * TAGO(공공데이터포털) 응답 읽기 — 브라우저 실시간 조회(tago-live.ts)가 쓴다.
 *
 * 정상 응답은 `response.header.resultCode === '00'` 이고 항목은 `response.body.items.item` 에 있다.
 * 인증키·호출 한도 같은 게이트웨이 오류는 모양이 다르다 (2026-11 확인: HTTP 403 +
 * `{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR", …}}}`).
 * 예전 게이트웨이는 같은 내용을 XML 로 주기도 해서, JSON 이 아니면 글자만 추려 메시지로 쓴다.
 */

/** 호출 한도(초당·하루) 오류 이름에 공통으로 들어가는 말 */
const LIMIT_PATTERN = /LIMITED_NUMBER_OF_SERVICE_REQUESTS/;

export class TagoError extends Error {
  /** 호출 한도에 걸린 오류인지 (초당 제한이면 잠깐 쉬고 다시 부르면 된다) */
  readonly limited: boolean;

  constructor(message: string) {
    super(`TAGO: ${message}`);
    this.name = 'TagoError';
    this.limited = LIMIT_PATTERN.test(message);
  }
}

/** 오류가 TAGO 호출 한도 때문인지 — 안내 문구를 가르는 데 쓴다. */
export function isTagoLimitError(err: unknown): boolean {
  return err instanceof TagoError && err.limited;
}

const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/** 응답 본문에서 항목 목록을 꺼낸다. 오류 응답이면 그 이유를 담은 TagoError 를 던진다. */
export function parseTagoResponse(body: string, status: number): unknown[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    const plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new TagoError(plain || `HTTP ${status}`);
  }
  const root = (json ?? {}) as { response?: { header?: Record<string, unknown>; body?: { items?: { item?: unknown } } }; OpenAPI_ServiceResponse?: { cmmMsgHeader?: Record<string, unknown> } };
  const header = root.response?.header;
  if (header?.resultCode === '00') {
    const item = root.response?.body?.items?.item;
    return Array.isArray(item) ? item : item ? [item] : [];
  }
  const gateway = root.OpenAPI_ServiceResponse?.cmmMsgHeader;
  const parts = [text(header?.resultMsg), text(gateway?.errMsg), text(gateway?.returnAuthMsg)].filter(Boolean);
  throw new TagoError(parts.join(' · ') || `HTTP ${status}`);
}
