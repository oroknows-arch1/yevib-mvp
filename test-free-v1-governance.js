const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.YEVIB_TEST_BASE_URL || "http://localhost:3000";
const TEST_SITES_PATH = path.join(__dirname, "free-v1-test-sites.json");

function readTestSites() {
  const raw = fs.readFileSync(TEST_SITES_PATH, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.sites)) {
    throw new Error("free-v1-test-sites.json must contain a sites array.");
  }

  return parsed.sites;
}

function includesAll(actual = [], expected = []) {
  return expected.every((item) => actual.includes(item));
}

function buildDebugInput(site) {
  const isMarketplace =
    site.category === "trade_marketplace_directory" ||
    site.category === "service_marketplace_directory";

  if (isMarketplace) {
    return {
      imagePrompt:
        "Create a documentary-realistic visual direction for a trade marketplace/classifieds platform that helps customers find, compare, and connect with reliable tradies. The business is the platform, not an individual tradie doing the work.",
      discoveryProfile: {
        businessSummary:
          "A trade marketplace and classifieds directory that connects customers with tradies, helps people find providers faster, compare options, post jobs, and solve the problem of finding reliable trade help.",
        visualIdentity: {
          tone: "grounded, real, business-appropriate",
          palette: "natural business-appropriate colours",
          environment: "real working environments",
          brandingStyle: "unbranded, practical, context-led",
        },
        locationContext: {
          environmentType: "website marketplace, customer matching, service directory, and local trade discovery context",
        },
      },
    };
  }

  if (site.category.includes("laundry")) {
    return {
      imagePrompt:
        "Create a documentary-realistic visual direction for a laundry and dry-cleaning service. The image must stay in a laundry, garments, pickup, delivery, cleaning, or customer-service environment, not a construction site.",
      discoveryProfile: {
        businessSummary:
          "A laundry and dry-cleaning service helping customers with washing, garments, pickup, delivery, and practical clothing-care needs.",
        visualIdentity: {
          tone: "grounded, real, business-appropriate",
          palette: "natural business-appropriate colours",
          environment: "laundry, garment care, cleaning service, pickup and delivery context",
          brandingStyle: "unbranded, practical, context-led",
        },
        locationContext: {
          environmentType: "laundry or garment-care service environment",
        },
      },
    };
  }

  return {
    imagePrompt:
      "Create a documentary-realistic visual direction for this small business based on its category and public business identity.",
    discoveryProfile: {
      businessSummary: `${site.expectedBusinessIdentity}. ${site.testPurpose}`,
      visualIdentity: {
        tone: "grounded, real, business-appropriate",
        palette: "natural business-appropriate colours",
        environment: "real business environment",
        brandingStyle: "unbranded, practical, context-led",
      },
      locationContext: {
        environmentType: "real business environment",
      },
    },
  };
}

function getExpectations(site) {
  const baseMustNotShow = [
    "invented logos",
    "invented business names",
    "fake signage",
    "fake uniforms",
    "readable text",
  ];

  if (
    site.category === "trade_marketplace_directory" ||
    site.category === "service_marketplace_directory"
  ) {
    return {
      businessArchetype: "trade_marketplace_directory",
      mustShowIncludes: [
        "trade marketplace, directory, or classifieds platform context",
        "customer search, comparison, booking, quote, or matching moment",
        "the business represented as the platform, not as an individual tradie",
      ],
      mustNotShowIncludes: [
        ...baseMustNotShow,
        "individual tradie business viewpoint",
        "pretending the platform personally performs trade work",
      ],
    };
  }

  if (site.category.includes("laundry")) {
    return {
      businessArchetype: "laundry_service",
      mustShowIncludes: [
        "laundry, garment-care, pickup, delivery, or cleaning-service context",
        "physically plausible laundry or garment-care action",
        "clean text-free documentary realism",
      ],
      mustNotShowIncludes: [
        ...baseMustNotShow,
        "construction-site environment",
        "tradie worksite environment",
        "pouring liquid into a non-serviceable machine area",
      ],
    };
  }

  return {
    businessArchetype: site.category,
    mustShowIncludes: [],
    mustNotShowIncludes: baseMustNotShow,
  };
}

async function callDebugDecision(input) {
  const response = await fetch(`${BASE_URL}/debug-image-decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data.imageDecisionPacket || {};
}

async function runSite(site) {
  const expectations = getExpectations(site);
  const input = buildDebugInput(site);
  const packet = await callDebugDecision(input);

  const failures = [];

  if (packet.businessArchetype !== expectations.businessArchetype) {
    failures.push(
      `businessArchetype expected ${expectations.businessArchetype}, got ${packet.businessArchetype}`
    );
  }

  if (!Array.isArray(packet.mustShow) || packet.mustShow.length === 0) {
    failures.push("mustShow is empty");
  }

  if (
    expectations.mustShowIncludes.length > 0 &&
    !includesAll(packet.mustShow, expectations.mustShowIncludes)
  ) {
    failures.push("mustShow is missing required controls");
  }

  if (!includesAll(packet.mustNotShow, expectations.mustNotShowIncludes)) {
    failures.push("mustNotShow is missing required anti-invention controls");
  }

  return {
    id: site.id,
    category: site.category,
    passed: failures.length === 0,
    reason: failures.join("; "),
    packet,
  };
}

async function main() {
  console.log("YEVIB Free V1 governance regression");
  console.log(`Testing against: ${BASE_URL}`);

  const sites = readTestSites();

  const prioritySites = sites.filter((site) =>
    [
      "trade_marketplace_directory",
      "service_marketplace_directory",
      "laundry_local_service",
      "laundry_pickup_delivery_service",
    ].includes(site.category)
  );

  const results = [];

  for (const site of prioritySites) {
    try {
      const result = await runSite(site);
      results.push(result);

      if (result.passed) {
        console.log(`PASS ${result.id}`);
      } else {
        console.log(`FAIL ${result.id}: ${result.reason}`);
      }
    } catch (err) {
      results.push({
        id: site.id,
        category: site.category,
        passed: false,
        reason: err.message,
      });
      console.log(`FAIL ${site.id}: ${err.message}`);
    }
  }

  const failed = results.filter((result) => !result.passed);

  console.log("");
  console.log(
    JSON.stringify(
      {
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        failedIds: failed.map((result) => result.id),
      },
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Regression harness crashed:", err);
  process.exitCode = 1;
});
