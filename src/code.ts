// Runs in Figma's plugin sandbox: reads the selection, exports it, talks to Brua and links the layer to its asset.
// The network calls live here, not in the window: Figma's main-thread fetch goes by the manifest's allowed domains,
// while the window's null origin would need CORS exceptions on the API and storage (SPEC.md 20.1).
import { ApiError, BruaApi, ENVIRONMENTS, type Environment, type Fill, type Me } from "./api";

const NAMESPACE = "brua";
const SETTINGS_KEY = "brua-settings";

type Settings = { environment: Environment; project: string; email?: string; token?: string };
const DEFAULT_SETTINGS: Settings = { environment: "prod", project: "" };

type UiMessage =
  | { type: "ready" }
  | { type: "sign-in"; email: string; password: string }
  | { type: "two-factor-code"; code: string }
  | { type: "two-factor-cancel" }
  | { type: "browser-sign-in" }
  | { type: "browser-sign-in-cancel" }
  | { type: "sign-out" }
  | { type: "set-environment"; environment: Environment }
  | { type: "set-project"; project: string }
  | ({ type: "publish"; assetId: string; alt: Record<string, string> | null; decorative: boolean } & Fill)
  | ({ type: "publish-version"; alt?: Record<string, string> } & Fill)
  | { type: "open"; url: string }
  | { type: "unlink" };

let settings: Settings = DEFAULT_SETTINGS;
/** The signed-in person, for the projects they may publish to and where their assets live on the edge. */
let account: Me | null = null;
let selectedId: string | null = null;

figma.showUI(__html__, { width: 380, height: 640, themeColors: true });

const post = (message: unknown) => figma.ui.postMessage(message);
const status = (text: string, kind = "") => post({ type: "status", text, kind });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const api = () => new BruaApi(ENVIRONMENTS[settings.environment].api, fetch, settings.token);

async function saveSettings(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next };
  await figma.clientStorage.setAsync(SETTINGS_KEY, settings);
}

/** Asset ids are lowercase words joined by hyphens (SPEC.md 6.3). */
function suggestAssetId(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** Text inside the selection, offered as a starting point for alt text (SPEC.md 20.2). */
function textInside(node: SceneNode): string {
  const texts: TextNode[] =
    node.type === "TEXT" ? [node] : "findAll" in node ? (node.findAll((n) => n.type === "TEXT") as TextNode[]) : [];
  return texts
    .map((t) => t.characters.trim())
    .filter((t) => t.length > 0)
    .slice(0, 5)
    .join(" ");
}

/**
 * Where the asset lives: its page in the back office, and the version's single URL on the edge, from where the
 * asset's organization keeps its files (SPEC.md 5.3); the edge ones are null until the account is known.
 */
function links(project: string, assetId: string, version: number): { appUrl: string; edgeUrl: string | null; previewUrl: string | null } {
  const membership = account?.projects.find((p) => p.project === project);
  const organization = membership && account?.organizations.find((o) => o.organization === membership.organization);
  const edgeUrl = organization?.assetBase ? `${organization.assetBase}/${assetId}/${version}` : null;
  return { appUrl: `${ENVIRONMENTS[settings.environment].app}/assets/${assetId}`, edgeUrl, previewUrl: edgeUrl && `${edgeUrl}?w=640` };
}

/**
 * On a component, the asset's details where Figma shows them to everyone who selects it, plugin or not: a paragraph
 * in its description and its documentation link (SPEC.md 20.1). Frames have neither; they keep the Dev Resource.
 */
function describeInFigma(node: SceneNode, assetId: string, version: number, project: string, appUrl: string): void {
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") return;
  try {
    const block = `Brua: ${assetId} · version ${version} · project ${project}\n${appUrl}`;
    const others = node.description.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0 && !p.startsWith("Brua: "));
    node.description = [...others, block].join("\n\n");
    const ours = (uri: string) => Object.values(ENVIRONMENTS).some((e) => uri.startsWith(`${e.app}/assets/`));
    node.documentationLinks = [...node.documentationLinks.filter((l) => !ours(l.uri)), { uri: appUrl }];
  } catch {
    // A component from a library can't be changed from here.
  }
}

