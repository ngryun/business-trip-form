import type { WasmBridge } from '@/core/wasm-bridge';
import type { DocumentPosition } from '@/core/types';

/**
 * 한 누름틀 정보. fieldId 가 고유 식별자.
 *
 * - name: HWP 누름틀의 "이름" 속성 (선택적)
 * - guide: HWP 누름틀의 "안내문구" 속성 (Ctrl+K, E 의 기본 입력란)
 *
 * 같은 라벨을 가진 필드가 여러 곳(본문/결재란 등)에 나오면 fieldId 만 다르고 name/guide 는 같다.
 */
export interface FieldEntry {
  fieldId: number;
  name: string;
  guide: string;
  value: string;
}

/** label → 해당 라벨을 가진 필드들의 묶음. label 은 name 우선, name 이 비어 있으면 guide. */
export type FieldMap = Map<string, FieldEntry[]>;

/** 시작일시 누름틀에 범위를 합쳐 넣으므로, 종료일시 누름틀은 항상 비운 채로 둔다 (안내문구 복원 금지). */
const SUPPRESSED_GUIDE_LABELS = new Set(['종료일시']);

interface SetFieldValuesOptions {
  clearEmpty?: boolean;
}

interface FillDateTimeRangeOptions {
  clearEmpty?: boolean;
}

/**
 * 문서 내 모든 누름틀을 조회하여 label → [FieldEntry, ...] 매핑을 반환한다.
 *
 * label 후보:
 *  1) 필드의 name 속성 (있으면 우선)
 *  2) name 이 비어 있으면 guide (안내문구)
 *
 * 이렇게 하면 사용자가 한컴오피스에서 "이름" 또는 "안내문구" 중 무엇으로 라벨을 붙였든
 * 같은 매핑 동작이 가능하다.
 */
export function discoverFields(wasm: WasmBridge): FieldMap {
  const map: FieldMap = new Map();
  const list = wasm.getFieldList();
  for (const raw of list) {
    const entry: FieldEntry = {
      fieldId: raw.fieldId,
      name: raw.name ?? '',
      guide: raw.guide ?? '',
      value: raw.value ?? '',
    };
    // 1차 키: name (있을 때)
    if (entry.name) {
      pushTo(map, entry.name, entry);
    }
    // 2차 키: guide. name 과 다를 때만 별도 등록해서 양쪽 모두로 매칭 가능하게 한다.
    if (entry.guide && entry.guide !== entry.name) {
      pushTo(map, entry.guide, entry);
    }
  }
  return map;
}

