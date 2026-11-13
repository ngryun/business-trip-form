import { BUS_FARE_TABLE_DATE, busFareApplies, busFareLabel, findBusFares, findOfficialFares, findStopoverFares, formatWon, type BusFare, type OfficialFare, type OfficialFareData, type StopoverFareData } from './bus-fares';
import { alternativeRegions, regionLabel, resolveFareRoute, sameNameProvinces, sameRegion, type FareRegion, type ResolvedRegion } from './fare-region';
import { fetchLiveFares, isLiveFareEnabled, liveFareDay } from './tago-live';
import { isTagoLimitError } from './tago-response';
import { isPlaceLookupEnabled, lookupTerminalPoint } from './kakao-places';
import { naverTransitUrl } from './naver-transit';
import { withEuro } from './josa';
import type { PopoverExtrasContext } from './field-popover';
import tagoFaresJson from './data/tago-fares.json';
import stopoverFaresJson from './data/stopover-fares.json';

/**
 * 운임 탭의 금액 제안 칩 — 요금표·공식 운임(내장·실시간)·동명 지역 바꾸기·네이버지도 링크.
 * main.ts 에서 떼어 낸 화면 로직이고, 요금 계산 자체는 bus-fares·fare-region·tago-live 에 있다.
 */

const OFFICIAL_FARES = tagoFaresJson as OfficialFareData;
const STOPOVER_FARES = stopoverFaresJson as StopoverFareData;
/** 지도 검색·바꾸기 칩으로 정한 출발지·도착지의 시도 (칸 이름 → 그때의 칸 값·지역). 칸 값이 같을 때만 쓴다. */
const placeRegionHints = new Map<string, { value: string; region: FareRegion; 바꿈?: boolean }>();
/** 올 때 칸은 갈 때 칸을 거꾸로 받아 오므로, 값이 같으면 그쪽에서 정한 시도를 따른다. */
const RETURN_REGION_SOURCES: Record<string, string> = { 올때출발지: '갈때도착지', 올때도착지: '갈때출발지' };
const LIVE_FARE_DELAY_MS = 600;
/** 요금표로 자동으로 채운 운임 금액 (input name → 값). 사용자가 직접 고친 금액은 덮어쓰지 않기 위해 기억한다. */
const autoBusFares = new Map<string, string>();

export interface FareSuggestionsHandle {
  /** 출발지·도착지·교통편이 바뀌었을 때 칩과 자동 금액을 다시 계산한다 */
  sync(): void;
  /** 지도 검색으로 찾은 칸의 시도를 기억한다 (region 이 null 이면 잊는다) — 칸에는 "고성" 만 있어도 강원·경남을 가린다 */
  setRegionHint(fieldName: string, value: string, region: FareRegion | null): void;
  /** 자동으로 넣은 금액 기록을 지운다 (초기화) */
  forgetAutoAmounts(): void;
  /** 미리보기 운임 금액 팝오버에 넣을 칩 줄 */
  popoverExtras(key: string, ctx: PopoverExtrasContext): { el: HTMLElement; cleanup: () => void } | null;
}

/** 칸의 지도 검색·바꾸기 칩 시도 — 칸 값이 그때와 같을 때만. 올 때 칸은 짝이 되는 갈 때 칸의 것도 본다. */
function regionHintFor(name: string, value: string): { region: FareRegion; 바꿈?: boolean } | null {
  const text = value.trim();
  for (const key of [name, RETURN_REGION_SOURCES[name]]) {
    const hint = key ? placeRegionHints.get(key) : undefined;
    if (hint && hint.value === text) return hint;
  }
  return null;
}

/**
 * 출발지·도착지가 고성교육지원청 버스요금표(2026. 1. 13.)의 구간과 맞으면 금액을 자동으로 채우고,
 * 금액 칸 아래에 후보 칩(같은 도시의 다른 정류장 포함)을 보여준다.
 * 표에 없는 구간은 TAGO 공식 운임(내장 자료, 이어서 실시간 조회)을 제안한다. 네이버지도 길찾기 링크는 구간마다 둔다.
 * 비어 있거나 전에 자동으로 채운 금액만 바꾸고, 사용자가 직접 쓴 금액은 그대로 둔다.
 * 동명 지역(강원 고성·경남 고성, 광주광역시·경기 광주)은 시도를 정해 계산하고, 짐작해 정했으면 바꾸기 칩을 보여준다.
 */
