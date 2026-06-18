(function() {
    'use strict';

    const state = {
        currentView: 'all',
        currentFeedId: null,
        currentFolderId: null,
        currentArticleId: null,
        sortBy: 'date-desc',
        searchQuery: '',
        filterStatus: 'all',
        filterSource: '',
        filterTime: '',
        expandedFolders: new Set(),
        sidebarCollapsed: false,
        currentArticleList: [],
        contextMenu: { type: null, id: null }
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
        hideContextMenu();
    }

    function truncate(str, len) {
        if (!str) return '';
        str = str.replace(/\s+/g, ' ').trim();
        if (str.length <= len) return str;
        return str.slice(0, len) + '...';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function highlightKeyword(text, keyword) {
        if (!keyword || !text) return escapeHtml(text || '');
        try {
            const escaped = escapeHtml(text);
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return escaped.replace(regex, '<span class="highlight-keyword">$1</span>');
        } catch (e) {
            return escapeHtml(text || '');
        }
    }

    function showContextMenu(e, type, id) {
        e.preventDefault();
        e.stopPropagation();
        state.contextMenu = { type, id };
        const menu = $('#contextMenu');
        menu.classList.remove('hidden');
        const x = Math.min(e.clientX, window.innerWidth - 180);
        const y = Math.min(e.clientY, window.innerHeight - 160);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        if (type === 'feed') {
            menu.querySelector('[data-action="markread"]').style.display = 'flex';
            menu.querySelector('.context-divider').style.display = 'block';
        } else if (type === 'folder') {
            menu.querySelector('[data-action="markread"]').style.display = 'flex';
            menu.querySelector('.context-divider').style.display = 'block';
        } else {
            menu.querySelector('[data-action="markread"]').style.display = 'none';
            menu.querySelector('.context-divider').style.display = 'none';
        }
    }

    function hideContextMenu() {
        $('#contextMenu').classList.add('hidden');
        state.contextMenu = { type: null, id: null };
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

    async function refreshAll() {
        await Promise.all([
            refreshNavCounts(),
            renderFoldersAndFeeds(),
            renderArticleList(),
            updateLastFetch()
        ]);
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

            const folderListEl = $('#folderList');
            folderListEl.innerHTML = '';

            for (const folder of folders) {
                const folderFeeds = feeds.filter(f => f.folderId === folder.id);
                const folderUnread = folderFeeds.reduce((sum, f) => sum + (feedUnreadCounts[f.id] || 0), 0);
                const isExpanded = state.expandedFolders.has(folder.id);
                const isActive = state.currentView === 'folder' && state.currentFolderId === folder.id;

                const folderEl = document.createElement('div');
                folderEl.className = `folder-item ${isExpanded ? 'expanded' : ''} ${isActive ? 'active' : ''}`;
                folderEl.dataset.folderId = folder.id;
                folderEl.dataset.type = 'folder';

                const feedsHtml = folderFeeds.map(f => renderFeedItem(f, feedUnreadCounts[f.id], false)).join('');

                folderEl.innerHTML = `
                    <div class="folder-header" draggable="true" data-type="folder" data-id="${folder.id}">
                        <span class="drag-handle" title="拖拽排序">⋮⋮</span>
                        <span class="folder-toggle">${isExpanded ? '▼' : '▶'}</span>
                        <span class="folder-name" title="${escapeHtml(folder.name)}">📁 ${highlightKeyword(truncate(folder.name, 18), state.searchQuery)}</span>
                        <div class="folder-actions">
                            <button class="mark-folder-read" data-action="markread" title="全部标记已读">✓</button>
                            <button class="edit-btn" data-action="edit" title="编辑">✏️</button>
                            <button class="delete-btn" data-action="delete" title="删除">🗑️</button>
                        </div>
                        ${folderUnread > 0 ? `<span class="folder-count unread-count">${folderUnread}</span>` : ''}
                    </div>
                    <div class="folder-feeds" data-folder-id="${folder.id}">${feedsHtml}</div>
                `;

                const header = folderEl.querySelector('.folder-header');
                const folderFeedsEl = folderEl.querySelector('.folder-feeds');

                header.addEventListener('click', (e) => {
                    if (e.target.closest('.drag-handle')) return;
                    const action = e.target.closest('[data-action]')?.dataset.action;
                    if (action === 'edit') { e.stopPropagation(); openEditModal('folder', folder.id); return; }
                    if (action === 'delete') { e.stopPropagation(); handleDeleteFolder(folder.id); return; }
                    if (action === 'markread') { e.stopPropagation(); markFolderRead(folder.id); return; }
                    if (state.expandedFolders.has(folder.id)) state.expandedFolders.delete(folder.id);
                    else state.expandedFolders.add(folder.id);
                    selectFolder(folder.id);
                });

                header.addEventListener('contextmenu', (e) => showContextMenu(e, 'folder', folder.id));
                attachDnDHandlers(header, 'folder', folder.id);

                folderEl.addEventListener('dragover', (e) => handleFolderDragOver(e, folderEl));
                folderEl.addEventListener('dragleave', (e) => handleFolderDragLeave(e, folderEl));
                folderEl.addEventListener('drop', (e) => handleFolderDrop(e, folder.id));

                folderEl.addEventListener('dragover', (e) => handleFolderItemDragOver(e, folderEl));
                folderEl.addEventListener('dragleave', (e) => handleFolderItemDragLeave(e, folderEl));
                folderEl.addEventListener('drop', (e) => handleFolderItemDrop(e, folderEl, folder.id));

                folderFeedsEl.querySelectorAll('.feed-item-wrapper').forEach(item => {
                    const feedId = parseInt(item.dataset.feedId);
                    item.addEventListener('click', (e) => {
                        if (e.target.closest('.drag-handle')) return;
                        selectFeed(feedId);
                    });
                    item.addEventListener('contextmenu', (e) => showContextMenu(e, 'feed', feedId));
                    attachDnDHandlers(item, 'feed', feedId);
                    item.addEventListener('dragover', (e) => handleFeedDragOver(e, item));
                    item.addEventListener('dragleave', (e) => handleFeedDragLeave(e, item));
                    item.addEventListener('drop', (e) => handleFeedDrop(e, item, feedId));
                });

                folderFeedsEl.addEventListener('dragover', (e) => handleFeedContainerDragOver(e, folderFeedsEl, folder.id));
                folderFeedsEl.addEventListener('drop', (e) => handleFeedContainerDrop(e, folderFeedsEl, folder.id));

                folderListEl.appendChild(folderEl);
            }

            folderListEl.addEventListener('dragover', (e) => handleFolderListDragOver(e, folderListEl));
            folderListEl.addEventListener('drop', (e) => handleFolderListDrop(e, folderListEl));

            const feedListEl = $('#feedList');
            feedListEl.innerHTML = '';
            const orphanFeeds = feeds.filter(f => !f.folderId);

            for (const f of orphanFeeds) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = renderFeedItem(f, feedUnreadCounts[f.id], true);
                const feedEl = wrapper.firstElementChild;
                feedEl.addEventListener('click', (e) => {
                    if (e.target.closest('.drag-handle')) return;
                    selectFeed(f.id);
                });
                feedEl.addEventListener('contextmenu', (e) => showContextMenu(e, 'feed', f.id));
                attachDnDHandlers(feedEl, 'feed', f.id);
                feedEl.addEventListener('dragover', (e) => handleFeedDragOver(e, feedEl));
                feedEl.addEventListener('dragleave', (e) => handleFeedDragLeave(e, feedEl));
                feedEl.addEventListener('drop', (e) => handleFeedDrop(e, feedEl, f.id));
                feedListEl.appendChild(feedEl);
            }

            feedListEl.addEventListener('dragover', (e) => handleFeedContainerDragOver(e, feedListEl, null));
            feedListEl.addEventListener('drop', (e) => handleFeedContainerDrop(e, feedListEl, null));

            const filterSource = $('#filterSource');
            const currentVal = filterSource.value;
            filterSource.innerHTML = '<option value="">全部来源</option>' +
                feeds.map(f => `<option value="${f.id}">${escapeHtml(f.name || f.title)}</option>`).join('');
            filterSource.value = currentVal || '';

            const folderSelect = $('#feedFolder');
            folderSelect.innerHTML = '<option value="">无（未分类）</option>' +
                folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');

        } catch (e) {
            console.error(e);
            showToast('加载订阅列表失败', 'error');
        }
    }

    function renderFeedItem(feed, unreadCount, isOrphan) {
        const isActive = state.currentView === 'feed' && state.currentFeedId === feed.id;
        return `
            <div class="feed-item-wrapper ${isActive ? 'active' : ''}" data-feed-id="${feed.id}" draggable="true" data-type="feed" data-id="${feed.id}">
                <span class="drag-handle" title="拖拽移动">⋮⋮</span>
                ${feed.favicon ? `<img src="${feed.favicon}" class="feed-favicon" onerror="this.style.display='none'">` : '<span style="font-size:12px;margin-right:6px">📰</span>'}
                <span class="feed-item-name" title="${escapeHtml(feed.name || feed.title)}">${highlightKeyword(truncate(feed.name || feed.title, 22), state.searchQuery)}</span>
                <div class="folder-actions" style="display:none">
                    <button class="edit-btn" data-action="edit" title="编辑">✏️</button>
                    <button class="delete-btn" data-action="delete" title="删除">🗑️</button>
                </div>
                ${unreadCount > 0 ? `<span class="feed-unread">${unreadCount}</span>` : ''}
            </div>
        `;
    }

    function attachDnDHandlers(el, type, id) {
        el.addEventListener('dragstart', (e) => handleDragStart(e, type, id));
        el.addEventListener('dragend', (e) => handleDragEnd(e, el));
    }

    function handleDragStart(e, type, id) {
        e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
        e.dataTransfer.effectAllowed = 'move';
        if (type === 'feed') {
            const wrapper = e.target.closest('.feed-item-wrapper') || e.target.closest('[data-type="feed"]');
            wrapper?.classList.add('dragging');
        } else if (type === 'folder') {
            const header = e.target.closest('.folder-header') || e.target.closest('[data-type="folder"]');
            header?.classList.add('dragging');
        }
        setTimeout(() => hideContextMenu(), 0);
    }

    function clearAllDropIndicators() {
        $$('.feed-item-wrapper').forEach(w => w.classList.remove('dragging', 'drop-above', 'drop-below'));
        $$('.folder-item').forEach(f => f.classList.remove('drag-over', 'drop-above', 'drop-below'));
        $$('.folder-header').forEach(h => h.classList.remove('dragging'));
    }

    function handleDragEnd(e, el) {
        e.dataTransfer.clearData();
        clearAllDropIndicators();
    }

    function getDragData(e) {
        try {
            return JSON.parse(e.dataTransfer.getData('text/plain'));
        } catch (err) { return null; }
    }

    function handleFolderDragOver(e, folderEl) {
        const data = getDragData(e);
        if (!data || data.type !== 'feed') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        folderEl.classList.add('drag-over');
    }

    function handleFolderDragLeave(e, folderEl) {
        if (!folderEl.contains(e.relatedTarget)) {
            folderEl.classList.remove('drag-over');
        }
    }

    async function handleFolderDrop(e, folderId) {
        e.preventDefault();
        e.stopPropagation();
        const folderEl = e.currentTarget;
        folderEl.classList.remove('drag-over');
        clearAllDropIndicators();

        try {
            const data = getDragData(e);
            if (!data || data.type !== 'feed') return;

            const feed = await Storage.Feeds.get(data.id);
            if (!feed) return;
            if (feed.folderId === folderId) return;

            const targetFeeds = await Storage.Feeds.getByFolder(folderId);
            const nextOrder = targetFeeds.length > 0
                ? Math.max(...targetFeeds.map(f => f.order ?? f.id ?? 0)) + 1
                : 0;
            await Storage.Feeds.update(data.id, { folderId: folderId, order: nextOrder });
            state.expandedFolders.add(folderId);
            showToast('已移动到分组', 'success');
            await refreshAll();
        } catch (err) {
            console.error(err);
            showToast('移动失败', 'error');
        }
    }

    function handleFolderListDragOver(e, listEl) {
        const data = getDragData(e);
        if (!data || data.type !== 'folder') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleFolderItemDragOver(e, folderEl) {
        const data = getDragData(e);
        if (!data || data.type !== 'folder') return;
        const targetHeader = folderEl.querySelector('.folder-header');
        if (!targetHeader) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = targetHeader.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        folderEl.classList.remove('drop-above', 'drop-below', 'drag-over');
        if (e.clientY < mid) folderEl.classList.add('drop-above');
        else folderEl.classList.add('drop-below');
    }

    function handleFolderItemDragLeave(e, folderEl) {
        if (!folderEl.contains(e.relatedTarget)) {
            folderEl.classList.remove('drop-above', 'drop-below');
        }
    }

    async function handleFolderItemDrop(e, folderEl, targetFolderId) {
        const data = getDragData(e);
        if (!data || data.type !== 'folder') return;
        e.preventDefault();
        e.stopPropagation();
        clearAllDropIndicators();

        try {
            const isAbove = folderEl.classList.contains('drop-above');
            if (data.id === targetFolderId) return;

            const allFolders = await Storage.Folders.getAll();
            const draggedIndex = allFolders.findIndex(f => f.id === data.id);
            const targetIndex = allFolders.findIndex(f => f.id === targetFolderId);
            if (draggedIndex === -1 || targetIndex === -1) return;

            const withoutDragged = allFolders.filter(f => f.id !== data.id);
            const dragged = allFolders[draggedIndex];

            let insertIdx;
            if (draggedIndex < targetIndex) {
                insertIdx = isAbove ? targetIndex - 1 : targetIndex;
            } else {
                insertIdx = isAbove ? targetIndex : targetIndex + 1;
            }
            insertIdx = Math.max(0, Math.min(insertIdx, withoutDragged.length));

            withoutDragged.splice(insertIdx, 0, dragged);

            for (let i = 0; i < withoutDragged.length; i++) {
                await Storage.Folders.updateOrder(withoutDragged[i].id, i);
            }

            showToast('分组顺序已更新', 'success');
            await refreshAll();
        } catch (err) {
            console.error(err);
            showToast('排序失败', 'error');
        }
    }

    async function handleFolderListDrop(e, listEl) {
        const data = getDragData(e);
        if (!data || data.type !== 'folder') return;
        e.preventDefault();
        clearAllDropIndicators();
    }

    function handleFeedContainerDragOver(e, containerEl, folderId) {
        const data = getDragData(e);
        if (!data || data.type !== 'feed') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    }

    async function handleFeedContainerDrop(e, containerEl, folderId) {
        const data = getDragData(e);
        if (!data || data.type !== 'feed') return;
        e.preventDefault();
        e.stopPropagation();
        clearAllDropIndicators();

        try {
            const feed = await Storage.Feeds.get(data.id);
            if (!feed) return;
            if (feed.folderId === folderId) return;

            const targetFeeds = await Storage.Feeds.getByFolder(folderId);
            const nextOrder = targetFeeds.length > 0
                ? Math.max(...targetFeeds.map(f => f.order ?? f.id ?? 0)) + 1
                : 0;
            await Storage.Feeds.update(data.id, { folderId: folderId, order: nextOrder });
            if (folderId) state.expandedFolders.add(folderId);
            showToast(folderId ? '已移动到分组' : '已移动到未分类', 'success');
            await refreshAll();
        } catch (err) {
            console.error(err);
            showToast('移动失败', 'error');
        }
    }

    function handleFeedDragOver(e, feedEl) {
        const data = getDragData(e);
        if (!data || data.type !== 'feed') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = feedEl.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        feedEl.classList.remove('drop-above', 'drop-below');
        if (e.clientY < mid) feedEl.classList.add('drop-above');
        else feedEl.classList.add('drop-below');
    }

    function handleFeedDragLeave(e, feedEl) {
        if (!feedEl.contains(e.relatedTarget)) {
            feedEl.classList.remove('drop-above', 'drop-below');
        }
    }

    async function handleFeedDrop(e, targetFeedEl, targetFeedId) {
        const data = getDragData(e);
        if (!data || data.type !== 'feed') return;
        e.preventDefault();
        e.stopPropagation();

        const isAbove = targetFeedEl.classList.contains('drop-above');
        clearAllDropIndicators();

        if (data.id === targetFeedId) return;

        try {
            const [dragged, target] = await Promise.all([
                Storage.Feeds.get(data.id),
                Storage.Feeds.get(targetFeedId)
            ]);
            if (!dragged || !target) return;

            const targetFolderId = target.folderId;
            const draggedFolderId = dragged.folderId;
            const folderChanged = draggedFolderId !== targetFolderId;

            if (folderChanged) {
                await Storage.Feeds.update(data.id, { folderId: targetFolderId });
            }

            const targetFolderFeeds = await Storage.Feeds.getByFolder(targetFolderId);
            const draggedIndex = targetFolderFeeds.findIndex(f => f.id === data.id);
            const targetIndex = targetFolderFeeds.findIndex(f => f.id === targetFeedId);
            const others = targetFolderFeeds.filter(f => f.id !== data.id);

            let insertIndex = isAbove ? targetIndex : targetIndex + 1;
            if (draggedIndex !== -1 && draggedIndex < targetIndex) insertIndex--;
            if (draggedIndex === -1 && !isAbove) insertIndex = targetIndex + 1;
            if (draggedIndex === -1 && isAbove) insertIndex = targetIndex;
            insertIndex = Math.max(0, Math.min(insertIndex, others.length));

            const freshDragged = await Storage.Feeds.get(data.id);
            others.splice(insertIndex, 0, freshDragged);

            for (let i = 0; i < others.length; i++) {
                await Storage.Feeds.updateOrder(others[i].id, i);
            }

            if (targetFolderId) state.expandedFolders.add(targetFolderId);
            showToast(folderChanged ? '已移动并重新排序' : '顺序已更新', 'success');
            await refreshAll();
        } catch (err) {
            console.error(err);
            showToast('排序失败', 'error');
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
            'all': '全部文章', 'unread': '未读文章',
            'starred': '⭐ 收藏文章', 'readlater': '📖 稍后阅读'
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
            case 'unread': options.unreadOnly = true; break;
            case 'starred': options.starredOnly = true; break;
            case 'readlater': options.readLaterOnly = true; break;
            case 'feed': options.feedId = state.currentFeedId; break;
            case 'folder':
                if (state.currentFolderId) {
                    const folderFeeds = await Storage.Feeds.getByFolder(state.currentFolderId);
                    feedIds = folderFeeds.map(f => f.id);
                    options.feedIds = feedIds;
                }
                break;
        }

        let articles = await Storage.Articles.getAll(options);

        if (state.searchQuery) {
            switch (state.filterStatus) {
                case 'unread': articles = articles.filter(a => !a.isRead); break;
                case 'read': articles = articles.filter(a => a.isRead); break;
            }
            if (state.filterSource) {
                articles = articles.filter(a => a.feedId === parseInt(state.filterSource));
            }
            if (state.filterTime) {
                const now = Date.now();
                let cutoff = 0;
                switch (state.filterTime) {
                    case 'today': cutoff = now - 86400000; break;
                    case '7days': cutoff = now - 7 * 86400000; break;
                    case '30days': cutoff = now - 30 * 86400000; break;
                }
                articles = articles.filter(a => a.pubDate >= cutoff);
            }
        }

        state.currentArticleList = articles;
        return articles;
    }

    async function renderArticleList() {
        try {
            const articles = await getArticlesForCurrentView();
            const listEl = $('#articleList');
            const summaryEl = $('#listSummary');

            const showFilter = state.searchQuery && state.searchQuery.trim();
            $('#searchFilters').classList.toggle('hidden', !showFilter);

            if (showFilter) {
                let filterMsg = `找到 ${articles.length} 篇匹配`;
                const filters = [];
                if (state.filterStatus !== 'all') filters.push(state.filterStatus === 'unread' ? '未读' : '已读');
                if (state.filterSource) {
                    const src = await Storage.Feeds.get(parseInt(state.filterSource));
                    if (src) filters.push(`来源: ${src.name}`);
                }
                if (state.filterTime) filters.push(`时间: ${state.filterTime}`);
                if (filters.length > 0) filterMsg += ` (筛选: ${filters.join('、')})`;
                $('#filterInfo').textContent = filterMsg;
                summaryEl.textContent = `${articles.length} 篇结果`;
            } else {
                summaryEl.textContent = `${articles.length} 篇文章`;
            }

            if (articles.length === 0) {
                listEl.innerHTML = `
                    <div style="padding:60px 20px;text-align:center;color:var(--text-muted)">
                        <div style="font-size:48px;margin-bottom:12px;opacity:0.3">📭</div>
                        <p>${showFilter ? '没有匹配的结果' : '暂无文章'}</p>
                        <p style="font-size:12px;margin-top:8px">${showFilter ? '试试清除筛选条件或其他关键词' : '点击"更新"按钮抓取最新内容'}</p>
                    </div>
                `;
                return;
            }

            const allFeeds = await Storage.Feeds.getAll();
            const feedMap = {};
            allFeeds.forEach(f => feedMap[f.id] = f);
            const kw = state.searchQuery && state.searchQuery.trim();

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
                            <h3 class="article-card-title">${highlightKeyword(truncate(a.title || '(无标题)', 80), kw)}</h3>
                        </div>
                        <div class="article-card-meta">
                            <span class="article-card-source">${feed ? highlightKeyword(truncate(feed.name || feed.title, 15), kw) : '未知'}</span>
                            <span>•</span>
                            <span class="article-card-date">${formatDate(a.pubDate)}</span>
                        </div>
                        <div class="article-card-summary">${highlightKeyword(truncate(a.summary || a.content, 150), kw)}</div>
                    </div>
                `;
            }).join('');

            $$('.article-card', listEl).forEach(card => {
                card.addEventListener('click', () => {
                    const id = parseInt(card.dataset.articleId);
                    openArticle(id);
                });
            });

            updateNavButtons();

        } catch (e) {
            console.error(e);
            showToast('加载文章列表失败', 'error');
        }
    }

    function updateNavButtons() {
        const idx = state.currentArticleList.findIndex(a => a.id === state.currentArticleId);
        const prevBtn = $('#prevArticleBtn');
        const nextBtn = $('#nextArticleBtn');
        prevBtn.disabled = idx <= 0 || state.currentArticleList.length === 0;
        nextBtn.disabled = idx === -1 || idx >= state.currentArticleList.length - 1;
    }

    async function syncReadStateUI() {
        await Promise.all([
            refreshNavCounts(),
            renderFoldersAndFeeds(),
            renderArticleList()
        ]);
        updateNavButtons();
        if (state.currentArticleId) {
            const a = await Storage.Articles.get(state.currentArticleId);
            if (a) updateReaderToolbar(a);
        }
    }

    async function openArticle(articleId) {
        try {
            state.currentArticleId = articleId;
            const article = await Storage.Articles.get(articleId);
            if (!article) { showToast('文章不存在', 'error'); return; }

            let justMarked = false;
            if (!article.isRead) {
                await Storage.Articles.markRead(articleId, true);
                article.isRead = true;
                article.readAt = Date.now();
                justMarked = true;
            }

            const feed = await Storage.Feeds.get(article.feedId);
            document.querySelector('.app-container').classList.add('reader-open');

            $('#readerEmpty').classList.add('hidden');
            $('#readerContent').classList.remove('hidden');

            const kw = state.searchQuery && state.searchQuery.trim();
            $('#articleTitle').innerHTML = highlightKeyword(article.title || '(无标题)', kw);
            $('#articleSource').textContent = feed ? (feed.name || feed.title) : '未知来源';
            $('#articleDate').textContent = formatDateFull(article.pubDate);

            const authorEl = $('#articleAuthor');
            const sepEl = $('#authorSeparator');
            if (article.author && article.author.trim()) {
                authorEl.textContent = `作者: ${article.author}`;
                authorEl.style.display = '';
                sepEl.style.display = '';
            } else {
                authorEl.style.display = 'none';
                sepEl.style.display = 'none';
            }

            $('#articleLink').href = article.link || '#';

            let content = article.content || article.summary || '<p>暂无内容</p>';
            content = sanitizeContent(content);
            if (kw) content = highlightInHtml(content, kw);
            $('#articleBody').innerHTML = content;

            updateReaderToolbar(article);

            if (justMarked) {
                await syncReadStateUI();
            } else {
                await renderArticleList();
                updateNavButtons();
            }

            $('#articleContent').scrollTop = 0;

        } catch (e) {
            console.error(e);
            showToast('加载文章失败', 'error');
        }
    }

    function highlightInHtml(html, keyword) {
        if (!keyword) return html;
        try {
            const safeKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?![^<]*>)(${safeKw})`, 'gi');
            return html.replace(regex, '<mark class="highlight-keyword">$1</mark>');
        } catch (e) { return html; }
    }

    function sanitizeContent(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('script, style, iframe, form, input, button, noscript').forEach(el => el.remove());
        tmp.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
        tmp.querySelectorAll('img').forEach(img => { img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; });
        return tmp.innerHTML;
    }

    function updateReaderToolbar(article) {
        const markBtn = $('#markReadBtn');
        markBtn.querySelector('.icon').textContent = article.isRead ? '⊙' : '✓';
        markBtn.querySelector('.btn-text').textContent = article.isRead ? '未读' : '已读';
        markBtn.title = article.isRead ? '标记未读 (Enter)' : '标记已读 (Enter)';
        markBtn.classList.toggle('active', article.isRead);

        const starBtn = $('#starBtn');
        starBtn.querySelector('.icon').textContent = article.isStarred ? '★' : '☆';
        starBtn.querySelector('.btn-text').textContent = article.isStarred ? '已收藏' : '收藏';
        starBtn.title = article.isStarred ? '取消收藏 (S)' : '收藏 (S)';
        starBtn.classList.toggle('starred', article.isStarred);
        starBtn.classList.toggle('active', article.isStarred);

        const rlBtn = $('#readLaterBtn');
        rlBtn.querySelector('.btn-text').textContent = article.isReadLater ? '已保存' : '稍后';
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
        } catch (e) { console.error(e); }
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
            if (!state.searchQuery.trim()) {
                state.filterStatus = 'all';
                state.filterSource = '';
                state.filterTime = '';
                $$('#filterStatus .filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
                $('#filterSource').value = '';
                $('#filterTime').value = '';
            }
            renderFoldersAndFeeds();
            renderArticleList();
        }, 250);
    }

    async function openEditModal(type, id) {
        state.contextMenu = { type, id };
        hideContextMenu();
        const titleEl = $('#editModalTitle');
        const labelEl = $('#editModalLabel');
        const input = $('#editModalInput');
        const folderGroup = $('#editFolderGroup');
        const folderSelect = $('#editFolderSelect');

        try {
            if (type === 'folder') {
                const folder = await Storage.Folders.get(id);
                titleEl.textContent = '编辑分组';
                labelEl.textContent = '分组名称';
                input.value = folder ? folder.name : '';
                folderGroup.style.display = 'none';
            } else if (type === 'feed') {
                const feed = await Storage.Feeds.get(id);
                titleEl.textContent = '编辑订阅源';
                labelEl.textContent = '订阅源名称';
                input.value = feed ? (feed.name || feed.title) : '';

                const folders = await Storage.Folders.getAll();
                folderSelect.innerHTML = '<option value="">无（未分类）</option>' +
                    folders.map(f => `<option value="${f.id}" ${feed && feed.folderId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
                folderGroup.style.display = 'block';
            }

            openModal('#editModal');
            setTimeout(() => input.focus(), 100);
        } catch (e) { console.error(e); }
    }

    async function handleEditSave() {
        const { type, id } = state.contextMenu;
        const name = $('#editModalInput').value.trim();
        if (!name) { showToast('请输入名称', 'warning'); return; }

        try {
            if (type === 'folder') {
                await Storage.Folders.update(id, { name });
                showToast('分组已更新', 'success');
            } else if (type === 'feed') {
                const folderVal = $('#editFolderSelect').value;
                const folderId = folderVal ? parseInt(folderVal) : null;
                await Storage.Feeds.update(id, { name, title: name, folderId });
                showToast('订阅源已更新', 'success');
            }
            closeModal();
            state.contextMenu = { type: null, id: null };
            await refreshAll();
        } catch (e) {
            console.error(e);
            showToast('保存失败', 'error');
        }
    }

    async function handleDeleteFeed(feedId) {
        hideContextMenu();
        const feed = await Storage.Feeds.get(feedId);
        const name = feed ? (feed.name || feed.title) : '';
        if (!confirm(`确定删除订阅源 "${name}"？\n相关文章也会被删除。`)) return;
        try {
            await Storage.Feeds.delete(feedId);
            if (state.currentFeedId === feedId) selectView('all');
            showToast('订阅源已删除', 'success');
            await refreshAll();
        } catch (e) {
            console.error(e);
            showToast('删除失败', 'error');
        }
    }

    async function handleDeleteFolder(folderId) {
        hideContextMenu();
        const folder = await Storage.Folders.get(folderId);
        const name = folder ? folder.name : '';
        if (!confirm(`确定删除分组 "${name}"？\n（订阅源不会被删除，会移动到未分类）`)) return;
        try {
            await Storage.Folders.delete(folderId);
            if (state.currentFolderId === folderId) selectView('all');
            state.expandedFolders.delete(folderId);
            showToast('分组已删除', 'success');
            await refreshAll();
        } catch (e) {
            console.error(e);
            showToast('删除失败', 'error');
        }
    }

    async function handleAddFeed() {
        const url = $('#feedUrl').value.trim();
        const name = $('#feedName').value.trim();
        const folderVal = $('#feedFolder').value;
        const folderId = folderVal ? parseInt(folderVal) : null;

        if (!url) { showToast('请输入RSS链接', 'warning'); return; }

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
            } catch (e) { console.warn('初始抓取失败', e); }

            await refreshAll();

        } catch (e) {
            console.error(e);
            showToast(`添加失败：${e.message}`, 'error');
        }
    }

    async function handleValidateFeed() {
        const url = $('#feedUrl').value.trim();
        if (!url) { showToast('请输入RSS链接', 'warning'); return; }
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
        if (!name) { showToast('请输入分组名称', 'warning'); return; }
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
                if (titles[state.currentView]) $('#currentViewTitle').textContent = titles[state.currentView];
            }, 2000);
            const msg = result.errorCount > 0
                ? `更新完成：新增 ${result.totalNewArticles} 篇，失败 ${result.errorCount} 个源`
                : result.totalNewArticles > 0 ? `更新完成：新增 ${result.totalNewArticles} 篇` : '暂无新内容';
            showToast(msg, result.errorCount > 0 ? 'warning' : 'success');
            await refreshAll();
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
                await refreshAll();
            } else {
                if (!confirm('确定将所有文章标记为已读吗？')) return;
                await Storage.Articles.markAllRead();
                showToast('所有文章已标记为已读', 'success');
                await refreshAll();
            }
            if (state.currentArticleId) {
                const article = await Storage.Articles.get(state.currentArticleId);
                if (article) updateReaderToolbar(article);
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
                    if (article.link) window.open(article.link, '_blank', 'noopener');
                    return;
            }

            await syncReadStateUI();
        } catch (e) {
            console.error(e);
            showToast('操作失败', 'error');
        }
    }

    async function navigateArticle(direction) {
        if (state.currentArticleList.length === 0) return;
        let idx = state.currentArticleList.findIndex(a => a.id === state.currentArticleId);
        if (idx < 0) idx = direction > 0 ? -1 : state.currentArticleList.length;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= state.currentArticleList.length) return;
        const target = state.currentArticleList[newIdx];
        const cards = $$('.article-card');
        const targetCard = cards.find(c => parseInt(c.dataset.articleId) === target.id);
        if (targetCard) targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await openArticle(target.id);
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
        } catch (e) { console.error(e); }
    }

    async function handleSaveSettings() {
        try {
            const interval = parseInt($('#autoRefreshInterval').value) || 0;
            const max = parseInt($('#maxArticlesPerFeed').value) || 200;
            const proxy = $('#corsProxy').value.trim();
            const autoMark = $('#autoMarkRead').checked;

            await Promise.all([
                Storage.Settings.set('autoRefreshInterval', Math.max(0, interval)),
                Storage.Settings.set('maxArticlesPerFeed', Math.max(20, max)),
                Storage.Settings.set('corsProxy', proxy),
                Storage.Settings.set('autoMarkRead', autoMark)
            ]);

            await Fetcher.restartAutoRefresh(async (result) => {
                if (result && result.totalNewArticles > 0) {
                    showToast(`后台更新：新增 ${result.totalNewArticles} 篇`, 'info');
                    await refreshAll();
                }
            });

            closeModal();
            showToast('设置已保存并立即生效', 'success');
        } catch (e) {
            console.error(e);
            showToast('保存设置失败', 'error');
        }
    }

    async function handleExportOpml() {
        try { await OPML.exportOpmlFile(); showToast('OPML文件已导出', 'success'); }
        catch (e) { console.error(e); showToast('导出失败: ' + e.message, 'error'); }
    }

    async function handleImportOpml() {
        const input = $('#opmlFileInput');
        if (!input.files || input.files.length === 0) { showToast('请选择OPML文件', 'warning'); return; }
        try {
            const result = await OPML.importOpmlFile(input.files[0]);
            const parts = [];
            if (result.createdFeeds > 0) parts.push(`新增 ${result.createdFeeds} 个订阅源`);
            if (result.createdFolders > 0) parts.push(`新建 ${result.createdFolders} 个分组`);
            if (result.mergedFolders > 0) parts.push(`合并 ${result.mergedFolders} 个同名分组`);
            if (result.skippedFeeds > 0) parts.push(`跳过 ${result.skippedFeeds} 个已存在源`);
            showToast(parts.length > 0 ? `导入完成：${parts.join('，')}` : '没有新内容导入', 'success');
            closeModal();
            input.value = '';
            await refreshAll();
        } catch (e) {
            console.error(e);
            showToast('导入失败: ' + e.message, 'error');
        }
    }

    async function handleExportData() {
        try { await OPML.exportDataFile(); showToast('完整备份已导出', 'success'); }
        catch (e) { console.error(e); showToast('导出失败: ' + e.message, 'error'); }
    }

    async function handleImportData() {
        const input = $('#dataFileInput');
        if (!input.files || input.files.length === 0) { showToast('请选择备份文件', 'warning'); return; }
        if (!confirm('导入将合并现有数据并立即应用设置，是否继续？')) return;
        try {
            await OPML.importDataFile(input.files[0]);
            showToast('数据恢复成功！所有设置已立即生效', 'success');
            closeModal();
            input.value = '';
            await applyReaderSettings();
            Fetcher.restartAutoRefresh(async (result) => {
                if (result && result.totalNewArticles > 0) {
                    showToast(`后台更新：新增 ${result.totalNewArticles} 篇`, 'info');
                    await refreshAll();
                }
            });
            await refreshAll();
        } catch (e) {
            console.error(e);
            showToast('恢复失败: ' + e.message, 'error');
        }
    }

    async function updateLastFetch() {
        const feeds = await Storage.Feeds.getAll();
        if (feeds.length === 0) { $('#lastFetch').textContent = '尚未更新'; return; }
        const dates = feeds.map(f => f.lastFetched).filter(Boolean);
        if (dates.length === 0) { $('#lastFetch').textContent = '尚未更新'; return; }
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
        $('#editModalSaveBtn').addEventListener('click', handleEditSave);

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

        $('#prevArticleBtn').addEventListener('click', () => navigateArticle(-1));
        $('#nextArticleBtn').addEventListener('click', () => navigateArticle(1));

        $('#fontDecBtn').addEventListener('click', () => changeFontSize(-1));
        $('#fontIncBtn').addEventListener('click', () => changeFontSize(1));
        $('#lineDecBtn').addEventListener('click', () => changeLineHeight(-0.1));
        $('#lineIncBtn').addEventListener('click', () => changeLineHeight(0.1));

        $('#searchInput').addEventListener('input', handleSearchInput);
        $('#sortSelect').addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            Storage.Settings.set('sortBy', state.sortBy);
            renderArticleList();
        });

        $$('#filterStatus .filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('#filterStatus .filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.filterStatus = tab.dataset.filter;
                renderArticleList();
            });
        });

        $('#filterSource').addEventListener('change', (e) => {
            state.filterSource = e.target.value;
            renderArticleList();
        });

        $('#filterTime').addEventListener('change', (e) => {
            state.filterTime = e.target.value;
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

        $('#contextMenu').addEventListener('click', async (e) => {
            const action = e.target.closest('.context-item')?.dataset.action;
            const { type, id } = state.contextMenu;
            if (!action || !type || id === null) return;

            if (action === 'edit') openEditModal(type, id);
            else if (action === 'delete') {
                if (type === 'feed') handleDeleteFeed(id);
                else if (type === 'folder') handleDeleteFolder(id);
            } else if (action === 'markread') {
                if (type === 'feed') {
                    await Storage.Feeds.markAllRead(id);
                    showToast('订阅源已全部标记已读', 'success');
                    refreshAll();
                } else if (type === 'folder') {
                    markFolderRead(id);
                }
            }
            hideContextMenu();
        });

        document.addEventListener('click', () => hideContextMenu());
        document.addEventListener('scroll', () => hideContextMenu(), true);

        document.addEventListener('keydown', (e) => {
            const inInput = e.target.matches('input, textarea, select');

            if (e.key === 'Escape') { closeModal(); hideContextMenu(); }
            if (e.key === 'Enter' && !inInput && $('#modalContainer').classList.contains('hidden')) {
                if ($('#editModal').classList.contains('hidden') && !$('#addFeedModal').classList.contains('hidden')) return;
                if ($('#editModal').classList.contains('hidden') && state.currentArticleId) {
                    e.preventDefault();
                    handleReaderToolbarClick('toggle-read');
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                $('#searchInput').focus();
                $('#searchInput').select();
            }

            if (e.key === 'o' && !inInput && state.currentArticleId) {
                e.preventDefault();
                handleReaderToolbarClick('open-external');
            }

            if (e.key.toLowerCase() === 'j' && !inInput) { e.preventDefault(); navigateArticle(1); }
            if (e.key.toLowerCase() === 'k' && !inInput) { e.preventDefault(); navigateArticle(-1); }
            if (e.key.toLowerCase() === 's' && !inInput && state.currentArticleId) {
                e.preventDefault();
                handleReaderToolbarClick('toggle-star');
            }
            if (e.key === '?' && !inInput) {
                showToast('快捷键: J/K 上下翻篇, S 收藏, O 原文, Enter 已读, Ctrl+K 搜索', 'info', 5000);
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.shiftKey) {
                e.preventDefault();
                handleRefresh();
            }
        });

        $('#articleContent').addEventListener('scroll', () => {
            Storage.Settings.get('autoMarkRead', true).then(autoMark => {
                if (!autoMark || !state.currentArticleId) return;
                const el = $('#articleContent');
                if (el.scrollTop > el.scrollHeight * 0.7) {
                    Storage.Articles.markRead(state.currentArticleId, true).then(() => {
                        syncReadStateUI();
                    });
                }
            });
        });
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
                try { folder = await Storage.Folders.create(item.folder); } catch (e) {}
                try {
                    await Storage.Feeds.create({
                        url: item.url, name: item.name, title: item.name,
                        folderId: folder ? folder.id : null
                    });
                } catch (e) {}
            }
            await renderFoldersAndFeeds();
        } catch (e) { console.warn('添加默认源失败', e); }
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
                refreshAll()
            ]);

            const interval = await Storage.Settings.get('autoRefreshInterval', 30);
            if (interval && interval >= 5) {
                Fetcher.startAutoRefresh(async (result) => {
                    if (result && result.totalNewArticles > 0) {
                        showToast(`后台更新：新增 ${result.totalNewArticles} 篇`, 'info');
                        await refreshAll();
                    }
                });
            }

        } catch (e) {
            console.error('初始化失败:', e);
            showToast('初始化失败: ' + e.message, 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
