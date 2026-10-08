/*
 * GrayJay - OK.ru Source v43 (cliente delgado del Worker)
 *
 * Búsqueda, autores, series y canales los resuelve tu Worker de Cloudflare
 * (worker.js). Este script solo: llama al Worker, arma los objetos de GrayJay y
 * entrega las URLs (HLS/MP4) al reproductor y al Cast. Sin login nativo.
 *
 * Ajustes del plugin (en GrayJay): URL del Worker, API key, "Extraer video en".
 * Ordenar series por capítulo (↑ / ↓ / orden de OK.ru) igual que v42.
 */

const PLATFORM_NAME = "OK.ru";
const PLUGIN_ID = "62af0e2f-bfd9-489f-afe1-f66583d2f7d0";

const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/136.0.0.0 Safari/537.36";

const REGEX_VIDEO_URL = /ok\.ru\/(?:video|videoembed)\/(\d+)/i;
const MAX_HTML_SIZE = 5000000;
const MAX_SOURCES = 12;
const MAX_DEBUG = 50;
let DEBUG = [];

// Igual que v42: UA solo en HLS/MP4 (sin Origin/Referer/Cookie; rompen el Cast).
const ENABLE_SOURCE_HEADERS = true;
const SEND_ORIGIN_TO_PLAYER = true;

function nowMs() { try { return Date.now(); } catch (_) { return 0; } }


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

const OK_RESERVED = /^(?:video|videoembed|videos|search|dk|feed|games|music|live|settings|apphook|profile|group|mobile|help|about|vkp|cdn|market|events|friends|messages|notifications|dkstatic|api|static|web-api|r|st|logout|anonymMain|post|photo|album|topic|statuses|discussions|sports)$/i;

function addDebug(value) {
    try {
        let s = safeStr(value);
        if (!s) return;
        if (DEBUG.length >= MAX_DEBUG) DEBUG.shift();
        DEBUG.push(s.length > 600 ? s.substring(0, 600) + "…" : s);
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

function installPluginMessage(ext) {
    return "Este video está alojado en " + ext.plugin + ".\nGrayJay no permite salto automático desde esta pantalla. Copie el enlace o búsquelo en la plataforma original:\n" + ext.url;
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
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        };

        mergeHeaders(h, headers);

        let r = http.GET(url, h);
        if (!r) return "";

        let body = "";
        try {
            body = r.body;
        } catch (_) {}

        if (!body) {
            try {
                body = r.getBody();
            } catch (_) {}
        }

        body = safeStr(body);

        if (body.length > MAX_HTML_SIZE) {
            addDebug("HTTP body capped: " + body.length);
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

function tryParseJson(value) {
    if (value === null || value === undefined) return null;

    if (safeObj(value)) return value;

    let s = safeStr(value).trim();
    if (!s) return null;

    for (let pass = 0; pass < 4; pass++) {
        try {
            let v = JSON.parse(s);
            return v;
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
                addDebug("metadataUrl: " + metaUrl);
                let fullUrl = normalizeUrl(metaUrl, "https://ok.ru/");
                let headers = {
                    "User-Agent": UA_DESKTOP,
                    "Referer": "https://ok.ru/",
                    "Origin": "https://ok.ru"
                };

                // OPTIMIZACIÓN: POST primero
                let body = httpPost(fullUrl, "", headers);
                meta = tryParseJson(body);
                if (meta) return meta;

                // Fallback a GET
                body = httpGet(fullUrl, headers);
                meta = tryParseJson(body);
                if (meta) return meta;
            }
        }
        addDebug("data-options presente pero sin metadata utilizable");
    } else {
        addDebug("sin data-options en la página");
    }

    // Plan B: buscar la clave directo en el texto
    let t = htmlDecode(html).replace(/\\\//g, "/");
    let mm = /"hlsManifestUrl"\s*:\s*"([^"]+)"/i.exec(t);
    if (mm) {
        addDebug("plan B: hlsManifestUrl encontrado directo en el HTML");
        return { hlsManifestUrl: cleanUrl(mm[1]) };
    }

    return null;
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
        return a.idx - b.idx; // estable para calidades iguales/desconocidas
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
            if (typeof v === "object") continue; // evita "[object Object]"
            let s = safeStr(v);
            if (s) return s;
        } catch (_) {}
    }

    return "";
}

