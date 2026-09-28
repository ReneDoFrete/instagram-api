const express = require('express');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3000;

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/140.0.0.0 Safari/537.36';

app.use(cors());
app.use(express.json());


// ============================================================
// NORMALIZA URL DO INSTAGRAM
// ============================================================

function normalizarUrlInstagram(url) {
    const texto = String(url || '').trim();

    const match = texto.match(
        /https?:\/\/(?:www\.)?instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i
    );

    if (!match) {
        throw new Error('URL do Instagram inválida.');
    }

    let tipo = match[1].toLowerCase();
    const shortcode = match[2];

    // Normaliza "reels" para "reel"
    if (tipo === 'reels') {
        tipo = 'reel';
    }

    return {
        shortcode,
        tipo,
        originalUrl: texto,
        fetchUrl: `https://www.instagram.com/${tipo}/${shortcode}/`
    };
}


// ============================================================
// LIMPA URL
// ============================================================

function limparUrl(url) {
    if (!url) {
        return null;
    }

    return String(url)
        .replace(/\\u0026/gi, '&')
        .replace(/\\u002F/gi, '/')
        .replace(/\\u003D/gi, '=')
        .replace(/\\u0025/gi, '%')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
}


// ============================================================
// DESESCAPA TEXTO
// ============================================================

