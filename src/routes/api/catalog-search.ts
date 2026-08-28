import { createFileRoute } from "@tanstack/react-router";

type Body = {
  keyword: string;
  type: "shirt" | "pants";
  limit?: number;
};

type CatalogItem = {
  id: number;
  name: string;
  creator?: string;
  thumbnail?: string; // data URL
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

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

export const Route = createFileRoute("/api/catalog-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const keyword = (body?.keyword ?? "").trim();
        if (!keyword) return Response.json({ items: [] });

        const limit = Math.min(Math.max(body.limit ?? 6, 1), 10);
        // Category 3 = Clothing; Subcategory 12 = Shirts, 14 = Pants (classic).
        const subcategory = body.type === "pants" ? 14 : 12;
        const search =
          `https://catalog.roblox.com/v1/search/items/details` +
          `?Category=3&Subcategory=${subcategory}&Limit=30&SortType=0` +
          `&Keyword=${encodeURIComponent(keyword)}`;

        let ids: CatalogItem[] = [];
        try {
          const res = await fetch(search, {
            headers: { "User-Agent": UA, Accept: "application/json" },
          });
          if (!res.ok) {
            return Response.json(
              { items: [], error: `Catálogo Roblox indisponível (${res.status}).` },
              { status: 200 },
            );
          }
          const json = (await res.json()) as {
            data?: Array<{ id: number; name: string; creatorName?: string }>;
          };
          ids = (json.data ?? []).slice(0, limit).map((d) => ({
            id: d.id,
            name: d.name,
            creator: d.creatorName,
          }));
        } catch {
          return Response.json(
            { items: [], error: "Não foi possível consultar o catálogo do Roblox agora." },
            { status: 200 },
          );
        }

        if (!ids.length) return Response.json({ items: [] });

        // Thumbnails (the rendered clothing preview) for each asset.
        try {
          const thumbUrl =
            `https://thumbnails.roblox.com/v1/assets?assetIds=${ids
              .map((i) => i.id)
              .join(",")}&size=420x420&format=Png&isCircular=false`;
          const tRes = await fetch(thumbUrl, {
            headers: { "User-Agent": UA, Accept: "application/json" },
          });
          if (tRes.ok) {
            const tJson = (await tRes.json()) as {
              data?: Array<{ targetId: number; state: string; imageUrl?: string }>;
            };
            const map = new Map<number, string>();
            for (const t of tJson.data ?? []) {
              if (t.state === "Completed" && t.imageUrl) map.set(t.targetId, t.imageUrl);
            }
            await Promise.all(
              ids.map(async (item) => {
                const u = map.get(item.id);
                if (u) item.thumbnail = await toDataUrl(u);
              }),
            );
          }
        } catch {
          /* thumbnails are best-effort */
        }

        return Response.json({ items: ids.filter((i) => i.thumbnail) });
      },
    },
  },
});
