import { Candidate, Organization, User } from './models/index.js';
import { generateCandidates } from '../engine/candidateGenerator.js';
import { hashPassword } from '../lib/password.js';
import { logger } from '../lib/logger.js';

export const DEMO_PASSWORD = 'Demo@1234';

// Two organisations so tenant isolation can be demonstrated and tested.
const DEMO_ACCOUNTS = [
  { org: 'Northwind Staffing', email: 'demo@talentscout.dev', fullName: 'Demo Recruiter', credits: 25 },
  { org: 'Contoso Talent', email: 'other@talentscout.dev', fullName: 'Other Org Recruiter', credits: 5 },
];

/** Idempotent: only inserts what is missing, so it is safe to run on every boot. */
export async function seedDatabase() {
  for (const account of DEMO_ACCOUNTS) {
    if (await User.exists({ email: account.email })) continue;
    const org = await Organization.create({ name: account.org });
    await User.create({
      orgId: org._id,
      email: account.email,
      fullName: account.fullName,
      passwordHash: hashPassword(DEMO_PASSWORD),
      credits: { total: account.credits, used: 0 },
    });
  }

  if ((await Candidate.estimatedDocumentCount()) === 0) {
    const candidates = generateCandidates();
    await Candidate.insertMany(candidates, { ordered: false });
    logger.info('seeded_candidates', { count: candidates.length });
  }
}
