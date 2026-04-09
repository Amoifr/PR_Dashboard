const CACHE_KEY = 'pr_dashboard_cache';
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours in ms
const OLD_PRS_KEY = 'pr_dashboard_show_old';
const CELEBRATION_KEY = 'pr_dashboard_celebration';

// Bots to ignore when determining who needs to respond
const IGNORED_BOTS = [
    'ps-jarvis',           // PrestaShop bot
    'dependabot',          // GitHub Dependabot
    'dependabot[bot]',     // GitHub Dependabot (bot format)
    'github-actions',      // GitHub Actions
    'github-actions[bot]', // GitHub Actions (bot format)
    'codecov',             // Codecov
    'codecov[bot]',        // Codecov (bot format)
    'sonarcloud',          // SonarCloud
    'sonarcloud[bot]',     // SonarCloud (bot format)
    'stale',               // Stale bot
    'stale[bot]',          // Stale bot (bot format)
    'renovate',            // Renovate
    'renovate[bot]',       // Renovate (bot format)
];

// pageTranslations loaded from i18n/i18n-dashboard.js
let allPRs = [];
let forceRefreshReviews = false;
let showOldPRs = localStorage.getItem(OLD_PRS_KEY) === 'true';
let prDonutChart = null;

// Donut chart colors - Status palette (cool tones matching KPI cards)
const STATUS_COLORS = {
    open: '#3fb950',      // Green
    approved: '#58a6ff',  // Blue
    merged: '#a371f7',    // Purple
    closed: '#f85149'     // Red
};

// Repos palette (warm/earth tones for contrast)
const REPO_COLORS = [
    '#f0883e',  // Orange
    '#d29922',  // Gold
    '#db6d28',  // Burnt orange
    '#e85d04',  // Tangerine
    '#fab387',  // Peach
    '#c69026',  // Amber
    '#f4a261',  // Sandy brown
    '#e9c46a',  // Saffron
    '#fca311',  // Yellow orange
    '#ffb703',  // Selective yellow
    '#fb8500',  // Orange peel
    '#d4a373',  // Tan
    '#dda15e',  // Earth yellow
    '#bc6c25',  // Sienna
    '#9c6644'   // Coffee
];

