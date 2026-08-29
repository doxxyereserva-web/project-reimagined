import { createFileRoute } from "@tanstack/react-router";

type Body = {
  input: string; // Roblox catalog URL or bare asset ID
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function extractAssetId(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d{3,}$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/roblox\.com\/(?:catalog|library)\/(\d{3,})/i);
  if (m) return Number(m[1]);
  const any = trimmed.match(/(\d{6,})/);
  if (any) return Number(any[1]);
  return null;
}

async function fetchAsDataUrl(
  url: string,
): Promise<{ dataUrl: string; byteLength: number } | undefined> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const mime = res.headers.get("content-type") ?? "image/png";
    return { dataUrl: `data:${mime};base64,${btoa(bin)}`, byteLength: buf.length };
  } catch {
    return undefined;
  }
}

// Resolve the template image ID referenced by a classic clothing asset.
// assetdelivery returns an XML manifest whose <url> points to the real
// template image (e.g. http://www.roblox.com/asset/?id=123 or rbxassetid://123).
function extractTemplateImageId(xml: string): number | null {
  const urlMatch = xml.match(/<url>[^<]*?(?:id=|rbxassetid:\/\/)(\d+)[^<]*<\/url>/i);
  if (urlMatch) return Number(urlMatch[1]);
  // Some manifests inline the id directly
  const loose = xml.match(/(\d{6,})/);
  return loose ? Number(loose[1]) : null;
}

export const Route = createFileRoute("/api/catalog-copy")({
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

        // Best-effort name/creator for labeling.
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
          /* best-effort */
        }

        // Step 1: fetch the asset manifest XML to find the template image.
        let templateImageId: number | null = null;
        try {
          const mRes = await fetch(
            `https://assetdelivery.roblox.com/v1/asset?id=${assetId}`,
            { headers: { "User-Agent": UA } },
          );
          if (mRes.ok) {
            const xml = await mRes.text();
            templateImageId = extractTemplateImageId(xml);
          }
        } catch {
          /* fall through */
        }

        if (!templateImageId) {
          return Response.json(
            {
              error:
                "Não consegui resolver o template desse item — verifique se é uma camisa/calça clássica.",
            },
            { status: 200 },
          );
        }

        // Step 2: fetch the actual template PNG (585×559 for shirts/pants).
        const tpl = await fetchAsDataUrl(
          `https://assetdelivery.roblox.com/v1/asset?id=${templateImageId}`,
        );
        if (!tpl) {
          return Response.json(
            { error: "Template resolvido, mas o download da imagem falhou." },
            { status: 200 },
          );
        }

        return Response.json({
          item: {
            id: assetId,
            templateImageId,
            name,
            creator,
            template: tpl.dataUrl,
            bytes: tpl.byteLength,
          },
        });
      },
    },
  },
});
