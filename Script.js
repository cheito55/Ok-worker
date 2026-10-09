/*
 * GrayJay - OK.ru Source v44 (Corregido y Optimizado)
 *
 * Correcciones v44:
 *  - FIX CRÃTICO: CorrecciÃ³n de hasMorePagers() -> hasMore / hasMorePages() en Pagers
 *    evitando TypeError fatal al hacer scroll o al ordenar series.
 *  - FIX CAST: ENABLE_SOURCE_HEADERS configurado en false para evitar
 *    fallas de CORS o pantalla 00:00 en Chromecast y reproductores remotos.
 *  - FIX CAPABILITIES: CorrecciÃ³n de ["MIXED"] por tipos vÃ¡lidos de GrayJay (Type.Feed.Videos / ["video"]).
 *  - FIX CAPÃTULOS: Expresiones regulares ampliadas para detectar formatos 1x04, Cap. 01,
 *    Ð¡ÐµÑ€Ð¸Ñ, (01), [01] y ordenaciÃ³n estable por temporada.
 *  - FIX BATCH: ProtecciÃ³n para entornos donde http.batch() no estÃ© disponible.
 *  - FIX LOGIN: Mensajes claros en caso de muro de autenticaciÃ³n de OK.ru.
 */

const PLATFORM_NAME = "OK.ru";
const PLUGIN_ID = "62af0e2f-bfd9-489f-afe1-f66583d2f7d0";

function nowMs() {
    try { return Date.now(); } catch (_) { return 0; }
}

const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/136.0.0.0 Safari/537.36";

const REGEX_VIDEO_URL = /ok\.ru\/(?:video|videoembed)\/(\d+)/i;
const SEARCH_URL_BASE =
    "https://ok.ru/dk?st.cmd=searchResult&st.mode=Movie&st.grmode=Groups&st.query=";

const MAX_HTML_SIZE = 5000000;
const MAX_SOURCES = 12;
const MAX_DEBUG = 50;
const MAX_TITLE_CACHE = 300;

let DEBUG = [];

let TITLE_CACHE = {};
let TITLE_CACHE_ORDER = [];

const DETAILS_CACHE_TTL = 120000;
let DETAILS_CACHE = {};

function getCachedDetails(id) {
    try {
        let x = DETAILS_CACHE[id];
        if (!x) return null;
        if (nowMs() - x.time > DETAILS_CACHE_TTL) {
            delete DETAILS_CACHE[id];
            return null;
        }
        return x.value || null;
    } catch (_) {
        return null;
    }
}

function putCachedDetails(id, value) {
    try {
        if (id && value) DETAILS_CACHE[id] = { time: nowMs(), value: value };
    } catch (_) {}
}

function rememberTitle(id, title) {
    id = safeStr(id);
    title = cleanText(title);
    if (!id || !title) return;
    if (/^OK\.ru video\b/i.test(title)) return;
    if (isGenericTitle(title)) return;

    if (!(id in TITLE_CACHE) && TITLE_CACHE_ORDER.length >= MAX_TITLE_CACHE) {
        let oldest = TITLE_CACHE_ORDER.shift();
        delete TITLE_CACHE[oldest];
    }

    if (!(id in TITLE_CACHE)) TITLE_CACHE_ORDER.push(id);
    TITLE_CACHE[id] = title;
}

function recallTitle(id) {
    id = safeStr(id);
    return id && TITLE_CACHE[id] ? TITLE_CACHE[id] : "";
}

function extractTitleParam(url) {
    try {
        let m = safeStr(url).match(/[?&]t=([^&]+)/);
        if (m) return cleanText(decodeURIComponent(m[1]));
    } catch (_) {}
    return "";
}

function addDebug(value) {
    try {
        let s = safeStr(value);
        if (!s) return;
        if (DEBUG.length >= MAX_DEBUG) DEBUG.shift();
        DEBUG.push(s.length > 600 ? s.substring(0, 600) + "â€¦" : s);
    } catch (_) {}
}

function resetDebug() {
    DEBUG = [];
}

function debugText() {
    return DEBUG.join("\n");
}

function safeStr(v) {
    try {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return v;
        return String(v);
    } catch (_) {
        return "";
    }
}

function safeObj(v) {
    return v !== null && typeof v === "object";
}

