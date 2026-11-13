import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShareUrl, clearUrlFormValues, hasUrlFormValues, isShareButtonUrl, readUrlFormValues } from '../src/url-share.ts';

/** 주소창 흉내 — url-share 는 window.location·history 만 본다 */
function visit(url) {
  const { origin, pathname, hash, search } = new URL(url);
  const location = { origin, pathname, hash, search };
  globalThis.window = {
    location,
    history: { replaceState: (_state, _title, next) => { const u = new URL(next); Object.assign(location, { origin: u.origin, pathname: u.pathname, hash: u.hash, search: u.search }); } },
  };
}

test('공유 링크는 빈 칸을 빼고 해시(#)에 담는다 — 서버로 가는 쿼리(?)에는 아무것도 넣지 않는다', () => {
  visit('https://example.test/business-trip-form/');
  const url = buildShareUrl({ 소속: ' 설악고등학교 ', 성명: '홍길동', 출장지: '', 첨부서류: '주유영수증 1부\n통행료 영수증 1부' });
  const parsed = new URL(url);
  assert.equal(parsed.search, '');
  assert.equal(parsed.pathname, '/business-trip-form/');
  const params = new URLSearchParams(parsed.hash.slice(1));
  assert.equal(params.get('공유'), '1');
  assert.equal(params.get('소속'), '설악고등학교');
  assert.equal(params.get('첨부서류'), '주유영수증 1부\n통행료 영수증 1부');
  assert.equal(params.has('출장지'), false);
});

test('채운 칸이 하나도 없으면 주소만 돌려준다', () => {
  visit('https://example.test/app/?x=1#old=1');
  assert.equal(buildShareUrl({ 소속: '', 성명: '  ' }), 'https://example.test/app/');
});

test('만든 링크를 열면 같은 값으로 읽히고, 공유 표시는 폼 값에 섞이지 않는다', () => {
  visit('https://example.test/app/');
  const values = { 소속: '강원 고성교육지원청', 시작일시: '2026-11-13T09:00', 갈때금액: '12,300', 출장명: 'A&B=C #1' };
  visit(buildShareUrl(values));
  assert.equal(hasUrlFormValues(), true);
  assert.equal(isShareButtonUrl(), true);
  assert.deepEqual(readUrlFormValues(), values);
});

test('확장프로그램이 넘긴 링크(공유 표시 없음)와 예전 쿼리스트링 링크도 읽는다', () => {
  visit('https://example.test/app/#' + new URLSearchParams({ 성명: '홍길동', 소속: '강원특별자치도고성교육지원청 교육과' }));
  assert.equal(isShareButtonUrl(), false);
  assert.deepEqual(readUrlFormValues(), { 성명: '홍길동', 소속: '강원특별자치도고성교육지원청 교육과' });

  visit('https://example.test/app/?' + new URLSearchParams({ 성명: '김' }));
  assert.equal(hasUrlFormValues(), true);
  assert.deepEqual(readUrlFormValues(), { 성명: '김' });
});

test('값이 없는 주소는 링크로 보지 않고, 값을 읽은 뒤에는 주소창에서 지운다', () => {
  visit('https://example.test/app/');
  assert.equal(hasUrlFormValues(), false);
  visit('https://example.test/app/#section');
  assert.equal(hasUrlFormValues(), false);
  visit('https://example.test/app/#공유=1');
  assert.equal(hasUrlFormValues(), false);

  visit('https://example.test/app/#성명=홍길동');
  clearUrlFormValues();
  assert.equal(hasUrlFormValues(), false);
  assert.equal(globalThis.window.location.pathname, '/app/');
});
