/* ========== COMMON JS — Shared between index.html and issue.html ========== */

const API_BASE = 'https://api.github.com';
const TOKEN_KEY = 'pr_dashboard_token';
const USERNAME_KEY = 'pr_dashboard_username';
const LANG_KEY = 'pr_dashboard_lang';

let ghToken = '';
let myUsername = '';
let currentLang = localStorage.getItem(LANG_KEY) || 'en';

// commonTranslations loaded from i18n/i18n-common.js
// pageTranslations loaded from i18n/i18n-{page}.js before this script
if (typeof pageTranslations === 'undefined') var pageTranslations = {};

// Merged translations (computed on init and language change)
let translations = {};

function mergeTranslations() {
    translations = {};
    for (const lang of Object.keys(commonTranslations)) {
        translations[lang] = {
            ...commonTranslations[lang],
            ...(pageTranslations[lang] || {})
        };
    }
    // Also merge any extra languages from page translations
    for (const lang of Object.keys(pageTranslations)) {
        if (!translations[lang]) {
            translations[lang] = { ...pageTranslations[lang] };
        }
    }
}

// ========== i18n ==========
const langFlags = { en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸', it: '🇮🇹' };
const langNames = { en: 'EN', fr: 'FR', de: 'DE', es: 'ES', it: 'IT' };

function t(key, params = {}) {
    let text = translations[currentLang]?.[key] || translations.en?.[key] || key;
    Object.keys(params).forEach(k => {
        text = text.replace(`{${k}}`, params[k]);
    });
    return text;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        el.innerHTML = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        el.placeholder = t(key);
    });
    // Update language selector display
    const currentFlagEl = document.getElementById('currentFlag');
    const currentLangEl = document.getElementById('currentLang');
    if (currentFlagEl) currentFlagEl.textContent = langFlags[currentLang];
    if (currentLangEl) currentLangEl.textContent = langNames[currentLang];
    // Update active state in dropdown
    document.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === currentLang);
    });
    // Update HTML lang attribute
    document.documentElement.lang = currentLang;
}

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyTranslations();
    // Call page-specific re-render if defined
    if (typeof onLanguageChange === 'function') {
        onLanguageChange();
    }
    hideLangDropdown();
}

function toggleLangDropdown() {
    document.getElementById('langDropdown').classList.toggle('show');
}

function hideLangDropdown() {
    document.getElementById('langDropdown').classList.remove('show');
}

// ========== CREDENTIALS ==========
function loadCredentials() {
    ghToken = localStorage.getItem(TOKEN_KEY) || '';
    myUsername = localStorage.getItem(USERNAME_KEY) || '';
    return ghToken && myUsername;
}

function saveCredentials() {
    const tokenInput = document.getElementById('tokenInput').value.trim();
    const username = document.getElementById('usernameInput').value.trim();

    if (!username) {
        alert(t('enterUsername'));
        return;
    }

    // Token is optional when editing (keep existing if not provided)
    const token = tokenInput || ghToken;
    if (!token) {
        alert(t('enterToken'));
        return;
    }

    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
    ghToken = token;
    myUsername = username;

    hideModal();
    updateConfigDisplay();

    // Call page-specific post-save if defined
    if (typeof onCredentialsSaved === 'function') {
        onCredentialsSaved();
    }
}

function clearCredentials() {
    if (!confirm(t('confirmDelete'))) return;

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    ghToken = '';
    myUsername = '';

    document.getElementById('dashboard').style.display = 'none';
    updateConfigDisplay();
}

// ========== MODALS ==========
function showModal() {
    document.getElementById('credentialsModal').style.display = 'flex';
    document.getElementById('usernameInput').value = myUsername;
    document.getElementById('tokenInput').value = '';
    document.getElementById('usernameInput').focus();
}

function hideModal() {
    document.getElementById('credentialsModal').style.display = 'none';
}

function showSettingsModal() {
    if (!loadCredentials()) {
        showModal();
        return;
    }
    document.getElementById('settingsUsername').textContent = myUsername;
    document.getElementById('settingsModal').style.display = 'flex';
}

function hideSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
}

function showHelpModal() {
    document.getElementById('helpModal').style.display = 'flex';
}

function hideHelpModal() {
    document.getElementById('helpModal').style.display = 'none';
}

function updateConfigDisplay() {
    const hasCredentials = loadCredentials();
    const settingsBtn = document.getElementById('settingsBtn');

    if (hasCredentials) {
        settingsBtn.classList.add('has-user');
        settingsBtn.title = myUsername;
        hideModal();
    } else {
        settingsBtn.classList.remove('has-user');
        settingsBtn.title = 'Settings';
        showModal();
    }
}