function updateDonutChart(filteredPRs) {
    const ctx = document.getElementById('prDonutChart');
    if (!ctx) return;

    // Calculate status distribution
    const openPRs = filteredPRs.filter(pr => pr.prState === 'OPEN');
    const approvedPRs = openPRs.filter(pr => {
        if (!pr.reviews || !Array.isArray(pr.reviews)) return false;
        return pr.reviews.some(r => r.state === 'APPROVED');
    });
    const openNotApproved = openPRs.length - approvedPRs.length;
    const mergedPRs = filteredPRs.filter(pr => pr.prState === 'MERGED');
    const closedPRs = filteredPRs.filter(pr => pr.prState === 'CLOSED');

    // Calculate repo distribution
    const repoStats = {};
    filteredPRs.forEach(pr => {
        const repoName = getRepoName(pr);
        repoStats[repoName] = (repoStats[repoName] || 0) + 1;
    });

    // Sort repos by count and take top ones
    const sortedRepos = Object.entries(repoStats)
        .sort((a, b) => b[1] - a[1]);

    const repoNames = sortedRepos.map(r => r[0]);
    const repoCounts = sortedRepos.map(r => r[1]);
    const repoColors = repoNames.map((_, i) => REPO_COLORS[i % REPO_COLORS.length]);

    // Status data (inner ring)
    const statusData = [openNotApproved, approvedPRs.length, mergedPRs.length, closedPRs.length];
    const statusLabels = ['Open', 'Approved', 'Merged', 'Closed'];
    const statusColors = [STATUS_COLORS.open, STATUS_COLORS.approved, STATUS_COLORS.merged, STATUS_COLORS.closed];
    const totalPRs = filteredPRs.length;

    // Plugin to draw text in center
    const centerTextPlugin = {
        id: 'centerText',
        afterDraw: function(chart) {
            const ctx = chart.ctx;
            const width = chart.width;
            const height = chart.height;

            ctx.restore();

            // Draw total number
            const fontSize = Math.min(width, height) / 5;
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#c9d1d9';
            ctx.fillText(totalPRs, width / 2, height / 2 - 8);

            // Draw "PRs" label
            const labelSize = fontSize / 2.5;
            ctx.font = `${labelSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
            ctx.fillStyle = '#8b949e';
            ctx.fillText('PRs', width / 2, height / 2 + fontSize / 2);

            ctx.save();
        }
    };

    // Destroy existing chart if exists
    if (prDonutChart) {
        prDonutChart.destroy();
    }

    // Create nested donut chart
    prDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: statusLabels,
            datasets: [
                {
                    // Inner ring - Status
                    data: statusData,
                    backgroundColor: statusColors,
                    borderColor: '#161b22',
                    borderWidth: 2,
                    weight: 1
                },
                {
                    // Outer ring - Repos
                    data: repoCounts,
                    backgroundColor: repoColors,
                    borderColor: '#161b22',
                    borderWidth: 2,
                    weight: 1
                }
            ]
        },
        plugins: [centerTextPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '40%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const datasetIndex = context.datasetIndex;
                            const index = context.dataIndex;
                            const value = context.raw;

                            if (datasetIndex === 0) {
                                return `${statusLabels[index]}: ${value}`;
                            } else {
                                // Show full repo name in tooltip
                                return `${repoNames[index]}: ${value}`;
                            }
                        }
                    }
                }
            }
        }
    });

    // Update custom legend
    updateDonutLegend(statusLabels, statusColors, statusData, repoNames, repoColors, repoCounts);
}

function updateDonutLegend(statusLabels, statusColors, statusData, repoNames, repoColors, repoCounts) {
    const legendContainer = document.getElementById('donutLegend');
    if (!legendContainer) return;

    // Extract just the repo name (without owner) for display
    const shortRepoNames = repoNames.map(name => {
        const parts = name.split('/');
        return parts.length > 1 ? parts[1] : name;
    });

    let html = '';

    // Status legend (inner ring)
    html += '<div class="donut-legend-section">';
    statusLabels.forEach((label, i) => {
        if (statusData[i] > 0) {
            html += `<span class="donut-legend-item"><span class="donut-legend-color" style="background: ${statusColors[i]}"></span>${label} (${statusData[i]})</span>`;
        }
    });
    html += '</div>';

    html += '<div class="donut-legend-divider"></div>';

    // Repo legend (outer ring)
    html += '<div class="donut-legend-section">';
    shortRepoNames.slice(0, 5).forEach((name, i) => {
        html += `<span class="donut-legend-item"><span class="donut-legend-color" style="background: ${repoColors[i]}"></span>${name} (${repoCounts[i]})</span>`;
    });
    if (repoNames.length > 5) {
        html += `<span class="donut-legend-item" style="color: #6e7681;">+${repoNames.length - 5} autres</span>`;
    }
    html += '</div>';

    legendContainer.innerHTML = html;
}

// Calculate and display KPI evolutions
function updateKPIEvolutions(openPRs, approvedPRs, mergedPRs, closedPRs) {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Count PRs by period using created_at for Open, updated_at for Merged/Closed
    function countSince(prs, since, dateField = 'updated_at') {
        return prs.filter(pr => new Date(pr[dateField]) >= since).length;
    }

    // Count PRs between two dates
    function countBetween(prs, from, to, dateField = 'updated_at') {
        return prs.filter(pr => {
            const date = new Date(pr[dateField]);
            return date >= from && date < to;
        }).length;
    }

    // Count PRs that received an approval since a date
    function countApprovedSince(prs, since) {
        return prs.filter(pr => {
            if (!pr.reviews || !Array.isArray(pr.reviews)) return false;
            const approvals = pr.reviews.filter(r => r.state === 'APPROVED');
            if (approvals.length === 0) return false;
            return approvals.some(r => {
                const reviewDate = new Date(r.submitted_at || r.created_at);
                return reviewDate >= since;
            });
        }).length;
    }

    // Count PRs that received an approval between two dates
    function countApprovedBetween(prs, from, to) {
        return prs.filter(pr => {
            if (!pr.reviews || !Array.isArray(pr.reviews)) return false;
            const approvals = pr.reviews.filter(r => r.state === 'APPROVED');
            if (approvals.length === 0) return false;
            return approvals.some(r => {
                const reviewDate = new Date(r.submitted_at || r.created_at);
                return reviewDate >= from && reviewDate < to;
            });
        }).length;
    }

    // Current week (last 7 days)
    const openWeek = countSince(openPRs, lastWeek, 'created_at');
    const approvedWeek = countApprovedSince(approvedPRs, lastWeek);
    const mergedWeek = countSince(mergedPRs, lastWeek);
    const closedWeek = countSince(closedPRs, lastWeek);

    // Previous week (7-14 days ago)
    const openPrevWeek = countBetween(openPRs, twoWeeksAgo, lastWeek, 'created_at');
    const approvedPrevWeek = countApprovedBetween(approvedPRs, twoWeeksAgo, lastWeek);
    const mergedPrevWeek = countBetween(mergedPRs, twoWeeksAgo, lastWeek);
    const closedPrevWeek = countBetween(closedPRs, twoWeeksAgo, lastWeek);

    // Other periods for display
    const openDay = countSince(openPRs, yesterday, 'created_at');
    const openMonth = countSince(openPRs, lastMonth, 'created_at');
    const approvedDay = countApprovedSince(approvedPRs, yesterday);
    const approvedMonth = countApprovedSince(approvedPRs, lastMonth);
    const mergedDay = countSince(mergedPRs, yesterday);
    const mergedMonth = countSince(mergedPRs, lastMonth);
    const closedDay = countSince(closedPRs, yesterday);
    const closedMonth = countSince(closedPRs, lastMonth);

    // Render trend arrow: compare current week vs previous week
    function renderTrend(elementId, currentWeek, previousWeek) {
        const el = document.getElementById(elementId);
        if (!el) return;

        if (currentWeek > previousWeek) {
            el.textContent = '↑';
            el.className = 'stat-trend up';
        } else if (currentWeek < previousWeek) {
            el.textContent = '↓';
            el.className = 'stat-trend down';
        } else {
            el.textContent = '=';
            el.className = 'stat-trend neutral';
        }
    }

    // Render evolution badges
    function renderEvolution(elementId, day, week, month) {
        const el = document.getElementById(elementId);
        if (!el) return;

        let html = '';
        if (day > 0) {
            html += `<span class="stat-diff up" title="Depuis hier">+${day} <span class="stat-diff-label">24h</span></span>`;
        }
        if (week > 0) {
            html += `<span class="stat-diff up" title="Cette semaine">+${week} <span class="stat-diff-label">7j</span></span>`;
        }
        if (month > 0) {
            html += `<span class="stat-diff up" title="Ce mois">+${month} <span class="stat-diff-label">30j</span></span>`;
        }
        if (!html) {
            html = '<span class="stat-diff neutral">-</span>';
        }
        el.innerHTML = html;
    }

    // Update trends (compare current week vs previous week)
    renderTrend('trend-open', openWeek, openPrevWeek);
    renderTrend('trend-approved', approvedWeek, approvedPrevWeek);
    renderTrend('trend-merged', mergedWeek, mergedPrevWeek);
    renderTrend('trend-closed', closedWeek, closedPrevWeek);

    // Update evolution details
    renderEvolution('evolution-open', openDay, openWeek, openMonth);
    renderEvolution('evolution-approved', approvedDay, approvedWeek, approvedMonth);
    renderEvolution('evolution-merged', mergedDay, mergedWeek, mergedMonth);
    renderEvolution('evolution-closed', closedDay, closedWeek, closedMonth);
}

// Badges calculation and rendering
function updateBadges(mergedPRs) {
    const badgesList = document.getElementById('badgesList');
    if (!badgesList) return;

    // Count merged PRs per repo
    const repoMergedCounts = {};
    const repoOwners = {};
    mergedPRs.forEach(pr => {
        const repoName = getRepoName(pr);
        repoMergedCounts[repoName] = (repoMergedCounts[repoName] || 0) + 1;
        // Extract owner from repo name (owner/repo)
        const owner = repoName.split('/')[0];
        repoOwners[repoName] = owner;
    });

    // No merged PRs
    if (Object.keys(repoMergedCounts).length === 0) {
        badgesList.innerHTML = `<div class="badges-empty">${t('noBadges')}</div>`;
        return;
    }

    // Sort by count (descending)
    const sortedRepos = Object.entries(repoMergedCounts).sort((a, b) => b[1] - a[1]);

    // Generate badges HTML
    let html = '';
    sortedRepos.forEach(([repoName, count]) => {
        const badge = getBadgeInfo(count);
        const owner = repoOwners[repoName];
        const shortName = repoName.split('/')[1] || repoName;
        const avatarUrl = `https://github.com/${owner}.png?size=40`;

        html += `
            <div class="badge-item">
                <img src="${avatarUrl}" alt="${owner}" style="width: 32px; height: 32px; border-radius: 6px; border: 1px solid #30363d;">
                <span class="badge-medal">${badge.emoji}</span>
                <div class="badge-info">
                    <div class="badge-repo" title="${repoName}">${shortName}</div>
                    <div class="badge-count">${count} ${t('mergedPrs')}</div>
                </div>
                <span class="badge-level ${badge.level}">${t('badge' + badge.levelName)}</span>
            </div>
        `;
    });

    badgesList.innerHTML = html;
}

