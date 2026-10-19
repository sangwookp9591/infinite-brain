// SPDX-License-Identifier: Apache-2.0
import { pool, resetDb } from "./db.js";
import { signUp, createOrg } from "./auth.js";
import { seedMember, seedVault, seedFolder, seedNote, seedShare, seedVaultGrant } from "./seed.js";
/** Shared D6 fixture: only Clients/Acme/Shared is explicitly shared with G. */
export async function guestFixture() {
  await resetDb();
  const owner = await signUp("owner@guest.test");
  const member = await signUp("member@guest.test");
  const guest = await signUp("guest@guest.test");
  const external = await signUp("external@guest.test");
  const org = (await createOrg(owner, "Guest vault", "guest-vault")).id;
  await pool.query("INSERT INTO organization_access_settings (organization_id,join_default) VALUES ($1,'open') ON CONFLICT (organization_id) DO UPDATE SET join_default='open'", [org]);
  await seedMember(org, member.userId, "member"); await seedMember(org, guest.userId, "guest");
  const vault = await seedVault(org); await seedVaultGrant(org, "edit");
  const clients = await seedFolder(vault, null, "Clients", "Clients", member.userId);
  const acme = await seedFolder(vault, clients, "Acme", "Clients/Acme", member.userId);
  const shared = await seedFolder(vault, acme, "Shared", "Clients/Acme/Shared", member.userId);
  const beta = await seedFolder(vault, clients, "Beta", "Clients/Beta", member.userId);
  const visible = await seedNote(vault, shared, "Clients/Acme/Shared/visible.md", member.userId);
  const hidden = await seedNote(vault, beta, "Clients/Beta/b.md", member.userId);
  const ownOutside = await seedNote(vault, beta, "Clients/Beta/guest.md", guest.userId);
  const root = await seedNote(vault, null, "root.md", owner.userId);
  await seedShare(org, "folder", shared, guest.userId, "edit");
  return { owner, member, guest, external, org, vault, clients, acme, shared, beta, visible, hidden, ownOutside, root };
}
