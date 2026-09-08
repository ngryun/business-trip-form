/** 폼 컨트롤을 그대로 유지하고 표시할 구역만 바꾼다. 숨긴 구역도 저장·공유·출력에 포함된다. */
export function setupFormTabs(form: HTMLFormElement): void {
  const tabs = [...form.querySelectorAll<HTMLButtonElement>('[data-form-tab]')];
  const scroller = form.querySelector<HTMLElement>('.form-section-scroll');
  function activate(tab: HTMLButtonElement, focus = false): void {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !selected;
    }
    if (scroller) scroller.scrollTop = 0;
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      let next: number;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[next], true);
    });
  });
  // 브라우저 유효성 검사 시 숨겨진 필드도 해당 탭을 열어 찾을 수 있게 한다.
  form.addEventListener('invalid', (event) => {
    const target = event.target as HTMLElement;
    const panel = target.closest<HTMLElement>('.form-tab-panel');
    const tab = tabs.find((item) => item.getAttribute('aria-controls') === panel?.id);
    if (tab && panel?.hidden) activate(tab);
  }, true);
  form.addEventListener('reset', () => activate(tabs[0]));
}
