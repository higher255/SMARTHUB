import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

/**
 * Create a company and its first administrator directly in the database.
 * Used to set up a production installation (no self sign-up exists) and by tests.
 * `query(text, params)` must return `{ rows }` (node-postgres or PGlite).
 */
export async function bootstrapTenant(query, { company, slug, email, name, password, platformAdmin = false, currency = "TZS" }) {
  if (!company || !slug || !email || !name) throw new Error("company, slug, email and name are required");
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new Error("slug must be lowercase letters, numbers and dashes");
  if (!password || password.length < 10) throw new Error("password must be at least 10 characters");
  const mail = email.trim().toLowerCase();

  const taken = await query('select 1 from "user" where lower(email) = $1', [mail]);
  if (taken.rows.length) throw new Error(`a user with ${mail} already exists`);
  const slugTaken = await query("select 1 from organizations where slug = $1", [slug]);
  if (slugTaken.rows.length) throw new Error(`company code ${slug} is already used`);

  const org = await query("insert into organizations (name, slug, currency) values ($1,$2,$3) returning id", [company, slug, currency]);
  const orgId = org.rows[0].id;
  await query("select acct_seed_chart($1)", [orgId]);

  const userId = randomUUID().replace(/-/g, "");
  await query('insert into "user" (id, name, email, "emailVerified") values ($1,$2,$3,true)', [userId, name, mail]);
  await query(
    'insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1,$2,\'credential\',$3,$4, now(), now())',
    [randomUUID().replace(/-/g, ""), userId, userId, await hashPassword(password)],
  );
  await query(
    "insert into profiles (user_id, full_name, role, department, organization_id, is_platform_admin) values ($1,$2,'Admin','Management',$3,$4)",
    [userId, name, orgId, platformAdmin],
  );
  return { organizationId: orgId, userId };
}