function desescaparTexto(texto) {
    if (!texto) {
        return texto;
    }

    return String(texto)
        .replace(/\\"/g, '"')
        .replace(/\\u0026/gi, '&')
        .replace(/\\u002F/gi, '/')
        .replace(/\\u003D/gi, '=')
        .replace(/\\u0025/gi, '%')
        .replace(/\\\//g, '/');
}


// ============================================================
// EXTRAI JSON BALANCEADO
// ============================================================

function extrairJsonBalanceado(texto, inicio) {
    if (
        inicio < 0 ||
        inicio >= texto.length
    ) {
        return null;
    }

    const abertura = texto[inicio];

    let fechamento;

    if (abertura === '{') {
        fechamento = '}';
    } else if (abertura === '[') {
        fechamento = ']';
    } else {
        return null;
    }

    let profundidade = 0;
    let dentroString = false;
    let escapado = false;

    for (let i = inicio; i < texto.length; i++) {
        const char = texto[i];

        if (dentroString) {
            if (escapado) {
                escapado = false;
                continue;
            }

            if (char === '\\') {
                escapado = true;
                continue;
            }

            if (char === '"') {
                dentroString = false;
            }

            continue;
        }

        if (char === '"') {
            dentroString = true;
            continue;
        }

        if (char === abertura) {
            profundidade++;
            continue;
        }

        if (char === fechamento) {
            profundidade--;

            if (profundidade === 0) {
                const trecho = texto.slice(
                    inicio,
                    i + 1
                );

                try {
                    return {
                        valor: JSON.parse(trecho),
                        texto: trecho,
                        inicio,
                        fim: i + 1
                    };
                } catch {
                    return null;
                }
            }
        }
    }

    return null;
}


// ============================================================
// EXTRAI VALOR DEPOIS DE UMA CHAVE
// ============================================================

function extrairValorDepoisDaChave(
    texto,
    chave,
    posInicial = 0
) {
    const posChave = texto.indexOf(
        chave,
        posInicial
    );

    if (posChave === -1) {
        return null;
    }

    let pos = posChave + chave.length;

    while (
        pos < texto.length &&
        texto[pos] !== ':'
    ) {
        pos++;
    }

    if (pos >= texto.length) {
        return null;
    }

    pos++;

    while (
        pos < texto.length &&
        /\s/.test(texto[pos])
    ) {
        pos++;
    }

    if (
        texto[pos] !== '[' &&
        texto[pos] !== '{'
    ) {
        return null;
    }

    return extrairJsonBalanceado(
        texto,
        pos
    );
}


// ============================================================
// PROCURA OBJETO PELO SHORTCODE
// ============================================================

function procurarObjetoShortcode(
    obj,
    shortcode,
    visitados = new Set()
) {
    if (
        obj === null ||
        typeof obj !== 'object'
    ) {
        return null;
    }

    if (visitados.has(obj)) {
        return null;
    }

    visitados.add(obj);

    if (
        obj.code === shortcode ||
        obj.shortcode === shortcode
    ) {
        return obj;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            const encontrado = procurarObjetoShortcode(
                item,
                shortcode,
                visitados
            );

            if (encontrado) {
                return encontrado;
            }
        }

        return null;
    }

    for (const valor of Object.values(obj)) {
        if (
            valor &&
            typeof valor === 'object'
        ) {
            const encontrado = procurarObjetoShortcode(
                valor,
                shortcode,
                visitados
            );

            if (encontrado) {
                return encontrado;
            }
        }
    }

    return null;
}


// ============================================================
// PROCURA NOS SCRIPTS
// ============================================================

function procurarNosScripts(
    html,
    shortcode
) {
    const regex =
        /<script[^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (match = regex.exec(html)) !== null
    ) {
        const conteudo = match[1];

        if (!conteudo.includes(shortcode)) {
            continue;
        }

        const texto = conteudo.trim();

        if (
            !texto.startsWith('{') &&
            !texto.startsWith('[')
        ) {
            continue;
        }

        try {
            const json = JSON.parse(texto);

            const encontrado = procurarObjetoShortcode(
                json,
                shortcode
            );

            if (encontrado) {
                return encontrado;
            }

        } catch {
            // Continua procurando
        }
    }

    return null;
}


// ============================================================
// PROCURA OBJETO PRÓXIMO AO SHORTCODE
// ============================================================

function procurarObjetoProximoShortcode(
    html,
    shortcode
) {
    const marcadores = [
        `"code":"${shortcode}"`,
        `"shortcode":"${shortcode}"`,
        `\\"code\\":\\"${shortcode}\\"`,
        `\\"shortcode\\":\\"${shortcode}\\"`
    ];

    for (const marcador of marcadores) {
        let pos = html.indexOf(marcador);

        while (pos !== -1) {
            const inicioBusca = Math.max(
                0,
                pos - 300000
            );

            const fimBusca = Math.min(
                html.length,
                pos + 500000
            );

            let trecho = html.slice(
                inicioBusca,
                fimBusca
            );

            if (marcador.includes('\\"')) {
                trecho = desescaparTexto(trecho);
            }

            const internos = [
                `"code":"${shortcode}"`,
                `"shortcode":"${shortcode}"`
            ];

            for (const interno of internos) {
                const local = trecho.indexOf(
                    interno
                );

                if (local === -1) {
                    continue;
                }

                for (
                    let i = local;
                    i >= 0;
                    i--
                ) {
                    if (trecho[i] !== '{') {
                        continue;
                    }

                    const resultado =
                        extrairJsonBalanceado(
                            trecho,
                            i
                        );

                    if (!resultado) {
                        continue;
                    }

                    const encontrado =
                        procurarObjetoShortcode(
                            resultado.valor,
                            shortcode
                        );

                    if (encontrado) {
                        return encontrado;
                    }
                }
            }

            pos = html.indexOf(
                marcador,
                pos + marcador.length
            );
        }
    }

    return null;
}


// ============================================================
// PROCURA CAROUSEL_MEDIA
// ============================================================

function procurarCarouselMedia(
    html,
    shortcode
) {
    const posShortcode =
        html.indexOf(shortcode);

    if (posShortcode === -1) {
        return null;
    }

    const inicio = Math.max(
        0,
        posShortcode - 300000
    );

    const fim = Math.min(
        html.length,
        posShortcode + 700000
    );

    let trecho = html.slice(
        inicio,
        fim
    );

    // Normal
    let posCarousel =
        trecho.indexOf('"carousel_media"');

    if (posCarousel !== -1) {
        const resultado =
            extrairValorDepoisDaChave(
                trecho,
                '"carousel_media"',
                posCarousel
            );

        if (
            resultado &&
            Array.isArray(resultado.valor) &&
            resultado.valor.length > 0
        ) {
            return resultado.valor;
        }
    }

    // Desescapado
    trecho = desescaparTexto(trecho);

    posCarousel =
        trecho.indexOf('"carousel_media"');

    if (posCarousel !== -1) {
        const resultado =
            extrairValorDepoisDaChave(
                trecho,
                '"carousel_media"',
                posCarousel
            );

        if (
            resultado &&
            Array.isArray(resultado.valor) &&
            resultado.valor.length > 0
        ) {
            return resultado.valor;
        }
    }

    return null;
}


// ============================================================
// PROCURA VIDEO_VERSIONS
// ============================================================

function procurarVideoVersions(
    html,
    shortcode
) {
    const posShortcode =
        html.indexOf(shortcode);

    if (posShortcode === -1) {
        return null;
    }

    const inicio = Math.max(
        0,
        posShortcode - 200000
    );

    const fim = Math.min(
        html.length,
        posShortcode + 600000
    );

    let trecho = html.slice(
        inicio,
        fim
    );

    // Normal
    let posVideo =
        trecho.indexOf('"video_versions"');

    if (posVideo !== -1) {
        const resultado =
            extrairValorDepoisDaChave(
                trecho,
                '"video_versions"',
                posVideo
            );

        if (
            resultado &&
            Array.isArray(resultado.valor) &&
            resultado.valor.length > 0
        ) {
            return resultado.valor;
        }
    }

    // Desescapado
    trecho = desescaparTexto(trecho);

    posVideo =
        trecho.indexOf('"video_versions"');

    if (posVideo !== -1) {
        const resultado =
            extrairValorDepoisDaChave(
                trecho,
                '"video_versions"',
                posVideo
            );

        if (
            resultado &&
            Array.isArray(resultado.valor) &&
            resultado.valor.length > 0
        ) {
            return resultado.valor;
        }
    }

    return null;
}


// ============================================================
// ESCOLHE MELHOR VIDEO_VERSION
// ============================================================

function escolherVideoVersion(videos) {
    if (
        !Array.isArray(videos) ||
        videos.length === 0
    ) {
        return null;
    }

    const validos = videos
        .filter(video => video?.url)
        .map(video => ({
            url: limparUrl(video.url),

            width: Number(
                video.width || 0
            ),

            height: Number(
                video.height || 0
            ),

            type: video.type ?? null
        }));

    if (validos.length === 0) {
        return null;
    }

    validos.sort((a, b) => {
        const areaA =
            a.width * a.height;

        const areaB =
            b.width * b.height;

        return areaB - areaA;
    });

    return validos[0];
}


// ============================================================
// ESCOLHE MELHOR IMAGEM
// ============================================================

function escolherImagem(item) {
    const candidatos =
        item
            ?.image_versions2
            ?.candidates;

    if (
        !Array.isArray(candidatos) ||
        candidatos.length === 0
    ) {
        return null;
    }

    const validos = candidatos
        .filter(imagem => imagem?.url)
        .map(imagem => ({
            url: limparUrl(imagem.url),

            width: Number(
                imagem.width || 0
            ),

            height: Number(
                imagem.height || 0
            )
        }));

    if (validos.length === 0) {
        return null;
    }

    validos.sort((a, b) => {
        const areaA =
            a.width * a.height;

        const areaB =
            b.width * b.height;

        return areaB - areaA;
    });

    return validos[0];
}


// ============================================================
// CONVERTE ITEM
// ============================================================

function converterItem(item) {
    if (!item) {
        return null;
    }

    // Vídeo
    if (
        Array.isArray(item.video_versions) &&
        item.video_versions.length > 0
    ) {
        const video =
            escolherVideoVersion(
                item.video_versions
            );

        if (video) {
            return {
                type: 'video',
                url: video.url,
                width: video.width,
                height: video.height
            };
        }
    }

    // Imagem
    const imagem = escolherImagem(item);

    if (imagem) {
        return {
            type: 'image',
            url: imagem.url,
            width: imagem.width,
            height: imagem.height
        };
    }

    return null;
}


// ============================================================
// EXTRAI MÍDIAS DO OBJETO
// ============================================================

function extrairMidiasDoObjeto(item) {
    if (!item) {
        return [];
    }

    // Carrossel
    if (
        Array.isArray(item.carousel_media) &&
        item.carousel_media.length > 0
    ) {
        const resultado = [];

        for (
            let i = 0;
            i < item.carousel_media.length;
            i++
        ) {
            const media =
                converterItem(
                    item.carousel_media[i]
                );

            if (!media) {
                continue;
            }

            resultado.push({
                index: i + 1,
                ...media
            });
        }

        return resultado;
    }

    // Mídia única
    const media = converterItem(item);

    if (!media) {
        return [];
    }

    return [
        {
            index: 1,
            ...media
        }
    ];
}


// ============================================================
// FALLBACK MP4
// ============================================================

function extrairMp4s(html) {
    const texto =
        desescaparTexto(html);

    const regex =
        /https?:\/\/[^"'<>\\\s]+\.mp4(?:\?[^"'<>\\\s]*)?/gi;

    const urls = [];
    const vistos = new Set();

    let match;

    while (
        (match = regex.exec(texto)) !== null
    ) {
        const url =
            limparUrl(match[0]);

        if (!url) {
            continue;
        }

        if (vistos.has(url)) {
            continue;
        }

        vistos.add(url);
        urls.push(url);
    }

    return urls;
}


// ============================================================
// DECODIFICA EFG
// ============================================================

function decodificarEfg(url) {
    try {
        const objetoUrl =
            new URL(url);

        const efg =
            objetoUrl
                .searchParams
                .get('efg');

        if (!efg) {
            return null;
        }

        let base64 = efg
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        while (base64.length % 4) {
            base64 += '=';
        }

        const texto =
            Buffer
                .from(
                    base64,
                    'base64'
                )
                .toString('utf8');

        return JSON.parse(texto);

    } catch {
        return null;
    }
}


// ============================================================
// ANALISA MP4
// ============================================================

function analisarMp4(url) {
    const efg =
        decodificarEfg(url);

    const tag =
        String(
            efg?.vencode_tag ||
            efg?.xpv_encode_tag ||
            ''
        ).toLowerCase();

    const bitrate =
        Number(
            efg?.bitrate || 0
        );

    const duration =
        Number(
            efg?.duration_s || 0
        );

    const pareceAudio =
        tag.includes('audio') ||
        tag.includes('heaac') ||
        tag.includes('aac');

    return {
        url,
        bitrate,
        duration,
        tag,
        pareceAudio,
        efg
    };
}


// ============================================================
// ESCOLHE MELHOR MP4
// ============================================================

function escolherMelhorMp4(urls) {
    if (
        !Array.isArray(urls) ||
        urls.length === 0
    ) {
        return null;
    }

    const analisados =
        urls.map(analisarMp4);

    let videos =
        analisados.filter(
            item => !item.pareceAudio
        );

    if (videos.length === 0) {
        videos = analisados;
    }

    videos.sort(
        (a, b) =>
            b.bitrate - a.bitrate
    );

    return videos[0] || null;
}


// ============================================================
// BUSCA PÁGINA DO INSTAGRAM
// ============================================================

async function buscarPagina(url) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            15000
        );

    const inicio = Date.now();

    try {
        const response =
            await fetch(
                url,
                {
                    method: 'GET',

                    headers: {
                        'User-Agent':
                            USER_AGENT,

                        'Accept':
                            'text/html,application/xhtml+xml,' +
                            'application/xml;q=0.9,image/avif,' +
                            'image/webp,*/*;q=0.8',

                        'Accept-Language':
                            'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',

                        'Cache-Control':
                            'no-cache',

                        'Pragma':
                            'no-cache',

                        'Upgrade-Insecure-Requests':
                            '1',

                        'Sec-Fetch-Dest':
                            'document',

                        'Sec-Fetch-Mode':
                            'navigate',

                        'Sec-Fetch-Site':
                            'none',

                        'Sec-Fetch-User':
                            '?1'
                    },

                    redirect: 'follow',
                    signal: controller.signal
                }
            );

        const html =
            await response.text();

        return {
            status: response.status,

            contentType:
                response.headers.get(
                    'content-type'
                ),

            finalUrl: response.url,

            html,

            elapsed:
                Date.now() - inicio
        };

    } finally {
        clearTimeout(timeout);
    }
}


