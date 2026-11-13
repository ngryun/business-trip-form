import type { StoredSignatureStamp } from './signature-stamp.ts';

/**
 * 도장/서명 이미지를 이 브라우저(localStorage)에 두고 다음 방문에도 쓴다. 서버로는 보내지 않는다.
 */

const SIGNATURE_STORAGE_KEY = 'business-trip-form:signature-stamp:v1';

export function loadStoredSignatureStamp(): StoredSignatureStamp | null {
  try {
    const raw = localStorage.getItem(SIGNATURE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return normalizeStoredSignatureStamp(parsed);
  } catch {
    return null;
  }
}

export function saveStoredSignatureStamp(stamp: StoredSignatureStamp): { ok: true } | { ok: false; reason: string } {
  const payload = JSON.stringify({
    ...stamp,
    updatedAt: new Date().toISOString(),
  } satisfies StoredSignatureStamp);
  try {
    localStorage.setItem(SIGNATURE_STORAGE_KEY, payload);
    return { ok: true };
  } catch (err) {
    console.error('[signature] localStorage 저장 실패', err);
    const sizeKb = Math.round(payload.length / 1024);
    const quotaLike =
      (err instanceof DOMException &&
        (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) ||
      /quota/i.test(String((err as { message?: unknown })?.message ?? ''));
    if (quotaLike) {
      return {
        ok: false,
        reason: `브라우저 저장 용량 부족(${sizeKb}KB). 이미지를 좀 더 작게 만들어 다시 시도해 주세요.`,
      };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `브라우저 저장 실패: ${detail || '알 수 없는 오류'}` };
  }
}

export function clearStoredSignatureStamp(): boolean {
  try {
    localStorage.removeItem(SIGNATURE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasStoredSignatureStamp(): boolean {
  try {
    return localStorage.getItem(SIGNATURE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function normalizeStoredSignatureStamp(raw: unknown): StoredSignatureStamp | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<StoredSignatureStamp>;
  if (
    item.mime !== 'image/png' ||
    typeof item.dataUrl !== 'string' ||
    !item.dataUrl.startsWith('data:image/png;base64,') ||
    typeof item.widthPx !== 'number' ||
    typeof item.heightPx !== 'number'
  ) {
    return null;
  }
  const rotationDeg = typeof item.rotationDeg === 'number'
    ? Math.min(10, Math.max(0, Math.round(item.rotationDeg)))
    : 0;
  return {
    mime: 'image/png',
    dataUrl: item.dataUrl,
    widthPx: Math.max(1, Math.round(item.widthPx)),
    heightPx: Math.max(1, Math.round(item.heightPx)),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
    ...(rotationDeg > 0 ? { rotationDeg } : {}),
  };
}
