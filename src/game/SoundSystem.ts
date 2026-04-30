import { clamp } from "./math";

interface SoundState {
  heatActive: boolean;
  frostActive: boolean;
  boostActive: boolean;
  speedRatio: number;
  fireIntensity: number;
}

type WebAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export class SoundSystem {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private heatGain: GainNode | undefined;
  private frostGain: GainNode | undefined;
  private readonly fireLayerGains: GainNode[] = [];
  private readonly fireLayerTargets = [0, 0, 0];
  private heatAudible = false;
  private frostAudible = false;
  private lastBoostActive = false;
  private lastBuildingImpactAt = Number.NEGATIVE_INFINITY;
  private levelCompleteJingleCleanup: (() => void) | undefined;

  constructor() {
    window.addEventListener("pointerdown", this.unlockAudio, true);
    window.addEventListener("keydown", this.unlockAudio, true);
  }

  resume(): void {
    const context = this.ensureContext();
    if (!context || context.state !== "suspended") {
      return;
    }

    context.resume().catch(() => undefined);
  }

  reset(): void {
    this.lastBoostActive = false;
    this.lastBuildingImpactAt = Number.NEGATIVE_INFINITY;
    this.stopLevelCompleteJingle();
    this.setHeatActive(false);
    this.setFrostActive(false);
    this.setFireIntensity(0);
  }

  update(state: SoundState): void {
    if (state.heatActive || state.frostActive || state.fireIntensity > 0.02 || (state.boostActive && !this.lastBoostActive)) {
      this.resume();
    }

    this.setHeatActive(state.heatActive);
    this.setFrostActive(state.frostActive);
    this.setFireIntensity(state.fireIntensity);

    if (state.boostActive && !this.lastBoostActive) {
      this.playSprintWhoosh(state.speedRatio);
    }
    this.lastBoostActive = state.boostActive;
  }

  playBuildingImpact(speedRatio: number): void {
    const context = this.ensureContext();
    if (!context || !this.master) {
      return;
    }

    this.resume();

    const now = context.currentTime;
    if (now - this.lastBuildingImpactAt < 0.18) {
      return;
    }
    this.lastBuildingImpactAt = now;

    const impact = clamp(speedRatio, 0.45, 1.35);
    const output = context.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.58 * impact, now + 0.012);
    output.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    output.connect(this.master);

    const thump = context.createOscillator();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(86 + impact * 18, now);
    thump.frequency.exponentialRampToValueAtTime(34, now + 0.22);

    const thumpFilter = context.createBiquadFilter();
    thumpFilter.type = "lowpass";
    thumpFilter.frequency.setValueAtTime(360, now);
    thumpFilter.frequency.exponentialRampToValueAtTime(115, now + 0.24);
    thumpFilter.Q.value = 1.2;

    const crack = context.createBufferSource();
    crack.buffer = this.createNoiseBuffer(context, 0.24);
    crack.playbackRate.value = 0.78 + impact * 0.16;

    const crackFilter = context.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.setValueAtTime(520 + impact * 210, now);
    crackFilter.frequency.exponentialRampToValueAtTime(165, now + 0.16);
    crackFilter.Q.value = 0.92;

    const crackGain = context.createGain();
    crackGain.gain.setValueAtTime(0.32 * impact, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    thump.connect(thumpFilter);
    thumpFilter.connect(output);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(output);

    thump.start(now);
    crack.start(now);
    thump.stop(now + 0.28);
    crack.stop(now + 0.24);

    thump.onended = () => {
      thump.disconnect();
      thumpFilter.disconnect();
      crack.disconnect();
      crackFilter.disconnect();
      crackGain.disconnect();
      output.disconnect();
    };
  }

  playEnemyBuildingSmash(rawIntensity = 1, rawGain = 1): void {
    const context = this.ensureContext();
    if (!context || !this.master) {
      return;
    }

    this.resume();

    const intensity = clamp(rawIntensity, 0.65, 1.9);
    const outputGain = clamp(rawGain, 0, 1);
    if (outputGain <= 0.001) {
      return;
    }

    const now = context.currentTime;
    const duration = 0.9;
    const bus = context.createGain();
    bus.gain.value = outputGain;

    const thud = context.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueCurveAtTime(this.createPitchDownSCurve(92, 38, 96, 0.42), now, 0.46);
    const thudGain = context.createGain();
    thudGain.gain.setValueCurveAtTime(this.createOneShotEnvelopeCurve(96, 0.44 * intensity, 0.012, 2.6), now, duration);

    const debris = context.createBufferSource();
    debris.buffer = this.createNoiseBuffer(context, duration);
    const debrisHighpass = context.createBiquadFilter();
    debrisHighpass.type = "highpass";
    debrisHighpass.frequency.value = 58;
    const debrisLowpass = context.createBiquadFilter();
    debrisLowpass.type = "lowpass";
    debrisLowpass.frequency.value = 980;
    debrisLowpass.Q.value = 0.78;
    const debrisGain = context.createGain();
    debrisGain.gain.setValueCurveAtTime(this.createOneShotEnvelopeCurve(96, 0.25 * intensity, 0.018, 2.15), now, duration);

    const crack = context.createBufferSource();
    crack.buffer = this.createCrackleBuffer(context, 0.42);
    const crackHighpass = context.createBiquadFilter();
    crackHighpass.type = "highpass";
    crackHighpass.frequency.value = 820;
    const crackBand = context.createBiquadFilter();
    crackBand.type = "bandpass";
    crackBand.frequency.value = 2650;
    crackBand.Q.value = 1.9;
    const crackGain = context.createGain();
    crackGain.gain.setValueCurveAtTime(this.createOneShotEnvelopeCurve(64, 0.18 * intensity, 0.004, 3.1), now, 0.42);

    thud.connect(thudGain);
    thudGain.connect(bus);
    debris.connect(debrisHighpass);
    debrisHighpass.connect(debrisLowpass);
    debrisLowpass.connect(debrisGain);
    debrisGain.connect(bus);
    crack.connect(crackHighpass);
    crackHighpass.connect(crackBand);
    crackBand.connect(crackGain);
    crackGain.connect(bus);
    bus.connect(this.master);

    thud.start(now);
    debris.start(now);
    crack.start(now);
    thud.stop(now + duration);
    debris.stop(now + duration);
    crack.stop(now + 0.42);

    debris.onended = () => {
      thud.disconnect();
      thudGain.disconnect();
      debris.disconnect();
      debrisHighpass.disconnect();
      debrisLowpass.disconnect();
      debrisGain.disconnect();
      crack.disconnect();
      crackHighpass.disconnect();
      crackBand.disconnect();
      crackGain.disconnect();
      bus.disconnect();
    };
  }

  playBuildingCollapse(rawIntensity = 1, rawGain = 1): void {
    const context = this.ensureContext();
    if (!context || !this.master) {
      return;
    }

    this.resume();

    const intensity = clamp(rawIntensity, 0.75, 2);
    const outputGain = clamp(rawGain, 0, 1);
    if (outputGain <= 0.001) {
      return;
    }

    const now = context.currentTime;
    const duration = 1.65;
    const bus = context.createGain();
    bus.gain.value = outputGain;

    const rumble = context.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.setValueCurveAtTime(this.createPitchDownSCurve(58, 22, 128, 0.62), now, duration);
    const rumbleGain = context.createGain();
    rumbleGain.gain.setValueCurveAtTime(this.createOneShotEnvelopeCurve(128, 0.5 * intensity, 0.025, 0.78), now, duration);

    const rubble = context.createBufferSource();
    rubble.buffer = this.createNoiseBuffer(context, duration);
    const rubbleHighpass = context.createBiquadFilter();
    rubbleHighpass.type = "highpass";
    rubbleHighpass.frequency.value = 32;
    const rubbleLowpass = context.createBiquadFilter();
    rubbleLowpass.type = "lowpass";
    rubbleLowpass.frequency.setValueCurveAtTime(this.createPitchDownSCurve(1850, 260, 128, 0.82), now, duration);
    rubbleLowpass.Q.value = 0.7;
    const rubbleGain = context.createGain();
    rubbleGain.gain.setValueCurveAtTime(this.createOneShotEnvelopeCurve(128, 0.38 * intensity, 0.045, 0.95), now, duration);

    const cascade = context.createBufferSource();
    cascade.buffer = this.createCrackleBuffer(context, 1.35);
    const cascadeHighpass = context.createBiquadFilter();
    cascadeHighpass.type = "highpass";
    cascadeHighpass.frequency.value = 620;
    const cascadeBand = context.createBiquadFilter();
    cascadeBand.type = "bandpass";
    cascadeBand.frequency.value = 1950;
    cascadeBand.Q.value = 1.2;
    const cascadeGain = context.createGain();
    cascadeGain.gain.setValueCurveAtTime(this.createOneShotEnvelopeCurve(128, 0.16 * intensity, 0.016, 1.45), now + 0.08, duration - 0.08);

    rumble.connect(rumbleGain);
    rumbleGain.connect(bus);
    rubble.connect(rubbleHighpass);
    rubbleHighpass.connect(rubbleLowpass);
    rubbleLowpass.connect(rubbleGain);
    rubbleGain.connect(bus);
    cascade.connect(cascadeHighpass);
    cascadeHighpass.connect(cascadeBand);
    cascadeBand.connect(cascadeGain);
    cascadeGain.connect(bus);
    bus.connect(this.master);

    rumble.start(now);
    rubble.start(now);
    cascade.start(now + 0.08);
    rumble.stop(now + duration);
    rubble.stop(now + duration);
    cascade.stop(now + duration);

    rubble.onended = () => {
      rumble.disconnect();
      rumbleGain.disconnect();
      rubble.disconnect();
      rubbleHighpass.disconnect();
      rubbleLowpass.disconnect();
      rubbleGain.disconnect();
      cascade.disconnect();
      cascadeHighpass.disconnect();
      cascadeBand.disconnect();
      cascadeGain.disconnect();
      bus.disconnect();
    };
  }

  playLevelCompleteJingle(): void {
    const context = this.ensureContext();
    if (!context || !this.master) {
      return;
    }

    this.resume();
    this.stopLevelCompleteJingle();

    const now = context.currentTime;
    const output = context.createGain();
    const filter = context.createBiquadFilter();
    const nodes: AudioNode[] = [output, filter];
    const sources: OscillatorNode[] = [];
    let cleanupTimer: number | undefined;
    let cleanedUp = false;
    let stopJingle: (() => void) | undefined;

    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.78, now + 0.035);
    output.gain.setValueAtTime(0.78, now + 1.55);
    output.gain.exponentialRampToValueAtTime(0.0001, now + 2.22);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(5200, now);
    filter.frequency.exponentialRampToValueAtTime(2900, now + 2.18);
    filter.Q.value = 0.5;
    output.connect(filter);
    filter.connect(this.master);

    const notes = [
      { at: 0, hz: 523.25, duration: 0.18, gain: 0.2 },
      { at: 0.12, hz: 659.25, duration: 0.18, gain: 0.22 },
      { at: 0.24, hz: 783.99, duration: 0.22, gain: 0.24 },
      { at: 0.42, hz: 1046.5, duration: 0.28, gain: 0.28 },
      { at: 0.68, hz: 987.77, duration: 0.22, gain: 0.19 },
      { at: 0.84, hz: 1046.5, duration: 0.92, gain: 0.28 },
    ];

    for (const note of notes) {
      const start = now + note.at;
      const end = start + note.duration;
      const tone = context.createOscillator();
      const toneGain = context.createGain();
      tone.type = "triangle";
      tone.frequency.setValueAtTime(note.hz, start);
      toneGain.gain.setValueAtTime(0.0001, start);
      toneGain.gain.exponentialRampToValueAtTime(note.gain, start + 0.018);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, end);
      tone.connect(toneGain);
      toneGain.connect(output);
      tone.start(start);
      tone.stop(end + 0.04);
      sources.push(tone);
      nodes.push(tone, toneGain);

      const chime = context.createOscillator();
      const chimeGain = context.createGain();
      chime.type = "sine";
      chime.frequency.setValueAtTime(note.hz * 2, start);
      chimeGain.gain.setValueAtTime(0.0001, start);
      chimeGain.gain.exponentialRampToValueAtTime(note.gain * 0.32, start + 0.012);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
      chime.connect(chimeGain);
      chimeGain.connect(output);
      chime.start(start);
      chime.stop(end + 0.12);
      sources.push(chime);
      nodes.push(chime, chimeGain);
    }

    const cleanup = (stopSources: boolean): void => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      if (cleanupTimer !== undefined) {
        window.clearTimeout(cleanupTimer);
      }
      if (stopSources) {
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            // Source may have already finished.
          }
        }
      }
      for (const node of nodes) {
        node.disconnect();
      }
      if (stopJingle && this.levelCompleteJingleCleanup === stopJingle) {
        this.levelCompleteJingleCleanup = undefined;
      }
    };

    stopJingle = (): void => cleanup(true);
    this.levelCompleteJingleCleanup = stopJingle;
    cleanupTimer = window.setTimeout(() => cleanup(false), 2450);
  }

  dispose(): void {
    window.removeEventListener("pointerdown", this.unlockAudio, true);
    window.removeEventListener("keydown", this.unlockAudio, true);
    this.stopLevelCompleteJingle();
    this.context?.close().catch(() => undefined);
    this.context = undefined;
  }

  private readonly unlockAudio = (): void => {
    this.resume();
  };

  private stopLevelCompleteJingle(): void {
    this.levelCompleteJingleCleanup?.();
    this.levelCompleteJingleCleanup = undefined;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) {
      return this.context;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) {
      return undefined;
    }

    const context = new AudioContextConstructor();
    const master = context.createGain();
    master.gain.value = 0.32;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.18;

    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.createHeatLoop(context, master);
    this.createFrostLoop(context, master);
    this.createFireLoops(context, master);
    return context;
  }

  private createHeatLoop(context: AudioContext, output: AudioNode): void {
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(output);
    this.heatGain = gain;

    const phaserInput = context.createGain();
    const phaserDry = context.createGain();
    phaserDry.gain.value = 0.52;
    const phaserWet = context.createGain();
    phaserWet.gain.value = 0.48;
    const phaserStages = [620, 930, 1370, 1960].map((frequency) => {
      const stage = context.createBiquadFilter();
      stage.type = "allpass";
      stage.frequency.value = frequency;
      stage.Q.value = 1.25;
      return stage;
    });
    const phaserLfo = context.createOscillator();
    phaserLfo.type = "sine";
    phaserLfo.frequency.value = 0.85;
    const phaserDepth = context.createGain();
    phaserDepth.gain.value = 360;

    phaserInput.connect(phaserDry);
    phaserDry.connect(gain);
    phaserInput.connect(phaserStages[0]);
    for (let index = 0; index < phaserStages.length - 1; index += 1) {
      phaserStages[index].connect(phaserStages[index + 1]);
    }
    phaserStages[phaserStages.length - 1].connect(phaserWet);
    phaserWet.connect(gain);
    phaserLfo.connect(phaserDepth);
    for (const stage of phaserStages) {
      phaserDepth.connect(stage.frequency);
    }

    const oscA = context.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = 108;
    const oscFilter = context.createBiquadFilter();
    oscFilter.type = "lowpass";
    oscFilter.frequency.value = 1240;
    oscFilter.Q.value = 0.9;
    const oscGain = context.createGain();
    oscGain.gain.value = 0.2;
    oscA.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(phaserInput);

    const pulse = context.createOscillator();
    pulse.type = "square";
    pulse.frequency.value = 220;
    const pulseGain = context.createGain();
    pulseGain.gain.value = 0.045;
    pulse.connect(pulseGain);
    pulseGain.connect(phaserInput);

    const heatNoise = context.createBufferSource();
    heatNoise.buffer = this.createNoiseBuffer(context, 1.4);
    heatNoise.loop = true;
    const heatNoiseFilter = context.createBiquadFilter();
    heatNoiseFilter.type = "bandpass";
    heatNoiseFilter.frequency.value = 2450;
    heatNoiseFilter.Q.value = 3.8;
    const heatNoiseGain = context.createGain();
    heatNoiseGain.gain.value = 0.16;
    heatNoise.connect(heatNoiseFilter);
    heatNoiseFilter.connect(heatNoiseGain);
    heatNoiseGain.connect(gain);

    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 18;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 15;
    lfo.connect(lfoGain);
    lfoGain.connect(oscA.frequency);

    oscA.start();
    pulse.start();
    heatNoise.start();
    lfo.start();
    phaserLfo.start();
  }

  private createFrostLoop(context: AudioContext, output: AudioNode): void {
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(output);
    this.frostGain = gain;

    const frostNoise = context.createBufferSource();
    frostNoise.buffer = this.createNoiseBuffer(context, 1.8);
    frostNoise.loop = true;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 520;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3200;
    lowpass.Q.value = 0.8;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.28;
    frostNoise.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(noiseGain);
    noiseGain.connect(gain);

    const rumble = context.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.value = 46;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.08;
    rumble.connect(rumbleGain);
    rumbleGain.connect(gain);

    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.42;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 760;
    lfo.connect(lfoGain);
    lfoGain.connect(lowpass.frequency);

    frostNoise.start();
    rumble.start();
    lfo.start();
  }

  private createFireLoops(context: AudioContext, output: AudioNode): void {
    const lowBedGain = this.createFireLayerGain(context, output, 0);
    const lowBedNoise = context.createBufferSource();
    lowBedNoise.buffer = this.createNoiseBuffer(context, 2.7);
    lowBedNoise.loop = true;
    const lowBedHighpass = context.createBiquadFilter();
    lowBedHighpass.type = "highpass";
    lowBedHighpass.frequency.value = 42;
    const lowBedLowpass = context.createBiquadFilter();
    lowBedLowpass.type = "lowpass";
    lowBedLowpass.frequency.value = 620;
    lowBedLowpass.Q.value = 0.55;
    const lowBedLfo = context.createOscillator();
    lowBedLfo.type = "sine";
    lowBedLfo.frequency.value = 0.37;
    const lowBedLfoGain = context.createGain();
    lowBedLfoGain.gain.value = 120;
    lowBedNoise.connect(lowBedHighpass);
    lowBedHighpass.connect(lowBedLowpass);
    lowBedLowpass.connect(lowBedGain);
    lowBedLfo.connect(lowBedLfoGain);
    lowBedLfoGain.connect(lowBedLowpass.frequency);

    const midRoarGain = this.createFireLayerGain(context, output, 1);
    const midRoarNoise = context.createBufferSource();
    midRoarNoise.buffer = this.createNoiseBuffer(context, 1.9);
    midRoarNoise.loop = true;
    const midRoarBand = context.createBiquadFilter();
    midRoarBand.type = "bandpass";
    midRoarBand.frequency.value = 920;
    midRoarBand.Q.value = 0.9;
    const midRoarLowpass = context.createBiquadFilter();
    midRoarLowpass.type = "lowpass";
    midRoarLowpass.frequency.value = 2350;
    midRoarLowpass.Q.value = 0.7;
    const midRoarLfo = context.createOscillator();
    midRoarLfo.type = "sine";
    midRoarLfo.frequency.value = 0.68;
    const midRoarLfoGain = context.createGain();
    midRoarLfoGain.gain.value = 280;
    midRoarNoise.connect(midRoarBand);
    midRoarBand.connect(midRoarLowpass);
    midRoarLowpass.connect(midRoarGain);
    midRoarLfo.connect(midRoarLfoGain);
    midRoarLfoGain.connect(midRoarBand.frequency);

    const crackleGain = this.createFireLayerGain(context, output, 2);
    const crackleSource = context.createBufferSource();
    crackleSource.buffer = this.createCrackleBuffer(context, 2.4);
    crackleSource.loop = true;
    const crackleHighpass = context.createBiquadFilter();
    crackleHighpass.type = "highpass";
    crackleHighpass.frequency.value = 1250;
    const crackleBand = context.createBiquadFilter();
    crackleBand.type = "bandpass";
    crackleBand.frequency.value = 3100;
    crackleBand.Q.value = 1.65;
    crackleSource.connect(crackleHighpass);
    crackleHighpass.connect(crackleBand);
    crackleBand.connect(crackleGain);

    lowBedNoise.start();
    lowBedLfo.start();
    midRoarNoise.start();
    midRoarLfo.start();
    crackleSource.start();
  }

  private createFireLayerGain(context: AudioContext, output: AudioNode, index: number): GainNode {
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(output);
    this.fireLayerGains[index] = gain;
    return gain;
  }

  private setHeatActive(active: boolean): void {
    if (this.heatAudible === active && this.heatGain) {
      return;
    }
    const wasAudible = this.heatAudible;
    this.heatAudible = active;
    if (active && !wasAudible) {
      this.playHeatVisionTrigger();
    }
    this.fadeLoop(this.heatGain, active ? 0.72 : 0.0001, active ? 0.026 : 0.06);
  }

  private setFrostActive(active: boolean): void {
    if (this.frostAudible === active && this.frostGain) {
      return;
    }
    this.frostAudible = active;
    this.fadeLoop(this.frostGain, active ? 0.58 : 0.0001, active ? 0.04 : 0.09);
  }

  private setFireIntensity(rawIntensity: number): void {
    const intensity = clamp(rawIntensity, 0, 1);
    const targets = [
      this.smoothstep(0.03, 0.34, intensity) * 0.18,
      this.smoothstep(0.22, 0.68, intensity) * 0.16,
      (this.smoothstep(0.12, 0.5, intensity) * 0.055 + this.smoothstep(0.48, 1, intensity) * 0.105),
    ];

    for (let index = 0; index < targets.length; index += 1) {
      if (Math.abs(targets[index] - this.fireLayerTargets[index]) < 0.006) {
        continue;
      }
      this.fireLayerTargets[index] = targets[index];
      this.fadeLoop(this.fireLayerGains[index], targets[index] > 0.0001 ? targets[index] : 0.0001, 0.18);
    }
  }

  private fadeLoop(gain: GainNode | undefined, target: number, timeConstant: number): void {
    if (!this.context || !gain) {
      return;
    }

    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(target, now, timeConstant);
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private playSprintWhoosh(speedRatio: number): void {
    const context = this.ensureContext();
    if (!context || !this.master) {
      return;
    }

    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.createNoiseBuffer(context, 0.9);
    source.playbackRate.setValueAtTime(0.72, now);
    source.playbackRate.exponentialRampToValueAtTime(2.15 + Math.min(0.5, speedRatio * 0.35), now + 0.56);

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 92;
    const sweep = context.createBiquadFilter();
    sweep.type = "bandpass";
    sweep.frequency.setValueAtTime(230, now);
    sweep.frequency.exponentialRampToValueAtTime(2550, now + 0.48);
    sweep.Q.value = 0.78;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.48, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);

    source.connect(highpass);
    highpass.connect(sweep);
    sweep.connect(gain);
    gain.connect(this.master);

    source.start(now);
    source.stop(now + 0.9);
    source.onended = () => {
      source.disconnect();
      highpass.disconnect();
      sweep.disconnect();
      gain.disconnect();
    };
  }

  private playHeatVisionTrigger(): void {
    const context = this.ensureContext();
    if (!context || !this.master) {
      return;
    }

    const now = context.currentTime;
    const duration = 1;
    const pitchCurve = this.createPitchDownSCurve(2200, 170, 128, 0.52);
    const overtoneCurve = this.createPitchDownSCurve(3300, 260, 128, 0.52);
    const noiseSweepCurve = this.createPitchDownSCurve(3600, 420, 128, 0.58);
    const envelopeCurve = this.createTriggerEnvelopeCurve(128);

    const primary = context.createOscillator();
    primary.type = "sawtooth";
    primary.frequency.setValueCurveAtTime(pitchCurve, now, duration);

    const overtone = context.createOscillator();
    overtone.type = "square";
    overtone.frequency.setValueCurveAtTime(overtoneCurve, now, duration);

    const primaryGain = context.createGain();
    primaryGain.gain.value = 0.34;
    const overtoneGain = context.createGain();
    overtoneGain.gain.value = 0.075;

    const toneFilter = context.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = 5200;
    toneFilter.Q.value = 0.5;

    const noise = context.createBufferSource();
    noise.buffer = this.createNoiseBuffer(context, duration);

    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueCurveAtTime(noiseSweepCurve, now, duration);
    noiseFilter.Q.value = 5.2;

    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.11;

    const triggerGain = context.createGain();
    triggerGain.gain.setValueCurveAtTime(envelopeCurve, now, duration);

    primary.connect(primaryGain);
    primaryGain.connect(toneFilter);
    overtone.connect(overtoneGain);
    overtoneGain.connect(toneFilter);
    toneFilter.connect(triggerGain);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(triggerGain);
    triggerGain.connect(this.master);

    primary.start(now);
    overtone.start(now);
    noise.start(now);
    primary.stop(now + duration);
    overtone.stop(now + duration);
    noise.stop(now + duration);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      primary.disconnect();
      overtone.disconnect();
      primaryGain.disconnect();
      overtoneGain.disconnect();
      toneFilter.disconnect();
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
      triggerGain.disconnect();
    };
    noise.onended = cleanup;
  }

  private createPitchDownSCurve(
    highHz: number,
    lowHz: number,
    steps: number,
    transitionRatio: number,
  ): Float32Array {
    const curve = new Float32Array(steps);
    for (let index = 0; index < steps; index += 1) {
      const progress = index / Math.max(1, steps - 1);
      const transitionProgress = Math.min(1, progress / transitionRatio);
      const eased = transitionProgress * transitionProgress * (3 - 2 * transitionProgress);
      curve[index] = highHz * Math.pow(lowHz / highHz, eased);
    }
    return curve;
  }

  private createTriggerEnvelopeCurve(steps: number): Float32Array {
    const curve = new Float32Array(steps);
    for (let index = 0; index < steps; index += 1) {
      const progress = index / Math.max(1, steps - 1);
      const attack = Math.min(1, progress / 0.008);
      const release = Math.pow(1 - progress, 1.35);
      curve[index] = 0.0001 + 0.62 * attack * release;
    }
    return curve;
  }

  private createOneShotEnvelopeCurve(
    steps: number,
    peak: number,
    attackRatio: number,
    decayPower: number,
  ): Float32Array {
    const curve = new Float32Array(steps);
    for (let index = 0; index < steps; index += 1) {
      const progress = index / Math.max(1, steps - 1);
      const attack = Math.min(1, progress / Math.max(0.0001, attackRatio));
      const release = Math.pow(1 - progress, decayPower);
      curve[index] = 0.0001 + peak * attack * release;
    }
    return curve;
  }

  private createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.38 + white * 0.62;
      data[index] = last;
    }
    return buffer;
  }

  private createCrackleBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    let envelope = 0;
    let polarity = 1;

    for (let index = 0; index < frameCount; index += 1) {
      if (Math.random() < 0.0045) {
        envelope = 0.45 + Math.random() * 0.55;
        polarity = Math.random() > 0.5 ? 1 : -1;
      }

      data[index] = polarity * envelope * (0.55 + Math.random() * 0.45);
      envelope *= 0.82;
    }

    return buffer;
  }
}
