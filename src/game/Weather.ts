import * as THREE from "three";
import { clamp, lerp, randomRange } from "./math";
import type { WeatherKind, WeatherSnapshot } from "./types";

type WeatherValues = Record<WeatherKind, number>;

const WEATHER_SEQUENCE: WeatherKind[] = ["sunny", "rain", "snowy"];
const WEATHER_LABELS: Record<WeatherKind, string> = {
  sunny: "Sunny",
  rain: "Rain",
  snowy: "Snowy",
};

const WEATHER_DURATIONS: Record<WeatherKind, { min: number; max: number }> = {
  sunny: { min: 18, max: 26 },
  rain: { min: 16, max: 24 },
  snowy: { min: 20, max: 30 },
};

const BASE_COLD_RATE = 0.026;
const THAW_RATES: WeatherValues = {
  sunny: 0.075,
  rain: 0.04,
  snowy: 0.012,
};

const WEATHER_TRANSITION_SECONDS = 7.5;
const INTENSITY_ADJUST_SECONDS = 2.6;
const RAIN_DROP_COUNT = 420;
const SNOWFLAKE_COUNT = 680;
const PRECIPITATION_SPREAD = 220;
const PRECIPITATION_TOP = 96;
const PRECIPITATION_BOTTOM = -28;
const SNOW_WORLD_SPREAD = 260;
const SNOW_WORLD_TOP = 190;
const SNOW_WORLD_BOTTOM = 0;

const SUNNY_BACKGROUND = new THREE.Color(0x8fb2ca);
const RAIN_BACKGROUND = new THREE.Color(0x657684);
const SNOW_BACKGROUND = new THREE.Color(0xbecfdb);
const SUNNY_FOG = new THREE.Color(0x9db7c9);
const RAIN_FOG = new THREE.Color(0x6d7f88);
const SNOW_FOG = new THREE.Color(0xd7e5ef);

