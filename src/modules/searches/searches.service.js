import { CandidateSummary, Evaluation, Message, Search } from '../../db/models/index.js';
import { emptyCriteria } from '../../engine/interpreter.js';
import { notFound } from '../../lib/errors.js';
import { getOwnedProject, touchProject } from '../projects/projects.service.js';

/** Single indexed query: the search must exist AND belong to the caller's org. */
export async function getOwnedSearch(auth, searchId) {
  const search = await Search.findOne({ _id: searchId, orgId: auth.orgId });
  if (!search) throw notFound('Search');
  return search;
}

export async function createSearch(auth, projectId, title) {
  const project = await getOwnedProject(auth, projectId);
  const count = await Search.countDocuments({ projectId: project._id });
  const search = await Search.create({
    orgId: auth.orgId,
    projectId: project._id,
    title: title ?? `Search ${count + 1}`,
    criteria: emptyCriteria(),
  });
  await touchProject(project._id);
  return search.toJSON();
}

export async function getSearchDetail(auth, searchId) {
  const search = await getOwnedSearch(auth, searchId);
  const messages = await Message.find({ searchId: search._id }).sort({ createdAt: 1, _id: 1 });
  return { ...search.toJSON(), messages: messages.map((message) => message.toJSON()) };
}

export async function updateSearch(auth, searchId, { title, criteria }) {
  const search = await getOwnedSearch(auth, searchId);
  if (title !== undefined) search.title = title;
  if (criteria !== undefined) search.criteria = criteria;
  await search.save();
  await touchProject(search.projectId);
  return search.toJSON();
}

export async function saveCriteria(search, criteria) {
  search.criteria = criteria;
  await search.save();
  await touchProject(search.projectId);
}

export async function deleteSearch(auth, searchId) {
  const search = await getOwnedSearch(auth, searchId);
  await Promise.all([
    Message.deleteMany({ searchId: search._id }),
    Evaluation.deleteMany({ searchId: search._id }),
    CandidateSummary.deleteMany({ searchId: search._id }),
  ]);
  await search.deleteOne();
}
