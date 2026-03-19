// Konfiguracja obserwatora (kiedy element ma się pojawić)
const observerOptions = {
    threshold: 0.1, // 10% elementu musi być widoczne
    rootMargin: "0px 0px -50px 0px" // Margines od dołu
};

// Główny mechanizm animacji (dodaje klasę .active)
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            // Przestań obserwować ten element (animacja tylko raz)
            revealObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

// Funkcja pomocnicza do szukania elementów .reveal
function attachObserver(node) {
    if (node.nodeType === 1) { // Sprawdzamy tylko elementy HTML
        if (node.classList.contains('reveal')) {
            revealObserver.observe(node);
        }
        // Sprawdź też dzieci tego elementu
        const children = node.querySelectorAll('.reveal');
        children.forEach(child => revealObserver.observe(child));
    }
}

// START: Uruchamiamy nasłuchiwanie
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Złap elementy, które już są
    attachObserver(document.body);

    // 2. Uruchom "Wielkiego Brata" (MutationObserver)
    // To on patrzy, czy Alpine.js dodał coś nowego do strony
    const domObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                attachObserver(node);
            });
        });
    });

    // Obserwuj całe body w poszukiwaniu zmian
    domObserver.observe(document.body, { childList: true, subtree: true });
});