function pushTo(map: FieldMap, key: string, entry: FieldEntry): void {
  const list = map.get(key);
  if (list) {
    if (!list.some((e) => e.fieldId === entry.fieldId)) list.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

/**
 * 시작일시·종료일시 누름틀이 한 셀에 `시작 ~ 종료` 형태로 들어있을 때,
 * 둘 사이의 리터럴 구분자(" ~ ")를 한 번 제거한다.
 *
 * 범위 전체를 시작일시 누름틀 하나에 합쳐 넣기 때문에, 템플릿의 리터럴 구분자가 남으면
 * 다운로드한 한글 문서에서 `... 18:00 ~`(중복 물결)처럼 보이고, 시작만 입력한 경우
 * 미리보기에도 꼬리 물결이 남는다. 로드 직후 한 번만 호출한다.
 */
export function removeDateTimeRangeSeparator(wasm: WasmBridge, fields: FieldMap): void {
  const starts = fields.get('시작일시') ?? [];
  const ends = fields.get('종료일시') ?? [];
  if (starts.length === 0 || ends.length === 0) return;

  const locById = new Map(wasm.getFieldList().map((f) => [f.fieldId, f.location]));
  for (const start of starts) {
    const sLoc = locById.get(start.fieldId);
    const sp = sLoc?.path?.[0];
    if (!sLoc || !sp || sLoc.path!.length !== 1) continue; // 단일 깊이 셀만 처리

    const end = ends.find((e) => {
      const eLoc = locById.get(e.fieldId);
      const ep = eLoc?.path?.[0];
      return !!eLoc && !!ep
        && eLoc.sectionIndex === sLoc.sectionIndex
        && eLoc.paraIndex === sLoc.paraIndex
        && ep.controlIndex === sp.controlIndex
        && ep.cellIndex === sp.cellIndex
        && ep.paraIndex === sp.paraIndex;
    });
    if (end) deleteFieldGap(wasm, sLoc, sp, start.fieldId, end.fieldId);
  }
}

/** 같은 셀 안에서 시작일시 누름틀과 종료일시 누름틀 사이의 비-필드 문자(구분자)를 삭제 */
function deleteFieldGap(
  wasm: WasmBridge,
  loc: FieldListEntry['location'],
  cellPath: NonNullable<FieldListEntry['location']['path']>[number],
  startId: number,
  endId: number,
): void {
  const sec = loc.sectionIndex;
  const parentPara = loc.paraIndex;
  const { controlIndex, cellIndex, paraIndex: cellPara } = cellPath;

  let len: number;
  try { len = wasm.getCellParagraphLength(sec, parentPara, controlIndex, cellIndex, cellPara); } catch { return; }

  let seenStart = false;
  let gapStart = -1;
  let gapEnd = -1;
  for (let i = 0; i <= len; i++) {
    const pos = buildProbePosition(sec, parentPara, [cellPath], i);
    let fi;
    try { fi = wasm.getFieldInfoAt(pos); } catch { return; }
    if (fi.inField && fi.fieldId === startId) {
      seenStart = true;
    } else if (fi.inField && fi.fieldId === endId) {
      if (seenStart && gapStart >= 0 && gapEnd < 0) gapEnd = i;
    } else if (!fi.inField && seenStart && gapStart < 0) {
      gapStart = i;
    }
  }
  if (gapStart < 0) return;
  if (gapEnd < 0) gapEnd = len; // 종료일시가 갭 뒤에서 안 잡히면 문단 끝까지
  const count = gapEnd - gapStart;
  if (count <= 0) return;
  try { wasm.deleteTextInCell(sec, parentPara, controlIndex, cellIndex, cellPara, gapStart, count); } catch { /* noop */ }
}

/**
 * label → 값 매핑을 받아 각 라벨에 해당하는 필드를 모두 채운다.
 *
 * 같은 라벨이 여러 필드(본문/결재란 등)에 매칭되면 같은 값으로 모두 채운다.
 * 라벨에 매칭되는 필드가 하나도 없으면 조용히 건너뛴다.
 */
export function setFieldValues(
  wasm: WasmBridge,
  fields: FieldMap,
  values: Record<string, string | null | undefined>,
  options: SetFieldValuesOptions = {},
): { applied: number; missing: string[] } {
  let applied = 0;
  const missing: string[] = [];
  const filledFieldIds = new Set<number>();
  for (const [label, value] of Object.entries(values)) {
    const text = value ?? '';
    if (!text && !options.clearEmpty) continue;
    const targets = fields.get(label);
    if (!targets || targets.length === 0) {
      if (text) missing.push(label);
      continue;
    }
    for (const t of targets) {
      const res = wasm.setFieldValue(t.fieldId, text);
      if (res.ok) {
        applied += 1;
        if (text) filledFieldIds.add(t.fieldId);
      }
    }
  }
  // 누름틀 안내문구의 글자색(보통 빨강)이 입력값에도 그대로 적용되는 것을 피하려고
  // 채운 필드들의 텍스트 범위에 검정을 덮어쓴다.
  forceBlackOnFields(wasm, filledFieldIds);
  restoreEmptyFieldGuides(wasm, fields);
  return { applied, missing };
}

/**
 * 시작·종료 일시를 시작일시 누름틀 하나에 합쳐 넣고, 종료일시 누름틀은 값·안내문구 모두 비운다.
 *
 * 미리보기 렌더러가 한 셀의 두 번째 누름틀 내용을 잘라먹는 한계를 우회하기 위함.
 * rangeText 가 비어 있으면(시작 미입력) 아무것도 건드리지 않아 기존 안내문구를 유지한다.
 */
export function fillDateTimeRange(
  wasm: WasmBridge,
  fields: FieldMap,
  rangeText: string,
  options: FillDateTimeRangeOptions = {},
): void {
  const startTargets = fields.get('시작일시') ?? [];
  const endTargets = fields.get('종료일시') ?? [];
  if (!rangeText) {
    if (!options.clearEmpty) return;
    for (const t of startTargets) {
      try { wasm.setFieldValue(t.fieldId, ''); } catch { /* noop */ }
    }
    for (const t of endTargets) {
      try { wasm.setFieldValue(t.fieldId, ''); } catch { /* noop */ }
      clearFieldGuide(wasm, t.fieldId);
    }
    restoreEmptyFieldGuides(wasm, fields);
    return;
  }
  // 캔버스 미리보기 렌더러가 누름틀 끝 글자를 아주 타이트하게 잘라내는 케이스가 있어
  // 보이지 않는 끝 공백을 하나 붙여 마지막 실제 글자가 필드 경계에 닿지 않게 한다.
  const previewSafeRangeText = `${rangeText} `;

  const filled = new Set<number>();
  for (const t of startTargets) {
    const res = wasm.setFieldValue(t.fieldId, previewSafeRangeText);
    if (res.ok) filled.add(t.fieldId);
  }
  for (const t of endTargets) {
    try { wasm.setFieldValue(t.fieldId, ''); } catch { /* noop */ }
    clearFieldGuide(wasm, t.fieldId);
  }
  // 시작일시 누름틀 글자색을 검정으로 (안내문 빨강 잔존 방지) + 안내문구 제거
  forceBlackOnFields(wasm, filled);
}

/** 누름틀 안내문구(guide)를 비워 화면에 placeholder 가 남지 않게 한다 (name 은 유지해 재탐색 가능). */
function clearFieldGuide(wasm: WasmBridge, fieldId: number): void {
  try {
    const props = (wasm as any).getClickHereProps?.(fieldId);
    if (!props?.ok) return;
    (wasm as any).updateClickHereProps?.(
      fieldId,
      '',
      props.memo ?? '',
      props.name ?? '',
      props.editable ?? true,
    );
  } catch {
    /* 안내문구 제거 실패는 값 주입 자체를 막지 않는다. */
  }
}

function restoreEmptyFieldGuides(wasm: WasmBridge, fields: FieldMap): void {
  const latestById = new Map(wasm.getFieldList().map((f) => [f.fieldId, f]));
  const seen = new Set<number>();
  for (const [label, entries] of fields) {
    if (SUPPRESSED_GUIDE_LABELS.has(label)) continue;
    for (const entry of entries) {
      if (seen.has(entry.fieldId)) continue;
      seen.add(entry.fieldId);

      const latest = latestById.get(entry.fieldId);
      if ((latest?.value ?? entry.value ?? '') !== '') continue;

      try {
        const props = (wasm as any).getClickHereProps?.(entry.fieldId);
        if (!props?.ok || props.guide) continue;
        const name = props.name ?? latest?.name ?? entry.name ?? '';
        const guide = entry.guide || name || label;
        if (!guide) continue;
        (wasm as any).updateClickHereProps?.(
          entry.fieldId,
          guide,
          props.memo ?? '',
          name,
          props.editable ?? true,
        );
      } catch {
        // 안내문구 복원 실패는 값 주입 자체를 막지 않는다.
      }
    }
  }
}

/**
 * 지정한 fieldId 들의 필드 내용 서식을 입력값용으로 강제한다.
 *
 * - setFieldValue 직후 호출 — 그 시점에 fieldId 들이 유효함
 * - 각 필드의 startCharIdx/endCharIdx 는 getFieldInfoAt 으로 재조회
 * - 본문/단일 셀/중첩 셀 모두 처리 (path 깊이에 따라 분기)
 */
function forceBlackOnFields(wasm: WasmBridge, fieldIds: Set<number>): void {
  if (fieldIds.size === 0) return;
  const propsJson = JSON.stringify({
    fontId: wasm.findOrCreateFontId('맑은 고딕'),
    italic: false,
    textColor: '#000000',
  });
  const list = wasm.getFieldList();
  for (const f of list) {
    if (!fieldIds.has(f.fieldId)) continue;
    try {
      applyBlackToField(wasm, f, propsJson);
    } catch (err) {
      console.warn(`[field-filler] 입력값 서식 적용 실패 (fieldId=${f.fieldId}, name=${f.name}):`, err);
    }
  }
}

interface FieldListEntry {
  fieldId: number;
  name: string;
  guide: string;
  value: string;
  location: {
    sectionIndex: number;
    paraIndex: number;
    path?: Array<{ type: string; paraIndex: number; controlIndex: number; cellIndex: number }>;
  };
}

function applyBlackToField(wasm: WasmBridge, f: FieldListEntry, propsJson: string): void {
  const loc = f.location;
  const sec = loc.sectionIndex;
  const path = loc.path ?? [];

  // 같은 셀/문단 안에 여러 필드가 있을 수 있으므로 fieldId 로 정확한 범위를 찾는다.
  const range = findFieldRange(wasm, f.fieldId, sec, loc.paraIndex, path);
  if (!range) return;
  const { start, end } = range;
  if (end <= start) return;

  if (path.length === 0) {
    wasm.applyCharFormat(sec, loc.paraIndex, start, end, propsJson);
  } else if (path.length === 1) {
    const e = path[0];
    wasm.applyCharFormatInCell(
      sec, loc.paraIndex, e.controlIndex,
      e.cellIndex, e.paraIndex,
      start, end, propsJson,
    );
  }
  // 중첩 표(path.length >= 2)는 본 버전 범위 외.

  // 누름틀 안내문구를 비워서 렌더러가 안내문 오버레이를 그리지 않도록 한다.
  // (값이 채워졌어도 일부 양식에서 안내문이 화면에 잔존하는 케이스 방지)
  try {
    const props = (wasm as any).getClickHereProps?.(f.fieldId);
    if (props && props.ok) {
      (wasm as any).updateClickHereProps?.(
        f.fieldId,
        '', // guide 비움
        props.memo ?? '',
        props.name ?? '',
        props.editable ?? true,
      );
    }
  } catch { /* ignore */ }
}

/**
 * 셀/문단 내에서 fieldId 에 해당하는 정확한 (startCharIdx, endCharIdx) 를 찾는다.
 *
 * 같은 셀에 여러 누름틀이 나란히 있는 양식(예: "시작일시 ~ 종료일시")을 위해 필요.
 * charOffset 을 0 부터 훑으며 각 위치의 필드 정보를 조회하고, fieldId 가 일치하면 그 범위를 반환.
 * 다른 필드의 범위는 endCharIdx 뒤로 점프해서 빠르게 건너뛴다.
 */
function findFieldRange(
  wasm: WasmBridge,
  fieldId: number,
  sec: number,
  bodyParaIdx: number,
  path: FieldListEntry['location']['path'] = [],
): { start: number; end: number } | null {
  const MAX_SCAN = 1000;
  for (let off = 0; off <= MAX_SCAN; off++) {
    const pos = buildProbePosition(sec, bodyParaIdx, path, off);
    let fi;
    try { fi = wasm.getFieldInfoAt(pos); } catch { return null; }
    if (fi.inField && fi.fieldId === fieldId && fi.startCharIdx !== undefined && fi.endCharIdx !== undefined) {
      return { start: fi.startCharIdx, end: fi.endCharIdx };
    }
    // 다른 필드 영역 안이면 그 영역 끝까지 점프 (성능 최적화)
    if (fi.inField && fi.endCharIdx !== undefined && off < fi.endCharIdx) {
      off = fi.endCharIdx;
    }
  }
  return null;
}

function buildProbePosition(
  sec: number,
  bodyParaIdx: number,
  path: FieldListEntry['location']['path'] = [],
  charOffset = 0,
): DocumentPosition {
  if (path.length === 0) {
    return { sectionIndex: sec, paragraphIndex: bodyParaIdx, charOffset } as DocumentPosition;
  }
  const e = path[0];
  return {
    sectionIndex: sec,
    paragraphIndex: e.paraIndex,
    charOffset,
    parentParaIndex: bodyParaIdx,
    controlIndex: e.controlIndex,
    cellIndex: e.cellIndex,
    cellParaIndex: e.paraIndex,
  } as DocumentPosition;
}
