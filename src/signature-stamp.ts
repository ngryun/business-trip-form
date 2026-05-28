import type { WasmBridge } from '@/core/wasm-bridge';

const HWPUNIT_PER_PAGE_PX = 75;
// 도장은 미리보기에서 실제로 ~48 CSS px 정도로 그려진다. 원본 픽셀 폭이 너무 크면 HWP 에
// 포함되는 PNG 바이너리도 같이 커져 localStorage 5MB(Safari) 같은 작은 쿼터를 쉽게 넘긴다.
// 320px 정도면 2x 레티나에서도 충분한 품질이라 저장본/문서 양쪽 부담을 모두 줄일 수 있다.
const MAX_NORMALIZED_IMAGE_PX = 320;
const TARGET_MARK_TEXT = '(인)';
const TARGET_FIELD_NAMES = ['성명', '이름'];

interface StampRef {
  sec: number;
  paraIdx: number;
  controlIdx: number;
}

interface PreparedImage {
  data: Uint8Array;
  widthPx: number;
  heightPx: number;
}

export interface StoredSignatureStamp {
  mime: 'image/png';
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  updatedAt?: string;
}

interface PageRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FieldListEntry {
  fieldId: number;
  name: string;
  guide: string;
  location: {
    sectionIndex: number;
    paraIndex: number;
    path?: FieldLocationPathEntry[];
  };
}

interface FieldLocationPathEntry {
  paraIndex: number;
  controlIndex: number;
  cellIndex: number;
}

export class SignatureStampManager {
  private ref: StampRef | null = null;
  private size: { width: number; height: number } | null = null;
  private stored: StoredSignatureStamp | null = null;

  constructor(private wasm: WasmBridge) {}

  async applyFile(file: File): Promise<StoredSignatureStamp> {
    if (!file.type.startsWith('image/')) {
      throw new Error('이미지 파일을 선택해 주세요.');
    }

    const image = await prepareImage(file);
    const stored = preparedImageToStored(image);
    this.applyPreparedImage(image, stored);
    return stored;
  }

  applyStored(stored: StoredSignatureStamp): void {
    this.applyPreparedImage(storedSignatureToPreparedImage(stored), {
      ...stored,
      updatedAt: stored.updatedAt || new Date().toISOString(),
    });
  }

  getStoredStamp(): StoredSignatureStamp | null {
    return this.stored;
  }

  private applyPreparedImage(image: PreparedImage, stored: StoredSignatureStamp): void {
    this.clear();

    const size = fitStampSize(image.widthPx, image.heightPx);
    this.size = size;
    this.stored = stored;
    this.ref = this.insertPlaceholder(image, size);

    try {
      if (!this.realign()) throw new Error('성명 옆 (인) 위치를 찾지 못했습니다.');
    } catch (err) {
      this.clear();
      throw err;
    }
  }

  realign(): boolean {
    if (!this.ref || !this.size) return false;
    // 현재 그림의 페이지 좌표 / 현재 오프셋과 목표 위치(target)의 차이로 새 오프셋을 계산한다.
    // 예전엔 위치 탐색 전 picture 를 (0,0) 으로 초기화해서 origin 을 안정화했는데, 그러면
    // 폼 값 입력 후 누름틀의 name 이 비어 target 탐색이 실패할 때 그림이 (0,0) 으로 박혀버린다.
    // 현재 위치를 그대로 두고 보정만 더한다.
    this.wasm.refreshLayout();
    const current = this.findPictureLayout(this.ref);
    const target = findSignatureTarget(this.wasm);
    if (!current || !target || current.pageIndex !== target.pageIndex) return false;

    const props = this.wasm.getPictureProperties(this.ref.sec, this.ref.paraIdx, this.ref.controlIdx);
    const currentHorzPx = props.horzOffset / HWPUNIT_PER_PAGE_PX;
    const currentVertPx = props.vertOffset / HWPUNIT_PER_PAGE_PX;

    const left = target.x + target.width / 2 - this.size.width / 2;
    const top = target.y + target.height / 2 - this.size.height / 2;
    const result = this.setStampProperties(
      this.ref,
      this.size,
      currentHorzPx + (left - current.x),
      currentVertPx + (top - current.y),
    );
    if (!result.ok) return false;
    this.wasm.refreshLayout();
    return true;
  }

  clear(): boolean {
    if (!this.ref) return false;
    const { sec, paraIdx, controlIdx } = this.ref;
    this.ref = null;
    this.size = null;
    this.stored = null;
    try {
      const result = this.wasm.deletePictureControl(sec, paraIdx, controlIdx);
      this.wasm.refreshLayout();
      return result.ok;
    } catch {
      return false;
    }
  }

