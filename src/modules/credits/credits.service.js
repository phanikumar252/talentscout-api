import { CreditLedger, User } from '../../db/models/index.js';
import { insufficientCredits, notFound } from '../../lib/errors.js';

export async function getBalance(userId) {
  const user = await User.findById(userId, { credits: 1 }).lean();
  if (!user) throw notFound('User');
  const { total, used } = user.credits;
  return { total, used, remaining: total - used };
}

/**
 * Charges `amount` credits once per (user, reason, reference). Calling it again
 * for the same item is free, which makes retries and double-clicks safe.
 *
 * Works on a standalone mongod (no multi-document transaction):
 *   1. insert the ledger row; the unique index rejects duplicates, so the item was already paid for
 *   2. atomically increment `used` only if it stays within `total`
 *   3. if that fails, delete the ledger row (compensating action) and throw 402
 *
 * @returns {Promise<{ charged: boolean, balance: { total: number, used: number, remaining: number } }>}
 */
export async function chargeOnce(userId, { reason, reference, amount = 1 }) {
  let entry;
  try {
    entry = await CreditLedger.create({ userId, reason, reference, amount });
  } catch (error) {
    if (error?.code === 11000) return { charged: false, balance: await getBalance(userId) };
    throw error;
  }

  const user = await User.findOneAndUpdate(
    { _id: userId, $expr: { $lte: [{ $add: ['$credits.used', amount] }, '$credits.total'] } },
    { $inc: { 'credits.used': amount } },
    { new: true, projection: { credits: 1 } },
  ).lean();

  if (!user) {
    await CreditLedger.deleteOne({ _id: entry._id });
    throw insufficientCredits(`This action needs ${amount} credit${amount === 1 ? '' : 's'}`);
  }

  const { total, used } = user.credits;
  return { charged: true, balance: { total, used, remaining: total - used } };
}
