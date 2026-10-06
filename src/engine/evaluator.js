import { formatYears } from './interpreter.js';
import { locationMatches } from './scoring.js';

/**
 * Per-requirement assessment of one candidate: the "deep" evaluation recruiters
 * run on a handful of profiles, as opposed to the quick score in the result list.
 *
 * @returns {{ score: number, verdict: 'strong' | 'possible' | 'weak', checks: Array<{ requirement: string, status: 'met' | 'partial' | 'missing', note: string }> }}
 */
export function evaluateCandidate(candidate, criteria) {
  const checks = [];

  if (criteria.titles.length) {
    const current = criteria.titles.includes(candidate.title);
    const past = candidate.history.find((role) => criteria.titles.includes(role.title));
    checks.push({
      requirement: `Role: ${criteria.titles.join(' / ')}`,
      status: current ? 'met' : past ? 'partial' : 'missing',
      note: current ? `Currently ${candidate.title}` : past ? `Was ${past.title} at ${past.company}` : `Currently ${candidate.title}`,
    });
  }

  for (const skill of criteria.skills) {
    const has = candidate.skills.includes(skill);
    checks.push({ requirement: `Skill: ${skill}`, status: has ? 'met' : 'missing', note: has ? 'Listed on profile' : 'Not listed' });
  }

  if (criteria.locations.length) {
    const ok = criteria.locations.some((label) => locationMatches(label, candidate));
    checks.push({
      requirement: `Location: ${criteria.locations.join(' / ')}`,
      status: ok ? 'met' : candidate.remote ? 'partial' : 'missing',
      note: `${candidate.city}, ${candidate.country}${candidate.remote ? ' (open to remote)' : ''}`,
    });
  }

  if (criteria.minYears != null || criteria.maxYears != null) {
    const years = candidate.yearsExperience;
    const within = (criteria.minYears == null || years >= criteria.minYears) && (criteria.maxYears == null || years <= criteria.maxYears);
    const close = !within && ((criteria.minYears != null && criteria.minYears - years <= 1) || (criteria.maxYears != null && years - criteria.maxYears <= 1));
    checks.push({
      requirement: `Experience: ${formatYears(criteria.minYears, criteria.maxYears)}`,
      status: within ? 'met' : close ? 'partial' : 'missing',
      note: `${years} years`,
    });
  }

  if (criteria.seniority.length) {
    const ok = criteria.seniority.includes(candidate.seniority);
    checks.push({ requirement: `Seniority: ${criteria.seniority.join(' / ')}`, status: ok ? 'met' : 'missing', note: candidate.seniority });
  }

  if (criteria.includeCompanies.length) {
    const employers = [candidate.company, ...candidate.history.map((role) => role.company)];
    const hit = criteria.includeCompanies.find((company) => employers.includes(company));
    checks.push({ requirement: `Companies: ${criteria.includeCompanies.join(' / ')}`, status: hit ? 'met' : 'missing', note: hit ? `Worked at ${hit}` : 'No overlap' });
  }

  const points = { met: 1, partial: 0.5, missing: 0 };
  const score = checks.length ? Math.round((checks.reduce((sum, check) => sum + points[check.status], 0) / checks.length) * 100) : 0;
  const verdict = score >= 80 ? 'strong' : score >= 55 ? 'possible' : 'weak';
  return { score, verdict, checks };
}
