# Branding and identity

The product brand is **Infinite Brain**: bundle identifier `com.infinitebrain.desktop`, deep-link schemes `infinitebrain`, `infinitebrain-staging` and `infinitebrain-dev`.

The updater signing private key belongs outside the repository at `~/.infinite-brain/updater.key`; only its public key belongs in the Tauri config. The key is password-protected; the password lives next to it in `~/.infinite-brain/updater.key.password` (mode 600). Both are also stored as the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. Never commit either.

## Preserved internal identity

The `.context/` metadata directory and database name `context` remain unchanged for data compatibility. `Context` also remains the internal code name. Their future names are undecided; revisit them only after the product owner makes that decision and defines any required migration.
