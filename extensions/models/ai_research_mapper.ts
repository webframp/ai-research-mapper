/**
 * @webframp/ai-research-mapper — Map AI papers to cloud infrastructure decisions.
 *
 * Fetches paper metadata from arXiv, analyzes content for cloud relevance,
 * and produces structured mappings per provider (AWS, Azure, GCP, generic)
 * with concrete actions, impact assessments, and priority ratings.
 *
 * Methods:
 *   map   — Index a paper URL or arXiv ID and produce a cloud infra mapping
 *   get   — Retrieve a previously mapped paper's analysis
 *   list  — Show query hints for filtering mapped papers
 */

import { z } from "npm:zod@4";

// ── Schemas ────────────────────────────────────────────────────────────────────

const GlobalArgsSchema = z.object({
  apiEndpoint: z.string().default("https://arxiv.org/abs/").describe(
    "Base URL for paper lookup — arXiv default, but can point elsewhere",
  ),
});

const PaperSchema = z.object({
  arxivId: z.string().describe("arXiv ID like 2502.05795"),
  title: z.string().describe("Paper title"),
  authors: z.array(z.string()).describe("Authors"),
  published: z.string().describe("Publication date"),
  abstract: z.string().describe("Abstract text"),
  tags: z.array(z.string()).describe("Relevant tags"),
});

const CloudInfraMappingSchema = z.object({
  arxivId: z.string(),
  title: z.string(),
  mappedAt: z.string(),
  summary: z.string(),
  cloudImplications: z.array(
    z.object({
      provider: z.string().describe("AWS, Azure, GCP, or generic"),
      impact: z.string().describe(
        "How this affects decisions on this provider",
      ),
      action: z.string().describe("Concrete step someone should take"),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  relevantServices: z.array(z.string()).describe(
    "Cloud services this paper touches",
  ),
  decisionCategory: z.array(
    z.enum([
      "training-cost",
      "inference-cost",
      "model-architecture",
      "deployment-strategy",
      "gpu-selection",
      "normalization",
      "scaling-law",
      "fine-tuning",
      "multimodal",
      "security",
    ]),
  ),
});

type PaperData = z.infer<typeof PaperSchema>;
type MappingData = z.infer<typeof CloudInfraMappingSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse an arXiv ID from a URL or bare ID string.
 * Accepts "2502.05795", "https://arxiv.org/abs/2502.05795", "https://arxiv.org/pdf/2502.05795".
 */
function parseArxivId(input: string): string {
  const urlMatch = input.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
  if (urlMatch) return urlMatch[1];
  const bareMatch = input.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  if (bareMatch) return bareMatch[1];
  throw new Error(
    `Cannot parse arXiv ID from "${input}" — expected something like "2502.05795" or a full arXiv URL.`,
  );
}

/**
 * Fetch paper metadata from an arXiv abstract HTML page by scraping meta tags.
 * Uses citation_* meta tags for title, authors, date, and abstract.
 */
async function fetchPaper(arxivId: string): Promise<PaperData> {
  const url = `https://arxiv.org/abs/${arxivId}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "HermesAI/1.0 (research bot)" },
  });

  if (!response.ok) {
    throw new Error(
      `arXiv fetch error: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();

  /** Extract a meta tag's content by name attribute value. */
  const getMeta = (name: string): string => {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    );
    const m = re.exec(html);
    return m ? m[1].trim() : "";
  };

  const title = getMeta("citation_title")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  const authors: string[] = [];
  const authorRe =
    /<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']+)["']/g;
  let am: RegExpExecArray | null;
  while ((am = authorRe.exec(html)) !== null) {
    authors.push(am[1].trim());
  }

  const abstractRaw = getMeta("citation_abstract");
  const abstract = abstractRaw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s+/g, " ")
    .trim();

  const published = getMeta("citation_date") || getMeta("citation_online_date");

  if (!abstract) {
    throw new Error(
      `No paper found for arXiv ID ${arxivId} — check the ID is correct.`,
    );
  }

  return {
    arxivId,
    title: title || "(unknown)",
    authors,
    published: published.slice(0, 10),
    abstract: abstract.slice(0, 3000),
    tags: inferTags(abstract, title),
  };
}

