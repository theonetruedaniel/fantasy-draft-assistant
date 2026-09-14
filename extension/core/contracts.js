export const POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);
export const STAT_KEYS = Object.freeze(['passingYards', 'passingTD', 'interceptions', 'rushingYards', 'rushingTD', 'receptions', 'receivingYards', 'receivingTD', 'fumblesLost', 'twoPoint', 'extraPoints', 'fieldGoals', 'sacks', 'defensiveInterceptions', 'fumbleRecoveries', 'defensiveTD', 'safeties', 'blockedKicks']);

export function defaultProfile(which = '10-team') {
  return { revision: 0, teams: which === '8-team' ? 8 : 10, slot: which === '8-team' ? 5 : 10,
    starterSlots: [['QB'], ['RB'], ['RB'], ['WR'], ['WR'], ['TE'], ['RB','WR','TE'], ['K'], ['DST']],
    bench: 6, confirmed: false, unsupportedRules: [],
    pointsPer: { passingYards: 0.04, passingTD: 4, interceptions: -2, rushingYards: 0.1,
      rushingTD: 6, receptions: 1, receivingYards: 0.1, receivingTD: 6, fumblesLost: -2 } };
}

export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return { errors: ['Missing league profile'] };
  if (!Number.isInteger(profile.teams) || profile.teams < 2 || profile.teams > 32) errors.push('League size must be 2–32');
  if (!Number.isInteger(profile.slot) || profile.slot < 1 || profile.slot > profile.teams) errors.push('Draft slot is outside this league');
  if (!Number.isInteger(profile.bench) || profile.bench < 0 || profile.bench > 30) errors.push('Bench count must be 0–30');
  if (!Array.isArray(profile.starterSlots) || profile.starterSlots.length < 1 || profile.starterSlots.length > 16 ||
    profile.starterSlots.some(s => !Array.isArray(s) || !s.length || s.some(p => !POSITIONS.includes(p)))) errors.push('Unsupported starting slots');
  if (!profile.pointsPer || Object.entries(profile.pointsPer).some(([k,v]) => !STAT_KEYS.includes(k) || !Number.isFinite(v))) errors.push('Unsupported scoring coefficients');
  return { errors };
}

export function scoringKey(profile) {
  return JSON.stringify({ pointsPer: Object.fromEntries(Object.entries(profile.pointsPer || {}).sort(([a],[b]) => a.localeCompare(b))), unsupportedRules: profile.unsupportedRules || [] });
}

export function profileKey(profile) {
  return JSON.stringify({ teams: profile.teams, slot: profile.slot, starterSlots: profile.starterSlots,
    bench: profile.bench, confirmed: !!profile.confirmed, scoring: scoringKey(profile), revision: profile.revision || 0 });
}

export function normalizeName(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizePosition(position) {
  const value = String(position || '').trim().toUpperCase();
  return ['D/ST', 'DEF', 'D', 'DST'].includes(value) ? 'DST' : value;
}

export function normalizeTeam(team) {
  const value = String(team || '').trim().toUpperCase();
  return ({ JAC: 'JAX', WSH: 'WAS', LA: 'LAR' })[value] || value;
}