function getBadgeInfo(count) {
    if (count >= 50) return { emoji: '👑', level: 'legendary', levelName: 'Legendary' };
    if (count >= 20) return { emoji: '🏆', level: 'platinum', levelName: 'Platinum' };
    if (count >= 10) return { emoji: '💎', level: 'diamond', levelName: 'Diamond' };
    if (count >= 6) return { emoji: '🥇', level: 'gold', levelName: 'Gold' };
    if (count >= 3) return { emoji: '🥈', level: 'silver', levelName: 'Silver' };
    return { emoji: '🥉', level: 'bronze', levelName: 'Bronze' };
}

// Credentials management
// Hook called by common.js after credentials saved
function onCredentialsSaved() {
    localStorage.removeItem(CACHE_KEY);
    loadData();
}

// Hook called by common.js on language change
function onLanguageChange() {
    if (allPRs.length > 0) renderDashboard();
}

// Celebration functions
function getCelebrationState() {
    try {
        const stored = localStorage.getItem(CELEBRATION_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        return null;
    }
}

function saveCelebrationState(approvedPRs, mergedPRs) {
    const state = {
        approvedUrls: approvedPRs.map(pr => pr.html_url),
        mergedUrls: mergedPRs.map(pr => pr.html_url)
    };
    localStorage.setItem(CELEBRATION_KEY, JSON.stringify(state));
}

function detectNewCelebrations(currentApproved, currentMerged, previousState) {
    if (!previousState) return { newApproved: [], newMerged: [] };

    const prevApprovedSet = new Set(previousState.approvedUrls || []);
    const prevMergedSet = new Set(previousState.mergedUrls || []);

    const newApproved = currentApproved.filter(pr => !prevApprovedSet.has(pr.html_url));
    const newMerged = currentMerged.filter(pr => !prevMergedSet.has(pr.html_url));

    return { newApproved, newMerged };
}

function generateConfetti() {
    const container = document.getElementById('confettiContainer');
    container.innerHTML = '';

    const colors = ['#58a6ff', '#a371f7', '#3fb950', '#f78166', '#ffd33d', '#ff7b72'];
    const shapes = ['square', 'circle', 'triangle'];

    for (let i = 0; i < 150; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti ' + shapes[Math.floor(Math.random() * shapes.length)];

        const color = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.setProperty('--confetti-color', color);
        confetti.style.backgroundColor = color;
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDelay = Math.random() * 2 + 's';
        confetti.style.animationDuration = (2 + Math.random() * 2) + 's';

        container.appendChild(confetti);
    }

    // Clean up after animation
    setTimeout(() => {
        container.innerHTML = '';
    }, 5000);
}

function showCelebration(newApproved, newMerged) {
    let content = '';

    if (newApproved.length > 0) {
        content += `<div class="celebration-section approved">
            <h4>✅ ${t('newApprovals')}</h4>
            <ul class="celebration-list">`;
        newApproved.forEach(pr => {
            const repo = pr.html_url.match(/github\.com\/([^\/]+\/[^\/]+)/)?.[1] || '';
            content += `<li>
                <a href="${pr.html_url}" target="_blank">
                    <div class="pr-repo">${repo}</div>
                    <div class="pr-title">#${pr.number} - ${pr.title}</div>
                </a>
            </li>`;
        });
        content += '</ul></div>';
    }

    if (newMerged.length > 0) {
        content += `<div class="celebration-section merged">
            <h4>🔀 ${t('newMerges')}</h4>
            <ul class="celebration-list">`;
        newMerged.forEach(pr => {
            const repo = pr.html_url.match(/github\.com\/([^\/]+\/[^\/]+)/)?.[1] || '';
            content += `<li>
                <a href="${pr.html_url}" target="_blank">
                    <div class="pr-repo">${repo}</div>
                    <div class="pr-title">#${pr.number} - ${pr.title}</div>
                </a>
            </li>`;
        });
        content += '</ul></div>';
    }

    document.getElementById('celebrationContent').innerHTML = content;
    document.getElementById('celebrationModal').style.display = 'flex';
    generateConfetti();
}

function hideCelebrationModal() {
    document.getElementById('celebrationModal').style.display = 'none';
    document.getElementById('confettiContainer').innerHTML = '';
}

function toggleOldPRs() {
    showOldPRs = document.getElementById('showOldPRs').checked;
    localStorage.setItem(OLD_PRS_KEY, showOldPRs);
    renderDashboard();
}

function isOlderThan2Years(pr) {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return new Date(pr.created_at) < twoYearsAgo;
}

function getFilteredPRs() {
    if (showOldPRs) {
        return allPRs;
    }
    return allPRs.filter(pr => !isOlderThan2Years(pr));
}

// Cache functions
function getCache() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        return cached ? JSON.parse(cached) : { reviews: {}, comments: {}, timestamp: 0 };
    } catch (e) {
        return { reviews: {}, comments: {}, timestamp: 0 };
    }
}

