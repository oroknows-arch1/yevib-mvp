const categorySelect = document.getElementById("category");
const weeklyPostsWrap = document.getElementById("weeklyPostsWrap");
const generateImageBtn = document.getElementById("generateImageBtn");
const imageStatus = document.getElementById("imageStatus");
const generatedImage = document.getElementById("generatedImage");
const selectedPostBox = document.getElementById("selectedPost");

let selectedPost = "";
let selectedCategory = "";
let selectedIdea = "";
let selectedWeeklyPosts = "";
let selectedImagePrompt = "";

let voiceProfile = null;
let initialProfile = null;

function toggleWeeklyPosts() {
  weeklyPostsWrap.style.display = "none";
}

categorySelect.addEventListener("change", toggleWeeklyPosts);
toggleWeeklyPosts();

async function buildInitialProfile() {
  const mode = document.getElementById("generationMode").value;
  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();
  const manualBusinessContext = document.getElementById("manualBusinessContext").value.trim();
  const intakeStatus = document.getElementById("intakeStatus");

  if (!businessUrl && !pastedSourceText && !manualBusinessContext) {
    intakeStatus.innerText = "Please add at least one source.";
    return;
  }

  intakeStatus.innerText = "Building initial profile...";

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

    if (data.error) {
      intakeStatus.innerText = "Profile build failed: " + data.error;
      return;
    }

    initialProfile = data.profile || null;
    voiceProfile = data.profile?.voiceProfile || null;

    document.getElementById("businessName").value =
      data.profile?.businessProfile?.name || "";

    document.getElementById("businessSummary").value =
      data.profile?.businessProfile?.summary || "";

    document.getElementById("voiceInput").value =
      data.profile?.sourceProfile?.voiceSourceText || "";

    document.getElementById("idea").value =
      data.profile?.contentProfile?.suggestedIdea || "";

    const suggestedCategory = data.profile?.contentProfile?.suggestedCategory;
    if (suggestedCategory) {
      const options = Array.from(categorySelect.options).map((o) => o.value);
      if (options.includes(suggestedCategory)) {
        categorySelect.value = suggestedCategory;
      }
    }

    document.getElementById("voiceResult").innerText = JSON.stringify(
      data.profile?.voiceProfile || {},
      null,
      2
    );

    intakeStatus.innerText =
      `Initial profile built. Dominant source: ${data.profile?.sourceProfile?.dominantSource || "unknown"}.`;
  } catch (error) {
    console.error(error);
    intakeStatus.innerText = "Error building profile: " + error.message;
  }
}

async function analyzeVoice() {
  const voiceInput = document.getElementById("voiceInput").value;
  const voiceResult = document.getElementById("voiceResult");

  if (!voiceInput.trim()) {
    voiceResult.innerText = "Please paste some text first.";
    return;
  }

  voiceResult.innerText = "Analyzing voice...";

  try {
    const res = await fetch("/analyze-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: voiceInput }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /analyze-voice:", text);
      voiceResult.innerText = "Voice analysis failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!data.result) {
      voiceResult.innerText =
        "Voice analysis failed: " + (data.error || "No result returned.");
      return;
    }

    voiceProfile = data.profile;
    voiceResult.innerText = data.result;
  } catch (error) {
    console.error(error);
    voiceResult.innerText = "Error analyzing voice: " + error.message;
  }
}

async function generatePosts() {
  const mode = document.getElementById("generationMode").value;
  const idea = document.getElementById("idea").value;
  const category = document.getElementById("category").value;
  const weeklyPosts = document.getElementById("weeklyPosts")?.value || "";

  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();
  const manualBusinessContext = document.getElementById("manualBusinessContext").value.trim();

  const businessName = document.getElementById("businessName").value.trim();
  const businessSummary = document.getElementById("businessSummary").value.trim();
  const manualVoiceInput = document.getElementById("voiceInput").value.trim();

  const postsDiv = document.getElementById("posts");
  postsDiv.innerHTML = "Loading...";

  selectedPost = "";
  selectedPostBox.innerText = "";
  generateImageBtn.style.display = "none";
  imageStatus.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  document.getElementById("imagePrompt").innerText = "";

  try {
   const res = await fetch("/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    mode,
    idea,
    category,
    weeklyPosts,
    businessUrl,
    pastedSourceText,
    manualBusinessContext,
    businessName,
    businessSummary,
    manualVoiceInput,
    voiceProfile,
    initialProfile,
  }),
});

const contentType = res.headers.get("content-type") || "";
if (!contentType.includes("application/json")) {
  const text = await res.text();
  console.error("Non-JSON response from /generate:", text);
  postsDiv.innerHTML = "Server error: /generate returned HTML instead of JSON.";
  return;
}

const data = await res.json();

if (!res.ok) {
  postsDiv.innerHTML = "Server error: " + (data.error || "Unknown generate error.");
  return;
}

