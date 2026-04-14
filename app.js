const postsDiv = document.getElementById("posts");
const selectedPostBox = document.getElementById("selectedPost");
const generatedImage = document.getElementById("generatedImage");
const imageStatus = document.getElementById("imageStatus");

const intakeStatus = document.getElementById("intakeStatus");
const ownerKbStatus = document.getElementById("ownerKbStatus");
const sourceChangePrompt = document.getElementById("sourceChangePrompt");
const profilePrompt = document.getElementById("profilePrompt");
const feelingPrompt = document.getElementById("feelingPrompt");
const generatePrompt = document.getElementById("generatePrompt");
const postsPrompt = document.getElementById("postsPrompt");

let initialProfile = null;
let voiceProfile = null;

let currentQuickType = "";
let currentCategory = "";
let selectedPost = "";
let selectedFeeling = "";
let profileBuilt = false;
let sourceChangedSinceBuild = false;
let lastWeakVoice = false;

const QUICK_TYPES = {
  Business: {
    category: "Product in Real Life",
    idea: "business",
  },
  Family: {
    category: "Small Moment Real Value",
    idea: "family",
  },
  Educational: {
    category: "Standards and Care",
    idea: "educational",
  },
  Community: {
    category: "Quiet Value",
    idea: "community",
  },
  Personal: {
    category: "Founder Reflection",
    idea: "personal",
  },
  "Something Real": {
    category: "Something Real",
    idea: "something real",
  },
};

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearOutputs() {
  postsDiv.innerHTML = "";
  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  selectedPost = "";
  postsPrompt.innerText = "";
}

function setInitialGuidance() {
  profilePrompt.innerText =
    "Build the profile first. If the voice source comes back thin, paste more owner writing and rebuild.";
  feelingPrompt.innerText =
    "Choose a feeling before you generate so the post matches where you are right now.";
  generatePrompt.innerText =
    "After feeling is set, choose the type of post you want.";
}

function updateSourceChangePrompt() {
  if (profileBuilt && sourceChangedSinceBuild) {
    sourceChangePrompt.innerText =
      "New source text added. Rebuild profile to fully apply it.";
  } else {
    sourceChangePrompt.innerText = "";
  }
}

function markSourceChanged() {
  if (!profileBuilt) return;
  sourceChangedSinceBuild = true;
  updateSourceChangePrompt();
}

function setupSourceWatchers() {
  ["businessUrl", "pastedSourceText", "manualBusinessContext"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", markSourceChanged);
  });
}

function setupFeelingButtons() {
  const buttons = document.querySelectorAll(".feeling-btn");
  const customFeelingInput = document.getElementById("customFeeling");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((btn) => {
        btn.style.background = "";
        btn.style.color = "";
        btn.style.borderColor = "";
      });

      button.style.background = "#1a73e8";
      button.style.color = "white";
      button.style.borderColor = "#1a73e8";

      selectedFeeling = button.dataset.feeling || "";
      customFeelingInput.value = "";
      feelingPrompt.innerText = `Feeling set: ${selectedFeeling}. Now choose the type of post you want.`;
      scrollToSection("section-generate");
    });
  });

  customFeelingInput.addEventListener("input", () => {
    if (customFeelingInput.value.trim()) {
      buttons.forEach((btn) => {
        btn.style.background = "";
        btn.style.color = "";
        btn.style.borderColor = "";
      });
      selectedFeeling = "";
      feelingPrompt.innerText =
        "Custom feeling added. Now choose the type of post you want.";
    } else if (!getFeelingInput()) {
      feelingPrompt.innerText =
        "Choose a feeling before you generate so the post matches where you are right now.";
    }
  });
}

function getFeelingInput() {
  const customFeeling = document.getElementById("customFeeling").value.trim();
  return customFeeling || selectedFeeling || "";
}

function getCurrentBusinessName() {
  return (
    initialProfile?.businessProfile?.name ||
    document.getElementById("businessName").value.trim() ||
    "Your Brand"
  );
}

