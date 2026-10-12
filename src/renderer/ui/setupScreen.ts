/**
 * First-launch key setup. The passphrase controls at the top of this file are
 * also used by the key-change wizard in settingsDialog.ts.
 *
 * Passphrases exist only in password inputs and in the argument of one IPC
 * call. They are never logged, stored, or written into the DOM as text. The
 * inputs are emptied as soon as the operation that needed them has finished.
 */
import '../css/setup.css';
import type { KeyState, Result, SealpageApi } from '../../shared/ipc';
import { field } from './dialogs';
import { clear, h, icon } from './dom';

export const MIN_PASSPHRASE_LENGTH = 8;

const INTRO = 'Sealpage encrypts every document with a key made from one passphrase. Set it once; you will not be asked again on this computer.';
const LOCKED_OUT = 'A key file exists but cannot be used by this Windows account. To open your existing documents, use “I already have Sealpage files”.';
const UNAVAILABLE = 'Windows secret storage is not available, so a key cannot be stored. Sealpage cannot continue.';
const RESTORE_HINT = 'Enter the passphrase your files were encrypted with, then choose any one of those files. Sealpage uses it to rebuild the same key on this computer.';
const ACK_TEXT = 'I understand that a lost passphrase means permanently lost files.';
const DERIVING = 'Deriving key… this takes a moment.';
const SETUP_FAILED = 'The key could not be set up. Try again.';

/** Length in characters (code points), so an emoji counts once. */
export function passphraseLength(value: string): number {
  return Array.from(value).length;
}

export type StrengthTone = 'short' | 'fair' | 'good' | 'strong';

/** The strength line. Based on length only. */
export function describeStrength(length: number): { text: string; tone: StrengthTone } {
  if (length < MIN_PASSPHRASE_LENGTH) return { text: 'Too short (minimum 8 characters)', tone: 'short' };
  if (length < 12) return { text: 'Acceptable', tone: 'fair' };
  if (length < 20) return { text: 'Good', tone: 'good' };
  return { text: 'Strong — a long phrase of several words is ideal', tone: 'strong' };
}

/** A password input that never autocompletes or spell-checks. */
export function passphraseInput(onInput?: () => void): HTMLInputElement {
  const input = h('input', {
    class: 'sp-input',
    type: 'password',
    autocomplete: 'off',
    oninput: onInput ? () => onInput() : undefined,
  });
  // Set as a property: h() skips false-valued props.
  input.spellcheck = false;
  return input;
}

/** The "Show" toggle. It switches every input returned by `targets` between hidden and plain text. */
export function showToggle(targets: () => HTMLInputElement[]): HTMLButtonElement {
  let shown = false;
  const glyph = h('span', { class: 'sp-show-glyph' }, icon('eye'));
  const button: HTMLButtonElement = h(
    'button',
    {
      class: 'sp-btn sp-btn-ghost sp-show-toggle',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        shown = !shown;
        for (const input of targets()) input.type = shown ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(shown));
        glyph.replaceChildren(icon(shown ? 'eye-off' : 'eye'));
      },
    },
    glyph,
    'Show',
  );
  return button;
}

/** A right-aligned row holding the Show toggle. */
export function showRow(targets: () => HTMLInputElement[]): HTMLElement {
  return h('div', { class: 'sp-show-row' }, showToggle(targets));
}

export interface PassphraseSet {
  readonly el: HTMLElement;
  readonly first: HTMLInputElement;
  readonly second: HTMLInputElement;
  readonly inputs: HTMLInputElement[];
  /** The first passphrase has the minimum length and both copies match. */
  isValid(): boolean;
  /** Empty both inputs. */
  clear(): void;
}

/**
 * A new passphrase with its repeat: the strength line under the first field,
 * and the mismatch message under the second.
 */
