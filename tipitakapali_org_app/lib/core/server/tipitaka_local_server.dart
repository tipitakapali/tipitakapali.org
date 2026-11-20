import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;

import '../../features/downloads/download_controller.dart';
import 'dpd_family_templates.dart';
import 'tipitaka_web_api.dart';
import '../storage/web_local_storage_store.dart';

/// Local loopback HTTP server (`shelf`) serving the static `tipitakapali.org`
/// web bundle alongside `/api/...` routes backed by downloaded SQLite DBs.
class TipitakaLocalServer {
  static final Uri defaultAiUpstreamBaseUri = Uri.parse(
    'https://api.tipitakapali.org',
  );

  final TipitakaWebApi api;
  final int preferredPort;
  final Directory? explicitWebRootDir;
  final Future<String> Function()? resolveDbDirectoryPath;
  final Uri aiUpstreamBaseUri;

  HttpServer? _server;
  Directory? _webRootDir;
  bool _starting = false;
  Future<Uri>? _startFuture;

  TipitakaLocalServer({
    required this.api,
    this.preferredPort = 8899,
    this.explicitWebRootDir,
    this.resolveDbDirectoryPath,
    Uri? aiUpstreamBaseUri,
  }) : aiUpstreamBaseUri = aiUpstreamBaseUri ?? defaultAiUpstreamBaseUri;

  bool get isRunning => _server != null;
  int? get port => _server?.port;
  Uri? get baseUri =>
      _server != null ? Uri.parse('http://127.0.0.1:${_server!.port}/') : null;

  Future<Uri> ensureStarted() {
    if (_server != null) return Future.value(baseUri!);
    if (_starting && _startFuture != null) return _startFuture!;
    _starting = true;
    _startFuture = _startInternal().whenComplete(() {
      _starting = false;
    });
    return _startFuture!;
  }

  Future<Uri> _startInternal() async {
    if (api.dbDirectoryPath.isEmpty && resolveDbDirectoryPath != null) {
      final resolved = await resolveDbDirectoryPath!();
      if (resolved.isNotEmpty) {
        api.updateDbDirectory(resolved);
      }
    }
    _webRootDir ??= await _prepareWebRoot();
    final handler = const Pipeline()
        .addMiddleware(_corsMiddleware)
        .addHandler(_handleRequest);

    try {
      _server = await shelf_io.serve(
        handler,
        InternetAddress.loopbackIPv4,
        preferredPort,
      );
    } on SocketException {
      // Fallback to an ephemeral port if preferredPort is occupied.
      _server = await shelf_io.serve(
        handler,
        InternetAddress.loopbackIPv4,
        0,
      );
    }
    return baseUri!;
  }

  Future<void> restart() async {
    await stop();
    await ensureStarted();
  }

  Future<void> stop() async {
    final s = _server;
    _server = null;
    _startFuture = null;
    if (s != null) {
      await s.close(force: true);
    }
  }

  Future<void> dispose() async {
    await stop();
    api.close();
  }

  Future<Directory> _prepareWebRoot() async {
    if (explicitWebRootDir != null) {
      return explicitWebRootDir!;
    }
    final supportDir = await getApplicationSupportDirectory();
    final targetDir = Directory(p.join(supportDir.path, 'web_root'));
    final stampFile = File(p.join(targetDir.path, '.web_bundle_stamp'));

    final zipByteData = await rootBundle.load('assets/web.zip');
    final zipBytes = zipByteData.buffer.asUint8List(
      zipByteData.offsetInBytes,
      zipByteData.lengthInBytes,
    );
    final stamp = sha256.convert(zipBytes).toString();

    if (targetDir.existsSync() &&
        stampFile.existsSync() &&
        stampFile.readAsStringSync().trim() == stamp &&
        File(p.join(targetDir.path, 'index.html')).existsSync()) {
      return targetDir;
    }

    if (targetDir.existsSync()) {
      await targetDir.delete(recursive: true);
    }
    await targetDir.create(recursive: true);

    await compute(_extractWebZipInIsolate, (
      bytes: zipBytes,
      targetPath: targetDir.path,
    ));
    await stampFile.writeAsString(stamp);
    return targetDir;
  }

