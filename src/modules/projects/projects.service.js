import mongoose from 'mongoose';
import { Evaluation, Message, Project, Search, ShortlistEntry, CandidateSummary } from '../../db/models/index.js';
import { notFound } from '../../lib/errors.js';

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

export async function listProjects(auth) {
  // One aggregation instead of N+1 count queries per project.
  const projects = await Project.aggregate([
    { $match: { orgId: toObjectId(auth.orgId) } },
    { $sort: { updatedAt: -1 } },
    { $lookup: { from: 'searches', localField: '_id', foreignField: 'projectId', as: 'searches', pipeline: [{ $project: { _id: 1 } }] } },
    { $lookup: { from: 'shortlistentries', localField: '_id', foreignField: 'projectId', as: 'shortlist', pipeline: [{ $project: { _id: 1 } }] } },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: 1,
        description: 1,
        createdAt: 1,
        updatedAt: 1,
        searchCount: { $size: '$searches' },
        shortlistCount: { $size: '$shortlist' },
      },
    },
  ]);
  return projects;
}

/** Loads a project only if it belongs to the caller's org; otherwise 404 (not 403, to avoid leaking ids). */
export async function getOwnedProject(auth, projectId) {
  const project = await Project.findOne({ _id: projectId, orgId: auth.orgId });
  if (!project) throw notFound('Project');
  return project;
}

export async function getProjectDetail(auth, projectId) {
  const project = await getOwnedProject(auth, projectId);
  const searches = await Search.find({ projectId: project._id }).sort({ updatedAt: -1 });
  return { ...project.toJSON(), searches: searches.map((search) => search.toJSON()) };
}

export async function createProject(auth, { name, description }) {
  const project = await Project.create({ orgId: auth.orgId, ownerId: auth.userId, name, description });
  return project.toJSON();
}

export async function updateProject(auth, projectId, changes) {
  const project = await Project.findOneAndUpdate({ _id: projectId, orgId: auth.orgId }, { $set: changes }, { new: true, runValidators: true });
  if (!project) throw notFound('Project');
  return project.toJSON();
}

/** Mongo has no cascading deletes, so children are removed explicitly. */
export async function deleteProject(auth, projectId) {
  const project = await getOwnedProject(auth, projectId);
  const searchIds = await Search.find({ projectId: project._id }).distinct('_id');
  await Promise.all([
    Message.deleteMany({ searchId: { $in: searchIds } }),
    Evaluation.deleteMany({ searchId: { $in: searchIds } }),
    CandidateSummary.deleteMany({ searchId: { $in: searchIds } }),
    ShortlistEntry.deleteMany({ projectId: project._id }),
  ]);
  await Search.deleteMany({ projectId: project._id });
  await project.deleteOne();
}

/** Bumps updatedAt so recently used projects sort first. */
export async function touchProject(projectId) {
  await Project.updateOne({ _id: projectId }, { $currentDate: { updatedAt: true } });
}
