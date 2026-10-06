import './setup-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCriteria, interpretMessage, parseYears } from '../src/engine/interpreter.js';
import { buildCandidateFilter, rankCandidates, scoreCandidate } from '../src/engine/scoring.js';
import { evaluateCandidate } from '../src/engine/evaluator.js';
import { generateCandidates } from '../src/engine/candidateGenerator.js';
import { toCsv } from '../src/lib/csv.js';

const candidate = (overrides = {}) => ({
  id: 'c1',
  fullName: 'Test Person',
  title: 'Frontend Engineer',
  seniority: 'senior',
  company: 'Stripe',
  city: 'Austin',
  country: 'United States',
  remote: false,
  yearsExperience: 6,
  skills: ['React', 'TypeScript', 'CSS'],
  history: [{ title: 'Frontend Engineer', company: 'Shopify', startYear: 2019, endYear: 2022 }],
  openToWork: true,
  ...overrides,
});

describe('interpretMessage', () => {
  it('extracts role, skills, location, seniority and experience from one sentence', () => {
    const { criteria } = interpretMessage('Senior React developer in Austin or remote with 5+ years, TypeScript and GraphQL');
    assert.deepEqual(criteria.titles, ['Frontend Engineer']);
    assert.deepEqual([...criteria.skills].sort(), ['GraphQL', 'React', 'TypeScript']);
    assert.deepEqual([...criteria.locations].sort(), ['Austin', 'Remote']);
    assert.deepEqual(criteria.seniority, ['senior']);
    assert.equal(criteria.minYears, 5);
    assert.equal(criteria.maxYears, null);
  });

  it('treats a "not from" clause as an exclusion without dropping the rest', () => {
    const { criteria } = interpretMessage('backend engineer with Node.js in Berlin but not from Google');
    assert.deepEqual(criteria.titles, ['Backend Engineer']);
    assert.deepEqual(criteria.skills, ['Node.js']);
    assert.deepEqual(criteria.excludeCompanies, ['Google']);
  });

  it('applies follow-up messages incrementally', () => {
    const first = interpretMessage('frontend engineer with react and vue in london').criteria;
    const second = interpretMessage('remove vue and add graphql', first).criteria;
    assert.deepEqual([...second.skills].sort(), ['GraphQL', 'React']);
    assert.deepEqual(second.locations, ['London']);
  });

  it('resets on "start over"', () => {
    const first = interpretMessage('data engineer with spark').criteria;
    const { criteria } = interpretMessage('start over: QA engineer with cypress', first);
    assert.deepEqual(criteria.titles, ['QA Engineer']);
    assert.deepEqual(criteria.skills, ['Cypress']);
  });

  it('does not match short aliases inside other tokens', () => {
    const { criteria } = interpretMessage('next.js developer');
    assert.deepEqual(criteria.skills, ['Next.js']);
  });

  it('prefers the longest phrase ("react native" is not "react")', () => {
    const { criteria } = interpretMessage('mobile developer with react native');
    assert.deepEqual(criteria.skills, ['React Native']);
  });

  it('returns no changes for small talk', () => {
    const { criteria, changes } = interpretMessage('hello there, how are you?');
    assert.deepEqual(criteria, emptyCriteria());
    assert.deepEqual(changes, []);
  });
});

describe('parseYears', () => {
  const cases = [
    ['3-6 years', { min: 3, max: 6 }],
    ['between 8 to 4 yrs', { min: 4, max: 8 }],
    ['at least 7 years', { min: 7, max: null }],
    ['less than 2 years', { min: null, max: 2 }],
    ['10+ yoe', { min: 10, max: null }],
    ['no experience mentioned', null],
  ];
  for (const [input, expected] of cases) {
    it(`parses "${input}"`, () => assert.deepEqual(parseYears(input), expected));
  }
});

describe('scoring', () => {
  const criteria = { ...emptyCriteria(), titles: ['Frontend Engineer'], skills: ['React', 'GraphQL'], locations: ['Austin'], minYears: 5 };

  it('scores a strong match highly and lists what matched and what is missing', () => {
    const match = scoreCandidate(candidate(), criteria);
    assert.ok(match.score >= 80, `score was ${match.score}`);
    assert.ok(match.missing.some((m) => m.includes('GraphQL')));
  });

  it('applies hard filters', () => {
    assert.equal(scoreCandidate(candidate({ company: 'Google' }), { ...criteria, excludeCompanies: ['Google'] }), null);
    assert.equal(scoreCandidate(candidate({ openToWork: false }), { ...criteria, openToWorkOnly: true }), null);
  });

  it('requires a role or skill hit when those were requested', () => {
    const unrelated = candidate({ title: 'Data Scientist', skills: ['Python'], history: [] });
    assert.equal(scoreCandidate(unrelated, criteria), null);
  });

  it('ranks best first and returns nothing for empty criteria', () => {
    const pool = [candidate({ id: 'weak', skills: ['CSS'], city: 'Berlin' }), candidate({ id: 'strong', skills: ['React', 'GraphQL'] })];
    assert.equal(rankCandidates(pool, criteria)[0].candidate.id, 'strong');
    assert.deepEqual(rankCandidates(pool, emptyCriteria()), []);
  });

  it('builds a Mongo pre-filter that mirrors the hard rules', () => {
    const filter = buildCandidateFilter({ ...criteria, excludeCompanies: ['Meta'], openToWorkOnly: true });
    assert.equal(filter.$or.length, 3);
    assert.deepEqual(filter.company, { $nin: ['Meta'] });
    assert.equal(filter.openToWork, true);
  });
});

describe('evaluateCandidate', () => {
  it('produces one check per requirement and a verdict', () => {
    const result = evaluateCandidate(candidate(), { ...emptyCriteria(), titles: ['Frontend Engineer'], skills: ['React', 'Kafka'] });
    assert.equal(result.checks.length, 3);
    assert.equal(result.checks.find((c) => c.requirement === 'Skill: Kafka').status, 'missing');
    assert.ok(['strong', 'possible', 'weak'].includes(result.verdict));
  });
});

describe('generateCandidates', () => {
  it('is deterministic for the same seed', () => {
    assert.deepEqual(generateCandidates(5, 7), generateCandidates(5, 7));
  });
});

describe('toCsv', () => {
  it('quotes special characters and neutralises formula injection', () => {
    const csv = toCsv([{ label: 'Name', value: (r) => r }], ['a,"b"', '=HYPERLINK("x")']);
    assert.equal(csv, 'Name\r\n"a,""b"""\r\n"\'=HYPERLINK(""x"")"');
  });
});
