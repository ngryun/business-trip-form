/**
 * 소속에 따라 쓸 여비정산신청서 양식.
 *
 * 태백교육지원청은 자체 서식(출장명 칸·친지 숙박내역 줄·운임 4줄)을 쓰므로, 소속에
 * "태백교육지원청" 또는 "태백교육청" 이 들어 있으면 그 양식으로 바꾼다.
 */
export type TemplateKind = 'default' | 'taebaek';

export const TEMPLATE_FILES: Record<TemplateKind, string> = {
  default: 'templates/business-trip.hwp',
  taebaek: 'templates/business-trip-taebaek.hwp',
};

export function templateKindFor(org: string): TemplateKind {
  return /태백교육(지원)?청/.test(org.replace(/\s/g, '')) ? 'taebaek' : 'default';
}
