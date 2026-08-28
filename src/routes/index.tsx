import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, Upload, X, Download, Shirt, Wand2, Copy, Check, Zap, Sparkles, ShieldCheck, Layers, Eye, ScanSearch, Paintbrush, Search, Brain, Ruler, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { processAlpha, DEFAULT_ALPHA, type AlphaOptions } from "@/lib/alpha-engine";
import { ISSUES, loadLearned, recordIssues, clearLearned, learnedRuleStrings, type IssueId, type LearnedRule } from "@/lib/learning";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RoGen — Roblox Clothing Generator" },
      {
        name: "description",
        content:
          "Generate upload-ready Roblox classic shirts and pants from a text prompt and reference images. 585x559 PNG, no editing needed.",
      },
      { property: "og:title", content: "RoGen — Roblox Clothing Generator" },
      {
        property: "og:description",
        content:
          "AI-powered Roblox clothing templates, exported at exact 585x559 px for direct upload.",
      },
    ],
  }),
  component: Page,
});

const TARGET_W = 585;
const TARGET_H = 559;
const MAX_REFS = 10;

type ClothingType = "shirt" | "pants";
type ModelChoice = "gemini" | "gpt";
const MODEL_STORAGE_KEY = "rogen.model";
const FLAGS_STORAGE_KEY = "rogen.flags";

type Flags = {
  nac: boolean;
  rpb: boolean;
  rmtpc: boolean;
  dra: boolean;
  chroma: boolean;
  limb: boolean;
  learn: boolean;
  catalog: boolean;
};

const DEFAULT_FLAGS: Flags = {
  nac: true,
  rpb: true,
  rmtpc: true,
  dra: true,
  chroma: true,
  limb: true,
  learn: true,
  catalog: true,
};


type InpaintRegion = "torso" | "right_arm" | "left_arm" | "right_leg" | "left_leg";

// Approximate pixel rectangles (on 585x559) for each region group.
const REGION_RECTS: Record<InpaintRegion, { x: number; y: number; w: number; h: number }> = {
  torso:     { x: 188, y: 0,   w: 264, h: 340 },
  right_arm: { x: 0,   y: 260, w: 196, h: 299 },
  left_arm:  { x: 449, y: 260, w: 136, h: 299 },
  right_leg: { x: 0,   y: 0,   w: 292, h: 559 },
  left_leg:  { x: 293, y: 0,   w: 292, h: 559 },
};

const REGION_LABEL: Record<InpaintRegion, string> = {
  torso: "Torso",
  right_arm: "Braço direito",
  left_arm: "Braço esquerdo",
  right_leg: "Perna direita",
  left_leg: "Perna esquerda",
};


async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });
  return img;
}

/**
 * Compose a new blob = base image with `rect` replaced by the same region of `patch`.
 * Both images are rendered at the canonical 585x559 canvas. Preserves alpha.
 */
async function compositeRegion(
  baseUrl: string,
  patchUrl: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<Blob> {
  const [base, patch] = await Promise.all([loadImage(baseUrl), loadImage(patchUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d")!;
  // Draw base full-size
  ctx.clearRect(0, 0, TARGET_W, TARGET_H);
  ctx.drawImage(base, 0, 0, TARGET_W, TARGET_H);
  // Clear target rect (so we don't double-composite alpha) and draw patch only in rect
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  // Draw the patch full-size onto an offscreen, then copy the rect into target.
  const off = document.createElement("canvas");
  off.width = TARGET_W;
  off.height = TARGET_H;
  const octx = off.getContext("2d")!;
  octx.drawImage(patch, 0, 0, TARGET_W, TARGET_H);
  ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Compose failed"))), "image/png");
  });
}

async function normalizeTo585x559(
  b64: string,
  alpha: AlphaOptions | null,
): Promise<{ blob: Blob; transparentPct: number }> {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, TARGET_W, TARGET_H);
  const scale = Math.max(TARGET_W / img.width, TARGET_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (TARGET_W - w) / 2;
  const y = (TARGET_H - h) / 2;
  // Nearest-neighbour keeps the chroma key pure (smoothing would create
  // magenta-to-fabric gradients that survive the key).
  ctx.imageSmoothingEnabled = !alpha;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, w, h);

  let transparentPct = 0;
  if (alpha) {
    const data = ctx.getImageData(0, 0, TARGET_W, TARGET_H);
    transparentPct = processAlpha(data, alpha).transparentPct;
    ctx.putImageData(data, 0, 0);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar PNG"))),
      "image/png",
    );
  });
  return { blob, transparentPct };
}


