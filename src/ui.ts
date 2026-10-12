import {
  LIMITS,
  MATERIAL_PRESETS,
  PALETTES,
  PALETTE_IDS,
  type MaterialPreset,
  type Settings,
} from './settings';
import type { MotionState } from './motion';

export interface UIActions {
  shake(): void;
  togglePause(): void;
  reset(): void;
  level(): void;
  toggleMotion(): void;
  toggleFullscreen(): void;
  /** `commit` is false while a slider is still being dragged. */
  set<K extends keyof Settings>(key: K, value: Settings[K], commit: boolean): void;
  preset(name: MaterialPreset): void;
  resetSettings(): void;
}

const ICONS = {
  shake: '<path d="M4 8l-2 4 2 4"/><path d="M20 8l2 4-2 4"/><rect x="7" y="5" width="10" height="14" rx="2"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  level: '<path d="M3 17h18"/><circle cx="12" cy="11" r="3"/><path d="M12 4v2"/>',
  motion: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M3 9c-1 2-1 4 0 6"/><path d="M21 9c1 2 1 4 0 6"/>',
  fullscreen: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
};

const icon = (name: keyof typeof ICONS) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

type NumKey = keyof typeof LIMITS;
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

export class UI {
  private syncers: ((s: Settings) => void)[] = [];
  private pauseBtn: HTMLButtonElement;
  private motionBtn: HTMLButtonElement;
  private panel: HTMLElement;
  private stats: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private hidden = false;

  constructor(
    private root: HTMLElement,
    private actions: UIActions,
    settings: Settings,
  ) {
    const btn = (name: keyof typeof ICONS, label: string, onClick: () => void, extra = '') => {
      const b = el('button', { class: `tool ${extra}`, type: 'button', title: label, 'aria-label': label, html: icon(name) });
      b.addEventListener('click', onClick);
      return b;
    };

    this.pauseBtn = btn('pause', 'Pause (P)', () => actions.togglePause());
    this.motionBtn = btn('motion', 'Use phone motion', () => actions.toggleMotion(), 'motion');
    this.motionBtn.hidden = true;
    const toolbar = el('nav', { class: 'toolbar', 'aria-label': 'Controls' }, [
      btn('shake', 'Shake (Space)', () => actions.shake(), 'primary'),
      this.pauseBtn,
      btn('reset', 'Respawn objects (R)', () => actions.reset()),
      btn('level', 'Level the box (L)', () => actions.level()),
      this.motionBtn,
      btn('fullscreen', 'Fullscreen (F)', () => actions.toggleFullscreen(), 'fs'),
      btn('settings', 'Settings (S)', () => this.togglePanel()),
    ]);
    if (!document.fullscreenEnabled) toolbar.querySelector('.fs')?.remove();

    this.panel = this.buildPanel();
    this.stats = el('div', { class: 'stats', 'aria-live': 'off' });
    this.stats.hidden = true;
    this.toastEl = el('div', { class: 'toast', role: 'status' });

    root.append(toolbar, this.panel, this.stats, this.toastEl);
    this.sync(settings);
  }

  sync(s: Settings): void {
    for (const f of this.syncers) f(s);
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.innerHTML = icon(paused ? 'play' : 'pause');
    this.pauseBtn.title = paused ? 'Resume (P)' : 'Pause (P)';
    this.pauseBtn.setAttribute('aria-label', this.pauseBtn.title);
    this.pauseBtn.classList.toggle('on', paused);
  }

  setMotion(state: MotionState): void {
    // Desktop browsers expose the API without sensors, so only offer it on touch devices.
    const show = state !== 'unsupported' && matchMedia('(pointer: coarse)').matches;
    this.motionBtn.hidden = !show;
    this.motionBtn.classList.toggle('on', state === 'on');
    this.motionBtn.classList.toggle('pulse', state === 'needs-permission');
    this.motionBtn.title =
      state === 'on' ? 'Stop using phone motion (M)' : state === 'insecure' ? 'Phone motion needs HTTPS' : 'Use phone motion (M)';
    this.motionBtn.setAttribute('aria-label', this.motionBtn.title);
    this.motionBtn.setAttribute('aria-pressed', String(state === 'on'));
  }

  setStats(text: string | null): void {
    this.stats.hidden = text === null;
    if (text !== null) this.stats.textContent = text;
  }