export function passphraseSet(opts: { firstLabel: string; secondLabel: string; onChange: () => void }): PassphraseSet {
  const strength = h('span', { class: 'sp-strength', 'aria-live': 'polite' });
  const mismatch = h('span', { class: 'sp-error-text' });

  const refresh = (): void => {
    const s = describeStrength(passphraseLength(first.value));
    strength.textContent = s.text;
    strength.className = `sp-strength is-${s.tone}`;
    const differ = second.value !== '' && second.value !== first.value;
    mismatch.textContent = differ ? 'The passphrases do not match.' : '';
    second.classList.toggle('is-invalid', differ);
    second.setAttribute('aria-invalid', String(differ));
  };
  const changed = (): void => {
    refresh();
    opts.onChange();
  };
  const first = passphraseInput(changed);
  const second = passphraseInput(changed);

  const el = h(
    'div',
    { class: 'sp-passphrase-set' },
    h('label', { class: 'sp-field' }, h('span', { class: 'sp-label' }, opts.firstLabel), first, strength),
    h('label', { class: 'sp-field' }, h('span', { class: 'sp-label' }, opts.secondLabel), second, mismatch),
  );
  refresh();

  return {
    el,
    first,
    second,
    inputs: [first, second],
    isValid: () => passphraseLength(first.value) >= MIN_PASSPHRASE_LENGTH && first.value === second.value,
    clear: () => {
      first.value = '';
      second.value = '';
      refresh();
    },
  };
}

/** The warning that must always be visible wherever a passphrase is chosen. */
export function noRecoveryWarning(): HTMLElement {
  return h(
    'div',
    { class: 'sp-warning-box sp-no-recovery', role: 'note' },
    icon('shield-alert'),
    h(
      'div',
      { class: 'sp-no-recovery-text' },
      h('strong', { class: 'sp-no-recovery-title' }, 'There is no recovery.'),
      h('p', null, 'If you forget this passphrase, your files are permanently unreadable. Nobody — including the makers of Sealpage — can recover them. Write it down and keep it somewhere safe.'),
    ),
  );
}

/** A required acknowledgement checkbox. `onChange` runs whenever it toggles. */
export function acknowledgement(text: string, onChange: () => void): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'sp-checkbox', type: 'checkbox', onchange: () => onChange() });
  return { el: h('label', { class: 'sp-check-row sp-ack' }, input, h('span', null, text)), input };
}

/** A failure the renderer itself saw (the IPC call threw). The message is ours, not the key store's. */
export function unexpectedFailure(message: string): { ok: false; code: 'io-error'; message: string } {
  return { ok: false, code: 'io-error', message };
}

// ---------------------------------------------------------------------------
// First-launch screen
// ---------------------------------------------------------------------------

