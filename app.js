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
document.getElementById("step2").scrollIntoView({ behavior: "smooth" });

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

    scrollToSection("section-profile");
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

        document.getElementById("step5").scrollIntoView({ behavior: "smooth" });
        scrollToSection("section-output");
      } catch (error) {
        console.error(error);
        imageStatus.innerText = "Image generation failed: " + error.message;
      }
    };

    postsDiv.appendChild(card);
  });
}

function buildImagePrompt({ post, quickType, category, ownerFeeling, initialProfile }) {
  const cleanedPost = (post || "").replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();

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

  return `
Create a realistic 4-panel image collage that matches this post.

POST TO VISUALIZE:
"${cleanedPost}"

QUICK TYPE:
${quickType}

INTERNAL CONTENT FRAME:
${category}

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
- no duplicate people across panels
- no repeated faces across panels
- do not reuse the same person in multiple panels unless the user explicitly asked for one recurring founder
- avoid visual cloning of the same subject across the collage
- if a founder is not explicitly specified as recurring, assume different people in different panels
- show realistic people, places, tasks, interactions, tools, workflow, or environments relevant to the business
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