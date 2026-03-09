// --- ЗАГРУЗКА ТЕМЫ (Защита от мерцания) ---
try {
    if (localStorage.getItem('fimax_theme') === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }
} catch (e) {}

// =================================================================
// === УМНОЕ ОБЛАКО TELEGRAM (CLOUD STORAGE С ОБХОДОМ ЛИМИТА 4 КБ) ===
// =================================================================
window.AppStorage = {
    // Проверяем, доступно ли облако (если открыто в браузере вне ТГ, будет fallback на localStorage)
    isSupported: !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.CloudStorage),

    asyncset(key, value) {
        if (!this.isSupported) return localStorage.setItem(key, value);

        return new Promise((resolve, reject) => {
            const chunkSize = 3500; // Безопасный размер куска (лимит ТГ - 4096 байт)
            const chunks = [];
            for (let i = 0; i < value.length; i += chunkSize) {
                chunks.push(value.slice(i, i + chunkSize));
            }

            // Сохраняем информацию о том, на сколько кусков разбиты данные
            window.Telegram.WebApp.CloudStorage.setItem(key + '_meta', chunks.length.toString(), (err) => {
                if (err) return reject(err);
                if (chunks.length === 0) return resolve();

                let saved = 0;
                chunks.forEach((chunk, idx) => {
                    window.Telegram.WebApp.CloudStorage.setItem(key + '_' + idx, chunk, (err2) => {
                        if (err2) reject(err2);
                        saved++;
                        if (saved === chunks.length) resolve(); // Все куски успешно загружены
                    });
                });
            });
        });
    },

    asyncget(key) {
        if (!this.isSupported) return localStorage.getItem(key);

        return new Promise((resolve, reject) => {
            window.Telegram.WebApp.CloudStorage.getItem(key + '_meta', (err, metaStr) => {
                if (err) return reject(err);

                // Если меты нет, возможно это старые данные или их вообще нет
                if (!metaStr) {
                    window.Telegram.WebApp.CloudStorage.getItem(key, (err3, oldVal) => {
                        resolve(oldVal || null);
                    });
                    return;
                }

                const count = parseInt(metaStr);
                if (count === 0) return resolve('');

                const keysToFetch = [];
                for (let i = 0; i < count; i++) keysToFetch.push(key + '_' + i);

                // Скачиваем все куски разом
                window.Telegram.WebApp.CloudStorage.getItems(keysToFetch, (err2, values) => {
                    if (err2) return reject(err2);
                    let fullString = '';
                    for (let i = 0; i < count; i++) {
                        fullString += (values[key + '_' + i] || '');
                    }
                    resolve(fullString); // Склеиваем и возвращаем
                });
            });
        });
    },

    async clearAll() {
        if (!this.isSupported) return localStorage.clear();

        return new Promise((resolve, reject) => {
            window.Telegram.WebApp.CloudStorage.getKeys((err, keys) => {
                if (err) return reject(err);
                if (!keys || keys.length === 0) return resolve();
                window.Telegram.WebApp.CloudStorage.removeItems(keys, (err2) => {
                    if (err2) reject(err2);
                    resolve();
                });
            });
        });
    }
};

// =================================================================
// === ГЛОБАЛЬНЫЕ НАСТРОЙКИ ВАЛЮТЫ И ЯЗЫКА ===
// =================================================================
window.appState = {
    lang: 'en',
    currency: 'USD',
    get currencySymbol() {
        const map = { 'USD': '$', 'EUR': '€', 'GBP': '£', 'RUB': '₽' };
        return map[this.currency] || '$';
    }
};

