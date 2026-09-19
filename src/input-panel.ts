/**
 * 입력칸 옆 버튼으로 여닫는 작은 판(달력·시간표).
 *
 * Popover API 로 top layer 에 띄워 사이드바의 스크롤 영역이나 미리보기 팝오버 위에 가리지 않게 한다.
 * 미지원 브라우저는 입력칸 아래 absolute 로 두는 것으로 대체한다.
 * 판은 anchor(입력칸) 아래 왼쪽에 맞추고, 화면을 벗어나면 위·왼쪽으로 옮긴다.
 */
export interface InputPanelHandle {
  panel: HTMLElement;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
}

interface InputPanelOptions {
  /** 판을 여닫는 버튼 — aria-expanded 를 함께 유지한다 */
  button: HTMLButtonElement;
  /** 판을 이 요소 아래에 붙인다. 판·버튼을 모두 품고 있어야 Esc 처리와 바깥 클릭 판별이 맞는다. */
  anchor: HTMLElement;
  /** 열릴 때마다 내용을 다시 그린다(크기를 재기 전에 호출) */
  onOpen?: () => void;
}

const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

export function attachInputPanel(panel: HTMLElement, options: InputPanelOptions): InputPanelHandle {
  const { button, anchor } = options;
  panel.classList.add('input-panel');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  let open = false;

  function place(): void {
    if (!open) return;
    const margin = 8;
    const anchorRect = anchor.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - margin - size.width));
    let top = anchorRect.bottom + 4;
    if (top + size.height > viewportHeight - margin && anchorRect.top - 4 - size.height >= margin) {
      top = anchorRect.top - 4 - size.height;
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }
  function setOpen(next: boolean): void {
    open = next;
    button.setAttribute('aria-expanded', String(next));
  }

  // 바깥 클릭·Esc 로 닫히는 top layer 판. 버튼은 popovertarget 으로 묶어 눌러서 여닫는다.
  function setupPopover(): void {
    panel.popover = 'auto';
    button.popoverTargetElement = panel;
    panel.addEventListener('beforetoggle', (event) => {
      const opening = (event as ToggleEvent).newState === 'open';
      setOpen(opening);
      if (!opening) {
        window.removeEventListener('scroll', place, { capture: true } as EventListenerOptions);
        window.removeEventListener('resize', place);
        return;
      }
      options.onOpen?.();
      // 표시되기 전에 대략 위치를 잡고, 크기가 나온 첫 프레임에 화면 안으로 보정한다.
      const anchorRect = anchor.getBoundingClientRect();
      panel.style.left = `${Math.round(anchorRect.left)}px`;
      panel.style.top = `${Math.round(anchorRect.bottom + 4)}px`;
      requestAnimationFrame(place);
      window.addEventListener('scroll', place, { capture: true, passive: true });
      window.addEventListener('resize', place);
    });
  }

  // 대체 동작: hidden 토글 + 바깥 pointerdown 으로 닫기
  const onOutside = (event: Event): void => {
    if (!anchor.contains(event.target as Node | null)) hideFallback();
  };
  function showFallback(): void {
    options.onOpen?.();
    panel.hidden = false;
    setOpen(true);
    document.addEventListener('pointerdown', onOutside, true);
  }
  function hideFallback(): void {
    document.removeEventListener('pointerdown', onOutside, true);
    if (panel.contains(document.activeElement)) button.focus();
    panel.hidden = true;
    setOpen(false);
  }
  function setupFallback(): void {
    panel.hidden = true;
    button.addEventListener('click', () => (open ? hideFallback() : showFallback()));
  }

  if (supportsPopover) setupPopover();
  else setupFallback();

  function close(): void {
    if (!open) return;
    if (supportsPopover) panel.hidePopover();
    else hideFallback();
  }
  function openPanel(): void {
    if (open) return;
    if (supportsPopover) panel.showPopover();
    else showFallback();
  }
  // Esc 는 판만 닫는다 — 바깥 팝오버(출장 일시 입력)까지 취소되지 않도록 여기서 멈춘다.
  anchor.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    button.focus();
  });

  return { panel, isOpen: () => open, open: openPanel, close };
}
