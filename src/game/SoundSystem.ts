interface SoundState {
  heatActive: boolean;
  frostActive: boolean;
  boostActive: boolean;
  speedRatio: number;
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
  private heatAudible = false;
  private frostAudible = false;
  private lastBoostActive = false;

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
    this.setHeatActive(false);
    this.setFrostActive(false);
  }

  update(state: SoundState): void {
    if (state.heatActive || state.frostActive || (state.boostActive && !this.lastBoostActive)) {
      this.resume();
    }

    this.setHeatActive(state.heatActive);
    this.setFrostActive(state.frostActive);

    if (state.boostActive && !this.lastBoostActive) {
      this.playSprintWhoosh(state.speedRatio);
    }
    this.lastBoostActive = state.boostActive;
  }

  dispose(): void {
    window.removeEventListener("pointerdown", this.unlockAudio, true);
    window.removeEventListener("keydown", this.unlockAudio, true);
    this.context?.close().catch(() => undefined);
    this.context = undefined;
  }

  private readonly unlockAudio = (): void => {
    this.resume();
  };

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

  private fadeLoop(gain: GainNode | undefined, target: number, timeConstant: number): void {
    if (!this.context || !gain) {
      return;
    }

    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(target, now, timeConstant);
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
}