window.formatMoney = function(val, showSign = false) {
    if (typeof val !== 'number' || isNaN(val)) return showSign ? `+ ${window.appState.currencySymbol}0.00` : `${window.appState.currencySymbol}0.00`;
    const sign = val >= 0 ? '+' : '-';
    // Для рублей меняем формат отображения (пробел между тысячами)
    const locale = window.appState.currency === 'RUB' ? 'ru-RU' : 'en-US';
    const formatted = `${window.appState.currencySymbol}${Math.abs(val).toLocaleString(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    return showSign ? `${sign} ${formatted}` : formatted;
};

// =================================================================
// === ГЕНЕРАТОР НЕДЕЛЬНОГО ОТЧЕТА ===
// =================================================================
window.showWeeklySummary = async function(isManual = false) {
    const isRu = window.appState && window.appState.lang === 'ru';

    let historyData = null;
    try {
        const rawData = await AppStorage.get('portfolioData');
        if (rawData) historyData = JSON.parse(rawData).assetHistory;
    } catch (e) {
        console.error("Error loading data for summary:", e);
    }

    if (!historyData || Object.keys(historyData).length === 0) {
        if (isManual && window.showToast) window.showToast(isRu ? 'Нет данных для отчета. Добавьте активы.' : 'No data for report. Add some assets.', 'error');
        return;
    }

    let totalCurrent = 0,
        total7DaysAgo = 0;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 7);

    Object.keys(historyData).forEach(id => {
        const history = historyData[id];
        if (!history || history.length === 0) return;

        totalCurrent += history[history.length - 1].value;

        let val7DaysAgo = history[0].value;
        for (let i = history.length - 1; i >= 0; i--) {
            const recordDate = new Date(history[i].date);
            if (recordDate <= targetDate) {
                val7DaysAgo = history[i].value;
                break;
            }
        }
        total7DaysAgo += val7DaysAgo;
    });

    const diff = totalCurrent - total7DaysAgo;
    const percent = total7DaysAgo > 0 ? (diff / total7DaysAgo) * 100 : 0;
    const sign = diff >= 0 ? '+' : '';
    const colorClass = diff >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';
    const emoji = diff >= 0 ? '📈' : '📉';

    const modal = document.getElementById('modalWeeklySummary');
    if (!modal) return;

    document.getElementById('ws-title').textContent = isRu ? '📅 Отчет за неделю' : '📅 Weekly Summary';
    document.getElementById('ws-close').textContent = isRu ? 'Закрыть' : 'Close';

    const content = document.getElementById('weekly-summary-content');
    content.innerHTML = `
        <div style="font-size: 36px; font-weight: 800; margin-bottom: 10px;" class="theme-text">${window.formatMoney(totalCurrent)}</div>
        <div style="font-size: 18px; font-weight: 700; color: ${colorClass}; margin-bottom: 20px;">
            ${emoji} ${sign}${window.formatMoney(diff, true)} (${sign}${percent.toFixed(2)}%)
        </div>
        <p>${isRu ? 'Это изменение вашего баланса за последние 7 дней.' : 'This is your balance change over the last 7 days.'}</p>
    `;

    const themeText = content.querySelector('.theme-text');
    if (themeText) {
        themeText.style.color = document.documentElement.getAttribute('data-theme') === 'light' ? '#000' : '#fff';
    }

    modal.classList.add('active');
};

// =================================================================
// === КАСТОМНЫЕ УВЕДОМЛЕНИЯ (TOASTS) ===
// =================================================================
window.showToast = function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Иконки в зависимости от типа
    let icon = '';
    if (type === 'success') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--profit-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    if (type === 'error') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--loss-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    if (type === 'info') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    // Запускаем анимацию появления
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Удаляем через 3 секунды
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // Ждем конца анимации
    }, 3000);
};

// =================================================================
// === ИНИЦИАЛИЗАЦИЯ TELEGRAM И РОУТЕР (МЕНЮ) ===
// =================================================================
document.addEventListener('DOMContentLoaded', function() {
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        const tgUser = tg.initDataUnsafe ? .user;
        if (tgUser) {
            const firstName = tgUser.first_name || '';
            const lastName = tgUser.last_name || '';
            const fullName = `${firstName} ${lastName}`.trim() || 'Telegram User';
            const username = tgUser.username ? `@${tgUser.username}` : 'No username';
            const photoUrl = tgUser.photo_url;

            const profileNameEl = document.querySelector('.profile-name');
            if (profileNameEl) profileNameEl.textContent = fullName;
            const profileEmailEl = document.querySelector('.profile-email');
            if (profileEmailEl) profileEmailEl.textContent = username;

            const fullNameInput = document.getElementById('full-name');
            if (fullNameInput) fullNameInput.value = fullName;
            const emailInput = document.getElementById('email');
            if (emailInput) {
                emailInput.value = username;
                emailInput.type = "text";
                const emailLabel = emailInput.previousElementSibling;
                if (emailLabel && emailLabel.tagName.toLowerCase() === 'LABEL') emailLabel.textContent = 'Telegram Username';
            }

            const sidebarAccountSpan = document.querySelector('.account-text');
            if (sidebarAccountSpan) {
                // Если имя есть - пишем его, если пустое - пишем "Account"
                sidebarAccountSpan.textContent = firstName.trim() ? firstName.trim() : 'Account';
            }

            if (photoUrl) {
                const avatars = document.querySelectorAll('.big-avatar, .avatar-mini');
                avatars.forEach(avatar => {
                    avatar.style.backgroundImage = `url(${photoUrl})`;
                    avatar.style.backgroundSize = 'cover';
                    avatar.style.backgroundPosition = 'center';
                });
            }
        }
    }

    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');

    function showPage(pageId) {
        pages.forEach(page => page.classList.remove('active'));
        navLinks.forEach(link => link.classList.remove('active'));

        const targetPage = document.getElementById('page-' + pageId);
        if (targetPage) targetPage.classList.add('active');

        const activeLinks = document.querySelectorAll(`.nav-link[data-page="${pageId}"]`);
        activeLinks.forEach(link => link.classList.add('active'));

        if (window.innerWidth <= 900) document.body.classList.add('sidebar-closed');

        document.dispatchEvent(new CustomEvent('pageOpened', { detail: pageId }));
        window.dispatchEvent(new Event('resize'));
    }

    document.addEventListener('click', function(event) {
        const link = event.target.closest('.nav-link');
        if (link) {
            const pageId = link.getAttribute('data-page');
            if (pageId) showPage(pageId);
        }
    });

    showPage('main');

    const sidebarToggleBtns = document.querySelectorAll('.sidebar-toggle-btn');
    sidebarToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => document.body.classList.toggle('sidebar-closed'));
    });

    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    if (sidebarWrapper) {
        sidebarWrapper.addEventListener('click', function(e) {
            if (e.target === sidebarWrapper) document.body.classList.add('sidebar-closed');
        });
    }
});


// =================================================================
// === СТРАНИЦА ANALYTICS ===
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
            let assetHistory = {};
            let assetMeta = {};
            let activeTimeframe = 7;

            // НОВЫЕ ПЕРЕМЕННЫЕ ДЛЯ ФИЛЬТРОВ АНАЛИТИКИ
            window.analyticsNameFilter = null;
            window.analyticsCategoryFilter = null;

            const analyticsContent = document.getElementById('analytics-content');
            const noDataMessage = document.getElementById('no-data-message');
            const mainChartContainer = document.getElementById('main-performance-chart');

            // Функции UI для фильтров
            window.toggleAnalyticsFilterPop = function(e) {
                e.stopPropagation();
                const pop = document.getElementById('analytics-filter-pop');
                const isActive = pop.classList.contains('active');
                document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active'));
                if (!isActive) pop.classList.add('active');
            };

            window.setAnalyticsNameFilter = function(name) {
                window.analyticsNameFilter = name || null;
                document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active'));
                renderAnalytics();
            };

            window.setAnalyticsCategoryFilter = function(category) {
                window.analyticsCategoryFilter = category || null;
                document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active'));
                renderAnalytics();
            };

            function updateAnalyticsDropdowns() {
                const catListEl = document.getElementById('analyticsFilterCategoryList');
                const nameListEl = document.getElementById('analyticsFilterNameList');
                const isRu = window.appState && window.appState.lang === 'ru';
                if (!catListEl || !nameListEl) return;

                const uniqueCategories = [...new Set(Object.values(assetMeta).map(m => m.category))].filter(Boolean);
                const uniqueNames = [...new Set(Object.values(assetMeta).map(m => m.name))].filter(Boolean);

                let nameHtml = `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${window.analyticsNameFilter === null ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${window.analyticsNameFilter === null ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setAnalyticsNameFilter('')">${isRu ? 'Все активы' : 'All Asset Names'}</button>`;
                uniqueNames.forEach(name => {
                    const isActive = window.analyticsNameFilter === name;
                    nameHtml += `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${isActive ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${isActive ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setAnalyticsNameFilter('${name}')">${name}</button>`;
                });
                nameListEl.innerHTML = nameHtml;

                let catHtml = `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${window.analyticsCategoryFilter === null ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${window.analyticsCategoryFilter === null ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setAnalyticsCategoryFilter('')">${isRu ? 'Все категории' : 'All Categories'}</button>`;
                uniqueCategories.forEach(cat => {
                    const isActive = window.analyticsCategoryFilter === cat;
                    catHtml += `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${isActive ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${isActive ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setAnalyticsCategoryFilter('${cat}')">${cat}</button>`;
                });
                catListEl.innerHTML = catHtml;
            }

            function parseDate(dateStr) { return dateStr ? new Date(dateStr) : null; }

            function findValueAtDate(history, targetDate) {
                let value = 0;
                if (!history || !targetDate) return 0;
                for (let i = history.length - 1; i >= 0; i--) {
                    const recordDate = parseDate(history[i].date);
                    if (recordDate && recordDate <= targetDate) { value = history[i].value; break; }
                }
                return value;
            }

            function formatCurrency(value, showSign = false) {
                return window.formatMoney(value, showSign);
            }

            function formatDate(dateObj) {
                if (!dateObj) return '';
                const day = dateObj.getDate().toString().padStart(2, '0');
                const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                return `${day}.${month}`;
            }

            async function loadData() {
                try {
                    const portfolioDataRaw = await AppStorage.get('portfolioData');
                    if (portfolioDataRaw) {
                        const parsed = JSON.parse(portfolioDataRaw);
                        assetMeta = parsed.assetMeta || {};
                        assetHistory = parsed.assetHistory || {};
                        return true;
                    }
                } catch (e) { console.error("Ошибка загрузки аналитики:", e); }
                assetMeta = {};
                assetHistory = {};
                return false;
            }

            function processData(days) {
                const endDate = new Date();
                let periodStartDate = new Date();
                if (days > 0) {
                    periodStartDate.setDate(endDate.getDate() - (days - 1));
                } else {
                    let firstDateEver = new Date();
                    Object.values(assetHistory).forEach(h => {
                        if (h && h.length > 0) { const d = parseDate(h[0].date); if (d && d < firstDateEver) firstDateEver = d; }
                    });
                    periodStartDate = firstDateEver;
                }
                periodStartDate.setHours(0, 0, 0, 0);

                const comparisonDate = new Date(periodStartDate);
                comparisonDate.setDate(comparisonDate.getDate() - 1);

                // --- ПРИМЕНЕНИЕ ФИЛЬТРОВ К АНАЛИТИКЕ ---
                const searchInput = document.getElementById('analyticsSearch');
                const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

                const filteredAssetIds = Object.keys(assetMeta).filter(id => {
                    const meta = assetMeta[id];
                    const name = (meta.name || '').toLowerCase();
                    const category = (meta.category || '').toLowerCase();

                    const matchesSearch = name.includes(term) || category.includes(term);
                    const matchesName = !window.analyticsNameFilter || meta.name === window.analyticsNameFilter;
                    const matchesCategory = !window.analyticsCategoryFilter || meta.category === window.analyticsCategoryFilter;

                    return matchesSearch && matchesName && matchesCategory;
                });

                const assetPerformance = {};
                let totalCurrentValue = 0,
                    totalGainLoss = 0;

                filteredAssetIds.forEach(id => {
                    const history = assetHistory[id];
                    if (!history || history.length === 0) return;
                    const currentValue = history[history.length - 1].value;
                    const creationDate = parseDate(history[0].date);
                    const creationValue = history[0].value;

                    let startValue = (days === 0) ? creationValue : ((creationDate >= periodStartDate) ? creationValue : findValueAtDate(history, comparisonDate));
                    const changeValue = currentValue - startValue;
                    let changePercent = (startValue > 0) ? (changeValue / startValue) * 100 : null;

                    assetPerformance[id] = { name: assetMeta[id].name, category: assetMeta[id].category, currentValue, changeValue, changePercent };
                    totalGainLoss += changeValue;
                    totalCurrentValue += currentValue;
                });

                const sortedAssets = Object.values(assetPerformance).sort((a, b) => b.changeValue - a.changeValue);
                const bestPerformer = sortedAssets[0] || { name: 'N/A', changeValue: 0 };
                const worstPerformer = sortedAssets[sortedAssets.length - 1] || { name: 'N/A', changeValue: 0 };
                const totalStartValue = totalCurrentValue - totalGainLoss;
                const kpiData = { totalValue: totalCurrentValue, totalGainLoss, totalGainLossPercent: (totalStartValue > 0) ? (totalGainLoss / totalStartValue) * 100 : 0, bestPerformer, worstPerformer };

                const allPoints = [];
                filteredAssetIds.forEach(id => {
                    const h = assetHistory[id];
                    if (h) allPoints.push(...h.map(p => parseDate(p.date)));
                });
                const uniqueTimestamps = [...new Set(allPoints.filter(Boolean).map(d => d.getTime()))];

                let historyTimestamps;
                if (days > 0) {
                    historyTimestamps = uniqueTimestamps.filter(ts => ts >= periodStartDate.getTime() && ts <= endDate.getTime());
                    let anchorTs = 0;
                    uniqueTimestamps.forEach(ts => { if (ts < periodStartDate.getTime() && ts > anchorTs) anchorTs = ts; });
                    if (anchorTs > 0) historyTimestamps.unshift(anchorTs);
                } else { historyTimestamps = uniqueTimestamps; }

                historyTimestamps.sort((a, b) => a - b);

                const aggregatedHistory = [...new Set(historyTimestamps)].map(timestamp => {
                    const dateObj = new Date(timestamp);
                    let dailyTotal = 0;
                    filteredAssetIds.forEach(id => { dailyTotal += findValueAtDate(assetHistory[id], dateObj); });
                    return { date: dateObj, value: dailyTotal };
                });

                return { kpiData, aggregatedHistory, assetPerformance };
            }

            function renderAnalytics() {
                updateAnalyticsDropdowns();

                const { kpiData, aggregatedHistory, assetPerformance } = processData(activeTimeframe);

                if ((!kpiData.totalValue && kpiData.totalValue !== 0) || Object.keys(kpiData).length === 0) {
                    mainChartContainer.innerHTML = '<p style="text-align:center; color: var(--text-sec); padding-top: 50px;">No matching data.</p>';
                    document.getElementById('kpi-total-value').textContent = '$0.00';
                    document.getElementById('kpi-gain-loss').textContent = '$0.00';
                    document.getElementById('kpi-gain-loss').className = 'kpi-value';
                    document.getElementById('kpi-gain-loss-percent').textContent = '(0.00%)';
                    document.getElementById('kpi-gain-loss-percent').className = 'kpi-sub';
                    document.getElementById('kpi-best-performer').textContent = 'N/A';
                    document.getElementById('kpi-best-performer-change').textContent = '+$0.00';
                    document.getElementById('kpi-worst-performer').textContent = 'N/A';
                    document.getElementById('kpi-worst-performer-change').textContent = '-$0.00';
                    document.getElementById('asset-performance-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-sec);">No assets match filters</td></tr>';
                    return;
                }

                document.getElementById('kpi-total-value').textContent = formatCurrency(kpiData.totalValue);
                document.getElementById('kpi-gain-loss').textContent = formatCurrency(kpiData.totalGainLoss, true);
                document.getElementById('kpi-gain-loss').className = `kpi-value ${kpiData.totalGainLoss >= 0 ? 'green' : 'red'}`;
                document.getElementById('kpi-gain-loss-percent').textContent = `(${kpiData.totalGainLossPercent.toFixed(2)}%)`;
                document.getElementById('kpi-gain-loss-percent').className = `kpi-sub ${kpiData.totalGainLoss >= 0 ? 'green' : 'red'}`;
                document.getElementById('kpi-best-performer').textContent = kpiData.bestPerformer.name;
                document.getElementById('kpi-best-performer-change').textContent = formatCurrency(kpiData.bestPerformer.changeValue, true);
                document.getElementById('kpi-worst-performer').textContent = kpiData.worstPerformer.name;
                document.getElementById('kpi-worst-performer-change').textContent = formatCurrency(kpiData.worstPerformer.changeValue, true);

                renderMainChart(aggregatedHistory);
                renderAssetTable(assetPerformance);
            }

            function renderMainChart(history) {
                if (!history || history.length < 2) {
                    mainChartContainer.innerHTML = '<p style="text-align:center; color: var(--text-sec); padding-top: 50px;">Not enough data.</p>';
                    return;
                }
                const width = mainChartContainer.offsetWidth;
                if (width === 0) return;
                const height = 350,
                    padding = 40;
                const values = history.map(h => h.value),
                    maxVal = Math.max(...values, 0),
                    minVal = 0;

                const points = history.map((point, index) => {
                    const x = history.length === 1 ? width / 2 : padding + (index / (history.length - 1)) * (width - (padding * 2));
                    const y = (height - padding) - ((point.value - minVal) / (maxVal - minVal || 1)) * (height - (padding * 2));
                    return { x, y, val: point.value, date: point.date };
                });

                let svgContent = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
                if (points.length > 1) svgContent += `<polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" class="graph-line" />`;

        const pointsToShow = new Set([0, points.length - 1]);
        if (points.length <= 10) for (let i = 0; i < points.length; i++) pointsToShow.add(i);
        points.forEach((p, i) => {
            if (pointsToShow.has(i)) {
                svgContent += `<circle cx="${p.x}" cy="${p.y}" r="4" class="graph-point" /><text x="${p.x}" y="${height - 15}" class="graph-text">${formatDate(p.date)}</text><text x="${p.x}" y="${p.y - 10}" class="graph-text" style="font-weight:bold">${formatCurrency(p.val)}</text>`;
            }
        });
        svgContent += `</svg>`;
        mainChartContainer.innerHTML = svgContent;
    }
    
    function renderAssetTable(assetPerformance) {
        const sortedAssets = Object.values(assetPerformance).sort((a, b) => b.currentValue - a.currentValue);
        if (sortedAssets.length === 0) {
            document.getElementById('asset-performance-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-sec);">No assets</td></tr>'; return;
        }
        document.getElementById('asset-performance-tbody').innerHTML = sortedAssets.map(asset => {
            const changeClass = asset.changeValue >= 0 ? 'change-positive' : 'change-negative';
            const percentString = asset.changePercent === null ? '---' : `${asset.changePercent.toFixed(2)}%`;
            return `<tr><td>${asset.name}</td><td>${asset.category}</td><td>${formatCurrency(asset.currentValue)}</td><td class="${changeClass}">${formatCurrency(asset.changeValue, true)}</td><td class="${changeClass}">${percentString}</td></tr>`;
        }).join('');
    }

    async function main() {
        const hasData = await loadData();
        if (hasData && Object.keys(assetMeta).length > 0) {
            analyticsContent.style.display = 'block'; noDataMessage.style.display = 'none';
            renderAnalytics();
        } else {
            analyticsContent.style.display = 'none'; noDataMessage.style.display = 'block';
        }
    }

    const analyticsSearch = document.getElementById('analyticsSearch');
    if (analyticsSearch) {
        analyticsSearch.addEventListener('input', () => renderAnalytics());
    }
    
    document.querySelectorAll('.time-filter-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.time-filter-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active'); activeTimeframe = parseInt(button.dataset.days); renderAnalytics();
        });
    });
    window.addEventListener('resize', renderAnalytics);

    document.addEventListener('pageOpened', (e) => {
        if (e.detail === 'analytics') main(); 
    });

    main();
});