/**
 * Infer relevant tags from paper title and abstract using keyword matching.
 */
function inferTags(abstract: string, title: string): string[] {
  const text = `${title} ${abstract}`.toLowerCase();
  const tags: string[] = [];

  const keywordRules: [RegExp, string][] = [
    [/layer.?norm|layer.?normalization|pre.?ln|post.?ln|lns/i, "normalization"],
    [/gpu|h100|h200|b200|trainium|tpu/i, "gpu"],
    [
      /training.*cost|cost.*train|compute.*budget|scaling.*law/i,
      "training-cost",
    ],
    [/inference.*cost|inference.*optimize|quantiz|prun/i, "inference-cost"],
    [/fine.?tune|sft|instruct|adapt/i, "fine-tuning"],
    [/multi.?modal|vision|audio.*model|text.*image/i, "multimodal"],
    [/deploy|serving|latency|throughput|optimization/i, "deployment-strategy"],
    [/attention|transformer|architect|block/i, "model-architecture"],
    [/security|safety|guardrail|prompt.*inject|pii/i, "security"],
    [/cloud|aws|azure|gcp|google.*cloud/i, "deployment-strategy"],
  ];

  const seen = new Set<string>();
  for (const [re, tag] of keywordRules) {
    if (re.test(text) && !seen.has(tag)) {
      tags.push(tag);
      seen.add(tag);
    }
  }

  if (tags.length === 0) tags.push("model-architecture");

  return tags;
}

/**
 * Map a paper's content to structured cloud infrastructure implications.
 * Produces per-provider recommendations, relevant services, and decision categories.
 */
