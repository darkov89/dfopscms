#!/usr/bin/env node
/**
 * Jednorazowy / awaryjny split admin.html → admin/partials/*.html
 * Źródło: admin.html w korzeniu repo. Po splicie edytuj partials i buduj: npm run build:admin
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'admin.html');
const partialsDir = path.join(root, 'admin', 'partials');

/** [filename, startLine, endLine] — linie 1-indexed, włącznie */
const SLICES = [
  ['01-head.html', 1, 52],
  ['02-body-open.html', 53, 54],
  ['03-wizard.html', 55, 373],
  ['04-auth-login.html', 374, 459],
  ['05-shell-open.html', 460, 478],
  ['06-modals-trial-upgrade.html', 479, 534],
  ['07-modals-checkout-welcome.html', 535, 637],
  ['08-header.html', 638, 714],
  ['09-panel-loading.html', 715, 719],
  ['10-main-open.html', 720, 757],
  ['11-layout-sidebar-open.html', 758, 763],
  ['12-sidebar.html', 764, 893],
  ['13-tabs-open.html', 894, 895],
  ['tab-dashboard.html', 896, 926],
  ['tab-settings.html', 927, 1220],
  ['tab-hero.html', 1221, 1316],
  ['tab-manifesto.html', 1317, 1345],
  ['tab-care-profile.html', 1346, 1380],
  ['tab-menu.html', 1381, 1486],
  ['tab-services.html', 1487, 1551],
  ['tab-schedule.html', 1552, 1583],
  ['tab-trust.html', 1584, 1622],
  ['tab-gallery.html', 1623, 1667],
  ['tab-contact.html', 1668, 1797],
  ['tab-faq.html', 1798, 1845],
  ['tab-reviews.html', 1846, 1944],
  ['tab-leady-stub.html', 1945, 1946],
  ['tab-legal.html', 1947, 1993],
  ['tab-account.html', 1994, 2063],
  ['tab-subscription.html', 2064, 2306],
  ['tab-seo.html', 2307, 2376],
  ['14-layout-close.html', 2377, 2382],
  ['15-studio-welcome-shell-close.html', 2383, 2408],
  ['17-forced-password.html', 2409, 2455],
  ['18-toast.html', 2456, 2480],
  ['19-body-close.html', 2481, 2482],
];

/** Wycina dokładny fragment pliku po numerach linii (zachowuje puste linie i brak końcowego \\n). */
function extractLineRange(content, startLine, endLineInclusive) {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }
  const start = lineStarts[startLine - 1] ?? 0;
  const end = lineStarts[endLineInclusive] ?? content.length;
  return content.slice(start, end);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const manifest = [];

fs.mkdirSync(partialsDir, { recursive: true });

for (const [name, start, end] of SLICES) {
  const chunk = extractLineRange(source, start, end);
  fs.writeFileSync(path.join(partialsDir, name), chunk, 'utf8');
  manifest.push(name);
}

const manifestPath = path.join(root, 'admin', 'manifest.json');
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify({ description: 'Kolejność składania admin.html — npm run build:admin', partials: manifest }, null, 2)}\n`,
  'utf8',
);

console.log(`Wrote ${manifest.length} partials → admin/partials/`);
