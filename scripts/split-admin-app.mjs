#!/usr/bin/env node
/**
 * Jednorazowy generator źródeł panelu z monolitu js/features/adminApp.js
 * Uruchom: node scripts/split-admin-app.mjs
 * Potem edytuj js/features/admin/** i buduj: npm run build:admin-js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'js/features/adminApp.js');
const outDir = path.join(root, 'js/features/admin');

const WIZARD = new Set([
  'persistWizardUiState', 'restoreWizardUiFromStorage', 'validateWizardStep', 'startWizard', 'skipWizard',
  'nextWizardStep', 'finishWizard', 'wizardAddServiceRow', 'wizardAddMenuRow', 'ensureMenuContentShape',
  'addMenuHourLine', 'addMenuItemRow', 'prevWizardStep', 'closeStudioWelcomeModal', 'resolveDriverFactory',
  'markWelcomeOnboardingSeen', 'startOnboardingTour', 'openWizardFromStudio', 'reopenWizard',
  'closeWizardDismissModal', 'dismissWelcomeModalAndStartOnboarding', 'goToOnboardingItem', 'sidebarTabNeedsAttention',
]);

const BILLING = new Set([
  'hasStripeBillingCustomer', 'shouldUseStripePortalForPlanChange', 'billingStripeStatusNormalized',
  'closeSuccessModal', 'openStripeCustomerPortal', 'canOpenPortalPlanChangeFlow', 'openCustomerPortal',
  'schedulePostPaymentDataRefresh', 'schedulePostPortalBillingRefresh', 'syncStripeSubscription',
  'syncUserPlanFromBilling', 'clearCheckoutTurnstile', 'closeCheckoutModal', 'renderCheckoutTurnstile',
  'subscribe', 'executeStripeCheckout', 'loadBillingProfile',
]);

const AUTH = new Set([
  'init', 'assignAuthUser', 'consumeEmailConfirmParamsFromUrl', 'applyPasswordRecoveryUi',
  'requestPasswordReset', 'syncAuthUserFromServer', 'refreshSuperadminStatus', 'bootstrapAdminSession',
  'resendSignupConfirmation', 'login', 'logout',
]);

const DATA = new Set([
  'loadData', 'saveData', '_persistDraft', 'scheduleDraftAutosave', 'autosaveDraftNow',
  'publishChanges', 'requestPublish', 'confirmPublish', 'revertChanges', 'upgradeTemplate',
  'verifyAndSaveDomain', 'cleanDomainInput', 'syncBookingSettings', 'switchTemplate',
  'ensurePageFromRegistrationMetadata', 'deleteAccount', 'updatePassword', 'saveActivePage',
  'applyThemeStylingFromContent', 'applyStyleBundle',
]);

const INTEGRATIONS = new Set([
  'uploadImage', 'removeGalleryImage', 'formatPlacesListError', 'invokePlacesList',
  'syncGoogleReviewsPlaceInputFromContent', 'onGoogleReviewsPlaceInput', 'searchGoogleReviewsPlaces',
  'selectGoogleReviewsPlace', 'clearGoogleReviewsPlaceSelection',
  'searchPlacesForMap', 'confirmMapPlaceSelection', 'clearMapPlaceSelection',
]);

const GROUPS = { wizard: WIZARD, billing: BILLING, auth: AUTH, data: DATA, integrations: INTEGRATIONS };

const src = fs.readFileSync(srcPath, 'utf8');
const lines = src.split('\n');

const sharedStart = lines.findIndex((l) => l.startsWith(';(function'));
const createLine = lines.findIndex((l) => l.trim() === 'function createAdminApp() {');
const buildLine = lines.findIndex((l) => l.includes('function buildAdminAlpineState'));
const iifeEnd = lines.findIndex((l, i) => i > buildLine && l.trim() === '})();');

let returnIdx = -1;
for (let i = createLine; i < lines.length; i += 1) {
  if (/^\s+return \{$/.test(lines[i])) {
    returnIdx = i;
    break;
  }
}

let closeIdx = -1;
let depth = 0;
for (let i = returnIdx; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
  }
  if (depth === 0 && i > returnIdx) {
    closeIdx = i;
    break;
  }
}

const methods = [];
for (let j = returnIdx + 1; j < closeIdx; j += 1) {
  const m = lines[j].match(/^      (async )?([a-zA-Z_][\w]*)\(/);
  const g = lines[j].match(/^      get ([\w]+)\(\)/);
  if (m) methods.push({ line: j, name: m[2], getter: false });
  else if (g) methods.push({ line: j, name: g[1], getter: true });
}

function sliceMethod(idx) {
  const start = methods[idx].line;
  const end = idx + 1 < methods.length ? methods[idx + 1].line : closeIdx;
  return lines.slice(start, end).join('\n');
}

const buckets = { ui: [], wizard: [], billing: [], auth: [], data: [], integrations: [] };

for (let idx = 0; idx < methods.length; idx += 1) {
  const { name, getter } = methods[idx];
  const body = sliceMethod(idx);
  if (getter) {
    buckets.ui.push(body);
    continue;
  }
  let group = 'ui';
  for (const [g, set] of Object.entries(GROUPS)) {
    if (set.has(name)) {
      group = g;
      break;
    }
  }
  buckets[group].push(body);
}

// Data properties before first method/getter
const firstMethodLine = methods[0]?.line ?? closeIdx;
const stateBlock = lines.slice(returnIdx + 1, firstMethodLine).join('\n');

const sharedBody = lines.slice(sharedStart + 1, createLine).join('\n').trimEnd();

fs.mkdirSync(path.join(outDir, 'mixins'), { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'shared.js'),
  `${sharedBody}\n`,
  'utf8',
);

function writeMixin(name, bodies) {
  const fn = `adminMixin${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const content = `function ${fn}(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
${bodies.join('\n')}
  };
}
`;
  fs.writeFileSync(path.join(outDir, 'mixins', `${name}.js`), content, 'utf8');
}

for (const [name, bodies] of Object.entries(buckets)) {
  writeMixin(name, bodies);
}

const tail = lines.slice(buildLine, iifeEnd).join('\n');

const appCore = `function createAdminApp() {
${lines.slice(createLine + 1, returnIdx).join('\n')}
  const ctx = {
    t,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
    cfg,
    repo,
  };
  return Object.assign(
    {
${stateBlock}
    },
    adminMixinUi(ctx),
    adminMixinAuth(ctx),
    adminMixinData(ctx),
    adminMixinBilling(ctx),
    adminMixinWizard(ctx),
    adminMixinIntegrations(ctx),
  );
}

${tail}
`;

fs.writeFileSync(path.join(outDir, 'app-core.js'), appCore, 'utf8');

console.log('Generated js/features/admin/');
console.log('  shared.js');
for (const name of Object.keys(buckets)) {
  console.log(`  mixins/${name}.js (${buckets[name].length} blocks)`);
}
console.log('  app-core.js');
console.log('Run: npm run build:admin-js');
