import type { PlayerInputState } from "../multiplayer/protocol";

export interface PlayerInputSource {
  isDown(code: string): boolean;
  isMouseDown(button: number): boolean;
  consumeMouseDelta(): { x: number; y: number };
}

export class InputController {
  private readonly keys = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private pointerX = window.innerWidth / 2;
  private pointerY = window.innerHeight / 2;
  private lookCaptureEnabled = false;
  private primaryActionQueued = false;
  private restartQueued = false;

  constructor(private readonly target: HTMLElement) {
    this.target.tabIndex = 0;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    this.target.addEventListener("contextmenu", this.onContextMenu);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestPointerLock(): void {
    this.lookCaptureEnabled = true;
    this.target.focus();

    if (!this.pointerLocked) {
      this.target.requestPointerLock().catch(() => {
        this.lookCaptureEnabled = true;
      });
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) {
      document.exitPointerLock();
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  consumeMouseDelta(): { x: number; y: number } {
    let fallbackX = 0;
    let fallbackY = 0;

    if (!this.pointerLocked && this.lookCaptureEnabled) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      fallbackX = ((this.pointerX - centerX) / Math.max(1, centerX)) * 8.5;
      fallbackY = ((this.pointerY - centerY) / Math.max(1, centerY)) * 5.8;
    }

    const delta = { x: this.mouseDeltaX + fallbackX, y: this.mouseDeltaY + fallbackY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  queuePrimaryAction(): void {
    this.primaryActionQueued = true;
  }

  consumePrimaryAction(): boolean {
    const queued = this.primaryActionQueued;
    this.primaryActionQueued = false;
    return queued;
  }

  consumeRestart(): boolean {
    const queued = this.restartQueued;
    this.restartQueued = false;
    return queued;
  }

  createNetworkInputState(sequence: number): PlayerInputState {
    const mouseDelta = this.consumeMouseDelta();
    return {
      sequence,
      keys: [...this.keys],
      mouseButtons: [...this.mouseButtons],
      mouseDeltaX: mouseDelta.x,
      mouseDeltaY: mouseDelta.y,
    };
  }

  clearCombatInputs(): void {
    this.mouseButtons.delete(0);
    this.mouseButtons.delete(2);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);

    if (event.code === "Enter") {
      this.primaryActionQueued = true;
    }

    if (event.code === "KeyR") {
      this.restartQueued = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;

    if (!this.pointerLocked) {
      if (this.lookCaptureEnabled && event.buttons !== 0) {
        this.mouseDeltaX += event.movementX;
        this.mouseDeltaY += event.movementY;
      }
      return;
    }

    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.lookCaptureEnabled = true;
    this.target.focus();
    this.mouseButtons.add(event.button);

    if (event.button === 0 && !this.pointerLocked) {
      this.requestPointerLock();
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.mouseButtons.delete(event.button);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.pointerX = window.innerWidth / 2;
    this.pointerY = window.innerHeight / 2;
  };
}