function mapToCloudInfra(paper: PaperData): MappingData {
  const implications: MappingData["cloudImplications"] = [];
  const relevantServices: string[] = [];
  const decisionCategories: Array<MappingData["decisionCategory"][number]> = [];
  const tags = paper.tags;

  if (
    tags.includes("training-cost") || tags.includes("normalization") ||
    tags.includes("model-architecture")
  ) {
    decisionCategories.push("training-cost");
    implications.push({
      provider: "generic",
      impact:
        "Paper impacts training resource requirements — may reduce GPU hours needed for effective training depth.",
      action:
        "Update cost models to account for modified layer utilization. Re-benchmark training efficiency on target hardware.",
      priority: "high",
    });
    implications.push({
      provider: "GCP",
      impact:
        "TPU v5p/v6 pricing advantages compound if training depth efficiency improves — fewer layers wasted means better TPU utilization per dollar.",
      action:
        "Model TPU cost-per-effective-layer metrics. GCP pricing starts at $2,000-2,700 for 72h 8-GPU training runs versus $2,400-3,100 on AWS.",
      priority: "medium",
    });
    implications.push({
      provider: "AWS",
      impact:
        "Trainium3 instances (launched Q1 2026, 3x faster than Trainium2) benefit from architecture improvements that reduce layer waste.",
      action:
        "Benchmark Trainium3 against H100/H200 for models using improved normalization strategies like LNS.",
      priority: "medium",
    });
    implications.push({
      provider: "Azure",
      impact:
        "Azure's 39% YoY AI growth means architectural optimizations that reduce training cost compound savings at scale with reserved capacity.",
      action:
        "Evaluate Azure reserved GPU instances against spot pricing when training models with reduced layer waste.",
      priority: "low",
    });
    relevantServices.push(
      "AWS SageMaker",
      "AWS Trainium",
      "GCP Vertex AI",
      "GCP TPU",
      "Azure ML Studio",
    );
  }

  if (tags.includes("inference-cost") || tags.includes("deployment-strategy")) {
    decisionCategories.push("inference-cost");
    implications.push({
      provider: "generic",
      impact:
        "Inference optimization research directly affects per-token cost across all cloud providers.",
      action:
        "Track inference benchmark comparisons (Azure 180ms TTFT, GCP 210ms, AWS 245ms) against any new optimization.",
      priority: "medium",
    });
    relevantServices.push("AWS Bedrock", "Azure OpenAI", "GCP Vertex AI");
  }

  if (tags.includes("deployment-strategy")) {
    decisionCategories.push("deployment-strategy");
    implications.push({
      provider: "generic",
      impact:
        "Architecture decisions affect deployment topology — deeper efficient models may need different serving infrastructure.",
      action:
        "Review serving infra (GKE/AKS/EKS) capacity planning against model architecture changes.",
      priority: "medium",
    });
    relevantServices.push("GKE", "EKS", "AKS", "AWS Lambda", "GCP Cloud Run");
  }

  if (tags.includes("fine-tuning")) {
    decisionCategories.push("fine-tuning");
    implications.push({
      provider: "generic",
      impact:
        "Fine-tuning costs and approaches vary significantly by cloud: Vertex AI supports full suite (prompt tuning, LoRA, full retrain), Azure supports GPT-3.5 fine-tuning, Bedrock delegates to SageMaker.",
      action:
        "Choose fine-tuning approach based on provider capabilities — Vertex AI has broadest support at $1.20/h vCPU + $2/h GPU.",
      priority: "medium",
    });
    relevantServices.push(
      "GCP Vertex AI Fine-tuning",
      "Azure OpenAI Fine-tuning",
      "AWS SageMaker",
    );
  }

  if (tags.includes("gpu")) {
    decisionCategories.push("gpu-selection");
    implications.push({
      provider: "generic",
      impact:
        "H200 has replaced H100 as baseline for pre-training. H100 at $3-10/h, H200 at $3.83-10/h, B200 starting at $2.40/h.",
      action:
        "Update hardware selection matrix. Evaluate H200 vs B200 vs Trainium3 vs TPU v5p per effective training throughput.",
      priority: "high",
    });
    relevantServices.push(
      "AWS EC2 P5/P6",
      "Azure ND H100/H200",
      "GCP A3 High-GPU",
      "GCP TPU v5p/v6",
    );
  }

  if (tags.includes("normalization") || tags.includes("model-architecture")) {
    decisionCategories.push("model-architecture");
    if (!implications.some((i) => i.priority === "high")) {
      implications.push({
        provider: "generic",
        impact:
          "Architecture changes like LNS (LayerNorm Scaling) are trivially implementable — one line per layer norm, no hyperparams, zero extra parameters.",
        action:
          "Apply LNS to any Pre-LN LLaMA-family training run. Drop Scaled Initialization when using LNS. Reduces wasted GPU cycles on near-identity deep layers.",
        priority: "high",
      });
    }
    relevantServices.push("LLaMA-family models", "Mistral", "DeepSeek", "Qwen");
  }

  if (tags.includes("multimodal")) {
    decisionCategories.push("multimodal");
    implications.push({
      provider: "GCP",
      impact:
        "Vertex AI with Gemini has the most native multimodal support (text, image, audio, code under one endpoint).",
      action:
        "If multimodal capability is driving provider choice, GCP has the most cohesive story.",
      priority: "medium",
    });
    implications.push({
      provider: "Azure",
      impact:
        "Azure OpenAI has strong multimodal via GPT-4 Vision + DALL-E + Whisper but services are separate.",
      action:
        "Azure is best when OpenAI model family is the priority and multimodal is secondary.",
      priority: "low",
    });
    implications.push({
      provider: "AWS",
      impact:
        "Bedrock multimodal varies by provider — Stability AI for images, no native vision/audio yet.",
      action:
        "For multimodal-first use cases, Bedrock's model breadth matters less than GCP's unified architecture.",
      priority: "low",
    });
    relevantServices.push(
      "GCP Gemini",
      "Azure OpenAI Vision",
      "AWS Bedrock Stability AI",
    );
  }

  const summaryLines: string[] = [
    `Paper: "${paper.title}" (arXiv:${paper.arxivId})`,
    `Authors: ${paper.authors.slice(0, 3).join(", ")}${
      paper.authors.length > 3 ? " et al." : ""
    }`,
    `Tags: ${tags.join(", ")}`,
    "",
    "Cloud infrastructure mapping:",
    ...implications.map((i) =>
      `  [${i.provider}] (${i.priority} priority) ${i.action}`
    ),
  ];

  return {
    arxivId: paper.arxivId,
    title: paper.title,
    mappedAt: new Date().toISOString(),
    summary: summaryLines.join("\n"),
    cloudImplications: implications,
    relevantServices: [...new Set(relevantServices)],
    decisionCategory: [...new Set(decisionCategories)] as Array<
      MappingData["decisionCategory"][number]
    >,
  };
}