function getCurrentBusinessSummary() {
  return (
    initialProfile?.businessProfile?.summary ||
    document.getElementById("businessSummary").value.trim() ||
    ""
  );
}

async function buildInitialProfile() {
  const mode = document.getElementById("generationMode").value;
  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();
  const manualBusinessContext = document.getElementById("manualBusinessContext").value.trim();

  clearOutputs();
  ownerKbStatus.innerText = "";
  postsPrompt.innerText = "";

  if (!businessUrl && !pastedSourceText && !manualBusinessContext) {
    intakeStatus.innerText = "Please add at least one source.";
    return;
  }

  intakeStatus.innerText = "Building profile...";

  try {
    const res = await fetch("/build-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
        businessUrl,
        pastedSourceText,
        manualBusinessContext,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /build-profile:", text);
      intakeStatus.innerText =
        "Profile build failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = data.error || "Profile build failed.";
      return;
    }

    initialProfile = data.profile || null;
    voiceProfile = data.profile?.founderVoice || null;
    profileBuilt = true;
    sourceChangedSinceBuild = false;
    updateSourceChangePrompt();

    document.getElementById("businessName").value =
      data.profile?.businessProfile?.name || "";

    document.getElementById("businessSummary").value =
      data.profile?.businessProfile?.summary || "";

    document.getElementById("voiceInput").value =
      data.profile?.sourceProfile?.voiceSourceText || "";

    lastWeakVoice = Boolean(data.profile?.sourceProfile?.weakVoiceSource);
    const kbMeta = data.profile?.ownerKbMeta || {};

    intakeStatus.innerText = lastWeakVoice
      ? "Profile ready. Voice source is thin."
      : `Profile ready (${data.profile?.sourceProfile?.voiceSourceLane || "unknown"} voice).`;

    if (lastWeakVoice) {
      profilePrompt.innerText =
        "Voice source looks thin. Paste more owner writing and rebuild profile for stronger results.";
    } else {
      profilePrompt.innerText =
        "Profile looks usable. Choose how you're feeling right now, then choose the type of post you want.";
    }

    if (kbMeta.entryCount > 0) {
      ownerKbStatus.innerText = `Owner KB active — ${kbMeta.entryCount} saved choice${
        kbMeta.entryCount === 1 ? "" : "s"
      } for this business.`;
    } else {
      ownerKbStatus.innerText =
        "Owner KB active — no saved choices yet. It will start learning when you choose posts.";
    }

    feelingPrompt.innerText =
      "Choose a feeling before you generate so the post matches where you are right now.";
    generatePrompt.innerText =
      "After feeling is set, choose the type of post you want.";

    scrollToSection("step2");
    setTimeout(() => scrollToSection("section-generate"), 350);
  } catch (error) {
    console.error(error);
    intakeStatus.innerText = "Error: " + error.message;
  }
}

async function quickGenerate(type) {
  if (!initialProfile) {
    alert("Build profile first.");
    return;
  }

  if (sourceChangedSinceBuild) {
    alert(
      "New source text was added after the last profile build. Rebuild profile to fully apply it."
    );
    return;
  }

  const config = QUICK_TYPES[type];
  if (!config) {
    alert("Unknown quick type.");
    return;
  }

  const ownerFeeling = getFeelingInput();
  if (!ownerFeeling) {
    alert("Choose how you're feeling right now first, or type your own.");
    return;
  }

  currentQuickType = type;
  currentCategory = config.category;
  selectedPost = "";

  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  postsDiv.innerHTML = "Generating posts...";
  postsPrompt.innerText = `Generating ${type} posts with feeling: ${ownerFeeling}.`;

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "hybrid",
        idea: config.idea,
        quickType: type,
        ownerNudge: ownerFeeling,
        category: config.category,
        businessName: getCurrentBusinessName(),
        businessSummary: getCurrentBusinessSummary(),
        manualVoiceInput: document.getElementById("voiceInput").value.trim(),
        voiceProfile,
        initialProfile,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /generate:", text);
      postsDiv.innerHTML = "Generate failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      postsDiv.innerHTML = "Error: " + (data.error || "Generate failed.");
      return;
    }

    if (!data.text) {
      postsDiv.innerHTML = "No posts returned.";
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);
    renderPostChoices(posts, type, ownerFeeling);
    scrollToSection("section-posts");
  } catch (error) {
    console.error(error);
    postsDiv.innerHTML = "Error: " + error.message;
  }
}

