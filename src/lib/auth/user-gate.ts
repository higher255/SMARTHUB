/**
 * Self-registration is closed: accounts are created by an administrator or by the platform owner.
 * The sign-up endpoint stays reachable (Better Auth mounts it), so user creation is gated here:
 *  - allowed for the configured first-administrator email while the installation is empty, or
 *  - allowed for an email that server code has explicitly opted in via allowNewUser().
 */
const allowed = new Set<string>();
const INITIAL_ADMIN_EMAIL = "drhigh255@outlook.com";

export function isInitialAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === INITIAL_ADMIN_EMAIL;
}

export function allowNewUser(email: string): void {
  allowed.add(email.trim().toLowerCase());
}
export function releaseNewUser(email: string): void {
  allowed.delete(email.trim().toLowerCase());
}
export function isNewUserAllowed(email: string): boolean {
  return allowed.has(email.trim().toLowerCase());
}
