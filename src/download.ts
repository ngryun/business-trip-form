import type { WasmBridge } from '@/core/wasm-bridge';

/**
 * 현재 문서를 HWP 바이너리로 직렬화하여 브라우저 다운로드를 트리거한다.
 *
 * wasm.exportHwp() 는 Uint8Array 를 동기 반환한다 (studio-host 의 동작 기준).
 * 큰 파일에서도 Blob 생성은 한 번에 가능하므로 chunking 불필요.
 */
export function downloadHwp(wasm: WasmBridge, fileName: string): void {
  const bytes = wasm.exportHwp();
  if (!bytes || bytes.length === 0) {
    throw new Error('exportHwp() 가 결과를 반환하지 않았습니다.');
  }
  // Blob 생성자는 ArrayBufferView 를 받지만 TS DOM 타입이 SharedArrayBuffer 가능성 때문에
  // 좁히지 못한다. 안전하게 buffer 슬라이스로 복사해서 넘긴다.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/x-hwp' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 즉시 revoke 시 일부 브라우저에서 다운로드가 끊긴다는 보고가 있어 한 박자 늦춤
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