/**
 * How a layout's box should hold what is selected, as a first suggestion: an image fill set to Fit is shown whole, one
 * that fills or crops fills its box; a layer of vectors and text alone, such as a logo or an icon, is shown whole;
 * anything else fills its box, Brua's own default for a flexible asset.
 */
function suggestedFit(node: SceneNode): "contain" | "cover" {
  const layers: SceneNode[] = [node, ...("findAll" in node ? node.findAll((n) => "fills" in n) : [])];
  for (const layer of layers) {
    if (!("fills" in layer) || !Array.isArray(layer.fills)) continue;
    for (const paint of layer.fills as readonly Paint[]) {
      if (paint.type === "IMAGE" && paint.visible !== false) return paint.scaleMode === "FIT" ? "contain" : "cover";
    }
  }
  return "contain";
}

/**
 * What the window needs to place the fill point: a small export of the layer, and for a linked layer the fill its newest
 * version has, which a new version starts from. Sent after the selection, since both take a moment.
 */
async function sendFill(node: SceneNode, linked: { assetId: string; project: string } | null): Promise<void> {
  let fill: { objectFit?: string; objectPosition?: string } = {};
  if (linked && settings.token) {
    try {
      fill = await api().fill(linked.project, linked.assetId);
    } catch {
      // The suggestion from the layer stands.
    }
  }
  const bytes = await (node as ExportMixin).exportAsync({ format: "PNG", constraint: { type: "WIDTH", value: 320 } });
  if (selectedId !== node.id) return;
  post({ type: "fill", nodeId: node.id, ...fill, thumbnail: `data:image/png;base64,${figma.base64Encode(bytes)}` });
}

function describeSelection() {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    selectedId = null;
    post({
      type: "selection",
      node: null,
      reason: selection.length === 0 ? "Select a frame or layer to publish." : "Select one layer at a time.",
    });
    return;
  }

  const node = selection[0];
  selectedId = node.id;
  const linkedId = node.getSharedPluginData(NAMESPACE, "assetId");
  const linkedVersion = Number(node.getSharedPluginData(NAMESPACE, "version"));
  const linkedProject = node.getSharedPluginData(NAMESPACE, "project");
  post({
    type: "selection",
    node: {
      id: node.id,
      suggestedFit: suggestedFit(node),
      name: node.name,
      width: Math.round(node.width),
      height: Math.round(node.height),
      suggestedId: suggestAssetId(node.name),
      text: textInside(node),
      linked: linkedId
        ? { assetId: linkedId, version: linkedVersion, project: linkedProject, ...links(linkedProject, linkedId, linkedVersion) }
        : null,
    },
  });
  if ("exportAsync" in node) {
    sendFill(node, linkedId ? { assetId: linkedId, project: linkedProject } : null).catch(() => {
      // Without a thumbnail the window places the point without one.
    });
  }
}

async function selectedNode(): Promise<SceneNode> {
  const node = selectedId ? await figma.getNodeByIdAsync(selectedId) : null;
  if (!node || !("exportAsync" in node)) throw new Error("The selected layer is no longer available.");
  return node as SceneNode;
}

/** The window's view of the settings: the environment, the project and who is signed in, never the token. */
function sendSettings() {
  post({
    type: "settings",
    settings: { environment: settings.environment, project: settings.project, email: settings.email, signedIn: !!settings.token },
    environments: ENVIRONMENTS,
    mode: figma.editorType === "dev" ? "inspect" : "publish",
  });
}

/** Who is signed in and which projects they may publish to; viewers are left out, owners may publish anywhere. */
async function sendAccount(): Promise<void> {
  if (!settings.token) {
    account = null;
    post({ type: "account", projects: null });
    return;
  }
  account = await api().me();
  const projects = account.projects
    .filter((p) => p.owner || p.role === "editor" || p.role === "approver" || p.role === "admin")
    .map((p) => ({
      slug: p.project,
      name: p.name,
      library: p.library,
      organization: account!.organizations.find((o) => o.organization === p.organization)?.name ?? p.organization,
    }));
  if (!projects.some((p) => p.slug === settings.project)) await saveSettings({ project: projects.length > 0 ? projects[0].slug : "" });
  post({ type: "account", projects, project: settings.project });
  await sendProject();
  describeSelection();
}