// ============================================================
// EXTRATOR PRINCIPAL
// ============================================================

async function extrairInstagram(url) {
    const inicioTotal = Date.now();

    const dadosUrl =
        normalizarUrlInstagram(url);

    console.log('');
    console.log(
        `[INSTAGRAM] ${dadosUrl.fetchUrl}`
    );

    const resposta =
        await buscarPagina(
            dadosUrl.fetchUrl
        );

    console.log(
        `[INSTAGRAM] HTTP ${resposta.status} ` +
        `(${resposta.elapsed}ms)`
    );

    console.log(
        `[INSTAGRAM] HTML: ${resposta.html.length} bytes`
    );

    if (
        resposta.status < 200 ||
        resposta.status >= 400
    ) {
        throw new Error(
            'Instagram retornou HTTP ' +
            resposta.status
        );
    }

    if (
        !resposta.html.includes(
            dadosUrl.shortcode
        )
    ) {
        throw new Error(
            'O shortcode não foi encontrado ' +
            'na resposta do Instagram.'
        );
    }

    let objeto =
        procurarNosScripts(
            resposta.html,
            dadosUrl.shortcode
        );

    let metodo = null;

    if (objeto) {
        metodo = 'script_json';
    }

    // --------------------------------------------------------
    // OBJETO PRÓXIMO AO SHORTCODE
    // --------------------------------------------------------

    if (!objeto) {
        objeto =
            procurarObjetoProximoShortcode(
                resposta.html,
                dadosUrl.shortcode
            );

        if (objeto) {
            metodo = 'shortcode_object';
        }
    }

    // --------------------------------------------------------
    // OBJETO COMPLETO
    // --------------------------------------------------------

    if (objeto) {
        const medias =
            extrairMidiasDoObjeto(objeto);

        if (medias.length > 0) {
            return {
                ok: true,
                platform: 'instagram',
                shortcode: dadosUrl.shortcode,
                method: metodo,
                count: medias.length,
                media: medias,
                processingTime:
                    Date.now() - inicioTotal
            };
        }
    }

    // --------------------------------------------------------
    // CARROSSEL
    // --------------------------------------------------------

    const carousel =
        procurarCarouselMedia(
            resposta.html,
            dadosUrl.shortcode
        );

    if (
        carousel &&
        carousel.length > 0
    ) {
        const medias = [];

        for (
            let i = 0;
            i < carousel.length;
            i++
        ) {
            const media =
                converterItem(
                    carousel[i]
                );

            if (!media) {
                continue;
            }

            medias.push({
                index: i + 1,
                ...media
            });
        }

        if (medias.length > 0) {
            return {
                ok: true,
                platform: 'instagram',
                shortcode: dadosUrl.shortcode,
                method: 'carousel_media',
                count: medias.length,
                media: medias,
                processingTime:
                    Date.now() - inicioTotal
            };
        }
    }

    // --------------------------------------------------------
    // VIDEO_VERSIONS
    // --------------------------------------------------------

    const videoVersions =
        procurarVideoVersions(
            resposta.html,
            dadosUrl.shortcode
        );

    if (
        videoVersions &&
        videoVersions.length > 0
    ) {
        const melhor =
            escolherVideoVersion(
                videoVersions
            );

        if (melhor) {
            const medias = [
                {
                    index: 1,
                    type: 'video',
                    url: melhor.url,
                    width: melhor.width,
                    height: melhor.height
                }
            ];

            return {
                ok: true,
                platform: 'instagram',
                shortcode: dadosUrl.shortcode,
                method: 'video_versions',
                count: medias.length,
                media: medias,
                processingTime:
                    Date.now() - inicioTotal
            };
        }
    }

    // --------------------------------------------------------
    // FALLBACK MP4
    // --------------------------------------------------------

    const mp4s =
        extrairMp4s(
            resposta.html
        );

    if (mp4s.length > 0) {
        const melhor =
            escolherMelhorMp4(mp4s);

        if (melhor) {
            const medias = [
                {
                    index: 1,
                    type: 'video',
                    url: melhor.url,
                    bitrate:
                        melhor.bitrate || null,
                    duration:
                        melhor.duration || null
                }
            ];

            return {
                ok: true,
                platform: 'instagram',
                shortcode: dadosUrl.shortcode,
                method: 'mp4_fallback',
                count: medias.length,
                media: medias,
                processingTime:
                    Date.now() - inicioTotal
            };
        }
    }

    throw new Error(
        'Não foi possível extrair nenhuma mídia deste post.'
    );
}


