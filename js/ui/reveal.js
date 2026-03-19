// Konfiguracja obserwatora (kiedy element ma się pojawić)
const observerOptions = {
  threshold: 0.1,
  rootMargin: "0px 0px -50px 0px"
};

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
      revealObserver.unobserve(entry.target);
    }
  });
}, observerOptions);

function attachObserver(node) {
  if (node.nodeType === 1) {
    if (node.classList.contains('reveal')) revealObserver.observe(node);
    node.querySelectorAll('.reveal').forEach((child) => revealObserver.observe(child));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  attachObserver(document.body);
  const domObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => attachObserver(node));
    });
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
});

