import { z } from "zod";
import { readHabitat, updateHabitat } from "@/db/habitat";
import { accessOptions, isOwner, sameOrigin } from "@/lib/habitat/access";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step") }).strict(),
  z.object({ type: z.literal("event"), event: z.enum(["rain", "relic", "blackout"]) }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
  z.object({ type: z.literal("playback"), running: z.boolean(), speed: z.union([z.literal(1), z.literal(2), z.literal(4)]) }).strict(),
]);
const requestSchema = z.object({ actionRevision: z.number().int().nonnegative().safe(), action: actionSchema }).strict();
const headers = { "Cache-Control": "no-store", Vary: "Cookie" };

function oidcToken(request: Request) {
  return request.headers.get("x-vercel-oidc-token")?.trim() || undefined;
}

export async function GET(request: Request) {
  try {
    const token = oidcToken(request);
    const result = await readHabitat(Date.now(), undefined, token);
    const mode = await isOwner(request) ? "owner" : "visitor";
    return Response.json({ ...result, mode, access: accessOptions() }, { headers });
  } catch (error) {
    console.error("Habitat read failed", error, {
      hasOidcHeader: Boolean(oidcToken(request)),
      hasStoreId: Boolean(process.env.BLOB_STORE_ID),
      hasReadWriteToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });
    return Response.json({ error: "The habitat could not be loaded. Please try again." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "This action must come from the habitat." }, { status: 403, headers });
  }
  if (!await isOwner(request)) return Response.json({ error: "Only the signed-in owner can change the habitat." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected a JSON action." }, { status: 415, headers });
  }
  const body = await request.text();
  if (body.length > 2048) return Response.json({ error: "Action is too large." }, { status: 413, headers });
  let parsed;
  try { parsed = requestSchema.safeParse(JSON.parse(body)); }
  catch { return Response.json({ error: "Invalid action." }, { status: 400, headers }); }
  if (!parsed.success) return Response.json({ error: "Invalid action." }, { status: 400, headers });
  try {
    const result = await updateHabitat(parsed.data.action, parsed.data.actionRevision, Date.now(), oidcToken(request));
    return Response.json({ ...result, mode: "owner", access: accessOptions() }, { status: result.conflict ? 409 : 200, headers });
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Wait for") || error.message.startsWith("The habitat is catching up"))) {
      return Response.json({ error: error.message }, { status: 422, headers });
    }
    console.error("Habitat save failed", error, {
      hasOidcHeader: Boolean(oidcToken(request)),
      hasStoreId: Boolean(process.env.BLOB_STORE_ID),
      hasReadWriteToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });
    return Response.json({ error: "Your change could not be confirmed. Reconnect to see the saved state before trying again." }, { status: 503, headers });
  }
}
