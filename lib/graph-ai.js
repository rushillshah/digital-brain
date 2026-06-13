#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PRICE_TABLE = {
  "openai:gpt-5.4-mini": { input: 0.375, output: 2.25, source: "OpenAI pricing page, flex short-context estimate" },
  "anthropic:claude-sonnet-4-6": { input: 3, output: 15, source: "Anthropic Sonnet pricing" },
  "xai:grok-4.3": { input: 1.25, output: 2.5, source: "xAI Grok 4.3 pricing" },
};

const args = parseArgs(process.argv.slice(2));
if (!args.vault) usage();

const vault = path.resolve(args.vault);
const config = readConfig(vault);
const provider = normalizeProvider(args.provider || config.autoReplyProvider || "anthropic");
const model = args.model || defaultModelForProvider(provider);
const maxInputTokens = numberArg("max-input-tokens", 120000);
const outputTokens = numberArg("output-tokens", 6000);
const maxCharsPerFile = numberArg("max-chars-per-file", 12000);
const estimateOnly = !args.yes || Boolean(args.estimate);
const bundle = buildGraphBundle(vault, { maxInputTokens, maxCharsPerFile });
const pricing = pricingFor(provider, model);
const estimate = costEstimate(bundle.inputTokens, outputTokens, pricing);

printEstimate({ provider, model, bundle, outputTokens, pricing, estimate });

if (estimateOnly) {
  console.log("");
  console.log("Estimate only. Add --yes to run the one-time AI graph review.");
  process.exit(0);
}

const apiKey = apiKeyFor(provider, config);
if (!apiKey) {
  throw new Error(`${providerLabel(provider)} requires an API key for graph-ai. Set ${providerEnvHelp(provider)} or pass the matching --*-api-key flag.`);
}

const prompt = buildPrompt(bundle);
const review = await generateReview({ provider, model, apiKey, prompt, outputTokens });
writeReview(vault, { provider, model, bundle, outputTokens, pricing, estimate, review });

console.log("");
console.log(`AI graph review written: ${path.join(vault, "06 AI Memory", "AI Graph Review.md")}`);
console.log(`Graph index written: ${path.join(vault, "00 Home", "Graph Index.md")}`);

function buildGraphBundle(root, options) {
  const files = collectFiles(root)
    .map((file) => ({ file, rel: path.relative(root, file), text: safeRead(file) }))
    .filter((item) => item.text.trim())
    .map((item) => ({
      ...item,
      text: truncateMiddle(item.text, options.maxCharsPerFile),
      originalChars: item.text.length,
    }));
  const selected = [];
  let usedTokens = 0;
  for (const item of files) {
    const fileTokens = tokenEstimate(item.text) + tokenEstimate(item.rel) + 8;
    if (selected.length && usedTokens + fileTokens > options.maxInputTokens) continue;
    selected.push({ ...item, tokenEstimate: fileTokens });
    usedTokens += fileTokens;
  }
  return {
    files: selected,
    skippedFiles: files.length - selected.length,
    inputTokens: usedTokens + 1600,
    totalCandidateFiles: files.length,
    totalCandidateChars: files.reduce((sum, item) => sum + item.originalChars, 0),
  };
}

function collectFiles(root) {
  const includeRoots = [
    "00 Home",
    "01 Identity",
    "04 People",
    "06 AI Memory",
    path.join("08 Sources", "Analysis"),
    path.join("08 Sources", "Repositories"),
  ];
  const files = [];
  for (const relRoot of includeRoots) {
    const absRoot = path.join(root, relRoot);
    if (fs.existsSync(absRoot)) walk(absRoot, files);
  }
  return files
    .filter((file) => [".md", ".json"].includes(path.extname(file).toLowerCase()))
    .filter((file) => !shouldExclude(path.relative(root, file)))
    .sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, files);
    else if (entry.isFile()) files.push(abs);
  }
}

function shouldExclude(rel) {
  const parts = rel.split(path.sep);
  return parts.includes("Raw")
    || parts.includes("ChatsByMonth")
    || parts.includes("Outbound")
    || parts.includes(".sync-state")
    || parts.includes(".session");
}

