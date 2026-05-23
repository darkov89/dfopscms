/**
 * Landing (#cennik) — przełącznik miesięcznie / rocznie (−20%), spójny z panelem admin.
 */
(function () {
  function landingPricing() {
    return {
      billingInterval: 'monthly',
    };
  }

  document.addEventListener('alpine:init', function () {
    if (typeof Alpine !== 'undefined' && Alpine.data) {
      Alpine.data('landingPricing', landingPricing);
    }
  });

  window.DFOPS_landingPricing = landingPricing;
})();
