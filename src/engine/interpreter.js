import { COMPANIES, LOCATIONS, SENIORITY, SKILLS, TITLES } from './vocabulary.js';

/** @typedef {ReturnType<typeof emptyCriteria>} Criteria */
export const emptyCriteria = () => ({
  titles: [],
  skills: [],
  locations: [],
  seniority: [],
  minYears: null,
  maxYears: null,
  includeCompanies: [],
  excludeCompanies: [],
  openToWorkOnly: false,
});

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-bounded, allows a plural "s", and treats "+", "#" and "." as part of a token
// so "c#" and "node.js" work but "js" doesn't match inside "next.js".
function phraseRegex(phrase) {
  return new RegExp(`(?:^|[^a-z0-9+#.])${escapeRegex(phrase.toLowerCase())}s?(?=$|[^a-z0-9+#])`);
}

function buildMatcher(vocabulary, aliasesOf = (value) => value) {
  const patterns = Object.entries(vocabulary).flatMap(([canonical, value]) =>
    aliasesOf(value).map((alias) => ({ canonical, regex: phraseRegex(alias), length: alias.length })),
  );
  // Longest phrases first so "react native" wins over "react".
  patterns.sort((a, b) => b.length - a.length);

  return (text) => {
    const found = [];
    let remaining = text;
    for (const { canonical, regex } of patterns) {
      if (regex.test(remaining)) {
        if (!found.includes(canonical)) found.push(canonical);
        // Blank out the matched phrase so shorter aliases don't double-match it.
        remaining = remaining.replace(regex, (match) => match.replace(/[a-z0-9+#.]/g, ' '));
      }
    }
    return found;
  };
}

const matchTitles = buildMatcher(TITLES);
const matchSkills = buildMatcher(SKILLS);
const matchLocations = buildMatcher(LOCATIONS, (location) => location.aliases);
const matchCompanies = buildMatcher(COMPANIES);
const matchSeniority = buildMatcher(SENIORITY);

const NEGATION = /\b(remove|drop|without|exclude|excluding|except|not from|no one from|nobody from|minus|don'?t want|do not want|not at|never worked at)\b/;
const RESET = /\b(start over|new search|reset( the)? search|clear (all|everything|the search))\b/;
const ANY_LOCATION = /\b(any ?where|any location|location doesn'?t matter|no location preference)\b/;
const OPEN_TO_WORK = /\b(open to work|actively looking|available now|looking for (a )?(new )?(job|role|opportunit(y|ies)))\b/;
const YEAR_UNIT = '(?:years?|yrs?|yoe)';

// Clause boundaries: sentence punctuation (a "." only when it ends a sentence, so
// "node.js" survives), "but"/"however", and the start of an add/remove instruction
// ("remove vue and add graphql" becomes two clauses with opposite intent).
const CLAUSE_BOUNDARY = new RegExp(
  [
    '[;!?\\n]',
    '\\.(?=\\s|$)',
    ',?\\s+but\\s+',
    '\\s+however\\s+',
    ',?\\s+(?:and\\s+)?(?=(?:add|include|plus|also add)\\b)',
    ',?\\s+(?:and\\s+)?(?=(?:remove|drop|exclude|excluding|without|except|not from)\\b)',
  ].join('|'),
);

/** Extracts a {min, max} experience range from free text, or null. */
export function parseYears(text) {
  let m;
  if ((m = text.match(new RegExp(`(\\d{1,2})\\s*(?:-|to|–)\\s*(\\d{1,2})\\s*\\+?\\s*${YEAR_UNIT}`)))) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  if ((m = text.match(new RegExp(`(?:under|less than|fewer than|at most|no more than|max(?:imum)?(?: of)?|up to)\\s*(\\d{1,2})\\s*${YEAR_UNIT}`)))) {
    return { min: null, max: Number(m[1]) };
  }
  if ((m = text.match(new RegExp(`(?:at least|minimum(?: of)?|min\\.?|over|more than)\\s*(\\d{1,2})\\s*${YEAR_UNIT}`)))) {
    return { min: Number(m[1]), max: null };
  }
  if ((m = text.match(new RegExp(`(\\d{1,2})\\s*\\+?\\s*${YEAR_UNIT}`)))) {
    return { min: Number(m[1]), max: null };
  }
  return null;
}

const addAll = (list, values) => values.forEach((value) => !list.includes(value) && list.push(value));
const removeAll = (list, values) => list.filter((value) => !values.includes(value));

/**
 * Turns one recruiter message into an updated criteria object. Messages are
 * incremental: "add GraphQL", "drop Austin", "not from Google" change the
 * existing search rather than replacing it.
 *
 * @param {string} message
 * @param {Criteria} current
 * @returns {{ criteria: Criteria, changes: string[] }}
 */
export function interpretMessage(message, current = emptyCriteria()) {
  const text = ` ${message.toLowerCase().replace(/\s+/g, ' ')} `;
  const changes = [];
  const reset = RESET.test(text);
  const criteria = reset ? emptyCriteria() : structuredClone(current);
  if (reset) changes.push('Started a fresh search');

  // Split into clauses so "React in Austin but not from Google" treats only
  // the last part as a negation.
  const clauses = text.split(CLAUSE_BOUNDARY);

  for (const clause of clauses) {
    if (!clause.trim()) continue;
    const titles = matchTitles(clause);
    const skills = matchSkills(clause);
    const locations = matchLocations(clause);
    const companies = matchCompanies(clause);

    if (NEGATION.test(clause)) {
      if (companies.length) {
        addAll(criteria.excludeCompanies, companies);
        criteria.includeCompanies = removeAll(criteria.includeCompanies, companies);
        changes.push(`Excluding ${companies.join(', ')}`);
      }
      const removable = [
        ['titles', titles],
        ['skills', skills],
        ['locations', locations],
      ];
      for (const [key, values] of removable) {
        const present = values.filter((value) => criteria[key].includes(value));
        if (present.length) {
          criteria[key] = removeAll(criteria[key], present);
          changes.push(`Removed ${present.join(', ')}`);
        }
      }
      if (/\b(years?|experience)\b/.test(clause) && !parseYears(clause)) {
        criteria.minYears = null;
        criteria.maxYears = null;
        changes.push('Removed the experience requirement');
      }
      if (/\bseniority|level\b/.test(clause)) {
        criteria.seniority = [];
        changes.push('Removed the seniority requirement');
      }
      continue;
    }

    const newTitles = titles.filter((t) => !criteria.titles.includes(t));
    const newSkills = skills.filter((s) => !criteria.skills.includes(s));
    const newLocations = locations.filter((l) => !criteria.locations.includes(l));
    addAll(criteria.titles, newTitles);
    addAll(criteria.skills, newSkills);
    addAll(criteria.locations, newLocations);
    if (newTitles.length) changes.push(`Role: ${newTitles.join(', ')}`);
    if (newSkills.length) changes.push(`Skills: ${newSkills.join(', ')}`);
    if (newLocations.length) changes.push(`Location: ${newLocations.join(', ')}`);

    if (companies.length && /\b(at|from|ex|formerly|previously|worked)\b/.test(clause)) {
      addAll(criteria.includeCompanies, companies);
      criteria.excludeCompanies = removeAll(criteria.excludeCompanies, companies);
      changes.push(`Companies: ${companies.join(', ')}`);
    }

    const seniority = matchSeniority(clause);
    if (seniority.length) {
      criteria.seniority = seniority;
      changes.push(`Seniority: ${seniority.join(', ')}`);
    }

    const years = parseYears(clause);
    if (years) {
      criteria.minYears = years.min;
      criteria.maxYears = years.max;
      changes.push(`Experience: ${formatYears(years.min, years.max)}`);
    }

    if (ANY_LOCATION.test(clause) && criteria.locations.length) {
      criteria.locations = [];
      changes.push('Any location');
    }

    if (OPEN_TO_WORK.test(clause) && !criteria.openToWorkOnly) {
      criteria.openToWorkOnly = true;
      changes.push('Only people open to work');
    }
  }

  return { criteria, changes };
}

export function formatYears(min, max) {
  if (min != null && max != null) return `${min}–${max} years`;
  if (min != null) return `${min}+ years`;
  if (max != null) return `up to ${max} years`;
  return 'any experience';
}

export function hasCriteria(criteria) {
  return (
    criteria.titles.length > 0 ||
    criteria.skills.length > 0 ||
    criteria.locations.length > 0 ||
    criteria.seniority.length > 0 ||
    criteria.includeCompanies.length > 0 ||
    criteria.minYears != null ||
    criteria.maxYears != null
  );
}
