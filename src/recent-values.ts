/**
 * 라벨별 최근 입력값을 로컬 스토리지에 보관해, 미리보기 누름틀을 다시 클릭했을 때
 * 팝오버에 칩으로 노출하기 위한 작은 저장소.
 *
 * - 라벨별 최대 5개, 최근 → 오래된 순으로 저장
 * - 중복 값은 dedupe 후 맨 앞으로 끌어올림
 * - localStorage 사용 불가 환경(Safari 비공개 모드 등)에서는 in-memory 폴백
 */

const STORAGE_KEY = 'business-trip-form:recent-values:v1';
const MAX_PER_LABEL = 5;

let memoryFallback: Record<string, string[]> | null = null;

function read(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      out[k] = v.filter((item): item is string => typeof item === 'string' && item.length > 0)
        .slice(0, MAX_PER_LABEL);
    }
    return out;
  } catch {
    return memoryFallback ?? {};
  }
}

function write(map: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    memoryFallback = null;
  } catch {
    memoryFallback = map;
  }
}

export function getRecentValues(label: string): string[] {
  return read()[label] ?? [];
}

export function pushRecentValue(label: string, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const map = read();
  const prev = map[label] ?? [];
  const next = [trimmed, ...prev.filter((v) => v !== trimmed)].slice(0, MAX_PER_LABEL);
  map[label] = next;
  write(map);
}

export function removeRecentValue(label: string, value: string): void {
  const map = read();
  const prev = map[label] ?? [];
  const next = prev.filter((v) => v !== value);
  if (next.length === prev.length) return;
  map[label] = next;
  write(map);
}