// ============================================================
// HOME
// ============================================================

app.get('/', (req, res) => {
    res.json({
        ok: true,
        name: 'Instagram Backup API',
        status: 'online',
        usage:
            '/instagram?url=https://www.instagram.com/reel/SHORTCODE/'
    });
});


// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        status: 'online',
        timestamp:
            new Date().toISOString()
    });
});


// ============================================================
// API INSTAGRAM
// ============================================================

app.get('/instagram', async (req, res) => {
    const inicio = Date.now();

    try {
        const url =
            String(
                req.query.url || ''
            ).trim();

        if (!url) {
            return res.status(400).json({
                ok: false,
                error:
                    'Parâmetro "url" é obrigatório.',
                example:
                    '/instagram?url=https://www.instagram.com/reel/SHORTCODE/'
            });
        }

        const resultado =
            await extrairInstagram(url);

        console.log(
            `[API] OK ${resultado.shortcode} | ` +
            `${resultado.count} mídia(s) | ` +
            `${resultado.processingTime}ms`
        );

        return res.json(resultado);

    } catch (error) {
        const processingTime =
            Date.now() - inicio;

        console.error(
            '[API] ERRO:',
            error?.message || error
        );

        if (
            error?.name === 'AbortError'
        ) {
            return res.status(504).json({
                ok: false,
                error:
                    'Timeout ao acessar Instagram.',
                processingTime
            });
        }

        if (
            String(
                error?.message || ''
            ).includes(
                'URL do Instagram inválida'
            )
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    error.message,
                processingTime
            });
        }

        return res.status(500).json({
            ok: false,
            error:
                error?.message ||
                'Erro interno.',
            processingTime
        });
    }
});

