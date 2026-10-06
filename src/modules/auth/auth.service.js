import { User } from '../../db/models/index.js';
import { unauthorized, notFound } from '../../lib/errors.js';
import { verifyPassword } from '../../lib/password.js';
import { signAccessToken } from '../../middleware/auth.js';

// Precomputed hash so a login for an unknown email costs the same time as a real one.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

export async function login(email, password) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && Boolean(user);
  // Same message for "no such user" and "wrong password": don't leak which emails exist.
  if (!ok) throw unauthorized('Invalid email or password');
  return { token: signAccessToken(user), user: toUserDto(user) };
}

export async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');
  return toUserDto(user);
}

export function toUserDto(user) {
  return {
    id: String(user._id),
    orgId: String(user.orgId),
    email: user.email,
    fullName: user.fullName,
    credits: { total: user.credits.total, used: user.credits.used, remaining: user.credits.total - user.credits.used },
  };
}