function htmlDecode(s) {
    s = safeStr(s);
    return s
        .replace(/&quot;/gi, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x2F;/gi, "/")
        .replace(/&#47;/g, "/");
}

function stripTags(s) {
    return safeStr(s).replace(/<[^>]*>/g, " ");
}

function cleanText(s) {
    return htmlDecode(stripTags(s))
        .replace(/\s+/g, " ")
        .trim();
}

function cleanUrl(s) {
    return htmlDecode(safeStr(s))
        .replace(/^["']+|["']+$/g, "")
        .replace(/\\\//g, "/")
        .trim();
}

function normalizeUrl(s, base) {
    s = cleanUrl(s);
    if (!s) return "";

    if (s.indexOf("//") === 0) return "https:" + s;
    if (/^https?:\/\//i.test(s)) return s;

    if (base) {
        try {
            if (s.indexOf("/") === 0) {
                let m = safeStr(base).match(/^(https?:\/\/[^/]+)/i);
                if (m) return m[1] + s;
            }
        } catch (_) {}
    }

    return s;
}

function isHttpUrl(s) {
    return /^https?:\/\//i.test(cleanUrl(s));
}

function getHost(url) {
    try {
        let m = safeStr(url).match(/^https?:\/\/([^/]+)/i);
        return m ? m[1].toLowerCase() : "";
    } catch (_) {
        return "";
    }
}

function extractYouTubeId(value) {
    let x = safeStr(value)
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/gi, "&");
    let patterns = [
        /(?:youtube(?:-nocookie)?\.com\/(?:embed|shorts|live|v)\/)([A-Za-z0-9_-]{11})/i,
        /(?:youtube(?:-nocookie)?\.com\/watch\?(?:[^"'<>]*&)?v=)([A-Za-z0-9_-]{11})/i,
        /youtu\.be\/([A-Za-z0-9_-]{11})/i,
        /(?:externalVideoId|youtubeId|youtubeVideoId)\s*[:=]\s*["']([A-Za-z0-9_-]{11})["']/i
    ];
    for (let i = 0; i < patterns.length; i++) {
        let m = x.match(patterns[i]);
        if (m) return m[1];
    }
    return "";
}

function extractExternalEmbed(value) {
    let x = safeStr(value)
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/gi, "&");

    let yt = extractYouTubeId(x);
    if (yt) return { plugin: "YouTube", id: yt, url: "https://www.youtube.com/watch?v=" + yt };

    let m = x.match(/player\.vimeo\.com\/video\/(\d{5,12})|vimeo\.com\/(?:video\/)?(\d{5,12})/i);
    if (m) {
        let id = m[1] || m[2];
        return { plugin: "Vimeo", id: id, url: "https://vimeo.com/" + id };
    }

    m = x.match(/dailymotion\.com\/(?:embed\/)?video\/([A-Za-z0-9]{5,10})|dai\.ly\/([A-Za-z0-9]{5,10})/i);
    if (m) {
        let id = m[1] || m[2];
        return { plugin: "Dailymotion", id: id, url: "https://www.dailymotion.com/video/" + id };
    }

    m = x.match(/rutube\.ru\/(?:play\/embed|video)\/([a-f0-9]{32})/i);
    if (m) {
        return { plugin: "Rutube", id: m[1], url: "https://rutube.ru/video/" + m[1] + "/" };
    }

    return null;
}

function isM3u8Url(url) {
    return /\.m3u8(?:$|[?#])/i.test(cleanUrl(url));
}

function extractVideoId(url) {
    try {
        let m = safeStr(url).match(REGEX_VIDEO_URL);
        return m ? m[1] : "";
    } catch (_) {
        return "";
    }
}

function mergeHeaders(target, extra) {
    target = target || {};
    if (!extra) return target;

    try {
        for (let k in extra) {
            if (extra[k] !== null && extra[k] !== undefined) {
                target[k] = safeStr(extra[k]);
            }
        }
    } catch (_) {}

    return target;
}

function httpGet(url, headers) {
    try {
        let h = {
            "User-Agent": UA_DESKTOP,
            "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9," +
                "image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache"
        };
        mergeHeaders(h, headers);

        let r = http.GET(url, h);
        if (!r) return "";

        let body = "";
        try { body = r.body; } catch (_) {}
        if (!body) { try { body = r.getBody(); } catch (_) {} }
        body = safeStr(body);

        if (body.length > MAX_HTML_SIZE) {
            body = body.substring(0, MAX_HTML_SIZE);
        }
        return body;
    } catch (e) {
        addDebug("httpGet: " + e);
        return "";
    }
}

function httpPost(url, body, headers) {
    try {
        let h = {
            "User-Agent": UA_DESKTOP,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*"
        };
        mergeHeaders(h, headers);

        let r = http.POST(url, body || "", h);
        if (!r) return "";

        let respBody = "";
        try { respBody = r.body; } catch (_) {}
        if (!respBody) { try { respBody = r.getBody(); } catch (_) {} }
        respBody = safeStr(respBody);
        if (respBody.length > MAX_HTML_SIZE) respBody = respBody.substring(0, MAX_HTML_SIZE);
        return respBody;
    } catch (e) {
        addDebug("httpPost: " + e);
        return "";
    }
}

function readBody(r) {
    let body = "";
    if (!r) return body;
    try { body = r.body; } catch (_) {}
    if (!body) { try { body = r.getBody(); } catch (_) {} }
    body = safeStr(body);
    if (body.length > MAX_HTML_SIZE) body = body.substring(0, MAX_HTML_SIZE);
    return body;
}

function makeErr(msg) {
    try { return new ScriptException(msg); } catch (_) { return new Error(msg); }
}

const LOGIN_MSG = "OK.ru requiere inicio de sesiÃ³n para realizar bÃºsquedas. " +
    "Por favor, use el icono de llave o menÃº de usuario en la esquina superior de GrayJay " +
    "para iniciar sesiÃ³n en OK.ru con su cuenta.";

function looksLikeLoginWall(html) {
    return /st\.cmd=anonym|anonymLogin|anonymMain|st\.email|st\.password|field_email|unite a ok|Ãºnete a ok|join ok|log in to ok|Ð²Ð¾Ð¹Ñ‚Ð¸ Ð² Ð¾Ð´Ð½Ð¾ÐºÐ»Ð°ÑÑÐ½Ð¸ÐºÐ¸/i
        .test(safeStr(html));
}

function httpGetAuthenticated(url) {
    let headers = {
        "User-Agent": UA_DESKTOP,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
        "Referer": "https://ok.ru/"
    };
    let r;
    try {
        r = http.GET(url, headers, true);
    } catch (e) {
        addDebug("search: sesiÃ³n GrayJay no disponible: " + e);
        throw makeErr(LOGIN_MSG);
    }
    return readBody(r);
}

function tryParseJson(value) {
    if (value === null || value === undefined) return null;
    if (safeObj(value)) return value;

    let s = safeStr(value).trim();
    if (!s) return null;

    for (let pass = 0; pass < 4; pass++) {
        try {
            return JSON.parse(s);
        } catch (_) {}

        let decoded = htmlDecode(s);
        if (decoded !== s) {
            s = decoded;
            continue;
        }

        if (
            (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
            (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")
        ) {
            s = s.substring(1, s.length - 1);
            continue;
        }

        let unescaped = s
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, "\\");

        if (unescaped !== s) {
            s = unescaped;
            continue;
        }
        break;
    }
    return null;
}

function extractMetadataFromHtml(html) {
    html = safeStr(html);
    if (!html) return null;

    let m = null;
    {
        let reAll = /data-options\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
        let cand, firstAny = null;
        while ((cand = reAll.exec(html)) !== null) {
            if (!firstAny) firstAny = cand;
            let rawc = cand[1] !== undefined ? cand[1] : cand[2];
            if (rawc && rawc.indexOf("flashvars") >= 0) { m = cand; break; }
        }
        if (!m) m = firstAny;
    }
    if (m) {
        let raw = m[1] !== undefined ? m[1] : m[2];
        let o = tryParseJson(raw);
        let fv = o && o.flashvars;
        if (fv) {
            let meta = fv.metadata;
            if (typeof meta === "string") meta = tryParseJson(meta);
            if (meta) return meta;

            let metaUrl = fv.metadataUrl || fv.metadataURL;
            if (metaUrl) {
                let fullUrl = normalizeUrl(metaUrl, "https://ok.ru/");
                let headers = {
                    "User-Agent": UA_DESKTOP,
                    "Referer": "https://ok.ru/",
                    "Origin": "https://ok.ru"
                };
                let body = httpPost(fullUrl, "", headers);
                meta = tryParseJson(body);
                if (meta) return meta;

                body = httpGet(fullUrl, headers);
                meta = tryParseJson(body);
                if (meta) return meta;
            }
        }
    }

    let t = htmlDecode(html).replace(/\\\//g, "/");
    let mm = /"hlsManifestUrl"\s*:\s*"([^"]+)"/i.exec(t);
    if (mm) {
        return { hlsManifestUrl: cleanUrl(mm[1]) };
    }

    return null;
}

function parseMetadata(html, pageUrl) {
    return extractMetadataFromHtml(html);
}

function pushUnique(arr, value) {
    value = normalizeUrl(value);
    if (!isHttpUrl(value)) return;
    if (arr.indexOf(value) >= 0) return;
    if (arr.length >= MAX_SOURCES) return;
    arr.push(value);
}

function collectHlsUrls(meta) {
    if (!safeObj(meta)) return [];
    let hls = meta.hlsManifestUrl || meta.hlsMasterPlaylistUrl || meta.ondemandHls || "";
    let url = normalizeUrl(hls, "https://ok.ru/");
    return isM3u8Url(url) ? [url] : [];
}

const QUALITY_RANK = {
    "ultra": { height: 2160, order: 100 },
    "highest": { height: 1440, order: 95 },
    "quad": { height: 1440, order: 90 },
    "higher": { height: 1080, order: 85 },
    "full": { height: 1080, order: 80 },
    "fullhd": { height: 1080, order: 80 },
    "hd": { height: 720, order: 70 },
    "hdp": { height: 720, order: 70 },
    "sd": { height: 480, order: 50 },
    "sdp": { height: 480, order: 50 },
    "low": { height: 360, order: 30 },
    "lq": { height: 360, order: 30 },
    "lqp": { height: 360, order: 30 },
    "lowest": { height: 240, order: 10 },
    "mobile": { height: 144, order: 5 }
};

function qualityInfo(label) {
    label = safeStr(label).toLowerCase().trim();
    return QUALITY_RANK[label] || null;
}

function estimateBitrate(height) {
    if (height >= 2160) return 15000000;
    if (height >= 1440) return 9000000;
    if (height >= 1080) return 5000000;
    if (height >= 720) return 2500000;
    if (height >= 480) return 1200000;
    if (height >= 360) return 700000;
    return 400000;
}

function pushUniqueQuality(arr, url, label) {
    url = normalizeUrl(url);
    if (!isHttpUrl(url)) return;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].url === url) return;
    }
    if (arr.length >= MAX_SOURCES) return;
    arr.push({ url: url, label: safeStr(label) });
}

function sortByQuality(items) {
    let ranked = items.map(function (item, idx) {
        let q = qualityInfo(item.label);
        return { item: item, order: q ? q.order : -1, idx: idx };
    });
    ranked.sort(function (a, b) {
        if (b.order !== a.order) return b.order - a.order;
        return a.idx - b.idx;
    });
    return ranked.map(function (r) { return r.item; });
}

function collectMp4Urls(meta) {
    let urls = [];
    if (!safeObj(meta)) return urls;

    let vids = Array.isArray(meta.videos) ? meta.videos.slice(0) : [];
    for (let i = 0; i < vids.length; i++) {
        let v = vids[i];
        if (!v || !v.url) continue;
        pushUniqueQuality(urls, v.url, v.name || "");
    }
    return sortByQuality(urls);
}

function firstValue(obj, keys) {
    if (!safeObj(obj)) return "";
    for (let i = 0; i < keys.length; i++) {
        let k = keys[i];
        try {
            let v = obj[k];
            if (v === undefined || v === null) continue;
            if (typeof v === "object") continue;
            let s = safeStr(v);
            if (s) return s;
        } catch (_) {}
    }
    return "";
}

function getTitle(meta, fallback, id) {
    let v = "";
    if (safeObj(meta) && safeObj(meta.movie)) {
        v = cleanText(meta.movie.title || meta.movie.name || "");
    }
    if (!v) {
        v = cleanText(firstValue(meta, [
            "title",
            "name",
            "movieTitle",
            "videoTitle",
            "caption"
        ]));
    }

    if (v && (/^\d+$/.test(v) || (id && v === safeStr(id)))) {
        v = "";
    }

    let fb = cleanText(fallback);

    let wrapped = /see video\s+["Â«â€œ'](.+?)["Â»â€']/i.exec(v);
    if (wrapped) v = cleanText(wrapped[1]);
    if (/see video|on ok\.?\s*video player/i.test(v) && fb && !/see video/i.test(fb)) {
        return fb;
    }

    if (isGenericTitle(v)) v = "";
    if (isGenericTitle(fb)) fb = "";

    return v || fb || "OK.ru video";
}

function getPoster(meta) {
    if (safeObj(meta) && safeObj(meta.movie) && meta.movie.poster) {
        return safeStr(meta.movie.poster);
    }
    return firstValue(meta, [
        "poster",
        "posterUrl",
        "thumbnail",
        "thumbnailUrl",
        "cover",
        "coverUrl",
        "image",
        "imageUrl",
        "preview"
    ]);
}

function getDuration(meta) {
    let v = "";
    if (safeObj(meta) && safeObj(meta.movie)) {
        v = firstValue(meta.movie, ["duration", "durationMs", "durationSec"]);
    }
    if (!v) {
        v = firstValue(meta, [
            "duration",
            "durationMs",
            "durationSec",
            "length",
            "videoDuration"
        ]);
    }

    let n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return 0;
    if (n > 100000) n = n / 1000;
    return Math.round(n);
}

function getDescription(meta) {
    return cleanText(
        firstValue(meta, [
            "description",
            "desc",
            "text",
            "summary"
        ])
    );
}

function xuperResolve(meta) {
    if (!safeObj(meta)) return "";
    let direct = firstValue(meta, ["playlistUrl", "playlist_url"]);
    if (isM3u8Url(direct)) return normalizeUrl(direct);

    let containers = [meta.xuper, meta.data, meta.result, meta.auth, meta.player, meta.flashvars];
    for (let i = 0; i < containers.length; i++) {
        if (!safeObj(containers[i])) continue;
        let u = firstValue(containers[i], ["playlistUrl", "playlist_url"]);
        if (isM3u8Url(u)) return normalizeUrl(u);
    }
    return "";
}

// ConfiguraciÃ³n de fuentes y Cast
const ENABLE_SOURCE_HEADERS = false;
const PREFER_HLS_FIRST = true;

function okRequestModifier() {
    let h = {
        "User-Agent": UA_DESKTOP
    };
    return {
        headers: h,
        modifyRequest: function (url, headers) {
            headers = headers || {};
            for (let k in h) headers[k] = h[k];
            return { url: url, headers: headers };
        }
    };
}

function makeHlsSource(url, duration) {
    try {
        let opts = {
            name: "OK.ru HLS",
            duration: duration || 0,
            url: url
        };
        if (ENABLE_SOURCE_HEADERS) {
            opts.requestModifier = okRequestModifier();
        }
        return new HLSSource(opts);
    } catch (e) {
        addDebug("makeHlsSource EXCEPTION: " + e);
    }
    return null;
}

function makeMp4Source(url, duration, index, label) {
    try {
        let lower = safeStr(url).toLowerCase();
        let container = "mp4";

        if (/\.m4v(?:$|[?#])/.test(lower)) container = "m4v";
        else if (/\.webm(?:$|[?#])/.test(lower)) container = "webm";
        else if (/\.mov(?:$|[?#])/.test(lower)) container = "mov";

        let q = qualityInfo(label);
        let name = q
            ? "OK.ru " + label.toUpperCase() + " (" + q.height + "p)"
            : "OK.ru " + container.toUpperCase() + " " + (index + 1);

        let opts = {
            width: q ? Math.round(q.height * 16 / 9) : 0,
            height: q ? q.height : 0,
            container: container === "mp4" ? "video/mp4" : "video/" + container,
            codec: "",
            name: name,
            bitrate: q ? estimateBitrate(q.height) : 0,
            duration: duration || 0,
            url: url
        };
        if (ENABLE_SOURCE_HEADERS) opts.requestModifier = okRequestModifier();
        return new VideoUrlSource(opts);
    } catch (e) {
        addDebug("makeMp4Source EXCEPTION: " + e);
    }
    return null;
}

function buildVideoDetails(meta, pageUrl, fallbackTitle, html) {
    if (!safeObj(meta)) throw new Error("No metadata");

    let title = getTitle(meta, fallbackTitle, extractVideoId(pageUrl));
    let poster = normalizeUrl(getPoster(meta), pageUrl);
    let duration = getDuration(meta);
    let authorInfo = resolveAuthorInfo(getAuthorInfo(meta), extractVideoId(pageUrl), html);
    applySeriesByTitle(authorInfo, title);
    let authorName = authorInfo.name || "OK.ru";

    let hls = [];
    let xuperPlaylist = xuperResolve(meta);

    if (isM3u8Url(xuperPlaylist)) {
        pushUnique(hls, xuperPlaylist);
    }

    let normalHls = collectHlsUrls(meta);
    for (let i = 0; i < normalHls.length; i++) {
        pushUnique(hls, normalHls[i]);
    }

    let mp4 = collectMp4Urls(meta);

    let sources = [];

    let bestMp4Index = -1;
    let bestMp4Order = -1;

    for (let j = 0; j < mp4.length; j++) {
        let q = qualityInfo(mp4[j].label);
        let order = q ? q.order : -1;
        if (order > bestMp4Order) {
            bestMp4Order = order;
            bestMp4Index = j;
        }
    }
    if (bestMp4Index < 0 && mp4.length > 0) bestMp4Index = 0;

    if (!PREFER_HLS_FIRST && bestMp4Index >= 0) {
        let bestSrc = makeMp4Source(mp4[bestMp4Index].url, duration, bestMp4Index, mp4[bestMp4Index].label);
        if (bestSrc) sources.push(bestSrc);
    }

    for (let i = 0; i < hls.length && sources.length < MAX_SOURCES; i++) {
        let src = makeHlsSource(hls[i], duration);
        if (src) {
            src.name = i === 0 ? "OK.ru Auto HLS (Master)" : "OK.ru HLS " + (i + 1);
            sources.push(src);
        }
    }

    for (let j = 0; j < mp4.length && sources.length < MAX_SOURCES; j++) {
        if (!PREFER_HLS_FIRST && j === bestMp4Index) continue;
        let src = makeMp4Source(mp4[j].url, duration, j, mp4[j].label);
        if (src) sources.push(src);
    }

    if (!sources.length) {
        let ext = extractExternalEmbed(html);
        if (!ext) {
            try { ext = extractExternalEmbed(JSON.stringify(meta)); } catch (_) {}
        }
        if (ext) {
            throw makeErr("Este video estÃ¡ alojado en " + ext.plugin + ":\n" + ext.url);
        }
        throw makeErr("OK.ru: este video no expone fuentes reproducibles directas.\n" + debugText());
    }

    let thumbs = [];
    if (poster && isHttpUrl(poster)) {
        try { thumbs.push(new Thumbnail(poster, 0)); } catch (_) {}
    }
    let thumbnails = new Thumbnails(thumbs);

    let author = null;
    try {
        if (!authorInfo.name) authorInfo.name = authorName;
        author = makeAuthorLink(authorInfo, extractVideoId(pageUrl));
    } catch (_) {}

    let descriptor = null;
    try {
        descriptor = new MuxVideoSourceDescriptor({
            isUnMuxed: false,
            videoSources: sources
        });
    } catch (e) {
        try { descriptor = new VideoSourceDescriptor(sources); } catch (_) {}
    }

    let firstHls = null;
    if (hls.length > 0) {
        firstHls = makeHlsSource(hls[0], duration);
    }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM_NAME, extractVideoId(pageUrl) || "0", PLUGIN_ID),
        name: title,
        thumbnails: thumbnails,
        author: author,
        uploadDate: 0,
        url: pageUrl,
        duration: duration,
        viewCount: 0,
        isLive: false,
        description: getDescription(meta) + (false && SERIES_DIAG ? "\n\n[debug canal] " + SERIES_DIAG : ""),
        video: descriptor,
        dash: null,
        hls: firstHls,
        live: []
    });
}

function parseDurationText(value) {
    let parts = cleanText(value).split(":");
    if (parts.length === 2) {
        return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    }
    if (parts.length === 3) {
        return (parseInt(parts[0], 10) || 0) * 3600 +
               (parseInt(parts[1], 10) || 0) * 60 +
               (parseInt(parts[2], 10) || 0);
    }
    return 0;
}

function isGenericTitle(t) {
    t = cleanText(t || "").toLowerCase().replace(/[.\u2026:!]+$/g, "").trim();
    if (!t || t.length < 2) return true;
    if (/^[\d:\s]+$/.test(t)) return true;
    if (/^(image|video|videos|more|next|previous|menu|play|share|like|comment)$/.test(t)) return true;
    if (/^(view|views|ver|watch|play|reproducir|mirar|ÑÐ¼Ð¾Ñ‚Ñ€ÐµÑ‚ÑŒ|Ð¿Ð¾ÑÐ¼Ð¾Ñ‚Ñ€ÐµÑ‚ÑŒ|Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€|Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€Ñ‹|Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚ÑŒ|Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð²Ð¸Ð´ÐµÐ¾)(?:\s+(video|vÃ­deo|Ð²Ð¸Ð´ÐµÐ¾|Ñ€Ð¾Ð»Ð¸Ðº))?$/.test(t)) return true;
    if (/^(view|views|ver|watch|play|reproducir|mirar|ÑÐ¼Ð¾Ñ‚Ñ€ÐµÑ‚ÑŒ|Ð¿Ð¾ÑÐ¼Ð¾Ñ‚Ñ€ÐµÑ‚ÑŒ|Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€|Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€Ñ‹|Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚ÑŒ)\s+\d/.test(t) && t.length <= 40) return true;
    return false;
}

function bestAnchorTitle(attrs, inner) {
    attrs = safeStr(attrs);
    inner = safeStr(inner);
    let cands = [];
    let am = attrs.match(/\btitle\s*=\s*["']([^"']{2,500})["']/i);
    if (am) cands.push(am[1]);
    am = attrs.match(/\baria-label\s*=\s*["']([^"']{2,500})["']/i);
    if (am) cands.push(am[1]);
    let im = inner.match(/\balt\s*=\s*["']([^"']{2,500})["']/i);
    if (im) cands.push(im[1]);
    cands.push(inner);
    for (let i = 0; i < cands.length; i++) {
        let c = cleanText(cands[i]);
        if (c && !isGenericTitle(c)) return c;
    }
    return "";
}

function addSearchCandidate(results, seen, id, block, anchorTitle, anchorAttrs) {
    if (!id) return;
    if (seen[id]) return;
    if (results.length >= 96) return;
    block = safeStr(block);

    let ext = extractExternalEmbed(block);

    let title = bestAnchorTitle(anchorAttrs, anchorTitle);
    if (!title || title.length < 2) {
        let tm = block.match(/(?:data-title|data-name|title)\s*=\s*["']([^"']{2,500})["']/i);
        if (tm) title = cleanText(tm[1]);
    }
    if (isGenericTitle(title)) title = "";

    if (!title) {
        let tm = block.match(/<(?:span|div|a)[^>]*class=["'][^"']*(?:title|name|caption)[^"']*["'][^>]*>([\s\S]{1,700}?)<\/(?:span|div|a)>/i);
        if (tm) title = cleanText(tm[1]);
    }
    if (isGenericTitle(title)) title = "";
    if (!title) title = "OK.ru video " + id;

    let poster = "";
    let pm = block.match(/<(?:img|source)[^>]+(?:src|data-src|data-lazy-src|poster)\s*=\s*["']([^"']+)["']/i);
    if (pm) poster = normalizeUrl(pm[1]);

    let duration = 0;
    let dm = block.match(/(?:duration|movie-duration|video-duration)[^>:\n]{0,100}[:=]?\s*["']?([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)["']?/i);
    if (dm) duration = parseDurationText(dm[1]);

    seen[id] = results.length + 1;
    rememberTitle(id, title);

    let urlWithTitle = ext
        ? ext.url
        : ("https://ok.ru/video/" + id + (!/^OK\.ru video\b/i.test(title) ? "?t=" + encodeURIComponent(title) : ""));

    results.push({
        id: ext ? (ext.plugin.toLowerCase() + ":" + ext.id) : id,
        url: urlWithTitle,
        title: title,
        thumbnail: poster,
        duration: duration,
        authorInfo: extractAuthorFromBlock(block)
    });
}

function extractSearchResults(html) {
    let results = [];
    let seen = {};
    html = safeStr(html);

    let re = /<a\b([^>]*?href\s*=\s*["'](?:https?:\/\/[^"']+)?\/(?:video|videoembed)\/(\d+)(?:[?#][^"']*)?["'][^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null && results.length < 96) {
        let start = Math.max(0, m.index - 1400);
        let end = Math.min(html.length, re.lastIndex + 1400);
        addSearchCandidate(results, seen, m[2], html.substring(start, end), m[3], m[1]);
    }

    let re2 = /(?:data-movie-id|data-video-id|data-content-id)\s*=\s*["']?(\d+)["']?/gi;
    while ((m = re2.exec(html)) !== null && results.length < 96) {
        let start = Math.max(0, m.index - 400);
        let end = Math.min(html.length, re2.lastIndex + 600);
        addSearchCandidate(results, seen, m[1], html.substring(start, end), "");
    }

    enrichSearchAuthors(results, html);
    enrichAuthorsFromWatchPage(results);
    return results;
}

function makeSearchVideo(r) {
    try { rememberTitle(r.id, r.title); } catch (_) {}

    let thumbs = [];
    if (isHttpUrl(r.thumbnail)) {
        try { thumbs.push(new Thumbnail(r.thumbnail, 0)); } catch (_) {}
    }
    let thumbnails = new Thumbnails(thumbs);

    try { rememberAuthor(r.id, r.authorInfo); } catch (_) {}

    let author = null;
    try { author = makeAuthorLink(r.authorInfo || {}, r.id); } catch (_) {}
    if (!author) {
        try {
            author = new PlatformAuthorLink(
                new PlatformID(PLATFORM_NAME, "okru", PLUGIN_ID),
                (r.authorInfo && r.authorInfo.name) || "OK.ru",
                (r.authorInfo && r.authorInfo.url) || "https://ok.ru",
                (r.authorInfo && r.authorInfo.thumbnail) || "",
                0
            );
        } catch (_) {}
    }

    try {
        let cleanId = safeStr(r.id).replace(/^[^:]+:/, "");
        return new PlatformVideo({
            id: new PlatformID(PLATFORM_NAME, cleanId || "0", PLUGIN_ID),
            name: r.title || ("OK.ru Video " + cleanId),
            thumbnails: thumbnails,
            author: author,
            uploadDate: 0,
            url: r.url || ("https://ok.ru/video/" + cleanId),
            duration: r.duration || 0,
            viewCount: 0,
            isLive: false
        });
    } catch (err) {
        return null;
    }
}

function hasVideoLinks(html) {
    return /\/(?:video|videoembed)\/\d+/i.test(safeStr(html)) ||
           /(?:data-movie-id|data-video-id|data-id)=["']?\d{5,}/i.test(safeStr(html));
}

function fetchSearchPage(query, page) {
    let q = encodeURIComponent(safeStr(query));
    let targets = [
        "https://m.ok.ru/video/search?st.query=" + q + (page > 1 ? "&st.page=" + page : ""),
        "https://ok.ru/video/search?search=" + q + (page > 1 ? "&st.page=" + page : ""),
        "https://ok.ru/dk?st.cmd=searchResult&st.mode=Movie&st.query=" + q + (page > 1 ? "&st.page=" + page : "")
    ];

    for (let i = 0; i < targets.length; i++) {
        let targetUrl = targets[i];
        let html = "";
        try {
            html = httpGetAuthenticated(targetUrl);
        } catch (e) {
            addDebug("auth search error on " + targetUrl + ": " + e);
        }

        if (html && hasVideoLinks(html)) {
            addDebug("BÃºsqueda exitosa con sesiÃ³n en: " + targetUrl);
            return html;
        }

        if (!html || !hasVideoLinks(html)) {
            try {
                let pubHtml = httpGet(targetUrl);
                if (pubHtml && hasVideoLinks(pubHtml)) {
                    addDebug("BÃºsqueda exitosa pÃºblica en: " + targetUrl);
                    return pubHtml;
                }
            } catch (_) {}
        }

        if (html && looksLikeLoginWall(html)) {
            throw makeErr(LOGIN_MSG);
        }
    }
    return "";
}

function searchOk(query, continuationToken) {
    let page = 1;
    try {
        if (continuationToken && typeof continuationToken === "object") {
            page = Math.max(1, Number(continuationToken.page) || 1);
        } else if (continuationToken) {
            page = Math.max(1, Number(continuationToken) || 1);
        }
    } catch (_) {}

    let html = fetchSearchPage(query, page);
    if (!html) {
        addDebug("searchOk: Sin HTML o sin resultados para: " + query);
        return new OkSearchPager([], false, { query: safeStr(query), page: page + 1 });
    }

    let found = extractSearchResults(html);
    let raw = [];
    let seen = {};
    for (let i = 0; i < found.length; i++) {
        if (!seen[found[i].id]) {
            seen[found[i].id] = true;
            raw.push(found[i]);
        }
    }

    let out = [];
    for (let i = 0; i < raw.length; i++) {
        let v = makeSearchVideo(raw[i]);
        if (v) out.push(v);
    }

    let hasMore = raw.length >= 8;
    let context = { query: safeStr(query), page: page + 1 };
    return new OkSearchPager(out, hasMore, context);
}

// FIX CRÃTICO: Helper unificado para compatibilidad entre versiones del SDK de GrayJay
function pagerHasMore(p) {
    if (!p) return false;
    if (typeof p.hasMorePages === "function") return p.hasMorePages();
    if (typeof p.hasMorePagers === "function") return p.hasMorePagers();
    return !!p.hasMore;
}

class OkSearchPager extends VideoPager {
    constructor(results, hasMore, context) {
        super(results, hasMore, context);
    }
    nextPage() {
        if (!pagerHasMore(this)) return this;
        return searchOk(this.context.query, this.context.page);
    }
}

function doDetails(url) {
    resetDebug();
    let id = extractVideoId(url);
    if (!id) throw new Error("URL de video de OK.ru no vÃ¡lida");

    try {
        let ua = extractAuthorParams(url);
        if (ua.name || ua.url) rememberAuthor(id, ua);
    } catch (_) {}

    let cached = getCachedDetails(id);
    if (cached) {
        let requestedTitle = extractTitleParam(url);
        if (requestedTitle && !/^OK\.ru video\b/i.test(requestedTitle)) {
            cached.name = requestedTitle;
            rememberTitle(id, requestedTitle);
        }
        return cached;
    }

    let canonical = "https://ok.ru/video/" + id;
    let html = loadOkPage(canonical, id);
    if (!html) throw new Error("No se pudo cargar la pÃ¡gina del video de OK.ru");

    let meta = parseMetadata(html, canonical);
    if (!meta) throw new Error("No se encontrÃ³ metadata en el video de OK.ru\n" + debugText());

    let fallbackTitle =
        extractTitleParam(url) ||
        recallTitle(id) ||
        extractPageTitle(html) ||
        ("OK.ru video " + id);

    let details = buildVideoDetails(meta, canonical, fallbackTitle, html);
    putCachedDetails(id, details);
    return details;
}

function loadOkPage(url, id) {
    let headers = {
        "User-Agent": UA_DESKTOP,
        "Referer": "https://ok.ru/",
        "Origin": "https://ok.ru"
    };

    let publicBody = "";
    if (id) publicBody = httpGet("https://ok.ru/videoembed/" + id, headers);
    if (!publicBody) publicBody = httpGet(url, headers);

    if (publicBody) {
        try {
            let publicMeta = parseMetadata(publicBody, url);
            if (publicMeta && (collectHlsUrls(publicMeta).length > 0 || collectMp4Urls(publicMeta).length > 0 || isM3u8Url(xuperResolve(publicMeta)))) {
                return publicBody;
            }
        } catch (_) {}
    }

    if (id) {
        try {
            let authBody = httpGetAuthenticated("https://ok.ru/videoembed/" + id);
            if (authBody) return authBody;
        } catch (_) {}
    }
    try {
        let authBody2 = httpGetAuthenticated(url);
        if (authBody2) return authBody2;
    } catch (_) {}

    return publicBody || "";
}

function extractPageTitle(html) {
    let m = safeStr(html).match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) {
        let t = cleanText(m[1])
            .replace(/^(?:see|watch|ver)\s+video\s+["Â«â€œ'](.+?)["Â»â€']\s+on\s+ok.*$/i, "$1")
            .replace(/\s*[|\-â€“]\s*OK\.?RU.*$/i, "")
            .replace(/\s+on\s+OK\.?\s*Video Player\s*$/i, "")
            .trim();
        if (t && t.toLowerCase() !== "ok.ru") return t;
    }
    return "";
}

/* ------------------------- GrayJay: Canales y Autores ------------------------- */

const JUNK_NAME = /^(?:sd|hd|hdp|sdp|low|lowest|lq|lqp|mobile|full|fullhd|high|higher|highest|medium|ultra|quad|mp4|hls|dash|auto|default|unknown|null|undefined|true|false|ok|ok\.ru|video|name|title|\d{1,4}p?)$/i;
const OK_RESERVED = /^(?:video|videoembed|videos|search|dk|feed|games|music|live|settings|apphook|profile|group|mobile|help|about|vkp|cdn|market|events|friends|messages|notifications|dkstatic|api|static|web-api|r|st|logout|anonymMain|post|photo|album|topic|statuses|discussions|sports)$/i;

const CHANNEL_NAMES = {};
const CHANNEL_AVATARS = {};
let AUTHOR_CACHE = {};
let AUTHOR_CACHE_COUNT = 0;

function isJunkName(n) {
    n = cleanText(n);
    return !n || JUNK_NAME.test(n);
}

function emptyAuthor() {
    return { name: "", id: "", url: "", thumbnail: "", subscribers: 0 };
}

function isOkChannelUrl(url) {
    let u = safeStr(url);
    let pg = u.match(/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/(?:profile|group)\/([^/?#]+)/i);
    if (pg && /^(?:null|undefined|0|-1)$/i.test(pg[1])) return false;
    if (/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/(?:profile\/[^/?#]+(?:\/video(?:\/c\d+)?)?|group\/[^/?#]+(?:\/video(?:\/all|\/c\d+)?(?:[?#].*)?)?)(?:[?#].*)?$/i.test(u)) return true;
    let v = u.match(/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/([A-Za-z0-9_.-]{2,})(?:\/video(?:\/all)?)?\/?(?:[?#].*)?$/i);
    return !!v && !OK_RESERVED.test(v[1]);
}

function bareChannelUrl(url) {
    let u = safeStr(url).trim();
    let m = u.match(/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/(profile|group)\/([^/?#]+)(\/video\/c\d+)?/i);
    if (m) return "https://ok.ru/" + m[1].toLowerCase() + "/" + m[2] + (m[3] || "");
    let v = u.match(/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/([A-Za-z0-9_.-]{2,})(?:\/video(?:\/all)?)?\/?(?:[?#].*)?$/i);
    if (v && !OK_RESERVED.test(v[1])) return "https://ok.ru/" + v[1];
    return u;
}

function chanKey(url) {
    let sc = safeStr(url).match(/ok\.ru\/(?:profile|group)\/([^/?#]+)\/video\/c(\d+)/i);
    if (sc) return sc[1] + "_c" + sc[2];
    let m = safeStr(url).match(/ok\.ru\/(?:(?:profile|group)\/)?([^/?#]+)/i);
    return m ? m[1] : safeStr(url);
}

function getAuthorInfo(meta) {
    let info = emptyAuthor();
    if (!safeObj(meta)) return info;

    let a = safeObj(meta.author) ? meta.author :
            (safeObj(meta.owner) ? meta.owner :
            (safeObj(meta.user) ? meta.user : null));

    if (a) {
        info.name = cleanText(firstValue(a, ["name", "displayName", "fullName", "userName", "username"]));
        info.id = safeStr(firstValue(a, ["id", "userId", "uid", "profileId"]));
        info.url = normalizeUrl(firstValue(a, ["profile", "profileUrl", "url"]), "https://ok.ru/");
        info.thumbnail = normalizeUrl(firstValue(a, ["thumbnail", "avatar", "avatarUrl", "photo", "pic190x190"]), "https://ok.ru/");
    }

    if (info.id && !info.url) info.url = "https://ok.ru/profile/" + encodeURIComponent(info.id);
    return info;
}

function extractAuthorFromBlock(block) {
    block = safeStr(block);
    let out = emptyAuthor();
    if (!block) return out;

    let src = block;
    try { src = htmlDecode(src); } catch (_) {}

    let m = src.match(/(?:author|owner|uploader)\s*[:=]\s*["']([^"']{2,300})["']/i);
    if (m && !isJunkName(m[1])) out.name = cleanText(m[1]);

    let gm = src.match(/\/group\/(\d{4,})/i);
    if (gm) {
        out.id = gm[1];
        out.url = "https://ok.ru/group/" + encodeURIComponent(out.id) + "/video/all";
    } else {
        let pm = src.match(/\/profile\/(\d{4,})/i);
        if (pm) {
            out.id = pm[1];
            out.url = "https://ok.ru/profile/" + encodeURIComponent(out.id) + "/video";
        }
    }
    return out;
}

function enrichSearchAuthors(results, html) {
    return results;
}

function enrichAuthorsFromWatchPage(results) {
    return results;
}

function withAuthorParams(url, ai) {
    return url;
}

function extractAuthorParams(url) {
    return emptyAuthor();
}

function rememberAuthor(id, info) {
    if (id && info) AUTHOR_CACHE[id] = info;
}

function recallAuthor(id) {
    return AUTHOR_CACHE[id] || null;
}

function makeAuthorLink(info, videoId) {
    info = info || {};
    let name = isJunkName(info.name) ? "" : cleanText(info.name);
    let url = isHttpUrl(info.url) ? info.url : "";
    let id = info.id || videoId || "0";

    if (!name && url && CHANNEL_NAMES[chanKey(url)]) name = CHANNEL_NAMES[chanKey(url)];
    if (!name && url) name = "OK.ru";
    if (!name) return null;

    if (url) url = bareChannelUrl(url);

    try {
        return new PlatformAuthorLink(
            new PlatformID(PLATFORM_NAME, id, PLUGIN_ID),
            name,
            url || "https://ok.ru",
            info.thumbnail || "",
            0
        );
    } catch (_) {
        return null;
    }
}

function resolveAuthorInfo(info, videoId, html) {
    return info || emptyAuthor();
}

let SERIES_DIAG = "";
function applySeriesByTitle(info, title) {
    return info;
}

/* ------------------------- Orden por capÃ­tulo (Ãlbumes / Series) ------------------------- */

const SORT_CH_ASC  = "CapÃ­tulo â†‘ (menor a mayor)";
const SORT_CH_DESC = "CapÃ­tulo â†“ (mayor a menor)";
const SORT_SITE    = "Orden de OK.ru";
const CHANNEL_DRAIN_MAX_PAGES = 80;
const CHANNEL_DRAIN_BUDGET_MS = 90000;

// FIX MEJORADO: DetecciÃ³n robusta de temporada y capÃ­tulo para series hispanas y rusas
function chapterOrderKey(title) {
    let t = cleanText(title);
    let season = 1; // por defecto temporada 1 para series no especificadas
    let ch = null;

    // Temporada: S01, T02, Season 1, 1x04, etc.
    let sm = t.match(/\b(?:S|T)(\d{1,2})\s*(?:[-_ ]?\s*(?:E|Ep|Cap)\s*\d|x\d)/i) ||
             t.match(/\b(\d{1,2})x\d{1,3}\b/i) ||
             t.match(/(?:temporada|temp\.?|season|ÑÐµÐ·Ð¾Ð½)\s*#?\s*(\d{1,2})/i);
    if (sm) season = parseInt(sm[1], 10);

    // CapÃ­tulo:
    // 1) Formato estÃ¡ndar 1x04
    let xMatch = t.match(/\b\d{1,2}x(\d{1,3})\b/i);
    if (xMatch) {
        ch = parseInt(xMatch[1], 10);
    }

    // 2) Prefijos explÃ­citos: Cap, Ep, Episodio, Ð¡ÐµÑ€Ð¸Ñ, Ð’Ñ‹Ð¿ÑƒÑÐº, Parte
    if (ch === null) {
        let cm = t.match(/(?:\b(?:cap[iÃ­]tulos?|cap\.?|episodios?|epis\.?|ep\.?|episode|ÑÐµÑ€Ð¸Ñ|ÑÐ¿Ð¸Ð·Ð¾Ð´|Ð²Ñ‹Ð¿ÑƒÑÐº|parte|part|pt\.?))\s*[:#.\-]?\s*(\d{1,4})/i) ||
                 t.match(/\bS\d{1,2}\s*E(\d{1,3})/i) ||
                 t.match(/#\s*(\d{1,4})/);
        if (cm) ch = parseInt(cm[1], 10);
    }

    // 3) Fracciones: 04/24 o 04 de 24
    if (ch === null) {
        let fm = t.match(/\b(\d{1,4})\s*(?:\/|de)\s*\d{1,4}\b/i);
        if (fm) ch = parseInt(fm[1], 10);
    }

    // 4) NÃºmeros entre corchetes o parÃ©ntesis: [05], (05)
    if (ch === null) {
        let bm = t.match(/[\[\(](\d{1,3})[\]\)]/);
        if (bm) ch = parseInt(bm[1], 10);
    }

    // 5) Guion con nÃºmero al final: "Nombre de serie - 04"
    if (ch === null) {
        let dm = t.match(/(?:^|[-â€“â€”:])\s*(\d{1,3})(?:\s*\([\s\S]*\))?\s*$/);
        if (dm) ch = parseInt(dm[1], 10);
    }

    // 6) Fallback: Ãºltimo nÃºmero suelto que no parezca aÃ±o (1900-2099)
    if (ch === null) {
        let re = /\d+/g, x;
        while ((x = re.exec(t)) !== null) {
            let n = parseInt(x[0], 10);
            if (x[0].length === 4 && n >= 1900 && n <= 2099) continue;
            if (x[0].length > 4) continue;
            ch = n;
        }
    }

    return { s: season, c: ch };
}

function sortByChapter(list, desc) {
    let arr = [];
    for (let i = 0; i < list.length; i++) {
        arr.push({ v: list[i], i: i, k: chapterOrderKey(list[i].name || list[i].title || "") });
    }
    arr.sort(function (a, b) {
        let an = a.k.c === null, bn = b.k.c === null;
        if (an !== bn) return an ? 1 : -1;
        if (an && bn) return a.i - b.i;
        if (a.k.s !== b.k.s) return desc ? b.k.s - a.k.s : a.k.s - b.k.s;
        if (a.k.c !== b.k.c) return desc ? b.k.c - a.k.c : a.k.c - b.k.c;
        return a.i - b.i;
    });
    return arr.map(function (x) { return x.v; });
}

function chapterSortMode(order) {
    let o = safeStr(order);
    if (!o) return "asc";
    if (/orden de ok/i.test(o)) return "";
    if (/mayor a menor|â†“|desc/i.test(o)) return "desc";
    return "asc";
}

function sortedSeriesPager(url, mode) {
    let u = safeStr(url);
    if (!/\/video\/c\d+/i.test(u)) return null;

    let t0 = nowMs();
    let all = [], seen = {};
    function take(pg) {
        let rs = (pg && pg.results) || [];
        for (let i = 0; i < rs.length; i++) {
            let id = "";
            try { id = safeStr(rs[i].id && rs[i].id.value ? rs[i].id.value : rs[i].url); } catch (_) {}
            if (id && seen[id]) continue;
            if (id) seen[id] = true;
            all.push(rs[i]);
        }
    }
    let pager = null;
    try { pager = channelPager(u, 1); } catch (e) { addDebug("orden: p1 " + e); return null; }
    take(pager);
    let page = 2;

    // FIX CRÃTICO: uso de pagerHasMore(pager) en vez de pager.hasMorePagers()
    while (pager && pagerHasMore(pager) && page <= CHANNEL_DRAIN_MAX_PAGES && (nowMs() - t0) < CHANNEL_DRAIN_BUDGET_MS) {
        try { pager = channelPager(u, page); } catch (e) { addDebug("orden: corte en p" + page + ": " + e); break; }
        take(pager);
        page++;
    }
    if (!all.length) return null;
    return new OkChannelVideoPager(sortByChapter(all, mode === "desc"), false, { url: u, page: page });
}

class OkChannelVideoPager extends VideoPager {
    constructor(results, hasMore, context) {
        super(results, hasMore, context);
    }
    nextPage() {
        // FIX CRÃTICO: pagerHasMore()
        if (!pagerHasMore(this)) return this;
        return channelPager(this.context.url, this.context.page);
    }
}

function channelPager(url, page) {
    let res = resolveChannel(url);
    let bare = res ? res.bare : bareChannelUrl(url);
    let html = fetchChannelPage(url, page);
    let raw = html ? collectChannelVideos(html) : [];

    let key = chanKey(bare);
    let name = CHANNEL_NAMES[key] || (html ? extractPageTitle(html) : "OK.ru");
    let thumb = CHANNEL_AVATARS[key] || "";

    for (let i = 0; i < raw.length; i++) {
        let ai = raw[i].authorInfo || {};
        raw[i].authorInfo = {
            name: name || ai.name || "",
            id: ai.id || key,
            url: bare,
            thumbnail: thumb || ai.thumbnail || "",
            subscribers: 0
        };
    }

    let out = [];
    for (let i = 0; i < raw.length; i++) {
        let v = makeSearchVideo(raw[i]);
        if (v) out.push(v);
    }
    return new OkChannelVideoPager(out, raw.length > 0, { url: url, page: page + 1 });
}

function resolveChannel(url) {
    let bare = bareChannelUrl(url);
    return { fetchUrl: bare, bare: bare, html: "" };
}

function fetchChannelPage(url, page) {
    let target = url + (url.indexOf("?") >= 0 ? "&" : "?") + "st.page=" + page;
    return httpGetAuthenticated(target) || "";
}

function collectChannelVideos(html) {
    return extractSearchResults(html);
}

function getChannelObject(url) {
    let bare = bareChannelUrl(url);
    let key = chanKey(bare);
    return new PlatformChannel({
        id: new PlatformID(PLATFORM_NAME, key, PLUGIN_ID),
        name: CHANNEL_NAMES[key] || "OK.ru Canal",
        thumbnail: CHANNEL_AVATARS[key] || "",
        banner: "",
        subscribers: 0,
        description: "Canal de OK.ru",
        url: bare,
        links: {}
    });
}

function channelPageFromToken(token) {
    try {
        if (token && typeof token === "object") return Math.max(1, Number(token.page) || 1);
        if (token) return Math.max(1, Number(token) || 1);
    } catch (_) {}
    return 1;
}

// FIX CRÃTICO: Tipos vÃ¡lidos para ResultCapabilities
function okChannelTypes() {
    try {
        if (typeof Type !== "undefined" && Type) {
            if (Type.Feed && Type.Feed.Videos) return [Type.Feed.Videos];
            if (Type.Content && Type.Content.Video) return [Type.Content.Video];
        }
    } catch (_) {}
    return ["video"];
}

/* ------------------------- GrayJay Source Exports ------------------------- */

source.setSettings = function (settings) {};

source.enable = function () {
    return true;
};

source.getSearchCapabilities = function () {
    return new ResultCapabilities(["video"], [], []);
};

source.search = function (query, type, order, filters, continuationToken) {
    return searchOk(query, continuationToken);
};

source.searchSuggestions = function (query) {
    return [];
};

source.isContentDetailsUrl = function (url) {
    return REGEX_VIDEO_URL.test(safeStr(url));
};

source.isVideoDetailsUrl = function (url) {
    return REGEX_VIDEO_URL.test(safeStr(url));
};

source.getVideoDetails = function (url) {
    return doDetails(url);
};

source.getContentDetails = function (url) {
    return doDetails(url);
};

class OkHomePager extends VideoPager {
    constructor(results, hasMore, context) {
        super(results, hasMore, context);
    }
    nextPage() {
        return this;
    }
}

source.getHome = function () {
    return new OkHomePager([], false, {});
};

source.isChannelUrl = function (url) {
    return isOkChannelUrl(url);
};

source.getChannel = function (url) {
    return getChannelObject(url);
};

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    let page = channelPageFromToken(continuationToken);
    if (page <= 1) {
        let mode = chapterSortMode(order);
        if (mode) {
            let sp = sortedSeriesPager(url, mode);
            if (sp) return sp;
        }
    }
    return channelPager(url, page);
};

source.getChannelVideos = function (url, type, order, filters, continuationToken) {
    return source.getChannelContents(url, type, order, filters, continuationToken);
};

source.getChannelCapabilities = function () {
    try {
        return new ResultCapabilities(okChannelTypes(), [SORT_CH_ASC, SORT_CH_DESC, SORT_SITE], []);
    } catch (_) {
        return { types: okChannelTypes(), sorts: [SORT_CH_ASC, SORT_CH_DESC, SORT_SITE], filters: [] };
    }
};