export class WeatherSystem {
  private readonly group = new THREE.Group();
  private readonly rainLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly snowPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly rainPositions = new Float32Array(RAIN_DROP_COUNT * 2 * 3);
  private readonly snowPositions = new Float32Array(SNOWFLAKE_COUNT * 3);
  private readonly snowSeeds = new Float32Array(SNOWFLAKE_COUNT * 3);
  private readonly sunDisk: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly blend: WeatherValues = { sunny: 1, rain: 0, snowy: 0 };
  private readonly blendStart: WeatherValues = { sunny: 1, rain: 0, snowy: 0 };
  private readonly blendTarget: WeatherValues = { sunny: 1, rain: 0, snowy: 0 };
  private readonly intensityTargets: WeatherValues = { sunny: 1, rain: 1, snowy: 1 };
  private readonly moodWeights: WeatherValues = { sunny: 1, rain: 0, snowy: 0 };
  private readonly blendedBackground = new THREE.Color();
  private readonly blendedFog = new THREE.Color();
  private kindIndex = 0;
  private kind: WeatherKind = WEATHER_SEQUENCE[this.kindIndex];
  private duration = 1;
  private remaining = 1;
  private elapsed = 0;
  private transitionElapsed = 0;
  private transitionDuration = WEATHER_TRANSITION_SECONDS;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "Weather effects";
    this.group.frustumCulled = false;

    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainLines = new THREE.LineSegments(
      rainGeometry,
      new THREE.LineBasicMaterial({
        color: 0xa9c3d6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.rainLines.frustumCulled = false;
    this.group.add(this.rainLines);

    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute("position", new THREE.BufferAttribute(this.snowPositions, 3));
    this.snowPoints = new THREE.Points(
      snowGeometry,
      new THREE.PointsMaterial({
        color: 0xf4fbff,
        size: 2.25,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.snowPoints.frustumCulled = false;
    this.snowPoints.name = "World-space snow";

    this.sunDisk = new THREE.Mesh(
      new THREE.SphereGeometry(9, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xfff1b3,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      }),
    );
    this.sunDisk.position.set(-176, 184, -210);
    this.group.add(this.sunDisk);

    this.scene.add(this.group);
    this.scene.add(this.snowPoints);
    this.seedRain();
    this.seedSnow();
    this.setWeather("sunny", 14, true);
  }

  reset(): void {
    this.kindIndex = 0;
    this.elapsed = 0;
    this.seedRain();
    this.seedSnow();
    this.setWeather("sunny", 14, true);
  }

  setIntensity(kind: WeatherKind, intensity: number): void {
    this.intensityTargets[kind] = clamp(intensity, 0, 1);
    this.retargetBlend(kind === this.kind ? INTENSITY_ADJUST_SECONDS : this.remaining);
  }

  update(delta: number, focus: THREE.Vector3): WeatherSnapshot {
    this.elapsed += delta;
    this.remaining -= delta;
    if (this.remaining <= 0) {
      this.advanceWeather();
    }

    this.updateBlend(delta);
    this.group.position.set(focus.x, Math.max(28, focus.y), focus.z);
    this.updateRain(delta);
    this.updateSnow(delta);
    this.updateSun();
    this.applySceneMood();
    return this.getSnapshot();
  }

  getSnapshot(): WeatherSnapshot {
    const environment = this.getEnvironment();
    return {
      kind: this.kind,
      label: WEATHER_LABELS[this.kind],
      coldRate: environment.coldRate,
      thawRate: environment.thawRate,
      progress: 1 - this.remaining / this.duration,
    };
  }

  applySnapshot(snapshot: WeatherSnapshot): void {
    if (snapshot.kind !== this.kind) {
      this.setWeather(snapshot.kind, 14, true);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.remove(this.snowPoints);
    this.rainLines.geometry.dispose();
    this.rainLines.material.dispose();
    this.snowPoints.geometry.dispose();
    this.snowPoints.material.dispose();
    this.sunDisk.geometry.dispose();
    this.sunDisk.material.dispose();
  }

  private advanceWeather(): void {
    this.kindIndex = (this.kindIndex + 1) % WEATHER_SEQUENCE.length;
    const nextKind = WEATHER_SEQUENCE[this.kindIndex];
    const durationSpec = WEATHER_DURATIONS[nextKind];
    this.setWeather(nextKind, randomRange(Math.random, durationSpec.min, durationSpec.max), false);
  }

  private setWeather(kind: WeatherKind, duration: number, immediate: boolean): void {
    this.kind = kind;
    this.duration = duration;
    this.remaining = duration;
    this.retargetBlend(immediate ? 0 : WEATHER_TRANSITION_SECONDS);
  }

  private retargetBlend(duration: number): void {
    for (const kind of WEATHER_SEQUENCE) {
      this.blendStart[kind] = this.blend[kind];
      this.blendTarget[kind] = kind === this.kind ? this.intensityTargets[kind] : 0;
    }

    this.transitionDuration = Math.max(0.001, duration);
    this.transitionElapsed = duration <= 0 ? this.transitionDuration : 0;
    this.updateBlend(0);
  }

  private updateBlend(delta: number): void {
    this.transitionElapsed = Math.min(this.transitionDuration, this.transitionElapsed + delta);
    const progress = smoothStep(this.transitionElapsed / this.transitionDuration);

    for (const kind of WEATHER_SEQUENCE) {
      this.blend[kind] = lerp(this.blendStart[kind], this.blendTarget[kind], progress);
    }
  }

  private getEnvironment(): Pick<WeatherSnapshot, "coldRate" | "thawRate"> {
    this.calculateMoodWeights();
    const thawRate =
      this.moodWeights.sunny * THAW_RATES.sunny +
      this.moodWeights.rain * THAW_RATES.rain +
      this.moodWeights.snowy * THAW_RATES.snowy;

    return {
      coldRate: BASE_COLD_RATE * this.blend.snowy,
      thawRate,
    };
  }

  private calculateMoodWeights(): WeatherValues {
    const stormPressure = Math.max(this.blend.rain, this.blend.snowy);
    this.moodWeights.sunny = Math.max(this.blend.sunny, 1 - stormPressure);
    this.moodWeights.rain = this.blend.rain;
    this.moodWeights.snowy = this.blend.snowy;

    const total = Math.max(0.001, this.moodWeights.sunny + this.moodWeights.rain + this.moodWeights.snowy);
    this.moodWeights.sunny /= total;
    this.moodWeights.rain /= total;
    this.moodWeights.snowy /= total;
    return this.moodWeights;
  }

  private applySceneMood(): void {
    const weights = this.calculateMoodWeights();
    blendColor(this.blendedBackground, SUNNY_BACKGROUND, RAIN_BACKGROUND, SNOW_BACKGROUND, weights);
    this.scene.background = this.blendedBackground;

    if (this.scene.fog instanceof THREE.FogExp2) {
      blendColor(this.blendedFog, SUNNY_FOG, RAIN_FOG, SNOW_FOG, weights);
      this.scene.fog.color.copy(this.blendedFog);
      this.scene.fog.density = weights.sunny * 0.0028 + weights.rain * 0.0048 + weights.snowy * 0.0056;
    }
  }

  private updateSun(): void {
    const strength = this.blend.sunny;
    this.sunDisk.visible = strength > 0.01;
    this.sunDisk.material.opacity = strength * 0.92;
    this.sunDisk.scale.setScalar(0.72 + strength * 0.46);
  }

  private seedRain(): void {
    for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
      this.placeRainDrop(index, randomRange(Math.random, PRECIPITATION_BOTTOM, PRECIPITATION_TOP));
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }

  private placeRainDrop(index: number, y: number): void {
    const positionIndex = index * 6;
    const x = randomRange(Math.random, -PRECIPITATION_SPREAD, PRECIPITATION_SPREAD);
    const z = randomRange(Math.random, -PRECIPITATION_SPREAD, PRECIPITATION_SPREAD);
    const windX = -1.8;
    const windZ = 0.8;
    this.rainPositions[positionIndex] = x;
    this.rainPositions[positionIndex + 1] = y;
    this.rainPositions[positionIndex + 2] = z;
    this.rainPositions[positionIndex + 3] = x + windX;
    this.rainPositions[positionIndex + 4] = y - 8.5;
    this.rainPositions[positionIndex + 5] = z + windZ;
  }

  private updateRain(delta: number): void {
    const strength = this.blend.rain;
    this.rainLines.visible = strength > 0.01;
    this.rainLines.material.opacity = strength * 0.58;

    if (strength <= 0.01) {
      return;
    }

    const speed = 54 + strength * 58;
    for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
      const positionIndex = index * 6;
      const nextY = this.rainPositions[positionIndex + 1] - delta * speed;
      this.placeRainDrop(index, nextY < PRECIPITATION_BOTTOM ? PRECIPITATION_TOP : nextY);
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }

  private seedSnow(): void {
    for (let index = 0; index < SNOWFLAKE_COUNT; index += 1) {
      const seedIndex = index * 3;
      this.snowSeeds[seedIndex] = Math.random();
      this.snowSeeds[seedIndex + 1] = Math.random();
      this.snowSeeds[seedIndex + 2] = Math.random();
      this.placeSnowflake(index, randomRange(Math.random, SNOW_WORLD_BOTTOM, SNOW_WORLD_TOP));
    }
    this.snowPoints.geometry.attributes.position.needsUpdate = true;
  }

  private placeSnowflake(index: number, y: number): void {
    const positionIndex = index * 3;
    this.snowPositions[positionIndex] = randomRange(Math.random, -SNOW_WORLD_SPREAD, SNOW_WORLD_SPREAD);
    this.snowPositions[positionIndex + 1] = y;
    this.snowPositions[positionIndex + 2] = randomRange(Math.random, -SNOW_WORLD_SPREAD, SNOW_WORLD_SPREAD);
  }

  private updateSnow(delta: number): void {
    const strength = this.blend.snowy;
    this.snowPoints.visible = strength > 0.01;
    this.snowPoints.material.opacity = strength * 0.84;
    this.snowPoints.material.size = 1.4 + strength * 1.2;

    if (strength <= 0.01) {
      return;
    }

    const time = this.elapsed;
    for (let index = 0; index < SNOWFLAKE_COUNT; index += 1) {
      const positionIndex = index * 3;
      const seedIndex = index * 3;
      const fallSpeed = (4.2 + this.snowSeeds[seedIndex] * 9.8) * (0.65 + strength * 0.58);
      this.snowPositions[positionIndex] +=
        Math.sin(time * 1.4 + this.snowSeeds[seedIndex + 1] * 18) * delta * (1.2 + strength * 2.2);
      this.snowPositions[positionIndex + 1] -= delta * fallSpeed;
      this.snowPositions[positionIndex + 2] +=
        Math.cos(time * 1.1 + this.snowSeeds[seedIndex + 2] * 16) * delta * (0.9 + strength * 1.9);

      if (
        this.snowPositions[positionIndex + 1] < SNOW_WORLD_BOTTOM ||
        Math.abs(this.snowPositions[positionIndex]) > SNOW_WORLD_SPREAD ||
        Math.abs(this.snowPositions[positionIndex + 2]) > SNOW_WORLD_SPREAD
      ) {
        this.placeSnowflake(index, SNOW_WORLD_TOP);
      }
    }
    this.snowPoints.geometry.attributes.position.needsUpdate = true;
  }
}

function smoothStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function blendColor(
  target: THREE.Color,
  sunny: THREE.Color,
  rain: THREE.Color,
  snowy: THREE.Color,
  weights: WeatherValues,
): THREE.Color {
  return target.setRGB(
    sunny.r * weights.sunny + rain.r * weights.rain + snowy.r * weights.snowy,
    sunny.g * weights.sunny + rain.g * weights.rain + snowy.g * weights.snowy,
    sunny.b * weights.sunny + rain.b * weights.rain + snowy.b * weights.snowy,
  );
}