  static void _extractWebZipInIsolate(
    ({List<int> bytes, String targetPath}) args,
  ) {
    final archive = ZipDecoder().decodeBytes(args.bytes);
    final rootCanonical = p.normalize(args.targetPath);
    for (final entry in archive) {
      if (!entry.isFile) continue;
      final normalized = p.normalize(p.join(rootCanonical, entry.name));
      if (normalized != rootCanonical &&
          !p.isWithin(rootCanonical, normalized)) {
        continue;
      }
      final outFile = File(normalized);
      outFile.parent.createSync(recursive: true);
      outFile.writeAsBytesSync(entry.content as List<int>);
    }
  }

  static Middleware get _corsMiddleware {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    return (Handler inner) {
      return (Request request) async {
        if (request.method == 'OPTIONS') {
          return Response.ok('', headers: headers);
        }
        final response = await inner(request);
        return response.change(headers: headers);
      };
    };
  }

  Future<Response> _handleRequest(Request request) async {
    final segments = request.url.pathSegments;
    if (segments.isNotEmpty && segments.first == 'api') {
      return _handleApiRequest(request, segments);
    }
    final accept = request.headers['accept'] ?? '';
    if (_prefersMarkdownAccept(accept)) {
      final mdResp = await _serveMarkdownForAgents(request, segments);
      if (mdResp != null) return mdResp;
    }
    return _serveStaticFile(segments);
  }

  static bool _prefersMarkdownAccept(String acceptHeader) {
    final lower = acceptHeader.toLowerCase();
    if (!lower.contains('text/markdown') && !lower.contains('text/x-markdown')) {
      return false;
    }
    var mdQ = -1.0;
    var htmlQ = -1.0;
    for (final part in lower.split(',')) {
      final segs = part
          .split(';')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      if (segs.isEmpty) continue;
      final mediaType = segs.first;
      var q = 1.0;
      for (var i = 1; i < segs.length; i++) {
        if (segs[i].startsWith('q=')) {
          q = double.tryParse(segs[i].substring(2).trim()) ?? 1.0;
        }
      }
      if (mediaType == 'text/markdown' || mediaType == 'text/x-markdown') {
        if (q > mdQ) mdQ = q;
      } else if (mediaType == 'text/html' ||
          mediaType == 'application/xhtml+xml') {
        if (q > htmlQ) htmlQ = q;
      }
    }
    if (mdQ <= 0) return false;
    if (htmlQ < 0) return true;
    return mdQ >= htmlQ;
  }

