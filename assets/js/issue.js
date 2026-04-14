/* ========== ISSUE FINDER — Page-specific JS ========== */

const REPOS_KEY = 'issue_finder_repos';
const DISCOVERED_REPOS_KEY = 'issue_finder_discovered_repos';
const CACHE_KEY = 'issue_finder_cache';
const COMMENTED_KEY = 'issue_finder_commented';

const MAINTAINER_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

let allScoredIssues = [];
let totalIssuesAnalyzed = 0;
let currentRepoFilter = 'all';

// pageTranslations loaded from i18n/i18n-issue.js
// ========== LOADING OVERLAY ==========
function showLoading(titleKey) {
    const overlay = document.getElementById('loadingOverlay');
    const title = document.getElementById('loadingTitle');
    overlay.style.display = 'flex';
    title.textContent = t(titleKey || 'loading');
}

function updateLoadingTitle(titleKey) {
    const title = document.getElementById('loadingTitle');
    if (title) title.textContent = t(titleKey);
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// ========== HOOKS FOR common.js ==========
function onCredentialsSaved() {
    localStorage.removeItem(CACHE_KEY);
    loadIssues();
}

function onLanguageChange() {
    if (allScoredIssues.length > 0) renderDashboard();
}

// ========== REPO MANAGEMENT ==========
function getManualRepos() {
    try {
        return JSON.parse(localStorage.getItem(REPOS_KEY)) || [];
    } catch { return []; }
}

function getDiscoveredRepos() {
    try {
        return JSON.parse(localStorage.getItem(DISCOVERED_REPOS_KEY)) || [];
    } catch { return []; }
}

function getAllRepos() {
    const manual = getManualRepos();
    const discovered = getDiscoveredRepos();
    const all = [...new Set([...discovered, ...manual])];
    return all;
}

function addManualRepo() {
    const input = document.getElementById('addRepoInput');
    const repo = input.value.trim();

    if (!/^[^/]+\/[^/]+$/.test(repo)) {
        alert(t('repoInvalid'));
        return;
    }

    const manual = getManualRepos();
    const allRepos = getAllRepos();
    if (allRepos.includes(repo)) {
        alert(t('repoAlreadyTracked'));
        return;
    }

    manual.push(repo);
    localStorage.setItem(REPOS_KEY, JSON.stringify(manual));
    input.value = '';
    renderRepoChips();
}

function removeRepo(repo) {
    let manual = getManualRepos();
    manual = manual.filter(r => r !== repo);
    localStorage.setItem(REPOS_KEY, JSON.stringify(manual));

    let discovered = getDiscoveredRepos();
    discovered = discovered.filter(r => r !== repo);
    localStorage.setItem(DISCOVERED_REPOS_KEY, JSON.stringify(discovered));

    renderRepoChips();
}

function renderRepoChips() {
    const container = document.getElementById('repoChips');
    const discovered = getDiscoveredRepos();
    const manual = getManualRepos();
    const allRepos = getAllRepos();

    if (allRepos.length === 0) {
        container.innerHTML = `<span style="color: #8b949e; font-size: 13px;" data-i18n="noRepos">${t('noRepos')}</span>`;
        return;
    }

    container.innerHTML = allRepos.map(repo => {
        const isDiscovered = discovered.includes(repo);
        const cls = isDiscovered ? 'discovered' : 'manual';
        return `<span class="repo-chip ${cls}">
            ${repo}
            <button class="remove-chip" onclick="removeRepo('${repo}')" title="${t('removeRepo')}">×</button>
        </span>`;
    }).join('');
}

async function discoverRepos() {
    if (!loadCredentials()) {
        showModal();
        return;
    }

    showLoading('phaseDiscovery');
    updateProgress(20, t('discoveringRepos'));

    try {
        const result = await fetchWithAuth(
            `${API_BASE}/search/issues?q=author:${myUsername}+is:pr+is:merged&per_page=100&sort=updated`
        );

        const repos = [...new Set(
            result.items
                .map(pr => {
                    const match = pr.repository_url.match(/repos\/(.+)$/);
                    return match ? match[1] : null;
                })
                .filter(Boolean)
        )];

        localStorage.setItem(DISCOVERED_REPOS_KEY, JSON.stringify(repos));
        renderRepoChips();
        updateProgress(100, t('discoveredCount', { count: repos.length }));

        setTimeout(() => { hideLoading(); }, 1500);
    } catch (err) {
        updateProgress(100, t('error') + err.message);
        setTimeout(() => { hideLoading(); }, 3000);
    }
}

// ========== CACHE ==========
function getIssueCache() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        return cached ? JSON.parse(cached) : null;
    } catch { return null; }
}

