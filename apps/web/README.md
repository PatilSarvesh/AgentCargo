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

The optional publisher workspace at `/publisher` uses workspace identity
headers for an anonymous-safe sign-in gate, then requires an exact
`publisher:read` AgentCargo session to load the namespaces, packages, and
immutable release histories owned by that session's publisher identity. Its
publication intent action accepts only a skill name/version, derives the owned
namespace on the server, and reserves an idempotent release through a one-shot
`publisher:write` session. It never accepts a namespace selector, package
files, or credentials; upload, scanning, activation, and completion remain an
explicit `agentcargo publish` CLI/registry operation.

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

### Local port selection

The default local port is `3000`. If another local project such as Bridge needs
that port, set an AgentCargo-only override before starting the dev or preview
server:

```bash
AGENTCARGO_WEB_PORT=3001 npm run dev
AGENTCARGO_WEB_PORT=3001 npm run build && npm run start
```

An explicit Vinext flag still wins over the environment override:

```bash
npm run dev -- --port 3001
npm run start -- --port 3001
```

The wrapper validates `AGENTCARGO_WEB_PORT` and accepts ports `1` through
`65535`; it never changes Bridge's port or writes a shared project setting.

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

`/api/registry-session` is a server-only, fail-closed boundary for AgentCargo
session exchange. `GET` returns only anonymous or identity-only status,
sanitized opaque-session state, and the selected `publisher:read` scope. `POST`
rejects browser-supplied credentials and returns `501` until the three
server-only settings below are present. `DELETE` clears the opaque session
cookie without requiring provider credentials.

```text
AGENTCARGO_REGISTRY_URL=https://registry.example.com
AGENTCARGO_WEB_PROVIDER_BROKER_URL=https://host.example.com/internal/github-credential
AGENTCARGO_WEB_PROVIDER_BROKER_TOKEN=<server-only service credential>
```

The broker is a host-owned, authenticated server-to-server endpoint. It accepts
`{"provider":"github","workspaceUserId":"..."}` and returns
`{"provider":"github","accessToken":"..."}` only to the web server. The
web server requests exactly `publisher:read`, stores only the resulting opaque
AgentCargo token in an HttpOnly cookie, and validates it through the registry's
token-free `GET /v1/auth/session` endpoint. The server uses that opaque cookie
to call `GET /v1/publisher/workspace`; the registry derives ownership only from
the resolved session identity and returns no records for browser-selected
namespaces. Browser headers, cookies, request bodies, provider tokens, registry
tokens, and publisher identity are not forwarded or returned in browser JSON.
HTTPS is required except for loopback development URLs; incomplete or unsafe
configuration leaves the bridge unset.

The `/api/publisher-publication` route is a separate server-only handoff. It
accepts only bounded `name`, `version`, and `idempotencyKey` fields, derives a
unique namespace from the owner-scoped workspace, requests exactly
`publisher:write` from the trusted broker, and uses that token only to reserve
the release. Responses are `no-store` and token-free. Browser package-file
upload and activation are intentionally not part of this route. Explicit
cross-origin `Origin`/Fetch Metadata mutation requests are rejected before
authentication or body parsing.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the catalog and verify its rendered HTML
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