function saveCache(cache) {
    try {
        cache.timestamp = Date.now();
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        updateCacheInfo();
    } catch (e) {
        console.warn('Failed to save cache:', e);
    }
}

function isCacheValid() {
    const cache = getCache();
    return (Date.now() - cache.timestamp) < CACHE_DURATION;
}

function updateCacheInfo() {
    const cache = getCache();
    const info = document.getElementById('cacheInfo');
    if (cache.timestamp) {
        const age = Date.now() - cache.timestamp;
        const hours = Math.floor(age / (60 * 60 * 1000));
        const minutes = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
        const reviewCount = Object.keys(cache.reviews).length;
        const timeStr = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
        info.textContent = t('cacheInfo', { count: reviewCount, time: timeStr });
    } else {
        info.textContent = t('noCache');
    }
}

function forceRefresh() {
    forceRefreshReviews = true;
    loadData();
}

let forceRefreshAllPRs = false;

function forceRefreshAll() {
    forceRefreshReviews = true;
    forceRefreshAllPRs = true;
    hideRefreshDropdown();
    loadData();
}

function toggleRefreshDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('refreshDropdown');
    dropdown.classList.toggle('show');
}

function hideRefreshDropdown() {
    const dropdown = document.getElementById('refreshDropdown');
    dropdown.classList.remove('show');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.refresh-btn-group')) {
        hideRefreshDropdown();
    }
});

