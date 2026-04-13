const postsDiv = document.getElementById("posts");
const selectedPostBox = document.getElementById("selectedPost");
const generatedImage = document.getElementById("generatedImage");
const imageStatus = document.getElementById("imageStatus");

let initialProfile = null;
let voiceProfile = null;

const QUICK_TYPES = {
  Business: {
    category: "Product in Real Life",
  },
  Family: {
    category: "Small Moment Real Value",
  },
  Educational: {
    category: "Standards and Care",
  },
  Community: {
    category: "Quiet Value",
  },
  Personal: {
    category: "Founder Reflection",
  },
};

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

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = data.error || "Profile build failed.";
      return;
    }

    initialProfile = data.profile;
    voiceProfile = data.profile?.founderVoice;

    document.getElementById("businessName").value =
      data.profile?.businessProfile?.name || "";

    document.getElementById("businessSummary").value =
      data.profile?.businessProfile?.summary || "";

    document.getElementById("voiceInput").value =
      data.profile?.sourceProfile?.voiceSourceText || "";

    intakeStatus.innerText = `Profile ready (${data.profile?.sourceProfile?.voiceSourceLane || "unknown"} voice)`;

  } catch (error) {
    intakeStatus.innerText = "Error: " + error.message;
  }
}

async function quickGenerate(type) {
  if (!initialProfile) {
    alert("Build profile first.");
    return;
  }

  postsDiv.innerHTML = "Generating...";
  imageStatus.innerText = "";
  generatedImage.style.display = "none";

  const config = QUICK_TYPES[type];

  try {
    // STEP 1: Generate posts
    const res = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "hybrid",
        idea: type,
        category: config.category,
        businessName: initialProfile.businessProfile?.name,
        businessSummary: initialProfile.businessProfile?.summary,
        voiceProfile,
        initialProfile,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      postsDiv.innerHTML = "Error: " + data.error;
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);
    const bestPost = posts[1] || posts[0]; // pick middle one (balanced)

    postsDiv.innerHTML = "";

    posts.forEach((post) => {
      const div = document.createElement("div");
      div.style.border = "1px solid #ccc";
      div.style.padding = "10px";
      div.style.marginTop = "10px";
      div.style.whiteSpace = "pre-wrap";
      div.innerText = post;
      postsDiv.appendChild(div);
    });

    selectedPostBox.innerText = bestPost;

    // STEP 2: Build image prompt
    const imagePrompt = buildImagePrompt(bestPost);

    // STEP 3: Generate image
    imageStatus.innerText = "Generating image...";

    const imgRes = await fetch("/generate-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imagePrompt,
      }),
    });

    const imgData = await imgRes.json();

    if (!imgData.imageUrl) {
      imageStatus.innerText = "Image failed.";
      return;
    }

    generatedImage.src = imgData.imageUrl;
    generatedImage.style.display = "block";
    imageStatus.innerText = "Done.";

  } catch (error) {
    postsDiv.innerHTML = "Error: " + error.message;
  }
}

function buildImagePrompt(post) {
  return `
Create a realistic 4-panel business image collage.

POST:
"${post}"

RULES:
- documentary realism
- no logos
- no text
- no symbols
- no branding
- plain workwear only
- real business environments
- natural lighting
- each panel shows a different moment
- people interacting, working, delivering, preparing

IMPORTANT:
- clothing must be completely unbranded
- no icons, no chest logos, no sleeve logos
- no fake company names
`;
}