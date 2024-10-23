import { SSE } from "https://cdn.jsdelivr.net/npm/sse.js@2";
import { parse } from "https://cdn.jsdelivr.net/npm/partial-json@0.1.7/+esm";
import { html, render } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@1";

const industryCards = document.getElementById("industry-cards");
const templatesAndUpload = document.querySelector(".templates-and-upload");
const imageTemplates = document.getElementById("image-templates");
const selectedIndustryTitle = document.getElementById("selected-industry");
const uploadInput = document.getElementById("upload");
const uploadBtn = document.getElementById("upload-btn");
const resultTable = document.getElementById("result-table");
const saveJsonBtn = document.getElementById("save-json-btn");
let data;

const industries = await fetch("config.json").then((res) => res.json());

async function* llmStream(body) {
  // Augment the body to enable streaming with usage tracking
  Object.assign(body, { stream: true, stream_options: { include_usage: true } });
  const responseStream = asyncLLM(
    "https://llmfoundry.straive.com/openai/v1/chat/completions",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  // Iterate over the streaming response and yield chunks
  for await (const { content, usage } of responseStream) {
    if (content) yield { content, usage };  // Yield content incrementally
  }
}
// Generate industry cards
Object.entries(industries).forEach(([industry, data]) => {
  industryCards.insertAdjacentHTML(
    "beforeend",
    /* html */ `
    <div class="col-md-4 mb-4">
      <div class="card h-100" data-industry="${industry}">
        <div class="card-body d-flex flex-column">
          <h5 class="card-title">${data.title}</h5>
          <p class="card-text flex-grow-1">${data.context}</p>
          <button class="btn btn-primary explore-btn mt-auto">Explore</button>
        </div>
      </div>
    </div>
  `
  );
});

// Add click event listeners to explore buttons
document.querySelectorAll(".explore-btn").forEach((button) => {
  button.addEventListener("click", (event) => {
    const industry = event.target.closest(".card").dataset.industry;
    selectedIndustryTitle.textContent = industries[industry].title;
    render(
      html`
        ${industries[industry].templates.map(
          (template) => html`
            <div class="col-md-4 mb-3">
              <div class="card h-100">
                <img
                  src="${template.url}"
                  class="card-img-top template-image"
                  style="cursor: pointer; object-fit: cover; height: 200px;"
                  data-url="${template.url}"
                />
                <div class="card-body">
                  <p class="card-text">${template.description}</p>
                </div>
              </div>
            </div>
          `
        )}
      `,
      imageTemplates
    );
    templatesAndUpload.style.display = "block";
    imageTemplates.scrollIntoView({ behavior: "smooth" });
  });
});

// Move the event listener outside of showTemplates
imageTemplates.addEventListener("click", async (event) => {
  if (event.target.classList.contains("template-image")) {
    const response = await fetch(event.target.dataset.url);
    processImageFile(await response.blob());
  }
});

uploadInput.addEventListener(
  "change",
  (event) => (uploadBtn.style.display = event.target.files[0] ? "inline-block" : "none")
);

uploadBtn.addEventListener("click", async () => {
  if (uploadInput.files[0]) processImageFile(uploadInput.files[0]);
});

function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = async () => await sendImageToLLM(reader.result.split(",")[1]);
  reader.readAsDataURL(file);
}

async function sendImageToLLM(base64Image) {
  const schemaDescription = document.getElementById("json-description").value.trim();
  const body = {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Extract information from this image and return it as JSON.
Values must be scalars.
Even if you cannot process the image, try to get information from it.
${schemaDescription ? `Use this stucture:\n${schemaDescription}` : ""}`,
      },
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }],
      },
    ],
  };
  render(html`<div class="spinner-border" role="status"></div>`, resultTable);
  resultTable.scrollIntoView({ behavior: "smooth" });
  for await (const { content, usage } of llmStream(body)) {
    if (!content) continue;
    data = parse(content);
    render(table(data), resultTable);
  }
  saveJsonBtn.classList.remove("d-none");
}

saveJsonBtn.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "image-details.json";
  a.click();
  URL.revokeObjectURL(url);
});

function table(data) {
  return html`
    <table class="table table-bordered">
      <tbody>
        ${Array.isArray(data)
          ? data.map(table)
          : typeof data === "object" && data !== null
          ? Object.entries(data).map(([k, v]) => row(k, v))
          : data}
      </tbody>
    </table>
  `;
}

const row = (key, value) => html`
  <tr>
    <td>${key}</td>
    <td>${typeof value === "object" && value !== null ? table(value) : value}</td>
  </tr>
`;