/** Show the first-launch key setup screen; resolves once a key is ready. */
export function showSetupScreen(root: HTMLElement, api: SealpageApi, state: KeyState): Promise<void> {
  return new Promise<void>((resolve) => {
    const screen = h('div', { class: 'sp-setup-screen' });
    const card = h(
      'div',
      { class: 'sp-setup-card sp-scroll', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sp-setup-title' },
      h('div', { class: 'sp-setup-mark' }, icon('lock', '2.4em')),
      h('h1', { id: 'sp-setup-title', class: 'sp-setup-title' }, 'Set up Sealpage'),
      h('p', { class: 'sp-setup-intro' }, INTRO),
      state === 'locked-out' ? h('div', { class: 'sp-info-box' }, icon('info'), h('span', null, LOCKED_OUT)) : null,
      state === 'unavailable' ? h('div', { class: 'sp-danger-box', role: 'alert' }, icon('alert'), h('span', null, UNAVAILABLE)) : null,
    );
    screen.appendChild(card);
    root.appendChild(screen);

    // Without secret storage the app cannot continue: no form, and the promise never resolves.
    if (state === 'unavailable') return;

    const form = setupForm(
      api,
      () => {
        screen.remove();
        resolve();
      },
      state === 'locked-out' ? 'restore' : 'create',
    );
    card.appendChild(form.el);
    form.focus();
  });
}

interface SetupForm {
  readonly el: HTMLFormElement;
  focus(): void;
}

function setupForm(api: SealpageApi, done: () => void, initialMode: 'create' | 'restore' = 'create'): SetupForm {
  type Mode = 'create' | 'restore';
  // an unusable key file means there are existing documents: offer to restore that key first
  let mode: Mode = initialMode;
  let busy = false;
  let set: PassphraseSet | null = null;
  let single: HTMLInputElement | null = null;

  const errorText = h('p', { class: 'sp-error-text', role: 'alert' });
  const busyText = h('p', { class: 'sp-hint sp-setup-busy', role: 'status' });
  const ack = acknowledgement(ACK_TEXT, () => refresh());
  const submit = h('button', { class: 'sp-btn sp-btn-primary sp-setup-submit', type: 'submit', disabled: true });
  const createTab = h('button', { type: 'button', onclick: () => setMode('create') }, 'Create a new key');
  const restoreTab = h('button', { type: 'button', onclick: () => setMode('restore') }, 'I already have Sealpage files');
  const fields = h('div', { class: 'sp-setup-fields' });

  const fieldset = h(
    'fieldset',
    { class: 'sp-setup-fieldset' },
    h('div', { class: 'sp-segmented sp-setup-switch', role: 'group', 'aria-label': 'Key' }, createTab, restoreTab),
    fields,
    noRecoveryWarning(),
    ack.el,
    errorText,
    submit,
    busyText,
  );
  const el = h(
    'form',
    {
      class: 'sp-setup-form',
      novalidate: true,
      onsubmit: (event: Event) => {
        event.preventDefault();
        void submitSetup();
      },
    },
    fieldset,
  );

  const inputsInUse = (): HTMLInputElement[] => (set ? set.inputs : single ? [single] : []);

  const clearPassphrases = (): void => {
    if (set) set.clear();
    else if (single) single.value = '';
  };

  const valid = (): boolean => {
    if (!ack.input.checked) return false;
    return mode === 'create' ? set !== null && set.isValid() : single !== null && single.value !== '';
  };

  const refresh = (): void => {
    submit.disabled = busy || !valid();
  };

  const modeButtons = (): void => {
    createTab.classList.toggle('is-active', mode === 'create');
    restoreTab.classList.toggle('is-active', mode === 'restore');
    createTab.setAttribute('aria-pressed', String(mode === 'create'));
    restoreTab.setAttribute('aria-pressed', String(mode === 'restore'));
  };

  const renderFields = (): void => {
    clear(fields);
    if (mode === 'create') {
      const created = passphraseSet({ firstLabel: 'Passphrase', secondLabel: 'Repeat passphrase', onChange: refresh });
      set = created;
      single = null;
      fields.append(created.el, showRow(inputsInUse));
      submit.textContent = 'Create key';
    } else {
      set = null;
      const input = passphraseInput(refresh);
      single = input;
      fields.append(h('p', { class: 'sp-hint' }, RESTORE_HINT), field('Passphrase', input), showRow(inputsInUse));
      submit.textContent = 'Choose a file and restore key';
    }
  };

  const focusFirst = (): void => {
    (set ? set.first : single)?.focus();
  };

  const setMode = (next: Mode): void => {
    if (busy || next === mode) return;
    clearPassphrases();
    mode = next;
    modeButtons();
    renderFields();
    refresh();
    focusFirst();
  };

  const submitSetup = async (): Promise<void> => {
    if (busy || !valid()) return;
    busy = true;
    errorText.textContent = '';
    busyText.textContent = DERIVING;
    fieldset.disabled = true;
    const passphrase = set ? set.first.value : single ? single.value : '';

    let res: Result;
    try {
      res = mode === 'create' ? await api.keySetup(passphrase) : await api.keyRestore(passphrase);
    } catch {
      res = unexpectedFailure(SETUP_FAILED);
    }
    clearPassphrases();

    if (res.ok) {
      done();
      return;
    }
    busy = false;
    fieldset.disabled = false;
    busyText.textContent = '';
    // A cancelled file picker is not an error: the user simply chose not to continue.
    errorText.textContent = res.code === 'cancelled' ? '' : res.message;
    refresh();
    focusFirst();
  };

  renderFields();
  modeButtons();
  refresh();

  return { el, focus: focusFirst };
}
