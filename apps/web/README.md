# AgentCargo public catalog

The public AgentCargo catalog is a server-rendered Vinext site for discovering
portable agent skills, reviewing trust evidence, and copying an install
command. It uses the existing versioned registry API when
`NEXT_PUBLIC_AGENTCARGO_REGISTRY_URL` is configured and falls back to a small
local catalog for preview and development.

The `Publish a skill` action opens the local instruction-only builder at
`/publish`. It generates reviewable `SKILL.md` and `agentcargo.yaml` drafts and
a copyable `agentcargo publish` command; it never uploads files or installs
them from the browser. Registry authentication and publication remain explicit
CLI operations.

The optional publisher workspace at `/publisher` uses the same workspace
identity headers for an anonymous-safe sign-in gate and a read-only local
package summary. It does not upload files, mutate registry data, or treat
identity headers alone as namespace authorization; publication remains an
explicit `agentcargo publish` CLI operation.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

The site uses the Sites/Vinext Cloudflare-compatible build and does not use
`wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Local Registry Session Boundary

`/api/registry-session` is a server-only, fail-closed boundary for the future
AgentCargo session exchange. `GET` returns only anonymous or identity-only
status, sanitized opaque-session state, and the planned `publisher:read` scope.
`POST` rejects browser-supplied credentials and returns `501` until the hosting
layer provides a request-scoped provider credential resolver. `DELETE` clears
the opaque session cookie without requiring provider credentials. The bridge
contract in `app/registry-session.ts` validates the read-only exchange, and an
optional server-side session resolver validates cookie state without returning
the token to the browser. Workspace identity headers are never treated as
GitHub credentials, and the local configuration intentionally leaves the bridge
unset.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the catalog and verify its rendered HTML
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
