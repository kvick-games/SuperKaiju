import * as THREE from "three";
import { createSeededRandom, horizontalDistance, randomRange } from "./math";

export interface CityRayHit {
  point: THREE.Vector3;
  along: number;
  building: Building;
}

export interface Building {
  id: number;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  rubble: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  position: THREE.Vector3;
  halfX: number;
  halfZ: number;
  height: number;
  maxHealth: number;
  health: number;
  destroyed: boolean;
  originalColor: THREE.Color;
}

export class City {
  readonly group = new THREE.Group();
  readonly buildings: Building[] = [];
  private totalHealth = 0;
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "Caldera City";
    this.scene.add(this.group);
    this.createGround();
    this.createBuildings();
  }

  reset(): void {
    for (const building of this.buildings) {
      building.health = building.maxHealth;
      building.destroyed = false;
      building.mesh.visible = true;
      building.mesh.scale.y = 1;
      building.mesh.position.y = building.height / 2;
      building.mesh.material.color.copy(building.originalColor);
      building.mesh.material.emissive.setHex(0x000000);
      building.rubble.visible = false;
    }
  }

  update(delta: number): void {
    for (const building of this.buildings) {
      if (!building.destroyed && building.health < building.maxHealth) {
        const damage = 1 - building.health / building.maxHealth;
        building.mesh.rotation.z = Math.sin(performance.now() * 0.002 + building.id) * damage * 0.035;
        building.mesh.rotation.x = Math.cos(performance.now() * 0.0018 + building.id) * damage * 0.025;
      }

      if (building.rubble.visible) {
        building.rubble.rotation.y += delta * 0.08;
      }
    }
  }

  getDamageRatio(): number {
    const remaining = this.buildings.reduce((sum, building) => sum + building.health, 0);
    return 1 - remaining / this.totalHealth;
  }

  getNearestStandingBuilding(origin: THREE.Vector3, maxDistance = Infinity): Building | null {
    let nearest: Building | null = null;
    let nearestDistance = maxDistance;

    for (const building of this.buildings) {
      if (building.destroyed) {
        continue;
      }

      const distance = horizontalDistance(origin, building.position);
      if (distance < nearestDistance) {
        nearest = building;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  damageBuilding(building: Building, amount: number): void {
    if (building.destroyed) {
      return;
    }

    building.health = Math.max(0, building.health - amount);
    const healthRatio = building.health / building.maxHealth;
    const damage = 1 - healthRatio;
    building.mesh.scale.y = Math.max(0.16, healthRatio);
    building.mesh.position.y = (building.height * building.mesh.scale.y) / 2;
    building.mesh.material.color.copy(building.originalColor).lerp(new THREE.Color(0x34302d), damage * 0.82);
    building.mesh.material.emissive.setRGB(damage * 0.12, damage * 0.035, 0.01);

    if (building.health <= 0) {
      building.destroyed = true;
      building.mesh.visible = false;
      building.rubble.visible = true;
      building.rubble.scale.set(1, randomRange(() => (building.id % 17) / 17, 0.34, 0.54), 1);
    }
  }

  damageNear(position: THREE.Vector3, radius: number, amount: number): number {
    let damaged = 0;

    for (const building of this.buildings) {
      if (building.destroyed) {
        continue;
      }

      const reach = radius + Math.max(building.halfX, building.halfZ);
      if (horizontalDistance(position, building.position) <= reach) {
        this.damageBuilding(building, amount);
        damaged += 1;
      }
    }

    return damaged;
  }

  raycastBuildings(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): CityRayHit | null {
    this.raycaster.set(origin, direction);
    this.raycaster.far = maxDistance;

    const visibleMeshes = this.buildings
      .filter((building) => !building.destroyed && building.mesh.visible)
      .map((building) => building.mesh);
    const intersections = this.raycaster.intersectObjects(visibleMeshes, false);
    const first = intersections[0];
    if (!first) {
      return null;
    }

    const building = this.buildings.find((candidate) => candidate.mesh === first.object);
    if (!building) {
      return null;
    }

    return {
      point: first.point.clone(),
      along: first.distance,
      building,
    };
  }

  private createGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(620, 620),
      new THREE.MeshStandardMaterial({ color: 0x2b3b40, roughness: 0.88, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2328, roughness: 0.82 });
    for (let index = -4; index <= 4; index += 1) {
      const offset = index * 42;
      const roadA = new THREE.Mesh(new THREE.PlaneGeometry(12, 590), roadMaterial);
      roadA.rotation.x = -Math.PI / 2;
      roadA.position.set(offset, 0.035, 0);
      roadA.receiveShadow = true;
      this.group.add(roadA);

      const roadB = new THREE.Mesh(new THREE.PlaneGeometry(590, 12), roadMaterial);
      roadB.rotation.x = -Math.PI / 2;
      roadB.position.set(0, 0.04, offset);
      roadB.receiveShadow = true;
      this.group.add(roadB);
    }

    const park = new THREE.Mesh(
      new THREE.CircleGeometry(28, 32),
      new THREE.MeshStandardMaterial({ color: 0x425f49, roughness: 0.94 }),
    );
    park.rotation.x = -Math.PI / 2;
    park.position.set(-46, 0.055, 38);
    park.receiveShadow = true;
    this.group.add(park);
  }

  private createBuildings(): void {
    const random = createSeededRandom(7351);
    let id = 0;

    for (let gx = -4; gx <= 4; gx += 1) {
      for (let gz = -4; gz <= 4; gz += 1) {
        if ((gx === 0 && gz === 0) || (gx === -1 && gz === 1)) {
          continue;
        }

        const blockCenterX = gx * 42;
        const blockCenterZ = gz * 42;
        const buildingCount = random() > 0.46 ? 2 : 1;

        for (let item = 0; item < buildingCount; item += 1) {
          const width = randomRange(random, 10, 20);
          const depth = randomRange(random, 10, 21);
          const distanceFromCenter = Math.hypot(gx, gz);
          const height = randomRange(random, 20, 66) + Math.max(0, 4 - distanceFromCenter) * randomRange(random, 5, 13);
          const x = blockCenterX + randomRange(random, -10, 10);
          const z = blockCenterZ + randomRange(random, -10, 10);
          const color = new THREE.Color().setHSL(randomRange(random, 0.53, 0.61), randomRange(random, 0.1, 0.22), randomRange(random, 0.34, 0.5));
          const material = new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.12 });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
          mesh.position.set(x, height / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          const rubble = new THREE.Mesh(
            new THREE.BoxGeometry(width * 1.1, 3.2, depth * 1.1),
            new THREE.MeshStandardMaterial({ color: 0x343230, roughness: 0.91 }),
          );
          rubble.position.set(x, 1.6, z);
          rubble.visible = false;
          rubble.castShadow = true;
          rubble.receiveShadow = true;

          const building: Building = {
            id,
            mesh,
            rubble,
            position: new THREE.Vector3(x, 0, z),
            halfX: width / 2,
            halfZ: depth / 2,
            height,
            maxHealth: 70 + height * 2.6 + width * depth * 0.12,
            health: 0,
            destroyed: false,
            originalColor: color.clone(),
          };

          building.health = building.maxHealth;
          this.totalHealth += building.maxHealth;
          this.buildings.push(building);
          this.group.add(mesh, rubble);
          this.addWindows(mesh, width, height, depth, random);
          id += 1;
        }
      }
    }
  }

  private addWindows(mesh: THREE.Mesh, width: number, height: number, depth: number, random: () => number): void {
    if (height < 28 || random() < 0.34) {
      return;
    }

    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xe1c66e, transparent: true, opacity: 0.48 });
    const rows = Math.min(8, Math.floor(height / 8));
    const windowGroup = new THREE.Group();

    for (let row = 0; row < rows; row += 1) {
      const y = -height / 2 + 7 + row * 7;
      for (let side = 0; side < 2; side += 1) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, 0.7), windowMaterial);
        pane.position.set(0, y, side === 0 ? -depth / 2 - 0.015 : depth / 2 + 0.015);
        pane.rotation.y = side === 0 ? Math.PI : 0;
        windowGroup.add(pane);
      }
    }

    mesh.add(windowGroup);
  }
}
