import type { PlayerInputSource } from "../game/Input";
import type { PlayerInputState } from "./protocol";

export class RemoteInputController implements PlayerInputSource {
  private readonly keys = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private lastSequence = -1;

  applyState(state: PlayerInputState): void {
    if (state.sequence <= this.lastSequence) {
      return;
    }

    this.lastSequence = state.sequence;
    this.keys.clear();
    for (const key of state.keys) {
      this.keys.add(key);
    }

    this.mouseButtons.clear();
    for (const button of state.mouseButtons) {
      this.mouseButtons.add(button);
    }

    this.mouseDeltaX += state.mouseDeltaX;
    this.mouseDeltaY += state.mouseDeltaY;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  clear(): void {
    this.keys.clear();
    this.mouseButtons.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }
}