function isGenericTitle(t) {
    t = cleanText(t || "").toLowerCase().replace(/[.\u2026:!]+$/g, "").trim();
    if (!t || t.length < 2) return true;
    // Solo duración / números
    if (/^[\d:\s]+$/.test(t)) return true;
    if (/^(image|video|videos|more|next|previous|menu|play|share|like|comment)$/.test(t)) return true;
    // Sin \b: en el JS de GrayJay \b solo ve ASCII, y "Смотреть" se colaba
    // como título. Es el botón Ver/Watch de la ficha, no el nombre del video.
    if (/^(view|views|ver|watch|play|reproducir|mirar|смотреть|посмотреть|просмотр|просмотры|открыть|открыть видео)(?:\s+(video|vídeo|видео|ролик))?$/.test(t)) return true;
    if (/^(view|views|ver|watch|play|reproducir|mirar|смотреть|посмотреть|просмотр|просмотры|открыть)\s+\d/.test(t) && t.length <= 40) return true;
    return false;
}

function getTitle(meta, fallback, id) {
    // En muchos videos el nombre viene en meta.movie.title.
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

    // FIX: cuando el video no tiene título propio, OK.ru a veces devuelve
    // en "title"/"name" el mismo ID numérico del video en vez de dejarlo
    // vacío. Eso pisaba el título recordado de la búsqueda (ej. "Historia
    // de Evan") con algo como "9132112939654". Si el valor es puramente
    // numérico, o es exactamente el ID, se descarta y se usa el fallback.
    if (v && (/^\d+$/.test(v) || (id && v === safeStr(id)))) {
        v = "";
    }

    let fb = cleanText(fallback);

    // OK.ru a veces manda: See video "Nombre" on OK. Video Player
    let wrapped = /see video\s+["«“'](.+?)["»”']/i.exec(v);
    if (wrapped) v = cleanText(wrapped[1]);
    if (/see video|on ok\.?\s*video player/i.test(v) && fb && !/see video/i.test(fb)) {
        return fb;
    }

    // El botón de la ficha ("Ver", "Watch", "Смотреть") no es el título.
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

    // GrayJay espera segundos. movie.duration de OK.ru ya viene en segundos
    // (ej. 1037 = 17 min); solo se divide si es un número enorme (ms).
    if (n > 100000) n = n / 1000;

    return Math.round(n);
}

function xuperGetPlaylistUrl(meta) {
    return firstValue(meta, ["playlistUrl", "playlist_url"]);
}

function xuperResolve(meta) {
    if (!safeObj(meta)) return "";

    let direct = xuperGetPlaylistUrl(meta);
    if (isM3u8Url(direct)) return normalizeUrl(direct);

    // Some responses nest the Xuper fields.
    let containers = [
        meta.xuper,
        meta.data,
        meta.result,
        meta.auth,
        meta.player,
        meta.flashvars
    ];

    for (let i = 0; i < containers.length; i++) {
        if (!safeObj(containers[i])) continue;

        let u = xuperGetPlaylistUrl(containers[i]);
        if (isM3u8Url(u)) return normalizeUrl(u);
    }

    return "";
}

function okRequestModifier(withOrigin) {
    let h = {
        "User-Agent": UA_DESKTOP
        // Se elimina Referer y Origin. Cast falla por políticas CORS 
        // si se incluyen, y OK.ru solo bloquea el User-Agent de ExoPlayer.
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

function makeHlsSource(url, duration, mode) {
    // mode: undefined/"full" = UA+Referer+Origin; "noorigin"; "none" = sin requestModifier
    try {
        let opts = {
            name: "OK.ru HLS",
            duration: duration || 0,
            url: url
        };
        if (ENABLE_SOURCE_HEADERS && mode !== "none") {
            opts.requestModifier = okRequestModifier(mode === "noorigin" ? false : SEND_ORIGIN_TO_PLAYER);
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
        if (ENABLE_SOURCE_HEADERS) opts.requestModifier = okRequestModifier(false);
        return new VideoUrlSource(opts);
    } catch (e) {
        addDebug("makeMp4Source EXCEPTION: " + e);
    }

    return null;
}

function badChannelId(id) {
    id = safeStr(id).trim();
    return !id || /^(?:null|undefined|nan|none|false|true|0|-1)$/i.test(id);
}

function isPseudoAuthorUrl(u) { return /ok\.ru\/__author\/\d+/i.test(safeStr(u)); }

function isOkChannelUrl(url) {
    if (isPseudoAuthorUrl(url)) return true;
    let u = safeStr(url);
    let pg = u.match(/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/(?:profile|group)\/([^/?#]+)/i);
    if (pg && badChannelId(pg[1])) return false;
    if (/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/(?:profile\/[^/?#]+(?:\/video(?:\/c\d+)?)?|group\/[^/?#]+(?:\/video(?:\/all|\/c\d+)?(?:[?#].*)?)?)(?:[?#].*)?$/i.test(u)) return true;
    // Alias de usuario: https://ok.ru/<alias> (sin rutas reservadas del sitio).
    let v = u.match(/^(?:https?:\/\/)?(?:www\.|m\.)?ok\.ru\/([A-Za-z0-9_.-]{2,})(?:\/video(?:\/all)?)?\/?(?:[?#].*)?$/i);
    return !!v && !OK_RESERVED.test(v[1]) && !badChannelId(v[1]);
}

function okChannelTypes() {
    try {
        if (typeof Type !== "undefined" && Type && Type.Feed && Type.Feed.Mixed) return [Type.Feed.Mixed];
    } catch (_) {}
    return ["MIXED"];
}

function chapterOrderKey(title) {
    let t = cleanText(title);
    let season = 0, ch = null, m;
    m = t.match(/(?:temporada|temp\.?|season|сезон)\s*#?\s*(\d{1,2})/i) || t.match(/\bS(\d{1,2})\s*E\d/i) || t.match(/\bT(\d{1,2})\s*[-_ ]?\s*(?:E|Ep|Cap)\s*\d/i);
    if (m) season = parseInt(m[1], 10);

    m = t.match(/(?:\b(?:cap[ií]tulos?|cap\.?|episodios?|epis\.?|ep\.?|episode|chapter|parte|part|pt\.?)|серия|эпизод)\s*[:#.\-]?\s*(\d{1,4})/i);
    if (!m) m = t.match(/\bS\d{1,2}\s*E(\d{1,3})/i);
    if (!m) m = t.match(/#\s*(\d{1,4})/);
    if (!m) m = t.match(/\b(\d{1,4})\s*(?:\/|de)\s*\d{1,4}\b/i);
    if (m) {
        ch = parseInt(m[1], 10);
    } else {
        // último número suelto que no parezca un año
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
        if (an !== bn) return an ? 1 : -1;            // sin número: siempre al final
        if (an && bn) return a.i - b.i;               // sin número: orden original
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
    if (/mayor a menor|↓|desc/i.test(o)) return "desc";
    return "asc";
}


/* =====================================================================
 *  LO NUEVO: el plugin ya no scrapea OK.ru; le pide todo al Worker.
 * ===================================================================== */

let CFG = { workerUrl: "", apiKey: "", okCookie: "", videoMode: 0 };   // videoMode 0 = teléfono (recomendado), 1 = Worker

function makeErr(msg) {
    try { return new ScriptException(msg); } catch (_) { return new Error(msg); }
}

source.enable = function (conf, settings, savedState) {
    try {
        CFG.workerUrl = safeStr(settings && settings.workerUrl).trim().replace(/\/+$/, "");
        CFG.apiKey = safeStr(settings && settings.apiKey).trim();
        CFG.okCookie = safeStr(settings && settings.okCookie).replace(/[\r\n]+/g, "").trim();
        CFG.videoMode = parseInt(safeStr(settings && settings.videoMode), 10) || 0;
    } catch (_) {}
    return true;
};
source.setSettings = function () {};
source.saveState = function () { return ""; };

/* ---------------------------- comunicación con el Worker ---------------------------- */

function wHeaders(json) {
    const h = { "Accept": "application/json", "X-Api-Key": CFG.apiKey };
    if (CFG.okCookie) h["X-Ok-Cookie"] = CFG.okCookie;   // sesión guardada en los ajustes de la app
    if (json) h["Content-Type"] = "application/json";
    return h;
}

function wUrl(path, params) {
    if (!CFG.workerUrl) throw makeErr("Falta la URL del Worker: ábrala en Ajustes del plugin OK.ru");
    const qs = [];
    for (const k in (params || {})) {
        const v = params[k];
        if (v === undefined || v === null || v === "") continue;
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
    return CFG.workerUrl + path + (qs.length ? "?" + qs.join("&") : "");
}

function parseWorker(r) {
    let body = "";
    try { body = r.body; } catch (_) {}
    let j = null;
    try { j = JSON.parse(safeStr(body)); } catch (_) {}
    if (!j) throw makeErr("Worker: respuesta inválida (HTTP " + safeStr(r && r.code) + ") " + safeStr(body).substring(0, 160));
    if (j.error) {
        let msg = j.error;
        if (j.code === "AUTH") msg = "Worker: la API key del plugin no coincide con la del Worker";
        throw makeErr(msg + (j.debug ? "\n" + j.debug : ""));
    }
    return j;
}

function wGet(path, params) {
    return parseWorker(http.GET(wUrl(path, params), wHeaders(false), false));
}

function wPost(path, obj) {
    return parseWorker(http.POST(wUrl(path, {}), JSON.stringify(obj || {}), wHeaders(true), false));
}

/* ---------------------------- conversión JSON -> objetos GrayJay ---------------------------- */

function authorLink(a) {
    if (!a || !a.name) return null;
    try {
        return new PlatformAuthorLink(
            new PlatformID(PLATFORM_NAME, safeStr(a.id || a.name), PLUGIN_ID),
            a.name, safeStr(a.url), validThumb(a.thumbnail), a.subscribers || 0);
    } catch (_) { return null; }
}

function validThumb(u) {
    u = safeStr(u);
    return /^(?:https?:)?\/\//i.test(u) ? u : "";
}

function makeThumbnails(u) {
    const t = [];
    if (isHttpUrl(u)) { try { t.push(new Thumbnail(u, 0)); } catch (_) {} }
    try { return new Thumbnails(t); } catch (_) { return new Thumbnails([]); }
}

function toPlatformVideo(r) {
    try {
        return new PlatformVideo({
            id: new PlatformID(PLATFORM_NAME, safeStr(r.id), PLUGIN_ID),
            name: r.title,
            thumbnails: makeThumbnails(r.thumbnail),
            author: authorLink(r.author),
            uploadDate: 0,
            url: r.url,
            duration: r.duration || 0,
            viewCount: 0,
            isLive: false
        });
    } catch (_) { return null; }
}

function toVideos(list) {
    const out = [];
    for (let i = 0; i < (list || []).length; i++) {
        const v = toPlatformVideo(list[i]);
        if (v) out.push(v);
    }
    return out;
}

/* ---------------------------- búsqueda ---------------------------- */

class OkSearchPager extends VideoPager {
    constructor(results, hasMore, context) { super(results, hasMore, context); }
    nextPage() {
        if (!this.hasMorePagers()) return this;
        return searchPager(this.context.query, this.context.page);
    }
}

function searchPager(query, page) {
    const j = wGet("/search", { q: query, page: page });
    const vids = toVideos(j.results);
    return new OkSearchPager(vids, !!j.hasMore && vids.length > 0, { query: safeStr(query), page: page + 1 });
}

function pageFromToken(t) {
    try {
        if (t && typeof t === "object") return Math.max(1, Number(t.page) || 1);
        if (t) return Math.max(1, Number(t) || 1);
    } catch (_) {}
    return 1;
}

source.getSearchCapabilities = function () {
    try { return new ResultCapabilities(["video"], [], []); }
    catch (_) { return { types: ["video"], sorts: [], filters: [] }; }
};
source.search = function (query, type, order, filters, token) { return searchPager(query, pageFromToken(token)); };
source.searchSuggestions = function (query) { return []; };

class OkHomePager extends VideoPager {
    constructor(results, hasMore, context) { super(results, hasMore, context); }
    nextPage() { return this; }
}
source.getHome = function () { return new OkHomePager([], false, {}); };

/* ---------------------------- video ---------------------------- */

source.isContentDetailsUrl = function (url) { return REGEX_VIDEO_URL.test(safeStr(url)); };
source.isVideoDetailsUrl = function (url) { return REGEX_VIDEO_URL.test(safeStr(url)); };

function urlParam(url, k) {
    try {
        const m = safeStr(url).match(new RegExp("[?&]" + k + "=([^&#]+)"));
        return m ? decodeURIComponent(m[1]) : "";
    } catch (_) { return ""; }
}

function localSources(meta) {
    const out = { hls: [], mp4: [] };
    if (!safeObj(meta)) return out;
    const xp = xuperResolve(meta);
    if (isM3u8Url(xp)) pushUnique(out.hls, xp);
    const nh = collectHlsUrls(meta);
    for (let i = 0; i < nh.length; i++) pushUnique(out.hls, nh[i]);
    out.mp4 = collectMp4Urls(meta);
    return out;
}

function doDetails(url) {
    resetDebug();
    const id = extractVideoId(url);
    if (!id) throw makeErr("URL de video de OK.ru inválida");
    const q = { id: id, t: urlParam(url, "t"), an: urlParam(url, "an"), au: urlParam(url, "au"), ap: urlParam(url, "ap") };
    const embedHeaders = { "User-Agent": UA_DESKTOP, "Referer": "https://ok.ru/", "Origin": "https://ok.ru" };

    let info = null, werr = null, localMeta = null;
    if (CFG.videoMode === 0) {
        // Teléfono: Worker (título/autor) y página embed pública (fuentes) en PARALELO.
        let res = null;
        try {
            res = http.batch()
                .GET(wUrl("/video", q), wHeaders(false), false)
                .GET("https://ok.ru/videoembed/" + id, embedHeaders, false)
                .execute();
        } catch (e) { werr = e; addDebug("batch: " + e); }
        if (res) {
            try { info = parseWorker(res[0]); } catch (e) { werr = e; }
            try { localMeta = extractMetadataFromHtml(safeStr(res[1] && res[1].body)); } catch (_) {}
        }
    } else {
        try { info = wGet("/video", q); } catch (e) { werr = e; }
    }

    const loc = localSources(localMeta);
    let hls = [], mp4 = [];
    const wk = info ? { hls: info.hls || [], mp4: info.mp4 || [] } : { hls: [], mp4: [] };
    if (CFG.videoMode === 0) {
        hls = loc.hls.length || loc.mp4.length ? loc.hls : wk.hls;
        mp4 = loc.hls.length || loc.mp4.length ? loc.mp4 : wk.mp4;
    } else {
        hls = wk.hls; mp4 = wk.mp4;
        if (!hls.length && !mp4.length) {          // respaldo: sacar las fuentes en el teléfono
            try {
                const r = http.GET("https://ok.ru/videoembed/" + id, embedHeaders, false);
                localMeta = extractMetadataFromHtml(safeStr(r.body));
                const l2 = localSources(localMeta);
                hls = l2.hls; mp4 = l2.mp4;
            } catch (_) {}
        }
    }

    const title = (info && info.title) || (localMeta ? getTitle(localMeta, q.t, id) : (q.t || "OK.ru video " + id));
    const poster = (info && info.poster) || (localMeta ? normalizeUrl(getPoster(localMeta), "https://ok.ru/") : "");
    const duration = (info && info.duration) || (localMeta ? getDuration(localMeta) : 0);

    const sources = [];
    for (let i = 0; i < hls.length && sources.length < MAX_SOURCES; i++) {
        const s = makeHlsSource(hls[i], duration);
        if (s) { s.name = i === 0 ? "OK.ru Auto HLS (Master)" : "OK.ru HLS " + (i + 1); sources.push(s); }
    }
    for (let j = 0; j < mp4.length && sources.length < MAX_SOURCES; j++) {
        const s = makeMp4Source(mp4[j].url, duration, j, mp4[j].label);
        if (s) sources.push(s);
    }

    if (!sources.length) {
        if (info && info.external) throw makeErr(installPluginMessage(info.external));
        if (werr) throw werr;
        throw makeErr("OK.ru: este video no expone fuentes reproducibles.\n" + (info && info.debug ? info.debug : debugText()));
    }

    let descriptor = null;
    try { descriptor = new MuxVideoSourceDescriptor({ isUnMuxed: false, videoSources: sources }); }
    catch (_) { descriptor = new VideoSourceDescriptor(sources); }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM_NAME, id, PLUGIN_ID),
        name: title,
        thumbnails: makeThumbnails(poster),
        author: authorLink(info && info.author),
        uploadDate: 0,
        url: "https://ok.ru/video/" + id,
        duration: duration,
        viewCount: 0,
        isLive: false,
        description: (info && info.description) || "",
        video: descriptor,
        dash: null,
        hls: hls.length ? makeHlsSource(hls[0], duration) : null,
        live: []
    });
}

source.getVideoDetails = function (url) { return doDetails(url); };
source.getContentDetails = function (url) { return doDetails(url); };

/* ---------------------------- canales / series ---------------------------- */

const CHANNEL_DRAIN_MAX_PAGES = 80;
const CHANNEL_DRAIN_BUDGET_MS = 90000;
const SORT_CH_ASC  = "Capítulo ↑ (menor a mayor)";
const SORT_CH_DESC = "Capítulo ↓ (mayor a menor)";
const SORT_SITE    = "Orden de OK.ru";

source.isChannelUrl = function (url) { return isOkChannelUrl(url); };

function toChannel(j) {
    const c = j.channel || {};
    return new PlatformChannel({
        id: new PlatformID(PLATFORM_NAME, safeStr(c.id || c.url), PLUGIN_ID),
        name: c.name || "OK.ru",
        thumbnail: validThumb(c.thumbnail),
        banner: "",
        subscribers: 0,
        description: c.description || "",
        url: c.url,
        links: {}
    });
}

source.getChannel = function (url) {
    return toChannel(wPost("/channel", { url: url }));
};

class OkChannelVideoPager extends VideoPager {
    constructor(results, hasMore, context) { super(results, hasMore, context); }
    nextPage() {
        if (!this.hasMorePagers()) return this;
        const c = this.context;
        const j = wPost("/channel", { url: c.url, token: c.token });
        const fresh = [];
        const rows = j.videos || [];
        for (let i = 0; i < rows.length; i++) {
            if (!c.seen[rows[i].id]) { c.seen[rows[i].id] = true; fresh.push(rows[i]); }
        }
        if (!fresh.length) return new OkChannelVideoPager([], false, c);
        return new OkChannelVideoPager(toVideos(fresh), !!j.hasMore && !!j.token, { url: c.url, token: j.token, seen: c.seen });
    }
}

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    const first = wPost("/channel", { url: url });
    const cu = first.channel.url;
    const mode = chapterSortMode(order);

    // Series: se bajan TODAS las páginas y se ordenan por capítulo.
    if (first.isSeries && mode) {
        const t0 = nowMs();
        const all = [], seen = {};
        function take(rows) {
            for (let i = 0; i < (rows || []).length; i++) {
                if (!seen[rows[i].id]) { seen[rows[i].id] = true; all.push(rows[i]); }
            }
        }
        take(first.videos);
        let j = first, page = 1;
        while (j.hasMore && j.token && page < CHANNEL_DRAIN_MAX_PAGES && (nowMs() - t0) < CHANNEL_DRAIN_BUDGET_MS) {
            try { j = wPost("/channel", { url: cu, token: j.token }); } catch (e) { addDebug("orden: corte en p" + (page + 1) + ": " + e); break; }
            take(j.videos);
            page++;
        }
        const vids = toVideos(all);
        return new OkChannelVideoPager(sortByChapter(vids, mode === "desc"), false, { url: cu, token: "", seen: seen });
    }

    const seen2 = {};
    const rows = first.videos || [];
    for (let i = 0; i < rows.length; i++) seen2[rows[i].id] = true;
    return new OkChannelVideoPager(toVideos(rows), !!first.hasMore && !!first.token, { url: cu, token: first.token, seen: seen2 });
};

source.getChannelVideos = function (url, type, order, filters, continuationToken) {
    return source.getChannelContents(url, type, order, filters, continuationToken);
};

source.getChannelCapabilities = function () {
    try { return new ResultCapabilities(okChannelTypes(), [SORT_CH_ASC, SORT_CH_DESC, SORT_SITE], []); }
    catch (_) { return { types: okChannelTypes(), sorts: [SORT_CH_ASC, SORT_CH_DESC, SORT_SITE], filters: [] }; }
};

