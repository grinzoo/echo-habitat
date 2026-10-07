import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import type { HabitatStore, Snapshot } from "./storage-types";

const path = "echo-habitat/world.json";

const options = {
  access: "private" as const,
  addRandomSuffix: false,
  contentType: "application/json",
};

function blobAuth(requestOidcToken?: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { token };

  const storeId = process.env.BLOB_STORE_ID?.trim();
  const oidcToken =
    requestOidcToken?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim();

  if (oidcToken && storeId) return { oidcToken, storeId };

  throw new Error(
    `Vercel Blob credentials unavailable (storeId=${Boolean(storeId)}, oidc=${Boolean(oidcToken)}, readWriteToken=${Boolean(token)}).`,
  );
}

export const habitatStore: HabitatStore = {
  async read(oidcToken) {
    const auth = blobAuth(oidcToken);
    const result = await get(path, {
      ...auth,
      access: "private",
      useCache: false,
      headers: {
        "Accept-Encoding": "identity",
      },
    });

    if (!result) return null;

    if (result.statusCode !== 200 || !result.stream) {
      throw new Error("Habitat storage returned an incomplete response.");
    }

    const saved = JSON.parse(await new Response(result.stream).text());

    if (
      !Number.isSafeInteger(saved?.revision) ||
      saved.revision < 0 ||
      !saved.world
    ) {
      throw new Error("Invalid habitat save.");
    }

    return {
      world: saved.world,
      revision: saved.revision,
      etag: result.blob.etag,
    } satisfies Snapshot;
  },

  async initialize(world, oidcToken) {
    try {
      const auth = blobAuth(oidcToken);
      const blob = await put(
        path,
        JSON.stringify({ world, revision: 0 }),
        {
          ...options,
          ...auth,
        },
      );

      return { world, revision: 0, etag: blob.etag };
    } catch (error) {
      const winner = await habitatStore.read(oidcToken);
      if (winner) return winner;
      throw error;
    }
  },

  async compareAndSwap(before, world, oidcToken): Promise<Snapshot | null> {
    const revision = before.revision + 1;

    try {
      const auth = blobAuth(oidcToken);
      const blob = await put(
        path,
        JSON.stringify({ world, revision }),
        {
          ...options,
          ...auth,
          allowOverwrite: true,
          ifMatch: before.etag,
        },
      );

      return { world, revision, etag: blob.etag };
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        console.error("HABITAT_WRITE_CONFLICT", {
          revision: before.revision,
          savedVersion: before.world.version,
          etagPresent:
            typeof before.etag === "string" &&
            before.etag.length > 0,
          etagWeak:
            typeof before.etag === "string" &&
            before.etag.startsWith("W/"),
        });

        return null;
      }

      throw error;
    }
  },
};
