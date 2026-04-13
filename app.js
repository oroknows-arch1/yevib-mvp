const postsDiv = document.getElementById("posts");
const selectedPostBox = document.getElementById("selectedPost");
const generatedImage = document.getElementById("generatedImage");
const imageStatus = document.getElementById("imageStatus");

let initialProfile = null;
let voiceProfile = null;

let currentQuickType = "";
let currentCategory = "";
let selectedPost = "";
let selectedFeeling = "";

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

function clearOutputs() {
  postsDiv.innerHTML = "";
  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  selectedPost = "";
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
    }
  });
}

function getFeelingInput() {
  const customFeeling = document.getElementById("customFeeling").value.trim();
  return customFeeling || selectedFeeling || "";
}

async function buildInitialProfile() {
  const mode = document.getElementById("generationMode").value;
  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();
  const manualBusinessContext = document.getElementById("manualBusinessContext").value.trim();
  const intakeStatus = document.getElementById("intakeStatus");

  clearOutputs();

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
      intakeStatus.innerText = "Profile build failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = data.error || "Profile build failed.";
      return;
    }

    initialProfile = data.profile || null;
    voiceProfile = data.profile?.founderVoice || null;

    document.getElementById("businessName").value =
      data.profile?.businessProfile?.name || "";

    document.getElementById("businessSummary").value =
      data.profile?.businessProfile?.summary || "";

    document.getElementById("voiceInput").value =
      data.profile?.sourceProfile?.voiceSourceText || "";

    const weakVoice = data.profile?.sourceProfile?.weakVoiceSource;

    intakeStatus.innerText = weakVoice
      ? `Profile ready. Voice source is a bit thin — paste more owner writing for deeper results.`
      : `Profile ready (${data.profile?.sourceProfile?.voiceSourceLane || "unknown"} voice).`;
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

  const config = QUICK_TYPES[type];
  if (!config) {
    alert("Unknown quick type.");
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

  try {
    const businessName =
      initialProfile?.businessProfile?.name ||
      document.getElementById("businessName").value.trim() ||
      "Your Brand";

    const businessSummary =
      initialProfile?.businessProfile?.summary ||
      document.getElementById("businessSummary").value.trim() ||
      "";

    const ownerFeeling = getFeelingInput();

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
        businessName,
        businessSummary,
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
  } catch (error) {
    console.error(error);
    postsDiv.innerHTML = "Error: " + error.message;
  }
}

function renderPostChoices(posts, typeLabel, ownerFeeling) {
  postsDiv.innerHTML = "";

  const intro = document.createElement("div");
  intro.style.marginBottom = "12px";
  intro.style.fontWeight = "600";
  intro.innerText = ownerFeeling
    ? `${typeLabel} posts — feeling: ${ownerFeeling} — choose one to generate its image.`
    : `${typeLabel} posts — choose one to generate its image.`;
  postsDiv.appendChild(intro);

  posts.forEach((post) => {
    const card = document.createElement("div");
    card.className = "post-choice-card";
    card.style.border = "1px solid #ccc";
    card.style.padding = "12px";
    card.style.marginTop = "10px";
    card.style.cursor = "pointer";
    card.style.whiteSpace = "pre-wrap";
    card.style.background = "white";
    card.style.borderRadius = "10px";

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

    card.onclick = async () => {
      document.querySelectorAll(".post-choice-card").forEach((el) => {
        el.style.background = "white";
        el.style.border = "1px solid #ccc";
      });

      card.style.background = "#e8f0fe";
      card.style.border = "1px solid #8ab4f8";

      selectedPost = post;
      selectedPostBox.innerText = post;
      generatedImage.style.display = "none";
      generatedImage.src = "";
      imageStatus.innerText = "Generating image...";

      const imagePrompt = buildImagePrompt({
        post,
        quickType: currentQuickType,
        category: currentCategory,
        ownerFeeling: ownerFeeling || getFeelingInput(),
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
        imageStatus.innerText = "Image ready.";
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