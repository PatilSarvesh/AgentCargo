# AgentCargo CLI release procedure

This procedure produces a reproducible, signed build bundle for the CLI and its first-party runtime packages. It does not publish a skill, execute package files, or install anything on a user's machine.

## Release inputs and outputs

The release job requires a protected Ed25519 private key. Keep it in the CI secret `AGENTCARGO_CLI_RELEASE_PRIVATE_KEY`; never commit it, put it in a lockfile, or pass its contents as a command argument. The matching public key must be distributed through a maintainer-controlled release channel and its fingerprint recorded in the release notes.

`pnpm release:cli` builds the workspace and writes these files to the requested output directory:

- `agentcargo-cli-<version>.tar`: uncompressed deterministic USTAR bundle (`agentcargo-cli-ustar-v1`);
- `agentcargo-cli-<version>.manifest.json`: canonical source-commit, package-set, file-inventory, and archive-digest metadata;
- `agentcargo-cli-<version>.tar.sha256`: archive checksum;
- `agentcargo-cli-<version>.manifest.json.sig.json`: detached Ed25519 signature over the canonical manifest.

The bundle contains the built CLI, the first-party packages it imports, their package manifests, `pnpm-lock.yaml`, `README.md`, and `LICENSE`. It excludes private keys, environment files, package caches, and generated timestamps. The archive digest covers every USTAR header, file byte, padding block, and end marker.

## Local dry run

Generate a temporary test key outside the repository, then build and verify a bundle:

```bash
key_dir="$(mktemp -d)"
openssl genpkey -algorithm Ed25519 -out "$key_dir/cli-release-key.pem"
openssl pkey -in "$key_dir/cli-release-key.pem" -pubout -out "$key_dir/cli-release-public.pem"

pnpm release:cli -- \
  --private-key "$key_dir/cli-release-key.pem" \
  --out-dir "$key_dir/bundle" \
  --source-commit "$(git rev-parse HEAD)"

manifest=$(find "$key_dir/bundle" -name '*.manifest.json' -print -quit)
node scripts/release-cli.mjs verify \
  --archive "${manifest%.manifest.json}.tar" \
  --manifest "$manifest" \
  --signature "$manifest.sig.json" \
  --public-key "$key_dir/cli-release-public.pem"
```

The build command refuses to overwrite an existing output file. Build the same commit twice into separate directories and compare the `.tar`, manifest, checksum, and signature bytes to confirm reproducibility. The release test performs this comparison automatically.

## CI release

`.github/workflows/cli-release.yml` runs for `cli-v*` tags or a manual dispatch. Before enabling it for a public release, configure the protected `AGENTCARGO_CLI_RELEASE_PRIVATE_KEY` secret, restrict tag creation to maintainers, and publish the generated public key and its fingerprint alongside the workflow artifact. The workflow fails closed when the secret is absent, exports the public key only to the workflow artifact, verifies the signature before upload, and removes the ephemeral private-key file in an always-run cleanup step.

## Verification and update channels

Consumers should verify the public-key fingerprint through a trusted AgentCargo release note, verify the detached manifest signature, and verify the archive digest before extracting or running the CLI. Update and rollback behavior for installed skills remains governed by `agentcargo update` and `agentcargo rollback`; a CLI release bundle never mutates an existing skill installation. Package-registry publication, installer UX, key rotation, and hardware-backed custody remain follow-up public-beta operations.