  hasStamp(): boolean {
    return this.ref !== null;
  }

  private insertPlaceholder(image: PreparedImage, size: { width: number; height: number }): StampRef {
    // 픽처를 실제 크기(HWPUNIT)로 한 번에 넣으면, 그 그림이 들어간 문단이 본문 페이지 흐름을 한 줄만큼
    // 밀어 (인) 가 다음 페이지로 넘어간다. 그 결과 origin 측 페이지(0)와 target 측 페이지(1)가 달라져
    // 위치 정렬에 실패한다. insertPicture 자체는 width=1, height=1 HWPUNIT 으로 둬서 페이지 흐름에
    // 영향이 없도록 하고, 실제 크기는 곧이어 setPictureProperties 로 부여한다.
    const result = this.wasm.insertPicture(
      0,
      1,
      0,
      image.data,
      1,
      1,
      image.widthPx,
      image.heightPx,
      'png',
      'signature-stamp',
    );
    if (!result.ok) throw new Error('도장/서명 이미지를 문서에 삽입하지 못했습니다.');

    const ref = { sec: 0, paraIdx: result.paraIdx, controlIdx: result.controlIdx };
    // 페이지 좌상단에 BehindText 로 배치하고 실제 크기를 부여한다. crop 값은 명시적으로 0 으로 둬서
    // insertPicture 직후 자동 부여된 cropRight/cropBottom (≈ natural 크기) 이 남는 것을 막는다.
    this.setStampProperties(ref, size, 0, 0);
    this.wasm.refreshLayout();
    return ref;
  }

  private setStampProperties(
    ref: StampRef,
    size: { width: number; height: number },
    horzOffsetPx: number,
    vertOffsetPx: number,
  ): { ok: boolean } {
    return this.wasm.setPictureProperties(ref.sec, ref.paraIdx, ref.controlIdx, {
      width: pagePxToHwpUnit(size.width),
      height: pagePxToHwpUnit(size.height),
      treatAsChar: false,
      textWrap: 'BehindText',
      horzRelTo: 'Page',
      vertRelTo: 'Page',
      horzAlign: 'Left',
      vertAlign: 'Top',
      horzOffset: pagePxToHwpUnit(horzOffsetPx),
      vertOffset: pagePxToHwpUnit(vertOffsetPx),
      // insertPicture 직후 자동 부여된 crop 값이 남아 한컴 오피스에서 그림이 잘려 보이는 것을 막는다.
      cropLeft: 0,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      description: 'signature-stamp',
    });
  }

  private findPictureLayout(ref: StampRef): PageRect | null {
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      try {
        const controls = this.wasm.getPageControlLayout(pageIndex).controls ?? [];
        const item = controls.find((control) =>
          control.type === 'image' &&
          control.secIdx === ref.sec &&
          control.paraIdx === ref.paraIdx &&
          control.controlIdx === ref.controlIdx
        );
        if (item) {
          return {
            pageIndex,
            x: item.x,
            y: item.y,
            width: item.w,
            height: item.h,
          };
        }
      } catch {
        break;
      }
    }
    return null;
  }
}

async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_NORMALIZED_IMAGE_PX / Math.max(bitmap.width, 1),
    MAX_NORMALIZED_IMAGE_PX / Math.max(bitmap.height, 1),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 처리할 수 없습니다.');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('이미지를 PNG로 변환하지 못했습니다.');
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    widthPx: width,
    heightPx: height,
  };
}

function fitStampSize(widthPx: number, heightPx: number): { width: number; height: number } {
  const aspect = widthPx > 0 && heightPx > 0 ? widthPx / heightPx : 1;
  const bounds = aspect >= 1.6
    ? { width: 88, height: 34 }
    : aspect <= 0.72
      ? { width: 38, height: 54 }
      : { width: 48, height: 48 };
  const scale = Math.min(bounds.width / widthPx, bounds.height / heightPx);
  return {
    width: Math.max(12, widthPx * scale),
    height: Math.max(12, heightPx * scale),
  };
}

function preparedImageToStored(image: PreparedImage): StoredSignatureStamp {
  return {
    mime: 'image/png',
    dataUrl: `data:image/png;base64,${uint8ToBase64(image.data)}`,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
    updatedAt: new Date().toISOString(),
  };
}

function storedSignatureToPreparedImage(stored: StoredSignatureStamp): PreparedImage {
  if (stored.mime !== 'image/png' || !stored.dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('저장된 도장/서명 이미지 형식이 올바르지 않습니다.');
  }
  const widthPx = Math.max(1, Math.round(Number(stored.widthPx) || 0));
  const heightPx = Math.max(1, Math.round(Number(stored.heightPx) || 0));
  return {
    data: base64DataUrlToUint8(stored.dataUrl),
    widthPx,
    heightPx,
  };
}

