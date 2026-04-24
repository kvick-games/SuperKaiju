const STYLE_ID = "three-control-rig-editor-styles";

export function installEditorStyles(documentRef: Document = document): void {
  if (documentRef.getElementById(STYLE_ID)) {
    return;
  }

  const style = documentRef.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.trig-editor {
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  color: #e5edf7;
  background: #0f141b;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.trig-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  background: #151c25;
}
.trig-toolbar strong {
  margin-right: auto;
  font-size: 0.9rem;
}
.trig-toolbar button,
.trig-control-row {
  min-height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 6px;
  color: #e5edf7;
  background: #1f2937;
  cursor: pointer;
  font: inherit;
}
.trig-toolbar button {
  padding: 0 12px;
}
.trig-toolbar button:hover,
.trig-control-row:hover {
  background: #263446;
}
.trig-body {
  display: grid;
  grid-template-columns: minmax(260px, 0.86fr) minmax(420px, 1.5fr) minmax(260px, 0.9fr);
  min-height: 0;
}
.trig-panel {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid rgba(148, 163, 184, 0.16);
  background: #111821;
}
.trig-panel:last-child {
  border-right: 0;
  border-left: 1px solid rgba(148, 163, 184, 0.16);
}
.trig-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  color: #b7c4d4;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.trig-graph-stage {
  position: relative;
  height: calc(100% - 42px);
  overflow: auto;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 24px 24px;
}
.trig-graph-svg {
  position: absolute;
  inset: 0;
  width: 900px;
  height: 680px;
  pointer-events: none;
}
.trig-node {
  position: absolute;
  width: 148px;
  min-height: 48px;
  padding: 9px 10px;
  border: 1px solid rgba(125, 211, 252, 0.22);
  border-radius: 7px;
  background: #172231;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  cursor: grab;
  user-select: none;
}
.trig-node:active {
  cursor: grabbing;
}
.trig-node strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.84rem;
}
.trig-node span {
  color: #8ea0b6;
  font-size: 0.72rem;
}
.trig-viewport {
  min-width: 0;
  min-height: 0;
}
.trig-viewport-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.trig-inspector {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}
.trig-control-list {
  display: grid;
  gap: 8px;
  padding: 12px;
}
.trig-control-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
}
.trig-control-row.is-selected {
  border-color: rgba(125, 211, 252, 0.72);
  background: #233247;
}
.trig-swatch {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--trig-control-color, #7dd3fc);
}
.trig-properties {
  padding: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}
.trig-fieldset {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.trig-field {
  display: grid;
  gap: 5px;
}
.trig-field label {
  color: #8ea0b6;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}
.trig-field input {
  min-width: 0;
  height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 6px;
  padding: 0 8px;
  color: #e5edf7;
  background: #0f1722;
  font: inherit;
}
@media (max-width: 980px) {
  .trig-body {
    grid-template-columns: 1fr;
    grid-template-rows: 220px minmax(360px, 1fr) 300px;
  }
  .trig-panel {
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  }
}
`;
  documentRef.head.append(style);
}
