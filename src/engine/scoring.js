import { LOCATIONS } from './vocabulary.js';
import { formatYears, hasCriteria } from './interpreter.js';

// Relative importance of each requirement. A candidate's score is the share of
// weight earned out of the weight that was actually requested.
const WEIGHTS = { title: 30, skills: 35, location: 15, years: 10, seniority: 10, companies: 10 };
const MIN_SCORE = 40;

export function locationMatches(label, candidate) {
  const location = LOCATIONS[label];
  if (!location) return false;
  if (location.kind === 'remote') return candidate.remote;
  if (location.kind === 'country') return candidate.country === label;
  return candidate.city === label;
}

/**
 * Scores one candidate against the criteria.
 * @returns {{ score: number, matched: string[], missing: string[] } | null} null = filtered out
 */
export function scoreCandidate(candidate, criteria) {
  // Hard filters first
  if (criteria.excludeCompanies.includes(candidate.company)) return null;
  if (criteria.openToWorkOnly && !candidate.openToWork) return null;

  let earned = 0;
  let possible = 0;
  const matched = [];
  const missing = [];
  let coreHit = false;

  const award = (weight, ratio, hit, miss) => {
    possible += weight;
    earned += weight * ratio;
    if (ratio > 0 && hit) matched.push(hit);
    if (ratio < 1 && miss) missing.push(miss);
  };

  if (criteria.titles.length) {
    const current = criteria.titles.includes(candidate.title);
    const past = !current && candidate.history.some((role) => criteria.titles.includes(role.title));
    coreHit ||= current || past;
    award(
      WEIGHTS.title,
      current ? 1 : past ? 0.5 : 0,
      current ? `Current role: ${candidate.title}` : past ? 'Has held this role before' : null,
      current ? null : `Role: ${criteria.titles.join(' / ')}`,
    );
  }

  if (criteria.skills.length) {
    const hits = criteria.skills.filter((skill) => candidate.skills.includes(skill));
    const misses = criteria.skills.filter((skill) => !candidate.skills.includes(skill));
    coreHit ||= hits.length > 0;
    award(
      WEIGHTS.skills,
      hits.length / criteria.skills.length,
      hits.length ? `Skills: ${hits.join(', ')}` : null,
      misses.length ? `Skills: ${misses.join(', ')}` : null,
    );
  }

  if (criteria.locations.length) {
    const ok = criteria.locations.some((label) => locationMatches(label, candidate));
    award(WEIGHTS.location, ok ? 1 : 0, ok ? `Location: ${candidate.remote ? `${candidate.city} (remote)` : candidate.city}` : null, ok ? null : `Location: ${criteria.locations.join(' / ')}`);
  }

  if (criteria.minYears != null || criteria.maxYears != null) {
    const years = candidate.yearsExperience;
    const tooFew = criteria.minYears != null ? criteria.minYears - years : 0;
    const tooMany = criteria.maxYears != null ? years - criteria.maxYears : 0;
    const gap = Math.max(tooFew, tooMany, 0);
    award(WEIGHTS.years, gap === 0 ? 1 : gap <= 1 ? 0.5 : 0, gap === 0 ? `${years} years experience` : null, gap === 0 ? null : `Experience: ${formatYears(criteria.minYears, criteria.maxYears)}`);
  }

  if (criteria.seniority.length) {
    const ok = criteria.seniority.includes(candidate.seniority);
    award(WEIGHTS.seniority, ok ? 1 : 0, ok ? `Seniority: ${candidate.seniority}` : null, ok ? null : `Seniority: ${criteria.seniority.join(' / ')}`);
  }

  if (criteria.includeCompanies.length) {
    const employers = [candidate.company, ...candidate.history.map((role) => role.company)];
    const hit = criteria.includeCompanies.find((company) => employers.includes(company));
    award(WEIGHTS.companies, hit ? 1 : 0, hit ? `Worked at ${hit}` : null, hit ? null : `Companies: ${criteria.includeCompanies.join(' / ')}`);
  }

  if (possible === 0) return null;
  // If a role or skills were asked for, at least one of them must match;
  // otherwise "React dev in Austin" would return every Austin profile.
  if ((criteria.titles.length || criteria.skills.length) && !coreHit) return null;

  const score = Math.round((earned / possible) * 100);
  return score >= MIN_SCORE ? { score, matched, missing } : null;
}

/** Returns candidates that pass, best first. */
export function rankCandidates(candidates, criteria) {
  if (!hasCriteria(criteria)) return [];
  return candidates
    .map((candidate) => ({ candidate, match: scoreCandidate(candidate, criteria) }))
    .filter((entry) => entry.match !== null)
    .sort((a, b) => b.match.score - a.match.score || b.candidate.yearsExperience - a.candidate.yearsExperience);
}

/**
 * Builds a MongoDB pre-filter that narrows the pool using indexed fields before
 * the in-memory scoring runs. It mirrors the hard rules in scoreCandidate.
 */
export function buildCandidateFilter(criteria) {
  const filter = {};
  const core = [];
  if (criteria.titles.length) {
    core.push({ title: { $in: criteria.titles } }, { 'history.title': { $in: criteria.titles } });
  }
  if (criteria.skills.length) core.push({ skills: { $in: criteria.skills } });
  if (core.length) filter.$or = core;
  if (criteria.excludeCompanies.length) filter.company = { $nin: criteria.excludeCompanies };
  if (criteria.openToWorkOnly) filter.openToWork = true;
  return filter;
}
