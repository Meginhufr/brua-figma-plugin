// Brua's API as the plugin's main thread calls it. Figma's fetch there goes by the manifest's allowed domains, not by
// the plugin window's null origin, so neither the API nor storage needs a CORS exception for the plugin (SPEC.md 20.1).

export type Environment = "prod" | "test" | "local";

export interface EnvironmentHosts {
  label: string;
  api: string;
  cdn: string;
  app: string;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentHosts> = {
  prod: { label: "Brua (brua.dev)", api: "https://api.brua.dev", cdn: "https://cdn.brua.dev", app: "https://app.brua.dev" },
  test: { label: "Test (test.brua.dev)", api: "https://api-test.brua.dev", cdn: "https://cdn-test.brua.dev", app: "https://app-test.brua.dev" },
  local: { label: "Local development", api: "http://localhost:7800", cdn: "http://localhost:8787", app: "http://localhost:5389" },
};

/** What Figma's main-thread fetch and Node's fetch have in common; the plugin uses no more than this. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array | string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Me {
  email: string;
  organizations: { organization: string; name: string; owner: boolean; id: string; assetBase: string }[];
  projects: { project: string; role: string; owner: boolean; name: string; library: boolean; organization: string }[];
}

export interface Project {
  slug: string;
  name: string;
  languages: string[];
}

export interface Version {
  id: string;
  version: number;
  status: string;
  failureCode?: string | null;
  failureDetail?: string | null;
}

export interface ChangeSet {
  id: string;
  name: string;
  status: string;
}

/** An answer from the API that isn't a success, with its code when the API gave one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class BruaApi {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private token: string | undefined;

  constructor(baseUrl: string, fetchFn: FetchLike, token?: string) {
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn;
    this.token = token;
  }

  async login(email: string, password: string): Promise<string> {
    const { accessToken } = await this.request<{ accessToken: string }>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    this.token = accessToken;
    return accessToken;
  }

  me(): Promise<Me> {
    return this.request("/v1/auth/me");
  }

  project(slug: string): Promise<Project> {
    return this.request(`/v1/projects/${slug}`);
  }

  createAsset(project: string, body: { id: string; preset: string; alt: Record<string, string> | null; decorative: boolean }): Promise<Version> {
    return this.request(`/v1/projects/${project}/assets`, { method: "POST", body: JSON.stringify(body) });
  }

  createVersion(project: string, id: string, body: { alt?: Record<string, string> }): Promise<Version> {
    return this.request(`/v1/projects/${project}/assets/${id}/versions`, { method: "POST", body: JSON.stringify(body) });
  }

  /** Uploads a flexible asset's one source: a presigned PUT straight to storage, then the completion that queues processing. */
  async uploadSource(project: string, id: string, version: number, bytes: Uint8Array, contentType: string): Promise<void> {
    const base = `/v1/projects/${project}/assets/${id}/versions/${version}/source`;
    const upload = await this.request<{ uploadUrl: string }>(`${base}/upload-url`, { method: "POST" });
    const put = await this.fetchFn(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
    if (!put.ok) throw new ApiError(put.status, "upload_failed", `The upload to storage failed with HTTP ${put.status}.`);
    await this.request(`${base}/complete`, { method: "POST" });
  }

  /**
   * Processing takes seconds, and the API answers version_not_ready until it is done; then the version joins a change
   * set for review, since nothing goes live before an approver merges it (SPEC.md 21).
   */
  async submitWhenProcessed(project: string, id: string, version: number, sleep: (ms: number) => Promise<void>, attempts = 90): Promise<ChangeSet> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.request<ChangeSet>(`/v1/projects/${project}/assets/${id}/versions/${version}/submit`, { method: "POST", body: "{}" });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "version_not_ready") throw error;
      }
      const state = await this.request<Version>(`/v1/projects/${project}/assets/${id}/versions/${version}`);
      if (state.status === "Failed") throw new ApiError(409, state.failureCode ?? "failed", state.failureDetail ?? `Processing failed: ${state.failureCode}.`);
      await sleep(1000);
    }
    throw new ApiError(0, "timeout", "Processing didn't finish in time. Check the asset in the back office.");
  }

  /** The version's single URL on the edge, for a preview; empty when the API doesn't list it. */
  async versionUrl(project: string, id: string, version: number): Promise<string> {
    const detail = await this.request<{ versions: { version: number; url: string }[] }>(`/v1/projects/${project}/assets/${id}/versions`);
    const found = detail.versions.find((v) => v.version === version);
    return found ? found.url : "";
  }

  private async request<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: { ok: boolean; status: number; text(): Promise<string> };
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, { method: options.method ?? "GET", headers, body: options.body });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ApiError(0, "unreachable", `Can't reach the Brua API at ${this.baseUrl}${reason ? ` (${reason})` : ""}.`);
    }
    const text = await response.text();
    const body = text ? parse(text) : null;
    if (response.status === 401) throw new ApiError(401, body?.error ?? "unauthorized", "Your sign-in has expired. Sign in again.");
    if (!response.ok) {
      const errors = body?.errors ? ([] as string[]).concat(...(Object.values(body.errors) as string[][])) : [];
      throw new ApiError(response.status, body?.error, errors.length > 0 ? errors.join(" ") : body?.error ?? `HTTP ${response.status}`);
    }
    return body as T;
  }
}

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
