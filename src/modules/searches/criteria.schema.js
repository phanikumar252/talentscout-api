import { z } from 'zod';
import { LOCATIONS, SENIORITY, SKILLS, TITLES } from '../../engine/vocabulary.js';

const fromVocabulary = (vocabulary) => z.enum(/** @type {[string, ...string[]]} */ (Object.keys(vocabulary)));
const years = z.number().int().min(0).max(50).nullable();
const companyName = z.string().trim().min(1).max(80);

/** Validates criteria edited by hand in the UI (the interpreter's output already fits it). */
export const criteriaSchema = z
  .object({
    titles: z.array(fromVocabulary(TITLES)).max(10),
    skills: z.array(fromVocabulary(SKILLS)).max(25),
    locations: z.array(fromVocabulary(LOCATIONS)).max(10),
    seniority: z.array(fromVocabulary(SENIORITY)).max(4),
    minYears: years,
    maxYears: years,
    includeCompanies: z.array(companyName).max(20),
    excludeCompanies: z.array(companyName).max(20),
    openToWorkOnly: z.boolean(),
  })
  .refine((c) => c.minYears == null || c.maxYears == null || c.minYears <= c.maxYears, {
    message: 'minYears cannot be greater than maxYears',
    path: ['minYears'],
  });
