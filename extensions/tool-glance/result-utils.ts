import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { getCapabilities, getImageDimensions, imageFallback, stripTerminalSequences } from "@earendil-works/pi-tui";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Search/list caps are separate from the common output byte/line truncation flag. */
export function truncationNotice(details: unknown): string {
  const data = record(details);
  const reasons: string[] = [];
  for (const [key, label] of [
    ["matchLimitReached", "matches limit"],
    ["resultLimitReached", "results limit"],
    ["entryLimitReached", "entries limit"],
  ]) {
    const limit = data[key];
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) reasons.push(`${limit} ${label}`);
  }
  if (data.linesTruncated === true) reasons.push("some lines truncated");
  if (reasons.length) return `Truncated: ${reasons.join(", ")}`;
  return data.truncated === true || record(data.truncation).truncated === true ? "Output truncated" : "";
}

/** Preserve incomplete web batches as well as truncation, without inferring failure from prose. */
export function resultWarning(name: string, details: unknown): string {
  const data = record(details);
  const notices = [truncationNotice(data)];
  const fields = name === "fetch_content" ? ["successful", "urlCount", "URLs"]
    : name === "web_search" ? ["successfulQueries", "queryCount", "queries"] : undefined;
  if (fields) {
    const completed = data[fields[0]], total = data[fields[1]];
    if (typeof completed === "number" && Number.isInteger(completed) && completed >= 0
      && typeof total === "number" && Number.isInteger(total) && total > completed) {
      notices.push(`Only ${completed}/${total} ${fields[2]} succeeded`);
    }
  }
  return notices.filter(Boolean).join(" · ");
}

const noticeText = (value: unknown, limit = 240): string => typeof value === "string"
  ? stripTerminalSequences(value.slice(0, limit)).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() : "";

function reviewUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) return "";
  try {
    const url = new URL(noticeText(value, 4096));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    return url.href; // Keep the review path/query intact: it can be required to open the approval page.
  } catch {
    return "";
  }
}

/** Notices that must survive compact rendering; ordinary progress and successful output stay quiet. */
export function importantResultNotice(name: string, details: unknown, isPartial: boolean): string {
  const data = record(details);
  if (name === "web_search" && isPartial) {
    const phase = noticeText(data.phase);
    const message: Record<string, string> = {
      "curator-fallback": "Action required: open the search curator manually.",
      "waiting-for-approval": "Waiting for summary approval in browser.",
      curating: "Waiting for summary approval in browser.",
      "generating-summary": "Generating summary draft...",
    };
    if (!message[phase]) return "";
    const lines = [message[phase]];
    const url = reviewUrl(data.curatorUrl);
    if (url && phase !== "generating-summary") lines.push(url);
    const error = noticeText(data.browserOpenError);
    if (phase === "curator-fallback" && error) lines.push(`Auto-open failed: ${error}`);
    return lines.join("\n");
  }
  if (name === "subagent") {
    const id = noticeText(data.asyncId, 120);
    if (id && data.mode !== "management") {
      const children = Array.isArray(data.results) ? data.results.map(record) : [];
      const terminal = children.length > 0 && children.every((child) => child.detached || child.stopped || child.interrupted
        || (child.exitCode !== undefined && !["running", "pending"].includes(String(record(child.progress).status))));
      // This fallback does not guess workflow completion from child exit codes; native summaries know more.
      const state = terminal ? "results available" : "running";
      return `Background ${state} · run ${id}`;
    }
    if (isPartial) return "Subagent running";
  }
  return "";
}

/** Core renders supported inline images; only supply text when inline display is unavailable. */
export function imageFallbackText(result: AgentToolResult<unknown>, showImages: boolean): string {
  if (showImages && getCapabilities().images) return "";
  return result.content.filter((block) => block.type === "image").map((image) => {
    let dimensions: ReturnType<typeof getImageDimensions> | undefined;
    try {
      dimensions = getImageDimensions(image.data, image.mimeType) ?? undefined;
    } catch {
      // Malformed/unknown image bytes must not suppress the MIME-only placeholder or other text.
    }
    return imageFallback(image.mimeType, dimensions ?? undefined);
  }).join("\n");
}