function buildPrompt(bundle) {
  const fileBlocks = bundle.files.map((item) => `---FILE: ${item.rel}\n${item.text}`).join("\n\n");
  return `You are doing a one-time Digital Brain graph review for an Obsidian vault.

Goal:
- Improve the graph structure and relationship model.
- Prefer canonical people, useful indexes, and explicit uncertainty.
- Do not invent relationship roles. Say what needs manual confirmation.
- Do not expose raw private message content in the final notes.
- Keep generated notes concise enough to be useful in Obsidian.

Return Markdown with exactly these sections:
# AI Graph Review
## Clean Graph Index
## Canonical People And Aliases
## Relationship Corrections
## Notes To Merge Or Move
## Missing Manual Labels
## Safer AI Usage Rules
## Next One-Time Fixes

Vault bundle:
${fileBlocks}
`;
}

async function generateReview({ provider, model, apiKey, prompt, outputTokens }) {
  if (provider === "anthropic") {
    return generateAnthropic({ model, apiKey, prompt, outputTokens });
  }
  if (provider === "openai") {
    return generateResponsesApi({
      label: "OpenAI",
      url: "https://api.openai.com/v1/responses",
      model,
      apiKey,
      prompt,
      outputTokens,
    });
  }
  if (provider === "xai") {
    return generateResponsesApi({
      label: "xAI",
      url: "https://api.x.ai/v1/responses",
      model,
      apiKey,
      prompt,
      outputTokens,
    });
  }
  throw new Error(`graph-ai does not support provider "${provider}". Use openai, anthropic, xai, or xci.`);
}

async function generateResponsesApi({ label, url, model, apiKey, prompt, outputTokens }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: outputTokens,
      temperature: 0.15,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} graph review failed: ${response.status} ${summarize(text)}`);
  const body = JSON.parse(text);
  const out = extractResponsesText(body);
  if (!out) throw new Error(`${label} returned an empty graph review.`);
  return out;
}

async function generateAnthropic({ model, apiKey, prompt, outputTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: outputTokens,
      temperature: 0.15,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Anthropic graph review failed: ${response.status} ${summarize(text)}`);
  const body = JSON.parse(text);
  const out = (body.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
  if (!out) throw new Error("Anthropic returned an empty graph review.");
  return out;
}

