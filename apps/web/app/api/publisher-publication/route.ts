import { getChatGPTUser } from "../../chatgpt-auth";
import { handlePublisherPublicationIntent } from "../../publisher-publication";
import { isSameOriginMutation } from "../../mutation-security";
import {
  registryPublisherReservationResolver,
  registryPublisherWorkspaceResolver,
  registryPublisherWriteSessionExchange,
  registrySessionBridge,
} from "../../registry-session-config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ apiVersion: "local", error: { code: "REGISTRY_CSRF_REJECTED", message: "The publication request must originate from this site." } }, 403);
  }
  const result = await handlePublisherPublicationIntent(request, await getChatGPTUser(), {
    readBridge: registrySessionBridge,
    resolveWorkspace: registryPublisherWorkspaceResolver,
    writeSessionExchange: registryPublisherWriteSessionExchange,
    reserve: registryPublisherReservationResolver,
  });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
