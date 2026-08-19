import { getChatGPTUser } from "../../chatgpt-auth";
import {
  describeBrowserRegistrySession,
  inspectBrowserReadSession,
  REGISTRY_SESSION_COOKIE_NAME,
  issueBrowserReadSession,
  serializeBrowserRegistrySessionCookie,
  toBrowserRegistrySessionStatus,
} from "../../registry-session";
import { registrySessionBridge } from "../../registry-session-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getChatGPTUser();
  const inspection = await inspectBrowserReadSession(request, registrySessionBridge);
  return json(toBrowserRegistrySessionStatus(describeBrowserRegistrySession(user), inspection));
}

export async function DELETE(): Promise<Response> {
  return json({ apiVersion: "local", state: "signed-out", registrySession: "absent", writesAvailable: false }, 200, {
    "set-cookie": `${REGISTRY_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  });
}

/**
 * Keep the browser boundary explicit until the hosting layer can provide a
 * request-scoped provider credential. Workspace identity headers are not a
 * GitHub credential and must never be exchanged or accepted from the client.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) {
    return error(401, "REGISTRY_AUTH_REQUIRED", "Sign in before requesting registry access.");
  }

  const contentLength = request.headers.get("content-length");
  const contentType = request.headers.get("content-type");
  if ((contentLength !== null && contentLength !== "0") || contentType !== null) {
    return error(400, "REGISTRY_REQUEST_INVALID", "The local session boundary does not accept browser credentials or request bodies.");
  }

  const result = await issueBrowserReadSession(request, user, registrySessionBridge);
  if (result.state === "unconfigured") {
    return error(501, "REGISTRY_AUTH_NOT_CONFIGURED", "A provider credential resolver is not configured for this local preview.");
  }
  if (result.state === "missing-provider-credential") {
    return error(401, "REGISTRY_AUTH_REQUIRED", "A server-side provider credential is required for registry access.");
  }
  if (result.state === "exchange-failed") {
    return error(503, "REGISTRY_AUTH_UNAVAILABLE", "The registry session exchange is unavailable.");
  }

  return json({
    apiVersion: "local",
    state: "registry-session",
    scopes: result.session.scopes,
    expiresAt: result.session.expiresAt,
    writesAvailable: false,
  }, 201, {
    "set-cookie": serializeBrowserRegistrySessionCookie(result.session, {
      secure: process.env.NODE_ENV === "production",
    }),
  });
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ apiVersion: "local", error: { code, message } }, status);
}
