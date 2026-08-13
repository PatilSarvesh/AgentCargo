# ADR 0001: Canonical AgentCargo Artifact Format

- Status: Accepted
- Date: 2026-08-12
- Decision owners: AgentCargo maintainers

## Context

AgentCargo releases must be immutable, portable across supported operating systems, safe to inspect and extract, and independently verifiable with SHA-256. The same skill contents must produce the same artifact bytes regardless of source timestamps, file ownership, local permission defaults, or directory enumeration order.

Using a platform `tar` process would inherit implementation-specific headers and flags. Compressing the archive would add another source of version-dependent output. A custom binary container would require new ecosystem tooling without improving the MVP's core security properties.

## Decision

Artifact format version 1 is named `agentcargo-ustar-v1` and uses an uncompressed POSIX USTAR byte stream stored with the `.agentcargo` extension.

The SHA-256 digest covers every byte of the stored artifact, including TAR headers, padding, and the final end markers. Digests are rendered as:

```text
sha256:<64 lowercase hexadecimal characters>
```

### Canonical entry rules

- Artifacts contain regular-file entries only. Directories are implied by file paths.
- Paths are relative to the skill root and use `/` separators.
- Paths use Unicode NFC normalization.
- Absolute paths, drive prefixes, UNC paths, empty segments, `.`, `..`, links, devices, sockets, FIFOs, and cross-platform-unsafe names are rejected.
- Case-insensitive path collisions are rejected.
- Entries are sorted by unsigned UTF-8 path bytes.
- `name` and `prefix` use the standard USTAR 100-byte and 155-byte fields. No PAX or GNU extension headers are allowed.
- File content is copied byte-for-byte.
- Files below `scripts/` use mode `0755`; all other files use mode `0644`.
- UID, GID, modification time, user name, group name, device major, and device minor are zero or empty.
- The USTAR magic is `ustar\0` and version is `00`.
- Each data section is padded with zero bytes to a 512-byte boundary.
- Exactly two zero blocks terminate the artifact. Trailing data is rejected.

### Resource limits

The initial format implementation enforces:

- At most 500 files.
- At most 5 MiB per file.
- At most 10 MiB expanded file content.
- At most 12 MiB total artifact bytes during extraction.

These are implementation policy limits, not permanent wire-format limits. Raising them does not require a new artifact format if canonical encoding is unchanged.

### Packing behavior

- A skill must pass native and AgentCargo validation.
- `agentcargo.yaml` is mandatory for packing.
- The output must be outside the skill root and must not already exist.
- The artifact is written to a same-directory temporary file, flushed, and published without overwriting an existing path.
- Source files are rechecked while read so a detected concurrent mutation aborts packing.

### Extraction behavior

- Optional expected digest verification occurs before any destination mutation.
- Extraction requires a missing or empty real directory.
- Every header is checksum-verified and compared with its canonical reconstruction.
- Limits are enforced while streaming, before each file grows beyond policy.
- Every resolved output must remain beneath the explicit extraction root.
- Extraction uses exclusive file creation and cleans files created by a failed attempt.

## Consequences

Benefits:

- Exact-byte reproducibility is straightforward to test.
- Artifact digests are independent of compression-library versions.
- Standard TAR readers can inspect valid artifacts even though AgentCargo applies stricter rules.
- The parser has a deliberately small supported surface: canonical regular files only.

Tradeoffs:

- Artifacts are larger than compressed archives.
- Sparse files, long PAX paths, links, and arbitrary Unix modes are unsupported.
- Script executability is derived from its `scripts/` location instead of preserving local mode bits.
- A future compressed transport must wrap or negotiate this canonical representation without changing what the release digest means.
