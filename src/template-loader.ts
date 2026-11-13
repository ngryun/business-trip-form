import { HwpDocument } from '@wasm/rhwp.js';
import { WasmBridge } from '@/core/wasm-bridge';
import type { DocumentInfo } from '@/core/types';

/**
 * HWP 양식 파일을 fetch 로 받아 WasmBridge 에 로드한다.
 *
 * - 공개 웹 정적 호스팅: 양식은 `public/templates/` 에 두면 빌드 시 dist 로 복사된다
 * - 이 앱은 Tauri 런타임이 아니므로 WasmBridge 를 직접 생성한다
 *   (HOP studio-host 의 bridge-factory 분기에 의존하지 않음)
 */
export async function loadTemplate(url: string): Promise<{ wasm: WasmBridge; docInfo: DocumentInfo; templateBytes: Uint8Array }> {
  const wasm = new WasmBridge();
  await wasm.initialize();
  const bytes = await fetchTemplateBytes(url);
  const fileName = url.split('/').pop() ?? 'template.hwp';
  const docInfo = wasm.loadDocument(bytes, fileName);

  // 원본 바이트를 함께 반환 — 값이 있는 범위 누름틀을 비울 때 엔진 panic 을 피하려고
  // 문서를 원본 상태로 다시 로드하는 우회 경로(main.ts)에서 사용한다.
  return { wasm, docInfo, templateBytes: bytes };
}

/** 양식 파일 바이트만 받아 온다 — 소속에 따라 바꿔 끼울 다른 양식을 미리 받아 둘 때 쓴다. */
export async function fetchTemplateBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`양식 파일 fetch 실패: ${res.status} ${res.statusText} (${url})`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // 흔한 실수: dev 서버의 SPA 폴백이 index.html 을 돌려주는 경우 — 매직 바이트로 미리 차단
  if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x21) {
    throw new Error(
      `양식 파일이 없습니다: ${url}\n` +
      `public/templates/ 에 출장신청서 HWP 를 두세요.`,
    );
  }
  return bytes;
}

/**
 * 엔진이 열 수 있는 문서인지 따로 열어 본다 — 못 열면 그 이유, 열리면 null. (엔진 초기화 뒤에만 쓴다.)
 *
 * WasmBridge.loadDocument 는 새 문서를 열기 전에 쓰던 문서를 먼저 놓아 버려서, 여는 데 실패하면
 * 그 뒤의 모든 로드가 "null pointer passed to rust" 로 실패한다 (새로고침 전까지 복구 불가).
 * 사용자가 올린 파일처럼 믿을 수 없는 문서는 여기서 먼저 걸러 낸다.
 */
export function documentOpenProblem(bytes: Uint8Array): string | null {
  try {
    new HwpDocument(bytes).free();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