async function sendProject(): Promise<void> {
  if (!settings.token || !settings.project) {
    post({ type: "project", languages: [] });
    return;
  }
  const project = await api().project(settings.project);
  post({ type: "project", languages: project.languages });
}

/**
 * Exports the layer at 2x (Brua makes the smaller widths and formats, SPEC.md 4.1), creates the asset or its next
 * version, uploads, waits for processing, submits for review and links the layer to the asset.
 */
async function publish(project: string, assetId: string, create: (client: BruaApi) => Promise<{ version: number }>): Promise<void> {
  const node = await selectedNode();
  status("Exporting the layer at 2×…");
  const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
  const client = api();
  const created = await create(client);
  status("Uploading…");
  await client.uploadSource(project, assetId, created.version, bytes, "image/png");
  status("Processing: making every size and format…");
  const changeSet = await client.submitWhenProcessed(project, assetId, created.version, sleep);

  node.setSharedPluginData(NAMESPACE, "assetId", assetId);
  node.setSharedPluginData(NAMESPACE, "version", String(created.version));
  node.setSharedPluginData(NAMESPACE, "project", project);
  const where = links(project, assetId, created.version);
  describeInFigma(node, assetId, created.version, project, where.appUrl);
  try {
    // Shows developers in Dev Mode which asset this layer is (SPEC.md 20.1): the asset's page in the back office.
    await node.addDevResourceAsync(where.appUrl, `Brua: ${assetId}`);
  } catch {
    // Already linked, or Dev Resources aren't available in this file.
  }
  figma.notify(`Published as ${assetId}`);
  post({ type: "published", assetId, version: created.version, changeSet: changeSet.name, inReview: changeSet.status === "submitted", ...where });
  describeSelection();
}

