// OkRuProxy.js
// Cliente proxy para Grayjay que delega la carga al Cloudflare Worker

let source = {};

function getWorkerUrl() { return plugin.config.workerUrl; }
function getApiKey() { return plugin.config.apiKey; }
function getCookie() { return plugin.config.okCookie; }

function doFetch(path, method, bodyObj) {
    const baseUrl = getWorkerUrl();
    if (!baseUrl) throw new ScriptException("Debes configurar la URL del Worker en los ajustes del plugin.");
    
    // Quitar la barra final si la tiene
    const url = baseUrl.replace(/\/$/, "") + path;
    
    const headers = {};
    const apiKey = getApiKey();
    if (apiKey) headers["X-Api-Key"] = apiKey;
    const cookie = getCookie();
    if (cookie) headers["X-Ok-Cookie"] = cookie;

    let reqBody = null;
    if (bodyObj) {
        reqBody = JSON.stringify(bodyObj);
        headers["Content-Type"] = "application/json";
    }

    const resp = http.request(url, { method: method || "GET", headers: headers, body: reqBody });
    
    if (!resp.isOk) {
        let errMsg = resp.body;
        try { errMsg = JSON.parse(resp.body).error || errMsg; } catch(e){}
        throw new ScriptException("Worker Error [" + resp.code + "]: " + errMsg);
    }
    return JSON.parse(resp.body);
}

function mapVideo(v) {
    return new PlatformVideoDef()
        .setId(v.id)
        .setName(v.title)
        .setThumbnails([new Thumbnails(v.thumbnail || "", 0)])
        .setDuration(v.duration || 0)
        .setAuthor(new PlatformAuthorLink(v.author.id, v.author.name, v.author.url, v.author.thumbnail || "", v.author.subscribers || 0))
        .setUrl(v.url)
        .setUploadDate(0)
        .setViewCount(0);
}

// =====================================
// Búsqueda
// =====================================
source.getHome = function() {
    return source.search(""); // Se puede reemplazar por alguna query por defecto
};

source.search = function(query) {
    return new WorkerVideoPager(query);
};

class WorkerVideoPager extends VideoPager {
    constructor(query) {
        super(1, true);
        this.query = query || "tendencias";
    }
    nextPage() {
        const data = doFetch("/search?q=" + encodeURIComponent(this.query) + "&page=" + this.page, "GET");
        this.results = data.results.map(mapVideo);
        this.hasMore = data.hasMore;
        this.page++;
        return this;
    }
}

// =====================================
// Detalles del Video
// =====================================
source.isVideoDetailsUrl = function(url) {
    return url.indexOf("ok.ru/video") > 0 || url.indexOf("ok.ru/videoembed") > 0;
};

source.getVideoDetails = function(url) {
    const match = url.match(/ok\.ru\/(?:video|videoembed)\/(\d+)/i);
    if (!match) throw new ScriptException("URL de video no válida");
    const id = match[1];

    // Preservar los parámetros de autor si vienen en la URL
    let extra = "";
    let an = url.match(/[?&]an=([^&#]+)/); if (an) extra += "&an=" + encodeURIComponent(decodeURIComponent(an[1]));
    let au = url.match(/[?&]au=([^&#]+)/); if (au) extra += "&au=" + encodeURIComponent(decodeURIComponent(au[1]));
    let ap = url.match(/[?&]ap=([^&#]+)/); if (ap) extra += "&ap=" + encodeURIComponent(decodeURIComponent(ap[1]));

    const data = doFetch("/video?id=" + id + extra, "GET");

    const details = new PlatformVideoDetails()
        .setId(data.id)
        .setName(data.title)
        .setThumbnails([new Thumbnails(data.poster || "", 0)])
        .setDuration(data.duration || 0)
        .setAuthor(new PlatformAuthorLink(data.author.id, data.author.name, data.author.url, data.author.thumbnail || "", data.author.subscribers || 0))
        .setDescription(data.description || "")
        .setUrl(url);

    if (data.external) {
        throw new ScriptException("El video está alojado de forma externa en " + data.external.plugin + ":\n" + data.external.url);
    }

    const sources = [];
    if (data.hls && data.hls.length > 0) {
        sources.push(new HLSSource({ url: data.hls[0], name: "HLS" }));
    }
    if (data.mp4 && data.mp4.length > 0) {
        data.mp4.forEach(function(m) {
            sources.push(new VideoUrlSource({ url: m.url, name: m.label || "MP4" }));
        });
    }

    details.video = new VideoSourceDescriptor(sources);
    return details;
};

// =====================================
// Canales
// =====================================
source.isChannelUrl = function(url) {
    return url.indexOf("ok.ru/profile") > 0 || url.indexOf("ok.ru/group") > 0 || url.indexOf("ok.ru/__author") > 0;
};

source.getChannel = function(url) {
    const data = doFetch("/channel", "POST", { url: url });
    return new PlatformChannelDef()
        .setId(data.channel.id)
        .setName(data.channel.name)
        .setImageUrl(data.channel.thumbnail || "")
        .setDescription(data.channel.description || "")
        .setUrl(data.channel.url);
};

source.getChannelContents = function(url) {
    return new WorkerChannelPager(url, null);
};

class WorkerChannelPager extends VideoPager {
    constructor(url, token) {
        super(1, true);
        this.url = url;
        this.token = token;
    }
    nextPage() {
        const data = doFetch("/channel", "POST", { url: this.url, token: this.token });
        this.results = data.videos.map(mapVideo);
        this.hasMore = data.hasMore;
        this.token = data.token;
        return this;
    }
}
