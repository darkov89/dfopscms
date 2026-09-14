/**
 * Anti-Monolith & Architectural Guard Tests
 * Weryfikuje:
 * 1. Synchronizację admin.html z admin/partials/ (zakaz bezpośredniej edycji admin.html)
 * 2. Strażnika rozmiaru adminApp.js (Extract before grow)
 * 3. Zakaz niszczących wzorców w Alpine.js (brak spreadu/mixinów z createAdminApp, brak arrow getters)
 * 4. Prawidłowość wzorca attach w js/features/
 *
 * Uruchom: node scripts/test-monolith-guard.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('✓', name);
  } catch (e) {
    console.error('✗', name);
    console.error(' ', e.message || e);
    process.exitCode = 1;
  }
}

// 1. Weryfikacja synchronizacji admin.html z partialami
test('admin.html jest dokładnie zsynchronizowany z admin/partials/ (npm run build:admin)', () => {
  const manifestPath = path.join(root, 'admin', 'manifest.json');
  const partialsDir = path.join(root, 'admin', 'partials');
  const adminHtmlPath = path.join(root, 'admin.html');

  assert.ok(existsSync(manifestPath), 'admin/manifest.json istnieje');
  assert.ok(existsSync(adminHtmlPath), 'admin.html istnieje');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const partials = manifest.partials;
  assert.ok(Array.isArray(partials) && partials.length > 0, 'admin/manifest.json posiada listę partiali');

  const banner = `<!-- GENERATED — nie edytuj ręcznie. Źródło: admin/partials/ → npm run build:admin -->\n`;
  const expectedContent = banner + partials
    .map((name) => {
      const p = path.join(partialsDir, name);
      assert.ok(existsSync(p), `Brak partiala: ${name}`);
      return readFileSync(p, 'utf8');
    })
    .join('');

  const actualContent = readFileSync(adminHtmlPath, 'utf8');
  assert.equal(
    actualContent,
    expectedContent,
    'admin.html różni się od skompilowanych partiali! Edytuj wyłącznie admin/partials/*.html i uruchom npm run build:admin'
  );
});

// 2. Strażnik rozrostu monolitu adminApp.js
test('adminApp.js nie przekracza bezpiecznego progu rozrostu (Extract-Before-Grow)', () => {
  const adminAppPath = path.join(root, 'js/features/adminApp.js');
  const content = readFileSync(adminAppPath, 'utf8');
  const lines = content.split('\n').length;

  const MAX_LINES = 3800; // Ochrona przed puchnięciem monolitu — nowe funkcjonalności muszą iść do js/features/ lub js/core/
  assert.ok(
    lines <= MAX_LINES,
    `adminApp.js ma ${lines} linii (limit strażnika: ${MAX_LINES}). Nową logikę należy wyciągnąć do js/features/ lub js/core/!`
  );
});

// 3. Zakaz niszczących wzorców w Alpine.js
test('adminApp.js i moduły nie używają zakazanego spreadu ani mixinów na createAdminApp', () => {
  const adminAppPath = path.join(root, 'js/features/adminApp.js');
  const content = readFileSync(adminAppPath, 'utf8');

  // Usuń komentarze przed analizą składni
  const codeWithoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  // Zakaz { ...createAdminApp() }
  assert.ok(
    !/\{\s*\.\.\.createAdminApp\(\)/.test(codeWithoutComments),
    'Wykryto zakazany spread {...createAdminApp()}, który niszczy gettery w Alpine 3!'
  );

  // Zakaz Object.assign(createAdminApp
  assert.ok(
    !/Object\.assign\s*\(\s*createAdminApp/.test(codeWithoutComments),
    'Wykryto zakazany Object.assign z createAdminApp!'
  );
});

// 4. Weryfikacja wzorca attach w modułach js/features/
test('Moduły w js/features (onboarding, billing, growth) eksportują funkcje attach mutujące instancję', () => {
  const features = [
    { file: 'js/features/onboarding/onboardingPanel.js', fn: 'DFOPS_attachOnboarding' },
    { file: 'js/features/billing-panel/billingPanel.js', fn: 'DFOPS_attachBillingPanel' },
    { file: 'js/features/growth/growthPanel.js', fn: 'DFOPS_attachGrowth' },
  ];

  for (const { file, fn } of features) {
    const filePath = path.join(root, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      assert.ok(
        content.includes(fn),
        `${file} powinien definiować funkcję dołączającą ${fn}`
      );
      // Upewnij się, że nie eksportuje funkcji arrow jako attach
      assert.ok(
        !new RegExp(`const\\s+${fn}\\s*=\\s*\\([^)]*\\)\\s*=>`).test(content),
        `${file}: funkcja ${fn} nie powinna być arrow function, aby nie gubić kontekstu!`
      );
    }
  }
});

// 5. Czystość logiki domenowej w js/core/
test('Moduły reguł w js/core/ (wizardRules, aiBusinessContext) są czyste (brak odwołań do Alpine/DOM)', () => {
  const coreFiles = ['js/core/wizardRules.js', 'js/core/aiBusinessContext.js', 'js/core/trialBlocking.js', 'js/core/studioHandoffRules.js'];

  for (const file of coreFiles) {
    const filePath = path.join(root, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      assert.ok(
        !content.includes('Alpine.data'),
        `${file} nie może rejestrować komponentów Alpine bezpośrednio!`
      );
      assert.ok(
        !content.includes('document.querySelector'),
        `${file} nie powinien bezpośrednio mutować DOM!`
      );
    }
  }
});

console.log(`\n${passed} monolith guard tests passed successfully.`);