export function setupFareSuggestions(formEl: HTMLFormElement): FareSuggestionsHandle | null {
  const wraps = [...formEl.querySelectorAll<HTMLElement>('[data-fare-suggestions]')];
  if (wraps.length === 0) return null;
  const amountInput = (direction: string): HTMLInputElement | null => {
    const el = formEl.elements.namedItem(`${direction}금액`);
    return el instanceof HTMLInputElement ? el : null;
  };
  const fieldValue = (name: string): string => (formEl.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
  const setAmount = (amount: HTMLInputElement, value: string): void => {
    autoBusFares.set(amount.name, value);
    if (amount.value === value) return;
    amount.value = value;
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    amount.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const isUntouched = (amount: HTMLInputElement): boolean =>
    !amount.value.trim() || amount.value === autoBusFares.get(amount.name);
  const markPressed = (wrap: HTMLElement, amount: HTMLInputElement): void => {
    wrap.querySelectorAll<HTMLButtonElement>('button[data-amount]').forEach((chip) => {
      const active = chip.dataset.amount === amount.value.trim();
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  };
  const officialChip = (wrap: HTMLElement, amount: HTMLInputElement, fare: OfficialFare, differs: boolean): HTMLButtonElement => {
    const value = formatWon(fare.요금);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = differs ? 'attachment-preset-chip attachment-preset-chip--warn' : 'attachment-preset-chip';
    btn.dataset.amount = value;
    btn.dataset.official = '';
    // 고속버스 등급 "고속" 은 일반 고속버스라 칩에는 "고속버스 일반" 으로 쓴다.
    const grade = fare.고속 ? `고속버스 ${fare.등급 === '고속' ? '일반' : fare.등급}` : fare.등급;
    btn.textContent = `${fare.보완 ? '보완 운임' : '공식 운임'} ${grade} ${value}${differs ? ' · 요금표와 다름' : ''}`;
    const info = fare.고속 ? '고속버스정보' : '시외버스정보';
    const source = fare.보완
      ? `경유 구간 보완 요금표(관리자 입력) · ${fare.보완.출처} ${fare.조회일} 확인${fare.보완.노선 ? ` · ${fare.보완.노선}` : ''}`
      : fare.실시간
        ? `국토교통부 ${info}(TAGO) 실시간 조회 · ${fare.조회일} 배차 기준`
        : `국토교통부 ${info}(TAGO) ${fare.조회일 ?? OFFICIAL_FARES.조회일} 조회`;
    const range = fare.최고 ? ` (배차·터미널에 따라 ${value}~${formatWon(fare.최고)}원)` : '';
    const reversed = fare.역방향 ? ' · 반대 방향 배차 기준(운임 동일)' : '';
    btn.title = `${source} · ${fare.출발}→${fare.도착} ${grade} ${value}원${range}${reversed}${differs ? '. 교육지원청 요금표와 금액이 다르니 어느 쪽을 쓸지 확인하세요.' : ''}`;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => { setAmount(amount, value); markPressed(wrap, amount); });
    return btn;
  };
  /** 교통편이 버스가 아니면(기차/KTX·항공 …) 버스 운임은 참고용으로만 보여 주고 금액을 자동으로 넣지 않는다 — 그 안내 칩. */
  const transportNote = (wrap: HTMLElement, transport: string): void => {
    if (busFareApplies(transport) || !wrap.querySelector('button[data-amount]') || wrap.querySelector('[data-transport-note]')) return;
    const note = document.createElement('span');
    note.className = 'attachment-preset-chip attachment-preset-chip--status';
    note.dataset.transportNote = '';
    note.textContent = `교통편 ${transport.trim()} · 버스 운임은 참고용 (자동 입력 안 함)`;
    note.title = `교통편이 "${transport.trim()}"이라 버스 운임을 금액에 자동으로 넣지 않습니다. 실제 지불한 운임을 입력하세요. 칩을 누르면 그 금액이 들어갑니다.`;
    wrap.prepend(note);
    wrap.hidden = false;
  };
  /**
   * 동명 지역을 짐작해 정한 칸이면 "경남 고성으로 바꾸기" 칩 — 누르면 그 칸의 시도를 기억하고 다시 계산한다.
   * 칩으로 바꾼 칸은 되돌릴 수 있게 계속 보여 준다 (지도 검색으로 정한 칸은 보여 주지 않는다).
   */
  const regionSwitchChips = (fieldName: string, label: string, region: ResolvedRegion | null, switched: boolean): HTMLButtonElement[] => {
    if (!region || !(region.추정 || switched)) return [];
    return alternativeRegions(region).map((alt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'attachment-preset-chip attachment-preset-chip--region';
      btn.dataset.regionSwitch = '';
      btn.textContent = `${label} ${regionLabel(region)} 기준 · ${withEuro(regionLabel(alt))} 바꾸기`;
      btn.title = `${label} "${region.시군}"은(는) 같은 이름의 지역이 있어 ${withEuro(regionLabel(region))} 보고 계산했습니다. ${regionLabel(alt)}이면 누르세요.`;
      btn.addEventListener('click', () => {
        placeRegionHints.set(fieldName, { value: fieldValue(fieldName).trim(), region: alt, 바꿈: true });
        sync();
      });
      return btn;
    });
  };
  // 고성교육지원청 요금표 안내는 그 표에 있는 구간일 때만 보여 준다 (다른 지역 사용자에게는 관계없는 말이다).
  const tableHint = formEl.querySelector<HTMLElement>('[data-fare-table-hint]');
  const sync = (): void => {
    let onTable = false;
    for (const wrap of wraps) {
      const direction = wrap.dataset.fareSuggestions ?? '';
      const amount = amountInput(direction);
      if (!amount) continue;
      const fromName = `${direction}출발지`;
      const toName = `${direction}도착지`;
      const from = fieldValue(fromName);
      const to = fieldValue(toName);
      const fromHint = regionHintFor(fromName, from);
      const toHint = regionHintFor(toName, to);
      const route = resolveFareRoute(from, to, { from: fromHint?.region, to: toHint?.region });
      const fares = findBusFares(route.from, route.to);
      if (fares.length > 0) onTable = true;
      // TAGO 에 없는 경유 구간(중간 정차)은 관리자가 채운 보완 요금표로 메운다.
      const tagoFares = findOfficialFares(route.from, route.to, OFFICIAL_FARES);
      const official = tagoFares.length ? tagoFares : findStopoverFares(route.from, route.to, STOPOVER_FARES);
      const transport = fieldValue(`${direction}교통편`);
      const autoFill = busFareApplies(transport);
      const previousAuto = autoBusFares.get(amount.name);
      // 교통편을 기차/KTX 등으로 바꾸면, 버스 운임으로 자동 입력했던 금액은 비운다 (직접 쓴 금액은 그대로).
      if (!autoFill && previousAuto !== undefined && amount.value === previousAuto) {
        setAmount(amount, '');
        autoBusFares.delete(amount.name);
      }
      const untouched = autoFill && isUntouched(amount);
      wrap.replaceChildren();
      if (fares.length === 0) {
        // 요금표에 없는 구간: 공식 운임이 있으면 그것을 제안하고, 없으면 자동으로 채웠던 금액만 비운다.
        if (official.length > 0) {
          official.forEach((fare) => wrap.appendChild(officialChip(wrap, amount, fare, false)));
          if (untouched) setAmount(amount, formatWon(official[0].요금));
        } else {
          if (previousAuto !== undefined && amount.value === previousAuto) setAmount(amount, '');
          autoBusFares.delete(amount.name);
        }
      } else {
        fares.forEach((fare, index) => {
          const value = formatWon(fare.요금);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'attachment-preset-chip';
          btn.dataset.amount = value;
          btn.textContent = index === 0 ? `요금표 ${busFareLabel(fare)}` : `${fare.행선지} ${value}`;
          btn.title = `고성교육지원청 버스요금표 ${BUS_FARE_TABLE_DATE} 기준 · ${fare.출발}→${fare.행선지} ${value}원${fare.환승 ? ` (${fare.환승})` : ''}`;
          btn.setAttribute('aria-pressed', 'false');
          btn.addEventListener('click', () => { setAmount(amount, value); markPressed(wrap, amount); });
          wrap.appendChild(btn);
        });
        // 공식 운임이 요금표와 다르면 경고 칩으로 함께 보여 준다 (요금표가 오래됐을 수 있으므로 비교용).
        const representative = official[0];
        if (representative && representative.요금 !== fares[0].요금) wrap.appendChild(officialChip(wrap, amount, representative, true));
        if (untouched) setAmount(amount, formatWon(fares[0].요금));
      }
      [...regionSwitchChips(fromName, '출발지', route.from, fromHint?.바꿈 ?? false), ...regionSwitchChips(toName, '도착지', route.to, toHint?.바꿈 ?? false)]
        .forEach((chip) => wrap.appendChild(chip));
      transportNote(wrap, transport);
      wrap.hidden = wrap.childElementCount === 0;
      markPressed(wrap, amount);
      // 요금표·공식 운임이 있어도 네이버지도에서 맞춰 볼 수 있게 링크는 늘 둔다
      renderNaverLink(wrap, route.from, route.to);
      renderLiveFares(wrap, amount, route, fares, transport);
    }
    if (tableHint) tableHint.hidden = !onTable;
  };
  /** 출발·도착 터미널 좌표를 찾아 네이버지도 대중교통 길찾기 링크를 보여준다. 늦게 온 앞 구간의 결과는 버린다. */
  const linkTokens = new Map<HTMLElement, number>();
  const renderNaverLink = (wrap: HTMLElement, from: FareRegion | null, to: FareRegion | null): void => {
    const token = (linkTokens.get(wrap) ?? 0) + 1;
    linkTokens.set(wrap, token);
    if (!isPlaceLookupEnabled() || !from || !to || sameRegion(from, to)) return;
    // 동명 지역만 시도를 붙여 찾는다 ("경남 고성 시외버스터미널"). 광주광역시는 "광주" 만으로 찾힌다.
    const province = (r: FareRegion): string => (sameNameProvinces(r.시군).length > 0 && r.시도 !== r.시군 ? r.시도 : '');
    void Promise.all([lookupTerminalPoint(from.시군, province(from)), lookupTerminalPoint(to.시군, province(to))]).then(([start, goal]) => {
      if (linkTokens.get(wrap) !== token || !start || !goal) return;
      const link = document.createElement('a');
      link.className = 'attachment-preset-chip attachment-preset-chip--link';
      link.href = naverTransitUrl(start, goal);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '네이버지도에서 요금 확인 ↗';
      link.title = `${start.name} → ${goal.name} 대중교통 길찾기. 시외버스 최소요금을 확인해 금액에 입력하세요.`;
      wrap.querySelectorAll('a').forEach((old) => old.remove());
      wrap.appendChild(link);
      wrap.hidden = false;
    }).catch((err) => console.error(err));
  };
  /**
   * 실시간 공식 운임: 입력이 멈추면 TAGO 를 조회해 내장 자료의 공식 운임 칩을 오늘 배차 기준 값으로 바꾼다.
   * 요금표 구간이면 금액이 다를 때만 경고 칩, 요금표에 없는 구간이면 금액도 자동으로 채운다. 실패하면 내장 자료를 그대로 둔다.
   * 요금표에 없는 구간은 조회하는 동안 "실시간 운임 조회 중…", 시외·고속버스 모두 배차가 없고 보완 요금표에도 없으면 "운임 정보 없음" 을 보여 준다 (경유 구간일 수 있다).
   */
  const liveTokens = new Map<HTMLElement, number>();
  const liveTimers = new Map<HTMLElement, number>();
  /** 이번 페이지에서 조회를 마친 구간 (시도 시군>시도 시군:날짜 → 결과) — 다시 그릴 때 "조회 중" 을 거치지 않고 바로 보여 준다 */
  const liveResults = new Map<string, OfficialFare[]>();
  /** 운임 칩 사이에 넣는 안내 문구 (조회 중·직행 노선 없음) — 누를 수 없는 칩 */
  const liveStatus = (wrap: HTMLElement, text: string, title: string): void => {
    wrap.querySelectorAll('[data-live-status]').forEach((el) => el.remove());
    const note = document.createElement('span');
    note.className = 'attachment-preset-chip attachment-preset-chip--status';
    note.dataset.liveStatus = '';
    note.textContent = text;
    note.title = title;
    wrap.insertBefore(note, wrap.querySelector('[data-region-switch], a'));
    wrap.hidden = false;
  };
  const renderLiveFares = (
    wrap: HTMLElement,
    amount: HTMLInputElement,
    route: { from: FareRegion | null; to: FareRegion | null },
    tableFares: BusFare[],
    transport: string,
  ): void => {
    const token = (liveTokens.get(wrap) ?? 0) + 1;
    liveTokens.set(wrap, token);
    window.clearTimeout(liveTimers.get(wrap));
    const { from, to } = route;
    if (!isLiveFareEnabled() || !from || !to || sameRegion(from, to)) return;
    // 날짜(한국 시간)를 넣어 두면 창을 하루 넘게 열어 둬도 그날 배차로 다시 조회한다.
    const routeKey = `${from.시도} ${from.시군}>${to.시도} ${to.시군}:${liveFareDay()}`;
    const apply = (live: OfficialFare[]): void => {
      wrap.querySelectorAll('[data-live-status]').forEach((el) => el.remove());
      if (live.length === 0) {
        // 요금표·내장 자료·보완 요금표에도 없는 구간이면, 실시간 조회로도 못 찾았다고 알려 준다.
        if (tableFares.length === 0 && !wrap.querySelector('[data-official]')) {
          liveStatus(wrap, '운임 정보 없음 · 경유 구간은 TAGO에 없을 수 있음', `국토교통부 시외버스·고속버스정보(TAGO)에 ${regionLabel(from)}→${regionLabel(to)} 배차 자료가 없습니다. TAGO 는 노선의 출발·도착 터미널 요금만 있어, 다른 곳에서 출발한 버스가 중간에 서는 경유 구간이나 갈아타는 구간은 빠져 있습니다. 네이버지도·터미널 시간표에서 요금을 확인해 입력하세요.`);
        }
        return;
      }
      wrap.querySelectorAll('[data-official]').forEach((chip) => chip.remove());
      const before = wrap.querySelector('[data-region-switch], a');
      const insert = (chip: HTMLElement): void => { wrap.insertBefore(chip, before); };
      if (tableFares.length > 0) {
        if (live[0].요금 !== tableFares[0].요금) insert(officialChip(wrap, amount, live[0], true));
      } else {
        live.forEach((fare) => insert(officialChip(wrap, amount, fare, false)));
        if (busFareApplies(transport) && isUntouched(amount)) setAmount(amount, formatWon(live[0].요금));
      }
      transportNote(wrap, transport);
      wrap.hidden = false;
      markPressed(wrap, amount);
    };
    const known = liveResults.get(routeKey);
    if (known) { apply(known); return; }
    liveTimers.set(wrap, window.setTimeout(() => {
      // 요금표 구간은 비교용이라 조용히 조회하고, 요금표에 없는 구간만 조회 중임을 보여 준다.
      if (tableFares.length === 0) liveStatus(wrap, '실시간 운임 조회 중…', '국토교통부 시외버스·고속버스정보(TAGO)에서 오늘 배차 요금을 조회하고 있습니다.');
      fetchLiveFares(from, to).then((live) => {
        liveResults.set(routeKey, live);
        if (liveTokens.get(wrap) === token) apply(live);
      }).catch((err) => {
        console.error(err);
        if (liveTokens.get(wrap) !== token) return;
        wrap.querySelectorAll('[data-live-status]').forEach((el) => el.remove());
        if (tableFares.length === 0 && !wrap.querySelector('[data-official]')) {
          if (isTagoLimitError(err)) {
            liveStatus(wrap, '실시간 조회 한도 초과', '국토교통부 시외버스·고속버스정보(TAGO) 호출 한도에 걸렸습니다. 한도는 모든 사용자가 함께 쓰고 하루 단위로 풀립니다. 네이버지도·터미널 시간표에서 요금을 확인해 입력하세요.');
          } else {
            liveStatus(wrap, '실시간 조회 실패', '국토교통부 시외버스·고속버스정보(TAGO) 조회에 실패했습니다. 잠시 뒤 다시 입력하거나 네이버지도에서 요금을 확인하세요.');
          }
        }
      });
    }, LIVE_FARE_DELAY_MS));
  };
  for (const direction of ['갈때', '올때']) {
    for (const suffix of ['출발지', '도착지', '교통편']) {
      const input = formEl.elements.namedItem(`${direction}${suffix}`);
      if (!(input instanceof HTMLInputElement)) continue;
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    }
    const amount = amountInput(direction);
    const wrap = wraps.find((w) => w.dataset.fareSuggestions === direction);
    if (amount && wrap) amount.addEventListener('input', () => markPressed(wrap, amount));
  }

  /**
   * 미리보기 운임 금액 팝오버에 사이드패널과 같은 요금 칩(요금표·공식 운임·동명 지역 바꾸기·네이버지도)을 보여 준다.
   * 사이드패널의 칩 줄을 그대로 비춰 그리므로, 실시간 조회 결과나 바꾸기로 칩이 바뀌면 팝오버도 따라 바뀐다.
   * 금액 칩은 사이드패널 칩을 누른 것과 같게 반영하고 팝오버를 닫는다.
   */
  function popoverExtras(key: string, ctx: PopoverExtrasContext): { el: HTMLElement; cleanup: () => void } | null {
    const direction = key.endsWith('금액') ? key.slice(0, -2) : '';
    const wrap = direction ? formEl.querySelector<HTMLElement>(`[data-fare-suggestions="${direction}"]`) : null;
    const amount = formEl.elements.namedItem(key);
    if (!wrap || !(amount instanceof HTMLInputElement)) return null;
    const el = document.createElement('div');
    el.className = 'field-popover__fare-chips';
    let lastAmount = amount.value;
    const mirror = (chip: Element): Element => {
      const copy = chip.cloneNode(true) as HTMLElement;
      if (!(chip instanceof HTMLButtonElement)) return copy; // 네이버지도 링크는 그대로 연다
      copy.addEventListener('click', () => {
        chip.click();
        if (chip.dataset.amount !== undefined) ctx.pick(chip.dataset.amount);
      });
      return copy;
    };
    const render = (): void => {
      el.replaceChildren(...[...wrap.children].map(mirror));
      el.hidden = el.childElementCount === 0;
      // 바꾸기 칩 등으로 금액이 다시 자동 입력되면, 손대지 않은 입력칸도 따라 바꾼다
      if (amount.value !== lastAmount && ctx.getValue() === lastAmount) ctx.setValue(amount.value);
      lastAmount = amount.value;
    };
    const observer = new MutationObserver(render);
    observer.observe(wrap, { childList: true, subtree: true, attributes: true });
    render();
    return { el, cleanup: () => observer.disconnect() };
  }

  sync();
  return {
    sync,
    setRegionHint: (fieldName, value, region) => {
      if (region) placeRegionHints.set(fieldName, { value, region });
      else placeRegionHints.delete(fieldName);
    },
    forgetAutoAmounts: () => autoBusFares.clear(),
    popoverExtras,
  };
}
