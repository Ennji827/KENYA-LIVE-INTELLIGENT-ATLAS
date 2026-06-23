import { getApiBase } from "./api";

export async function waitForJob(jobId, session, onProgress, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${getApiBase()}/api/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to read processing-job status.");
    const job = payload.job;
    onProgress?.(job);
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(job.error || "Background processing failed.");
    if (job.status === "cancelled") throw new Error("Background processing was cancelled.");
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("Processing is still running. It remains safely queued and can be checked again.");
}

export async function cancelJob(jobId, session) {
  const response = await fetch(`${getApiBase()}/api/jobs/${jobId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to cancel the queued job.");
  return payload.job;
}
