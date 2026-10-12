/**
 * Tab strip: one tab per open document, drag to reorder, a context menu and a
 * "+" button. Rebuilt on every tabs / activeTab event (cheap, and it keeps no
 * state of its own apart from the drag insertion marker).
 */
import '../css/tabs.css';
import type { AppController, TabInfo } from '../app/controller';
import { type PopupItem, showMenu } from './dialogs';
import { h, icon } from './dom';

/** Drag-and-drop type for reordering tabs. The drag data is the tab id and nothing else. */
const TAB_DRAG_TYPE = 'application/x-sealpage-tab';

export function mountTabs(container: HTMLElement, app: AppController): void {
  const strip = h('div', { class: 'sp-tabs', role: 'tablist', 'aria-label': 'Open documents' });
  container.replaceChildren(strip);

  /** Insertion indicator shown while a tab is dragged over the strip. */
  let marker: HTMLElement | null = null;

  const tabElements = (): HTMLElement[] => Array.from(strip.querySelectorAll<HTMLElement>(':scope > .sp-tab'));

  /** Where a drop at this x position would insert, as an index into the current tab list. */
  const insertionIndex = (clientX: number): number => {
    const els = tabElements();
    const i = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientX < r.left + r.width / 2;
    });
    return i < 0 ? els.length : i;
  };

  const hideMarker = (): void => {
    marker?.remove();
    marker = null;
  };

  const showMarker = (index: number): void => {
    const els = tabElements();
    let x = 0;
    if (index < els.length) {
      x = els[index]!.offsetLeft;
    } else {
      const last = els[els.length - 1];
      x = last ? last.offsetLeft + last.offsetWidth : 0;
    }
    if (!marker) {
      marker = h('div', { class: 'sp-tab-drop' });
      strip.appendChild(marker);
    }
    marker.style.left = `${x}px`;
  };

  const tabMenu = (tab: TabInfo, x: number, y: number): void => {
    const closeEach = async (ids: string[]): Promise<void> => {
      for (const id of ids) {
        if (!(await app.closeTab(id))) break; // the user cancelled: stop here
      }
    };
    const others = app.tabs.filter((t) => t.id !== tab.id).map((t) => t.id);
    const everything = app.tabs.map((t) => t.id);
    const items: PopupItem[] = [
      { label: 'Save', icon: 'save', onSelect: () => void app.save(tab.id) },
      { label: 'Close', icon: 'close', onSelect: () => void app.closeTab(tab.id) },
      { label: 'Close others', onSelect: () => void closeEach(others) },
      { label: 'Close all', onSelect: () => void closeEach(everything) },
      { type: 'separator' },
      {
        label: 'Show in Explorer',
        icon: 'folder-open',
        disabled: tab.path === null,
        onSelect: () => {
          if (tab.path) void app.api.revealInExplorer(tab.path);
        },
      },
    ];
    showMenu(items, { x, y });
  };

  const tabElement = (tab: TabInfo, active: boolean): HTMLElement => {
    const close = h(
      'button',
      {
        class: 'sp-icon-btn sp-tab-close',
        type: 'button',
        title: 'Close (Ctrl+W)',
        'aria-label': `Close ${tab.title}`,
        tabIndex: -1,
        // keep focus in the document
        onmousedown: (event: MouseEvent) => event.preventDefault(),
        onclick: (event: MouseEvent) => {
          event.stopPropagation();
          void app.closeTab(tab.id);
        },
      },
      icon('close', '0.95em'),
    );
    return h(
      'div',
      {
        class: ['sp-tab', active && 'is-active'],
        role: 'tab',
        'aria-selected': String(active),
        title: tab.path ?? 'Not saved to a file yet',
        draggable: 'true',
        dataset: { tabId: tab.id },
        onclick: () => app.activateTab(tab.id),
        onmousedown: (event: MouseEvent) => {
          // a middle click must not start the browser's auto-scroll
          if (event.button === 1) event.preventDefault();
        },
        onauxclick: (event: MouseEvent) => {
          if (event.button !== 1) return;
          event.preventDefault();
          void app.closeTab(tab.id);
        },
        oncontextmenu: (event: MouseEvent) => {
          event.preventDefault();
          tabMenu(tab, event.clientX, event.clientY);
        },
        ondragstart: (event: DragEvent) => {
          if (!event.dataTransfer) return;
          event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
          event.dataTransfer.effectAllowed = 'move';
          (event.currentTarget as HTMLElement).classList.add('is-dragging');
        },
        ondragend: (event: DragEvent) => {
          (event.currentTarget as HTMLElement).classList.remove('is-dragging');
          hideMarker();
        },
      },
      h('span', { class: 'sp-tab-title' }, tab.title),
      tab.dirty ? h('span', { class: 'sp-tab-dirty', title: 'Unsaved changes' }, '•') : null,
      close,
    );
  };

  const plus = h(
    'button',
    {
      class: 'sp-icon-btn sp-tab-new',
      type: 'button',
      title: 'New document (Ctrl+N)',
      'aria-label': 'New document',
      tabIndex: -1,
      onmousedown: (event: MouseEvent) => event.preventDefault(),
      onclick: () => app.newDocument(),
    },
    icon('plus', '1em'),
  );

  const render = (): void => {
    const keep = strip.scrollLeft;
    const activeId = app.activeTab?.id ?? null;
    marker = null; // replaceChildren removes it
    strip.replaceChildren(...app.tabs.map((t) => tabElement(t, t.id === activeId)), plus);
    strip.scrollLeft = keep;
  };

  /** Scroll the strip just enough to show the active tab. */
  const revealActive = (): void => {
    const el = strip.querySelector<HTMLElement>('.sp-tab.is-active');
    if (!el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  };

  // The mouse wheel scrolls the strip sideways.
  strip.addEventListener(
    'wheel',
    (event) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    },
    { passive: false },
  );

  // Drag to reorder: the insertion marker follows the pointer.
  strip.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    showMarker(insertionIndex(event.clientX));
  });
  strip.addEventListener('dragleave', (event) => {
    const r = strip.getBoundingClientRect();
    if (event.clientX <= r.left || event.clientX >= r.right || event.clientY <= r.top || event.clientY >= r.bottom) hideMarker();
  });
  strip.addEventListener('drop', (event) => {
    if (!event.dataTransfer) return;
    const id = event.dataTransfer.getData(TAB_DRAG_TYPE);
    if (id === '') return;
    event.preventDefault();
    const target = insertionIndex(event.clientX);
    hideMarker();
    const from = app.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    // moveTab removes the tab first, so an index after the old position shifts by one
    const to = from < target ? target - 1 : target;
    if (to !== from) app.moveTab(id, to);
  });

  app.on('tabs', () => render());
  app.on('activeTab', () => {
    render();
    revealActive();
  });
  render();
}
