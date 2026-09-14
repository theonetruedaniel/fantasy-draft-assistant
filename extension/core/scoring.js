import { STAT_KEYS, scoringKey } from './contracts.js';

export function scorePlayer(player, profile) {
  if(player.projectionPartial)return {points:null,reason:`Partial projection: ${player.projectionScope||'components incomplete'}`};
  const basis = scoringKey(profile);
  if (Number.isFinite(player.projectedPoints) && player.scoringBasis === basis) {
    return { points: player.projectedPoints, reason: 'Supplied total matches this scoring profile' };
  }
  if (profile.unsupportedRules?.length) return { points: null, reason: 'Unsupported scoring rules need a matching supplied total' };
  const rules = Object.entries(profile.pointsPer || {});
  if (!rules.length || rules.some(([k,v]) => !STAT_KEYS.includes(k) || !Number.isFinite(v))) return { points: null, reason: 'Unsupported scoring coefficients' };
  if (!player.projections) return { points: null, reason: 'Projection components or matching scoring basis missing' };
  const missing = rules.filter(([k,v]) => v !== 0 && !Number.isFinite(player.projections[k])).map(([k]) => k);
  if (missing.length) return { points: null, reason: `Missing projection components: ${missing.join(', ')}` };
  const points = rules.reduce((sum,[k,v]) => sum + (v === 0 ? 0 : player.projections[k] * v), 0);
  return Number.isFinite(points) ? { points, reason: 'Recalculated from supplied components' } : { points: null, reason: 'Invalid projection total' };
}
