/**
 * OK.ru (Worker) — plugin GrayJay.
 * Solo habla con el Worker (X-Api-Key + X-Ok-Cookie).
 * Endpoints: GET /search, GET /video, POST /channel, GET /ping.
 */

var PLATFORM = "OK.ru";
var CONFIG = {};

var RE_VIDEO = /ok\.ru\/(?:video|videoembed)\/(\d+)/i;
var OK_RESERVED = /^(?:video|videoembed|videos|search|dk|feed|games|music|live|settings|apphook|profile|group|mobile|help|about|vkp|cdn|market|events|friends|messages|notifications|dkstatic|api|static|web-api|r|st|logout|anonymMain|post|photo|album|topic|statuses|discussions|sports|__author)$/i;

var QUALITY = {
    ultra: 2160, highest: 1440, quad: 1440, higher: 1080, full: 1080, fullhd: 1080,
    hd: 720, hdp: 720, sd: 480, sdp: 480, low: 360, lq: 360, lqp: 360, lowest: 240, mobile: 144
};

source.enable = function (conf) {
    CONFIG = conf || {};
};

source.getHome = function () {
    return new HomePager([], false, {});
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Videos], sorts: [], filters: [] };
};

source.search = function (query, type, order, filters, continuationToken) {
    var page = continuationToken ? parseInt(continuationToken, 10) : 1;
    if (!page || page < 1) page = 1;
    var data = workerGet("/search?q=" + encodeURIComponent(query || "") + "&page=" + page);
    var videos = mapVideos(data.results);
    return new SearchPager(videos, !!data.hasMore && videos.length > 0, {
        query: query,
        type: type,
        order: order,
        filters: filters,
        page: page + 1
    });
};

source.isContentDetailsUrl = function (url) {
    return RE_VIDEO.test(String(url || ""));
};

source.getContentDetails = function (url) {
    var id = (String(url || "").match(RE_VIDEO) || [])[1];
    if (!id) throw new ScriptException("URL de video OK.ru no válida");

    var qs = "id=" + encodeURIComponent(id);
    var t = qparam(url, "t");
    var an = qparam(url, "an");
    var au = qparam(url, "au");
    var ap = qparam(url, "ap");
    if (t) qs += "&t=" + encodeURIComponent(t);
    if (an) qs += "&an=" + encodeURIComponent(an);
    if (au) qs += "&au=" + encodeURIComponent(au);
    if (ap) qs += "&ap=" + encodeURIComponent(ap);

    var data = workerGet("/video?" + qs);
    if (data.external && data.external.url && !(data.hls && data.hls.length) && !(data.mp4 && data.mp4.length)) {
        throw new ScriptException(
            "Este video está alojado en " + (data.external.plugin || "otra plataforma") +
            ". Ábrelo ahí: " + data.external.url
        );
    }
    return toDetails(data);
};

source.isChannelUrl = function (url) {
    return isChannelUrl(url);
};

source.getChannel = function (url) {
    var data = workerPost("/channel", { url: String(url || "") });
    return toChannel(data.channel);
};

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    var body = { url: String(url || "") };
    if (continuationToken) body.token = continuationToken;
    var data = workerPost("/channel", body);
    var videos = mapVideos(data.videos);
    return new OkRuChannelPager(videos, !!data.hasMore && !!data.token, {
        url: url,
        type: type,
        order: order,
        filters: filters,
        token: data.token || ""
    });
};

class OkRuHomePager extends VideoPager {
    constructor(results, hasMore, context) { super(results, hasMore, context); }
    nextPage() { return source.getHome(); }
}

class OkRuSearchPager extends VideoPager {
    constructor(results, hasMore, context) { super(results, hasMore, context); }
    nextPage() {
        return source.search(this.context.query, this.context.type, this.context.order, this.context.filters, this.context.page);
    }
}

class OkRuChannelPager extends VideoPager {
    constructor(results, hasMore, context) { super(results, hasMore, context); }
    nextPage() {
        return source.getChannelContents(this.context.url, this.context.type, this.context.order, this.context.filters, this.context.token);
    }
}

function workerBase() {
    var base = setting("workerUrl", "").replace(/\/+$/, "");
    if (!base || base.indexOf("tu-cuenta") >= 0) {
        throw new ScriptException("Configura la URL del Worker en los ajustes del plugin");
    }
    if (!/^https?:\/\//i.test(base)) base = "https://" + base;
    return base;
}

function workerHeaders() {
    var headers = {
        "Accept": "application/json",
        "User-Agent": "GrayJay OK.ru Worker"
    };
    var key = setting("apiKey", "");
    var cookie = setting("okCookie", "");
    if (key) headers["X-Api-Key"] = key;
    if (cookie) headers["X-Ok-Cookie"] = cookie.replace(/[\r\n]/g, "").trim();
    return headers;
}

function workerGet(path) {
    return readHttp(http.GET(workerBase() + path, workerHeaders(), false));
}

function workerPost(path, body) {
    var headers = workerHeaders();
    headers["Content-Type"] = "application/json";
    return readHttp(http.POST(workerBase() + path, JSON.stringify(body || {}), headers, false));
}

function readHttp(resp) {
    if (!resp) throw new ScriptException("Sin respuesta del Worker");
    var code = resp.code || resp.statusCode || 0;
    var text = resp.body || "";
    var data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = null; }
    var ok = resp.isOk === true || (code >= 200 && code < 300);
    if (!ok) {
        var msg = (data && data.error) ? data.error : (text || ("HTTP " + code));
        throw new ScriptException(String(msg));
    }
    return data || {};
}