async function loadData() {
    if (!loadCredentials()) {
        return; // No credentials, don't load
    }

    const progress = document.getElementById('progress');
    progress.style.display = 'block';

    try {
        // Load MY PRs across all GitHub
        updateProgress(10, t('loadingOpen'));
        const myOpenPRs = await fetchWithAuth(
            `${API_BASE}/search/issues?q=author:${myUsername}+is:pr+is:open&per_page=100&sort=updated`
        );

        updateProgress(40, t('loadingMerged'));
        const myMergedPRs = await fetchWithAuth(
            `${API_BASE}/search/issues?q=author:${myUsername}+is:pr+is:merged&per_page=100&sort=updated`
        );

        updateProgress(70, t('loadingClosed'));
        const myClosedPRs = await fetchWithAuth(
            `${API_BASE}/search/issues?q=author:${myUsername}+is:pr+is:closed+is:unmerged&per_page=50&sort=updated`
        );

        updateProgress(80, t('processing'));

        // Process only MY PRs
        allPRs = [
            ...myOpenPRs.items.map(pr => ({ ...pr, prState: 'OPEN' })),
            ...myMergedPRs.items.map(pr => ({ ...pr, prState: 'MERGED' })),
            ...myClosedPRs.items.map(pr => ({ ...pr, prState: 'CLOSED' }))
        ];

        // Deduplicate by url (more reliable than number across repos)
        const seen = new Set();
        allPRs = allPRs.filter(pr => {
            if (seen.has(pr.html_url)) return false;
            seen.add(pr.html_url);
            return true;
        });

        // Show PRs immediately (without reviews yet)
        updateProgress(85, t('displaying'));
        document.getElementById('dashboard').style.display = 'block';
        renderDashboard();

        // Load reviews and comments (with cache)
        updateProgress(90, t('loadingReviews'));
        const cache = getCache();
        const cacheValid = isCacheValid() && !forceRefreshReviews;
        let prsToFetch = [];
        let cacheHits = 0;

        // First pass: apply cache where available (skip old PRs if hidden)
        for (const pr of allPRs) {
            // Skip old PRs if they are hidden
            if (!showOldPRs && isOlderThan2Years(pr)) {
                continue;
            }

            const cacheKey = pr.html_url;
            // Cache is valid only if reviews AND comments are present
            const hasCompleteCache = cacheValid && cache.reviews[cacheKey] && cache.comments?.[cacheKey];
            if (hasCompleteCache) {
                pr.reviews = cache.reviews[cacheKey];
                pr.issueComments = cache.comments[cacheKey] || [];
                pr.reviewComments = cache.reviewComments?.[cacheKey] || [];
                pr.checks = cache.checks?.[cacheKey] || null;
                cacheHits++;
            } else if (pr.prState === 'OPEN' || forceRefreshAllPRs) {
                // Auto-fetch reviews for OPEN PRs
                // For Merged/Closed PRs: only fetch if forceRefreshAllPRs is true
                prsToFetch.push(pr);
            }
        }

        // Show cached data immediately
        if (cacheHits > 0) {
            renderDashboard();
            updateProgress(90, t('cached', { hits: cacheHits, toFetch: prsToFetch.length }));
        }

        // Fetch missing/outdated reviews
        if (!cache.reviewComments) cache.reviewComments = {};
        if (!cache.checks) cache.checks = {};
        for (let i = 0; i < prsToFetch.length; i++) {
            try {
                const pr = prsToFetch[i];
                const repo = getRepoName(pr);

                // Load reviews, issue comments, review comments, and CI checks in parallel
                const [reviews, comments, reviewComments, checkRuns] = await Promise.all([
                    fetchWithAuth(`${API_BASE}/repos/${repo}/pulls/${pr.number}/reviews`),
                    fetchWithAuth(`${API_BASE}/repos/${repo}/issues/${pr.number}/comments`),
                    fetchWithAuth(`${API_BASE}/repos/${repo}/pulls/${pr.number}/comments`),
                    fetchWithAuth(`${API_BASE}/repos/${repo}/commits/pull/${pr.number}/head/check-runs`).catch(() => null)
                ]);
                pr.reviews = reviews;
                pr.issueComments = comments;
                pr.reviewComments = reviewComments;
                // Process check runs to get overall status
                pr.checks = processCheckRuns(checkRuns);

                // Save to cache
                cache.reviews[pr.html_url] = reviews;
                cache.comments[pr.html_url] = comments;
                cache.reviewComments[pr.html_url] = reviewComments;
                cache.checks[pr.html_url] = pr.checks;

                // Update display every 5 PRs or at the end
                if (i % 5 === 4 || i === prsToFetch.length - 1) {
                    renderDashboard();
                    saveCache(cache);
                }
            } catch (e) {
                // Ignore individual errors (rate limiting, etc.)
            }
            updateProgress(90 + (i / prsToFetch.length) * 10, t('reviews', { current: i + 1, total: prsToFetch.length }));
            // Small delay to avoid rate limiting
            if (i % 10 === 9) await new Promise(r => setTimeout(r, 300));
        }

        // Final save
        if (prsToFetch.length > 0) {
            saveCache(cache);
        }

        forceRefreshReviews = false;
        forceRefreshAllPRs = false;
        updateProgress(100, t('done'));
        progress.style.display = 'none';
        updateCacheInfo();

    } catch (error) {
        alert(t('error') + error.message);
        console.error(error);
        progress.style.display = 'none';
    }
}