  Future<Response?> _serveMarkdownForAgents(
    Request request,
    List<String> rawSegments,
  ) async {
    final rootDir = _webRootDir;
    if (rootDir == null || !rootDir.existsSync()) return null;
    final rootCanonical = p.normalize(rootDir.path);
    final relSegments = rawSegments.where((s) => s.isNotEmpty).toList();
    if (relSegments.isNotEmpty) {
      final last = relSegments.last.toLowerCase();
      if (last.endsWith('.js') ||
          last.endsWith('.css') ||
          last.endsWith('.json') ||
          last.endsWith('.xml') ||
          last.endsWith('.png') ||
          last.endsWith('.svg') ||
          last.endsWith('.ico') ||
          last.endsWith('.woff2') ||
          last.endsWith('.ttf') ||
          last.endsWith('.zip')) {
        return null;
      }
    }

    String? mdFileRel;
    if (relSegments.isEmpty ||
        (relSegments.length == 1 &&
            (relSegments.first == 'index' ||
                relSegments.first == 'index.html'))) {
      mdFileRel = 'llms.txt';
    } else if (relSegments.length == 1 &&
        (relSegments.first == 'privacy_policy' ||
            relSegments.first == 'privacy_policy.html' ||
            relSegments.first == 'privacy_policy.md')) {
      mdFileRel = 'privacy_policy.md';
    } else if (relSegments.length == 1 &&
        (relSegments.first == 'terms_of_service' ||
            relSegments.first == 'terms_of_service.html' ||
            relSegments.first == 'terms_of_service.md')) {
      mdFileRel = 'terms_of_service.md';
    } else if (relSegments.length == 1 && relSegments.first.endsWith('.md')) {
      mdFileRel = relSegments.first;
    } else {
      mdFileRel = 'llms-full.txt';
    }

    final candidate = File(p.normalize(p.join(rootCanonical, mdFileRel)));
    final fallback = File(p.normalize(p.join(rootCanonical, 'llms.txt')));
    final target = candidate.existsSync()
        ? candidate
        : (fallback.existsSync() ? fallback : null);
    if (target == null) return null;

    final bytes = await target.readAsBytes();
    final tokens = (bytes.length / 4).ceil().clamp(1, 1000000);
    return Response.ok(
      bytes,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Vary': 'Accept',
        'x-markdown-tokens': tokens.toString(),
        'Content-Signal': 'ai-train=yes, search=yes, ai-input=yes',
        'Cache-Control': 'public, max-age=3600',
      },
    );
  }

  Future<Response> _handleApiRequest(
    Request request,
    List<String> segments,
  ) async {
    final query = request.url.queryParameters;

    // GET /api/health
    if (segments.length == 2 && segments[1] == 'health') {
      return _toShelfResponse(api.health(), noCache: true);
    }

    // GET /api/tree
    if (segments.length == 2 && segments[1] == 'tree') {
      return _toShelfResponse(api.getTree());
    }

    // GET /api/books
    if (segments.length == 2 && segments[1] == 'books') {
      return _toShelfResponse(api.getBooks());
    }

    // GET /api/mat
    if (segments.length == 2 && segments[1] == 'mat') {
      return _toShelfResponse(api.getMatList());
    }

    // GET /api/translations
    if (segments.length == 2 && segments[1] == 'translations') {
      return _toShelfResponse(api.getAvailableTranslations(), noCache: true);
    }

    // GET /api/paragraphs
    if (segments.length == 2 && segments[1] == 'paragraphs') {
      return _toShelfResponse(api.getParagraphs(query));
    }

    // GET /api/paragraph/:guid
    if (segments.length == 3 && segments[1] == 'paragraph') {
      return _toShelfResponse(
        api.getParagraphByGuid(Uri.decodeComponent(segments[2])),
      );
    }

    // GET /api/translation/guid/:guid
    if (segments.length == 4 &&
        segments[1] == 'translation' &&
        segments[2] == 'guid') {
      return _toShelfResponse(
        api.getGuidTranslation(
          Uri.decodeComponent(segments[3]),
          query['lang'] ?? query['langs'] ?? 'all',
        ),
        noCache: true,
      );
    }

    // Search API: /api/search/databases & /api/search
    if (segments.length == 3 &&
        segments[1] == 'search' &&
        segments[2] == 'databases') {
      return _toShelfResponse(api.getSearchDatabases(), noCache: true);
    }
    if (segments.length == 2 && segments[1] == 'search') {
      return _toShelfResponse(api.search(query), noCache: true);
    }

    // Dictionary API: /api/dict/lookup & /api/dict/inf
    if (segments.length == 3 && segments[1] == 'dict') {
      final params = await _extractBodyOrQueryParams(request, query);
      if (segments[2] == 'lookup') {
        final rawWord = params['w'] ?? params['word'] ?? params['q'] ?? '';
        final dictType = params['dict'] ?? params['dictionary'] ?? 'all';
        final langs = params['langs'] ?? params['lang'];
        final resp = await api.lookupDict(
          rawWord,
          dictType: dictType,
          langs: langs,
        );
        return _toShelfResponse(resp, noCache: true);
      }
      if (segments[2] == 'inf') {
        final q = params['w'] ?? params['id'] ?? params['word'] ?? '';
        return _toShelfResponse(api.lookupInflection(q), noCache: true);
      }
    }

    // Linked definitions contextual preview: /api/links/preview & /api/links/previews
    if (segments.length == 3 &&
        segments[1] == 'links' &&
        segments[2] == 'preview') {
      return _toShelfResponse(
        await api.getLinkedPreview(query),
        noCache: true,
      );
    }
    if (segments.length == 3 &&
        segments[1] == 'links' &&
        segments[2] == 'previews') {
      final raw = await request.readAsString();
      var decoded = <String, dynamic>{};
      if (raw.trim().isNotEmpty) {
        try {
          final obj = jsonDecode(raw);
          if (obj is Map<String, dynamic>) decoded = obj;
        } catch (_) {}
      }
      return _toShelfResponse(
        await api.getLinkedPreviewsBatch(decoded),
        noCache: true,
      );
    }

    // Legacy HTML endpoints: /api/{dpd,pts,abd,psd,sans,inf}
    if (segments.length == 2 &&
        const {'dpd', 'pts', 'abd', 'psd', 'sans', 'inf'}.contains(segments[1])) {
      final params = await _extractBodyOrQueryParams(request, query);
      final w = params['w'] ?? '';
      if (segments[1] == 'inf') {
        final inf = api.lookupInflection(w);
        final map = inf.body as Map<String, dynamic>?;
        return Response.ok(
          map?['html']?.toString() ?? '',
          headers: {'Content-Type': 'text/html; charset=utf-8'},
        );
      }
      final resp = await api.lookupDict(w, dictType: segments[1]);
      final map = resp.body as Map<String, dynamic>?;
      final listKey = segments[1] == 'dpd' ? 'dpd' : 'results';
      final entries = (map?[listKey] as List<dynamic>?) ?? const [];
      final html = entries
          .whereType<Map<String, dynamic>>()
          .map((e) => e['html']?.toString() ?? '')
          .join('\n\n');
      return Response.ok(
        html,
        headers: {'Content-Type': 'text/html; charset=utf-8'},
      );
    }

    // Book routes: /api/book/:code/...
    if (segments.length >= 3 && segments[1] == 'book') {
      final code = segments[2];
      if (segments.length == 3) {
        return _toShelfResponse(api.getBook(code, query));
      }
      if (segments.length == 4) {
        switch (segments[3]) {
          case 'toc':
            return _toShelfResponse(api.getToc(code));
          case 'mat':
            return _toShelfResponse(api.getBookMat(code));
          case 'mat_jump':
            return _toShelfResponse(
              api.getMatJump(
                code,
                query['para'],
                query['chapter'] != null ? int.tryParse(query['chapter']!) : null,
              ),
            );
          case 'pali_sentences':
          case 'pali_sentences.json':
            return _toShelfResponse(api.getPaliSentences(code), noCache: true);
          case 'translation':
            final chap =
                int.tryParse(query['chapter'] ?? query['chapterIndex'] ?? '0') ??
                    0;
            return _toShelfResponse(
              api.getBookTranslation(code, chap, query),
              noCache: true,
            );
        }
      }
      if (segments.length == 5 && segments[3] == 'chapter') {
        final chapIdx = int.tryParse(segments[4]);
        if (chapIdx != null) {
          return _toShelfResponse(api.getChapter(code, chapIdx));
        }
      }
      if (segments.length == 6 &&
          segments[3] == 'chapter' &&
          segments[5] == 'translation') {
        final chapIdx = int.tryParse(segments[4]);
        if (chapIdx != null) {
          return _toShelfResponse(
            api.getBookTranslation(code, chapIdx, query),
            noCache: true,
          );
        }
      }
      if (segments.length == 6 &&
          segments[3] == 'chapter' &&
          segments[5] == 'links') {
        final chapIdx = int.tryParse(segments[4]);
        if (chapIdx != null) {
          return _toShelfResponse(
            await api.getChapterLinks(code, chapIdx),
          );
        }
      }
    }

    // Ani AI & Citation routes: /api/ai/...
    if (segments.length >= 3 && segments[1] == 'ai') {
      return _handleAiRequest(request, segments, query);
    }

    return Response.notFound(
      jsonEncode({'error': 'API route not found: /${segments.join('/')}'}),
      headers: {'Content-Type': 'application/json; charset=utf-8'},
    );
  }

  Future<Response> _handleAiRequest(
    Request request,
    List<String> segments,
    Map<String, String> query,
  ) async {
    final rawBody =
        request.method == 'POST' ? await request.readAsString() : null;

    // Talk to tipitakapali.org online first for AI features; fall back to
    // local SQLite offline handlers only if unreachable or upstream fails.
    final onlineResponse = await _proxyAiOnline(
      request.method,
      request.url,
      rawBody,
      request.headers['content-type'],
    );
    if (onlineResponse != null) {
      return onlineResponse;
    }

    switch (segments[2]) {
      case 'tools':
        return _toShelfResponse(api.getAiTools());
      case 'books':
        return _toShelfResponse(api.getAiBooks());
      case 'paragraph_content':
        final startParam = query['start'] ?? query['para_start'];
        final endParam = query['end'] ?? query['para_end'] ?? startParam;
        return _toShelfResponse(
          api.getAiParagraphContent({
            ...query,
            'para_start': ?startParam,
            'para_end': ?endParam,
          }),
          noCache: true,
        );
      case 'paragraph_content_batch':
        final body = _decodeJsonMap(rawBody);
        return _toShelfResponse(
          await api.executeAiTool('get_paragraph_content_batch', body),
          noCache: true,
        );
      case 'sentences':
        return _toShelfResponse(api.getAiSentences(query), noCache: true);
      case 'dictionary':
        return _toShelfResponse(
          await api.executeAiTool('get_dictionary', {
            'word': query['w'] ?? query['word'] ?? '',
          }),
          noCache: true,
        );
      case 'commentaries':
      case 'commentary_link':
        return _toShelfResponse(
          await api.executeAiTool('get_commentaries', {
            'book_code': query['book'] ?? query['book_code'] ?? '',
            'chapter_index': query['chapter'] ?? query['chapter_index'] ?? '0',
            if ((query['para'] ?? query['para_num']) != null)
              'para_num': query['para'] ?? query['para_num'],
            if ((query['idx'] ?? query['para_index']) != null)
              'para_index': query['idx'] ?? query['para_index'],
          }),
          noCache: true,
        );
      case 'tool-call':
        final body = _decodeJsonMap(rawBody);
        final name = (body['name'] ?? body['tool'] ?? '').toString().trim();
        if (name.isEmpty) {
          return _toShelfResponse(
            const ApiResponse({'success': false, 'error': 'Missing tool name'}),
            noCache: true,
          );
        }
        final rawArgs = body['args'];
        final args = rawArgs is Map
            ? Map<String, dynamic>.from(rawArgs)
            : <String, dynamic>{};
        return _toShelfResponse(
          await api.executeAiTool(name, args),
          noCache: true,
        );
      default:
        return Response.notFound(
          jsonEncode({'error': 'API route not found: /${segments.join('/')}'}),
          headers: {'Content-Type': 'application/json; charset=utf-8'},
        );
    }
  }

  Future<Response?> _proxyAiOnline(
    String method,
    Uri requestUrl,
    String? rawBody,
    String? contentType,
  ) async {
    final targetPath = requestUrl.path.startsWith('/')
        ? requestUrl.path.substring(1)
        : requestUrl.path;
    final upstreamUri = aiUpstreamBaseUri.resolve(
      requestUrl.hasQuery ? '$targetPath?${requestUrl.query}' : targetPath,
    );
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 6);
    try {
      final req = await client
          .openUrl(method, upstreamUri)
          .timeout(const Duration(seconds: 8));
      req.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (rawBody != null && rawBody.isNotEmpty) {
        req.headers.set(
          HttpHeaders.contentTypeHeader,
          contentType ?? 'application/json; charset=utf-8',
        );
        req.write(rawBody);
      }
      final resp = await req.close().timeout(const Duration(seconds: 12));
      final bytes = await resp
          .fold<List<int>>(<int>[], (acc, chunk) => acc..addAll(chunk))
          .timeout(const Duration(seconds: 12));
      if (resp.statusCode >= 500) {
        return null;
      }
      final respContentType =
          resp.headers.contentType?.toString() ??
          'application/json; charset=utf-8';
      return Response(
        resp.statusCode,
        body: bytes,
        headers: {
          'Content-Type': respContentType,
          'Cache-Control': 'no-store, max-age=0',
        },
      );
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  Map<String, dynamic> _decodeJsonMap(String? raw) {
    if (raw == null || raw.trim().isEmpty) return const {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {}
    return const {};
  }

  Future<Map<String, String>> _extractBodyOrQueryParams(
    Request request,
    Map<String, String> query,
  ) async {
    if (request.method != 'POST') return query;
    try {
      final raw = await request.readAsString();
      if (raw.trim().isEmpty) return query;
      final ct = request.headers['content-type']?.toLowerCase() ?? '';
      if (ct.contains('application/x-www-form-urlencoded')) {
        return {...query, ...Uri.splitQueryString(raw)};
      }
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        return {
          ...query,
          for (final e in decoded.entries)
            if (e.value != null) e.key.toString(): e.value.toString(),
        };
      }
    } catch (_) {}
    return query;
  }

  Response _toShelfResponse(ApiResponse resp, {bool noCache = false}) {
    final headers = <String, String>{
      'Content-Type': resp.contentType,
      'Cache-Control':
          noCache ? 'no-store, max-age=0' : 'public, max-age=3600',
    };
    final encoded = jsonEncode(resp.body);
    return Response(resp.statusCode, body: encoded, headers: headers);
  }

  Future<Response> _serveStaticFile(List<String> rawSegments) async {
    final rootDir = _webRootDir;
    if (rootDir == null || !rootDir.existsSync()) {
      return Response.internalServerError(body: 'Web bundle not prepared');
    }
    final rootCanonical = p.normalize(rootDir.path);
    final relSegments = rawSegments.where((s) => s.isNotEmpty).toList();

    File? resolveCandidate(String relPath) {
      final full = p.normalize(p.join(rootCanonical, relPath));
      if (full != rootCanonical && !p.isWithin(rootCanonical, full)) {
        return null;
      }
      final file = File(full);
      return file.existsSync() ? file : null;
    }

    File? target;
    if (relSegments.isEmpty) {
      target = resolveCandidate('index.html');
    } else {
      final joined = p.joinAll(relSegments);
      target = resolveCandidate(joined) ??
          resolveCandidate('$joined.html') ??
          resolveCandidate(p.join(joined, 'index.html'));

      // Client-side SPA fallback for `/book/*`, `/translation/*`, and `/chapter/*` deep-links.
      if (target == null &&
          (relSegments.first == 'book' ||
              relSegments.first == 'translation' ||
              relSegments.first == 'chapter' ||
              !relSegments.last.contains('.'))) {
        target = resolveCandidate('index.html');
      }
    }

    if (target == null) {
      final notFound = resolveCandidate('404.html');
      if (notFound != null) {
        return Response.notFound(
          await notFound.readAsBytes(),
          headers: {'Content-Type': 'text/html; charset=utf-8'},
        );
      }
      return Response.notFound('Not Found');
    }

    final bytes = await target.readAsBytes();
    final mime = _mimeTypeForPath(target.path);
    final isImmutable = target.path.contains('${p.separator}_next${p.separator}static${p.separator}');
    return Response.ok(
      bytes,
      headers: {
        'Content-Type': mime,
        'Cache-Control': isImmutable
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
      },
    );
  }

  static String _mimeTypeForPath(String filePath) {
    final ext = p.extension(filePath).toLowerCase();
    switch (ext) {
      case '.html':
        return 'text/html; charset=utf-8';
      case '.js':
      case '.mjs':
        return 'application/javascript; charset=utf-8';
      case '.css':
        return 'text/css; charset=utf-8';
      case '.json':
      case '.webmanifest':
        return 'application/json; charset=utf-8';
      case '.svg':
        return 'image/svg+xml';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.ico':
        return 'image/x-icon';
      case '.woff2':
        return 'font/woff2';
      case '.woff':
        return 'font/woff';
      case '.ttf':
        return 'font/ttf';
      case '.txt':
        return 'text/plain; charset=utf-8';
      case '.md':
        return 'text/markdown; charset=utf-8';
      case '.xml':
        return 'application/xml; charset=utf-8';
      case '.zip':
        return 'application/zip';
      default:
        return 'application/octet-stream';
    }
  }
}

