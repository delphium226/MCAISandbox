/** Keyboard / mouse state with pointer lock handling. */
export class Input {
  keys = new Set<string>();
  /** Keys pressed since last consume (edge triggered) */
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  buttons = new Set<number>();
  clicked = new Set<number>();
  wheel = 0;
  locked = false;
  sensitivity = 0.0022;
  /** When false (UI open), game input is ignored. */
  enabled = true;
  private lastKeyTime = new Map<string, number>();
  doubleTapped = new Set<string>();
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
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
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against browser pointer-lock jumps
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.buttons.clear();
        this.keys.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => this.canvas.requestPointerLock());
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
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

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.doubleTapped.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
