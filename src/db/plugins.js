/**
 * Shared schema options: expose `id` instead of `_id`, hide `__v`, and keep
 * createdAt/updatedAt. Every model's JSON output then has the same shape.
 */
export const baseSchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
};

/** Same id mapping for `.lean()` results, which skip toJSON transforms. */
export function leanToDto(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest };
}