async function failed(error: unknown): Promise<void> {
  if (error instanceof ApiError && error.status === 401) {
    await saveSettings({ token: undefined });
    await sendAccount();
  }
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

figma.on("selectionchange", describeSelection);

/** A sign-in waiting for its authenticator code: the challenge the password earned, and whose it is. */
let twoFactor: { email: string; token: string } | undefined;

/** The sign-in waiting for the person in the browser; replaced or cleared to stop collecting for it. */
let browserSignIn: { secret: string; url: string } | undefined;

/**
 * Hands sign-in to the browser: the back office's page signs the person in however they sign in there, a passkey
 * included, which this window can't do with no origin of its own, and the token is collected here once they approve.
 */
async function signInWithBrowser(): Promise<void> {
  const environment = settings.environment;
  const client = new BruaApi(ENVIRONMENTS[environment].api, fetch);
  const started = await client.startSignIn();
  const mine = { secret: started.secret, url: started.url };
  browserSignIn = mine;
  post({ type: "browser-sign-in", code: started.code, url: started.url });
  figma.openExternal(started.url);

  const until = Date.parse(started.expiresAt);
  while (browserSignIn === mine && Date.now() < until) {
    await sleep(started.intervalSeconds * 1000);
    if (browserSignIn !== mine) return;
    let token: string | null;
    try {
      token = await client.collectSignIn(mine.secret);
    } catch (error) {
      if (browserSignIn !== mine) return;
      // A dropped connection or a busy API is asked again on the next round.
      if (error instanceof ApiError && (error.status === 0 || error.status === 429)) continue;
      browserSignIn = undefined;
      if (error instanceof ApiError && error.code === "sign_in_declined") throw new Error("The sign-in was declined in the browser.");
      if (error instanceof ApiError && error.code === "sign_in_expired") {
        post({ type: "browser-sign-in-expired" });
        return;
      }
      throw error;
    }
    if (!token) continue;
    browserSignIn = undefined;
    await saveSettings({ token, email: (await new BruaApi(ENVIRONMENTS[environment].api, fetch, token).me()).email });
    sendSettings();
    await sendAccount();
    return;
  }
  if (browserSignIn !== mine) return;
  browserSignIn = undefined;
  post({ type: "browser-sign-in-expired" });
}

figma.ui.onmessage = async (message: UiMessage) => {
  try {
    switch (message.type) {
      case "ready": {
        const stored = (await figma.clientStorage.getAsync(SETTINGS_KEY)) as Partial<Settings> | undefined;
        settings = { ...DEFAULT_SETTINGS, ...stored };
        if (!(settings.environment in ENVIRONMENTS)) settings.environment = DEFAULT_SETTINGS.environment;
        sendSettings();
        describeSelection();
        await sendAccount();
        break;
      }
      case "sign-in": {
        let result: { accessToken: string; twoFactorToken?: string };
        try {
          result = await new BruaApi(ENVIRONMENTS[settings.environment].api, fetch).login(message.email, message.password);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw new Error("The email or password is wrong.");
          throw error;
        }
        if (result.twoFactorToken) {
          // The password was right; the code from the authenticator comes in the next message, within five minutes.
          twoFactor = { email: message.email, token: result.twoFactorToken };
          post({ type: "two-factor" });
          break;
        }
        await saveSettings({ email: message.email, token: result.accessToken });
        sendSettings();
        await sendAccount();
        break;
      }
      case "two-factor-code": {
        if (!twoFactor) throw new Error("Sign in with your password first.");
        let token: string;
        try {
          token = await new BruaApi(ENVIRONMENTS[settings.environment].api, fetch).loginTwoFactor(twoFactor.token, message.code);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401 && error.code === "challenge_expired") {
            // Five minutes passed, or the account changed under it: back to the password.
            twoFactor = undefined;
            post({ type: "two-factor-expired" });
            break;
          }
          if (error instanceof ApiError && error.status === 401) throw new Error("That code isn't right. Codes change every 30 seconds; try the current one.");
          throw error;
        }
        await saveSettings({ email: twoFactor.email, token });
        twoFactor = undefined;
        sendSettings();
        await sendAccount();
        break;
      }
      case "two-factor-cancel":
        twoFactor = undefined;
        break;
      case "browser-sign-in":
        twoFactor = undefined;
        await signInWithBrowser();
        break;
      case "browser-sign-in-cancel":
        browserSignIn = undefined;
        break;
      case "sign-out":
        twoFactor = undefined;
        browserSignIn = undefined;
        await saveSettings({ token: undefined });
        sendSettings();
        await sendAccount();
        break;
      case "set-environment":
        // Another environment means another account: the token, and a sign-in half done, stay with the one that issued them.
        twoFactor = undefined;
        browserSignIn = undefined;
        await saveSettings({ environment: message.environment, token: undefined, project: "" });
        sendSettings();
        await sendAccount();
        break;
      case "set-project":
        await saveSettings({ project: message.project });
        await sendProject();
        describeSelection();
        break;
      case "publish":
        await publish(settings.project, message.assetId, (client) =>
          client.createAsset(settings.project, {
            id: message.assetId, preset: "flexible", alt: message.alt, decorative: message.decorative,
            objectFit: message.objectFit, objectPosition: message.objectPosition,
          }));
        break;
      case "publish-version": {
        // The layer stays with its asset's project, whichever project the window shows.
        const node = await selectedNode();
        const assetId = node.getSharedPluginData(NAMESPACE, "assetId");
        const project = node.getSharedPluginData(NAMESPACE, "project") || settings.project;
        if (!assetId) throw new Error("This layer isn't linked to a Brua asset yet.");
        await publish(project, assetId, (client) => client.createVersion(project, assetId, {
          ...(message.alt ? { alt: message.alt } : {}), objectFit: message.objectFit, objectPosition: message.objectPosition,
        }));
        break;
      }
      case "open":
        figma.openExternal(message.url);
        break;
      case "unlink": {
        // The layer forgets its asset, for one deleted in Brua or published by mistake; the next publish makes a new asset.
        const node = await selectedNode();
        for (const key of ["assetId", "version", "project"]) node.setSharedPluginData(NAMESPACE, key, "");
        describeSelection();
        break;
      }
    }
  } catch (error) {
    await failed(error);
  }
};