// ========== API ==========
async function fetchWithAuth(url) {
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${ghToken}`
    };
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

// ========== PROGRESS ==========
function updateProgress(percent, text) {
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
}

// ========== UTILITIES ==========
function formatDate(dateStr) {
    const locales = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT' };
    return new Date(dateStr).toLocaleDateString(locales[currentLang] || 'en-GB');
}

function getDisplayRepoName(repo) {
    if (!repo) return '';
    const parts = repo.split('/');
    if (parts.length !== 2) return repo;
    const [owner, name] = parts;
    return owner.toLowerCase() === name.toLowerCase() ? owner : `${owner}/${name}`;
}

// ========== TABLE SORTING ==========
function makeTableSortable(table) {
    if (!table || table.dataset.sortableInit === '1') return;
    table.dataset.sortableInit = '1';
    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, idx) => {
        if (th.hasAttribute('data-no-sort')) return;
        th.classList.add('sortable');
        th.addEventListener('click', () => sortTableByColumn(table, idx, th));
    });
}

function getCellSortValue(cell) {
    if (!cell) return '';
    if (cell.dataset && cell.dataset.sort !== undefined) return cell.dataset.sort;
    return (cell.textContent || '').trim();
}

function parseSortValue(v) {
    if (v === '' || v == null) return { type: 'empty', value: '' };
    const s = String(v).trim();
    // Relative time: 5m, 3h, 2d, 4mo, 1y (optional space: "5 d")
    const rel = /^(\d+)\s*(m|h|d|mo|y)$/i.exec(s);
    if (rel) {
        const n = parseInt(rel[1], 10);
        const unit = rel[2].toLowerCase();
        const mul = { m: 1, h: 60, d: 60 * 24, mo: 60 * 24 * 30, y: 60 * 24 * 365 };
        return { type: 'num', value: n * mul[unit] };
    }
    // Pure number (with optional # prefix)
    const num = /^#?(-?\d+(?:\.\d+)?)$/.exec(s);
    if (num) return { type: 'num', value: parseFloat(num[1]) };
    return { type: 'str', value: s.toLowerCase() };
}

function sortTableByColumn(table, colIdx, th) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const dir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
    table.querySelectorAll('thead th').forEach(other => {
        if (other !== th) {
            delete other.dataset.sortDir;
            other.classList.remove('sort-asc', 'sort-desc');
        }
    });
    th.dataset.sortDir = dir;
    th.classList.toggle('sort-asc', dir === 'asc');
    th.classList.toggle('sort-desc', dir === 'desc');

    rows.sort((a, b) => {
        const va = parseSortValue(getCellSortValue(a.children[colIdx]));
        const vb = parseSortValue(getCellSortValue(b.children[colIdx]));
        if (va.type === 'empty' && vb.type === 'empty') return 0;
        if (va.type === 'empty') return 1;
        if (vb.type === 'empty') return -1;
        let cmp;
        if (va.type === 'num' && vb.type === 'num') {
            cmp = va.value - vb.value;
        } else {
            cmp = String(va.value).localeCompare(String(vb.value));
        }
        return dir === 'asc' ? cmp : -cmp;
    });

    const frag = document.createDocumentFragment();
    rows.forEach(r => frag.appendChild(r));
    tbody.appendChild(frag);
}

function formatRelativeTime(dateStr) {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = now - date;
    const minutes = Math.floor(diff / (60 * 1000));
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 30) return `${days}d`;
    if (months < 12) return `${months}mo`;
    return `${years}y`;
}

// ========== INITIALIZATION ==========
function initCommon() {
    mergeTranslations();

    // Language dropdown close on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.lang-selector')) {
            hideLangDropdown();
        }
    });

    // Language option click handlers
    document.querySelectorAll('.lang-option').forEach(opt => {
        opt.addEventListener('click', () => setLanguage(opt.dataset.lang));
    });

    // Initialize language selector display
    const currentFlagEl = document.getElementById('currentFlag');
    if (currentFlagEl) {
        currentFlagEl.textContent = langFlags[currentLang];
        document.getElementById('currentLang').textContent = langNames[currentLang];
    }

    // Close modals on outside click
    document.addEventListener('click', (e) => {
        const credentialsModal = document.getElementById('credentialsModal');
        const settingsModal = document.getElementById('settingsModal');
        const helpModal = document.getElementById('helpModal');
        if (e.target === credentialsModal && loadCredentials()) hideModal();
        if (e.target === settingsModal) hideSettingsModal();
        if (e.target === helpModal) hideHelpModal();
    });

    // Handle Enter/Escape keys in modals
    document.addEventListener('keydown', (e) => {
        const credentialsModal = document.getElementById('credentialsModal');
        const settingsModal = document.getElementById('settingsModal');
        const helpModal = document.getElementById('helpModal');

        if (credentialsModal && credentialsModal.style.display === 'flex') {
            if (e.key === 'Enter') saveCredentials();
            if (e.key === 'Escape' && loadCredentials()) hideModal();
        }
        if (settingsModal && settingsModal.style.display === 'flex' && e.key === 'Escape') {
            hideSettingsModal();
        }
        if (helpModal && helpModal.style.display === 'flex' && e.key === 'Escape') {
            hideHelpModal();
        }
    });

    // Apply translations
    applyTranslations();
}