// Load reviews for a single PR on demand (for merged/closed PRs)
async function loadReviewsForPR(prUrl) {
    const pr = allPRs.find(p => p.html_url === prUrl);
    if (!pr) return;

    // Find and disable the button
    const btn = document.querySelector(`button.load-reviews-btn[onclick*="${prUrl.replace(/'/g, "\\'")}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = t('loadingReviewsBtn');
    }

    try {
        const repo = getRepoName(pr);
        const [reviews, comments, reviewComments, checkRuns] = await Promise.all([
            fetchWithAuth(`${API_BASE}/repos/${repo}/pulls/${pr.number}/reviews`),
            fetchWithAuth(`${API_BASE}/repos/${repo}/issues/${pr.number}/comments`),
            fetchWithAuth(`${API_BASE}/repos/${repo}/pulls/${pr.number}/comments`),
            fetchWithAuth(`${API_BASE}/repos/${repo}/commits/pull/${pr.number}/head/check-runs`).catch(() => null)
        ]);

        pr.reviews = reviews;
        pr.issueComments = comments;
        pr.reviewComments = reviewComments;
        pr.checks = processCheckRuns(checkRuns);

        // Save to cache
        const cache = getCache();
        cache.reviews[pr.html_url] = reviews;
        cache.comments[pr.html_url] = comments;
        if (!cache.reviewComments) cache.reviewComments = {};
        cache.reviewComments[pr.html_url] = reviewComments;
        if (!cache.checks) cache.checks = {};
        cache.checks[pr.html_url] = pr.checks;
        saveCache(cache);

        // Re-render to show the loaded data
        renderDashboard();
    } catch (e) {
        console.error('Error loading reviews for PR:', prUrl, e);
        if (btn) {
            btn.disabled = false;
            btn.textContent = t('loadReviewsBtn');
        }
    }
}

function getComponents(pr) {
    return pr.labels
        .filter(l => !['Feature', 'Status: Reviewed', 'Bug', 'Deprecation'].includes(l.name))
        .map(l => l.name);
}

function isApproved(pr) {
    if (!pr.reviews || pr.reviews.length === 0) return false;

    // Get latest review state per reviewer
    const reviewerMap = {};
    pr.reviews.forEach(r => {
        if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') return;
        reviewerMap[r.user.login] = r.state;
    });

    const states = Object.values(reviewerMap);
    // Approved if more approvals than changes requested
    const approvedCount = states.filter(s => s === 'APPROVED').length;
    const changesCount = states.filter(s => s === 'CHANGES_REQUESTED').length;
    return approvedCount > 0 && approvedCount > changesCount;
}

function getApprovedStatus(pr) {
    if (!pr.reviews || pr.reviews.length === 0) return '-';

    // Get unique reviewers by state (keep only latest review per user)
    const reviewerMap = {};
    pr.reviews.forEach(r => {
        if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') return;
        reviewerMap[r.user.login] = {
            state: r.state,
            login: r.user.login,
            avatar: r.user.avatar_url
        };
    });

    const approvers = Object.values(reviewerMap).filter(r => r.state === 'APPROVED');

    if (approvers.length === 0) return '-';

    let html = `<span class="review-approved">✅ ${approvers.length}</span> `;
    approvers.forEach(r => {
        html += `<span class="reviewer" title="@${r.login}">`;
        html += `<img src="${r.avatar}&s=36" class="reviewer-avatar" alt="${r.login}">`;
        html += `</span>`;
    });

    return html;
}

function getReviewStatus(pr) {
    const hasReviews = pr.reviews && pr.reviews.length > 0;
    const hasComments = pr.issueComments && pr.issueComments.length > 0;
    const hasReviewComments = pr.reviewComments && pr.reviewComments.length > 0;

    // For merged/closed PRs without loaded reviews, show a load button
    if ((pr.prState === 'MERGED' || pr.prState === 'CLOSED') && !pr.reviews) {
        const escapedUrl = pr.html_url.replace(/'/g, "\\'");
        return `<button class="load-reviews-btn" onclick="loadReviewsForPR('${escapedUrl}')">${t('loadReviewsBtn')}</button>`;
    }

     if (!hasReviews && !hasComments && !hasReviewComments) return `<span class="review-pending">⏳ ${t('pending')}</span>`;

    // Get unique reviewers by state (keep only latest review per user)
    const reviewerMap = {};
    let commentedCount = 0;
    let lastActivity = null; // {user, time, type}

    // Process reviews
    if (hasReviews) {
        pr.reviews.forEach(r => {
            if (!r.user) return;

            const reviewTime = new Date(r.submitted_at || r.created_at);
            if (!lastActivity || reviewTime > lastActivity.time) {
                lastActivity = {
                    user: r.user.login,
                    time: reviewTime,
                    type: r.state // APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING
                };
            }

            if (r.state === 'COMMENTED') {
                commentedCount++;
            } else if (r.state !== 'PENDING') {
                reviewerMap[r.user.login] = {
                    state: r.state,
                    login: r.user.login,
                    avatar: r.user.avatar_url
                };
            }
        });
    }

    // Helper to check if a user is a bot
    const isBot = (login) => IGNORED_BOTS.some(bot => login.toLowerCase() === bot.toLowerCase());

    // Process issue comments (to find the real last commenter)
    if (hasComments) {
        pr.issueComments.forEach(c => {
            if (!c.user) return;
            const commentTime = new Date(c.created_at);
            // Only consider non-bot comments for lastActivity
            if (!isBot(c.user.login) && (!lastActivity || commentTime > lastActivity.time)) {
                lastActivity = {
                    user: c.user.login,
                    time: commentTime,
                    type: 'COMMENT'
                };
            }
        });
        // Count all comments (including bots) for the comment counter
        commentedCount += pr.issueComments.length;
    }

    // Process review comments (inline comments and thread replies)
    if (hasReviewComments) {
        pr.reviewComments.forEach(c => {
            if (!c.user) return;
            const commentTime = new Date(c.created_at);
            // Only consider non-bot comments for lastActivity
            if (!isBot(c.user.login) && (!lastActivity || commentTime > lastActivity.time)) {
                lastActivity = {
                    user: c.user.login,
                    time: commentTime,
                    type: 'COMMENT'
                };
            }
        });
        // Count all comments (including bots) for the comment counter
        commentedCount += pr.reviewComments.length;
    }

    const changesRequested = Object.values(reviewerMap).filter(r => r.state === 'CHANGES_REQUESTED');

    let html = '';

    // Changes requested
    if (changesRequested.length > 0) {
        html += `<span class="review-changes">❌ ${changesRequested.length}</span>`;
        changesRequested.forEach(r => {
            html += `<span class="reviewer" title="@${r.login} - Changes requested">`;
            html += `<img src="${r.avatar}&s=36" class="reviewer-avatar" style="border-color:#f85149;" alt="${r.login}">`;
            html += `</span>`;
        });
    }

    // Comments
    if (commentedCount > 0) {
        html += ` <span class="review-commented" title="${commentedCount} ${t('comments')}">💬 ${commentedCount}</span>`;
    }

    // Flag: who needs to respond? (only for open PRs)
    if (lastActivity && pr.prState === 'OPEN') {
        const isMeLastActor = lastActivity.user.toLowerCase() === myUsername.toLowerCase();
        const isMyPR = pr.user.login.toLowerCase() === myUsername.toLowerCase();
        const lastWasApproval = lastActivity.type === 'APPROVED';

        if (isMyPR) {
            if (isMeLastActor) {
                // I was the last to comment/act - waiting for reviewer
                html += `<span class="their-turn" title="${t('lastCommentMe')}">⏸️ ${t('waiting')}</span>`;
            } else if (lastWasApproval) {
                // Someone approved - no action needed from me, waiting for merge
                html += `<span class="their-turn" title="${t('approvedBy', { user: lastActivity.user })}">✅ ${t('approved')}</span>`;
            } else {
                // Someone else commented/requested changes - I need to respond
                html += `<span class="my-turn" title="${t('lastComment')} @${lastActivity.user}">🎯 ${t('myTurn')}</span>`;
            }
        } else {
            if (isMeLastActor) {
                html += `<span class="their-turn" title="${t('lastCommentMe')}">⏸️ ${t('waiting')}</span>`;
            }
        }
    }

    return html || '-';
}

function processCheckRuns(checkRuns) {
    if (!checkRuns || !checkRuns.check_runs) return null;

    const runs = checkRuns.check_runs;
    const total = checkRuns.total_count || runs.length;

    if (total === 0) return { state: 'none', total: 0 };

    const conclusions = runs.map(r => r.conclusion).filter(c => c);
    const statuses = runs.map(r => r.status);

    // If any are still in progress
    if (statuses.some(s => s === 'in_progress' || s === 'queued')) {
        return { state: 'pending', total };
    }

    // If any failed
    if (conclusions.some(c => c === 'failure' || c === 'cancelled' || c === 'timed_out')) {
        return { state: 'failure', total };
    }

    // All success
    if (conclusions.every(c => c === 'success' || c === 'skipped' || c === 'neutral')) {
        return { state: 'success', total };
    }

    return { state: 'pending', total };
}

function getCIStatus(pr) {
    if (!pr.checks) return '<span class="checks-pending" title="CI non disponible">⏳</span>';

    const { state, total } = pr.checks;

    if (state === 'success') {
        return `<span class="checks-pass" title="${total} checks passed">✅</span>`;
    } else if (state === 'failure') {
        return `<span class="checks-fail" title="CI failed">❌</span>`;
    } else if (state === 'pending') {
        return `<span class="checks-pending" title="CI in progress">🔄</span>`;
    } else if (state === 'none') {
        return `<span class="checks-pending" title="No CI">-</span>`;
    } else {
        return `<span class="checks-pending" title="${state || 'unknown'}">⏳</span>`;
    }
}

function getRepoName(pr) {
    // Extract repo from html_url: https://github.com/owner/repo/pull/123
    const match = pr.html_url.match(/github\.com\/([^\/]+\/[^\/]+)/);
    return match ? match[1] : 'unknown';
}

function createTable(prs) {
    if (prs.length === 0) {
        return `<p style="text-align:center; padding:40px; color:#8b949e;">${t('noPr')}</p>`;
    }

    let html = `<table>
        <thead>
            <tr>
                <th>${t('thRepo')}</th>
                <th>#</th>
                <th>${t('thTitle')}</th>
                <th>${t('thAuthor')}</th>
                <th>${t('thLabels')}</th>
                <th>CI</th>
                <th>${t('thApproved')}</th>
                <th>${t('thReviews')}</th>
                <th>${t('thCreated')}</th>
                <th>${t('thActivity')}</th>
            </tr>
        </thead>
        <tbody>`;

    prs.forEach(pr => {
        const repo = getRepoName(pr);
        const components = getComponents(pr).map(c =>
            `<span class="label label-component">${c}</span>`
        ).join('');

        const isMine = pr.user.login.toLowerCase() === myUsername.toLowerCase();
        const mineLabel = isMine ? '<span class="label label-mine">MOI</span> ' : '';

        // Determine row class based on PR state
        let rowClass = '';
        if (pr.prState === 'MERGED') {
            rowClass = 'pr-merged';
        } else if (pr.prState === 'CLOSED') {
            rowClass = 'pr-closed';
        } else if (pr.prState === 'OPEN' && isApproved(pr)) {
            rowClass = 'pr-approved';
        }

        html += `<tr class="${rowClass}" data-search="${pr.title.toLowerCase()} ${pr.user.login.toLowerCase()} ${repo.toLowerCase()} ${getComponents(pr).join(' ').toLowerCase()}">
            <td><span class="label" style="background:#30363d;">${repo.split('/')[1] || repo}</span></td>
            <td><a href="${pr.html_url}" target="_blank" class="pr-number">#${pr.number}</a></td>
            <td class="title-cell">${mineLabel}<a href="${pr.html_url}" target="_blank" class="pr-title">${pr.title}</a></td>
            <td class="author">@${pr.user.login}</td>
            <td>${components}</td>
            <td class="status">${getCIStatus(pr)}</td>
            <td>${getApprovedStatus(pr)}</td>
            <td>${getReviewStatus(pr)}</td>
            <td class="date">${formatDate(pr.created_at)}</td>
            <td class="date">${formatDate(pr.updated_at)}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    return html;
}

let currentRepoFilter = 'all';
let celebrationChecked = false;

function getUniqueRepos() {
    const repos = {};
    getFilteredPRs().forEach(pr => {
        const repo = getRepoName(pr);
        repos[repo] = (repos[repo] || 0) + 1;
    });
    return Object.entries(repos).sort((a, b) => b[1] - a[1]);
}

function renderRepoFilter() {
    const filteredPRs = getFilteredPRs();
    const repos = getUniqueRepos();
    const container = document.getElementById('repoFilter');
    container.innerHTML = `<span class="repo-filter-label">${t('filterByRepo')}</span>`;

    // Add "All" button
    const totalCount = filteredPRs.length;
    container.innerHTML += `<button class="repo-btn ${currentRepoFilter === 'all' ? 'active' : ''}" data-repo="all">${t('all')} <span class="repo-count">${totalCount}</span></button>`;

    // Add repo buttons
    repos.forEach(([repo, count]) => {
        const shortName = repo.split('/')[1] || repo;
        const isActive = currentRepoFilter === repo ? 'active' : '';
        container.innerHTML += `<button class="repo-btn ${isActive}" data-repo="${repo}">${shortName} <span class="repo-count">${count}</span></button>`;
    });

    // Add click handlers
    container.querySelectorAll('.repo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentRepoFilter = btn.dataset.repo;
            renderRepoFilter();
            renderDashboard();
        });
    });
}

