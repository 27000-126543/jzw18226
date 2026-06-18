(function() {
    'use strict';

    const state = {
        currentView: 'all',
        currentFeedId: null,
        currentFolderId: null,
        currentArticleId: null,
        sortBy: 'date-desc',
        searchQuery: '',
        expandedFolders: new Set(),
        sidebarCollapsed: false
    };

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    function showToast(message, type = 'info', duration = 3000) {
        const container = $('#toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.2s';
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }

    function formatDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        const now = new Date();
        const diff = now - d;
        const min = Math.floor(diff / 60000);
        const hr = Math.floor(diff / 3600000);
        const day = Math.floor(diff / 86400000);

        if (min < 1) return '刚刚';
        if (min < 60) return `${min}分钟前`;
        if (hr < 24) return `${hr}小时前`;
        if (day < 7) return `${day}天前`;

        const pad = n => n.toString().padStart(2, '0');
        if (d.getFullYear() === now.getFullYear()) {
            return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    }

    function formatDateFull(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        const pad = n => n.toString().padStart(2, '0');
        return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function openModal(modalId) {
        const container = $('#modalContainer');
        $$('.modal', container).forEach(m => m.classList.add('hidden'));
        $(modalId).classList.remove('hidden');
        container.classList.remove('hidden');
    }

    function closeModal() {
        $('#modalContainer').classList.add('hidden');
    }

    function truncate(str, len) {
        if (!str) return '';
        str = str.replace(/\s+/g, ' ').trim();
        if (str.length <= len) return str;
        return str.slice(0, len) + '...';
    }

    async function refreshNavCounts() {
        try {
            const counts = await Storage.Articles.countByStatus();
            $('#countAll').textContent = counts.total;
            $('#countUnread').textContent = counts.unread;
            $('#countStarred').textContent = counts.starred;
            $('#countReadLater').textContent = counts.readLater;
        } catch (e) {
            console.error(e);
        }
    }

    async function renderFoldersAndFeeds() {
        try {
            const [folders, feeds] = await Promise.all([
                Storage.Folders.getAll(),
                Storage.Feeds.getAll()
            ]);

            const feedUnreadCounts = {};
            for (const f of feeds) {
                const c = await Storage.Articles.countByFeed(f.id);
                feedUnreadCounts[f.id] = c.unread;
            }

            const folderList = $('#folderList');
            folderList.innerHTML = '';

            for (const folder of folders) {
                const folderFeeds = feeds.filter(f => f.folderId === folder.id);
                const folderUnread = folderFeeds.reduce((sum, f) => sum + (feedUnreadCounts[f.id] || 0), 0);
                const isExpanded = state.expandedFolders.has(folder.id);
                const isActive = state.currentView === 'folder' && state.currentFolderId === folder.id;

                const folderEl = document.createElement('div');
                folderEl.className = `folder-item ${isExpanded ? 'expanded' : ''} ${isActive ? 'active' : ''}`;
                folderEl.dataset.folderId = folder.id;

                const feedsHtml = folderFeeds.map(f => {
                    const isFeedActive = state.currentView === 'feed' && state.currentFeedId === f.id;
                    return `
                        <div class="feed-item ${isFeedActive ? 'active' : ''}" data-feed-id="${f.id}">
                            ${f.favicon ? `<img src="${f.favicon}" class="feed-favicon" onerror="this.style.display='none'">` : '<span class="nav-icon" style="margin-right:8px">📰</span>'}
                            <span class="feed-name" title="${f.name || f.title}">${truncate(f.name || f.title, 25)}</span>
                            ${feedUnreadCounts[f.id] > 0 ? `<span class="feed-unread">${feedUnreadCounts[f.id]}</span>` : ''}
                        </div>
                    `;
                }).join('');

                folderEl.innerHTML = `
                    <div class="folder-header">
                        <span class="folder-toggle">${isExpanded ? '▼' : '▶'}</span>
                        <span class="folder-name" title="${folder.name}">📁 ${truncate(folder.name, 20)}</span>
                        <div class="folder-actions">
                            <button class="mark-folder-read" title="标记分组内全部已读">✓已读</button>
                        </div>
                        ${folderUnread > 0 ? `<span class="folder-count unread-count">${folderUnread}</span>` : ''}
                    </div>
                    <div class="folder-feeds">${feedsHtml}</div>
                `;

                folderEl.querySelector('.folder-header').addEventListener('click', (e) => {
                    if (e.target.classList.contains('mark-folder-read')) {
                        e.stopPropagation();
                        markFolderRead(folder.id);
                        return;
                    }
                    if (state.expandedFolders.has(folder.id)) {
                        state.expandedFolders.delete(folder.id);
                    } else {
                        state.expandedFolders.add(folder.id);
                    }
                    renderFoldersAndFeeds();
                    selectFolder(folder.id);
                });

                folderEl.querySelectorAll('.feed-item').forEach(item => {
                    item.addEventListener('click', () => {
                        selectFeed(parseInt(item.dataset.feedId));
                    });
                });

                folderList.appendChild(folderEl);
            }

            const feedList = $('#feedList');
            feedList.innerHTML = '';
            const orphanFeeds = feeds.filter(f => !f.folderId);

            for (const f of orphanFeeds) {
                const isActive = state.currentView === 'feed' && state.currentFeedId === f.id;
                const el = document.createElement('div');
                el.className = `feed-item in-list ${isActive ? 'active' : ''}`;
                el.dataset.feedId = f.id;
                el.innerHTML = `
                    ${f.favicon ? `<img src="${f.favicon}" class="feed-favicon" onerror="this.style.display='none'">` : '<span class="nav-icon" style="margin-right:8px">📰</span>'}
                    <span class="feed-name" title="${f.name || f.title}">${truncate(f.name || f.title, 25)}</span>
                    ${feedUnreadCounts[f.id] > 0 ? `<span class="feed-unread">${feedUnreadCounts[f.id]}</span>` : ''}
                `;
                el.addEventListener('click', () => selectFeed(f.id));
                feedList.appendChild(el);
            }

            const folderSelect = $('#feedFolder');
            folderSelect.innerHTML = '<option value="">无（未分类）</option>' +
                folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');

        } catch (e) {
            console.error(e);
            showToast('加载订阅列表失败', 'error');
        }
    }

    async function markFolderRead(folderId) {
        try {
            const folderFeeds = await Storage.Feeds.getByFolder(folderId);
            const feedIds = folderFeeds.map(f => f.id);
            await Storage.Articles.markFeedIdsRead(feedIds);
            showToast('分组内文章已全部标记为已读', 'success');
            await Promise.all([renderArticleList(), refreshNavCounts(), renderFoldersAndFeeds()]);
        } catch (e) {
            console.error(e);
            showToast('标记已读失败', 'error');
        }
    }

    async function selectFeed(feedId) {
        state.currentView = 'feed';
        state.currentFeedId = feedId;
        state.currentFolderId = null;
        $$('.nav-item').forEach(i => i.classList.remove('active'));

        try {
            const feed = await Storage.Feeds.get(feedId);
            $('#currentViewTitle').textContent = feed ? (feed.name || feed.title) : '订阅源';
        } catch (e) {}

        await Promise.all([renderFoldersAndFeeds(), renderArticleList()]);
    }

    async function selectFolder(folderId) {
        state.currentView = 'folder';
        state.currentFolderId = folderId;
        state.currentFeedId = null;
        $$('.nav-item').forEach(i => i.classList.remove('active'));

        try {
            const folder = await Storage.Folders.get(folderId);
            $('#currentViewTitle').textContent = folder ? `📁 ${folder.name}` : '分组';
        } catch (e) {}

        await Promise.all([renderFoldersAndFeeds(), renderArticleList()]);
    }

    async function selectView(view) {
        state.currentView = view;
        state.currentFeedId = null;
        state.currentFolderId = null;

        $$('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));

        const titles = {
            'all': '全部文章',
            'unread': '未读文章',
            'starred': '⭐ 收藏文章',
            'readlater': '📖 稍后阅读'
        };
        $('#currentViewTitle').textContent = titles[view] || '全部文章';

        await Promise.all([renderFoldersAndFeeds(), renderArticleList()]);
    }

    async function getArticlesForCurrentView() {
        const options = {
            sortBy: state.sortBy,
            search: state.searchQuery
        };

        let feedIds = null;

        switch (state.currentView) {
            case 'unread':
                options.unreadOnly = true;
                break;
            case 'starred':
                options.starredOnly = true;
                break;
            case 'readlater':
                options.readLaterOnly = true;
                break;
            case 'feed':
                options.feedId = state.currentFeedId;
                break;
            case 'folder':
                if (state.currentFolderId) {
                    const folderFeeds = await Storage.Feeds.getByFolder(state.currentFolderId);
                    feedIds = folderFeeds.map(f => f.id);
                    options.feedIds = feedIds;
                }
                break;
            case 'all':
            default:
                break;
        }

        return Storage.Articles.getAll(options);
    }

    async function renderArticleList() {
        try {
            const articles = await getArticlesForCurrentView();
            const listEl = $('#articleList');
            const summaryEl = $('#listSummary');

            summaryEl.textContent = `${articles.length} 篇文章`;

            if (articles.length === 0) {
                listEl.innerHTML = `
                    <div style="padding:60px 20px;text-align:center;color:var(--text-muted)">
                        <div style="font-size:48px;margin-bottom:12px;opacity:0.3">📭</div>
                        <p>暂无文章</p>
                        <p style="font-size:12px;margin-top:8px">${state.searchQuery ? '试试其他关键词' : '点击"更新"按钮抓取最新内容'}</p>
                    </div>
                `;
                return;
            }

            const allFeeds = await Storage.Feeds.getAll();
            const feedMap = {};
            allFeeds.forEach(f => feedMap[f.id] = f);

            listEl.innerHTML = articles.map(a => {
                const feed = feedMap[a.feedId];
                const isSelected = a.id === state.currentArticleId;
                return `
                    <div class="article-card ${a.isRead ? 'read' : 'unread'} ${isSelected ? 'selected' : ''}" data-article-id="${a.id}">
                        <div class="article-card-header">
                            <div class="article-status-icons">
                                ${a.isStarred ? '<span title="已收藏">⭐</span>' : ''}
                                ${a.isReadLater ? '<span title="稍后阅读">📌</span>' : ''}
                            </div>
                            <h3 class="article-card-title">${truncate(a.title || '(无标题)', 80)}</h3>
                        </div>
                        <div class="article-card-meta">
                            <span class="article-card-source">${feed ? truncate(feed.name || feed.title, 15) : '未知'}</span>
                            <span>•</span>
                            <span class="article-card-date">${formatDate(a.pubDate)}</span>
                        </div>
                        <div class="article-card-summary">${truncate(a.summary || a.content, 150)}</div>
                    </div>
                `;
            }).join('');

            $$('.article-card', listEl).forEach(card => {
                card.addEventListener('click', () => {
                    const id = parseInt(card.dataset.articleId);
                    openArticle(id);
                });
            });

        } catch (e) {
            console.error(e);
            showToast('加载文章列表失败', 'error');
        }
    }

    async function openArticle(articleId) {
        try {
            state.currentArticleId = articleId;
            const article = await Storage.Articles.get(articleId);
            if (!article) {
                showToast('文章不存在', 'error');
                return;
            }

            if (!article.isRead) {
                await Storage.Articles.markRead(articleId, true);
            }

            const feed = await Storage.Feeds.get(article.feedId);

            document.querySelector('.app-container').classList.add('reader-open');

            $('#readerEmpty').classList.add('hidden');
            $('#readerContent').classList.remove('hidden');

            $('#articleTitle').textContent = article.title || '(无标题)';
            $('#articleSource').textContent = feed ? (feed.name || feed.title) : '未知来源';
            $('#articleDate').textContent = formatDateFull(article.pubDate);
            $('#articleLink').href = article.link || '#';

            let content = article.content || article.summary || '<p>暂无内容</p>';
            content = sanitizeContent(content);
            $('#articleBody').innerHTML = content;

            $$('.article-card').forEach(c => {
                c.classList.toggle('selected', parseInt(c.dataset.articleId) === articleId);
            });

            updateReaderToolbar(article);

            await Promise.all([renderArticleList(), refreshNavCounts(), renderFoldersAndFeeds()]);

            $('#articleContent').scrollTop = 0;

        } catch (e) {
            console.error(e);
            showToast('加载文章失败', 'error');
        }
    }

    function sanitizeContent(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        const toRemove = tmp.querySelectorAll('script, style, iframe, form, input, button, noscript');
        toRemove.forEach(el => el.remove());

        const links = tmp.querySelectorAll('a');
        links.forEach(a => {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
        });

        const imgs = tmp.querySelectorAll('img');
        imgs.forEach(img => {
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
        });

        return tmp.innerHTML;
    }

    function updateReaderToolbar(article) {
        const markBtn = $('#markReadBtn');
        markBtn.textContent = article.isRead ? '⊙' : '✓';
        markBtn.title = article.isRead ? '标记未读' : '标记已读';
        markBtn.classList.toggle('active', article.isRead);

        const starBtn = $('#starBtn');
        starBtn.textContent = article.isStarred ? '★' : '☆';
        starBtn.title = article.isStarred ? '取消收藏' : '收藏';
        starBtn.classList.toggle('starred', article.isStarred);
        starBtn.classList.toggle('active', article.isStarred);

        const rlBtn = $('#readLaterBtn');
        rlBtn.title = article.isReadLater ? '从稍后阅读移除' : '添加到稍后阅读';
        rlBtn.classList.toggle('active', article.isReadLater);
        rlBtn.style.color = article.isReadLater ? 'var(--primary-color)' : '';
    }

    async function applyReaderSettings() {
        try {
            const fontSize = await Storage.Settings.get('readerFontSize', 16);
            const lineHeight = await Storage.Settings.get('readerLineHeight', 1.6);

            document.documentElement.style.setProperty('--reader-font-size', `${fontSize}px`);
            document.documentElement.style.setProperty('--reader-line-height', lineHeight);

            $('#fontSizeDisplay').textContent = fontSize;
            $('#lineHeightDisplay').textContent = parseFloat(lineHeight).toFixed(1);
        } catch (e) {
            console.error(e);
        }
    }

    async function changeFontSize(delta) {
        try {
            let fontSize = await Storage.Settings.get('readerFontSize', 16);
            fontSize = Math.max(12, Math.min(28, fontSize + delta));
            await Storage.Settings.set('readerFontSize', fontSize);
            await applyReaderSettings();
        } catch (e) { console.error(e); }
    }

    async function changeLineHeight(delta) {
        try {
            let lh = parseFloat(await Storage.Settings.get('readerLineHeight', 1.6));
            lh = Math.max(1.2, Math.min(2.5, parseFloat((lh + delta).toFixed(1))));
            await Storage.Settings.set('readerLineHeight', lh);
            await applyReaderSettings();
        } catch (e) { console.error(e); }
    }

    let searchTimer = null;
    function handleSearchInput() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = $('#searchInput').value || '';
            renderArticleList();
        }, 300);
    }

    async function handleAddFeed() {
        const url = $('#feedUrl').value.trim();
        const name = $('#feedName').value.trim();
        const folderVal = $('#feedFolder').value;
        const folderId = folderVal ? parseInt(folderVal) : null;

        if (!url) {
            showToast('请输入RSS链接', 'warning');
            return;
        }

        try {
            const proxy = await Storage.Settings.get('corsProxy', '');
            const validated = await Fetcher.validateFeed(url, proxy);

            if (validated.isHtml && validated.feedLinks && validated.feedLinks.length > 0) {
                const msg = validated.feedLinks.map(l => `${l.title || '订阅源'}: ${l.url}`).join('\n');
                if (confirm(`检测到页面中包含 ${validated.feedLinks.length} 个RSS源：\n\n${msg}\n\n是否添加第一个？`)) {
                    $('#feedUrl').value = validated.feedLinks[0].url;
                    return handleAddFeed();
                }
                return;
            }

            const feedData = {
                url: validated.feedUrl,
                name: name || validated.title,
                title: validated.title,
                description: validated.description,
                link: validated.link,
                folderId: folderId,
                favicon: validated.link ? RSSParser.generateFaviconUrl(validated.link) : ''
            };

            const newFeed = await Storage.Feeds.create(feedData);

            if (validated.articles && validated.articles.length > 0) {
                const withFeedId = validated.articles.map(a => ({ ...a, feedId: newFeed.id }));
                await Storage.Articles.createBatch(withFeedId);
            }

            closeModal();
            $('#feedUrl').value = '';
            $('#feedName').value = '';
            $('#feedPreview').classList.add('hidden');

            showToast(`成功添加订阅源：${newFeed.name}`, 'success');

            try {
                const proxy = await Storage.Settings.get('corsProxy', '');
                await Fetcher.fetchFeed(newFeed, proxy);
            } catch (e) {
                console.warn('初始抓取失败，已保存订阅源', e);
            }

            await Promise.all([
                renderFoldersAndFeeds(),
                renderArticleList(),
                refreshNavCounts()
            ]);

            await updateLastFetch();

        } catch (e) {
            console.error(e);
            showToast(`添加失败：${e.message}`, 'error');
        }
    }

    async function handleValidateFeed() {
        const url = $('#feedUrl').value.trim();
        if (!url) {
            showToast('请输入RSS链接', 'warning');
            return;
        }

        const preview = $('#feedPreview');
        preview.classList.remove('hidden');
        $('#previewTitle').textContent = '验证中...';
        $('#previewDesc').textContent = '';

        try {
            const proxy = await Storage.Settings.get('corsProxy', '');
            const result = await Fetcher.validateFeed(url, proxy);
            if (result.isHtml) {
                const count = (result.feedLinks || []).length;
                $('#previewTitle').textContent = `⚠️ 检测到网页，发现 ${count} 个RSS源`;
                $('#previewDesc').textContent = (result.feedLinks || []).map(l => `${l.title || l.url}`).join('；');
            } else {
                $('#previewTitle').textContent = `✅ ${result.title} (${result.articleCount}篇)`;
                $('#previewDesc').textContent = result.description || '验证通过';
            }
        } catch (e) {
            $('#previewTitle').textContent = '❌ 验证失败';
            $('#previewDesc').textContent = e.message;
        }
    }

    async function handleAddGroup() {
        const name = $('#groupName').value.trim();
        if (!name) {
            showToast('请输入分组名称', 'warning');
            return;
        }
        try {
            await Storage.Folders.create(name);
            closeModal();
            $('#groupName').value = '';
            showToast('分组创建成功', 'success');
            await renderFoldersAndFeeds();
        } catch (e) {
            console.error(e);
            showToast('创建失败', 'error');
        }
    }

    async function handleRefresh() {
        const refreshBtn = $('#refreshBtn');
        const originalText = refreshBtn.innerHTML;
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '⏳ 更新中...';

        try {
            const result = await Fetcher.fetchAllFeeds((cur, total, name) => {
                $('#currentViewTitle').textContent = `更新中 (${cur}/${total}): ${truncate(name, 15)}`;
            });

            setTimeout(() => {
                const titles = {
                    'all': '全部文章', 'unread': '未读文章',
                    'starred': '⭐ 收藏文章', 'readlater': '📖 稍后阅读'
                };
                if (titles[state.currentView]) {
                    $('#currentViewTitle').textContent = titles[state.currentView];
                }
            }, 2000);

            showToast(`更新完成：新增 ${result.totalNewArticles} 篇，失败 ${result.errorCount} 个源`, 'success');

            await Promise.all([
                renderArticleList(),
                renderFoldersAndFeeds(),
                refreshNavCounts(),
                updateLastFetch()
            ]);

        } catch (e) {
            console.error(e);
            showToast('更新失败：' + e.message, 'error');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = originalText;
        }
    }

    async function handleMarkAllRead() {
        try {
            if (state.currentView === 'folder' && state.currentFolderId) {
                await markFolderRead(state.currentFolderId);
            } else if (state.currentView === 'feed' && state.currentFeedId) {
                await Storage.Feeds.markAllRead(state.currentFeedId);
                showToast('订阅源已全部标记已读', 'success');
                await Promise.all([renderArticleList(), refreshNavCounts(), renderFoldersAndFeeds()]);
            } else {
                if (!confirm('确定将所有文章标记为已读吗？')) return;
                await Storage.Articles.markAllRead();
                showToast('所有文章已标记为已读', 'success');
                await Promise.all([renderArticleList(), refreshNavCounts(), renderFoldersAndFeeds()]);
            }
        } catch (e) {
            console.error(e);
            showToast('操作失败', 'error');
        }
    }

    async function handleReaderToolbarClick(action) {
        if (!state.currentArticleId) return;

        try {
            const id = state.currentArticleId;
            let article = await Storage.Articles.get(id);
            if (!article) return;

            switch (action) {
                case 'toggle-read':
                    article = await Storage.Articles.markRead(id, !article.isRead);
                    showToast(article.isRead ? '已标记已读' : '已标记未读', 'info');
                    break;
                case 'toggle-star':
                    article = await Storage.Articles.toggleStarred(id);
                    showToast(article.isStarred ? '已添加到收藏' : '已取消收藏', 'success');
                    break;
                case 'toggle-readlater':
                    article = await Storage.Articles.toggleReadLater(id);
                    showToast(article.isReadLater ? '已添加到稍后阅读' : '已从稍后阅读移除', 'success');
                    break;
                case 'open-external':
                    if (article.link) {
                        window.open(article.link, '_blank', 'noopener');
                    }
                    return;
            }

            updateReaderToolbar(article);
            await Promise.all([renderArticleList(), refreshNavCounts()]);

        } catch (e) {
            console.error(e);
            showToast('操作失败', 'error');
        }
    }

    async function handleLoadSettings() {
        try {
            const [interval, max, proxy, autoMark] = await Promise.all([
                Storage.Settings.get('autoRefreshInterval', 30),
                Storage.Settings.get('maxArticlesPerFeed', 200),
                Storage.Settings.get('corsProxy', ''),
                Storage.Settings.get('autoMarkRead', true)
            ]);

            $('#autoRefreshInterval').value = interval;
            $('#maxArticlesPerFeed').value = max;
            $('#corsProxy').value = proxy;
            $('#autoMarkRead').checked = autoMark;
        } catch (e) {
            console.error(e);
        }
    }

    async function handleSaveSettings() {
        try {
            const interval = parseInt($('#autoRefreshInterval').value) || 30;
            const max = parseInt($('#maxArticlesPerFeed').value) || 200;
            const proxy = $('#corsProxy').value.trim();
            const autoMark = $('#autoMarkRead').checked;

            await Promise.all([
                Storage.Settings.set('autoRefreshInterval', Math.max(5, interval)),
                Storage.Settings.set('maxArticlesPerFeed', Math.max(20, max)),
                Storage.Settings.set('corsProxy', proxy),
                Storage.Settings.set('autoMarkRead', autoMark)
            ]);

            await Fetcher.restartAutoRefresh(async (result) => {
                if (result && result.totalNewArticles > 0) {
                    showToast(`后台更新：新增 ${result.totalNewArticles} 篇`, 'info');
                    await Promise.all([renderArticleList(), renderFoldersAndFeeds(), refreshNavCounts(), updateLastFetch()]);
                }
            });

            closeModal();
            showToast('设置已保存', 'success');

        } catch (e) {
            console.error(e);
            showToast('保存设置失败', 'error');
        }
    }

    async function handleExportOpml() {
        try {
            await OPML.exportOpmlFile();
            showToast('OPML文件已导出', 'success');
        } catch (e) {
            console.error(e);
            showToast('导出失败: ' + e.message, 'error');
        }
    }

    async function handleImportOpml() {
        const input = $('#opmlFileInput');
        if (!input.files || input.files.length === 0) {
            showToast('请选择OPML文件', 'warning');
            return;
        }
        try {
            const result = await OPML.importOpmlFile(input.files[0]);
            showToast(`导入成功：${result.feedCount} 个订阅源`, 'success');
            closeModal();
            input.value = '';
            await Promise.all([renderFoldersAndFeeds(), renderArticleList()]);
        } catch (e) {
            console.error(e);
            showToast('导入失败: ' + e.message, 'error');
        }
    }

    async function handleExportData() {
        try {
            await OPML.exportDataFile();
            showToast('完整备份已导出', 'success');
        } catch (e) {
            console.error(e);
            showToast('导出失败: ' + e.message, 'error');
        }
    }

    async function handleImportData() {
        const input = $('#dataFileInput');
        if (!input.files || input.files.length === 0) {
            showToast('请选择备份文件', 'warning');
            return;
        }
        if (!confirm('导入将合并现有数据，是否继续？')) return;
        try {
            await OPML.importDataFile(input.files[0]);
            showToast('数据恢复成功', 'success');
            closeModal();
            input.value = '';
            await Promise.all([renderFoldersAndFeeds(), renderArticleList(), refreshNavCounts()]);
        } catch (e) {
            console.error(e);
            showToast('恢复失败: ' + e.message, 'error');
        }
    }

    async function updateLastFetch() {
        const feeds = await Storage.Feeds.getAll();
        if (feeds.length === 0) {
            $('#lastFetch').textContent = '尚未更新';
            return;
        }
        const dates = feeds.map(f => f.lastFetched).filter(Boolean);
        if (dates.length === 0) {
            $('#lastFetch').textContent = '尚未更新';
            return;
        }
        const last = Math.max(...dates);
        $('#lastFetch').textContent = '最近更新：' + Fetcher.formatLastFetch(last);
    }

    function bindEvents() {
        $$('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', () => selectView(item.dataset.view));
        });

        $('#addFeedBtn').addEventListener('click', () => {
            $('#feedPreview').classList.add('hidden');
            openModal('#addFeedModal');
            setTimeout(() => $('#feedUrl').focus(), 100);
        });
        $('#addFeedFromEmpty').addEventListener('click', () => {
            openModal('#addFeedModal');
            setTimeout(() => $('#feedUrl').focus(), 100);
        });
        $('#addGroupBtn').addEventListener('click', () => {
            openModal('#addGroupModal');
            setTimeout(() => $('#groupName').focus(), 100);
        });
        $('#opmlBtn').addEventListener('click', () => openModal('#opmlModal'));
        $('#settingsBtn').addEventListener('click', () => {
            handleLoadSettings();
            openModal('#settingsModal');
        });

        $('#saveFeedBtn').addEventListener('click', handleAddFeed);
        $('#validateFeedBtn').addEventListener('click', handleValidateFeed);
        $('#saveGroupBtn').addEventListener('click', handleAddGroup);
        $('#saveSettingsBtn').addEventListener('click', handleSaveSettings);

        $('#exportOpmlBtn').addEventListener('click', handleExportOpml);
        $('#importOpmlBtn').addEventListener('click', handleImportOpml);
        $('#exportDataBtn').addEventListener('click', handleExportData);
        $('#importDataBtn').addEventListener('click', handleImportData);

        $('#refreshBtn').addEventListener('click', handleRefresh);
        $('#markAllReadBtn').addEventListener('click', handleMarkAllRead);

        $('#markReadBtn').addEventListener('click', () => handleReaderToolbarClick('toggle-read'));
        $('#starBtn').addEventListener('click', () => handleReaderToolbarClick('toggle-star'));
        $('#readLaterBtn').addEventListener('click', () => handleReaderToolbarClick('toggle-readlater'));
        $('#openExternalBtn').addEventListener('click', () => handleReaderToolbarClick('open-external'));

        $('#fontDecBtn').addEventListener('click', () => changeFontSize(-1));
        $('#fontIncBtn').addEventListener('click', () => changeFontSize(1));
        $('#lineDecBtn').addEventListener('click', () => changeLineHeight(-0.1));
        $('#lineIncBtn').addEventListener('click', () => changeLineHeight(0.1));

        $('#searchInput').addEventListener('input', handleSearchInput);

        $('#sortSelect').addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            renderArticleList();
        });

        $('#toggleSidebar').addEventListener('click', () => {
            state.sidebarCollapsed = !state.sidebarCollapsed;
            $('.sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
        });

        $$('[data-close="modal"]').forEach(btn => {
            btn.addEventListener('click', closeModal);
        });
        $('#modalContainer').addEventListener('click', (e) => {
            if (e.target.id === 'modalContainer') closeModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                $('#searchInput').focus();
            }
            if (e.key === 'j' && !e.target.matches('input, textarea')) {
                navigateArticle(1);
            }
            if (e.key === 'k' && !e.target.matches('input, textarea')) {
                navigateArticle(-1);
            }
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.matches('input, textarea')) {
                if (state.currentArticleId) {
                    e.preventDefault();
                    handleReaderToolbarClick('toggle-read');
                }
            }
            if (e.key === 's' && !e.target.matches('input, textarea') && state.currentArticleId) {
                e.preventDefault();
                handleReaderToolbarClick('toggle-star');
            }
        });

        $('#articleContent').addEventListener('scroll', () => {
            Storage.Settings.get('autoMarkRead', true).then(autoMark => {
                if (!autoMark || !state.currentArticleId) return;
                const el = $('#articleContent');
                if (el.scrollTop > el.scrollHeight * 0.7) {
                    Storage.Articles.markRead(state.currentArticleId, true).then(() => {
                        Promise.all([renderArticleList(), refreshNavCounts(), renderFoldersAndFeeds()]);
                    });
                }
            });
        });
    }

    async function navigateArticle(direction) {
        const cards = $$('.article-card');
        if (cards.length === 0) return;
        let idx = cards.findIndex(c => parseInt(c.dataset.articleId) === state.currentArticleId);
        if (idx < 0) idx = direction > 0 ? -1 : cards.length;
        idx = (idx + direction + cards.length) % cards.length;
        const id = parseInt(cards[idx].dataset.articleId);
        cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        await openArticle(id);
    }

    async function addDefaultFeeds() {
        const feeds = await Storage.Feeds.getAll();
        if (feeds.length > 0) return;

        const defaults = [
            { name: '少数派', url: 'https://sspai.com/feed', folder: '科技' },
            { name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', folder: '技术' },
            { name: 'Hacker News', url: 'https://hnrss.org/frontpage', folder: '科技' }
        ];

        try {
            for (const item of defaults) {
                let folder;
                try {
                    folder = await Storage.Folders.create(item.folder);
                } catch (e) {}
                try {
                    await Storage.Feeds.create({
                        url: item.url,
                        name: item.name,
                        title: item.name,
                        folderId: folder ? folder.id : null
                    });
                } catch (e) {}
            }
            await renderFoldersAndFeeds();
        } catch (e) {
            console.warn('添加默认源失败', e);
        }
    }

    async function init() {
        try {
            bindEvents();
            await Storage.init();
            await applyReaderSettings();
            state.sortBy = await Storage.Settings.get('sortBy', 'date-desc');
            $('#sortSelect').value = state.sortBy;

            await Promise.all([
                addDefaultFeeds(),
                refreshNavCounts(),
                renderFoldersAndFeeds(),
                renderArticleList(),
                updateLastFetch()
            ]);

            const interval = await Storage.Settings.get('autoRefreshInterval', 30);
            if (interval && interval >= 5) {
                Fetcher.startAutoRefresh(async (result) => {
                    if (result && result.totalNewArticles > 0) {
                        showToast(`后台更新：新增 ${result.totalNewArticles} 篇`, 'info');
                        await Promise.all([renderArticleList(), renderFoldersAndFeeds(), refreshNavCounts(), updateLastFetch()]);
                    }
                });
            }

        } catch (e) {
            console.error('初始化失败:', e);
            showToast('初始化失败: ' + e.message, 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