async function saveOwnerChoice({ chosenPost, ownerFeeling }) {
  try {
    const res = await fetch("/save-owner-choice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessName: getCurrentBusinessName(),
        businessSummary: getCurrentBusinessSummary(),
        quickType: currentQuickType,
        category: currentCategory,
        ownerFeeling: ownerFeeling || "",
        chosenPost,
        voiceSourceText: document.getElementById("voiceInput").value.trim(),
        ownerWritingSample: document.getElementById("pastedSourceText").value.trim(),
        manualBusinessContext: document.getElementById("manualBusinessContext").value.trim(),
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /save-owner-choice:", text);
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      console.error("Owner KB save failed:", data.error || "Unknown error");
    }
  } catch (error) {
    console.error("Owner KB save failed:", error);
  }
}

function renderPostChoices(posts, typeLabel, ownerFeeling) {
  postsDiv.innerHTML = "";
  postsPrompt.innerText =
    "Choose one of the 3 posts. Your choice will update Owner KB and generate the image.";

  const intro = document.createElement("div");
  intro.style.marginBottom = "12px";
  intro.style.fontWeight = "600";
  intro.innerText = `${typeLabel} posts — feeling: ${ownerFeeling} — choose one to generate its image.`;
  postsDiv.appendChild(intro);

  posts.forEach((post) => {
    const card = document.createElement("div");
    card.className = "post-choice-card";

    const postText = document.createElement("div");
    postText.innerText = post;
    card.appendChild(postText);

    const counter = document.createElement("div");
    counter.style.fontSize = "12px";
    counter.style.color = "#666";
    counter.style.marginTop = "8px";
    counter.innerText = `Characters: ${post.length}`;
    card.appendChild(counter);

    const helper = document.createElement("div");
    helper.style.fontSize = "12px";
    helper.style.color = "#444";
    helper.style.marginTop = "8px";
    helper.innerText = "Click to choose this post and generate its image.";
    card.appendChild(helper);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.innerText = "Copy Post";
    copyBtn.style.marginTop = "10px";

    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(post);
        copyBtn.innerText = "Copied";
        setTimeout(() => {
          copyBtn.innerText = "Copy Post";
        }, 1200);
      } catch (err) {
        console.error("Copy failed:", err);
        copyBtn.innerText = "Copy failed";
        setTimeout(() => {
          copyBtn.innerText = "Copy Post";
        }, 1200);
      }
    };

    card.appendChild(copyBtn);

    card.onclick = async () => {
      document.querySelectorAll(".post-choice-card").forEach((el) => {
        el.style.background = "white";
        el.style.border = "1px solid #d7e0eb";
      });

      card.style.background = "#e8f0fe";
      card.style.border = "1px solid #8ab4f8";

      selectedPost = post;
      selectedPostBox.innerText = post;
      generatedImage.style.display = "none";
      generatedImage.src = "";
      imageStatus.innerText = "Saving choice and generating image...";

      await saveOwnerChoice({
        chosenPost: post,
        ownerFeeling,
      });

      const imagePrompt = buildImagePrompt({
        post,
        quickType: currentQuickType,
        category: currentCategory,
        ownerFeeling,
        initialProfile,
      });

      try {
        const imgRes = await fetch("/generate-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imagePrompt,
          }),
        });

        const contentType = imgRes.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await imgRes.text();
          console.error("Non-JSON response from /generate-image:", text);
          imageStatus.innerText =
            "Image generation failed: server returned HTML instead of JSON.";
          return;
        }

        const imgData = await imgRes.json();

        if (!imgRes.ok) {
          imageStatus.innerText =
            "Image generation failed: " + (imgData.error || "Unknown error.");
          return;
        }

        if (!imgData.imageUrl) {
          imageStatus.innerText = "Image generation failed: No image returned.";
          return;
        }

        generatedImage.src = imgData.imageUrl;
        generatedImage.style.display = "block";
        imageStatus.innerText = "Post ready. This sounds like you today.";
        ownerKbStatus.innerText = "Owner KB updated from your latest chosen post.";

        scrollToSection("section-output");
      } catch (error) {
        console.error(error);
        imageStatus.innerText = "Image generation failed: " + error.message;
      }
    };

    postsDiv.appendChild(card);
  });
}

