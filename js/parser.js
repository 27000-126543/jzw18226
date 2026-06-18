const RSSParser = (function() {

    function getText(el, tagName) {
        if (!el) return '';
        const tags = el.getElementsByTagName(tagName);
        if (tags.length === 0) return '';
        return (tags[0].textContent || tags[0].innerText || '').trim();
    }

    function getAttr(el, attrName) {
        if (!el || !el.getAttribute) return '';
        return el.getAttribute(attrName) || '';
    }

    function getAll(el, tagName) {
        if (!el) return [];
        return Array.from(el.getElementsByTagName(tagName) || []);
    }

    function getNamespacedText(el, namespace, localName) {
        if (!el) return '';
        const children = el.children;
        for (let child of children) {
            if (child.localName === localName || child.nodeName === `${namespace}:${localName}`) {
                return (child.textContent || child.innerText || '').trim();
            }
        }
        return '';
    }

    function getNamespacedAttr(el, namespace, localName, attr) {
        if (!el) return '';
        const children = el.children;
        for (let child of children) {
            if (child.localName === localName || child.nodeName === `${namespace}:${localName}`) {
                return getAttr(child, attr);
            }
        }
        return '';
    }

    function parseDate(dateStr) {
        if (!dateStr) return Date.now();
        try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) return d.getTime();
        } catch (e) {}
        try {
            const formats = [
                /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
                /(\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/,
                /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/
            ];
            for (const f of formats) {
                const m = dateStr.match(f);
                if (m) {
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) return d.getTime();
                }
            }
        } catch (e) {}
        return Date.now();
    }

    function stripHtml(html) {
        if (!html) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const texts = [];
        const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const text = node.nodeValue.trim();
            if (text) texts.push(text);
        }
        return texts.join(' ').replace(/\s+/g, ' ').trim();
    }

    function parseRSS(xmlDoc) {
        const channel = xmlDoc.getElementsByTagName('channel')[0];
        if (!channel) return null;

        const feed = {
            title: getText(channel, 'title'),
            link: getText(channel, 'link'),
            description: getText(channel, 'description'),
            language: getText(channel, 'language'),
            image: getText(channel.querySelector('image') || channel, 'url')
        };

        const items = getAll(channel, 'item');
        const articles = items.map(item => {
            const guid = getText(item, 'guid') || getText(item, 'link') || getText(item, 'title');
            const title = getText(item, 'title');
            const link = getText(item, 'link');

            let content = getNamespacedText(item, 'content', 'encoded') ||
                         getText(item, 'content:encoded') ||
                         getText(item, 'description');

            let summary = getText(item, 'description');
            if (summary === content) {
                summary = stripHtml(content).slice(0, 300);
            } else {
                summary = stripHtml(summary).slice(0, 300);
            }

            const pubDateStr = getText(item, 'pubDate') || getNamespacedText(item, 'dc', 'date');
            const pubDate = parseDate(pubDateStr);

            const author = getNamespacedText(item, 'dc', 'creator') || getText(item, 'author');

            const categories = getAll(item, 'category').map(c => (c.textContent || '').trim()).filter(Boolean);

            let enclosure = null;
            const enclosureEls = getAll(item, 'enclosure');
            if (enclosureEls.length > 0) {
                enclosure = {
                    url: getAttr(enclosureEls[0], 'url'),
                    type: getAttr(enclosureEls[0], 'type'),
                    length: parseInt(getAttr(enclosureEls[0], 'length')) || 0
                };
            }

            return {
                guid,
                title,
                link,
                author,
                pubDate,
                summary,
                content,
                enclosure,
                categories
            };
        });

        return {
            feed,
            articles
        };
    }

    function parseAtom(xmlDoc) {
        const feedEl = xmlDoc.getElementsByTagName('feed')[0];
        if (!feedEl) return null;

        const title = getText(feedEl, 'title');
        let link = '';
        const linkEls = getAll(feedEl, 'link');
        for (const l of linkEls) {
            if (getAttr(l, 'rel') === 'alternate' || !getAttr(l, 'rel')) {
                link = getAttr(l, 'href');
                break;
            }
        }

        const subtitle = getText(feedEl, 'subtitle') || getText(feedEl, 'tagline');

        let icon = '';
        const iconEls = getAll(feedEl, 'icon');
        if (iconEls.length > 0) icon = iconEls[0].textContent;
        if (!icon) {
            const logoEls = getAll(feedEl, 'logo');
            if (logoEls.length > 0) icon = logoEls[0].textContent;
        }

        const feed = {
            title,
            link,
            description: subtitle,
            image: icon
        };

        const entries = getAll(feedEl, 'entry');
        const articles = entries.map(entry => {
            const id = getText(entry, 'id');

            let title = getText(entry, 'title');
            if (!title) {
                const titles = getAll(entry, 'title');
                if (titles.length > 0) title = titles[0].textContent;
            }

            let link = '';
            const entryLinks = getAll(entry, 'link');
            for (const l of entryLinks) {
                if (getAttr(l, 'rel') === 'alternate' || !getAttr(l, 'rel')) {
                    link = getAttr(l, 'href');
                    break;
                }
            }

            const guid = id || link || title;

            let content = '';
            const contentEls = getAll(entry, 'content');
            if (contentEls.length > 0) {
                const contentType = getAttr(contentEls[0], 'type');
                if (contentType === 'xhtml') {
                    content = contentEls[0].innerHTML || contentEls[0].textContent;
                } else {
                    content = contentEls[0].textContent || '';
                }
            }

            let summary = getText(entry, 'summary');
            if (!content) {
                content = summary;
            }
            summary = stripHtml(summary).slice(0, 300);

            const updatedStr = getText(entry, 'updated') || getText(entry, 'published');
            const pubDate = parseDate(updatedStr);

            let author = '';
            const authorEls = getAll(entry, 'author');
            if (authorEls.length > 0) {
                author = getText(authorEls[0], 'name') || authorEls[0].textContent;
            }

            const categories = getAll(entry, 'category').map(c => getAttr(c, 'term') || (c.textContent || '').trim()).filter(Boolean);

            return {
                guid,
                title: title || '(无标题)',
                link,
                author: author.trim(),
                pubDate,
                summary,
                content,
                enclosure: null,
                categories
            };
        });

        return {
            feed,
            articles
        };
    }

    function parseRDF(xmlDoc) {
        return parseRSS(xmlDoc);
    }

    function detectFeedType(xmlDoc) {
        if (xmlDoc.getElementsByTagName('rss').length > 0) return 'rss';
        if (xmlDoc.getElementsByTagName('feed').length > 0) return 'atom';
        if (xmlDoc.getElementsByTagName('rdf:RDF').length > 0 || 
            xmlDoc.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'RDF').length > 0) return 'rdf';
        if (xmlDoc.getElementsByTagName('channel').length > 0) return 'rss';
        return 'unknown';
    }

    function parse(xmlString) {
        if (!xmlString || typeof xmlString !== 'string') {
            throw new Error('无效的XML内容');
        }

        let cleaned = xmlString.trim();
        cleaned = cleaned.replace(/^\s*<\?xml[^>]*\?>\s*/, '');

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleaned, 'text/xml');

        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error('XML解析错误: ' + parseError.textContent.slice(0, 200));
        }

        const type = detectFeedType(xmlDoc);
        let result;

        switch (type) {
            case 'rss':
                result = parseRSS(xmlDoc);
                break;
            case 'atom':
                result = parseAtom(xmlDoc);
                break;
            case 'rdf':
                result = parseRDF(xmlDoc);
                break;
            default:
                result = parseRSS(xmlDoc) || parseAtom(xmlDoc);
        }

        if (!result) {
            throw new Error('无法识别的RSS/Atom格式');
        }

        return {
            type,
            ...result
        };
    }

    function generateFaviconUrl(siteUrl) {
        if (!siteUrl) return '';
        try {
            const url = new URL(siteUrl);
            return `${url.protocol}//${url.hostname}/favicon.ico`;
        } catch (e) {
            return '';
        }
    }

    function extractSiteUrl(feedUrl) {
        try {
            const url = new URL(feedUrl);
            return `${url.protocol}//${url.hostname}`;
        } catch (e) {
            return '';
        }
    }

    function findFeedLinks(htmlContent, baseUrl) {
        const links = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            const allLinks = doc.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"], link[type="application/rdf+xml"]');
            allLinks.forEach(link => {
                let href = link.getAttribute('href') || '';
                if (href && !href.startsWith('http')) {
                    try {
                        const url = new URL(href, baseUrl);
                        href = url.href;
                    } catch (e) {}
                }
                if (href) {
                    links.push({
                        url: href,
                        title: link.getAttribute('title') || '',
                        type: link.getAttribute('type') || ''
                    });
                }
            });
        } catch (e) {}
        return links;
    }

    return {
        parse,
        generateFaviconUrl,
        extractSiteUrl,
        findFeedLinks,
        detectFeedType,
        parseDate,
        stripHtml
    };
})();
