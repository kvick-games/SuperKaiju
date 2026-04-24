import * as THREE from "three";

export class SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.1, 1200);
  readonly renderer: THREE.WebGLRenderer;

  constructor(private readonly root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x8fb2ca);
    this.scene.fog = new THREE.FogExp2(0x9db7c9, 0.0028);

    this.camera.position.set(0, 52, 110);
    this.camera.lookAt(0, 28, 0);
    this.scene.add(this.camera);

    this.addLighting();
    this.resize();
  }

  resize(): void {
    const width = this.root.clientWidth || window.innerWidth;
    const height = this.root.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.root.removeChild(this.renderer.domElement);
  }

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xe9f6ff, 0x24313b, 2.2);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1ce, 3.4);
    sun.position.set(-94, 160, 86);
    sun.castShadow = true;
    sun.shadow.camera.left = -280;
    sun.shadow.camera.right = 280;
    sun.shadow.camera.top = 280;
    sun.shadow.camera.bottom = -280;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 420;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x92c6ef, 1.1);
    fill.position.set(110, 80, -120);
    this.scene.add(fill);
  }
}
