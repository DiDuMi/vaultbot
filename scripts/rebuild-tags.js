require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { createProjectPreflightContext } = require("./preflight-common.js");

const prisma = new PrismaClient();

const { projectCode } = createProjectPreflightContext();
const writeMode = process.argv.includes("--write");
const sampleLimit = (() => {
  const index = process.argv.indexOf("--sample");
  if (index === -1) {
    return 10;
  }
  const value = Number(process.argv[index + 1] || "10");
  if (!Number.isFinite(value) || value < 1) {
    return 10;
  }
  return Math.min(50, Math.trunc(value));
})();

const stripHtml = (value) => String(value || "").replace(/<[^>]*>/g, " ");

const normalizeTagName = (raw) => {
  const withoutHash = String(raw || "").trim().replace(/^#+/, "");
  if (!withoutHash) {
    return null;
  }
  const normalized = withoutHash.toLowerCase().slice(0, 32);
  if (!normalized) {
    return null;
  }
  if (Buffer.byteLength(normalized, "utf8") > 60) {
    return null;
  }
  return normalized;
};

const extractHashtags = (title, description) => {
  const plain = `${stripHtml(title)}\n${stripHtml(description)}`.replace(/\s+/g, " ").trim();
  if (!plain) {
    return [];
  }
  const names = new Set();
  for (const match of plain.matchAll(/#([\p{L}\p{N}_-]{1,32})/gu)) {
    const normalized = normalizeTagName(match[1] || "");
    if (!normalized) {
      continue;
    }
    names.add(normalized);
    if (names.size >= 30) {
      break;
    }
  }
  return Array.from(names);
};

const run = async () => {
  if (!projectCode) {
    throw new Error("Missing PROJECT_CODE (or legacy TENANT_CODE)");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { code: projectCode },
    select: { id: true, code: true, name: true }
  });
  if (!tenant) {
    throw new Error(`Project not found for PROJECT_CODE=${projectCode}`);
  }

  const assets = await prisma.asset.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      shareCode: true
    }
  });

  const currentTagCount = await prisma.tag.count({ where: { tenantId: tenant.id } });
  const currentAssetTagCount = await prisma.assetTag.count({ where: { tenantId: tenant.id } });

  const extractedByAsset = assets.map((asset) => ({
    asset,
    tags: extractHashtags(asset.title, asset.description)
  }));

  const assetsWithTags = extractedByAsset.filter((row) => row.tags.length > 0);
  const tagFrequency = new Map();
  for (const row of extractedByAsset) {
    for (const tag of row.tags) {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    }
  }

  const topTags = Array.from(tagFrequency.entries())
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, sampleLimit);

  console.log(`Project: ${tenant.code} (${tenant.name})`);
  console.log(`Assets: ${assets.length}`);
  console.log(`Current tags: ${currentTagCount}`);
  console.log(`Current asset-tag relations: ${currentAssetTagCount}`);
  console.log(`Assets with extractable hashtags: ${assetsWithTags.length}`);
  console.log(`Unique extractable hashtags: ${tagFrequency.size}`);
  console.log(`Mode: ${writeMode ? "WRITE" : "DRY_RUN"}`);

  if (topTags.length > 0) {
    console.log("--- Top Extractable Tags ---");
    for (const [name, count] of topTags) {
      console.log(`#${name}: ${count}`);
    }
  }

  if (assetsWithTags.length > 0) {
    console.log("--- Sample Assets With Tags ---");
    for (const row of assetsWithTags.slice(0, sampleLimit)) {
      const label = row.asset.shareCode ? `${row.asset.id} (${row.asset.shareCode})` : row.asset.id;
      console.log(`${label}: ${row.tags.map((tag) => `#${tag}`).join(" ")}`);
    }
  }

  if (!writeMode) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.assetTag.deleteMany({ where: { tenantId: tenant.id } });
    if (assetsWithTags.length === 0) {
      return;
    }
    for (const row of assetsWithTags) {
      const tagIds = [];
      for (const name of row.tags) {
        const tag = await tx.tag.upsert({
          where: { tenantId_name: { tenantId: tenant.id, name } },
          create: { tenantId: tenant.id, name },
          update: {}
        });
        tagIds.push(tag.id);
      }
      await tx.assetTag.createMany({
        data: tagIds.map((tagId) => ({ tenantId: tenant.id, assetId: row.asset.id, tagId })),
        skipDuplicates: true
      });
    }
  });

  const nextTagCount = await prisma.tag.count({ where: { tenantId: tenant.id } });
  const nextAssetTagCount = await prisma.assetTag.count({ where: { tenantId: tenant.id } });
  console.log("--- Rebuild Complete ---");
  console.log(`Tags: ${currentTagCount} -> ${nextTagCount}`);
  console.log(`AssetTag relations: ${currentAssetTagCount} -> ${nextAssetTagCount}`);
};

run()
  .catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