function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "roupa";
}

function Page() {
  const [type, setType] = useState<ClothingType>("shirt");
  const [model, setModel] = useState<ModelChoice>(() => {
    if (typeof window === "undefined") return "gemini";
    const saved = window.localStorage.getItem(MODEL_STORAGE_KEY);
    return saved === "gpt" ? "gpt" : "gemini";
  });
  const setModelPersist = (m: ModelChoice) => {
    setModel(m);
    try { window.localStorage.setItem(MODEL_STORAGE_KEY, m); } catch { /* ignore */ }
  };
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<{ name: string; url: string }[]>([]);
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FLAGS_STORAGE_KEY);
      if (raw) setFlags({ ...DEFAULT_FLAGS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);
  const toggleFlag = (k: keyof Flags) => {
    setFlags((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      try { window.localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Alpha pipeline options derived from the active pro modes.
  const alphaOpts: AlphaOptions | null = useMemo(() => {
    if (!flags.chroma && !flags.rpb) return null;
    return {
      ...DEFAULT_ALPHA,
      chroma: flags.chroma,
      killCheckerboard: true,
      killWhiteBackground: true,
    };
  }, [flags.chroma, flags.rpb]);

  // Learned corrective rules (self-improvement memory).
  const [learned, setLearned] = useState<LearnedRule[]>([]);
  useEffect(() => setLearned(loadLearned()), []);
  const [feedbackSent, setFeedbackSent] = useState<IssueId[]>([]);

  // Roblox catalog reference search.
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogItems, setCatalogItems] = useState<
    { id: number; name: string; creator?: string; thumbnail?: string }[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [inpaintRegion, setInpaintRegion] = useState<InpaintRegion | null>(null);
  const [inpaintRefinement, setInpaintRefinement] = useState("");
  const [inpainting, setInpainting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => /^image\//.test(f.type));
      const room = MAX_REFS - refs.length;
      const next = arr.slice(0, room);
      const loaded = await Promise.all(
        next.map(async (f) => ({ name: f.name, url: await fileToDataUrl(f) })),
      );
      setRefs((prev) => [...prev, ...loaded].slice(0, MAX_REFS));
    },
    [refs.length],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const removeRef = (i: number) => setRefs((r) => r.filter((_, idx) => idx !== i));

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultBlob(null);
    try {
      const res = await fetch("/api/generate-clothing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          prompt: prompt.trim(),
          references: refs.map((r) => r.url),
          model,
          flags,
          learned: flags.learn ? learnedRuleStrings(learned) : [],
        }),
      });
      const raw = await res.text();
      let parsed: { b64?: string; error?: string } = {};
      try { parsed = JSON.parse(raw); } catch { /* non-json */ }
      if (!res.ok || !parsed.b64) {
        if (res.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
        if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
        throw new Error(parsed.error || raw.slice(0, 200) || `Erro ${res.status}`);
      }
      const { blob, transparentPct } = await normalizeTo585x559(parsed.b64, alphaOpts);
      const url = URL.createObjectURL(blob);
      setResultBlob(blob);
      setResultUrl(url);
      setFeedbackSent([]);
      toast.success("Outfit pronto!", {
        description: `${(blob.size / 1024).toFixed(0)} KB · 585×559 PNG · ${
          alphaOpts ? `${transparentPct.toFixed(1)}% transparente` : "sem pós-alpha"
        } · upload-ready`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar a roupa.";
      setError(msg);
      toast.error("Geração falhou", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const filename = () => `roblox-${type}-${slugify(prompt)}-${Date.now()}.png`;

  const regionsForType: InpaintRegion[] =
    type === "shirt" ? ["torso", "right_arm", "left_arm"] : ["right_leg", "left_leg"];

  const repaintRegion = async () => {
    if (!resultBlob || !resultUrl || !inpaintRegion || inpainting) return;
    setInpainting(true);
    setError(null);
    try {
      const baseDataUrl = await blobToDataUrl(resultBlob);
      const res = await fetch("/api/generate-clothing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          prompt: prompt.trim() || "(same as before)",
          references: refs.map((r) => r.url),
          model,
          flags,
          learned: flags.learn ? learnedRuleStrings(learned) : [],
          inpaint: {
            region: inpaintRegion,
            baseImage: baseDataUrl,
            refinement: inpaintRefinement.trim(),
          },
        }),
      });
      const raw = await res.text();
      let parsed: { b64?: string; error?: string } = {};
      try { parsed = JSON.parse(raw); } catch { /* non-json */ }
      if (!res.ok || !parsed.b64) {
        if (res.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
        if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
        throw new Error(parsed.error || raw.slice(0, 200) || `Erro ${res.status}`);
      }
      const { blob: patchBlob, transparentPct } = await normalizeTo585x559(
        parsed.b64,
        alphaOpts,
      );
      const patchUrl = URL.createObjectURL(patchBlob);
      const composed = await compositeRegion(
        baseDataUrl,
        patchUrl,
        REGION_RECTS[inpaintRegion],
      );
      URL.revokeObjectURL(patchUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const url = URL.createObjectURL(composed);
      setResultBlob(composed);
      setResultUrl(url);
      setFeedbackSent([]);
      toast.success(`${REGION_LABEL[inpaintRegion]} repintado`, {
        description: `Demais cells preservados${
          alphaOpts ? ` · ${transparentPct.toFixed(1)}% transparente no patch` : ""
        }.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao repintar.";
      setError(msg);
      toast.error("Repintura falhou", { description: msg });
    } finally {
      setInpainting(false);
    }
  };

  const searchCatalog = async () => {
    const keyword = catalogQuery.trim();
    if (!keyword || catalogLoading) return;
    setCatalogLoading(true);
    try {
      const res = await fetch("/api/catalog-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, type, limit: 8 }),
      });
      const json = (await res.json()) as {
        items?: { id: number; name: string; creator?: string; thumbnail?: string }[];
        error?: string;
      };
      setCatalogItems(json.items ?? []);
      if (json.error) toast.error("Catálogo Roblox", { description: json.error });
      else if (!json.items?.length)
        toast.info("Nenhum item encontrado para essa busca.");
    } catch {
      toast.error("Falha ao buscar no catálogo do Roblox.");
    } finally {
      setCatalogLoading(false);
    }
  };

  const addCatalogRef = (item: { name: string; thumbnail?: string }) => {
    if (!item.thumbnail) return;
    if (refs.length >= MAX_REFS) {
      toast.error(`Máximo de ${MAX_REFS} referências.`);
      return;
    }
    setRefs((prev) => [...prev, { name: item.name, url: item.thumbnail! }].slice(0, MAX_REFS));
    toast.success("Referência adicionada", { description: item.name });
  };

  const toggleFeedback = (id: IssueId) => {
    if (feedbackSent.includes(id)) return;
    const next = recordIssues([id]);
    setLearned(next);
    setFeedbackSent((prev) => [...prev, id]);
    toast.success("Aprendido", {
      description: "Essa correção será aplicada nas próximas gerações.",
    });
  };

  const wipeMemory = () => {
    clearLearned();
    setLearned([]);
    setFeedbackSent([]);
    toast.success("Memória aprendida limpa.");
  };



  const download = async () => {
    if (!resultBlob || downloading) return;
    setDownloading(true);
    try {
      const url = URL.createObjectURL(resultBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename();
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the browser had time to start the download
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success("Download iniciado", {
        description: "Faça upload em create.roblox.com → Avatar Items → Classic Clothing.",
      });
    } catch {
      toast.error("Não foi possível baixar. Tente novamente.");
    } finally {
      setDownloading(false);
    }
  };

  const copyImage = async () => {
    if (!resultBlob) return;
    try {
      if (!("clipboard" in navigator) || !("write" in navigator.clipboard)) {
        throw new Error("Clipboard de imagem não suportado neste navegador.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!ClipboardItemCtor) throw new Error("ClipboardItem indisponível.");
      await navigator.clipboard.write([
        new ClipboardItemCtor({ "image/png": resultBlob }),
      ]);
      setCopied(true);
      toast.success("Imagem copiada para a área de transferência");
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao copiar.");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/60 backdrop-blur sticky top-0 z-20 bg-background/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0 glow">
              <Wand2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold truncate">RoGen</h1>
              <p className="text-xs text-muted-foreground truncate">
                Roblox clothing generator · 585 × 559 px ready-to-upload
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex text-xs px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground">
            v1 · AI-powered
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
        {/* CONTROL PANEL */}
        <section className="space-y-6">
          {/* Type selector */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tipo de peça
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2 p-1 rounded-xl bg-secondary">
              {(["shirt", "pants"] as ClothingType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "h-11 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2",
                    type === t
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Shirt className={cn("h-4 w-4", t === "pants" && "rotate-180")} />
                  {t === "shirt" ? "Camisa (Shirt)" : "Calça (Pants)"}
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Modelo de IA
            </label>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                {
                  id: "gemini" as const,
                  name: "Rápido (Gemini)",
                  desc: "Rápido, ótima coerência, custo baixo.",
                  badge: "Recomendado",
                  icon: Zap,
                },
                {
                  id: "gpt" as const,
                  name: "Preciso (GPT Image)",
                  desc: "Melhor com logos/marcas. Mais lento e gasta mais crédito.",
                  badge: "Premium",
                  icon: Sparkles,
                },
              ]).map((m) => {
                const Icon = m.icon;
                const active = model === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setModelPersist(m.id)}
                    className={cn(
                      "text-left rounded-xl border p-3 transition-all",
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border hover:border-primary/50 hover:bg-secondary/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-sm font-semibold">{m.name}</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-card text-muted-foreground">
                        {m.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">{m.desc}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {model === "gpt"
                ? "Preciso: pode levar 30–60s por geração e consome ~5–10× mais crédito."
                : "Padrão. Ideal para a maioria das gerações."}
            </p>
          </div>

          {/* Pro modes — hard rules injected into the prompt */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Modos profissionais
            </label>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {([
                {
                  id: "nac" as const,
                  name: "NAC · Non-Artificial Content",
                  desc: "Proíbe roupa lisa/artificial. Força mesh, textura de tecido, costuras, profundidade e variação tonal.",
                  icon: Layers,
                },
                {
                  id: "rpb" as const,
                  name: "RPB · Real PNG Background",
                  desc: "Força alpha real (PNG-32). Áreas pedidas como transparentes (manga, gola, decote, etc.) ficam alpha = 0, nunca brancas.",
                  icon: Eye,
                },
                {
                  id: "rmtpc" as const,
                  name: "RMTPC · Reconhecimento de Marcas/Texturas/Padrões",
                  desc: "IA trabalha mais pesado para captar cor, padrões, profundidade, texturas e marcas. Mais tempo, melhor resultado.",
                  icon: ShieldCheck,
                },
                {
                  id: "dra" as const,
                  name: "DRA · Deep Reference Analysis",
                  desc: "Image-to-project: força a IA a analisar profundamente cada referência (estrutura, costuras, materiais, detalhes) por no mínimo 25s antes de gerar. Pode demorar mais para um resultado superior.",
                  icon: ScanSearch,
                },
                {
                  id: "chroma" as const,
                  name: "CHROMA · Chroma-key alpha",
                  desc: "Pede tudo que é transparente pintado em magenta #FF00FF e remove no navegador, gerando alpha real. Também mata fundo branco e xadrez falso.",
                  icon: Eye,
                },
                {
                  id: "limb" as const,
                  name: "LIMB · Trava de geometria",
                  desc: "Corrige o defeito nº1: mangas quebradas, punho/buraco da mão, ombro, bainhas e painéis de perna alinhados nas seis faces de cada membro.",
                  icon: Ruler,
                },
                {
                  id: "learn" as const,
                  name: "LEARN · Memória de aprendizado",
                  desc: `Injeta as correções que você marcou nas gerações anteriores (${learned.length} regra${learned.length === 1 ? "" : "s"} aprendida${learned.length === 1 ? "" : "s"}).`,
                  icon: Brain,
                },
                {
                  id: "catalog" as const,
                  name: "CATALOG · Padrão Roblox",
                  desc: "Libera a busca de referências reais no catálogo do Roblox e ensina a IA a seguir o padrão de produção da plataforma.",
                  icon: Search,
                },
              ]).map((f) => {
                const Icon = f.icon;
                const active = flags[f.id];
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFlag(f.id)}
                    className={cn(
                      "text-left rounded-xl border p-3 transition-all flex items-start gap-3",
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border hover:border-primary/50 hover:bg-secondary/40",
                    )}
                    aria-pressed={active}
                  >
                    <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{f.name}</span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full border",
                          active
                            ? "border-primary/60 bg-primary/20 text-foreground"
                            : "border-border bg-card text-muted-foreground",
                        )}>
                          {active ? "ON" : "OFF"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{f.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Ativar os três aumenta a qualidade mas pode adicionar segundos extras por geração.
            </p>
          </div>

          {/* Prompt */}

          <div className="rounded-2xl border border-border bg-card p-5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Descrição da roupa
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                type === "shirt"
                  ? "Ex: Jaqueta bomber preta com detalhes dourados nos zíperes e capuz cinza"
                  : "Ex: Calça jeans rasgada azul-escura com costuras laranja e bolsos cargo"
              }
              className="mt-3 min-h-32 resize-y bg-input/50 border-border text-sm"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              O sistema injeta regras técnicas do template Roblox automaticamente.
            </p>
          </div>

          {/* References */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Referências visuais
              </label>
              <span className="text-[11px] text-muted-foreground">
                {refs.length}/{MAX_REFS}
              </span>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
              className={cn(
                "mt-3 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors",
                dragOver
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-secondary/40",
              )}
            >
              <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Arraste imagens ou clique para enviar</p>
              <p className="text-[11px] text-muted-foreground">
                PNG, JPG, WEBP · até {MAX_REFS} arquivos
              </p>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {refs.length > 0 && (
              <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 gap-2">
                {refs.map((r, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded-lg overflow-hidden border border-border group"
                  >
                    <img src={r.url} alt={r.name} className="h-full w-full object-cover" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRef(i);
                      }}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/90 grid place-items-center opacity-0 group-hover:opacity-100 transition hover:bg-destructive hover:text-destructive-foreground"
                      aria-label="Remover"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Generate button */}
          <Button
            onClick={generate}
            disabled={loading || !prompt.trim()}
            className="w-full h-14 text-base font-bold bg-primary text-primary-foreground hover:bg-primary/90 glow"
          >
            {loading ? (
              <span className="ai-shimmer-text text-base font-semibold">
                Gerando…
              </span>
            ) : (
              <>
                <Wand2 className="h-5 w-5 mr-2" />
                Gerar Outfit
              </>
            )}
          </Button>

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive-foreground p-3 text-sm">
              {error}
            </div>
          )}
        </section>

        {/* PREVIEW PANEL */}
        <section className="space-y-4 lg:sticky lg:top-24 self-start">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Preview técnico
              </h2>
              <span className="text-[11px] font-mono text-muted-foreground">
                585 × 559 px · PNG
              </span>
            </div>

            <div className="relative w-full overflow-hidden rounded-xl border border-border bg-[oklch(0.12_0.02_270)]">
              <div
                className="relative w-full bg-grid"
                style={{ aspectRatio: `${TARGET_W} / ${TARGET_H}` }}
              >
                {resultUrl ? (
                  <img
                    src={resultUrl}
                    alt="Generated Roblox template"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                ) : loading ? (
                  <AiLoader />

                ) : (
                  <div className="absolute inset-0 grid place-items-center text-muted-foreground p-6 text-center">
                    <div>
                      <Shirt className="h-10 w-10 mx-auto opacity-50" />
                      <p className="mt-3 text-sm">
                        O resultado aparecerá aqui, alinhado ao grid do template Roblox.
                      </p>
                    </div>
                  </div>
                )}
                {/* Template grid overlay (informational, semi-transparent) */}
                <TemplateOverlay type={type} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              onClick={download}
              disabled={!resultBlob || downloading}
              className="h-12 font-semibold bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Baixar PNG{resultBlob ? ` · ${(resultBlob.size / 1024).toFixed(0)} KB` : ""}
            </Button>
            <Button
              onClick={copyImage}
              disabled={!resultBlob}
              variant="outline"
              className="h-12 px-3"
              aria-label="Copiar imagem"
              title="Copiar imagem"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            585×559 PNG · canal alfa preservado · upload direto em create.roblox.com.
          </p>

          {resultUrl && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Paintbrush className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">RPI · Repintar parte</h3>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Regenera apenas a região escolhida. As outras cells do template são mantidas pixel-a-pixel do resultado anterior.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {regionsForType.map((r) => {
                  const active = inpaintRegion === r;
                  return (
                    <button
                      key={r}
                      onClick={() => setInpaintRegion(active ? null : r)}
                      className={cn(
                        "h-10 rounded-lg text-xs font-semibold border transition-all",
                        active
                          ? "border-primary bg-primary/10 ring-1 ring-primary text-foreground"
                          : "border-border hover:border-primary/50 hover:bg-secondary/40 text-muted-foreground",
                      )}
                    >
                      {REGION_LABEL[r]}
                    </button>
                  );
                })}
              </div>
              <Textarea
                value={inpaintRefinement}
                onChange={(e) => setInpaintRefinement(e.target.value)}
                placeholder="Refinamento opcional para essa região (ex: 'mais textura de denim', 'manga mais curta', 'logo menor')"
                className="min-h-20 resize-y bg-input/50 border-border text-sm"
              />
              <Button
                onClick={repaintRegion}
                disabled={!inpaintRegion || inpainting}
                className="w-full h-11 font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {inpainting ? (
                  <span className="ai-shimmer-text">Repintando {inpaintRegion ? REGION_LABEL[inpaintRegion].toLowerCase() : ""}…</span>
                ) : (
                  <>
                    <Paintbrush className="h-4 w-4 mr-2" />
                    Repintar {inpaintRegion ? REGION_LABEL[inpaintRegion] : "região"}
                  </>
                )}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function TemplateOverlay({ type }: { type: ClothingType }) {
  // Simplified Roblox classic template grid (proportions match 585x559 UV map)
  // Shows the cell boundaries so the user can validate alignment.
  const lineClass = "absolute bg-primary/40";
  if (type === "shirt") {
    return (
      <svg
        viewBox={`0 0 ${TARGET_W} ${TARGET_H}`}
        className="absolute inset-0 h-full w-full pointer-events-none mix-blend-screen opacity-50"
        preserveAspectRatio="none"
      >
        <g
          fill="none"
          stroke="oklch(0.92 0.005 270)"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        >
          {/* Outer frame */}
          <rect x="1" y="1" width={TARGET_W - 2} height={TARGET_H - 2} />
          {/* Top arm tops row (y≈0-74) */}
          <line x1="0" y1="74" x2={TARGET_W} y2="74" />
          {/* Middle main row split (y≈262) */}
          <line x1="0" y1="262" x2={TARGET_W} y2="262" />
          {/* Bottom cuffs split */}
          <line x1="0" y1="450" x2={TARGET_W} y2="450" />
          {/* Vertical splits — approximate Roblox panel widths */}
          {[75, 150, 225, 300, 375, 450, 525].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2={TARGET_H} />
          ))}
        </g>
      </svg>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${TARGET_W} ${TARGET_H}`}
      className="absolute inset-0 h-full w-full pointer-events-none mix-blend-screen opacity-50"
      preserveAspectRatio="none"
    >
      <g
        fill="none"
        stroke="oklch(0.92 0.005 270)"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      >
        <rect x="1" y="1" width={TARGET_W - 2} height={TARGET_H - 2} />
        <line x1="0" y1="74" x2={TARGET_W} y2="74" />
        <line x1="0" y1="262" x2={TARGET_W} y2="262" />
        <line x1="0" y1="450" x2={TARGET_W} y2="450" />
        {[75, 150, 225, 300, 375, 450, 525].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2={TARGET_H} />
        ))}
      </g>
    </svg>
  );
}

function AiLoader() {
  const [phase, setPhase] = useState(0);
  const phases = [
    "Analisando prompt",
    "Mapeando UV do template",
    "Sintetizando textura",
    "Refinando alpha e bordas",
    "Renderizando passe final",
  ];
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % phases.length), 2400);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-[2px]">
      <p
        key={phase}
        className="ai-shimmer-text text-base sm:text-lg font-medium tracking-tight animate-fade-in"
      >
        {phases[phase]}
      </p>
    </div>
  );
}
