/**
 * 사용자가 올린 양식(HWP) — 기관마다 서식이 달라, 누름틀이 든 자기 양식을 올려 쓸 수 있게 한다.
 * HWPX 는 받지 않는다: 앱 엔진(@rhwp/core 0.7.11)이 HWPX 안의 누름틀을 읽지 못한다.
 *
 * 파일은 서버로 보내지 않고 이 브라우저의 localStorage 에만 둔다 (다음 방문에도 같은 양식으로 열린다).
 * 저장하지 못해도(용량 부족·비공개 모드) 이번 방문 동안은 그대로 쓴다.
 */

const STORAGE_KEY = 'business-trip-form:custom-template:v1';

/** 올릴 수 있는 양식 크기 — 출장신청서 양식은 수십 KB 라 넉넉하고, localStorage(약 5MB)에 들어가는 크기다. */
export const CUSTOM_TEMPLATE_MAX_BYTES = 1024 * 1024;

export interface CustomTemplate {
  name: string;
  bytes: Uint8Array;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // 한꺼번에 펼치면 큰 파일에서 인자 개수 한도를 넘으므로 나눠 붙인다.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const HWP_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const startsWith = (bytes: Uint8Array, magic: number[]): boolean => magic.every((value, index) => bytes[index] === value);

/** 올린 파일을 양식으로 쓸 수 없는 이유. 쓸 수 있으면 null. (누름틀 유무는 엔진에 올려 봐야 안다.) */
export function customTemplateProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return '빈 파일입니다.';
  if (bytes.length > CUSTOM_TEMPLATE_MAX_BYTES) {
    return `파일이 너무 큽니다 (${Math.ceil(bytes.length / 1024)}KB). ${CUSTOM_TEMPLATE_MAX_BYTES / 1024}KB 이하의 양식만 올릴 수 있습니다.`;
  }
  // HWP 는 OLE 복합 문서, HWPX 는 zip 이다.
  if (startsWith(bytes, ZIP_MAGIC)) return 'HWPX 파일은 누름틀을 읽지 못합니다. 한글에서 「다른 이름으로 저장 → HWP」로 저장해 올려 주세요.';
  if (!startsWith(bytes, HWP_MAGIC)) return '한글(HWP) 파일이 아닙니다.';
  return null;
}

export function loadCustomTemplate(): CustomTemplate | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as { name?: unknown; data?: unknown }) : null;
    if (!saved || typeof saved.name !== 'string' || typeof saved.data !== 'string') return null;
    const bytes = base64ToBytes(saved.data);
    return customTemplateProblem(bytes) ? null : { name: saved.name, bytes };
  } catch {
    return null;
  }
}

/** 저장했으면 true. 용량 부족 등으로 못 했으면 false (양식은 이번 방문 동안만 쓴다). */
export function saveCustomTemplate(template: CustomTemplate): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: template.name, data: bytesToBase64(template.bytes) }));
    return true;
  } catch {
    return false;
  }
}

export function clearCustomTemplate(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 저장소를 못 쓰면 지울 것도 없다 */ }
}
