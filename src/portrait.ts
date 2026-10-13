type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'portrait') => Promise<void> };

/** Native portrait lock where supported, with a rotate-phone screen elsewhere. */
export class PortraitMode {
  blocked = false;
  onChange: (blocked: boolean) => void = () => {};
  private locking = false;

  constructor(
    private mobile: boolean,
    private guard: HTMLElement,
    private content: HTMLElement[],
  ) {
    if (!mobile) return;
    this.refresh();
    window.addEventListener('resize', this.refresh);
    window.addEventListener('orientationchange', this.refresh);
    screen.orientation?.addEventListener('change', this.refresh);
    window.addEventListener('pointerup', () => void this.lock(), { once: true });
    document.addEventListener('fullscreenchange', () => {
      this.refresh();
      if (document.fullscreenElement) void this.lock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.refresh();
        void this.lock();
      }
    });
    void this.lock();
  }

  private refresh = (): void => {
    const wasBlocked = this.blocked;
    const type = screen.orientation?.type;
    const legacy = (window as Window & { orientation?: number }).orientation;
    this.blocked = type
      ? type.startsWith('landscape')
      : typeof legacy === 'number'
        ? Math.abs(legacy) % 180 === 90
        : innerWidth > innerHeight;
    this.guard.hidden = !this.blocked;
    for (const element of this.content) element.inert = this.blocked;
    if (this.blocked !== wasBlocked) this.onChange(this.blocked);
  };

  async lock(): Promise<void> {
    const orientation = screen.orientation as LockableOrientation | undefined;
    if (!this.mobile || this.locking || !orientation?.lock) return;
    this.locking = true;
    try {
      await orientation.lock('portrait');
    } catch {
      // Some browsers require fullscreen; others cannot lock orientation.
      // The guard keeps the app in portrait until the phone is upright.
    } finally {
      this.locking = false;
      this.refresh();
    }
  }
}
