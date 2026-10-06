import mongoose from 'mongoose';
import { baseSchemaOptions } from '../plugins.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

// ---------- Tenancy & users ----------

const organizationSchema = new Schema({ name: { type: String, required: true, trim: true } }, baseSchemaOptions);

const userSchema = new Schema(
  {
    orgId: { type: ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    credits: {
      total: { type: Number, required: true, default: 25, min: 0 },
      used: { type: Number, required: true, default: 0, min: 0 },
    },
  },
  baseSchemaOptions,
);

// ---------- Projects & searches ----------

const projectSchema = new Schema(
  {
    orgId: { type: ObjectId, ref: 'Organization', required: true },
    ownerId: { type: ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
  },
  baseSchemaOptions,
);
projectSchema.index({ orgId: 1, updatedAt: -1 });

/** Structured search requirements produced by the interpreter or edited by hand. */
export const criteriaSchema = new Schema(
  {
    titles: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    locations: { type: [String], default: [] },
    seniority: { type: [String], default: [] },
    minYears: { type: Number, default: null },
    maxYears: { type: Number, default: null },
    includeCompanies: { type: [String], default: [] },
    excludeCompanies: { type: [String], default: [] },
    openToWorkOnly: { type: Boolean, default: false },
  },
  { _id: false },
);

const searchSchema = new Schema(
  {
    // orgId is denormalised from the project so the ownership check is one indexed query.
    orgId: { type: ObjectId, ref: 'Organization', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    criteria: { type: criteriaSchema, default: () => ({}) },
  },
  baseSchemaOptions,
);
searchSchema.index({ projectId: 1, updatedAt: -1 });
searchSchema.index({ _id: 1, orgId: 1 });

const messageSchema = new Schema(
  {
    searchId: { type: ObjectId, ref: 'Search', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ searchId: 1, createdAt: 1 });

// ---------- Candidate pool ----------

const candidateSchema = new Schema(
  {
    fullName: { type: String, required: true },
    headline: { type: String, required: true },
    title: { type: String, required: true },
    seniority: { type: String, enum: ['junior', 'mid', 'senior', 'lead'], required: true },
    company: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    remote: { type: Boolean, default: false },
    yearsExperience: { type: Number, required: true, min: 0 },
    skills: { type: [String], default: [] },
    history: [
      new Schema({ title: String, company: String, startYear: Number, endYear: Number }, { _id: false }),
    ],
    education: { type: String, default: '' },
    email: { type: String, required: true, select: false },
    openToWork: { type: Boolean, default: false },
  },
  { ...baseSchemaOptions, timestamps: false },
);
// Multikey indexes used by the pre-filter before in-memory scoring.
candidateSchema.index({ title: 1 });
candidateSchema.index({ 'history.title': 1 });
candidateSchema.index({ skills: 1 });

// ---------- Recruiter actions ----------

const shortlistEntrySchema = new Schema(
  {
    orgId: { type: ObjectId, ref: 'Organization', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    candidateId: { type: ObjectId, ref: 'Candidate', required: true },
    searchId: { type: ObjectId, ref: 'Search', default: null },
    addedBy: { type: ObjectId, ref: 'User', required: true },
  },
  baseSchemaOptions,
);
shortlistEntrySchema.index({ projectId: 1, candidateId: 1 }, { unique: true });

const evaluationSchema = new Schema(
  {
    searchId: { type: ObjectId, ref: 'Search', required: true },
    candidateId: { type: ObjectId, ref: 'Candidate', required: true },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], required: true },
    score: { type: Number, default: null },
    verdict: { type: String, enum: ['strong', 'possible', 'weak', null], default: null },
    checks: { type: [Schema.Types.Mixed], default: [] },
  },
  baseSchemaOptions,
);
evaluationSchema.index({ searchId: 1, candidateId: 1 }, { unique: true });
evaluationSchema.index({ status: 1 });

const candidateSummarySchema = new Schema(
  {
    searchId: { type: ObjectId, ref: 'Search', required: true },
    candidateId: { type: ObjectId, ref: 'Candidate', required: true },
    content: { type: String, required: true },
  },
  baseSchemaOptions,
);
candidateSummarySchema.index({ searchId: 1, candidateId: 1 }, { unique: true });

// One row per paid action; the unique index makes charging idempotent.
const creditLedgerSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true },
    reference: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
creditLedgerSchema.index({ userId: 1, reason: 1, reference: 1 }, { unique: true });

export const Organization = model('Organization', organizationSchema);
export const User = model('User', userSchema);
export const Project = model('Project', projectSchema);
export const Search = model('Search', searchSchema);
export const Message = model('Message', messageSchema);
export const Candidate = model('Candidate', candidateSchema);
export const ShortlistEntry = model('ShortlistEntry', shortlistEntrySchema);
export const Evaluation = model('Evaluation', evaluationSchema);
export const CandidateSummary = model('CandidateSummary', candidateSummarySchema);
export const CreditLedger = model('CreditLedger', creditLedgerSchema);
