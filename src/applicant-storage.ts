/**
 * 신청자 정보(소속·직급·성명)를 이 브라우저(localStorage)에 모아 두고 입력칸의 자동완성 목록으로 보여 준다.
 * 서버로는 보내지 않는다.
 */

const APPLICANT_STORAGE_KEY = 'business-trip-form:applicant-info:v1';
const APPLICANT_FIELDS = ['소속', '직급', '성명'] as const;
const APPLICANT_DATALISTS: Record<ApplicantField, string> = {
  소속: 'applicant-org-options',
  직급: 'applicant-position-options',
  성명: 'applicant-name-options',
};
const MAX_SAVED_APPLICANTS = 30;

export type ApplicantField = typeof APPLICANT_FIELDS[number];
export type SavedApplicantInfo = Record<ApplicantField, string> & { updatedAt: string };

export interface ApplicantStorageOptions {
  formEl: HTMLFormElement;
  setStatus: (message: string, isError?: boolean) => void;
  /** 신청자 정보를 저장한 뒤 — 입력 중인 폼도 함께 임시 저장한다 */
  onSaved: () => void;
}

export function setupApplicantInfoStorage({ formEl, setStatus, onSaved }: ApplicantStorageOptions): void {
  const applicantSaveBtn = document.getElementById('btn-save-applicant') as HTMLButtonElement | null;
  const applicantClearBtn = document.getElementById('btn-clear-applicants') as HTMLButtonElement | null;
  const getApplicantInput = (name: ApplicantField): HTMLInputElement | null => {
    const control = formEl.elements.namedItem(name);
    return control instanceof HTMLInputElement ? control : null;
  };
  const collectApplicantInfo = (): SavedApplicantInfo | null => {
    const values = Object.fromEntries(
      APPLICANT_FIELDS.map((name) => [name, getApplicantInput(name)?.value.trim() ?? '']),
    ) as Record<ApplicantField, string>;
    if (!APPLICANT_FIELDS.some((name) => values[name])) return null;
    return { ...values, updatedAt: new Date().toISOString() };
  };
  const refreshApplicantDatalists = (applicants = loadApplicantInfos()): void => {
    // 지울 목록이 없으면 파괴적 버튼을 아예 보이지 않게 한다
    if (applicantClearBtn) applicantClearBtn.hidden = applicants.length === 0;
    for (const field of APPLICANT_FIELDS) {
      const datalist = document.getElementById(APPLICANT_DATALISTS[field]) as HTMLDataListElement | null;
      if (!datalist) continue;
      datalist.replaceChildren(
        ...uniqueApplicantValues(applicants, field).map((value) => {
          const option = document.createElement('option');
          option.value = value;
          return option;
        }),
      );
    }
  };

  refreshApplicantDatalists();
  applicantSaveBtn?.addEventListener('click', () => {
    const info = collectApplicantInfo();
    if (!info) {
      setStatus('저장할 신청자 정보를 입력하세요.', true);
      return;
    }

    const saved = loadApplicantInfos();
    const next = [
      info,
      ...saved.filter((item) => !isSameApplicantInfo(item, info)),
    ].slice(0, MAX_SAVED_APPLICANTS);

    try {
      localStorage.setItem(APPLICANT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setStatus('브라우저 저장소를 사용할 수 없어 신청자 정보를 저장하지 못했습니다.', true);
      return;
    }

    refreshApplicantDatalists(next);
    onSaved();
    setStatus('신청자 정보를 브라우저에 저장했습니다.');
  });

  applicantClearBtn?.addEventListener('click', () => {
    if (!window.confirm('브라우저에 저장된 신청자 정보 목록을 모두 삭제할까요?')) return;
    try {
      localStorage.removeItem(APPLICANT_STORAGE_KEY);
    } catch {
      setStatus('브라우저 저장소를 사용할 수 없어 저장 목록을 삭제하지 못했습니다.', true);
      return;
    }

    refreshApplicantDatalists([]);
    setStatus('저장된 신청자 정보 목록을 모두 삭제했습니다.');
  });
}

export function loadApplicantInfos(): SavedApplicantInfo[] {
  try {
    const raw = localStorage.getItem(APPLICANT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeApplicantInfo)
      .filter((item): item is SavedApplicantInfo => item !== null);
  } catch {
    return [];
  }
}

export function normalizeApplicantInfo(raw: unknown): SavedApplicantInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<Record<ApplicantField | 'updatedAt', unknown>>;
  const values = Object.fromEntries(
    APPLICANT_FIELDS.map((name) => [name, typeof item[name] === 'string' ? item[name].trim() : '']),
  ) as Record<ApplicantField, string>;
  if (!APPLICANT_FIELDS.some((name) => values[name])) return null;
  return {
    ...values,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
  };
}

export function uniqueApplicantValues(applicants: SavedApplicantInfo[], field: ApplicantField): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of applicants) {
    const value = item[field].trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function isSameApplicantInfo(a: SavedApplicantInfo, b: SavedApplicantInfo): boolean {
  return APPLICANT_FIELDS.every((field) => a[field] === b[field]);
}
