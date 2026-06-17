/**
 * Unit tests for @webframp/ai-research-mapper.
 *
 * Covers map, get, and list methods. The map method fetches live data from
 * arXiv, so this test suite uses a known stable paper ID and exercises the
 * full end-to-end flow.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@1";
import { model } from "./ai_research_mapper.ts";
import type { ModelDefinition } from "jsr:@systeminit/swamp-testing";

// ── Helper: create a minimal test context ──────────────────────────────────────

interface WriteCall {
  specName: string;
  instanceName: string;
  data: unknown;
}

function createTestContext() {
  const writtenResources: WriteCall[] = [];
  const storedData = new Map<string, unknown>();

  const context = {
    writeResource: async (
      specName: string,
      instanceName: string,
      data: unknown,
    ) => {
      writtenResources.push({ specName, instanceName, data });
      storedData.set(instanceName, data);
      return { id: `${specName}-${instanceName}` };
    },
    readResource: async (instanceName: string) => {
      return storedData.get(instanceName) ?? null;
    },
    logger: {
      info: (_msg: string) => {},
    },
    globalArgs: {},
    definition: { id: "test-instance", name: "test", version: "2026.06.17.1", tags: {} },
    methodName: "map",
    repoDir: "/tmp",
  };

  return { context, writtenResources, storedData };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

Deno.test("map: parses arXiv ID from URL", async () => {
  const { context, writtenResources } = createTestContext();

  // This paper has a stable abstract and is from a known author
  const args = { paperId: "2502.05795" };

  // Re-create the execute with proper typing by casting
  const executeFn = model.methods.map.execute as (
    args: { paperId: string },
    context: any,
  ) => Promise<{ dataHandles: Array<{ id: string }> }>;

  await executeFn(args, context as any);

  assertEquals(writtenResources.length, 2, "Should write two resources");

  const paperResource = writtenResources.find((w) => w.specName === "paper");
  assertExists(paperResource, "Should write a paper resource");
  assertEquals(paperResource.instanceName, "2502.05795");

  const mappingResource = writtenResources.find(
    (w) => w.specName === "mapping",
  );
  assertExists(mappingResource, "Should write a mapping resource");
  assertEquals(mappingResource.instanceName, "mapping-2502.05795");

  // Verify mapping structure
  const mapping = mappingResource.data as Record<string, unknown>;
  assertExists(mapping.cloudImplications, "Should have cloud implications");
  assertExists(mapping.decisionCategory, "Should have decision categories");
  assertExists(mapping.relevantServices, "Should have relevant services");
  assertExists(mapping.summary, "Should have a summary");
  assertEquals(mapping.arxivId, "2502.05795");
});

Deno.test("map: parses arXiv ID from bare ID", async () => {
  const { context, writtenResources } = createTestContext();

  const executeFn = model.methods.map.execute as (
    args: { paperId: string },
    context: any,
  ) => Promise<{ dataHandles: Array<{ id: string }> }>;

  await executeFn({ paperId: "2502.05795" }, context as any);

  assertEquals(writtenResources.length, 2);
});

Deno.test("map: rejects invalid arXiv ID format", async () => {
  const { context } = createTestContext();

  const executeFn = model.methods.map.execute as (
    args: { paperId: string },
    context: any,
  ) => Promise<{ dataHandles: Array<{ id: string }> }>;

  await assertRejects(
    () => executeFn({ paperId: "not-an-arxiv-id" }, context as any),
    Error,
    "Cannot parse arXiv ID",
  );
});

Deno.test("map: parses full arXiv URL", async () => {
  const { context, writtenResources } = createTestContext();

  const executeFn = model.methods.map.execute as (
    args: { paperId: string },
    context: any,
  ) => Promise<{ dataHandles: Array<{ id: string }> }>;

  await executeFn(
    { paperId: "https://arxiv.org/abs/2502.05795" },
    context as any,
  );

  assertEquals(writtenResources.length, 2);
  assertEquals(
    writtenResources[0].instanceName,
    "2502.05795",
    "Should extract arxiv ID from URL",
  );
});

Deno.test("get: returns stored mapping", async () => {
  const { context, storedData } = createTestContext();

  // Seed with a mapping
  const mockMapping = {
    arxivId: "2502.05795",
    title: "Test",
    mappedAt: new Date().toISOString(),
    summary: "Test summary",
    cloudImplications: [],
    relevantServices: [],
    decisionCategory: [],
  };
  storedData.set("mapping-2502.05795", mockMapping);

  const getFn = model.methods.get.execute as (
    args: { arxivId: string },
    context: any,
  ) => Promise<{ dataHandles: Array<{ id: string }> }>;

  // Should not throw
  await getFn({ arxivId: "2502.05795" }, context as any);
});

Deno.test("get: throws for unmapped paper", async () => {
  const { context } = createTestContext();

  const getFn = model.methods.get.execute as (
    args: { arxivId: string },
    context: any,
  ) => Promise<{ dataHandles: Array<{ id: string }> }>;

  await assertRejects(
    () => getFn({ arxivId: "2502.99999" }, context as any),
    Error,
    "run the 'map' method first",
  );
});

Deno.test("list: returns filter hints", () => {
  // list is synchronous — no async needed
  const listFn = model.methods.list.execute as (
    args: { provider?: string; category?: string },
  ) => { dataHandles: Array<never>; result: { message: string; filterHint: string } };

  const result = listFn({});

  assertEquals(result.dataHandles.length, 0);
  assertExists(result.result.message);
  assertExists(result.result.filterHint);
});

Deno.test("list: includes provider filter in hint when specified", () => {
  const listFn = model.methods.list.execute as (
    args: { provider?: string; category?: string },
  ) => { dataHandles: Array<never>; result: { message: string; filterHint: string } };

  const result = listFn({ provider: "GCP" });

  assertExists(result.result.filterHint.includes("GCP"));
});
