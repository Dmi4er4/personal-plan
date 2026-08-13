# Security policy

Please report suspected vulnerabilities privately through GitHub's
**Security → Report a vulnerability** flow. Do not open a public issue with a
recovery phrase, auth token, vault identifier, ciphertext, request body, or
deployment address.

## Deployment notes

- Put the relay behind TLS before making it reachable from another machine.
- Keep recovery phrases offline and never pass a real phrase through logs,
  issue trackers, shell history, or CI variables.
- Back up encrypted relay state before migrations and retain a tested rollback
  path.
- Rotate to a new vault if a recovery phrase or paired-device QR payload is
  exposed.
- Treat every release as unaudited software until you have reviewed the code
  and threat model for your environment.

The relay cannot decrypt plan contents, but it can observe transport and usage
metadata. Compromise of a configured client or recovery phrase exposes the
entire plan.

## Known toolchain advisory

As of 2026-08-13, `pnpm audit --prod` reports
`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` in `image-size`, pulled in by
Metro through Expo. Upstream has no patched release. This package is used by
the local Android bundler and is not included in the relay or application
runtime. Until upstream provides a fix, run Expo/Metro only in a trusted
checkout and do not add untrusted ICNS, JXL, or HEIF assets to the project.
