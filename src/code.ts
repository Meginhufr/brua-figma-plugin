// Runs in Figma's plugin sandbox: reads the selection, exports it, talks to Brua and links the layer to its asset.
// The network calls live here, not in the window: Figma's main-thread fetch goes by the manifest's allowed domains,
// while the window's null origin would need CORS exceptions on the API and storage (SPEC.md 20.1).
import { ApiError, BruaApi, ENVIRONMENTS, type Environment, type Me } from "./api";

const NAMESPACE = "brua";
const SETTINGS_KEY = "brua-settings";

type Settings = { environment: Environment; project: string; email?: string; token?: string };
const DEFAULT_SETTINGS: Settings = { environment: "prod", project: "" };

type UiMessage =
  | { type: "ready" }
  | { type: "sign-in"; email: string; password: string }
  | { type: "sign-out" }
  | { type: "set-environment"; environment: Environment }
  | { type: "set-project"; project: string }
  | { type: "publish"; assetId: string; alt: Record<string, string> | null; decorative: boolean }
  | { type: "publish-version"; alt?: Record<string, string> }
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
  post({ type: "published", assetId, version: created.version, changeSet: changeSet.name, ...where });
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
        try {
          const token = await new BruaApi(ENVIRONMENTS[settings.environment].api, fetch).login(message.email, message.password);
          await saveSettings({ email: message.email, token });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw new Error("The email or password is wrong.");
          throw error;
        }
        sendSettings();
        await sendAccount();
        break;
      }
      case "sign-out":
        await saveSettings({ token: undefined });
        sendSettings();
        await sendAccount();
        break;
      case "set-environment":
        // Another environment means another account: the token stays with the one it was issued by.
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
          client.createAsset(settings.project, { id: message.assetId, preset: "flexible", alt: message.alt, decorative: message.decorative }));
        break;
      case "publish-version": {
        // The layer stays with its asset's project, whichever project the window shows.
        const node = await selectedNode();
        const assetId = node.getSharedPluginData(NAMESPACE, "assetId");
        const project = node.getSharedPluginData(NAMESPACE, "project") || settings.project;
        if (!assetId) throw new Error("This layer isn't linked to a Brua asset yet.");
        await publish(project, assetId, (client) => client.createVersion(project, assetId, message.alt ? { alt: message.alt } : {}));
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