function saveIssueCache(scoredIssues, totalAnalyzed, repos) {
    try {
        const data = {
            timestamp: Date.now(),
            repos: repos,
            totalAnalyzed: totalAnalyzed,
            scored_issues: scoredIssues.map(item => ({
                repo: item.repo,
                number: item.issue.number,
                title: item.issue.title,
                html_url: item.issue.html_url,
                labels: item.issue.labels.map(l => ({ name: l.name, color: l.color })),
                user_login: item.issue.user.login,
                created_at: item.issue.created_at,
                updated_at: item.issue.updated_at,
                comments: item.issue.comments,
                score: item.score,
                author_association: item.issue.author_association
            }))
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save issue cache:', e);
    }
}

function updateCacheInfo() {
    const cache = getIssueCache();
    const info = document.getElementById('cacheInfo');
    if (cache && cache.timestamp) {
        const age = Date.now() - cache.timestamp;
        const hours = Math.floor(age / (60 * 60 * 1000));
        const minutes = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
        const timeStr = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
        info.textContent = t('lastRefresh', { time: timeStr });
    } else {
        info.textContent = '';
    }
}

// ========== BATCH FETCH ==========
async function batchFetch(requests, batchSize = 5) {
    const results = [];
    for (let i = 0; i < requests.length; i += batchSize) {
        const batch = requests.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(req => fetchWithAuth(req.url).then(data => ({ key: req.key, data })).catch(() => ({ key: req.key, data: null })))
        );
        results.push(...batchResults);
        if (i + batchSize < requests.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
    return results;
}

// ========== SCORING ==========
function scoreIssue(issue, repoOpenPRs, comments) {
    // --- BLOCKING CRITERIA ---
    if (issue.assignee || (issue.assignees && issue.assignees.length > 0)) return null;
    if (issue.user.login.toLowerCase() === myUsername.toLowerCase()) return null;
    if (!issue.body || issue.body.length < 50) return null;

    // Check for linked PR
    const issueNum = issue.number;
    const hasLinkedPR = repoOpenPRs.some(pr => {
        const body = (pr.body || '').toLowerCase();
        return body.includes(`#${issueNum}`) ||
               body.includes(`fixes #${issueNum}`) ||
               body.includes(`closes #${issueNum}`) ||
               body.includes(`resolves #${issueNum}`);
    });
    if (hasLinkedPR) return null;

    // Must be validated by a maintainer
    const authorIsMaintainer = MAINTAINER_ASSOCIATIONS.includes(issue.author_association);
    const maintainerCommented = comments && comments.some(c =>
        MAINTAINER_ASSOCIATIONS.includes(c.author_association)
    );
    if (!authorIsMaintainer && !maintainerCommented) return null;

    // --- SCORING ---
    let score = 0;

    const labelNames = issue.labels.map(l => l.name.toLowerCase());
    if (labelNames.includes('good first issue') || labelNames.includes('help wanted')) {
        score += 3;
    }

    if (maintainerCommented) score += 2;
    if (issue.comments > 2) score += 1;
    if (issue.body && issue.body.length > 200) score += 1;

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    if (new Date(issue.updated_at).getTime() > thirtyDaysAgo) score += 1;

    if (issue.comments > 10) score -= 1;

    const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
    const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    if (new Date(issue.created_at).getTime() < oneYearAgo &&
        new Date(issue.updated_at).getTime() < threeMonthsAgo) {
        score -= 2;
    }

    return score;
}

// ========== MAIN LOAD ==========
async function loadIssues() {
    if (!loadCredentials()) return;

    const repos = getAllRepos();
    if (repos.length === 0) return;

    showLoading('loading');
    document.getElementById('dashboard').style.display = 'none';

    allScoredIssues = [];
    totalIssuesAnalyzed = 0;

    try {
        const totalSteps = repos.length * 3 + 1;
        let currentStep = 0;

        // Phase 1: Fetch issues per repo
        updateLoadingTitle('phaseIssues');
        const repoIssues = {};
        for (let i = 0; i < repos.length; i++) {
            const repo = repos[i];
            currentStep++;
            const pct = Math.round((currentStep / totalSteps) * 80);
            updateProgress(pct, t('fetchingIssues', { repo: repo.split('/')[1] }) + ` (${i + 1}/${repos.length})`);
            try {
                const issues = await fetchWithAuth(
                    `${API_BASE}/repos/${repo}/issues?state=open&per_page=30&sort=updated&direction=desc`
                );
                repoIssues[repo] = issues.filter(i => !i.pull_request);
                totalIssuesAnalyzed += repoIssues[repo].length;
            } catch {
                repoIssues[repo] = [];
            }
        }

        // Phase 2: Fetch open PRs per repo (for linked issue detection)
        updateLoadingTitle('phasePRs');
        const repoOpenPRs = {};
        for (let i = 0; i < repos.length; i++) {
            const repo = repos[i];
            currentStep++;
            const pct = Math.round((currentStep / totalSteps) * 80);
            updateProgress(pct, t('fetchingPRs', { repo: repo.split('/')[1] }) + ` (${i + 1}/${repos.length})`);
            try {
                repoOpenPRs[repo] = await fetchWithAuth(
                    `${API_BASE}/repos/${repo}/pulls?state=open&per_page=100`
                );
            } catch {
                repoOpenPRs[repo] = [];
            }
        }

        // Phase 3: Pre-filter and fetch comments for candidates
        let totalCandidates = 0;
        let processedCandidates = 0;

        // Count candidates first
        const repoCandidates = {};
        for (const repo of repos) {
            const issues = repoIssues[repo] || [];
            repoCandidates[repo] = issues.filter(issue => {
                if (issue.assignee || (issue.assignees && issue.assignees.length > 0)) return false;
                if (issue.user.login.toLowerCase() === myUsername.toLowerCase()) return false;
                if (!issue.body || issue.body.length < 50) return false;
                return true;
            });
            totalCandidates += repoCandidates[repo].length;
        }

        updateLoadingTitle('phaseComments');
        updateProgress(85, t('fetchingComments') + ` (0/${totalCandidates})`);

        for (const repo of repos) {
            currentStep++;
            const candidates = repoCandidates[repo];
            const openPRs = repoOpenPRs[repo] || [];

            const commentRequests = candidates.map(issue => ({
                key: issue.number,
                url: `${API_BASE}/repos/${repo}/issues/${issue.number}/comments?per_page=10`
            }));

            const commentResults = await batchFetch(commentRequests);
            const commentsMap = {};
            commentResults.forEach(r => { commentsMap[r.key] = r.data || []; });

            for (const issue of candidates) {
                const comments = commentsMap[issue.number] || [];
                const score = scoreIssue(issue, openPRs, comments);
                if (score !== null) {
                    allScoredIssues.push({ issue, repo, score });
                }
                processedCandidates++;
            }

            const pct = 85 + Math.round((processedCandidates / Math.max(totalCandidates, 1)) * 10);
            updateProgress(pct, t('scoringIssues') + ` (${processedCandidates}/${totalCandidates}) — ${allScoredIssues.length} ${t('statQualified').toLowerCase()}`);
        }

        // Deduplicate by issue URL
        const seen = new Set();
        allScoredIssues = allScoredIssues.filter(item => {
            const key = item.issue.html_url || `${item.repo}#${item.issue.number}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Sort by score descending
        allScoredIssues.sort((a, b) => b.score - a.score);

        // Save to cache
        saveIssueCache(allScoredIssues, totalIssuesAnalyzed, repos);

        updateLoadingTitle('phaseDone');
        updateProgress(100, `${allScoredIssues.length} ${t('statQualified').toLowerCase()} / ${totalIssuesAnalyzed} ${t('statIssues').toLowerCase()}`);
        document.getElementById('dashboard').style.display = 'block';
        renderDashboard();

        setTimeout(() => { hideLoading(); }, 800);
    } catch (err) {
        updateProgress(100, t('error') + err.message);
        console.error('Failed to load issues:', err);
        setTimeout(() => { hideLoading(); }, 3000);
    }
}

// ========== REFRESH SINGLE ISSUE ==========
async function refreshSingleIssue(repo, issueNumber) {
    const btn = document.querySelector(`[data-refresh-issue="${repo}/${issueNumber}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" style="animation: spin 1s linear infinite;"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>'; }

    try {
        const [issue, openPRs, comments] = await Promise.all([
            fetchWithAuth(`${API_BASE}/repos/${repo}/issues/${issueNumber}`),
            fetchWithAuth(`${API_BASE}/repos/${repo}/pulls?state=open&per_page=100`),
            fetchWithAuth(`${API_BASE}/repos/${repo}/issues/${issueNumber}/comments?per_page=10`)
        ]);

        // Remove old entry
        allScoredIssues = allScoredIssues.filter(
            item => !(item.repo === repo && item.issue.number === issueNumber)
        );

        // Re-score
        if (!issue.pull_request) {
            const score = scoreIssue(issue, openPRs, comments);
            if (score !== null) {
                allScoredIssues.push({ issue, repo, score });
                allScoredIssues.sort((a, b) => b.score - a.score);
            }
        }

        // Update cache
        saveIssueCache(allScoredIssues, totalIssuesAnalyzed, getAllRepos());
        renderDashboard();
    } catch (err) {
        console.error('Failed to refresh issue:', err);
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>'; }
}

// ========== REFRESH ALL ==========
function refreshAll() {
    localStorage.removeItem(CACHE_KEY);
    loadIssues();
}

// ========== COMMENTED ISSUES TRACKING ==========
function isCommented(repo, issueNumber) {
    const notes = getCommentNotes();
    return !!notes[`${repo}#${issueNumber}`];
}

// ========== COMMENT MODAL ==========
let pendingCommentRepo = '';
let pendingCommentIssue = 0;
let pendingCommentTitle = '';

function openCommentModal(repo, issueNumber, issueTitle) {
    pendingCommentRepo = repo;
    pendingCommentIssue = issueNumber;
    pendingCommentTitle = issueTitle;

    document.getElementById('commentIssueRef').textContent = `${repo.split('/')[1]}#${issueNumber}`;
    document.getElementById('commentIssueTitle').textContent = issueTitle;
    const existing = getCommentNote(repo, issueNumber);
    document.getElementById('commentText').value = existing ? existing.text : '';
    document.getElementById('commentDeleteBtn').style.display = existing ? 'inline-block' : 'none';
    document.getElementById('commentModal').style.display = 'flex';
    document.getElementById('commentText').focus();
}

function closeCommentModal() {
    document.getElementById('commentModal').style.display = 'none';
    pendingCommentRepo = '';
    pendingCommentIssue = 0;
}

function getCommentNotes() {
    try {
        return JSON.parse(localStorage.getItem(COMMENTED_KEY)) || {};
    } catch { return {}; }
}

function saveCommentNote(repo, issueNumber, text) {
    const notes = getCommentNotes();
    const key = `${repo}#${issueNumber}`;
    notes[key] = { text, date: new Date().toISOString() };
    localStorage.setItem(COMMENTED_KEY, JSON.stringify(notes));
}

function getCommentNote(repo, issueNumber) {
    const notes = getCommentNotes();
    return notes[`${repo}#${issueNumber}`] || null;
}

function deleteCommentNote(repo, issueNumber) {
    const notes = getCommentNotes();
    delete notes[`${repo}#${issueNumber}`];
    localStorage.setItem(COMMENTED_KEY, JSON.stringify(notes));
}

function updateCommentButtonState(repo, issueNumber) {
    // Find all comment buttons for this issue and update their state
    document.querySelectorAll('.comment-issue-btn').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        if (onclick.includes(`'${repo}'`) && onclick.includes(`${issueNumber},`)) {
            const hasNote = isCommented(repo, issueNumber);
            btn.classList.toggle('has-note', hasNote);
            btn.title = hasNote ? t('alreadyCommented') : t('commentBtn');
        }
    });
}

function sendComment() {
    const repo = pendingCommentRepo;
    const num = pendingCommentIssue;
    const text = document.getElementById('commentText').value.trim();
    if (!text) {
        if (isCommented(repo, num)) {
            deleteCommentNote(repo, num);
        }
    } else {
        saveCommentNote(repo, num, text);
    }
    closeCommentModal();
    updateCommentButtonState(repo, num);
    renderNotesSection();
}

function deleteComment() {
    const repo = pendingCommentRepo;
    const num = pendingCommentIssue;
    deleteCommentNote(repo, num);
    closeCommentModal();
    updateCommentButtonState(repo, num);
    renderNotesSection();
}

// ========== RENDERING ==========
function renderDashboard() {
    // Stats
    const repos = getAllRepos();
    document.getElementById('countRepos').textContent = repos.length;
    document.getElementById('countIssues').textContent = totalIssuesAnalyzed;
    document.getElementById('countQualified').textContent = allScoredIssues.length;

    // Repo filter
    renderRepoFilter();

    // Table
    const filtered = filterByRepo(allScoredIssues);
    renderIssueTable(filtered);

    // Notes section
    renderNotesSection();

    // Cache info
    updateCacheInfo();
}

function renderRepoFilter() {
    const container = document.getElementById('repoFilter');
    const repoCounts = {};
    allScoredIssues.forEach(item => {
        repoCounts[item.repo] = (repoCounts[item.repo] || 0) + 1;
    });

    const repos = Object.keys(repoCounts).sort((a, b) => repoCounts[b] - repoCounts[a]);

    let html = `<span class="repo-filter-label" data-i18n="filterByRepo">${t('filterByRepo')}</span>`;
    html += `<button class="repo-btn ${currentRepoFilter === 'all' ? 'active' : ''}" onclick="setRepoFilter('all')">${t('all')} <span class="repo-count">${allScoredIssues.length}</span></button>`;

    repos.forEach(repo => {
        const shortName = repo.split('/')[1];
        html += `<button class="repo-btn ${currentRepoFilter === repo ? 'active' : ''}" onclick="setRepoFilter('${repo}')">${shortName} <span class="repo-count">${repoCounts[repo]}</span></button>`;
    });

    container.innerHTML = html;
}

function setRepoFilter(repo) {
    currentRepoFilter = repo;
    renderDashboard();
}

function filterByRepo(items) {
    if (currentRepoFilter === 'all') return items;
    return items.filter(item => item.repo === currentRepoFilter);
}

function getScoreClass(score) {
    if (score >= 5) return 'score-high';
    if (score >= 3) return 'score-medium';
    return 'score-low';
}

function getLabelStyle(label) {
    const color = label.color || '30363d';
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const textColor = luminance > 0.5 ? '#000' : '#fff';
    return `background-color: #${color}; color: ${textColor};`;
}

function renderIssueTable(items) {
    const container = document.getElementById('issuesTable');

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>
                <h3 data-i18n="noIssues">${t('noIssues')}</h3>
                <p data-i18n="noIssuesDesc">${t('noIssuesDesc')}</p>
            </div>`;
        return;
    }

    const refreshIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>';

    let html = `<table>
        <thead><tr>
            <th>${t('thScore')}</th>
            <th>${t('thRepo')}</th>
            <th>${t('thIssue')}</th>
            <th>${t('thLabels')}</th>
            <th>${t('thAge')}</th>
            <th>${t('thComments')}</th>
            <th>${t('thLastActivity')}</th>
            <th data-no-sort>${t('thActions')}</th>
        </tr></thead><tbody>`;

    items.forEach(item => {
        const issue = item.issue;
        const shortRepo = getDisplayRepoName(item.repo);
        const labelNames = (issue.labels || []).map(l => l.name.toLowerCase());
        const isGoodFirst = labelNames.includes('good first issue') || labelNames.includes('help wanted');
        const rowClass = isGoodFirst ? 'good-first-issue' : '';

        const labelsHtml = (issue.labels || []).map(l =>
            `<span class="issue-label" style="${getLabelStyle(l)}">${l.name}</span>`
        ).join('');

        const searchText = `${item.repo} ${issue.title} ${(issue.labels || []).map(l => l.name).join(' ')}`.toLowerCase();

        const commented = isCommented(item.repo, issue.number);
        const commentBtnClass = commented ? 'comment-issue-btn has-note' : 'comment-issue-btn';
        const escapedTitle = issue.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        html += `<tr class="${rowClass}" data-search="${searchText}">
            <td><span class="score-badge ${getScoreClass(item.score)}">${item.score}</span></td>
            <td data-sort="${item.repo.toLowerCase()}"><span class="repo-btn" style="cursor:default">${shortRepo}</span></td>
            <td class="issue-title-cell"><a href="${issue.html_url}" target="_blank"><span class="issue-number">#${issue.number}</span> <span class="issue-title">${issue.title}</span></a></td>
            <td>${labelsHtml}</td>
            <td class="date" data-sort="${new Date(issue.created_at).getTime()}">${formatRelativeTime(issue.created_at)}</td>
            <td>${issue.comments}</td>
            <td class="date" data-sort="${new Date(issue.updated_at).getTime()}">${formatRelativeTime(issue.updated_at)}</td>
            <td class="actions-cell">
                <button class="${commentBtnClass}" onclick="openCommentModal('${item.repo}', ${issue.number}, '${escapedTitle}')" title="${commented ? t('alreadyCommented') : t('commentBtn')}">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>
                </button>
                <button class="refresh-issue-btn" data-refresh-issue="${item.repo}/${issue.number}" onclick="refreshSingleIssue('${item.repo}', ${issue.number})" title="Refresh">${refreshIcon}</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    const table = container.querySelector('table');
    if (table) makeTableSortable(table);
}

// ========== COMMENT MODAL INIT ==========
function initCommentModal() {
    // Close on outside click
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('commentModal');
        if (e.target === modal) closeCommentModal();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('commentModal');
        if (modal && modal.style.display === 'flex' && e.key === 'Escape') {
            closeCommentModal();
        }
    });
}

// ========== CLEANUP STALE NOTES ==========
async function cleanupStaleNotes() {
    const notes = getCommentNotes();
    const keys = Object.keys(notes);
    if (keys.length === 0) {
        alert(t('noNotesToClean'));
        return;
    }

    showLoading('loading');
    updateProgress(0, t('cleaningNotes'));

    let removed = 0;
    for (let i = 0; i < keys.length; i++) {
        const [repo, issueNum] = keys[i].split('#');
        updateProgress(Math.round(((i + 1) / keys.length) * 100), `${t('cleaningNotes')} (${i + 1}/${keys.length})`);

        try {
            const issue = await fetchWithAuth(`${API_BASE}/repos/${repo}/issues/${issueNum}`);
            // Remove note if issue is closed or has a linked PR
            if (issue.state === 'closed') {
                delete notes[keys[i]];
                removed++;
            } else if (issue.pull_request) {
                delete notes[keys[i]];
                removed++;
            }
        } catch {
            // If issue not found (404), also remove
            delete notes[keys[i]];
            removed++;
        }

        // Small delay
        if (i < keys.length - 1) await new Promise(r => setTimeout(r, 100));
    }

    localStorage.setItem(COMMENTED_KEY, JSON.stringify(notes));
    hideLoading();
    renderDashboard();
    alert(t('cleanedNotes', { count: removed }));
}

// ========== NOTES SECTION ==========
function renderNotesSection() {
    const notes = getCommentNotes();
    const keys = Object.keys(notes);
    const section = document.getElementById('notesSection');
    const container = document.getElementById('notesList');

    if (keys.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Build set of issues currently visible in the table
    const visibleKeys = new Set(
        allScoredIssues.map(item => `${item.repo}#${item.issue.number}`)
    );

    let html = '';
    keys.forEach(key => {
        const note = notes[key];
        const [repo, issueNum] = key.split('#');
        const shortRepo = repo.split('/')[1];
        const inResults = visibleKeys.has(key);
        const orphanClass = inResults ? '' : 'note-orphan';
        const issueUrl = `https://github.com/${repo}/issues/${issueNum}`;
        const escapedText = note.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        const dateStr = note.date ? formatRelativeTime(note.date) : '';

        html += `<div class="note-card ${orphanClass}">
            <div class="note-header">
                <a href="${issueUrl}" target="_blank" class="note-ref">${shortRepo}#${issueNum}</a>
                ${!inResults ? `<span class="note-orphan-badge">${t('noteNotInResults')}</span>` : ''}
                <span class="note-date">${dateStr}</span>
                <div class="note-actions">
                    <button class="comment-issue-btn has-note" onclick="openCommentModal('${repo}', ${issueNum}, '')" title="${t('edit')}">
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"></path></svg>
                    </button>
                    <button class="refresh-issue-btn" onclick="deleteCommentFromNotes('${repo}', ${issueNum})" title="${t('commentDelete')}">
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"></path></svg>
                    </button>
                </div>
            </div>
            <div class="note-body">${escapedText}</div>
        </div>`;
    });

    container.innerHTML = html;
}

function deleteCommentFromNotes(repo, issueNumber) {
    deleteCommentNote(repo, issueNumber);
    renderNotesSection();
    // Re-render table to update button state
    const filtered = filterByRepo(allScoredIssues);
    renderIssueTable(filtered);
}

// ========== SEARCH ==========
function initSearch() {
    document.getElementById('search').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('#issuesTable tbody tr').forEach(row => {
            const searchText = row.dataset.search || '';
            row.style.display = searchText.includes(query) ? '' : 'none';
        });
    });
}

// ========== LOAD FROM CACHE ==========
function loadFromCache() {
    const cache = getIssueCache();
    if (!cache || !cache.scored_issues) return false;

    const seen = new Set();
    allScoredIssues = cache.scored_issues
        .map(item => ({
            repo: item.repo,
            score: item.score,
            issue: {
                number: item.number,
                title: item.title,
                html_url: item.html_url,
                labels: item.labels,
                user: { login: item.user_login },
                created_at: item.created_at,
                updated_at: item.updated_at,
                comments: item.comments,
                author_association: item.author_association
            }
        }))
        .filter(item => {
            const key = item.issue.html_url || `${item.repo}#${item.issue.number}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    totalIssuesAnalyzed = cache.totalAnalyzed || 0;

    document.getElementById('dashboard').style.display = 'block';
    renderDashboard();
    return true;
}

// ========== INIT ==========
window.addEventListener('load', () => {
    initCommon();
    initSearch();
    initCommentModal();
    renderRepoChips();
    renderNotesSection();
    updateCacheInfo();
    updateConfigDisplay();

    if (loadCredentials()) {
        // Try loading from cache first
        const hadCache = loadFromCache();

        // If no repos discovered yet, auto-discover
        if (getAllRepos().length === 0) {
            discoverRepos().then(() => {
                if (getAllRepos().length > 0) loadIssues();
            });
        } else if (!hadCache) {
            loadIssues();
        }
    }
});
