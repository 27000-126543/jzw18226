const Storage = (function() {
    const DB_NAME = 'LocalRSSReader';
    const DB_VERSION = 1;
    let db = null;

    const STORES = {
        FEEDS: 'feeds',
        ARTICLES: 'articles',
        FOLDERS: 'folders',
        SETTINGS: 'settings'
    };

    function openDB() {
        return new Promise((resolve, reject) => {
            if (db) { resolve(db); return; }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };

            request.onupgradeneeded = (e) => {
                const database = e.target.result;

                if (!database.objectStoreNames.contains(STORES.FOLDERS)) {
                    const folderStore = database.createObjectStore(STORES.FOLDERS, { keyPath: 'id', autoIncrement: true });
                    folderStore.createIndex('name', 'name', { unique: false });
                }

                if (!database.objectStoreNames.contains(STORES.FEEDS)) {
                    const feedStore = database.createObjectStore(STORES.FEEDS, { keyPath: 'id', autoIncrement: true });
                    feedStore.createIndex('url', 'url', { unique: true });
                    feedStore.createIndex('folderId', 'folderId', { unique: false });
                }

                if (!database.objectStoreNames.contains(STORES.ARTICLES)) {
                    const articleStore = database.createObjectStore(STORES.ARTICLES, { keyPath: 'id', autoIncrement: true });
                    articleStore.createIndex('guid', 'guid', { unique: true });
                    articleStore.createIndex('feedId', 'feedId', { unique: false });
                    articleStore.createIndex('pubDate', 'pubDate', { unique: false });
                    articleStore.createIndex('isRead', 'isRead', { unique: false });
                    articleStore.createIndex('isStarred', 'isStarred', { unique: false });
                    articleStore.createIndex('isReadLater', 'isReadLater', { unique: false });
                }

                if (!database.objectStoreNames.contains(STORES.SETTINGS)) {
                    database.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }
            };
        });
    }

    function promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function tx(storeNames, mode, callback) {
        return openDB().then(database => {
            return new Promise((resolve, reject) => {
                const transaction = database.transaction(storeNames, mode);
                const stores = {};
                storeNames.forEach(name => {
                    stores[name] = transaction.objectStore(name);
                });

                let result;
                try {
                    result = callback(stores);
                } catch (e) {
                    reject(e);
                    return;
                }

                transaction.oncomplete = () => resolve(result);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        });
    }

    function getStore(mode, storeName) {
        return openDB().then(database => {
            return database.transaction(storeName, mode).objectStore(storeName);
        });
    }

    async function getAllFromStore(storeName) {
        return tx([storeName], 'readonly', stores => {
            return promisifyRequest(stores[storeName].getAll());
        });
    }

    async function getFromStore(storeName, key) {
        return tx([storeName], 'readonly', stores => {
            return promisifyRequest(stores[storeName].get(key));
        });
    }

    async function putInStore(storeName, value) {
        return tx([storeName], 'readwrite', stores => {
            return promisifyRequest(stores[storeName].put(value));
        });
    }

    async function deleteFromStore(storeName, key) {
        return tx([storeName], 'readwrite', stores => {
            return promisifyRequest(stores[storeName].delete(key));
        });
    }

    async function clearStore(storeName) {
        return tx([storeName], 'readwrite', stores => {
            return promisifyRequest(stores[storeName].clear());
        });
    }

    async function getAllFromIndex(storeName, indexName, key) {
        return tx([storeName], 'readonly', stores => {
            const index = stores[storeName].index(indexName);
            if (key !== undefined) {
                return promisifyRequest(index.getAll(key));
            }
            return promisifyRequest(index.getAll());
        });
    }

    const Folders = {
        async getAll() {
            const list = await getAllFromStore(STORES.FOLDERS);
            return list.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
        },

        async getByName(name) {
            name = name.trim().toLowerCase();
            const all = await getAllFromStore(STORES.FOLDERS);
            return all.find(f => f.name && f.name.trim().toLowerCase() === name) || null;
        },

        async get(id) {
            return getFromStore(STORES.FOLDERS, id);
        },

        async create(name, order) {
            const all = await this.getAll();
            const nextOrder = order !== undefined ? order : 
                (all.length > 0 ? Math.max(...all.map(f => f.order ?? f.id ?? 0)) + 1 : 0);
            const folder = {
                name: name.trim(),
                order: nextOrder,
                createdAt: Date.now()
            };
            const id = await putInStore(STORES.FOLDERS, folder);
            return { id, ...folder };
        },

        async update(id, updates) {
            const folder = await getFromStore(STORES.FOLDERS, id);
            if (!folder) return null;
            if (typeof updates === 'string') {
                folder.name = updates.trim();
            } else {
                if (updates.name !== undefined) updates.name = updates.name.trim();
                Object.assign(folder, updates);
            }
            folder.updatedAt = Date.now();
            await putInStore(STORES.FOLDERS, folder);
            return folder;
        },

        async updateOrder(id, order) {
            return this.update(id, { order });
        },

        async delete(id) {
            const feeds = await getAllFromIndex(STORES.FEEDS, 'folderId', id);
            for (const feed of feeds) {
                feed.folderId = null;
                await putInStore(STORES.FEEDS, feed);
            }
            return deleteFromStore(STORES.FOLDERS, id);
        },

        async findOrCreate(name) {
            const existing = await this.getByName(name);
            if (existing) return existing;
            return this.create(name);
        }
    };

    const Feeds = {
        async getAll() {
            const list = await getAllFromStore(STORES.FEEDS);
            return list.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
        },

        async getByFolder(folderId) {
            if (folderId === null || folderId === undefined) {
                const all = await this.getAll();
                return all.filter(f => !f.folderId);
            }
            const list = await getAllFromIndex(STORES.FEEDS, 'folderId', folderId);
            return list.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
        },

        async getByUrl(url) {
            const results = await getAllFromIndex(STORES.FEEDS, 'url', url);
            return results[0] || null;
        },

        async get(id) {
            return getFromStore(STORES.FEEDS, id);
        },

        async create(feedData) {
            const existing = await this.getByUrl(feedData.url);
            if (existing) {
                throw new Error('该订阅源已存在');
            }
            const siblingFeeds = feedData.folderId 
                ? await this.getByFolder(feedData.folderId)
                : (await this.getAll()).filter(f => !f.folderId);
            const nextOrder = feedData.order !== undefined ? feedData.order :
                (siblingFeeds.length > 0 ? Math.max(...siblingFeeds.map(f => f.order ?? f.id ?? 0)) + 1 : 0);
            const feed = {
                url: feedData.url,
                name: feedData.name || feedData.title || feedData.url,
                title: feedData.title || feedData.name || feedData.url,
                description: feedData.description || '',
                link: feedData.link || feedData.url,
                folderId: feedData.folderId || null,
                favicon: feedData.favicon || '',
                order: nextOrder,
                lastFetched: null,
                lastError: null,
                createdAt: Date.now()
            };
            const id = await putInStore(STORES.FEEDS, feed);
            return { id, ...feed };
        },

        async update(id, updates) {
            const feed = await getFromStore(STORES.FEEDS, id);
            if (!feed) return null;
            Object.assign(feed, updates);
            feed.updatedAt = Date.now();
            await putInStore(STORES.FEEDS, feed);
            return feed;
        },

        async updateOrder(id, order) {
            return this.update(id, { order });
        },

        async delete(id) {
            const articles = await getAllFromIndex(STORES.ARTICLES, 'feedId', id);
            for (const article of articles) {
                await deleteFromStore(STORES.ARTICLES, article.id);
            }
            return deleteFromStore(STORES.FEEDS, id);
        },

        async markAllRead(feedId) {
            return tx([STORES.ARTICLES], 'readwrite', stores => {
                return new Promise((resolve, reject) => {
                    const store = stores[STORES.ARTICLES];
                    const index = store.index('feedId');
                    const cursorReq = index.openCursor(IDBKeyRange.only(feedId));
                    cursorReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const article = cursor.value;
                            if (!article.isRead) {
                                article.isRead = true;
                                article.readAt = Date.now();
                                cursor.update(article);
                            }
                            cursor.continue();
                        } else {
                            resolve();
                        }
                    };
                    cursorReq.onerror = () => reject(cursorReq.error);
                });
            });
        }
    };

    const Articles = {
        async getAll(options = {}) {
            let articles = await getAllFromStore(STORES.ARTICLES);
            return this._filterAndSort(articles, options);
        },

        _filterAndSort(articles, options) {
            const {
                feedId = null,
                folderId = null,
                unreadOnly = false,
                starredOnly = false,
                readLaterOnly = false,
                search = null,
                sortBy = 'date-desc',
                limit = null,
                feedIds = null
            } = options;

            let filtered = articles;

            if (feedIds && feedIds.length > 0) {
                filtered = filtered.filter(a => feedIds.includes(a.feedId));
            } else if (feedId) {
                filtered = filtered.filter(a => a.feedId === feedId);
            }

            if (unreadOnly) {
                filtered = filtered.filter(a => !a.isRead);
            }
            if (starredOnly) {
                filtered = filtered.filter(a => a.isStarred);
            }
            if (readLaterOnly) {
                filtered = filtered.filter(a => a.isReadLater);
            }

            if (search && search.trim()) {
                const query = search.toLowerCase().trim();
                filtered = filtered.filter(a => {
                    return (a.title && a.title.toLowerCase().includes(query)) ||
                           (a.content && a.content.toLowerCase().includes(query)) ||
                           (a.summary && a.summary.toLowerCase().includes(query)) ||
                           (a.author && a.author.toLowerCase().includes(query));
                });
            }

            switch (sortBy) {
                case 'date-asc':
                    filtered.sort((a, b) => (a.pubDate || 0) - (b.pubDate || 0));
                    break;
                case 'unread-first':
                    filtered.sort((a, b) => {
                        if (a.isRead === b.isRead) {
                            return (b.pubDate || 0) - (a.pubDate || 0);
                        }
                        return a.isRead ? 1 : -1;
                    });
                    break;
                case 'date-desc':
                default:
                    filtered.sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));
            }

            if (limit && limit > 0) {
                filtered = filtered.slice(0, limit);
            }

            return filtered;
        },

        async getByFeed(feedId, options = {}) {
            let articles = await getAllFromIndex(STORES.ARTICLES, 'feedId', feedId);
            return this._filterAndSort(articles, options);
        },

        async getByGuid(guid) {
            const results = await getAllFromIndex(STORES.ARTICLES, 'guid', guid);
            return results[0] || null;
        },

        async get(id) {
            return getFromStore(STORES.ARTICLES, id);
        },

        async createBatch(articlesData) {
            const created = [];
            for (const data of articlesData) {
                const existing = await this.getByGuid(data.guid);
                if (existing) continue;

                const article = {
                    guid: data.guid,
                    feedId: data.feedId,
                    title: data.title || '(无标题)',
                    link: data.link || '',
                    author: data.author || '',
                    pubDate: data.pubDate || Date.now(),
                    summary: data.summary || '',
                    content: data.content || data.summary || '',
                    enclosure: data.enclosure || null,
                    categories: data.categories || [],
                    isRead: false,
                    isStarred: false,
                    isReadLater: false,
                    readAt: null,
                    starredAt: null,
                    readLaterAt: null,
                    fetchedAt: Date.now()
                };
                const id = await putInStore(STORES.ARTICLES, article);
                created.push({ id, ...article });
            }
            return created;
        },

        async update(id, updates) {
            const article = await getFromStore(STORES.ARTICLES, id);
            if (!article) return null;
            Object.assign(article, updates);
            await putInStore(STORES.ARTICLES, article);
            return article;
        },

        async markRead(id, read = true) {
            return this.update(id, { isRead: read, readAt: read ? Date.now() : null });
        },

        async toggleStarred(id) {
            const article = await this.get(id);
            if (!article) return null;
            const newVal = !article.isStarred;
            return this.update(id, { isStarred: newVal, starredAt: newVal ? Date.now() : null });
        },

        async toggleReadLater(id) {
            const article = await this.get(id);
            if (!article) return null;
            const newVal = !article.isReadLater;
            return this.update(id, { isReadLater: newVal, readLaterAt: newVal ? Date.now() : null });
        },

        async markAllRead(feedIds = null) {
            return tx([STORES.ARTICLES], 'readwrite', stores => {
                return new Promise((resolve, reject) => {
                    const store = stores[STORES.ARTICLES];
                    const cursorReq = store.openCursor();
                    const now = Date.now();
                    cursorReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const article = cursor.value;
                            if (!article.isRead) {
                                if (!feedIds || feedIds.includes(article.feedId)) {
                                    article.isRead = true;
                                    article.readAt = now;
                                    cursor.update(article);
                                }
                            }
                            cursor.continue();
                        } else {
                            resolve();
                        }
                    };
                    cursorReq.onerror = () => reject(cursorReq.error);
                });
            });
        },

        async markFeedIdsRead(feedIds) {
            return this.markAllRead(feedIds);
        },

        async trimOld(feedId, maxCount) {
            const articles = await this.getByFeed(feedId, { sortBy: 'date-desc' });
            if (articles.length <= maxCount) return 0;
            const toDelete = articles.slice(maxCount);
            let count = 0;
            for (const a of toDelete) {
                await deleteFromStore(STORES.ARTICLES, a.id);
                count++;
            }
            return count;
        },

        async countByStatus() {
            const articles = await getAllFromStore(STORES.ARTICLES);
            return {
                total: articles.length,
                unread: articles.filter(a => !a.isRead).length,
                starred: articles.filter(a => a.isStarred).length,
                readLater: articles.filter(a => a.isReadLater).length
            };
        },

        async countByFeed(feedId) {
            const articles = await getAllFromIndex(STORES.ARTICLES, 'feedId', feedId);
            return {
                total: articles.length,
                unread: articles.filter(a => !a.isRead).length
            };
        }
    };

    const Settings = {
        async getAll() {
            const all = await getAllFromStore(STORES.SETTINGS);
            const obj = {};
            all.forEach(item => { obj[item.key] = item.value; });
            return obj;
        },

        async get(key, defaultValue = null) {
            const item = await getFromStore(STORES.SETTINGS, key);
            return item ? item.value : defaultValue;
        },

        async set(key, value) {
            return putInStore(STORES.SETTINGS, { key, value });
        },

        async getAllDefaults() {
            const defaults = {
                autoRefreshInterval: 30,
                maxArticlesPerFeed: 200,
                corsProxy: '',
                autoMarkRead: true,
                readerFontSize: 16,
                readerLineHeight: 1.6,
                sortBy: 'date-desc'
            };
            return defaults;
        },

        async initializeDefaults() {
            const defaults = await this.getAllDefaults();
            for (const [key, val] of Object.entries(defaults)) {
                const existing = await this.get(key, undefined);
                if (existing === undefined || existing === null) {
                    await this.set(key, val);
                }
            }
        },

        async bulkSet(obj) {
            for (const [key, val] of Object.entries(obj)) {
                await this.set(key, val);
            }
        }
    };

    const Export = {
        async exportAll() {
            const [feeds, articles, folders, settingsArr] = await Promise.all([
                Feeds.getAll(),
                getAllFromStore(STORES.ARTICLES),
                Folders.getAll(),
                getAllFromStore(STORES.SETTINGS)
            ]);
            const settings = {};
            settingsArr.forEach(s => { settings[s.key] = s.value; });

            return {
                version: 1,
                exportedAt: Date.now(),
                feeds,
                articles,
                folders,
                settings
            };
        },

        async importAll(data) {
            if (!data || !data.version) {
                throw new Error('无效的备份文件格式');
            }

            if (data.folders && Array.isArray(data.folders)) {
                const idMap = {};
                for (const folder of data.folders) {
                    const oldId = folder.id;
                    const { id, ...rest } = folder;
                    const newId = await putInStore(STORES.FOLDERS, rest);
                    idMap[oldId] = newId;
                }

                if (data.feeds && Array.isArray(data.feeds)) {
                    for (const feed of data.feeds) {
                        const existing = await Feeds.getByUrl(feed.url);
                        if (!existing) {
                            const { id, ...rest } = feed;
                            if (rest.folderId && idMap[rest.folderId]) {
                                rest.folderId = idMap[rest.folderId];
                            }
                            await putInStore(STORES.FEEDS, rest);
                        }
                    }
                }
            }

            if (data.articles && Array.isArray(data.articles)) {
                for (const article of data.articles) {
                    const existing = await Articles.getByGuid(article.guid);
                    if (existing) {
                        const merged = { ...existing };
                        if (article.isRead) merged.isRead = true;
                        if (article.isStarred) merged.isStarred = true;
                        if (article.isReadLater) merged.isReadLater = true;
                        if (article.readAt && !merged.readAt) merged.readAt = article.readAt;
                        if (article.starredAt && !merged.starredAt) merged.starredAt = article.starredAt;
                        if (article.readLaterAt && !merged.readLaterAt) merged.readLaterAt = article.readLaterAt;
                        await putInStore(STORES.ARTICLES, merged);
                    } else {
                        const { id, ...rest } = article;
                        await putInStore(STORES.ARTICLES, rest);
                    }
                }
            }

            if (data.settings) {
                await Settings.bulkSet(data.settings);
            }

            return true;
        },

        async clearAll() {
            await Promise.all([
                clearStore(STORES.ARTICLES),
                clearStore(STORES.FEEDS),
                clearStore(STORES.FOLDERS)
            ]);
        }
    };

    function init() {
        return openDB().then(() => Settings.initializeDefaults());
    }

    return {
        init,
        Folders,
        Feeds,
        Articles,
        Settings,
        Export,
        STORES
    };
})();
