const JSON_CONTENT_TYPE = "application/json";

export type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

const reject = (status: number, code: string, error: string) => Response.json(
  { code, error },
  { status, headers: { "Cache-Control": "no-store" } },
);

export async function readSameOriginJson(request: Request, maxBytes = 16 * 1024): Promise<JsonBodyResult> {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || host.toLowerCase() !== requestUrl.host.toLowerCase()) {
    return { ok: false, response: reject(400, "INVALID_HOST", "Request host is invalid.") };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, response: reject(403, "CROSS_ORIGIN_REQUEST", "Cross-origin requests are not accepted.") };
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) {
    return { ok: false, response: reject(403, "CROSS_ORIGIN_REQUEST", "A matching Origin header is required.") };
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== JSON_CONTENT_TYPE) {
    return { ok: false, response: reject(415, "UNSUPPORTED_MEDIA_TYPE", "Send application/json.") };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, response: reject(413, "PAYLOAD_TOO_LARGE", "Request body is too large.") };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    return { ok: false, response: reject(413, "PAYLOAD_TOO_LARGE", "Request body is too large.") };
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: reject(400, "INVALID_JSON", "Request body must be valid JSON.") };
  }
}
