import { ShortlistEntry } from '../../db/models/index.js';
import { badRequest } from '../../lib/errors.js';
import { toCsv } from '../../lib/csv.js';
import { findCandidatesByIds } from '../candidates/candidates.repository.js';
import { getOwnedProject, touchProject } from '../projects/projects.service.js';
import { getOwnedSearch } from '../searches/searches.service.js';

export async function listShortlist(auth, projectId) {
  const project = await getOwnedProject(auth, projectId);
  const entries = await ShortlistEntry.find({ projectId: project._id }).sort({ createdAt: -1 }).lean();
  const candidates = await findCandidatesByIds(entries.map((entry) => entry.candidateId));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return entries
    .filter((entry) => byId.has(String(entry.candidateId)))
    .map((entry) => ({
      candidate: byId.get(String(entry.candidateId)),
      searchId: entry.searchId ? String(entry.searchId) : null,
      addedAt: entry.createdAt,
    }));
}

/** Bulk add; already-shortlisted candidates are skipped, not errors (idempotent). */
export async function addToShortlist(auth, projectId, { candidateIds, searchId }) {
  const project = await getOwnedProject(auth, projectId);
  if (searchId) {
    const search = await getOwnedSearch(auth, searchId);
    if (!search.projectId.equals(project._id)) throw badRequest('Search does not belong to this project');
  }
  const found = await findCandidatesByIds(candidateIds);
  if (found.length !== new Set(candidateIds).size) throw badRequest('One or more candidates do not exist');

  const result = await ShortlistEntry.bulkWrite(
    candidateIds.map((candidateId) => ({
      updateOne: {
        filter: { projectId: project._id, candidateId },
        update: { $setOnInsert: { orgId: auth.orgId, projectId: project._id, candidateId, searchId: searchId ?? null, addedBy: auth.userId } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  await touchProject(project._id);
  return { added: result.upsertedCount, alreadyShortlisted: candidateIds.length - result.upsertedCount };
}

export async function removeFromShortlist(auth, projectId, candidateId) {
  const project = await getOwnedProject(auth, projectId);
  const { deletedCount } = await ShortlistEntry.deleteOne({ projectId: project._id, candidateId });
  return { removed: deletedCount === 1 };
}

export async function exportShortlistCsv(auth, projectId) {
  const project = await getOwnedProject(auth, projectId);
  const rows = await listShortlist(auth, projectId);
  const csv = toCsv(
    [
      { label: 'Name', value: (row) => row.candidate.fullName },
      { label: 'Title', value: (row) => row.candidate.title },
      { label: 'Seniority', value: (row) => row.candidate.seniority },
      { label: 'Company', value: (row) => row.candidate.company },
      { label: 'Location', value: (row) => `${row.candidate.city}, ${row.candidate.country}` },
      { label: 'Years', value: (row) => row.candidate.yearsExperience },
      { label: 'Skills', value: (row) => row.candidate.skills.join('; ') },
      { label: 'Open to work', value: (row) => (row.candidate.openToWork ? 'yes' : 'no') },
      { label: 'Added', value: (row) => new Date(row.addedAt).toISOString() },
    ],
    rows,
  );
  const fileName = `${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'project'}-shortlist.csv`;
  return { csv, fileName };
}
