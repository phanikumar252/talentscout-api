import { formatYears, hasCriteria } from './interpreter.js';

const list = (items, joiner = 'or') =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${joiner} ${items.at(-1)}`;

/** One-sentence, human description of the criteria. */
export function describeCriteria(criteria) {
  const seniority = criteria.seniority.length ? `${list(criteria.seniority)} ` : '';
  const role = criteria.titles.length ? list(criteria.titles) : 'candidates';
  const parts = [`${seniority}${role}`];
  if (criteria.skills.length) parts.push(`with ${list(criteria.skills, 'and')}`);
  if (criteria.locations.length) parts.push(`in ${list(criteria.locations)}`);
  if (criteria.minYears != null || criteria.maxYears != null) parts.push(`(${formatYears(criteria.minYears, criteria.maxYears)})`);
  if (criteria.includeCompanies.length) parts.push(`who have worked at ${list(criteria.includeCompanies)}`);
  if (criteria.excludeCompanies.length) parts.push(`excluding people currently at ${list(criteria.excludeCompanies)}`);
  if (criteria.openToWorkOnly) parts.push('who are open to work');
  return parts.join(' ');
}

export function composeReply({ criteria, changes, total, top }) {
  if (!hasCriteria(criteria)) {
    return 'I could not find a role, skills or location in that yet. Try something like: "Senior React developer in Austin or remote, 5+ years, TypeScript and GraphQL, not from Google".';
  }

  const sentences = [];
  sentences.push(changes.length ? `Updated the search: ${changes.join('; ')}.` : 'I did not spot any new requirements, so I kept the current search.');
  sentences.push(`Looking for ${describeCriteria(criteria)}.`);

  if (total === 0) {
    sentences.push('No profiles match all of that. Try removing a skill, widening the experience range or adding "remote".');
  } else {
    const best = top.map((entry) => `${entry.candidate.fullName} (${entry.match.score}%)`);
    sentences.push(`Found ${total} matching profile${total === 1 ? '' : 's'}. Strongest matches: ${list(best, 'and')}.`);
  }
  return sentences.join(' ');
}

/** Short recruiter-facing summary of a candidate for this particular search. */
export function writeCandidateSummary(candidate, criteria, match) {
  const where = candidate.remote ? `${candidate.city} (open to remote)` : candidate.city;
  const lines = [
    `${candidate.fullName} is a ${candidate.seniority} ${candidate.title} at ${candidate.company} with ${candidate.yearsExperience} years of experience, based in ${where}.`,
  ];

  const pastEmployers = [...new Set(candidate.history.map((role) => role.company))].filter((c) => c !== candidate.company);
  if (pastEmployers.length) lines.push(`Previously worked at ${list(pastEmployers, 'and')}.`);

  if (criteria.skills.length) {
    const hits = criteria.skills.filter((skill) => candidate.skills.includes(skill));
    lines.push(
      hits.length
        ? `Covers ${hits.length} of ${criteria.skills.length} requested skills (${hits.join(', ')}).`
        : 'Does not list any of the requested skills.',
    );
  }

  if (match?.missing.length) lines.push(`Gaps to probe in a screen: ${match.missing.join('; ')}.`);
  lines.push(candidate.openToWork ? 'Marked as open to new opportunities.' : 'Not actively looking, so a tailored outreach message will matter.');
  if (candidate.education) lines.push(`Education: ${candidate.education}.`);
  return lines.join(' ');
}
