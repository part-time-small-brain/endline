interface Pull {
  strength: number;
  up: boolean;
  lift: number;
}

export const NO_PULL: Pull = { strength: 0, up: false, lift: 0 };

export function pull(dx: number, dy: number, reach: { x: number; y: number }, part: number): Pull {
  const distance = Math.hypot(dx / reach.x, dy / reach.y);
  if (distance >= 1) return NO_PULL;
  const near = 1 - distance;
  const strength = near * near * (3 - 2 * near);
  return { strength, up: dy < 0, lift: Math.sign(dy) * part * strength * Math.max(0, 1 - (2 * Math.abs(dy)) / reach.y) };
}