final dpdFamilyTemplatesProvider = Provider<DpdFamilyTemplates>((ref) {
  return DpdFamilyTemplates();
});

final tipitakaLocalServerProvider = Provider<TipitakaLocalServer>((ref) {
  final storage = ref.watch(dbStorageServiceProvider);
  unawaited(ref.read(webLocalStorageStoreProvider).ensureLoaded());
  final initialDir = ref.read(downloadControllerProvider).dbDirectoryPath ??
      storage.overrideDirectory?.path ??
      '';
  final templates = ref.watch(dpdFamilyTemplatesProvider);
  final api = TipitakaWebApi(
    dbDirectoryPath: initialDir,
    dpdFamilyTemplates: templates,
  );
  final server = TipitakaLocalServer(
    api: api,
    resolveDbDirectoryPath: () async {
      final dir = await storage.getDatabaseDirectory();
      return dir.path;
    },
  );

  // Sync SQLite DB directory & invalidate cached DB handles whenever downloads change.
  ref.listen<DownloadCenterState>(downloadControllerProvider, (prev, next) {
    final nextDir = next.dbDirectoryPath;
    if (nextDir != null && nextDir.isNotEmpty) {
      if (nextDir != api.dbDirectoryPath) {
        api.updateDbDirectory(nextDir);
        return;
      }
    }
    final prevInstalled = prev?.installedDbs.keys.toSet() ?? const {};
    final nextInstalled = next.installedDbs.keys.toSet();
    if (!setEquals(prevInstalled, nextInstalled) ||
        (prev?.hasActiveTransfers == true && !next.hasActiveTransfers)) {
      api.invalidateDatabases();
    }
  });

  ref.onDispose(() {
    server.dispose();
  });

  return server;
});
