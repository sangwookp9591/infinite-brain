# Branding and identity

The provisional product brand is **Infinite Brain**. User-facing product name, bundle identifier, deep-link schemes, updater URLs, and self-hosted server default are centralized in [`scripts/rebrand.mjs`](../scripts/rebrand.mjs). Run it with `node scripts/rebrand.mjs --dry-run` to review changes before applying it. Re-running it is safe.

The updater signing private key belongs outside the repository at `~/.infinite-brain/updater.key`; only its public key belongs in the Tauri config. The generated key currently has no passphrase, so protect the file with restrictive permissions and never commit it.

## Preserved internal identity

The `.context/` metadata directory and database name `context` remain unchanged for data compatibility. `Context` also remains the internal code name. Their future names are undecided; revisit them only after the product owner makes that decision and defines any required migration.

The rebrand script intentionally skips `.git`, dependencies, build output, `.context/`, imported vendor dashboard templates, changelog history, upstream architecture notes, research records, and license/attribution notices. Those files either contain user data, generated content, third-party material, or historical evidence.