function stripPostHashtags(text = "") {
  return String(text).replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();
}

function extractQuotedSnippets(text = "") {
  const matches = [...String(text).matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  return matches.filter(Boolean);
}

function detectLocationCue(text = "") {
  const locations = [
    "Kyoto",
    "Uji",
    "Japan",
    "Macarthur",
    "Sydney",
    "Melbourne",
    "Brisbane",
    "Perth",
    "Adelaide",
    "Auckland",
  ];

  const lower = String(text).toLowerCase();
  const found = locations.find((loc) => lower.includes(loc.toLowerCase()));
  return found || "";
}

function detectRelationshipCue(text = "") {
  const lower = String(text).toLowerCase();

  if (lower.includes("my wife")) return "wife";
  if (lower.includes("my husband")) return "husband";
  if (lower.includes("my son")) return "son";
  if (lower.includes("my daughter")) return "daughter";
  if (lower.includes("my family")) return "family";
  if (lower.includes("my mum")) return "mum";
  if (lower.includes("my mom")) return "mom";
  if (lower.includes("my dad")) return "dad";

  return "";
}

function detectMemoryCue(text = "") {
  const lower = String(text).toLowerCase();

  if (lower.includes("i remember")) return "memory";
  if (lower.includes("the first time")) return "first_time";
  if (lower.includes("last week")) return "last_week";
  if (lower.includes("this morning")) return "this_morning";
  if (lower.includes("late afternoon")) return "late_afternoon";
  if (lower.includes("on weekends")) return "weekend";
  if (lower.includes("watching her")) return "observed_moment";

  return "";
}

function detectOriginCue(text = "") {
  const lower = String(text).toLowerCase();

  if (lower.includes("farm")) return "farm";
  if (lower.includes("harvest")) return "harvest";
  if (lower.includes("shade") || lower.includes("shading")) return "shaded cultivation";
  if (lower.includes("uji")) return "traditional tea region";
  if (lower.includes("kyoto")) return "japanese origin";
  if (lower.includes("tradition")) return "tradition";
  if (lower.includes("ancient")) return "heritage";
  if (lower.includes("care behind")) return "craft";
  if (lower.includes("whisk")) return "preparation";

  return "";
}

function buildStoryPriority({ post, quickType, category, businessName }) {
  const clean = stripPostHashtags(post);
  const quotedSnippets = extractQuotedSnippets(clean);
  const quotedPrimary = quotedSnippets[0] || clean;

  const locationCue = detectLocationCue(clean);
  const relationshipCue = detectRelationshipCue(clean);
  const memoryCue = detectMemoryCue(clean);
  const originCue = detectOriginCue(clean);

  const storyLines = [];

  if (memoryCue === "first_time") {
    storyLines.push(
      "- Panel 1 should show the very first discovery moment from the post, not a generic lifestyle shot."
    );
  } else if (memoryCue === "memory") {
    storyLines.push(
      "- Panel 1 should feel like a remembered real-life moment from the post, as if the scene actually happened."
    );
  } else if (memoryCue === "late_afternoon") {
    storyLines.push(
      "- Include a late-afternoon work atmosphere if it fits the post."
    );
  } else {
    storyLines.push(
      "- Panel 1 should show the clearest real-world moment implied by the post."
    );
  }

  if (relationshipCue) {
    storyLines.push(
      `- Because the post mentions the owner's ${relationshipCue}, at least one panel must include that relational moment or connection.`
    );
  }

  if (locationCue) {
    storyLines.push(
      `- Because the post mentions ${locationCue}, at least one panel should visually reflect that location or its atmosphere in a believable way.`
    );
  }

  if (originCue) {
    storyLines.push(
      `- Include one panel that shows the origin/craft side of the story: ${originCue}.`
    );
  }

  storyLines.push(
    "- Do not jump straight to generic product marketing imagery. Start with the human story in the post, then widen outward."
  );
  storyLines.push(
    "- Make the 4 panels feel like one connected narrative, not 4 random brand photos."
  );
  storyLines.push(
    "- If the post contains a memory, discovery, or turning point, make that the emotional anchor of the collage."
  );

  const narrativeSequence = `
NARRATIVE SEQUENCE FOR THE 4 PANELS:
1. Human story moment from the post
2. Preparation / work / hands-on action related to the post
3. Origin / source / process / environment behind the thing
4. Wider meaning or lived result that connects back to the post
`.trim();

  const postAnchor = `
POST STORY ANCHOR:
- Business: ${businessName}
- Quick type: ${quickType}
- Internal frame: ${category}
- Use this sentence as the emotional source: "${quotedPrimary}"
`.trim();

  return `${postAnchor}

${narrativeSequence}

STORY-SPECIFIC VISUAL RULES:
${storyLines.join("\n")}`;
}

function buildImagePrompt({ post, quickType, category, ownerFeeling, initialProfile }) {
  const cleanedPost = stripPostHashtags(post);

  const businessName =
    initialProfile?.businessProfile?.name ||
    document.getElementById("businessName").value.trim() ||
    "the business";

  const businessSummary =
    initialProfile?.businessProfile?.summary ||
    document.getElementById("businessSummary").value.trim() ||
    "a real business";

  const audience =
    (initialProfile?.brandProductTruth?.audience || []).join(", ") || "not specified";

  const offers =
    (initialProfile?.brandProductTruth?.offers || []).join(", ") || "not specified";

  const visualDirections =
    (initialProfile?.visualProfile?.visualDirections || []).join(", ") ||
    "grounded, realistic, documentary";

  const storyPriority = buildStoryPriority({
    post: cleanedPost,
    quickType,
    category,
    businessName,
  });

  return `
Create a realistic 4-panel image collage that matches this post exactly and tells the same story.

POST TO VISUALIZE:
"${cleanedPost}"

${storyPriority}

CURRENT OWNER FEELING:
${ownerFeeling || "not specified"}

BUSINESS CONTEXT:
- Business name: ${businessName}
- Business summary: ${businessSummary}
- Audience: ${audience}
- Offers/services: ${offers}
- Visual direction hints: ${visualDirections}

GLOBAL RULES:
- documentary realism
- grounded and believable
- modern real-life business context
- natural lighting
- no fantasy
- no stock-photo feel
- each panel must show a different but related real-world moment
- each panel must contain distinct people or a distinct group
- no duplicate people across panels unless the post clearly requires a recurring main person
- if the post strongly implies one recurring founder or one recurring personal memory, it is allowed to keep that same person across some panels
- otherwise avoid visual cloning of the same subject across the collage
- show realistic people, places, tasks, interactions, tools, workflow, ingredients, craft, or environments relevant to the post
- if a specific place is mentioned in the post, reflect it visually
- if a specific relationship is mentioned in the post, reflect it visually
- if a process, craft, farm, workshop, source region, or origin story is mentioned, reflect it visually
- the collage should feel like visual proof of the post, not generic inspiration
- plain unbranded clothing only
- no logos
- no text
- no symbols
- no fake brand marks
- no lettering on clothing
- no pseudo-branding
- no invented company names on signage, vehicles, garments, packaging, or walls
- keep the whole collage truthful to the business and the post
`.trim();
}

setupFeelingButtons();
setupSourceWatchers();
setInitialGuidance();