function uint8ToBase64(data: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64DataUrlToUint8(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice('data:image/png;base64,'.length);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function findSignatureTarget(wasm: WasmBridge): PageRect | null {
  // 폼 값을 채우면 누름틀의 name/guide 가 비워지는 경우가 있어 이름으로만 후보를 좁히면
  // 두 번째 호출(미리보기 반영 후 realign) 에서 (인) 위치를 찾지 못한다. name/guide 가 살아있는
  // 동안엔 그쪽을 우선 검사하고, 그래도 못 찾으면 전체 누름틀을 훑어 (인) 가 있는 셀을 찾는다.
  const entries = wasm.getFieldList() as FieldListEntry[];
  const named = entries
    .filter((entry) => TARGET_FIELD_NAMES.includes(entry.name) || TARGET_FIELD_NAMES.includes(entry.guide))
    .sort((a, b) => scoreTargetField(b) - scoreTargetField(a));

  for (const entry of named) {
    const rect = findTargetMarkNearField(wasm, entry);
    if (rect) return rect;
  }

  for (const entry of entries) {
    if (named.includes(entry)) continue;
    const rect = findTargetMarkNearField(wasm, entry);
    if (rect) return rect;
  }
  return null;
}

function scoreTargetField(entry: FieldListEntry): number {
  let score = entry.name === '성명' || entry.guide === '성명' ? 10 : 0;
  const path = entry.location.path ?? [];
  const last = path[path.length - 1];
  if (last) score += last.cellIndex + last.paraIndex;
  else score += entry.location.paraIndex;
  return score;
}

function findTargetMarkNearField(wasm: WasmBridge, entry: FieldListEntry): PageRect | null {
  const loc = entry.location;
  const path = loc.path ?? [];
  try {
    if (path.length === 0) {
      const text = wasm.getTextRange(loc.sectionIndex, loc.paraIndex, 0, 500);
      const offset = text.indexOf(TARGET_MARK_TEXT);
      if (offset < 0) return null;
      const start = wasm.getCursorRect(loc.sectionIndex, loc.paraIndex, offset);
      const end = wasm.getCursorRect(loc.sectionIndex, loc.paraIndex, offset + TARGET_MARK_TEXT.length);
      return cursorPairToRect(start, end);
    }

    const first = path[0];
    const last = path[path.length - 1];
    if (path.length === 1) {
      const text = wasm.getTextInCell(
        loc.sectionIndex,
        loc.paraIndex,
        first.controlIndex,
        last.cellIndex,
        last.paraIndex,
        0,
        500,
      );
      const offset = text.indexOf(TARGET_MARK_TEXT);
      if (offset < 0) return null;
      const start = wasm.getCursorRectInCell(
        loc.sectionIndex,
        loc.paraIndex,
        first.controlIndex,
        last.cellIndex,
        last.paraIndex,
        offset,
      );
      const end = wasm.getCursorRectInCell(
        loc.sectionIndex,
        loc.paraIndex,
        first.controlIndex,
        last.cellIndex,
        last.paraIndex,
        offset + TARGET_MARK_TEXT.length,
      );
      return cursorPairToRect(start, end);
    }

    const pathJson = JSON.stringify(path.map((item) => ({
      controlIndex: item.controlIndex,
      cellIndex: item.cellIndex,
      cellParaIndex: item.paraIndex,
    })));
    const text = wasm.getTextInCellByPath(loc.sectionIndex, loc.paraIndex, pathJson, 0, 500);
    const offset = text.indexOf(TARGET_MARK_TEXT);
    if (offset < 0) return null;
    const start = wasm.getCursorRectByPath(loc.sectionIndex, loc.paraIndex, pathJson, offset);
    const end = wasm.getCursorRectByPath(loc.sectionIndex, loc.paraIndex, pathJson, offset + TARGET_MARK_TEXT.length);
    return cursorPairToRect(start, end);
  } catch {
    return null;
  }
}

function cursorPairToRect(
  start: { pageIndex: number; x: number; y: number; height: number } | null | undefined,
  end: { pageIndex: number; x: number; y: number; height: number } | null | undefined,
): PageRect | null {
  if (!start || !end) return null;
  return {
    pageIndex: start.pageIndex,
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(Math.abs(end.x - start.x), start.height),
    height: Math.max(start.y + start.height, end.y + end.height) - Math.min(start.y, end.y),
  };
}

function pagePxToHwpUnit(value: number): number {
  return Math.round(value * HWPUNIT_PER_PAGE_PX);
}