// =================================================================
// === СТРАНИЦА MAIN (Dashboard) ===
// =================================================================
let pies = [];
let activePieId = null;
let portfolioDataMain = { assetMeta: {}, assetHistory: {} }; 

const amountDisplay = document.getElementById('display-amount');
const hoverCategoryName = document.getElementById('hover-category-name');
const pieContainer = document.getElementById('pie-svg-container');
const breakdownList = document.getElementById('breakdown-list');
const pieSelectorContainer = document.getElementById('pie-selector-container');
const trendPath = document.getElementById('trend-path');
const hintText = document.getElementById('hint-text');

async function saveMainData() {
    await AppStorage.set('fiMaxPies', JSON.stringify({ pies, activePieId }));
}

async function loadMainData() {
    const pieData = await AppStorage.get('fiMaxPies');
    if (pieData) {
        const parsed = JSON.parse(pieData);
        pies = parsed.pies || []; activePieId = parsed.activePieId;
    } else { pies = []; activePieId = null; }

    const portfolioDataRaw = await AppStorage.get('portfolioData');
    if (portfolioDataRaw) {
        const parsed = JSON.parse(portfolioDataRaw);
        portfolioDataMain.assetMeta = parsed.assetMeta || {};
        portfolioDataMain.assetHistory = parsed.assetHistory || {};
    } else { portfolioDataMain = { assetMeta: {}, assetHistory: {} }; }
    
    if (!activePieId || !pies.find(p => p.id === activePieId)) activePieId = pies.length > 0 ? pies[0].id : null;
}

const openModal = (modalId) => document.getElementById(modalId).classList.add('active');
const closeModal = (modalId) => document.getElementById(modalId).classList.remove('active');

document.getElementById('openAddPieModal').onclick = () => {
    openModal('modalAddPie');
    // Моментально ставим фокус на поле ввода, чтобы вызвать клавиатуру
    const input = document.getElementById('new-pie-name');
    if (input) input.focus();
};
document.getElementById('confirm-add-pie').onclick = async () => await addPie();
document.getElementById('openAddAssetModal').onclick = () => {
    const assetSelectionList = document.getElementById('asset-selection-list');
    assetSelectionList.innerHTML = '';
    const activePie = pies.find(p => p.id === activePieId);
    if (!activePie) {
        assetSelectionList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">Create a pie first.</p>';
        openModal('modalAddAsset'); return;
    }
    const assetsInPieIds = activePie.assets.map(a => a.id);
    const availableAssets = Object.keys(portfolioDataMain.assetMeta).filter(id => !assetsInPieIds.includes(id));
    if (availableAssets.length === 0) {
        assetSelectionList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">No new assets available.</p>';
    } else {
        availableAssets.forEach(id => {
            const meta = portfolioDataMain.assetMeta[id]; const history = portfolioDataMain.assetHistory[id];
            if (!meta || !history || history.length === 0) return;
            const value = history[history.length - 1].value;
            const item = document.createElement('div');
            item.className = 'asset-to-add-item';
            item.innerHTML = `<span>${meta.name} (${meta.category})</span><b>$${value.toLocaleString()}</b>`;
            item.onclick = async () => await addAssetToPie(id);
            assetSelectionList.appendChild(item);
        });
    }
    openModal('modalAddAsset');
};

window.addEventListener('click', (e) => { 
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active'); 
});

function getTimestamp() { return new Date().toISOString(); }

async function addPie() {
    const name = document.getElementById('new-pie-name').value.trim();
    if (!name) return showToast('Please enter a name for your pie.', 'error');
    const newPie = { id: `pie-${Date.now()}`, name, assets: [], history: [{ date: getTimestamp(), value: 0 }] };
    pies.push(newPie); activePieId = newPie.id;
    document.getElementById('new-pie-name').value = '';
    closeModal('modalAddPie');
    await saveMainData();
    renderMainPage();
}

async function addAssetToPie(assetId) {
    const activePie = pies.find(p => p.id === activePieId);
    if (!activePie) return;
    const meta = portfolioDataMain.assetMeta[assetId];
    const value = portfolioDataMain.assetHistory[assetId][portfolioDataMain.assetHistory[assetId].length - 1].value;
    activePie.assets.push({ id: assetId, name: meta.name, amount: value, category: meta.category });
    updatePieHistory(activePie);
    closeModal('modalAddAsset');
    await saveMainData();
    renderMainPage();
}

async function deleteAssetFromPie(assetId) {
    const activePie = pies.find(p => p.id === activePieId);
    if (!activePie) return;
    activePie.assets = activePie.assets.filter(asset => asset.id !== assetId);
    updatePieHistory(activePie);
    await saveMainData();
    renderMainPage();
}

async function deletePie(pieIdToDelete) {
    if (!confirm(`Delete this pie?`)) return;
    pies = pies.filter(p => p.id !== pieIdToDelete);
    if (activePieId === pieIdToDelete) activePieId = pies.length > 0 ? pies[0].id : null;
    await saveMainData();
    renderMainPage();
}

function updatePieHistory(pie) {
    const newTotal = pie.assets.reduce((sum, asset) => sum + asset.amount, 0);
    pie.history.push({ date: getTimestamp(), value: newTotal });
}

function renderMainPage() {
    renderPieSelectors();
    const activePie = pies.find(p => p.id === activePieId);

    if (!activePie) {
        amountDisplay.innerText = '$0'; hoverCategoryName.innerText = 'Total Balance';
        pieContainer.innerHTML = pieContainer.querySelector('defs').outerHTML;
        breakdownList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">No pie selected.</p>';
        trendPath.setAttribute('d', 'M5,45 L195,45'); hintText.textContent = 'Create a pie to see your progress.';
        return;
    }
    
    let totalAmount = 0;
    activePie.assets.forEach(asset => {
        const history = portfolioDataMain.assetHistory[asset.id];
        if (history && history.length > 0) asset.amount = history[history.length - 1].value;
        totalAmount += asset.amount;
    });
    
    renderBreakdownList(activePie.assets);
    renderPieChart(activePie.assets);
    animateValue(amountDisplay, totalAmount);
    renderSparkline(activePie.history);
    updateDashboardWidgets(activePie);
}