function writeReview(root, data) {
  const generated = [
    `Generated: ${new Date().toISOString()}`,
    `Provider: ${providerLabel(data.provider)}`,
    `Model: ${data.model}`,
    `Estimated input tokens: ${data.bundle.inputTokens}`,
    `Estimated max output tokens: ${data.outputTokens}`,
    `Estimated cost: ${formatMoney(data.estimate.total)}`,
    "",
    "Generated one-time AI review. Treat relationship labels as provisional unless manually confirmed.",
    "",
    data.review.trim(),
    "",
  ].join("\n");
  writeFileAtomic(path.join(root, "06 AI Memory", "AI Graph Review.md"), generated);
  writeFileAtomic(path.join(root, "00 Home", "Graph Index.md"), graphIndex(data.review));
  writeFileAtomic(path.join(root, "08 Sources", "Analysis", "ai_graph_review_manifest.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    provider: data.provider,
    model: data.model,
    estimatedInputTokens: data.bundle.inputTokens,
    estimatedMaxOutputTokens: data.outputTokens,
    estimatedCostUsd: data.estimate.total,
    pricingPerMillionTokens: data.pricing,
    files: data.bundle.files.map((item) => ({ path: item.rel, tokenEstimate: item.tokenEstimate, originalChars: item.originalChars })),
    skippedFiles: data.bundle.skippedFiles,
  }, null, 2)}\n`);
}

function graphIndex(review) {
  const cleanIndex = section(review, "Clean Graph Index") || review.trim();
  return [
    "# Graph Index",
    "",
    "AI-reviewed graph entrypoint. Generated by `digital-brain graph-ai --yes`.",
    "",
    "Core notes:",
    "",
    "- [[How AI Should Use This Vault]]",
    "- [[What AI Should Remember]]",
    "- [[Person Context Index]]",
    "- [[Person Reply Context]]",
    "- [[AI Graph Review]]",
    "- [[Relationship Overrides]]",
    "",
    "## AI Suggested Structure",
    "",
    cleanIndex.trim(),
    "",
  ].join("\n");
}

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

function pricingFor(provider, model) {
  const inputOverride = numberOptional("input-cost-per-1m");
  const outputOverride = numberOptional("output-cost-per-1m");
  if (inputOverride !== null && outputOverride !== null) {
    return { input: inputOverride, output: outputOverride, source: "cli override" };
  }
  const normalized = normalizeProvider(provider);
  const key = `${normalized}:${model}`;
  const fallback = {
    openai: { input: 0.375, output: 2.25, source: "default OpenAI gpt-5.4-mini flex estimate" },
    anthropic: { input: 3, output: 15, source: "default Anthropic Sonnet estimate" },
    xai: { input: 1.25, output: 2.5, source: "default xAI Grok estimate" },
  };
  return PRICE_TABLE[key] || fallback[normalized] || { input: 0, output: 0, source: "unknown" };
}

function costEstimate(inputTokens, estimatedOutputTokens, pricing) {
  const input = (inputTokens / 1000000) * pricing.input;
  const output = (estimatedOutputTokens / 1000000) * pricing.output;
  return { input, output, total: input + output };
}

function printEstimate({ provider, model, bundle, outputTokens, pricing, estimate }) {
  console.log("AI graph review estimate");
  console.log(`  Vault: ${vault}`);
  console.log(`  Provider/model: ${providerLabel(provider)} / ${model}`);
  console.log(`  Files included: ${bundle.files.length}/${bundle.totalCandidateFiles}`);
  console.log(`  Files skipped by token cap: ${bundle.skippedFiles}`);
  console.log(`  Estimated input tokens: ${bundle.inputTokens}`);
  console.log(`  Estimated max output tokens: ${outputTokens}`);
  console.log(`  Pricing: input $${pricing.input}/1M, output $${pricing.output}/1M (${pricing.source})`);
  console.log(`  Estimated cost: ${formatMoney(estimate.total)} (${formatMoney(estimate.input)} input + ${formatMoney(estimate.output)} output)`);
  console.log("  Override prices with --input-cost-per-1m and --output-cost-per-1m if your model/provider rate differs.");
}

function apiKeyFor(provider, localConfig) {
  if (provider === "openai") return args["openai-api-key"] || process.env.OPENAI_API_KEY || localConfig.openaiApiKey || "";
  if (provider === "anthropic") return args["anthropic-api-key"] || process.env.ANTHROPIC_API_KEY || localConfig.anthropicApiKey || "";
  if (provider === "xai") return args["xai-api-key"] || args["xci-api-key"] || process.env.XAI_API_KEY || process.env.XCI_API_KEY || localConfig.xaiApiKey || localConfig.xciApiKey || "";
  return "";
}

function providerEnvHelp(provider) {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "xai") return "XAI_API_KEY or XCI_API_KEY";
  return "the provider API key";
}

function providerLabel(provider) {
  return provider === "xai" ? "xAI" : provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : provider;
}

function defaultModelForProvider(provider) {
  if (provider === "openai") return "gpt-5.4-mini";
  if (provider === "anthropic") return "claude-sonnet-4-6";
  if (provider === "xai") return "grok-4.3";
  return "claude-sonnet-4-6";
}

function extractResponsesText(body) {
  if (typeof body.output_text === "string") return body.output_text;
  const chunks = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function readConfig(root) {
  const file = path.join(root, "digital-brain.config.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

function truncateMiddle(value, maxChars) {
  if (value.length <= maxChars) return value;
  const keep = Math.floor((maxChars - 80) / 2);
  return `${value.slice(0, keep)}\n\n[... truncated ${value.length - keep * 2} chars ...]\n\n${value.slice(-keep)}`;
}

function tokenEstimate(value) {
  return Math.ceil(String(value || "").length / 4);
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function summarize(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 500);
}

function normalizeProvider(providerName) {
  return providerName === "xci" ? "xai" : providerName;
}

function numberArg(key, fallback) {
  const parsed = Number(args[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function numberOptional(key) {
  if (args[key] === undefined) return null;
  const parsed = Number(args[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key.includes("=")) {
      const [k, ...rest] = key.split("=");
      out[k] = rest.join("=");
    } else {
      const next = argv[i + 1];
      out[key] = !next || next.startsWith("--") ? true : argv[++i];
    }
  }
  return out;
}

function usage() {
  console.error("Usage: digital-brain graph-ai --vault <vault> [--provider openai|anthropic|xai|xci] [--yes]");
  process.exit(1);
}
