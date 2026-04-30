import "./style.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app");
}

const appRoot = root;
let dispose = (): void => {};

async function mountEditor(): Promise<() => void> {
  const [{ GLTFLoader }, { createRigEditor }, { createDemoCharacter }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("./editor/index.js"),
    import("./three/index.js"),
  ]);
  const demo = createDemoCharacter();
  const editor = createRigEditor(appRoot, {
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
  return () => editor.dispose();
}

async function bootstrap(): Promise<void> {
  if (new URLSearchParams(window.location.search).has("editor")) {
    dispose = await mountEditor();
    return;
  }

  const { mountGame } = await import("./game/mountGame.js");
  dispose = await mountGame(appRoot);
}

void bootstrap();

window.addEventListener("beforeunload", () => {
  dispose();
});
