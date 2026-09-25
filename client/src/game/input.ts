/** Keyboard / mouse state with pointer lock handling. */
export class Input {
  keys = new Set<string>();
  /** Keys pressed since last consume (edge triggered) */
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  buttons = new Set<number>();
  /** Mouse buttons pressed this frame (cleared every frame). */
  clicked = new Set<number>();
  /** Mouse buttons pressed since the last game tick (cleared every tick, so no click is lost between ticks). */
  tickClicked = new Set<number>();
  wheel = 0;
  locked = false;
  sensitivity = 0.0022;
  /** When false (UI open), game input is ignored. */
  enabled = true;
  private lastKeyTime = new Map<string, number>();
  /** Double-tapped keys since the last game tick (cleared every tick). */
  doubleTapped = new Set<string>();
  onLockChange: (locked: boolean) => void = () => {};
  /** Called when a pointer lock request is refused by the browser. */
  onLockError: () => void = () => {};
  /** Whether the game currently wants the pointer locked (a pending request may resolve after unlock()). */
  private wantLock = false;
  private abort = new AbortController();

  constructor(private canvas: HTMLCanvasElement) {
    const opts = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (isTyping(e)) return;
      if (['Space', 'Tab', 'F1', 'F3', 'F5', 'Slash', 'KeyT', 'Quote', 'F2', 'F11'].includes(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        const now = performance.now();
        const last = this.lastKeyTime.get(e.code) ?? 0;
        if (now - last < 280) this.doubleTapped.add(e.code);
        this.lastKeyTime.set(e.code, now);
      }
      this.keys.add(e.code);
    }, opts);
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    }, opts);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    }, opts);
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
      this.tickClicked.add(e.button);
      e.preventDefault();
    }, opts);
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
    }, opts);
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against browser pointer-lock jumps
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }, opts);
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true, signal: this.abort.signal },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked && !this.wantLock) {
        // A lock request resolved after the game asked to unlock (e.g. a screen opened meanwhile)
        document.exitPointerLock();
        return;
      }
      if (!locked) this.wantLock = false;
      this.locked = locked;
      if (!this.locked) {
        this.buttons.clear();
        this.keys.clear();
      }
      this.onLockChange(this.locked);
    }, opts);
  }

  lock() {
    this.wantLock = true;
    if (this.locked) return;
    const fail = () => {
      if (this.wantLock && !this.locked) {
        this.wantLock = false;
        this.onLockError();
      }
    };
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function')
      p.catch(() => {
        if (!this.wantLock) return;
        const p2 = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (p2 && typeof p2.catch === 'function') p2.catch(fail);
      });
  }

  unlock() {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Remove all event listeners (the game is being torn down). */
  dispose() {
    this.abort.abort();
    this.wantLock = false;
  }

  down(code: string) {
    return this.enabled && this.keys.has(code);
  }

  consumePressed(code: string) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  consumeDoubleTap(code: string) {
    const had = this.doubleTapped.has(code);
    this.doubleTapped.delete(code);
    return had;
  }

  /** End of a game tick: drop tick-level edge events that were not consumed. */
  endTick() {
    this.tickClicked.clear();
    this.doubleTapped.clear();
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
