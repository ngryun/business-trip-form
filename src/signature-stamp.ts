import type { WasmBridge } from '@/core/wasm-bridge';

const HWPUNIT_PER_PAGE_PX = 75;
const MAX_NORMALIZED_IMAGE_PX = 640;
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

  constructor(private wasm: WasmBridge) {}

  async applyFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      throw new Error('이미지 파일을 선택해 주세요.');
    }

    const image = await prepareImage(file);
    this.clear();

    const inserted = this.insertPlaceholder(image);
    this.ref = inserted;
    this.size = fitStampSize(image.widthPx, image.heightPx);

    try {
      if (!this.realign()) throw new Error('성명 옆 (인) 위치를 찾지 못했습니다.');
    } catch (err) {
      this.clear();
      throw err;
    }
  }

  realign(): boolean {
    if (!this.ref || !this.size) return false;
    // 위치 탐색 전 임시로 페이지 좌상단(0,0)에 두어 origin 측정의 기준점을 안정시킨다.
    this.setPlaceholderProperties(this.ref);
    this.wasm.refreshLayout();

    const origin = this.findPictureLayout(this.ref);
    const target = findSignatureTarget(this.wasm);
    if (!origin || !target || origin.pageIndex !== target.pageIndex) return false;

    const left = target.x + target.width / 2 - this.size.width / 2;
    const top = target.y + target.height / 2 - this.size.height / 2;
    const result = this.wasm.setPictureProperties(this.ref.sec, this.ref.paraIdx, this.ref.controlIdx, {
      width: pagePxToHwpUnit(this.size.width),
      height: pagePxToHwpUnit(this.size.height),
      treatAsChar: false,
      textWrap: 'BehindText',
      horzRelTo: 'Page',
      vertRelTo: 'Page',
      horzAlign: 'Left',
      vertAlign: 'Top',
      horzOffset: pagePxToHwpUnit(left - origin.x),
      vertOffset: pagePxToHwpUnit(top - origin.y),
      description: 'signature-stamp',
    });
    if (!result.ok) return false;
    this.wasm.refreshLayout();
    return true;
  }

  clear(): boolean {
    if (!this.ref) return false;
    const { sec, paraIdx, controlIdx } = this.ref;
    this.ref = null;
    this.size = null;
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

  private insertPlaceholder(image: PreparedImage): StampRef {
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
    this.setPlaceholderProperties(ref);
    this.wasm.refreshLayout();
    return ref;
  }

  private setPlaceholderProperties(ref: StampRef): void {
    this.wasm.setPictureProperties(ref.sec, ref.paraIdx, ref.controlIdx, {
      width: 1,
      height: 1,
      treatAsChar: false,
      textWrap: 'BehindText',
      horzRelTo: 'Page',
      vertRelTo: 'Page',
      horzAlign: 'Left',
      vertAlign: 'Top',
      horzOffset: 0,
      vertOffset: 0,
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

function findSignatureTarget(wasm: WasmBridge): PageRect | null {
  const entries = wasm.getFieldList() as FieldListEntry[];
  const candidates = entries
    .filter((entry) => TARGET_FIELD_NAMES.includes(entry.name) || TARGET_FIELD_NAMES.includes(entry.guide))
    .sort((a, b) => scoreTargetField(b) - scoreTargetField(a));

  for (const entry of candidates) {
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