function updateDashboardWidgets(activePie) {
    const perfValEl = document.getElementById('performance-val');
    const insightEl = document.getElementById('smart-insight-content');
    const pulseEl = document.getElementById('market-pulse-content');

    // Проверяем текущий язык
    const isRu = window.appState && window.appState.lang === 'ru';

    // --- 1. PERFORMANCE (Глобальная Прибыль/Убыток как в Аналитике) ---
    let globalCurrentValue = 0;
    let globalStartValue = 0;
    
    // Считаем общую прибыль по всем активам (не только в текущем пироге)
    Object.keys(portfolioDataMain.assetHistory).forEach(id => {
        const history = portfolioDataMain.assetHistory[id];
        if (history && history.length > 0) {
            globalCurrentValue += history[history.length - 1].value;
            globalStartValue += history[0].value;
        }
    });
    
    let globalGainLoss = globalCurrentValue - globalStartValue;
    let globalGainLossPercent = globalStartValue > 0 ? (globalGainLoss / globalStartValue) * 100 : 0;
    
    if (perfValEl) {
        // Форматируем значения
        const formattedGain = window.formatMoney(globalGainLoss, true);
        const formattedPercent = `(${globalGainLossPercent.toFixed(2)}%)`;
        const colorClass = globalGainLoss >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';
        
        // Создаем подпись для процентов, если ее еще нет
        let subEl = document.getElementById('performance-sub');
        if (!subEl) {
            subEl = document.createElement('div');
            subEl.id = 'performance-sub';
            subEl.style.fontSize = '16px';
            subEl.style.fontWeight = '600';
            subEl.style.marginTop = '8px';
            perfValEl.parentNode.appendChild(subEl);
        }
        
        // Обновляем текст (Цена и Процент)
        perfValEl.textContent = formattedGain;
        perfValEl.style.color = colorClass;
        
        subEl.textContent = formattedPercent;
        subEl.style.color = colorClass;
    }

    // --- ЕСЛИ ПИРОГ ПУСТОЙ ---
    if (!activePie || activePie.assets.length === 0) {
        if(insightEl) insightEl.innerHTML = isRu ? 'Добавьте активы, чтобы открыть ИИ-анализ и персональные рекомендации.' : 'Add assets to your pie to unlock AI insights and personalized recommendations.';
        if(pulseEl) pulseEl.innerHTML = `<span style="color: var(--text-sec); font-size: 13px;">${isRu ? 'Нет данных. Добавьте активы.' : 'No data available. Add assets to see trends.'}</span>`;
        return;
    }

    // --- 2. SMART INSIGHT (ИИ Анализ с переводами) ---
    let totalVal = activePie.assets.reduce((s, a) => s + a.amount, 0);
    let largestAsset = activePie.assets.reduce((max, obj) => max.amount > obj.amount ? max : obj, activePie.assets[0]);
    
    if (totalVal === 0) {
        if(insightEl) insightEl.innerHTML = isRu ? "Ваш пирог пуст. Обновите цены в Портфеле." : "Your pie is empty. Update asset values in the Portfolio tab.";
    } else {
        let percentShare = ((largestAsset.amount / totalVal) * 100).toFixed(0);
        if (percentShare > 65) {
            insightEl.innerHTML = `<b style="color:var(--loss-red)">${isRu ? 'Высокий риск концентрации!' : 'High Concentration Risk!'}</b><br><br>${isRu ? `<b>${largestAsset.name}</b> составляет <b>${percentShare}%</b> этого портфеля. Рассмотрите возможность диверсификации.` : `<b>${largestAsset.name}</b> makes up <b>${percentShare}%</b> of this pie. Consider adding other assets to diversify your portfolio.`}`;
        } else if (activePie.assets.length === 1) {
            insightEl.innerHTML = isRu ? `В этом портфеле только один актив. Добавьте больше для снижения рисков.` : `You only have one asset in this pie. Adding more assets helps reduce market risk.`;
        } else {
            insightEl.innerHTML = `<b>${isRu ? 'Отличный баланс!' : 'Well balanced!'}</b><br><br>${isRu ? `Ваш главный актив — <b>${largestAsset.name}</b> (${percentShare}%). Продолжайте следить за распределением.` : `Your top asset is <b>${largestAsset.name}</b> (${percentShare}%). Keep monitoring your allocation to maintain stability.`}`;
        }
    }

    // --- 3. MARKET PULSE (Топ роста и падения с переводами) ---
    let assetChanges = [];
    Object.keys(portfolioDataMain.assetMeta).forEach(id => {
        const hist = portfolioDataMain.assetHistory[id];
        const meta = portfolioDataMain.assetMeta[id];
        if (hist && hist.length > 1) {
            let sVal = hist[0].value;
            let cVal = hist[hist.length - 1].value;
            if (sVal > 0 && cVal !== sVal) {
                assetChanges.push({ name: meta.name, change: ((cVal - sVal) / sVal) * 100 });
            }
        }
    });

    if (assetChanges.length > 0) {
        assetChanges.sort((a, b) => b.change - a.change); // Сортируем
        const topGainer = assetChanges[0];
        const topLoser = assetChanges[assetChanges.length - 1];
        
        let html = '';
        if (topGainer.change > 0) {
            html += `<div class="pulse-item"><span class="pulse-name">${topGainer.name}</span><span class="pulse-change green">+${topGainer.change.toFixed(1)}%</span></div>`;
        }
        if (topLoser.change < 0) {
            html += `<div class="pulse-item"><span class="pulse-name">${topLoser.name}</span><span class="pulse-change red">${topLoser.change.toFixed(1)}%</span></div>`;
        }

        if (html === '') {
            html = `<span style="color: var(--text-sec); font-size: 13px;">${isRu ? 'Рынок стабилен. Сильных изменений нет.' : 'Market is stable. No significant price changes today.'}</span>`;
        }
        if(pulseEl) pulseEl.innerHTML = html;
    } else {
        if(pulseEl) pulseEl.innerHTML = `<span style="color: var(--text-sec); font-size: 13px;">${isRu ? 'Недостаточно истории для показа трендов. Обновите цены активов.' : 'Not enough historical data to show trends. Update values to track performance.'}</span>`;
    }
}

function renderPieSelectors() {
    pieSelectorContainer.innerHTML = '';
    pies.forEach(pie => {
        const tab = document.createElement('div'); tab.className = 'pie-selector-tab';
        if (pie.id === activePieId) tab.classList.add('active');
        const tabName = document.createElement('span'); tabName.textContent = pie.name;
        tabName.onclick = async () => { if (activePieId !== pie.id) { activePieId = pie.id; await saveMainData(); renderMainPage(); }};
        const deleteBtn = document.createElement('button'); deleteBtn.className = 'btn-delete-pie'; deleteBtn.innerHTML = '✕';
        deleteBtn.onclick = async (e) => { e.stopPropagation(); await deletePie(pie.id); };
        tab.appendChild(tabName); tab.appendChild(deleteBtn); pieSelectorContainer.appendChild(tab);
    });
}

function renderPieChart(assets) {
    pieContainer.innerHTML = pieContainer.querySelector('defs').outerHTML;
    const totalAmount = assets.reduce((sum, asset) => sum + asset.amount, 0);
    if (totalAmount === 0) return;
    let startAngle = 0;
    assets.forEach((asset) => {
        const angle = (asset.amount / totalAmount) * 360; const endAngle = startAngle + angle;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute('class', 'sector'); path.setAttribute('id', `sector-${asset.id}`);
        path.dataset.startAngle = startAngle; path.dataset.endAngle = endAngle;
        path.setAttribute('d', getArcPath(100, startAngle, endAngle)); path.setAttribute('filter', 'url(#glass-depth)');
        path.onmouseenter = () => handleHover(path, asset.amount, `breakdown-row-${asset.id}`, asset.category);
        path.onmouseleave = () => handleReset(path, totalAmount, `breakdown-row-${asset.id}`);
        pieContainer.appendChild(path); startAngle = endAngle;
    });
}

