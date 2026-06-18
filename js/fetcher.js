const Fetcher = (function() {
    let autoRefreshTimer = null;

    async function fetchWithProxy(url, proxy) {
        let targetUrl = url;
        if (proxy && proxy.trim()) {
            targetUrl = proxy.trim() + encodeURIComponent(url);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
                }
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html') && !contentType.includes('xml')) {
                const html = await response.text();
                const feedLinks = RSSParser.findFeedLinks(html, url);
                if (feedLinks.length > 0) {
                    return {
                        isHtml: true,
                        feedLinks,
                        html
                    };
                }
                throw new Error('返回内容为HTML页面，未发现RSS链接。请检查URL是否为正确的RSS源。');
            }

            const text = await response.text();
            return {
                isHtml: false,
                text
            };
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') {
                throw new Error('请求超时，请稍后重试');
            }
            throw e;
        }
    }

    async function validateFeed(url, proxy) {
        if (!url || !url.trim()) {
            throw new Error('请输入RSS链接');
        }

        let feedUrl = url.trim();
        if (!feedUrl.match(/^https?:\/\//i)) {
            feedUrl = 'http://' + feedUrl;
        }

        let result;
        try {
            result = await fetchWithProxy(feedUrl, proxy);
        } catch (e) {
            if (!proxy && e.message && (
                e.message.includes('CORS') ||
                e.message.includes('Failed to fetch') ||
                e.message.includes('NetworkError')
            )) {
                const defaultProxy = 'https://api.allorigins.win/raw?url=';
                try {
                    result = await fetchWithProxy(feedUrl, defaultProxy);
                } catch (e2) {
                    throw new Error(`抓取失败: ${e.message}。请尝试在设置中配置CORS代理。`);
                }
            } else {
                throw e;
            }
        }

        if (result.isHtml) {
            if (result.feedLinks && result.feedLinks.length > 0) {
                return {
                    feedUrl,
                    isHtml: true,
                    feedLinks: result.feedLinks,
                    title: ''
                };
            }
            throw new Error('未在该页面发现RSS订阅链接');
        }

        const parsed = RSSParser.parse(result.text);
        return {
            feedUrl,
            isHtml: false,
            title: parsed.feed.title,
            description: parsed.feed.description,
            link: parsed.feed.link,
            articleCount: parsed.articles.length,
            articles: parsed.articles
        };
    }

    async function fetchFeed(feed, proxy) {
        const result = await fetchWithProxy(feed.url, proxy);

        if (result.isHtml) {
            throw new Error('订阅源返回的是HTML页面，可能URL已失效');
        }

        const parsed = RSSParser.parse(result.text);
        const siteUrl = parsed.feed.link || RSSParser.extractSiteUrl(feed.url);
        const favicon = feed.favicon || parsed.feed.image || RSSParser.generateFaviconUrl(siteUrl);

        const updates = {
            lastFetched: Date.now(),
            lastError: null
        };

        if (parsed.feed.title && parsed.feed.title !== feed.title) {
            updates.title = parsed.feed.title;
        }
        if (parsed.feed.description !== feed.description) {
            updates.description = parsed.feed.description;
        }
        if (parsed.feed.link && parsed.feed.link !== feed.link) {
            updates.link = parsed.feed.link;
        }
        if (favicon && favicon !== feed.favicon) {
            updates.favicon = favicon;
        }

        await Storage.Feeds.update(feed.id, updates);

        const articlesWithFeedId = parsed.articles.map(a => ({
            ...a,
            feedId: feed.id
        }));

        const created = await Storage.Articles.createBatch(articlesWithFeedId);

        const maxArticles = await Storage.Settings.get('maxArticlesPerFeed', 200);
        const trimmed = await Storage.Articles.trimOld(feed.id, maxArticles);

        return {
            newArticles: created.length,
            trimmedArticles: trimmed,
            feed: { ...feed, ...updates }
        };
    }

    async function fetchAllFeeds(progressCallback) {
        const feeds = await Storage.Feeds.getAll();
        const proxy = await Storage.Settings.get('corsProxy', '');
        const results = [];
        let errors = 0;
        let totalNew = 0;

        for (let i = 0; i < feeds.length; i++) {
            const feed = feeds[i];
            if (progressCallback) {
                progressCallback(i + 1, feeds.length, feed.name);
            }

            try {
                const result = await fetchFeed(feed, proxy);
                totalNew += result.newArticles;
                results.push({ feed: feed.name, success: true, ...result });
            } catch (e) {
                errors++;
                await Storage.Feeds.update(feed.id, {
                    lastFetched: Date.now(),
                    lastError: e.message
                });
                results.push({ feed: feed.name, success: false, error: e.message });
            }

            await new Promise(r => setTimeout(r, 200));
        }

        return {
            totalFeeds: feeds.length,
            successCount: feeds.length - errors,
            errorCount: errors,
            totalNewArticles: totalNew,
            results
        };
    }

    function startAutoRefresh(callback) {
        stopAutoRefresh();

        Storage.Settings.get('autoRefreshInterval', 30).then(interval => {
            if (!interval || interval < 5) return;

            const ms = interval * 60 * 1000;
            autoRefreshTimer = setInterval(async () => {
                try {
                    const result = await fetchAllFeeds();
                    if (callback) callback(result);
                } catch (e) {
                    console.error('自动刷新失败:', e);
                }
            }, ms);
        });
    }

    function stopAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    async function restartAutoRefresh(callback) {
        stopAutoRefresh();
        startAutoRefresh(callback);
    }

    function formatLastFetch(timestamp) {
        if (!timestamp) return '尚未更新';
        const d = new Date(timestamp);
        const now = new Date();
        const diff = now - d;
        const min = Math.floor(diff / 60000);
        const hr = Math.floor(diff / 3600000);

        if (diff < 60000) return '刚刚更新';
        if (min < 60) return `${min}分钟前更新`;
        if (hr < 24) return `${hr}小时前更新`;

        const pad = n => n.toString().padStart(2, '0');
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    return {
        validateFeed,
        fetchFeed,
        fetchAllFeeds,
        startAutoRefresh,
        stopAutoRefresh,
        restartAutoRefresh,
        formatLastFetch
    };
})();
