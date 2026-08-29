import { createFileRoute } from "@tanstack/react-router";

type Body = {
  input: string; // Roblox catalog URL or bare asset ID
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function extractAssetId(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Bare numeric ID
  if (/^\d{3,}$/.test(trimmed)) return Number(trimmed);
  // roblox.com/catalog/{id}/... or roblox.com/bundles etc.
  const m = trimmed.match(/roblox\.com\/(?:catalog|library)\/(\d{3,})/i);
  if (m) return Number(m[1]);
  // Last resort: first long digit run in the string
  const any = trimmed.match(/(\d{6,})/);
  if (any) return Number(any[1]);
  return null;
}

async function toDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const mime = res.headers.get("content-type") ?? "image/png";
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return undefined;
  }
}

export const Route = createFileRoute("/api/catalog-item")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const assetId = extractAssetId(body?.input ?? "");
        if (!assetId) {
          return Response.json(
            { error: "Não consegui extrair um ID de item dessa URL." },
            { status: 200 },
          );
        }

        // Asset details (name + creator).
        let name = `Item ${assetId}`;
        let creator: string | undefined;
        try {
          const dRes = await fetch(
            `https://economy.roblox.com/v2/assets/${assetId}/details`,
            { headers: { "User-Agent": UA, Accept: "application/json" } },
          );
          if (dRes.ok) {
            const d = (await dRes.json()) as {
              Name?: string;
              Creator?: { Name?: string };
            };
            if (d.Name) name = d.Name;
            creator = d.Creator?.Name;
          }
        } catch {
          /* details are best-effort */
        }

        // Rendered clothing thumbnail.
        let thumbnail: string | undefined;
        try {
          const tRes = await fetch(
            `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`,
            { headers: { "User-Agent": UA, Accept: "application/json" } },
          );
          if (tRes.ok) {
            const t = (await tRes.json()) as {
              data?: Array<{ state: string; imageUrl?: string }>;
            };
            const row = t.data?.[0];
            if (row?.state === "Completed" && row.imageUrl) {
              thumbnail = await toDataUrl(row.imageUrl);
            }
          }
        } catch {
          /* thumbnail is best-effort */
        }

        if (!thumbnail) {
          return Response.json(
            {
              error:
                "Item encontrado, mas a thumbnail ainda não está disponível. Tente novamente em alguns segundos.",
            },
            { status: 200 },
          );
        }

        return Response.json({
          item: { id: assetId, name, creator, thumbnail },
        });
      },
    },
  },
});