function filterByRepo(prs) {
    if (currentRepoFilter === 'all') return prs;
    return prs.filter(pr => getRepoName(pr) === currentRepoFilter);
}

function renderDashboard() {
    // Render repo filter buttons
    renderRepoFilter();

    // Apply filters: repo + old PRs toggle
    const filteredPRs = filterByRepo(getFilteredPRs());

    const minePRs = filteredPRs.filter(pr => pr.user.login.toLowerCase() === myUsername.toLowerCase());
    const openPRs = filteredPRs.filter(pr => pr.prState === 'OPEN');
    const approvedPRs = openPRs.filter(pr => {
        if (!pr.reviews || !Array.isArray(pr.reviews)) return false;
        return pr.reviews.some(r => r.state === 'APPROVED');
    });
    const mergedPRs = filteredPRs.filter(pr => pr.prState === 'MERGED');
    const closedPRs = filteredPRs.filter(pr => pr.prState === 'CLOSED');

    // Update counts
    document.getElementById('count-open').textContent = openPRs.length;
    document.getElementById('count-approved').textContent = approvedPRs.length;
    document.getElementById('count-merged').textContent = mergedPRs.length;
    document.getElementById('count-closed').textContent = closedPRs.length;
    document.getElementById('tab-count-mine').textContent = minePRs.length;
    document.getElementById('tab-count-open').textContent = openPRs.length;
    document.getElementById('tab-count-approved').textContent = approvedPRs.length;
    document.getElementById('tab-count-merged').textContent = mergedPRs.length;
    document.getElementById('tab-count-closed').textContent = closedPRs.length;

    // Update donut chart
    updateDonutChart(filteredPRs);

    // Update KPI evolutions
    updateKPIEvolutions(openPRs, approvedPRs, mergedPRs, closedPRs);

    // Update badges (only user's merged PRs)
    const myMergedPRsForBadges = mergedPRs.filter(pr => pr.user.login.toLowerCase() === myUsername.toLowerCase());
    updateBadges(myMergedPRsForBadges);

    // Check for celebrations (only once per page load, only for user's PRs)
    if (!celebrationChecked && currentRepoFilter === 'all') {
        celebrationChecked = true;
        const myApprovedPRs = approvedPRs.filter(pr => pr.user.login.toLowerCase() === myUsername.toLowerCase());
        const myMergedPRs = mergedPRs.filter(pr => pr.user.login.toLowerCase() === myUsername.toLowerCase());

        const previousState = getCelebrationState();
        const { newApproved, newMerged } = detectNewCelebrations(myApprovedPRs, myMergedPRs, previousState);

        // Save current state
        saveCelebrationState(myApprovedPRs, myMergedPRs);

        // Trigger celebration if there are new approvals or merges
        if (newApproved.length > 0 || newMerged.length > 0) {
            setTimeout(() => showCelebration(newApproved, newMerged), 500);
        }
    }

    // Render tables
    document.getElementById('content-mine').innerHTML = createTable(minePRs);
    document.getElementById('content-open').innerHTML = createTable(openPRs);
    document.getElementById('content-approved').innerHTML = createTable(approvedPRs);
    document.getElementById('content-merged').innerHTML = createTable(mergedPRs);
    document.getElementById('content-closed').innerHTML = createTable(closedPRs);
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('content-' + tab.dataset.tab).classList.add('active');
    });
});

// Search functionality
document.getElementById('search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('tbody tr').forEach(row => {
        const searchText = row.dataset.search || '';
        row.style.display = searchText.includes(query) ? '' : 'none';
    });
});

// Close celebration modal on outside click / Escape
document.addEventListener('click', (e) => {
    const celebrationModal = document.getElementById('celebrationModal');
    if (e.target === celebrationModal) hideCelebrationModal();
});
document.addEventListener('keydown', (e) => {
    const celebrationModal = document.getElementById('celebrationModal');
    if (celebrationModal && celebrationModal.style.display === 'flex' && e.key === 'Escape') {
        hideCelebrationModal();
    }
});

// Auto-load on page ready
window.addEventListener('load', () => {
    initCommon();

    // Initialize switch state from localStorage
    document.getElementById('showOldPRs').checked = showOldPRs;
    updateCacheInfo();
    updateConfigDisplay();

    // Load data only if credentials exist
    if (loadCredentials()) {
        loadData();
    }
});
