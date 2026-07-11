
// Simple job queue scaffold (non-breaking, can be expanded later)

export async function enqueueNotificationJob(payload: any) {
  console.log("[QUEUE] job queued", payload?.id || "unknown");
}

export async function processJobs() {
  console.log("[QUEUE] worker started");
}
