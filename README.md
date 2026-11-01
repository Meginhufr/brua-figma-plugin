# Brua Figma plugin

Publishes a selected frame or layer to Brua, with alt text, and links the layer to its asset (`SPEC.md` 20.1 and 20.2). It talks to Brua on `brua.dev` by default, and to the test or local environment when told to under **Account and connection**.

## Use it in Figma

1. Build the plugin:
   ```bash
   cd figma-plugin
   npm install
   npm run build          # or `npm run watch` while changing src/
   ```
2. In the **Figma desktop app** (the browser version can't load local plugins): open any design file, then **Plugins → Development → Import plugin from manifest…** and choose `figma-plugin/manifest.json`.
3. Run it from **Plugins → Development → Brua**. Sign in with your Brua account the first time; the token is kept in Figma's client storage, the password isn't. Pick the project to publish to from the ones you have a role in. Select a frame, check the asset id, write alt text in each of the project's languages (or use the text found in the layer), and press **Publish for review**.

The version is processed and submitted for review in a change set; it goes live when an approver merges the change set in the back office (`app.brua.dev`, **Change sets**). The window then shows a preview, a link to the asset in the back office and its URL on the edge; Figma opens both in the browser. The layer remembers its asset: selecting it again shows the same, and **Publish a new version** keeps the alt text only if you confirm the image still means the same. A layer stays with its asset's project, whichever project the window shows.

When the layer is a component (or a component set), the plugin also writes the asset's id, version, project and link into the component's description and adds the link as its documentation link, so anyone who selects the component sees them in Figma's design panel without the plugin. Publishing again replaces that paragraph. Plain frames have no description in Figma, so they keep only the Dev Resource.

In **Dev Mode** the file is read-only, so the plugin shows the Brua asset the selected layer is linked to (id, version and a preview) instead of publishing, and the layer carries a Dev Resource link to the asset's page in the back office. Switch to Design mode (Shift+D) to publish. Dev Mode needs a paid Figma seat, so this part is untested so far.

**Local development:** start the local environment (`CLAUDE.md`, "Run locally"), choose **Local development** under Account and connection and sign in as `editor@brua.local` with `brua-local-dev`. `ui.html` is read when the plugin starts, so close and reopen the plugin after changing it; Figma's "Hot reload plugin" option (Plugins → Development) reloads it when `dist/code.js` changes.

## How it works

- `src/code.ts` runs in Figma's sandbox: reads the selection, suggests an id from the layer name and alt text from its text layers, exports the layer as PNG at 2×, talks to Brua, and stores the asset id on the layer (`setSharedPluginData`) with a Dev Resource link for Dev Mode.
- `src/api.ts` is the API as the plugin uses it: sign-in, the person's projects, creating an asset or a version, the presigned upload straight to storage, waiting for processing and submitting for review. It runs on the main thread on purpose: Figma's `fetch` there goes by the manifest's allowed domains, while the plugin window has a null origin and would need CORS exceptions on the API and storage.
- `ui.html` is the plugin window: the form, the status and the preview. It only exchanges messages with the main thread.
- `manifest.json` lists Brua's API, edge and storage under `allowedDomains` (what organization admins see when they approve the plugin) and the local services under `devAllowedDomains`.

Changing the environment signs you out, since a token belongs to the environment that issued it.

## Not yet

- Light and dark from variable modes, and per-language variants (`SPEC.md` 20.1): every publish is a flexible asset with one source.
- Inserting assets from search, which needs a list endpoint in the API.
- `width` and `height` come from the 2× export; the plugin should send the frame's designed size.
- Signing in through the browser instead of a password in the plugin (`SPEC.md` 20.1), and publishing the plugin to the Figma community under a real id.
