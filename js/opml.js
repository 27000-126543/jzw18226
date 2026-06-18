const OPML = (function() {

    function escapeXml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function unescapeXml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }

    function buildOutline(outline, indent = '') {
        let xml = '';
        const attrs = [];
        if (outline.text) attrs.push(`text="${escapeXml(outline.text)}"`);
        if (outline.title) attrs.push(`title="${escapeXml(outline.title)}"`);
        if (outline.type) attrs.push(`type="${escapeXml(outline.type)}"`);
        if (outline.xmlUrl) attrs.push(`xmlUrl="${escapeXml(outline.xmlUrl)}"`);
        if (outline.htmlUrl) attrs.push(`htmlUrl="${escapeXml(outline.htmlUrl)}"`);

        if (outline.children && outline.children.length > 0) {
            xml += `${indent}<outline ${attrs.join(' ')}>\n`;
            for (const child of outline.children) {
                xml += buildOutline(child, indent + '  ');
            }
            xml += `${indent}</outline>\n`;
        } else {
            xml += `${indent}<outline ${attrs.join(' ')} />\n`;
        }
        return xml;
    }

    async function exportOpml() {
        const folders = await Storage.Folders.getAll();
        const allFeeds = await Storage.Feeds.getAll();

        const folderMap = {};
        folders.forEach(f => {
            folderMap[f.id] = {
                text: f.name,
                title: f.name,
                children: []
            };
        });

        const uncategorized = {
            text: '未分类',
            title: '未分类',
            children: []
        };

        allFeeds.forEach(feed => {
            const item = {
                type: 'rss',
                text: feed.name || feed.title,
                title: feed.name || feed.title,
                xmlUrl: feed.url,
                htmlUrl: feed.link || ''
            };

            if (feed.folderId && folderMap[feed.folderId]) {
                folderMap[feed.folderId].children.push(item);
            } else {
                uncategorized.children.push(item);
            }
        });

        let bodyXml = '';
        for (const folder of folders) {
            if (folderMap[folder.id].children.length > 0) {
                bodyXml += buildOutline(folderMap[folder.id], '    ');
            }
        }
        if (uncategorized.children.length > 0) {
            bodyXml += buildOutline(uncategorized, '    ');
        }

        const now = new Date();
        const dateStr = now.toUTCString();

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Reader Subscriptions</title>
    <dateCreated>${dateStr}</dateCreated>
  </head>
  <body>
${bodyXml}  </body>
</opml>`;

        return xml;
    }

    async function exportOpmlFile() {
        const xml = await exportOpml();
        const blob = new Blob([xml], { type: 'application/opml+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const name = `subscriptions_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}.opml`;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    function parseOpml(xmlString) {
        if (!xmlString || typeof xmlString !== 'string') {
            throw new Error('无效的OPML内容');
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error('OPML解析错误');
        }

        const body = xmlDoc.querySelector('body');
        if (!body) throw new Error('OPML文件缺少body节点');

        function parseOutlines(outlines) {
            const result = [];
            for (const outline of outlines) {
                const xmlUrl = unescapeXml(outline.getAttribute('xmlUrl') || '');
                const text = unescapeXml(outline.getAttribute('text') || '');
                const title = unescapeXml(outline.getAttribute('title') || text);
                const htmlUrl = unescapeXml(outline.getAttribute('htmlUrl') || '');
                const type = outline.getAttribute('type') || '';

                const hasChildren = outline.querySelectorAll(':scope > outline').length > 0;

                if (xmlUrl || (type && type.toLowerCase() === 'rss')) {
                    if (xmlUrl) {
                        result.push({
                            isFeed: true,
                            url: xmlUrl,
                            name: title || text,
                            link: htmlUrl
                        });
                    }
                } else if (hasChildren) {
                    const children = parseOutlines(outline.querySelectorAll(':scope > outline'));
                    result.push({
                        isFeed: false,
                        name: title || text,
                        feeds: children.filter(c => c.isFeed),
                        children: children.filter(c => !c.isFeed)
                    });
                }
            }
            return result;
        }

        const outlines = body.querySelectorAll(':scope > outline');
        return parseOutlines(outlines);
    }

    function flattenOutlines(outlines, currentFolder = null, folderMap = {}) {
        const result = [];

        for (const item of outlines) {
            if (item.isFeed) {
                result.push({
                    url: item.url,
                    name: item.name,
                    link: item.link,
                    folderId: currentFolder
                });
            } else {
                result.push({
                    isFolder: true,
                    name: item.name,
                    _placeholder: true
                });

                const folderIndex = result.length - 1;
                if (item.feeds) {
                    for (const feed of item.feeds) {
                        result.push({
                            url: feed.url,
                            name: feed.name,
                            link: feed.link,
                            _folderRef: folderIndex
                        });
                    }
                }
                if (item.children) {
                    const nested = flattenOutlines(item.children, folderIndex, folderMap);
                    result.push(...nested);
                }
            }
        }
        return result;
    }

    async function importOpml(xmlString) {
        const parsed = parseOpml(xmlString);

        const folders = {};
        const uncategorized = [];

        async function processItems(items, parentFolderId = null) {
            for (const item of items) {
                if (item.isFeed === false && item.name) {
                    const folder = await Storage.Folders.create(item.name);
                    folders[item.name] = folder.id;
                    const currentFolderId = folder.id;

                    if (item.feeds) {
                        for (const feed of item.feeds) {
                            try {
                                await Storage.Feeds.create({
                                    url: feed.url,
                                    name: feed.name,
                                    title: feed.name,
                                    link: feed.link,
                                    folderId: currentFolderId
                                });
                            } catch (e) {
                                console.warn(`跳过已存在的源: ${feed.url}`);
                            }
                        }
                    }
                    if (item.children) {
                        await processItems(item.children, currentFolderId);
                    }
                } else if (item.isFeed) {
                    try {
                        await Storage.Feeds.create({
                            url: item.url,
                            name: item.name,
                            title: item.name,
                            link: item.link,
                            folderId: parentFolderId
                        });
                    } catch (e) {
                        console.warn(`跳过已存在的源: ${item.url}`);
                    }
                }
            }
        }

        await processItems(parsed);

        const count = await Storage.Feeds.getAll();
        return {
            feedCount: count.length,
            folderCount: (await Storage.Folders.getAll()).length
        };
    }

    async function importOpmlFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const result = await importOpml(e.target.result);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    async function exportDataFile() {
        const data = await Storage.Export.exportAll();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const name = `rss_backup_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}.json`;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    async function importDataFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    let data;
                    try {
                        data = JSON.parse(e.target.result);
                    } catch (err) {
                        reject(new Error('JSON格式错误'));
                        return;
                    }
                    const result = await Storage.Export.importAll(data);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    return {
        exportOpml,
        exportOpmlFile,
        importOpml,
        importOpmlFile,
        exportDataFile,
        importDataFile,
        parseOpml
    };
})();
