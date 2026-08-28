## Objetivo

Permitir que o usuário escolha entre dois modelos de IA na hora de gerar a roupa, sem remover o modelo atual (Gemini 3.1 Flash Image). Ambos rodam pelo Lovable AI Gateway — não precisa de API key externa nem cadastro em outro serviço.

## Por que não Grok

- A API do Grok (xAI) **não é grátis nem ilimitada** (cobra por imagem em USD).
- O `grok-2-image` **não aceita imagens de referência** — sem o template oficial como base, a saída sai fora do grid 585×559 e o Roblox rejeita.
- O "Grok grátis" que você viu é só o chat do grok.com / app do X, sem API pública.

## Modelos escolhidos

| Apelido na UI | Modelo real | Quando usar | Custo relativo |
|---|---|---|---|
| **Rápido (Gemini)** — padrão | `google/gemini-3.1-flash-image-preview` (atual) | Geração rápida, ótima coerência, melhor custo-benefício | Baixo |
| **Preciso (GPT Image)** | `openai/gpt-image-2` com `quality: "low"` | Mais fiel a logos, texto e detalhes de roupas reais (varsity, jerseys, marcas), porém ~3-5× mais lento e mais caro | Alto |

Os dois aceitam o template oficial + imagens de referência do usuário, então a lógica de prompt continua igual.

## Mudanças

### 1. Backend — `src/routes/api/generate-clothing.ts`
- Adicionar campo opcional `model: "gemini" | "gpt"` no `Body`.
- Mapear para o modelo real e montar o `requestBody` correto:
  - `gemini` → mantém exatamente o request atual (`/v1/images/generations`, `modalities: ["image","text"]`).
  - `gpt` → mesma rota, mas com `model: "openai/gpt-image-2"`, `quality: "low"`, sem `modalities`. As referências vão como `image_url` no `content` (mesma estrutura que já uso).
- Default = `gemini` quando o campo vier vazio (mantém compatibilidade).
- Parser de resposta já cobre os dois formatos (`data[0].b64_json` e `data[0].url`).
- Mensagem de erro 402/429 ganha hint indicando que o modelo Preciso consome mais crédito.

### 2. Frontend — onde fica o formulário de geração
- Adicionar um seletor (toggle/segmented control) acima do botão "Gerar":
  - **Rápido (Gemini)** — selecionado por padrão, badge "Recomendado"
  - **Preciso (GPT)** — badge "Melhor para logos/marcas, mais lento"
- Persistir escolha em `localStorage` pra não resetar a cada geração.
- Enviar `model` no `fetch` para `/api/generate-clothing`.
- Mostrar no estado de loading qual modelo está rodando ("Gerando com Gemini…" / "Gerando com GPT Image (pode levar 30-60s)…").

### 3. Treino / regras (prompt)
- O `SYSTEM` prompt atual já é bem rigoroso e funciona pros dois modelos. Não vou duplicar — mesmo prompt, mesmas regras de template/coerência/transparência.
- Pequena tuning extra **só** pro caminho GPT: acrescentar 1 parágrafo enfatizando "respeite o grid pixel-a-pixel da primeira imagem anexada" (GPT-Image tende a estilizar demais sem esse reforço).

### 4. Sem mexer
- Modelo Gemini atual: intacto, mesmo prompt, mesmo comportamento.
- Lógica de referências, template B64, parsing de resposta: intacta.

## Observações de custo

Com o GPT Image em `quality: "low"`, cada geração consome ~5-10× mais crédito que o Gemini Flash Image. No plano grátis ($1/mês) dá pra umas poucas dezenas. Vale deixar o aviso claro na UI pro usuário não estourar sem perceber.

## O que não vai entrar (a confirmar depois se quiser)

- Contador de uso por modelo na UI.
- Cache de geração (mesma prompt + ref = reusa imagem).
- Mais de 2 modelos no seletor (dá pra adicionar `gemini-3-pro-image-preview` depois se quiser um "Ultra").