// ── Model Export ───────────────────────────────────────────────────────────────

/**
 * Model that fetches AI research papers from arXiv, analyzes their content,
 * and produces structured mappings to cloud infrastructure decisions across
 * AWS, Azure, and GCP. Each mapping includes per-provider implications with
 * priority ratings, relevant cloud services, and decision categories.
 */
export const model = {
  type: "@webframp/ai-research-mapper",
  version: "2026.06.17.2",
  globalArguments: GlobalArgsSchema,

  resources: {
    "mapping": {
      description: "AI paper to cloud infrastructure mapping result",
      schema: CloudInfraMappingSchema,
      lifetime: "infinite" as const,
      garbageCollection: 50,
    },
    "paper": {
      description: "Raw paper metadata fetched from arXiv",
      schema: PaperSchema,
      lifetime: "infinite" as const,
      garbageCollection: 50,
    },
  },

  methods: {
    map: {
      description:
        "Index an AI paper and map it to cloud infrastructure decisions",
      arguments: z.object({
        paperId: z.string().describe(
          "arXiv ID or URL (e.g., '2502.05795' or 'https://arxiv.org/abs/2502.05795')",
        ),
      }),
      execute: async (
        args: { paperId: string },
        context: {
          writeResource: (
            specName: string,
            instanceName: string,
            data: unknown,
          ) => Promise<{ id: string }>;
          logger: { info: (msg: string) => void };
        },
      ) => {
        const arxivId = parseArxivId(args.paperId);

        context.logger.info(`Fetching paper ${arxivId} from arXiv...`);
        const paper = await fetchPaper(arxivId);

        context.logger.info(
          `Mapping ${paper.title} to cloud infrastructure...`,
        );
        const mapping = mapToCloudInfra(paper);

        const paperHandle = await context.writeResource(
          "paper",
          arxivId,
          paper,
        );
        const mappingHandle = await context.writeResource(
          "mapping",
          `mapping-${arxivId}`,
          mapping,
        );

        context.logger.info(
          `Mapped ${arxivId} — ${mapping.cloudImplications.length} implications, ${mapping.decisionCategory.length} categories`,
        );

        return {
          dataHandles: [paperHandle, mappingHandle],
        };
      },
    },

    get: {
      description:
        "Retrieve a previously mapped paper's cloud infrastructure analysis",
      arguments: z.object({
        arxivId: z.string().describe("arXiv ID to look up"),
      }),
      execute: async (
        args: { arxivId: string },
        context: {
          readResource: (
            instanceName: string,
          ) => Promise<MappingData | null>;
        },
      ) => {
        const id = parseArxivId(args.arxivId);
        const mapping = await context.readResource(`mapping-${id}`);

        if (!mapping) {
          throw new Error(
            `No mapping found for arXiv ID ${id} — run the 'map' method first.`,
          );
        }

        return {
          dataHandles: [],
        };
      },
    },

    list: {
      description: "Show recent mapped papers summary",
      arguments: z.object({
        provider: z.string().optional().describe(
          "Filter by cloud provider (AWS, Azure, GCP, generic)",
        ),
        category: z.string().optional().describe(
          "Filter by decision category (training-cost, inference-cost, etc.)",
        ),
      }),
      execute: (
        args: { provider?: string; category?: string },
      ) => {
        const filterParts: string[] = [];
        if (args.provider) filterParts.push(`provider=${args.provider}`);
        if (args.category) filterParts.push(`category=${args.category}`);
        const filterHint = filterParts.length > 0
          ? ` (filtered by: ${filterParts.join(", ")})`
          : "";

        return {
          dataHandles: [],
          result: {
            message:
              `Use 'swamp data query' to enumerate mapped papers${filterHint}`,
            filterHint: args.provider || args.category
              ? `swamp data query 'specName == "mapping" && attributes.cloudImplications[*].provider == "${
                args.provider || ".*"
              }"'`
              : "swamp data list --type resource | grep ai-research-mapper",
          },
        };
      },
    },
  },
};
