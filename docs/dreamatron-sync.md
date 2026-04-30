# Dreamatron Build Sync

This repo syncs Sky Warden: Kaiju Break into Dreamatron through GitHub Actions.

## How It Works

On every push to `main`, `.github/workflows/sync-dreamatron-build.yml`:

1. Installs dependencies with `npm ci`.
2. Builds the game with `npm run build`.
3. Runs `npm test`.
4. Verifies the Vite output uses relative `./assets/...` paths.
5. Copies `dist/demo` into `Dreamatron/dreamatron_site` at `frontend/public/game-builds/sky-warden-kaiju-break`.
6. Opens or updates a Dreamatron PR from `game-sync/sky-warden-kaiju-break` into `main`.

Merging that Dreamatron PR triggers the normal Vercel deployment for the website.

## Required Secret

Add this repository secret in `kvick-games/SupermanKaiju`:

`DREAMATRON_SITE_PUSH_TOKEN`

Use a GitHub fine-grained personal access token with access to `Dreamatron/dreamatron_site` and these permissions:

- Contents: Read and write
- Pull requests: Read and write
- Metadata: Read

The workflow intentionally opens a PR instead of pushing directly to Dreamatron `main`, so the website does not auto-deploy a broken game build without review.

## Manual Run

After the secret is configured, use GitHub Actions -> Sync Dreamatron game build -> Run workflow to force a sync without another code change.