if (!data.text) {
  postsDiv.innerHTML = "Server error: " + (data.error || "No posts returned.");
  return;
}

    const posts = data.text.split("\n\n\n").filter(Boolean);
    postsDiv.innerHTML = "";

    posts.forEach((post) => {
      const div = document.createElement("div");
      div.className = "post";
      div.style.border = "1px solid #ccc";
      div.style.padding = "12px";
      div.style.marginTop = "10px";
      div.style.cursor = "pointer";
      div.style.whiteSpace = "pre-wrap";
      div.style.background = "white";
      div.innerText = post;

      const counter = document.createElement("div");
      counter.style.fontSize = "12px";
      counter.style.color = "#666";
      counter.style.marginTop = "8px";
      counter.innerText = `Characters: ${post.length}`;
      div.appendChild(counter);

      div.onclick = () => {
        document.querySelectorAll(".post").forEach((p) => {
          p.style.background = "white";
        });

        div.style.background = "#e8f0fe";

        selectedPost = post;
        selectedCategory = category;
        selectedIdea = idea;
        selectedWeeklyPosts = weeklyPosts;

        selectedImagePrompt = buildImagePrompt({
          mode,
          post,
          category,
          idea,
          weeklyPosts,
          initialProfile,
          businessName,
          businessSummary,
          manualBusinessContext,
          manualImageNotes: document.getElementById("manualImageNotes").value.trim(),
        });

        selectedPostBox.innerText = post;
        document.getElementById("imagePrompt").innerText = selectedImagePrompt;

        generateImageBtn.style.display = "block";
        imageStatus.innerText = "";
        generatedImage.style.display = "none";
        generatedImage.src = "";
      };

      postsDiv.appendChild(div);
    });
  } catch (error) {
    console.error(error);
    postsDiv.innerHTML = "Error connecting to server: " + error.message;
  }
}

function buildImagePrompt({
  mode,
  post,
  category,
  idea,
  weeklyPosts,
  initialProfile,
  businessName,
  businessSummary,
  manualBusinessContext,
  manualImageNotes,
}) {
  const cleanedPost = (post || "").replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();

  const profileBusinessName =
    initialProfile?.businessProfile?.name || businessName || "the business";

  const profileBusinessSummary =
    initialProfile?.businessProfile?.summary || businessSummary || "a business brand";

  const profileAudience =
    (initialProfile?.businessProfile?.audience || []).join(", ") || "not specified";

  const visualDirections =
    (initialProfile?.visualProfile?.visualDirections || []).join(", ") ||
    "modern, grounded, believable";

  const offerSummary =
    (initialProfile?.businessProfile?.offers || []).join(", ") || "not specified";

  let modeRule = "";

  if (mode === "express") {
    modeRule = `
MODE RULE:
- Prioritize profile and URL-derived business context.
- Use manual visual notes only as light refinement.
`;
  } else if (mode === "manual") {
    modeRule = `
MODE RULE:
- Prioritize manual context and manual image notes.
- Use profile context only as fallback.
`;
  } else {
    modeRule = `
MODE RULE:
- Use profile/business context as the base.
- Blend in manual context and manual image notes where useful.
- Prefer the user's manual notes if they conflict.
`;
  }

  return `Create a realistic 4-panel business image collage with no text overlays.

POST TO VISUALIZE:
"${cleanedPost}"

LIFE FRAME:
${category}

TOPIC:
${idea || "general business content"}

BUSINESS CONTEXT:
- Business name: ${profileBusinessName}
- Business summary: ${profileBusinessSummary}
- Audience: ${profileAudience}
- Offers/services: ${offerSummary}
- Visual direction hints: ${visualDirections}

WEEKLY SOURCE:
${weeklyPosts || "none provided"}

MANUAL BUSINESS CONTEXT:
${manualBusinessContext || "none provided"}

MANUAL IMAGE DIRECTION:
${manualImageNotes || "none provided"}

${modeRule}

GLOBAL RULES:
- documentary realism
- modern business context
- grounded and believable
- no fantasy
- no text overlays
- no fake logos
- no stock-photo feel
- each panel must show a different but related business moment
- if relevant, show founder/operator process, service delivery, customer interaction, product usage, workspace, planning, care, or trust
- natural lighting preferred
- the final image should feel relevant to the business and truthful to the post`;
}

generateImageBtn.addEventListener("click", async () => {
  if (!selectedPost) {
    imageStatus.innerText = "Please select a post first.";
    return;
  }

  imageStatus.innerText = "Generating image...";
  generatedImage.style.display = "none";
  generatedImage.src = "";

  try {
    const res = await fetch("/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post: selectedPost,
        category: selectedCategory,
        idea: selectedIdea,
        weeklyPosts: selectedWeeklyPosts,
        imagePrompt: selectedImagePrompt,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /generate-image:", text);
      imageStatus.innerText =
        "Image generation failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!data.imageUrl) {
      imageStatus.innerText =
        "Image generation failed: " + (data.error || "No image returned.");
      return;
    }

    generatedImage.src = data.imageUrl;
    generatedImage.style.display = "block";
    imageStatus.innerText = "Image ready.";
  } catch (error) {
    console.error(error);
    imageStatus.innerText = "Error generating image: " + error.message;
  }
});