function renderBreakdownList(assets) {
    breakdownList.innerHTML = '';
    if (assets.length === 0) { breakdownList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">This pie is empty.</p>'; return; }
    const totalAmount = assets.reduce((s, a) => s + a.amount, 0);
    assets.forEach(asset => {
        const row = document.createElement('div'); row.className = 'asset-row'; row.id = `breakdown-row-${asset.id}`;
        row.innerHTML = `<span class="asset-name"><span class="dot"></span> ${asset.name} (${asset.category})</span><b class="asset-val">${window.appState.currencySymbol}${asset.amount.toLocaleString()} <button class="delete-asset-btn" onclick="deleteAssetFromPie('${asset.id}')">✕</button></b>`;
        row.onmouseenter = () => handleHover(document.getElementById(`sector-${asset.id}`), asset.amount, row.id, asset.category);
        row.onmouseleave = () => handleReset(document.getElementById(`sector-${asset.id}`), totalAmount, row.id);
        breakdownList.appendChild(row);
    });
}

function renderSparkline(history) {
    if (!history || history.length < 2) { trendPath.setAttribute('d', 'M5,45 L195,45'); hintText.textContent = `Not enough data.`; return; }
    const values = history.map(h => h.value), minVal = Math.min(...values), maxVal = Math.max(...values);
    let pathData = '';
    history.forEach((point, index) => {
        const x = (index / (history.length - 1)) * 190 + 5, y = (maxVal === minVal) ? 25 : 45 - ((point.value - minVal) / (maxVal - minVal)) * 40;
        pathData += `${index === 0 ? 'M' : 'L'}${x},${y} `;
    });
    trendPath.setAttribute('d', pathData);
    const length = trendPath.getTotalLength(); trendPath.style.strokeDasharray = length; trendPath.style.strokeDashoffset = length;
    gsap.to(trendPath, { strokeDashoffset: 0, duration: 1.5, ease: "power2.inOut" });
    const startValue = history[0].value, endValue = history[history.length - 1].value;
    if (startValue > 0) {
        const percentageChange = ((endValue - startValue) / startValue) * 100;
        hintText.textContent = `Equity grown by ${percentageChange.toFixed(1)}%`;
        hintText.style.color = percentageChange >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';
    } else { hintText.textContent = `Portfolio created.`; }
}

function polarToCartesian(radius, angleInDegrees) { const a = (angleInDegrees - 90) * Math.PI / 180.0; return { x: radius * Math.cos(a), y: radius * Math.sin(a) }; }
function getArcPath(radius, startAngle, endAngle) {
    if (Math.abs(endAngle - startAngle) >= 360) endAngle = startAngle + 359.999;
    const start = polarToCartesian(radius, startAngle), end = polarToCartesian(radius, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} L 0 0 Z`;
}

let currentAmountObj = { value: 0 };
function animateValue(displayElement, targetValue) { gsap.to(currentAmountObj, { value: targetValue, duration: 0.6, ease: "power2.out", onUpdate: () => { displayElement.innerText = window.appState.currencySymbol + Math.floor(currentAmountObj.value).toLocaleString(); } }); }
function handleHover(el, val, rowId, cat) { if (!el) return; animateValue(amountDisplay, val); hoverCategoryName.textContent = cat; document.getElementById(rowId)?.classList.add('highlight'); const sa = parseFloat(el.dataset.startAngle), ea = parseFloat(el.dataset.endAngle), mid = sa + (ea - sa) / 2, vec = polarToCartesian(8, mid); gsap.to(el, { x: vec.x, y: vec.y, duration: 0.4, ease: "power3.out", overwrite: true }); }
function handleReset(el, total, rowId) { if (!el) return; animateValue(amountDisplay, total); hoverCategoryName.textContent = 'Total Balance'; document.getElementById(rowId)?.classList.remove('highlight'); gsap.to(el, { x: 0, y: 0, duration: 0.4, ease: "power3.out", overwrite: true }); }

window.addEventListener('load', async () => {
    await loadMainData();
    renderMainPage();
    gsap.from("#page-main .card", { duration: 1.2, y: 50, opacity: 0, stagger: 0.15, ease: "power4.out" });

    // --- ПРОВЕРКА НЕДЕЛЬНОГО ОТЧЕТА ПРИ ВХОДЕ ---
    setTimeout(async () => {
        const settings = JSON.parse(await AppStorage.get('appSettings')) || {};
        if (settings['notif-summary'] !== false) {
            const lastSummary = parseInt(localStorage.getItem('fimax_last_summary')) || 0;
            const now = Date.now();
            // Если прошло 7 дней (7 * 24 * 60 * 60 * 1000)
            if (now - lastSummary > 604800000) {
                await window.showWeeklySummary(false);
                localStorage.setItem('fimax_last_summary', now.toString());
            }
        }
    }, 1500); // Показываем красиво через полторы секунды после входа
});

document.addEventListener('pageOpened', async (e) => {
    if (e.detail === 'main') {
        await loadMainData();
        renderMainPage();
    }
});


// =================================================================
// === СТРАНИЦА PORTFOLIO ===
// =================================================================
let globalSelectedTags = [];
let portfolioAssetHistory = {}; 
let portfolioAssetMeta = {}; 

async function saveDataToCloud() {
    try {
        const dataToSave = { assetHistory: portfolioAssetHistory, assetMeta: portfolioAssetMeta };
        await AppStorage.set('portfolioData', JSON.stringify(dataToSave));
        
        // --- НОВЫЙ КОД: Мгновенная синхронизация с Главной страницей ---
        if (typeof portfolioDataMain !== 'undefined') {
            portfolioDataMain.assetMeta = JSON.parse(JSON.stringify(portfolioAssetMeta));
            portfolioDataMain.assetHistory = JSON.parse(JSON.stringify(portfolioAssetHistory));
            
            // Если мы удалили актив, нужно вычистить его из всех Пирогов
            let piesChanged = false;
            pies.forEach(pie => {
                const originalLength = pie.assets.length;
                pie.assets = pie.assets.filter(a => portfolioDataMain.assetMeta[a.id]);
                if (pie.assets.length !== originalLength) {
                    piesChanged = true;
                    updatePieHistory(pie);
                }
            });
            
            if (piesChanged) await saveMainData();
            
            // Перерисовываем главную страницу в фоне
            if (typeof renderMainPage === 'function') renderMainPage();
        }
    } catch (e) { console.error("Ошибка сохранения в облако:", e); }
}

async function loadDataFromCloud() {
    try {
        const savedData = await AppStorage.get('portfolioData');
        if (savedData) {
            const parsedData = JSON.parse(savedData);
            portfolioAssetHistory = parsedData.assetHistory || {};
            portfolioAssetMeta = parsedData.assetMeta || {};
        }
    } catch (e) { console.error("Ошибка загрузки из облака:", e); }
}

function setupButtonAnims() {
    document.querySelectorAll('button:not(.pill span)').forEach(btn => {
        btn.onmouseenter = () => gsap.to(btn, { scale: 1.03, duration: 0.2 });
        btn.onmouseleave = () => gsap.to(btn, { scale: 1, duration: 0.2 });
    });
}

function calculateGroupTotal(assetName) {
    let total = 0;
    Object.keys(portfolioAssetMeta).forEach(id => {
        if (portfolioAssetMeta[id].name === assetName) {
            const history = portfolioAssetHistory[id];
            if (history && history.length > 0) total += history[history.length - 1].value;
        }
    });
    return total;
}

function updateAllGroupTotals(assetName) {
    const formattedTotal = calculateGroupTotal(assetName).toFixed(2);
    Object.keys(portfolioAssetMeta).forEach(id => {
        if (portfolioAssetMeta[id].name === assetName) {
            const el = document.getElementById(`amount-display-${id}`);
            if (el) el.textContent = formattedTotal;
        }
    });
}

// --- НОВАЯ ЛОГИКА ФИЛЬТРОВ (ИМЯ + КАТЕГОРИЯ) ---
window.activeCategoryFilter = null;
window.activeNameFilter = null;

function toggleFilterPop(e) {
    e.stopPropagation();
    const pop = document.getElementById('filter-pop');
    const isActive = pop.classList.contains('active');
    closeAllPops();
    if (!isActive) pop.classList.add('active');
}

function setCategoryFilter(category) {
    window.activeCategoryFilter = category || null;
    closeAllPops();
    updateDashboard(); 
}

function setNameFilter(name) {
    window.activeNameFilter = name || null;
    closeAllPops();
    updateDashboard(); 
}

function updateFilterDropdown() {
    const catListEl = document.getElementById('filterCategoryList');
    const nameListEl = document.getElementById('filterNameList');
    const isRu = window.appState && window.appState.lang === 'ru';

    // Получаем уникальные категории и уникальные имена активов
    const uniqueCategories = [...new Set(Object.values(portfolioAssetMeta).map(m => m.category))].filter(Boolean);
    const uniqueNames = [...new Set(Object.values(portfolioAssetMeta).map(m => m.name))].filter(Boolean);

    // --- ГЕНЕРАЦИЯ СПИСКА ИМЕН ---
    if (nameListEl) {
        let nameHtml = `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${window.activeNameFilter === null ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${window.activeNameFilter === null ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setNameFilter('')">${isRu ? 'Все активы' : 'All Asset Names'}</button>`;
        uniqueNames.forEach(name => {
            const isActive = window.activeNameFilter === name;
            nameHtml += `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${isActive ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${isActive ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setNameFilter('${name}')">${name}</button>`;
        });
        nameListEl.innerHTML = nameHtml;
    }

    // --- ГЕНЕРАЦИЯ СПИСКА КАТЕГОРИЙ ---
    if (catListEl) {
        let catHtml = `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${window.activeCategoryFilter === null ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${window.activeCategoryFilter === null ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setCategoryFilter('')">${isRu ? 'Все категории' : 'All Categories'}</button>`;
        uniqueCategories.forEach(cat => {
            const isActive = window.activeCategoryFilter === cat;
            catHtml += `<button class="tag-white" style="width:100%; text-align:left; margin-bottom: 5px; background: ${isActive ? '#fff' : 'rgba(255,255,255,0.05)'} !important; color: ${isActive ? '#000' : '#fff'} !important; border: 1px solid var(--border);" onclick="setCategoryFilter('${cat}')">${cat}</button>`;
        });
        catListEl.innerHTML = catHtml;
    }
}

function applyFilters() {
    const searchInput = document.getElementById('portfolioSearch');
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    Object.keys(portfolioAssetMeta).forEach(id => {
        const card = document.getElementById(id);
        if (card) {
            const name = (portfolioAssetMeta[id].name || '');
            const category = portfolioAssetMeta[id].category || '';
            
            // Ищем текст в поиске
            const matchesSearch = name.toLowerCase().includes(term) || category.toLowerCase().includes(term);
            
            // Проверяем фильтры
            const matchesCategory = !window.activeCategoryFilter || category === window.activeCategoryFilter;
            const matchesName = !window.activeNameFilter || name === window.activeNameFilter;

            if (matchesSearch && matchesCategory && matchesName) {
                card.style.display = ''; 
            } else {
                card.style.display = 'none'; 
            }
        }
    });
}

// --- ОБНОВЛЕННЫЙ РАСЧЕТ СТАТИСТИКИ (Синхронизировано с двойным фильтром) ---
function updateDashboard() {
    const totalEl = document.getElementById('globalTotalDisplay'); 
    const totalLabel = document.getElementById('mainTotalLabel'); 
    const catContainer = document.getElementById('categoryBreakdown');
    if(!totalEl || !catContainer) return;
    
    let globalSum = 0; 
    let catSums = {};
    
    Object.keys(portfolioAssetMeta).forEach(id => {
        const name = portfolioAssetMeta[id].name || '';
        const category = portfolioAssetMeta[id].category || 'Uncategorized';
        const history = portfolioAssetHistory[id];
        const currentVal = (history && history.length > 0) ? history[history.length - 1].value : 0;
        
        const matchesName = !window.activeNameFilter || name === window.activeNameFilter;
        const matchesCategory = !window.activeCategoryFilter || category === window.activeCategoryFilter;

        // Если актив проходит фильтр по имени, добавляем его в статистику категорий
        if (matchesName) {
            if (!catSums[category]) catSums[category] = 0; 
            catSums[category] += currentVal;

            // Если он еще и проходит фильтр по категории, добавляем в главную сумму
            if (matchesCategory) {
                globalSum += currentVal;
            }
        }
    });
    
    totalEl.textContent = window.formatMoney(globalSum);

    // Меняем заголовок в зависимости от выбранных фильтров
    let labelText = 'Total Balance';
    if (window.activeNameFilter && window.activeCategoryFilter) {
        labelText = `${window.activeNameFilter} (${window.activeCategoryFilter})`;
    } else if (window.activeCategoryFilter) {
        labelText = `${window.activeCategoryFilter} Balance`;
    } else if (window.activeNameFilter) {
        labelText = `${window.activeNameFilter} Total`;
    }
    if (totalLabel) totalLabel.textContent = labelText;

    // Рисуем карточки (они отображают только те категории, которые актуальны для выбранного Name Filter)
    if (Object.keys(catSums).length === 0) {
        catContainer.innerHTML = `<span style="color:#444; font-size:12px;">No active assets</span>`;
    } else {
        catContainer.innerHTML = Object.keys(catSums).map(cat => {
            const isActive = window.activeCategoryFilter === cat;
            const opacity = (!window.activeCategoryFilter || isActive) ? '1' : '0.4';
            const border = isActive ? 'border: 1px solid rgba(255,255,255,0.5); transform: scale(1.02);' : '';
            return `<div class="stat-card" style="opacity: ${opacity}; ${border} cursor: pointer; transition: all 0.3s;" onclick="setCategoryFilter('${isActive ? '' : cat}')">
                <span class="stat-label">${cat}</span>
                <div class="stat-val">${window.appState.currencySymbol}${catSums[cat].toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>`;
        }).join('');
    }

    if (typeof updateFilterDropdown === 'function') updateFilterDropdown();
    if (typeof applyFilters === 'function') applyFilters();
}

function selectTag(name) { if (!globalSelectedTags.find(t => t.name === name)) { globalSelectedTags.push({ name: name, price: "" }); renderGlobalTags(); } }
function handleTagInput(e) { if (e.key === 'Enter' && e.target.value.trim()) { selectTag(e.target.value.trim()); e.target.value = ''; } }

function renderGlobalTags() {
    const container = document.getElementById('activeTags'); if (!container) return;
    container.innerHTML = globalSelectedTags.map((t, index) => {
        const displayPrice = t.price ? `$${t.price}` : '$0.00'; 
        return `<div class="rec-wrapper" style="display:inline-block; margin-right:8px; margin-bottom:8px;">
            <div class="pill" style="background: rgba(255,255,255,0.05); border-color: #fff;" onclick="event.stopPropagation(); togglePricePop(${index})">
                ${t.name} <span style="font-size:10px; opacity:0.6; margin-left:6px;">${displayPrice}</span>
                <span class="remove-tag-btn" onclick="event.stopPropagation(); removeGlobalTag('${t.name}')">✕</span>
            </div>
            <div class="rec-popover" id="price-pop-${index}" onclick="event.stopPropagation()">
                <span class="card-label">Set Value for ${t.name}</span>
                <input type="number" id="input-price-${index}" class="custom-tag-input" style="width:100%; margin-bottom:12px;" value="${t.price}" placeholder="0.00" onkeydown="if(event.key === 'Enter') { event.preventDefault(); savePrice(${index}); }">
                <button class="tag-white" style="width:100%" onclick="savePrice(${index})">Save Value</button>
            </div></div>`;
    }).join('');
}

function togglePricePop(index) { 
    document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active')); 
    document.getElementById(`price-pop-${index}`).classList.add('active'); 
    // Без setTimeout!
    const input = document.getElementById(`input-price-${index}`);
    if(input) input.focus(); 
}
function savePrice(index) { globalSelectedTags[index].price = document.getElementById(`input-price-${index}`).value; renderGlobalTags(); closeAllPops(); }
function removeGlobalTag(name) { if (confirm(`Remove category "${name}"?`)) { globalSelectedTags = globalSelectedTags.filter(t => t.name !== name); renderGlobalTags(); } }

async function distributeByCategories() {
    const nameInp = document.getElementById('newAssetName'); const amountInp = document.getElementById('newAssetAmount');
    const name = nameInp.value.trim() || 'New Asset'; const totalAmount = parseFloat(amountInp.value) || 0;
    if (globalSelectedTags.length === 0) return showToast('Please select at least one category!', 'error');
    const currentSum = globalSelectedTags.reduce((sum, tag) => sum + (parseFloat(tag.price) || 0), 0);
    if (currentSum > totalAmount) return showToast(`Error: Sum exceeds Total amount!`, 'error');

    globalSelectedTags.forEach(cat => createAssetCard(cat.name, name, cat.price, totalAmount, false));
    nameInp.value = ''; amountInp.value = ''; globalSelectedTags = []; renderGlobalTags(); updateDashboard();
    
    await saveDataToCloud();
}

function createAssetCard(catName, assetName, initialValue, amount, isInitialLoad, existingId) {
    const bento = document.getElementById('portfolioBento');
    if (!bento) return;
    const id = existingId || "asset-" + Math.floor(Math.random() * 1000000);
    const isRu = window.appState && window.appState.lang === 'ru';

    if (!isInitialLoad) {
        portfolioAssetHistory[id] = [{
            date: getTimestamp(),
            value: parseFloat(initialValue) || 0
        }];
        portfolioAssetMeta[id] = { category: catName, name: assetName };
    }

    const currentGroupTotal = calculateGroupTotal(assetName);

    const card = document.createElement('div');
    card.className = 'card';
    card.id = id;

    // ИСПРАВЛЕНИЕ: Кнопка со старым дизайном (del-btn), но позиционированная сверху справа (pos-top-right)
    card.innerHTML = `
        <button class="del-btn pos-top-right" onclick="removeCard('${id}')" title="Delete Asset">✕</button>

        <h3 class="card-label" style="padding-right: 50px;">${isRu ? 'Категория' : 'Category'}: ${catName}</h3>
        <table class="asset-table">
            <thead>
                <tr>
                    <th style="width: 35%">${isRu ? 'Название' : 'Asset Name'}</th>
                    <th style="width: 20%">${isRu ? 'Оценка' : 'Value'}</th>
                    <th style="width: 20%">${isRu ? 'Сумма' : 'Total Amount'}</th>
                    <th style="width: 25%; text-align:right">${isRu ? 'Действия' : 'Actions'}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
                        <div style="font-weight:800; font-size:18px;">${assetName}</div>
                        <div class="sub-tags-container" id="sub-tags-${id}"></div>
                    </td>
                    <td><div class="price-text" id="val-display-${id}">${parseFloat(initialValue).toFixed(2)}</div></td>
                    <td><div class="amount-text" id="amount-display-${id}">${currentGroupTotal.toFixed(2)}</div></td>
                    <td>
                        <div class="actions-cell-content">
                            <button class="det-btn" onclick="toggleDetails('${id}')">${isRu ? 'График' : 'Details'}</button>

                            <div class="rec-wrapper">
                                <button class="rec-btn" onclick="event.stopPropagation(); toggleRecs('${id}')">${isRu ? 'Метки' : 'Recommendations'}</button>
                                <div class="rec-popover" id="pop-${id}" onclick="event.stopPropagation()">
                                    <span class="card-label">${isRu ? 'Быстрые метки' : 'Quick Labels'}</span>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                                        <button class="tag-white" onclick="addSubTag('${id}', 'HODL')">HODL</button>
                                        <button class="tag-white" onclick="addSubTag('${id}', 'High Risk')">High Risk</button>
                                    </div>
                                    <input type="text" id="sub-tag-input-${id}" class="custom-tag-input" placeholder="${isRu ? '+ метка' : '+ sub-tag'}" onkeydown="handleSubTagInput(event, '${id}')">
                                </div>
                            </div>

                            <div class="rec-wrapper">
                                <button class="edit-btn" onclick="event.stopPropagation(); toggleEdit('${id}')">✎</button>
                                <div class="rec-popover" id="edit-pop-${id}" onclick="event.stopPropagation()">
                                    <span class="card-label">${isRu ? 'Изменить цену' : 'Update Value'}</span>
                                    <input type="number" id="edit-input-${id}" class="custom-tag-input"
                                           style="width:100%; margin-bottom:12px;" value="" placeholder="${isRu ? 'Новая цена' : 'New Value'}"
                                           onkeydown="if(event.key === 'Enter') { event.preventDefault(); saveAssetEdit('${id}'); }">
                                    <button class="tag-white" style="width:100%" onclick="saveAssetEdit('${id}')">${isRu ? 'Обновить' : 'Update'}</button>
                                </div>
                            </div>

                        </div>
                    </td>
                </tr>
                <tr id="det-row-${id}" class="details-row">
                    <td colspan="4">
                        <div class="details-box">
                            <span class="card-label">${isRu ? 'Изменение цены' : 'Performance Graph'}</span>
                            <div class="graph-container" id="graph-${id}"></div>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    `;

    bento.appendChild(card);

    if (!isInitialLoad) {
        gsap.from(card, { y: 20, opacity: 0, duration: 0.3 });
        updateAllGroupTotals(assetName);
    }

    setTimeout(() => renderGraph(id), 100);
}

function toggleDetails(id) { const row = document.getElementById(`det-row-${id}`); row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row'; if (row.style.display === 'table-row') renderGraph(id); }
function toggleRecs(id) { 
    closeAllPops(); 
    document.getElementById(`pop-${id}`).classList.add('active'); 
    // Без setTimeout!
    const input = document.getElementById(`sub-tag-input-${id}`);
    if(input) input.focus(); 
}

function toggleEdit(id) { 
    closeAllPops(); 
    document.getElementById(`edit-pop-${id}`).classList.add('active'); 
    // Без setTimeout!
    const input = document.getElementById(`edit-input-${id}`);
    if(input) { 
        input.value = ''; 
        input.focus(); 
    } 
}
function closeAllPops() { document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active')); }

async function removeCard(id) {
    const assetName = portfolioAssetMeta[id] ? portfolioAssetMeta[id].name : 'this asset';
    if (!confirm(`Are you sure you want to delete "${assetName}"? This action cannot be undone.`)) return; 
    
    delete portfolioAssetHistory[id]; delete portfolioAssetMeta[id];
    const el = document.getElementById(id); if (el) el.remove();
    if (assetName) updateAllGroupTotals(assetName);
    
    updateDashboard();
    await saveDataToCloud();
}

async function saveAssetEdit(id) {
    const newVal = parseFloat(document.getElementById(`edit-input-${id}`).value); if (isNaN(newVal)) return;
    portfolioAssetHistory[id].push({ date: getTimestamp(), value: newVal });
    document.getElementById(`val-display-${id}`).textContent = newVal.toFixed(2);
    updateAllGroupTotals(portfolioAssetMeta[id].name);
    renderGraph(id); updateDashboard(); closeAllPops();
    await saveDataToCloud();
}

function renderGraph(id) {
    const container = document.getElementById(`graph-${id}`); if (!container) return;
    const history = portfolioAssetHistory[id]; if (!history || history.length === 0) return;
    const width = container.offsetWidth || 600, height = 180, padding = 20;
    const values = history.map(h => h.value), maxVal = Math.max(...values, 10), minVal = 0;
    const points = history.map((point, index) => {
        const x = history.length === 1 ? width / 2 : padding + (index / (history.length - 1)) * (width - 2 * padding), y = height - padding - ((point.value - minVal) / (maxVal - minVal)) * (height - 2 * padding), dateObj = new Date(point.date);
        return { x, y, val: point.value, date: `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}` };
    });
    let svgContent = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
    if (points.length > 1) svgContent += `<polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" class="graph-line" />`;
    points.forEach(p => { svgContent += `<circle cx="${p.x}" cy="${p.y}" r="4" class="graph-point" /><text x="${p.x}" y="${height - 5}" class="graph-text">${p.date}</text><text x="${p.x}" y="${p.y - 10}" class="graph-text" style="font-weight:bold">${p.val}</text>`; });
    svgContent += `</svg>`; container.innerHTML = svgContent;
}

function addSubTag(cardId, name) { const container = document.getElementById(`sub-tags-${cardId}`); const pill = document.createElement('div'); pill.className = 'sub-pill'; pill.innerHTML = `${name} <span onclick="this.parentElement.remove()">✕</span>`; container.appendChild(pill); }
function handleSubTagInput(e, id) { if (e.key === 'Enter' && e.target.value.trim()) { addSubTag(id, e.target.value.trim()); e.target.value = ''; } }

document.addEventListener('click', () => closeAllPops());

window.addEventListener('load', async () => {
    await loadDataFromCloud();
    Object.keys(portfolioAssetMeta).forEach(id => {
        const meta = portfolioAssetMeta[id]; const history = portfolioAssetHistory[id];
        if (meta && history && history.length > 0) createAssetCard(meta.category, meta.name, history[history.length - 1].value, 0, true, id);
    });
    setupButtonAnims(); updateDashboard();

    // --- ДОБАВЛЕННЫЙ КОД: Вызов общей функции фильтрации ---
    const portfolioSearch = document.getElementById('portfolioSearch');
    if (portfolioSearch) {
        portfolioSearch.addEventListener('input', () => applyFilters());
    }
});

window.addEventListener('resize', () => { Object.keys(portfolioAssetHistory).forEach(id => renderGraph(id)); });

document.addEventListener('pageOpened', async (e) => {
    if (e.detail === 'portfolio') {
        await loadDataFromCloud();
        updateDashboard();
    }
});

// =================================================================
// === СТРАНИЦА SETTINGS (ПРОМОКОДЫ, НАСТРОЙКИ + БЕЗОПАСНЫЙ ПЕРЕВОДЧИК) ===
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const currencySelect = document.getElementById('currency-select');
    const languageSelect = document.getElementById('language-select');
    const notificationToggles = document.querySelectorAll('.notification-toggle');
    const clearDataBtn = document.getElementById('clear-data-btn');

    const promoCodeInput = document.getElementById('promo-code-input');
    const applyPromoBtn = document.getElementById('apply-promo-btn');
    const fullNameInput = document.getElementById('full-name');
    
    // Ищем кнопку сохранения профиля (учитывая оба языка)
    const updateProfileBtn = Array.from(document.querySelectorAll('#page-settings .white-btn'))
        .find(btn => btn.textContent.includes('Update Profile') || btn.textContent.includes('Сохранить профиль'));

    let settings = {};

    // --- БЕЗОПАСНЫЙ АВТО-ПЕРЕВОДЧИК ---
    function translateApp() {
        const lang = window.appState.lang || 'en';
        const isRu = lang === 'ru';
        
        const t = {
            addPie: isRu ? "+ Создать пирог" : "+ Add Pie",
            addAsset: isRu ? "+ Добавить актив" : "+ Add Asset",
            distAssets: isRu ? "Распределить активы" : "Distribute Assets",
            upProf: isRu ? "Сохранить профиль" : "Update Profile",
            apply: isRu ? "Применить" : "Apply",
            clear: isRu ? "Стереть все" : "Clear All Data"
        };

        const map = [
            ["Dashboard", "Дашборд"], ["Portfolio", "Портфель"], ["Analytics", "Аналитика"], ["Settings", "Настройки"], ["Account", "Аккаунт"],
            ["Total Balance", "Общий баланс"], ["Create New Entry", "Добавить актив"], ["Asset Name", "Название"], ["Total Amount", "Сумма"],
            ["Value", "Оценка"], ["Actions", "Действия"], ["Details", "График"], ["Recommendations", "Метки"], ["Update Value", "Изменить цену"],
            ["Save Value", "Сохранить"], ["Update", "Обновить"], ["All Asset Names", "Все активы"],
            ["All Categories", "Все категории"], ["Create New Pie", "Новый пирог"], ["Add Asset to Pie", "Добавить в пирог"], ["Confirm", "Подтвердить"],
            ["Cancel", "Отмена"], ["Close", "Закрыть"], ["Breakdown", "Структура"], ["Market Pulse", "Пульс рынка"], ["Smart Insight", "Умный Анализ"],
            ["Performance", "Доходность"], ["Portfolio Value", "Стоимость портфеля"], ["Overall Gain/Loss", "Прибыль/Убыток"],
            ["Best Performer", "Лучший рост"], ["Worst Performer", "Худшее падение"], ["Total Portfolio Performance", "График доходности"],
            ["Asset Performance", "Доходность активов"], ["Asset", "Актив"], ["Category", "Категория"], ["Change ($)", "Изм. ($)"], ["Change (%)", "Изм. (%)"],
            ["Upgrade Your Plan", "Улучшить тариф"], ["Choose Plan", "Выбрать"], ["Best Value", "Лучший выбор"], ["Profile Information", "Ваш профиль"],
            ["Full Name", "Полное имя"], ["Email Address", "Email"], ["Promo Code", "Промокод"],
            ["Preferences", "Параметры"], ["Light Theme", "Светлая тема"], ["Default Currency", "Валюта"], ["Language", "Язык интерфейса"],
            ["Weekly Summary", "Отчет за неделю"], ["Danger Zone", "Опасная зона"],
            ["Performance Graph", "Изменение цены"], ["Quick Labels", "Быстрые метки"],
            ["Start your 7-Day Free Trial", "Начни 7 дней бесплатно"],
            ["Get access to exclusive analytics. Cancel anytime.", "Полный доступ к аналитике. Отмена в любой момент."],
            ["1 Month", "1 Месяц"],
            ["6 Months", "6 Месяцев"],
            ["1 Year", "1 Год"],
            ["/ month", "/ месяц"],
            ["/ 6 months", "/ 6 мес."],
            ["/ year", "/ год"],
            ["✓ 7-Day Free Trial", "✓ 7 дней бесплатно"]
        ];

        // 1. Обновляем базовые кнопки (только если текст реально изменился)
        const ap = document.getElementById('openAddPieModal'); if(ap && ap.textContent !== t.addPie) ap.textContent = t.addPie;
        const aa = document.getElementById('openAddAssetModal'); if(aa && aa.textContent !== t.addAsset) aa.textContent = t.addAsset;
        const up = document.querySelector('.add-row .white-btn'); if(up && up.textContent !== t.distAssets) up.textContent = t.distAssets;
        if(updateProfileBtn && updateProfileBtn.textContent !== t.upProf) updateProfileBtn.textContent = t.upProf;
        if(applyPromoBtn && applyPromoBtn.textContent !== t.apply) applyPromoBtn.textContent = t.apply;
        if(clearDataBtn && clearDataBtn.textContent !== t.clear) clearDataBtn.textContent = t.clear;

        // 2. Переводим все тексты на сайте
        const selectors = 'h1, h2, h3, h4, span, b, .nav-text, th, td, .det-btn, .rec-btn, .tag-white, .card-label, label, .stat-label, .pulse-name';
        document.querySelectorAll(selectors).forEach(el => {
            el.childNodes.forEach(node => {
                if (node.nodeType === 3) { 
                    let text = node.nodeValue.trim();
                    if (!text) return;
                    
                    let newText = node.nodeValue;
                    map.forEach(([en, ru]) => {
                        if (isRu && text === en) newText = newText.replace(en, ru);
                        else if (!isRu && text === ru) newText = newText.replace(ru, en);
                    });

                    // Динамические тексты
                    if (isRu && text.startsWith("Category: ")) newText = newText.replace("Category: ", "Категория: ");
                    if (!isRu && text.startsWith("Категория: ")) newText = newText.replace("Категория: ", "Category: ");
                    if (isRu && text.startsWith("Set Value for ")) newText = newText.replace("Set Value for ", "Цена для ");
                    if (!isRu && text.startsWith("Цена для ")) newText = newText.replace("Цена для ", "Set Value for ");

                    if (node.nodeValue !== newText) node.nodeValue = newText;
                }
            });
        });

        // 3. Переводим плейсхолдеры
        const placeholders = [
            ['#portfolioSearch', "Search assets by name or category...", "Поиск активов и категорий..."],
            ['#analyticsSearch', "Search analytics by asset or category...", "Поиск в аналитике..."],
            ['#newAssetName', "Asset Name", "Название актива"],
            ['#newAssetAmount', "Total Amount (Limit)", "Сумма (Лимит)"],
            ['#new-pie-name', "Pie Name (e.g., My Portfolio)", "Имя (напр. Мой портфель)"],
            ['#promo-code-input', "Enter your code", "Введите код"],
            ['.custom-tag-input[placeholder="+ add category"], .custom-tag-input[placeholder="+ категория"]', "+ add category", "+ категория"],
            ['.custom-tag-input[placeholder="+ sub-tag"], .custom-tag-input[placeholder="+ метка"]', "+ sub-tag", "+ метка"],
            ['.custom-tag-input[placeholder="New Value"], .custom-tag-input[placeholder="Новая цена"]', "New Value", "Новая цена"]
        ];
        
        placeholders.forEach(([sel, en, ru]) => {
            document.querySelectorAll(sel).forEach(el => {
                const target = isRu ? ru : en;
                if(el.placeholder !== target) el.placeholder = target;
            });
        });

        // Длинные тексты
        const d1 = document.querySelector('.subscriptions-header p'); 
        if(d1) {
            const t1 = isRu ? 'Получите доступ к продвинутой аналитике.' : 'Get access to exclusive analytics and portfolio tracking features.';
            if(d1.textContent !== t1) d1.textContent = t1;
        }
        const d2 = document.querySelector('.setting-text p'); 
        if(d2 && (d2.textContent.includes('interface') || d2.textContent.includes('интерфейс'))) {
            const t2 = isRu ? 'Включить светлый интерфейс.' : 'Switch to light mode interface.';
            if(d2.textContent !== t2) d2.textContent = t2;
        }
    }

    // --- НАБЛЮДАТЕЛЬ (С ПРЕДОХРАНИТЕЛЕМ ОТ ЗАВИСАНИЯ) ---
    const observer = new MutationObserver((mutations) => {
        let needsTranslation = false;
        for (let m of mutations) {
            if (m.addedNodes.length > 0) { needsTranslation = true; break; }
        }
        if (needsTranslation) {
            observer.disconnect(); // ОТКЛЮЧАЕМ слежку (чтобы не было цикла)
            translateApp();
            observer.observe(document.body, { childList: true, subtree: true }); // ВКЛЮЧАЕМ обратно
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- ОСТАЛЬНАЯ ЛОГИКА ---
    function applyTheme(theme) {
        if (theme === 'light') { document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('fimax_theme', 'light'); } 
        else { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('fimax_theme', 'dark'); }
    }

    async function loadSettings() {
        const savedSettings = JSON.parse(await AppStorage.get('appSettings')) || {};
        settings = { 
            currency: savedSettings.currency || 'USD', 
            lang: savedSettings.lang || 'en',
            'notif-summary': savedSettings['notif-summary'] !== false,
            theme: savedSettings.theme || localStorage.getItem('fimax_theme') || 'dark',
            customName: savedSettings.customName || null
        };
        
        window.appState.currency = settings.currency;
        window.appState.lang = settings.lang;

        if(currencySelect) currencySelect.value = settings.currency;
        if(languageSelect) languageSelect.value = settings.lang;
        if(notificationToggles) notificationToggles.forEach(toggle => { toggle.checked = settings[toggle.dataset.key]; });
        if(themeToggle) themeToggle.checked = settings.theme === 'light';
        
        applyTheme(settings.theme);
        
        // Первый запуск перевода без слежки
        observer.disconnect();
        translateApp();
        observer.observe(document.body, { childList: true, subtree: true });

        if (settings.customName) {
            if(fullNameInput) fullNameInput.value = settings.customName;
            const profileNameEl = document.querySelector('.profile-name');
            if (profileNameEl) profileNameEl.textContent = settings.customName;
            const sidebarAccountSpan = document.querySelector('.account-text');
            if (sidebarAccountSpan) sidebarAccountSpan.textContent = settings.customName.split(' ')[0] || 'Account';
        }
    }

    async function saveSettings() { await AppStorage.set('appSettings', JSON.stringify(settings)); }

    if(currencySelect) {
        currencySelect.addEventListener('change', async () => {
            settings.currency = currencySelect.value;
            window.appState.currency = settings.currency;
            await saveSettings();
            if(typeof renderMainPage === 'function') renderMainPage();
            if(typeof updateDashboard === 'function') updateDashboard();
            if(window.showToast) showToast(settings.lang === 'ru' ? 'Валюта обновлена!' : 'Currency updated!', 'success');
        });
    }

    if(languageSelect) {
        languageSelect.addEventListener('change', async () => {
            settings.lang = languageSelect.value;
            window.appState.lang = settings.lang;
            observer.disconnect(); translateApp(); observer.observe(document.body, { childList: true, subtree: true });
            await saveSettings();
            if(window.showToast) showToast(settings.lang === 'ru' ? 'Язык изменен!' : 'Language updated!', 'success');
        });
    }

    if (updateProfileBtn && fullNameInput) {
        updateProfileBtn.addEventListener('click', async () => {
            const newName = fullNameInput.value.trim();
            if (!newName) return window.showToast ? showToast(settings.lang === 'ru' ? 'Введите имя' : 'Error', 'error') : alert('Error');
            const profileNameEl = document.querySelector('.profile-name');
            if (profileNameEl) profileNameEl.textContent = newName;
            const sidebarAccountSpan = document.querySelector('.account-text');
            if (sidebarAccountSpan) sidebarAccountSpan.textContent = newName.split(' ')[0] || 'Account';
            settings.customName = newName;
            await saveSettings();
            if(window.showToast) showToast(settings.lang === 'ru' ? 'Профиль сохранен!' : 'Profile updated!', 'success');
        });
    }

    // === ВСТАВЬТЕ СЮДА ИМЯ ВАШЕГО БОТА (без @) ===
    const BOT_USERNAME = "fimaxbot";

    function applyPromoCode(event) {
        if (event) event.preventDefault();
        if(!promoCodeInput) return;
        const code = promoCodeInput.value.trim().toUpperCase();
        if (!code) return window.showToast ? showToast(settings.lang === 'ru' ? 'Введите код' : 'Enter code', 'error') : alert('Error');
        
        if (window.showToast) showToast(settings.lang === 'ru' ? 'Обработка...' : 'Processing...', 'info');
        setTimeout(() => {
            if (window.Telegram && window.Telegram.WebApp) {
                // ЗАМЕНИТЕ YOUR_BOT_USERNAME НА ИМЯ ВАШЕГО БОТА БЕЗ @
                window.Telegram.WebApp.openTelegramLink(`https://t.me/${BOT_USERNAME}?start=promo_${code}`);
            }
        }, 1200);
        promoCodeInput.value = '';
    }

    if (applyPromoBtn) { applyPromoBtn.onclick = applyPromoCode; }
    
    if(themeToggle) {
        themeToggle.addEventListener('change', async () => {
            settings.theme = themeToggle.checked ? 'light' : 'dark';
            applyTheme(settings.theme);
            await saveSettings();
        });
    }

    if(notificationToggles) {
        notificationToggles.forEach(toggle => {
            toggle.addEventListener('change', async () => {
                settings[toggle.dataset.key] = toggle.checked;
                await saveSettings();
                if (toggle.dataset.key === 'notif-summary' && toggle.checked) {
                    if (window.showWeeklySummary) await window.showWeeklySummary(true);
                }
            });
        });
    }

    if(clearDataBtn) {
        clearDataBtn.addEventListener('click', async () => {
            const msg = settings.lang === 'ru' ? 'ВЫ УВЕРЕНЫ?\nВсе данные будут удалены навсегда.' : 'ARE YOU ABSOLUTELY SURE?\nThis will permanently delete your data.';
            if (confirm(msg)) {
                await AppStorage.clearAll();
                location.reload();
            }
        });
    }

    // === ЛОГИКА ОПЛАТЫ TELEGRAM STARS ===
    document.querySelectorAll('.subscribe-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const plan = e.target.dataset.plan;
            const stars = e.target.dataset.stars;
            const isRu = window.appState && window.appState.lang === 'ru';
            
            if (window.Telegram && window.Telegram.WebApp) {
                window.Telegram.WebApp.showConfirm(
                    isRu ? `Перейти к оплате ⭐️${stars}?` : `Proceed to pay ⭐️${stars}?`,
                    (confirmed) => {
                        if (confirmed) {
                            if(window.showToast) showToast(isRu ? 'Создаем счет...' : 'Generating invoice...', 'info');
                            setTimeout(() => {
                                // ЗАМЕНИТЕ YOUR_BOT_USERNAME НА ИМЯ ВАШЕГО БОТА БЕЗ @
                                window.Telegram.WebApp.openTelegramLink(`https://t.me/${BOT_USERNAME}?start=pay_${plan}`);
                            }, 1000);
                        }
                    }
                );
            }
        });
    });

    // === СИНХРОНИЗАЦИЯ СТАТУСА ПОДПИСКИ ===
    async function syncSubscriptionUI() {
        const urlParams = new URLSearchParams(window.location.search);
        let subEndFromUrl = urlParams.get('sub_end');
        
        if (subEndFromUrl && subEndFromUrl !== "none") {
            await AppStorage.set('premium_end', subEndFromUrl);
        } else if (subEndFromUrl === "none") {
            await AppStorage.set('premium_end', '');
        }

        const savedSubEnd = await AppStorage.get('premium_end');
        const statusBadge = document.querySelector('.status-badge');
        
        if (statusBadge) {
            if (savedSubEnd && new Date(savedSubEnd) > new Date()) { 
                const d = new Date(savedSubEnd);
                statusBadge.textContent = `Premium (до ${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()})`;
                statusBadge.className = 'status-badge'; 
                statusBadge.style.background = 'rgba(48, 209, 88, 0.15)';
                statusBadge.style.color = 'var(--profit-green)';
                statusBadge.style.border = '1px solid rgba(48, 209, 88, 0.3)';
            } else { 
                statusBadge.textContent = savedSubEnd ? 'Free Plan (Expired)' : 'Free Plan';
                statusBadge.className = 'status-badge free';
                statusBadge.style = ''; 
            }
        }
    }
    
    syncSubscriptionUI();
    loadSettings();
});