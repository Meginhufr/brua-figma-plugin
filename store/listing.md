# Figma Community listing

The answers for Figma's publish form, in the order it asks. The description box takes plain text, so paste it as is. `icon.png` and `thumbnail.png` beside this file are the images, written by `make-store.mjs`.

## Name

Brua

## Tagline

Publish a frame to Brua and hand developers an id, not a file.

## Description

Brua is the asset platform for the images and animations your apps and web pages show in production. You publish from Figma; developers reference the asset by id; Brua makes every size and format and serves the right file for each viewer's screen, appearance and language. When the design changes, you publish a new version, and it reaches every app after review, with no release from the developers.

What the plugin does

- Select a frame or a component and press Publish. The plugin exports it, uploads it to Brua, waits while every size and format is made, and puts the new version in a change set for review.
- Alt text is part of publishing: one field per project language, with the text found in the layer as a starting point, or a switch for decorative images that carry no meaning.
- The layer remembers its asset. Select it again to see the asset, a preview, and links to it in Brua and on the edge. Publish again and it becomes a new version of the same asset; the alt text is kept only if you confirm the image still means the same.
- On a component, the asset's id, version, project and link are written into the component's description and documentation link, so anyone who selects it in Figma sees where it lives.
- In Dev Mode, developers see which asset a layer is, with a Dev Resource link to its page in Brua.

How it fits

Nothing goes live from the plugin alone. A version waits in a change set until an approver merges it in Brua's back office, where the diff shows what changes for the people showing the asset, including a warning when the proportions differ from what is in production.

Getting started

Sign in with your Brua account and pick the project to publish to. Brua is in early access while pricing is settled: ask for access at brua.dev and we set up your organization.

## Tags

assets, images, alt text, design system, handoff, developer, CDN

## Support contact

hello@brua.dev

## Network access

The plugin publishes layers to Brua: its API, the storage the API hands out upload addresses on, and its edge for previews. Local development uses the services from compose.yaml.

When the form asks which hosts and why: the plugin makes requests only to hosts named in its manifest. Two are Brua's own, api.brua.dev and cdn.brua.dev. The third is Cloudflare R2 object storage, which Brua's API uses for files: when publishing, the plugin asks the API for a short-lived signed upload address and PUTs the exported image straight to that address on *.r2.cloudflarestorage.com, so one request carrying data derived from the plugin API goes to Cloudflare's storage rather than through Brua's servers. The storage bucket is Brua's, in the EU. No fonts, images or scripts are loaded from third parties, and no analytics or error-reporting service is used.

## Security questions

Does the plugin send data to a backend? Yes, and data read or derived from Figma's plugin API is sent to this backend.

Vulnerability process: Yes. Our process is published at https://brua.dev/security, with a security.txt at https://brua.dev/.well-known/security.txt. Reports go to security@brua.dev; we acknowledge within two working days, keep the reporter informed, and fix confirmed problems before anything is disclosed. We ask researchers not to access data that isn't theirs or degrade the service, and we don't take legal action against those who follow these terms.

Accreditation: No. Brua runs on AWS (Stockholm) and Cloudflare, with files stored in the EU; both providers hold SOC 2, ISO 27001 and other certifications covering the infrastructure. Brua itself, a product of Meginhufr AS, holds no certification yet.

User authentication: Yes, handled via a site that I host.

The plugin never stores a password. The person signs in once with their Brua email and password, sent over HTTPS to Brua's own API, which answers with a bearer token that expires after 8 hours. The plugin keeps only that token, in Figma's client storage, which is scoped to the user and the plugin; the password field is cleared as soon as it has been sent. Signing out, or switching environment, discards the token.

On Brua's side, accounts are ASP.NET Core Identity accounts: passwords are stored as salted PBKDF2 hashes, never in clear text, and must be at least 12 characters, with length preferred over composition rules. Ten failed sign-ins lock the account for a period. New accounts confirm their email through a one-time link that works for 3 days; password resets use a one-time link that works for 1 hour; both tokens are stored hashed. Sign-ups, password links and invitations are rate limited per client address. The API runs behind Cloudflare with an origin secret, so it is reachable only through Brua's own hostnames, which are the only ones the plugin's manifest allows. Two-factor authentication and single sign-on are planned and not yet available.

Stored data: "Yes, locally" and "Yes, in a way not captured by the above". Two boxes follow, how and where, then who can access it.

How and where this data is stored:

Locally, the plugin writes the asset's id, version and project onto the published layer with setPluginData, so the layer remembers its asset, and on components it writes the same into the component's description and documentation link, where Figma keeps them with the file. Settings go in figma.clientStorage: the chosen environment and project, the user's email and the sign-in token. No design content is kept locally.

What the user publishes leaves Figma. The exported image of the selected layer is uploaded to Brua and stored as the asset's source and generated variants in Cloudflare R2 object storage in the EU; the layer's name is offered as the asset id and the text found in the layer as alt text, and whichever of those the user accepts is stored with the asset in Brua's database on AWS in Stockholm. Nothing is sent until the user presses Publish, and nothing else from the file is read or stored.

Who can access this data, and the policies:

Published assets belong to the user's organization in Brua. Inside the organization, members with a role in the project see and change them, and only an approver can merge a version so that it is served. Served files are public by design, like any image on a website, under URLs that carry the organization's id. Brua's operators, Meginhufr AS, can access the data to run the service and don't use it for anything else; it isn't shared with or sold to third parties, and an organization can delete an asset, which removes its files. The privacy page at https://brua.dev/privacy and the security page at https://brua.dev/security describe the handling; data in the plugin's local storage stays in the user's Figma account and file.
