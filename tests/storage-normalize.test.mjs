import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameApplicantInfo, normalizeApplicantInfo, uniqueApplicantValues } from '../src/applicant-storage.ts';
import { normalizeStoredSignatureStamp } from '../src/signature-storage.ts';

test('신청자 정보: 글자가 아닌 값은 버리고, 세 칸이 모두 비면 받지 않는다', () => {
  assert.deepEqual(normalizeApplicantInfo({ 소속: ' 설악고 ', 직급: 3, 성명: '홍길동', updatedAt: 'x' }), { 소속: '설악고', 직급: '', 성명: '홍길동', updatedAt: 'x' });
  assert.equal(normalizeApplicantInfo({ 소속: ' ', 직급: '', 성명: null }), null);
  assert.equal(normalizeApplicantInfo(null), null);
  assert.equal(normalizeApplicantInfo('홍길동'), null);
});

test('신청자 정보: 자동완성 목록은 최근 순서를 지키며 겹치는 값을 한 번만 보여 준다', () => {
  const list = [
    { 소속: 'A고', 직급: '교사', 성명: '김', updatedAt: '' },
    { 소속: 'B고', 직급: '교사', 성명: '이', updatedAt: '' },
    { 소속: 'A고', 직급: '', 성명: '박', updatedAt: '' },
  ];
  assert.deepEqual(uniqueApplicantValues(list, '소속'), ['A고', 'B고']);
  assert.deepEqual(uniqueApplicantValues(list, '직급'), ['교사']);
  assert.equal(isSameApplicantInfo(list[0], { ...list[0], updatedAt: '나중' }), true);
  assert.equal(isSameApplicantInfo(list[0], list[2]), false);
});

test('도장 저장본: PNG data URL 만 받고 회전은 0~10° 로 맞춘다', () => {
  const stamp = { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', widthPx: 120.4, heightPx: 0, updatedAt: 't' };
  assert.deepEqual(normalizeStoredSignatureStamp(stamp), { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', widthPx: 120, heightPx: 1, updatedAt: 't' });
  assert.equal(normalizeStoredSignatureStamp({ ...stamp, rotationDeg: 25 }).rotationDeg, 10);
  assert.equal(normalizeStoredSignatureStamp({ ...stamp, rotationDeg: 6.6 }).rotationDeg, 7);
  assert.equal('rotationDeg' in normalizeStoredSignatureStamp({ ...stamp, rotationDeg: -3 }), false);
  assert.equal(normalizeStoredSignatureStamp({ ...stamp, dataUrl: 'data:image/jpeg;base64,AAAA' }), null);
  assert.equal(normalizeStoredSignatureStamp({ ...stamp, mime: 'image/jpeg' }), null);
  assert.equal(normalizeStoredSignatureStamp({ ...stamp, widthPx: '120' }), null);
  assert.equal(normalizeStoredSignatureStamp(null), null);
});
