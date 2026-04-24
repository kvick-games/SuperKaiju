import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRigEditor } from "./editor/index.js";
import { mountGame } from "./game/mountGame.js";
import "./style.css";
import { createDemoCharacter } from "./three/index.js";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app");
}

let dispose = (): void => {};

if (new URLSearchParams(window.location.search).has("editor")) {
  const demo = createDemoCharacter();
  const editor = createRigEditor(root, {
    rig: demo.rig,
    onSave(definition) {
      const json = JSON.stringify(definition, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${definition.metadata?.name ?? "rig"}.trig.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    assetLoader: {
      async loadCharacter(file) {
        const loader = new GLTFLoader();
        const url = URL.createObjectURL(file);
        try {
          return await loader.loadAsync(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    },
  });

  editor.loadCharacter(demo);
  dispose = () => editor.dispose();
} else {
  dispose = mountGame(root);
}

window.addEventListener("beforeunload", () => {
  dispose();
});
