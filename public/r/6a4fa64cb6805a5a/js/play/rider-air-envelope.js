const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export const RIDER_AIR_TIMING = Object.freeze({
  tuckSeconds: 0.15,
  tuckHoldSeconds: 0.03,
  minimumFlightSeconds: 0.18,
  deadlineShortenRate: 1.5,
  deadlineLengthenRate: 3,
  jumpOffFadeStartSeconds: 0.04,
  jumpOffFadeEndSeconds: 0.16,
});

export function initialAirEnvelope(estimatedRemainingSeconds, options = {}) {
  const timing = { ...RIDER_AIR_TIMING, ...options };
  const remaining = Math.max(0, Number(estimatedRemainingSeconds) || 0);
  return {
    elapsed: 0,
    landingTime: Math.max(timing.minimumFlightSeconds, remaining),
  };
}

export function reviseLandingTime(landingTime, elapsed, estimatedRemainingSeconds, dt, options = {}) {
  const timing = { ...RIDER_AIR_TIMING, ...options };
  const step = Math.max(0, Number(dt) || 0);
  const now = Math.max(0, Number(elapsed) || 0);
  const previous = Math.max(now, Number(landingTime) || now);
  const remaining = Number(estimatedRemainingSeconds);
  if (!(remaining > 0)) return previous;
  const requested = Math.max(now + step, now + remaining);
  const delta = requested - previous;
  const rate = delta < 0 ? timing.deadlineShortenRate : timing.deadlineLengthenRate;
  const limit = rate * step;
  return Math.max(now + step, previous + Math.max(-limit, Math.min(limit, delta)));
}

export function sampleAirEnvelope(elapsedSeconds, landingTimeSeconds, options = {}) {
  const timing = { ...RIDER_AIR_TIMING, ...options };
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const landingTime = Math.max(timing.minimumFlightSeconds, Number(landingTimeSeconds) || 0);
  const peakTime = Math.min(timing.tuckSeconds, landingTime * 0.48);
  const extensionStart = Math.min(
    timing.tuckSeconds + timing.tuckHoldSeconds,
    landingTime * 0.58,
  );
  const rise = smoothstep(elapsed / Math.max(1e-6, peakTime));
  const extension = smoothstep(
    (elapsed - extensionStart) / Math.max(1e-6, landingTime - extensionStart),
  );
  return clamp01(rise * (1 - extension));
}

export function jumpOffOverlayScale(elapsedSeconds, options = {}) {
  const timing = { ...RIDER_AIR_TIMING, ...options };
  const span = Math.max(1e-6, timing.jumpOffFadeEndSeconds - timing.jumpOffFadeStartSeconds);
  return 1 - smoothstep((elapsedSeconds - timing.jumpOffFadeStartSeconds) / span);
}

export function airOverlayScale(tuck) {
  return 1 - smoothstep(tuck);
}

export function stepAirEnvelope(state, dt, estimatedRemainingSeconds, options = {}) {
  const previous = state || initialAirEnvelope(estimatedRemainingSeconds, options);
  const step = Math.max(0, Number(dt) || 0);
  const elapsed = previous.elapsed + step;
  const landingTime = reviseLandingTime(
    previous.landingTime,
    elapsed,
    estimatedRemainingSeconds,
    step,
    options,
  );
  const tuck = sampleAirEnvelope(elapsed, landingTime, options);
  return {
    elapsed,
    landingTime,
    tuck,
    jumpOffScale: jumpOffOverlayScale(elapsed, options),
    airScale: airOverlayScale(tuck),
  };
}
