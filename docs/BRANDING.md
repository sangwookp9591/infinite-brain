# Branding and identity

The product brand is **Infinite Brain**: bundle identifier `com.infinitebrain.desktop`, deep-link schemes `infinitebrain`, `infinitebrain-staging` and `infinitebrain-dev`.

The updater signing private key belongs outside the repository at `~/.infinite-brain/updater.key`; only its public key belongs in the Tauri config. The generated key currently has no passphrase, so protect the file with restrictive permissions and never commit it.

## Preserved internal identity

The `.context/` metadata directory and database name `context` remain unchanged for data compatibility. `Context` also remains the internal code name. Their future names are undecided; revisit them only after the product owner makes that decision and defines any required migration.
