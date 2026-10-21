// Carregado no <head>, antes do CSS: aplica o tema salvo (claro/escuro) antes de a página
// aparecer, para não "piscar" no tema errado. Fica em arquivo próprio porque o CSP não permite
// <script> escrito dentro do HTML.
(function () {
    try {
        var saved = localStorage.getItem('hr_theme');
        var theme = saved === 'dark' || saved === 'light'
            ? saved
            : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.style.colorScheme = theme;
    } catch (e) { /* localStorage indisponível: mantém o tema claro */ }
}());

// Se os scripts do portal não carregarem (arquivo faltando no servidor), a tela de login avisa.
window.addEventListener('load', function () {
    if (typeof window.loginUser !== 'function') {
        var message = document.getElementById('loginMessage');
        if (message) {
            message.textContent = 'O sistema não carregou o módulo de login. Reabra esta página ou confira se a pasta js/ foi enviada ao servidor.';
        }
    }
});
