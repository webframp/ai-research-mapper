# @webframp/ai-research-mapper

Fetch AI research papers from arXiv and map them to cloud infrastructure decisions.

## Usage

```bash
# Create an instance
swamp model create @webframp/ai-research-mapper my-mapper

# Map a paper by arXiv ID or URL
swamp model method run my-mapper map --input 'paperId=2502.05795'
swamp model method run my-mapper map --input 'paperId=https://arxiv.org/abs/2306.07915'

# Retrieve a previously mapped paper
swamp model method run my-mapper get --input 'arxivId=2502.05795'

# Query all mapped papers
swamp data query 'modelType == "@webframp/ai-research-mapper" && specName == "mapping"'
```

Example output from a mapped paper:

```json
{
  "arxivId": "2502.05795",
  "title": "The Curse of Depth in Large Language Models",
  "cloudImplications": [
    { "provider": "GCP", "priority": "medium", "action": "Model TPU cost-per-effective-layer metrics..." }
  ],
  "decisionCategory": ["training-cost", "gpu-selection", "model-architecture"]
}
```

## How It Works

1. Accept an arXiv paper ID or URL
2. Fetch metadata (title, authors, abstract, date) from arXiv abstract HTML page
3. Analyze content with keyword-based tagging to identify relevance to: training cost, inference cost, model architecture, GPU selection, fine-tuning, multimodal, deployment strategy, and security
4. Produce a structured mapping with per-provider implications (AWS, Azure, GCP, generic), each with priority rating and concrete action

## What You Get

Each mapped paper produces two resources:

- **paper/{arxivId}** — Raw metadata from arXiv
- **mapping/mapping-{arxivId}** — Structured infrastructure analysis with:
  - Per-provider implications with priority (high/medium/low)
  - Relevant cloud services list
  - Decision categories (training-cost, gpu-selection, model-architecture, etc.)
  - Human-readable summary

## Decision Categories

| Category | Coverage |
|----------|----------|
| `training-cost` | GPU hours, training efficiency, compute budget |
| `inference-cost` | Per-token cost, latency optimization |
| `model-architecture` | Normalization, attention, transformer design |
| `deployment-strategy` | Serving, scaling, K8s, serverless |
| `gpu-selection` | H100/H200/B200/Trainium/TPU comparison |
| `fine-tuning` | LoRA, SFT, adapter techniques |
| `multimodal` | Vision, audio, text-image models |
| `security` | Guardrails, prompt injection, compliance |
| `normalization` | LayerNorm, Pre-LN, Post-LN, scaling |
| `scaling-law` | Model scaling, data scaling relationships |

## Requirements

- swamp CLI
- Internet access to arxiv.org
