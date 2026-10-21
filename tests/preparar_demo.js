// Demo test page: starts from a clean demo database, logged in as the sample representative.
// (A file instead of an inline <script>, which the page's CSP would block.)
localStorage.removeItem('hr_demo_state_v2');
sessionStorage.setItem('hr_demo_user', '3');
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(`CSP bloqueou ${e.violatedDirective}: ${e.blockedURI || e.sample || ''}`));
