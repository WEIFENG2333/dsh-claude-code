# Project instructions

- Keep the captured Claude Code request surface in `src/generated/` machine-generated; update it only with `pnpm baseline:extract` from a Claude Tap trace.
- Never commit API keys, authorization headers, session identifiers, machine fingerprints, raw traces, or `.local/` artifacts.
- Keep Claude-facing tool schemas byte-stable unless a new Claude Tap baseline proves drift.
- Implement tools through DSH capability seams or nested DSH tool dispatch when an equivalent capability exists.
- Every behavior change needs a focused test and must keep `pnpm verify` passing.
- Commit built `lib/` output because DSH supports installing this bundle directly from GitHub.
