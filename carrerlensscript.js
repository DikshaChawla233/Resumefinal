const $ = (selector) => document.querySelector(selector);

const jobSelect = $("#job-select");
const jobDetails = $("#job-details");
const resumeInput = $("#resume-file");
const analyzeForm = $("#analyze-form");
const analyzeButton = $("#analyze-btn");
const analysisStatus = $("#analysis-status");
const results = $("#results");
const jobForm = $("#job-form");
const jobStatus = $("#job-status");
const postJobButton = $("#post-job-btn");

let jobs = [];

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `status-message ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { detail: await response.text() };

  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }
  return data;
}

function renderJobDetails(job) {
  if (!job) {
    jobDetails.classList.add("hidden");
    jobDetails.innerHTML = "";
    return;
  }

  jobDetails.innerHTML = `
    <strong>${escapeHtml(job.title)}</strong>
    <p><b>Education:</b> ${escapeHtml(job.education || "Not specified")}</p>
    <p><b>Experience:</b> ${escapeHtml(job.experience || "Not specified")}</p>
    <p><b>Required skills:</b> ${escapeHtml((job.required_skills || []).join(", ") || "Not provided")}</p>
    ${job.description ? `<p>${escapeHtml(job.description)}</p>` : ""}
  `;
  jobDetails.classList.remove("hidden");
}

function renderJobs() {
  const previous = jobSelect.value;
  jobSelect.innerHTML = '<option value="">Choose a target job</option>';

  for (const job of jobs) {
    const option = document.createElement("option");
    option.value = job.id;
    option.textContent = `${job.title}${job.source === "hr" ? " · HR posting" : ""}`;
    jobSelect.appendChild(option);
  }

  if (jobs.some(job => job.id === previous)) {
    jobSelect.value = previous;
  }

  renderJobDetails(jobs.find(job => job.id === jobSelect.value));
}

async function loadJobs() {
  jobSelect.innerHTML = '<option value="">Loading jobs…</option>';

  try {
    const data = await api("/api/jobs");
    jobs = data.jobs || [];
    renderJobs();

    if (!jobs.length) {
      jobSelect.innerHTML = '<option value="">No jobs available yet</option>';
      setStatus(analysisStatus, "No jobs were found. HR can create a job using the HR tab.", "error");
    } else {
      setStatus(analysisStatus, `${jobs.length} jobs available. Select a role to begin.`);
    }
  } catch (error) {
    jobSelect.innerHTML = '<option value="">Could not load jobs</option>';
    setStatus(analysisStatus, `Could not load jobs: ${error.message}`, "error");
  }
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
    button.classList.add("active");

    document.querySelectorAll(".panel").forEach(panel => panel.classList.add("hidden"));
    $(`#${button.dataset.panel}`).classList.remove("hidden");
  });
});

jobSelect.addEventListener("change", () => {
  renderJobDetails(jobs.find(job => job.id === jobSelect.value));
  results.classList.add("hidden");
  setStatus(analysisStatus, "");
});

resumeInput.addEventListener("change", () => {
  const file = resumeInput.files[0];
  $("#file-name").textContent = file ? file.name : "No file selected";
});

analyzeForm.addEventListener("submit", async event => {
  event.preventDefault();
  results.classList.add("hidden");

  const jobId = jobSelect.value;
  const file = resumeInput.files[0];

  if (!jobId) {
    setStatus(analysisStatus, "Please select a target job.", "error");
    return;
  }

  if (!file) {
    setStatus(analysisStatus, "Please choose a PDF or DOCX resume.", "error");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    setStatus(analysisStatus, "The resume must be 10 MB or smaller.", "error");
    return;
  }

  const ext = file.name.split(".").pop().toLowerCase();
  if (!["pdf", "docx"].includes(ext)) {
    setStatus(analysisStatus, "Only PDF and DOCX files are supported.", "error");
    return;
  }

  analyzeButton.disabled = true;
  analyzeButton.textContent = "Analyzing resume…";
  setStatus(analysisStatus, "Extracting resume text and comparing required skills…");

  try {
    const formData = new FormData();
    formData.append("resume", file);

    const data = await api(`/api/analyze?job_id=${encodeURIComponent(jobId)}`, {
      method: "POST",
      body: formData
    });

    const matched = data.matched_skills || [];
    const missing = data.missing_skills || [];
    const percent = data.skill_match_percentage;

    results.innerHTML = `
      <h3>Analysis results</h3>
      <p class="helper">Target role: ${escapeHtml(data.job_title)}</p>
      <div class="result-grid">
        <div class="metric">
          <div class="metric-value">${percent === null ? "N/A" : `${escapeHtml(percent)}%`}</div>
          <div class="metric-label">Required-skill match</div>
        </div>
        <div class="metric">
          <div class="metric-value">${matched.length}</div>
          <div class="metric-label">Skills matched</div>
        </div>
        <div class="metric">
          <div class="metric-value">${missing.length}</div>
          <div class="metric-label">Skills to develop</div>
        </div>
      </div>

      <h4>Matched skills</h4>
      <div class="skill-list">
        ${matched.length
          ? matched.map(skill => `<span class="skill-chip">${escapeHtml(skill)}</span>`).join("")
          : '<span class="helper">No required skills were detected in the extracted resume text.</span>'}
      </div>

      <h4>Skills not detected</h4>
      <div class="skill-list">
        ${missing.length
          ? missing.map(skill => `<span class="skill-chip missing">${escapeHtml(skill)}</span>`).join("")
          : '<span class="helper">All listed required skills were detected.</span>'}
      </div>

      <div class="note">
        <strong>ML model status:</strong> ${escapeHtml(
          data.predicted_match_score === null
            ? data.model_note || "ML score unavailable."
            : `Predicted match score: ${data.predicted_match_score}`
        )}
        <br><br>
        <strong>Education:</strong> ${escapeHtml(data.education_requirement || "Not specified")}
        <br>
        <strong>Experience:</strong> ${escapeHtml(data.experience_requirement || "Not specified")}
      </div>
    `;

    results.classList.remove("hidden");
    setStatus(analysisStatus, "Resume analysis completed.", "success");
  } catch (error) {
    setStatus(analysisStatus, `Analysis failed: ${error.message}`, "error");
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.innerHTML = 'Analyze resume <span>→</span>';
  }
});

jobForm.addEventListener("submit", async event => {
  event.preventDefault();

  const title = $("#job-title").value.trim();
  const description = $("#job-description").value.trim();
  const required_skills = $("#required-skills").value
    .split(/[\n,;|]+/)
    .map(skill => skill.trim())
    .filter(Boolean);

  if (!title || !required_skills.length) {
    setStatus(jobStatus, "Enter a job title and at least one required skill.", "error");
    return;
  }

  postJobButton.disabled = true;
  postJobButton.textContent = "Publishing…";
  setStatus(jobStatus, "Saving the job posting…");

  try {
    const data = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        required_skills,
        education: $("#job-education").value.trim(),
        experience: $("#job-experience").value.trim()
      })
    });

    await loadJobs();
    jobSelect.value = data.job.id;
    renderJobDetails(data.job);

    jobForm.reset();
    setStatus(jobStatus, `Job "${data.job.title}" was published and is available in the student job list.`, "success");
  } catch (error) {
    setStatus(jobStatus, `Could not publish job: ${error.message}`, "error");
  } finally {
    postJobButton.disabled = false;
    postJobButton.innerHTML = 'Publish job <span>→</span>';
  }
});

loadJobs();