  toast(message: string, ms = 2600): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  togglePanel(open = !this.panel.classList.contains('open')): void {
    this.panel.classList.toggle('open', open);
    this.panel.setAttribute('aria-hidden', String(!open));
    this.panel.inert = !open;
    if (open) (this.panel.querySelector('.close') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  toggleHidden(): void {
    this.hidden = !this.hidden;
    this.root.classList.toggle('ui-hidden', this.hidden);
    if (this.hidden) this.togglePanel(false);
  }

  private buildPanel(): HTMLElement {
    const a = this.actions;
    const closeBtn = el('button', { class: 'close', type: 'button', 'aria-label': 'Close settings', html: icon('close') });
    closeBtn.addEventListener('click', () => this.togglePanel(false));

    const section = (title: string, ...rows: HTMLElement[]) =>
      el('section', {}, [el('h2', {}, [title]), ...rows]);

    const slider = (key: NumKey, label: string, fmt: (v: number) => string = (v) => v.toFixed(2)) => {
      const lim = LIMITS[key];
      const id = `s-${key}`;
      const input = el('input', { type: 'range', id, min: String(lim.min), max: String(lim.max), step: String(lim.step) });
      const out = el('output', { for: id });
      input.addEventListener('input', () => {
        out.textContent = fmt(+input.value);
        a.set(key, +input.value, false);
      });
      input.addEventListener('change', () => a.set(key, +input.value, true));
      this.syncers.push((s) => {
        input.value = String(s[key]);
        out.textContent = fmt(s[key]);
      });
      return el('div', { class: 'row slider' }, [el('label', { for: id }, [label]), out, input]);
    };

    const toggle = (key: BoolKey, label: string) => {
      const id = `t-${key}`;
      const input = el('input', { type: 'checkbox', id, role: 'switch' });
      input.addEventListener('change', () => a.set(key, input.checked, true));
      this.syncers.push((s) => (input.checked = s[key]));
      return el('div', { class: 'row toggle' }, [el('label', { for: id }, [label]), input]);
    };

    const segmented = <K extends keyof Settings>(key: K, label: string, options: [Settings[K], string][]) => {
      const group = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
      const buttons = options.map(([value, text]) => {
        const b = el('button', { type: 'button', role: 'radio' }, [text]);
        b.addEventListener('click', () => a.set(key, value, true));
        group.append(b);
        return [value, b] as const;
      });
      this.syncers.push((s) => {
        for (const [v, b] of buttons) {
          b.setAttribute('aria-checked', String(s[key] === v));
          b.classList.toggle('active', s[key] === v);
        }
      });
      return el('div', { class: 'row stack' }, [el('span', { class: 'label' }, [label]), group]);
    };

    const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Palette' });
    const swatchButtons = PALETTE_IDS.map((id) => {
      const colors = PALETTES[id];
      const bg = colors.length
        ? `linear-gradient(135deg, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`
        : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';
      const b = el('button', { type: 'button', role: 'radio', title: id, 'aria-label': `${id} palette`, style: `background:${bg}` });
      b.addEventListener('click', () => a.set('palette', id, true));
      swatches.append(b);
      return [id, b] as const;
    });
    this.syncers.push((s) => {
      for (const [id, b] of swatchButtons) {
        b.classList.toggle('active', s.palette === id);
        b.setAttribute('aria-checked', String(s.palette === id));
      }
    });

    const presets = el('div', { class: 'chips' });
    for (const name of Object.keys(MATERIAL_PRESETS) as MaterialPreset[]) {
      const b = el('button', { type: 'button' }, [name]);
      b.addEventListener('click', () => a.preset(name));
      presets.append(b);
    }

    const resetBtn = el('button', { type: 'button', class: 'reset-settings' }, ['Restore defaults']);
    resetBtn.addEventListener('click', () => a.resetSettings());

    const help = el('div', {
      class: 'help',
      html: `<p><b>Drag</b> to tilt the box · <b>tap</b> to blast · <b>Shift/right-drag</b> or a second finger to stir.</p>
        <p><kbd>←↑→↓</kbd> tilt · <kbd>Space</kbd> shake · <kbd>P</kbd> pause · <kbd>R</kbd> respawn · <kbd>L</kbd> level · <kbd>M</kbd> motion · <kbd>F</kbd> fullscreen · <kbd>H</kbd> hide UI · <kbd>S</kbd> settings</p>`,
    });

    const panel = el('aside', { class: 'panel', 'aria-label': 'Settings', 'aria-hidden': 'true' }, [
      el('header', {}, [el('h1', {}, ['Settings']), closeBtn]),
      el('div', { class: 'scroll' }, [
        section(
          'Objects',
          slider('count', 'Count', (v) => String(Math.round(v))),
          segmented('shape', 'Shape', [
            ['mixed', 'Mixed'],
            ['cube', 'Cubes'],
            ['sphere', 'Balls'],
            ['capsule', 'Pills'],
            ['cylinder', 'Pucks'],
          ]),
          slider('size', 'Size', (v) => `${v.toFixed(2)}×`),
        ),
        section(
          'Look',
          el('div', { class: 'row stack' }, [el('span', { class: 'label' }, ['Palette']), swatches]),
          el('div', { class: 'row stack' }, [el('span', { class: 'label' }, ['Material']), presets]),
          slider('roughness', 'Roughness'),
          slider('metalness', 'Metalness'),
          slider('clearcoat', 'Clearcoat'),
          segmented('backdrop', 'Box', [
            ['charcoal', 'Charcoal'],
            ['navy', 'Navy'],
            ['paper', 'Paper'],
          ]),
        ),
        section(
          'Lighting',
          slider('lightIntensity', 'Key light'),
          slider('envIntensity', 'Reflections'),
          toggle('shadows', 'Shadows'),
          toggle('lightFollowsTilt', 'Light follows tilt'),
          toggle('parallax', 'Parallax'),
        ),
        section(
          'Physics',
          slider('gravity', 'Gravity', (v) => String(Math.round(v))),
          slider('bounciness', 'Bounciness'),
          slider('friction', 'Friction'),
          slider('shakeSensitivity', 'Motion shake boost', (v) => `${v.toFixed(2)}×`),
        ),
        section(
          'Device',
          segmented('quality', 'Quality', [
            ['auto', 'Auto'],
            ['low', 'Low'],
            ['medium', 'Medium'],
            ['high', 'High'],
          ]),
          toggle('invertMotion', 'Invert phone motion'),
          toggle('keepAwake', 'Keep screen awake'),
          toggle('showStats', 'Show stats'),
        ),
        help,
        resetBtn,
      ]),
    ]);
    panel.inert = true;
    return panel;
  }
}