function setting(key, fallback) {
    try {
        if (typeof bridge !== "undefined" && bridge && bridge.settings && bridge.settings[key]) {
            return String(bridge.settings[key]);
        }
    } catch (e) {}
    return fallback || "";
}

function qparam(url, key) {
    var m = String(url || "").match(new RegExp("[?&]" + key + "=([^&#]+)"));
    if (!m) return "";
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

function isChannelUrl(url) {
    var u = String(url || "");
    if (RE_VIDEO.test(u)) return false;
    if (/ok\.ru\/__author\/\d+/i.test(u)) return true;
    if (/ok\.ru\/(?:profile|group)\/[^/?#]+/i.test(u)) return true;
    var alias = u.match(/ok\.ru\/([A-Za-z0-9_.-]{2,})(?:\/video(?:\/all|\/c\d+)?)?\/?(?:[?#].*)?$/i);
    return !!(alias && !OK_RESERVED.test(alias[1]));
}

function pluginId() {
    return (CONFIG && CONFIG.id) ? CONFIG.id : "a7c4e9a2-6b3d-4f18-9c0a-0d1e2f3a4b5c";
}

function authorLink(author) {
    author = author || {};
    var id = author.id || author.url || author.name || "okru";
    var name = author.name || "OK.ru";
    var url = author.url || "";
    var thumb = author.thumbnail || "";
    return new PlatformAuthorLink(
        new PlatformID(PLATFORM, String(id), pluginId()),
        name,
        url,
        thumb
    );
}

function thumbs(url) {
    if (!url) return new Thumbnails([]);
    return new Thumbnails([new Thumbnail(url, 480)]);
}

function mapVideos(list) {
    var out = [];
    var items = list || [];
    for (var i = 0; i < items.length; i++) {
        var v = items[i];
        if (!v || !v.url) continue;
        out.push(new PlatformVideo({
            id: new PlatformID(PLATFORM, String(v.id || v.url), pluginId()),
            name: v.title || "OK.ru video",
            thumbnails: thumbs(v.thumbnail),
            author: authorLink(v.author),
            uploadDate: 0,
            duration: v.duration || 0,
            viewCount: 0,
            url: v.url,
            isLive: false
        }));
    }
    return out;
}

function toChannel(ch) {
    ch = ch || {};
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, String(ch.id || ch.url || "channel"), pluginId()),
        name: ch.name || "OK.ru",
        thumbnail: ch.thumbnail || "",
        banner: "",
        subscribers: 0,
        description: ch.description || "",
        url: ch.url || "",
        links: {}
    });
}

function heightOf(label) {
    var key = String(label || "").toLowerCase().trim();
    if (QUALITY[key]) return QUALITY[key];
    var m = key.match(/(\d{3,4})/);
    return m ? parseInt(m[1], 10) : 480;
}

function bitrateOf(height) {
    if (height >= 2160) return 15000000;
    if (height >= 1440) return 9000000;
    if (height >= 1080) return 5000000;
    if (height >= 720) return 2500000;
    if (height >= 480) return 1200000;
    if (height >= 360) return 700000;
    return 400000;
}

function mediaHeaders() {
    return {
        headers: {
            "Referer": "https://ok.ru/",
            "Origin": "https://ok.ru",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
        }
    };
}

function toDetails(data) {
    var sources = [];
    var duration = data.duration || 0;
    var hls = data.hls || [];
    for (var i = 0; i < hls.length; i++) {
        if (!hls[i]) continue;
        sources.push(new HLSSource({
            name: "HLS",
            duration: duration,
            url: hls[i],
            priority: true,
            requestModifier: mediaHeaders()
        }));
    }
    var mp4 = data.mp4 || [];
    for (var j = 0; j < mp4.length; j++) {
        var item = mp4[j] || {};
        var url = item.url || item;
        if (!url || typeof url !== "string") continue;
        var h = heightOf(item.label);
        sources.push(new VideoUrlSource({
            name: item.label || (h + "p"),
            url: url,
            width: Math.round(h * 16 / 9),
            height: h,
            duration: duration,
            container: "video/mp4",
            codec: "h264",
            bitrate: bitrateOf(h),
            requestModifier: mediaHeaders()
        }));
    }
    if (!sources.length) throw new ScriptException("El Worker no devolvió fuentes reproducibles");

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, String(data.id), pluginId()),
        name: data.title || "OK.ru video",
        thumbnails: thumbs(data.poster),
        author: authorLink(data.author),
        uploadDate: 0,
        duration: duration,
        viewCount: 0,
        url: "https://ok.ru/video/" + data.id,
        isLive: false,
        description: data.description || "",
        video: new VideoSourceDescriptor(sources),
        rating: new RatingLikes(0),
        subtitles: []
    });
}