// ============================================================
// HOME TASKS
// ============================================================

app.get('/home/tasks', (req, res) => {
    console.log('');
    console.log('[HOME/TASKS] CHAMADO');
    console.log('[HOME/TASKS] URL:', req.originalUrl);
    console.log('[HOME/TASKS] QUERY:', req.query);
    console.log('[HOME/TASKS] USER-AGENT:', req.get('user-agent') || '');
    console.log('[HOME/TASKS] IP:', req.headers['x-forwarded-for'] || req.ip);

    return res.json({
          "code": 0,
          "data": [
            {
              "id": "6953fae2679c227b803fd886",
              "platform": 2,
              "task_icon": "/admin-web/task/86003271e16a8a8dcedda88690ec17af.webp",
              "one_icon": "/admin-web/task/5246aa2d0ea6521e3577eb89f508eed5.webp",
              "two_icon": "/admin-web/task/ef81011f179b13c67751bfa43fe7e2c1.json",
              "three_icon": "/admin-web/task/1e3aec970846365a20568f74950812e5.webp",
              "title": "task.title.share_group",
              "points_icon": "/admin-web/task/8b45aad0e1b016817a6968dd2862e491.webp",
              "reward": 5,
              "tags": [
                "task.tag.easy"
              ],
              "task_taken": 0,
              "task_limit": 0,
              "deeplink": "rn://shareLink",
              "task_type": 10,
              "is_start": 1
            },
            {
                "id": "693fc97b85010d82c4d8eb2a",
                "platform": 2,
                "task_icon": "/admin-web/task/86003271e16a8a8dcedda88690ec17af.webp",
                "one_icon": "/admin-web/task/5246aa2d0ea6521e3577eb89f508eed5.webp",
                "two_icon": "/admin-web/task/ef81011f179b13c67751bfa43fe7e2c1.json",
                "three_icon": "/admin-web/task/1e3aec970846365a20568f74950812e5.webp",
                "title": "task.title.whatsapp_auto",
                "points_icon": "/admin-web/task/8b45aad0e1b016817a6968dd2862e491.webp",
                "reward": 60,
                "tags": [
                    "task.tag.easy"
                ],
                "task_taken": 0,
                "task_limit": 0,
                "deeplink": "",
                "task_type": 7,
                "is_start": 1
            },
            {
                "id": "693fc9f985010d82c4d8eb2c",
                "platform": 2,
                "task_icon": "/admin-web/task/86003271e16a8a8dcedda88690ec17af.webp",
                "one_icon": "/admin-web/task/5246aa2d0ea6521e3577eb89f508eed5.webp",
                "two_icon": "/admin-web/task/ef81011f179b13c67751bfa43fe7e2c1.json",
                "three_icon": "/admin-web/task/1e3aec970846365a20568f74950812e5.webp",
                "title": "task.title.whatsapp",
                "points_icon": "/admin-web/task/8b45aad0e1b016817a6968dd2862e491.webp",
                "reward": 60,
                "tags": [
                    "task.tag.easy"
                ],
                "task_taken": 0,
                "task_limit": 0,
                "deeplink": "",
                "task_type": 3,
                "is_start": 1
            }
        ],
        "msg": "success"
    });
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
    res.status(404).json({
        ok: false,
        error: 'Rota não encontrada.'
    });
});


// ============================================================
// INICIA SERVIDOR
// ============================================================

// ============================================================
// LOCAL + VERCEL
// ============================================================

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('');
        console.log('======================================');
        console.log(' INSTAGRAM BACKUP API');
        console.log('======================================');
        console.log('');
        console.log(`Servidor: http://localhost:${PORT}`);
        console.log(`Health:   http://localhost:${PORT}/health`);
        console.log(`API:      http://localhost:${PORT}/instagram?url=URL`);
        console.log('');
    });
}

module.exports = app;
