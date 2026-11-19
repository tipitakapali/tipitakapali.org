import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/server/tipitaka_local_server.dart';
import '../../core/storage/web_local_storage_store.dart';
import '../../core/utils/formatters.dart';
import '../../core/utils/pali_script_converter.dart';
import '../downloads/database_manager_screen.dart';
import '../downloads/database_updates_dialog.dart';
import '../downloads/download_controller.dart';

/// Optional builder override so headless widget tests can inspect the started
/// loopback [Uri] without instantiating a platform WebView.
typedef TipitakaWebViewBuilder = Widget Function(
  BuildContext context,
  Uri serverUri,
);

final tipitakaWebViewBuilderProvider = Provider<TipitakaWebViewBuilder?>((ref) {
  return null;
});

/// Hosts the offline `tipitakapali.org` web application served from
/// [TipitakaLocalServer] inside an [InAppWebView], matching `tpo_flutter`'s
/// full-screen reader architecture while keeping onboarding & database management
/// in Flutter.
class TipitakaWebViewScreen extends ConsumerStatefulWidget {
  final TipitakaWebViewBuilder? webViewBuilder;

  const TipitakaWebViewScreen({super.key, this.webViewBuilder});

  @override
  ConsumerState<TipitakaWebViewScreen> createState() =>
      _TipitakaWebViewScreenState();
}

class _TipitakaWebViewScreenState extends ConsumerState<TipitakaWebViewScreen>
    with WidgetsBindingObserver {
  InAppWebViewController? _webViewController;
  Uri? _serverUri;
  String? _error;
  bool _starting = true;
  bool _canGoBack = false;
  double _progress = 0;
  Color? _topBarColor;
  Color? _bottomBarColor;
  bool _updateDialogShown = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _startServer();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _maybeShowUpdatesDialog();
    });
  }

  Future<void> _maybeShowUpdatesDialog() async {
    if (_updateDialogShown || !mounted) return;
    final state = ref.read(downloadControllerProvider);
    if (state.availableUpdates.isEmpty || state.updateDialogDismissed) return;
    _updateDialogShown = true;
    final updated = await DatabaseUpdatesDialog.show(context);
    if (updated == true && mounted) {
      final api = ref.read(tipitakaLocalServerProvider).api;
      api.invalidateDatabases();
      unawaited(api.warmUpIndexes());
      await _webViewController?.reload();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _ensureServerAlive();
    } else if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _flushWebSession();
    }
  }

  void _flushWebSession() {
    final controller = _webViewController;
    if (controller == null) return;
    unawaited(
      controller
          .evaluateJavascript(
            source:
                'if (typeof window.__tpoFlushSession === "function") { window.__tpoFlushSession(); }',
          )
          .catchError((_) => null),
    );
  }

  Future<void> _ensureServerAlive() async {
    final server = ref.read(tipitakaLocalServerProvider);
    if (server.isRunning && _serverUri != null) return;
    await _startServer();
    if (mounted && _serverUri != null && _webViewController != null) {
      await _webViewController!.loadUrl(
        urlRequest: URLRequest(url: WebUri(_serverUri!.toString())),
      );
    }
  }

  Future<void> _startServer() async {
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      final server = ref.read(tipitakaLocalServerProvider);
      final uri = await server.ensureStarted();
      if (!mounted) return;
      setState(() {
        _serverUri = uri;
        _starting = false;
      });
      unawaited(server.api.warmUpIndexes());
      unawaited(
        ref
            .read(downloadControllerProvider.notifier)
            .ensureMissingFtsIndexed()
            .then((builtAny) {
              if (!mounted) return;
              ref.read(tipitakaLocalServerProvider).api.invalidateDatabases();
              if (builtAny) {
                _webViewController?.evaluateJavascript(
                  source:
                      'window.__tpoOnFtsUpdated && window.__tpoOnFtsUpdated();',
                );
              }
            }),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _starting = false;
      });
    }
  }

  Future<void> _updateBackState() async {
    final controller = _webViewController;
    if (controller == null) return;
    final canGoBack = await controller.canGoBack();
    if (!mounted || canGoBack == _canGoBack) return;
    setState(() {
      _canGoBack = canGoBack;
    });
  }

  Future<void> _openDatabaseManager() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const DatabaseManagerScreen()),
    );
    if (!mounted) return;
    final api = ref.read(tipitakaLocalServerProvider).api;
    api.invalidateDatabases();
    unawaited(api.warmUpIndexes());
    await _webViewController?.reload();
  }

  Future<bool> _handleLanguageDownloadRequest(
    String langCode,
    String? label, {
    bool isUpdate = false,
    bool enableOnComplete = true,
  }) async {
    if (!mounted) return false;
    final api = ref.read(tipitakaLocalServerProvider).api;
    if (isUpdate) {
      api.invalidateDatabases();
    }
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => LanguageDownloadDialog(
        langCode: langCode,
        label: label,
        isUpdate: isUpdate,
        enableOnComplete: enableOnComplete,
      ),
    );
    if (ok == true && mounted) {
      api.invalidateDatabases();
      unawaited(api.warmUpIndexes());
      final normalized = langCode.trim().toLowerCase();
      if (!isUpdate && enableOnComplete) {
        final settingsKey = translationCodeToSettingsKey[normalized];
        if (settingsKey != null) {
          await ref
              .read(webLocalStorageStoreProvider)
              .enableTranslationSetting(settingsKey);
        }
      }
      _notifyOfflineLangStateChanged();
      return true;
    }
    return false;
  }

  Future<bool> _handleLanguageDeleteRequest(String langCode) async {
    final normalized = langCode.trim().toLowerCase();
    if (normalized.isEmpty || normalized == 'pali') return false;
    final api = ref.read(tipitakaLocalServerProvider).api;
    api.invalidateDatabases();
    final ok = await ref
        .read(downloadControllerProvider.notifier)
        .deleteTranslationLanguage(normalized);
    if (ok && mounted) {
      final settingsKey = translationCodeToSettingsKey[normalized];
      if (settingsKey != null) {
        await ref
            .read(webLocalStorageStoreProvider)
            .disableTranslationSetting(settingsKey);
      }
      api.invalidateDatabases();
      _notifyOfflineLangStateChanged();
    }
    return ok;
  }

  Map<String, dynamic> _buildOfflineTranslationsStatePayload() {
    final dlState = ref.read(downloadControllerProvider);
    final transRe = RegExp(r'^translation_(.+)\.db$');
    final ftsRe = RegExp(r'^fts_translation_(.+)\.db$');
    final installedCodes = <String>[];
    final ftsCodes = <String>[];
    for (final name in dlState.installedDbs.keys) {
      final tm = transRe.firstMatch(name);
      if (tm != null) {
        installedCodes.add(tm.group(1)!);
        continue;
      }
      final fm = ftsRe.firstMatch(name);
      if (fm != null) {
        ftsCodes.add(fm.group(1)!);
      }
    }
    installedCodes.sort();
    ftsCodes.sort();

    final updates = <String, dynamic>{};
    for (final item in dlState.availableUpdates) {
      final m = transRe.firstMatch(item.asset.filename);
      if (m == null) continue;
      final code = m.group(1)!;
      updates[code] = {
        'version': item.asset.version,
        'updated': item.asset.updated,
        'installedVersion': item.installedVersion,
        'installedUpdated': item.installedUpdated,
        'zipSize': item.asset.zipSize,
        'dbSize': item.asset.dbSize,
      };
    }

    final catalog = <String, dynamic>{};
    final langs = dlState.manifest?.languages;
    if (langs != null) {
      for (final entry in langs.entries) {
        final db = entry.value.translationDb;
        final fts = entry.value.ftsDb;
        catalog[entry.key] = {
          'code': entry.key,
          'name': entry.value.name,
          'nativeName': entry.value.nativeName,
          'version': db.version,
          'updated': db.updated,
          'zipSize': db.zipSize,
          'dbSize': db.dbSize,
          'ftsZipSize': fts?.zipSize ?? 0,
          'ftsDbSize': fts?.dbSize ?? 0,
        };
      }
    }

    return {
      'installedCodes': installedCodes,
      'ftsCodes': ftsCodes,
      'updates': updates,
      'catalog': catalog,
      'hasPaliSentences':
          dlState.installedDbs.containsKey('pali_sentences.db') ||
          ref.read(tipitakaLocalServerProvider).api.hasPaliSentencesSupport(),
      'paliSentencesAsset': dlState.manifest?.core['pali_sentences'] != null
          ? {
              'zipSize': dlState.manifest!.core['pali_sentences']!.zipSize,
              'dbSize': dlState.manifest!.core['pali_sentences']!.dbSize,
            }
          : null,
      'fetchedLiveRelease': dlState.fetchedLiveRelease,
      'isFetchingManifest': dlState.isFetchingManifest,
      'hasCheckedUpdates': dlState.hasCheckedUpdates,
      'releaseWarning': dlState.releaseWarning,
    };
  }

  void _notifyOfflineLangStateChanged() {
    _webViewController?.evaluateJavascript(
      source:
          'window.__tpoOnOfflineLangStateChanged && window.__tpoOnOfflineLangStateChanged();'
          'window.__tpoOnFtsUpdated && window.__tpoOnFtsUpdated();'
          'try { window.dispatchEvent(new CustomEvent("tipitaka:fts-databases-changed")); } catch (_) {}',
    );
  }

  Future<bool> _handlePaliSentencesDownloadRequest() async {
    if (!mounted) return false;
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PaliSentencesDownloadDialog(),
    );
    if (ok == true && mounted) {
      ref.read(tipitakaLocalServerProvider).api.invalidateDatabases();
      return true;
    }
    return false;
  }

  void _updateSystemBarColorsFromJs(dynamic payload) {
    if (payload is! Map) return;
    int? asByte(Object? v) => (v as num?)?.toInt().clamp(0, 255);
    final topR = asByte(payload['topR']);
    final topG = asByte(payload['topG']);
    final topB = asByte(payload['topB']);
    final botR = asByte(payload['botR']);
    final botG = asByte(payload['botG']);
    final botB = asByte(payload['botB']);
    if (topR == null ||
        topG == null ||
        topB == null ||
        botR == null ||
        botG == null ||
        botB == null) {
      return;
    }
    final nextTop = Color.fromARGB(255, topR, topG, topB);
    final nextBot = Color.fromARGB(255, botR, botG, botB);
    if (!mounted || (nextTop == _topBarColor && nextBot == _bottomBarColor)) {
      return;
    }
    setState(() {
      _topBarColor = nextTop;
      _bottomBarColor = nextBot;
    });
    SystemChrome.setSystemUIOverlayStyle(_overlayStyleFor(nextTop, nextBot));
  }

  SystemUiOverlayStyle _overlayStyleFor(Color topColor, Color bottomColor) {
    final isDarkTop = topColor.computeLuminance() < 0.5;
    final isDarkBottom = bottomColor.computeLuminance() < 0.5;
    return SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarBrightness: isDarkTop ? Brightness.dark : Brightness.light,
      statusBarIconBrightness: isDarkTop ? Brightness.light : Brightness.dark,
      systemNavigationBarColor: bottomColor,
      systemNavigationBarDividerColor: bottomColor,
      systemNavigationBarIconBrightness: isDarkBottom
          ? Brightness.light
          : Brightness.dark,
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<bool>(
      downloadControllerProvider.select(
        (s) => s.availableUpdates.isNotEmpty && !s.updateDialogDismissed,
      ),
      (prev, shouldPrompt) {
        if (shouldPrompt && !_updateDialogShown) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _maybeShowUpdatesDialog();
          });
        }
      },
    );
    ref.listen<bool>(
      downloadControllerProvider.select(
        (s) => s.isBatchInstalling || s.isIndexingFts,
      ),
      (prev, active) {
        if (prev == true && !active) {
          final api = ref.read(tipitakaLocalServerProvider).api;
          api.invalidateDatabases();
          unawaited(api.warmUpIndexes());
          _webViewController?.evaluateJavascript(
            source: 'window.__tpoOnFtsUpdated && window.__tpoOnFtsUpdated();',
          );
        }
      },
    );
    final builder =
        widget.webViewBuilder ?? ref.watch(tipitakaWebViewBuilderProvider);
    final serverUri = _serverUri;
    final fallbackBg = Theme.of(context).scaffoldBackgroundColor;
    final topBarColor = _topBarColor ?? fallbackBg;
    final bottomBarColor = _bottomBarColor ?? fallbackBg;
    final overlayStyle = _overlayStyleFor(topBarColor, bottomBarColor);
    final viewPadding = MediaQuery.paddingOf(context);

    return PopScope(
      canPop: !_canGoBack,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final controller = _webViewController;
        if (controller != null && await controller.canGoBack()) {
          await controller.goBack();
          await _updateBackState();
        }
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: overlayStyle,
        child: Scaffold(
          backgroundColor: bottomBarColor,
          body: Column(
            children: [
              if (viewPadding.top > 0)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  color: topBarColor,
                  height: viewPadding.top,
                  width: double.infinity,
                ),
              Expanded(
                child: SafeArea(
                  top: false,
                  bottom: false,
                  child: MediaQuery.removePadding(
                    context: context,
                    removeTop: true,
                    removeBottom: true,
                    child: Stack(
                      children: [
                        if (_error != null)
                          _ErrorView(error: _error!, onRetry: _startServer)
                        else if (_starting || serverUri == null)
                          const _LoadingView()
                        else if (builder != null)
                          builder(context, serverUri)
                        else
                          _buildInAppWebView(serverUri),
                        if (_progress > 0 && _progress < 1)
                          Positioned(
                            top: 0,
                            left: 0,
                            right: 0,
                            child: LinearProgressIndicator(
                              value: _progress,
                              minHeight: 2,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              if (viewPadding.bottom > 0)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  color: bottomBarColor,
                  height: viewPadding.bottom,
                  width: double.infinity,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInAppWebView(Uri serverUri) {
    final localStorageStore = ref.read(webLocalStorageStoreProvider);
    if (!localStorageStore.isLoaded) {
      localStorageStore.ensureLoaded().then((_) {
        if (mounted) setState(() {});
      });
      return const SizedBox.shrink();
    }
    return _createInAppWebView(serverUri, localStorageStore);
  }

  Widget _createInAppWebView(
    Uri serverUri,
    WebLocalStorageStore localStorageStore,
  ) {
    final downloadState = ref.read(downloadControllerProvider);
    final onboardingLang = resolveInstalledOnboardingLanguage(downloadState);
    final lsPersistenceScript = buildLocalStoragePersistenceScript(
      localStorageStore.entries,
      bootToken: localStorageStore.bootToken,
    );
    final seedScript = buildOnboardingTranslationSeedScript(
      onboardingLang ??
          (downloadState.selectedLanguageCode ==
                  DownloadController.noLanguageCode
              ? DownloadController.noLanguageCode
              : null),
      paliScript: downloadState.selectedPaliScript,
    );
    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(serverUri.toString())),
      initialUserScripts: UnmodifiableListView<UserScript>([
        UserScript(
          source: lsPersistenceScript,
          injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
        ),
        if (seedScript.isNotEmpty)
          UserScript(
            source: seedScript,
            injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
          ),
        UserScript(
          source: _languageMenuBridgeScript,
          injectionTime: UserScriptInjectionTime.AT_DOCUMENT_END,
        ),
      ]),
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        domStorageEnabled: true,
        databaseEnabled: true,
        transparentBackground: true,
        useHybridComposition: true,
        allowsBackForwardNavigationGestures: true,
        mediaPlaybackRequiresUserGesture: false,
        supportZoom: true,
        builtInZoomControls: true,
        displayZoomControls: false,
        isInspectable: kDebugMode,
      ),
      onWebViewCreated: (controller) {
        _webViewController = controller;
        controller.addJavaScriptHandler(
          handlerName: 'syncLocalStorage',
          callback: (args) async {
            if (args.isNotEmpty) {
              await localStorageStore.applyOperation(args.first);
            }
            return {'ok': true};
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'syncSystemBars',
          callback: (args) async {
            if (args.isNotEmpty) {
              _updateSystemBarColorsFromJs(args.first);
            }
            return {'ok': true};
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'downloadLanguage',
          callback: (args) async {
            String code = '';
            String? label;
            var enableOnComplete = true;
            if (args.isNotEmpty && args.first is Map) {
              final map = args.first as Map;
              code = (map['code'] ?? '').toString().trim().toLowerCase();
              label = map['label']?.toString();
              if (map['enableOnComplete'] == false) {
                enableOnComplete = false;
              }
            } else if (args.isNotEmpty) {
              code = args.first.toString().trim().toLowerCase();
            }
            if (code.isEmpty) {
              return {'success': false};
            }
            final ok = await _handleLanguageDownloadRequest(
              code,
              label,
              enableOnComplete: enableOnComplete,
            );
            return {
              'success': ok,
              'code': code,
              'state': _buildOfflineTranslationsStatePayload(),
            };
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'updateTranslationLanguage',
          callback: (args) async {
            String code = '';
            String? label;
            if (args.isNotEmpty && args.first is Map) {
              final map = args.first as Map;
              code = (map['code'] ?? '').toString().trim().toLowerCase();
              label = map['label']?.toString();
            } else if (args.isNotEmpty) {
              code = args.first.toString().trim().toLowerCase();
            }
            if (code.isEmpty) {
              return {'success': false};
            }
            final ok = await _handleLanguageDownloadRequest(
              code,
              label,
              isUpdate: true,
            );
            return {
              'success': ok,
              'code': code,
              'state': _buildOfflineTranslationsStatePayload(),
            };
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'deleteTranslationLanguage',
          callback: (args) async {
            String code = '';
            if (args.isNotEmpty && args.first is Map) {
              code = (args.first['code'] ?? '').toString().trim().toLowerCase();
            } else if (args.isNotEmpty) {
              code = args.first.toString().trim().toLowerCase();
            }
            if (code.isEmpty) {
              return {'success': false};
            }
            final ok = await _handleLanguageDeleteRequest(code);
            return {
              'success': ok,
              'code': code,
              'state': _buildOfflineTranslationsStatePayload(),
            };
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'getOfflineTranslationsState',
          callback: (_) async => _buildOfflineTranslationsStatePayload(),
        );
        controller.addJavaScriptHandler(
          handlerName: 'checkTranslationUpdates',
          callback: (_) async {
            await ref
                .read(downloadControllerProvider.notifier)
                .checkForDatabaseUpdates();
            final payload = _buildOfflineTranslationsStatePayload();
            _notifyOfflineLangStateChanged();
            return payload;
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'downloadPaliSentences',
          callback: (_) async {
            final ok = await _handlePaliSentencesDownloadRequest();
            return {'success': ok};
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'openDatabaseManager',
          callback: (_) async {
            await _openDatabaseManager();
            return {'ok': true};
          },
        );
      },
      onLoadStop: (controller, _) async {
        await _updateBackState();
        await controller.evaluateJavascript(source: _languageMenuBridgeScript);
      },
      onUpdateVisitedHistory: (controller, _, _) async {
        await _updateBackState();
      },
      onProgressChanged: (_, progress) {
        if (!mounted) return;
        setState(() {
          _progress = progress / 100.0;
        });
      },
    );
  }
}

/// Confirmation and progress dialog shown when enabling an un-downloaded
/// translation language: presents database download size alongside the
/// AI-Assisted Translation Notice before downloading and indexing.
@visibleForTesting
class LanguageDownloadDialog extends ConsumerStatefulWidget {
  final String langCode;
  final String? label;
  final bool isUpdate;
  final bool enableOnComplete;

  const LanguageDownloadDialog({
    super.key,
    required this.langCode,
    this.label,
    this.isUpdate = false,
    this.enableOnComplete = true,
  });

  @override
  ConsumerState<LanguageDownloadDialog> createState() =>
      _LanguageDownloadDialogState();
}

class _LanguageDownloadDialogState
    extends ConsumerState<LanguageDownloadDialog> {
  bool _awaitingConfirmation = true;
  bool _running = false;
  String? _error;

  Future<void> _runDownloadAndIndex() async {
    if (!mounted) return;
    setState(() {
      _awaitingConfirmation = false;
      _running = true;
      _error = null;
    });
    final controller = ref.read(downloadControllerProvider.notifier);
    final ok = widget.isUpdate
        ? await controller.updateTranslationLanguage(widget.langCode)
        : await controller.downloadAndIndexLanguage(widget.langCode);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop(true);
    } else {
      final state = ref.read(downloadControllerProvider);
      final transferErr =
          state.transfers['translation_${widget.langCode}']?.error;
      setState(() {
        _running = false;
        _error =
            transferErr ??
            state.releaseWarning ??
            (widget.isUpdate
                ? 'Failed to update "${widget.langCode}".'
                : 'Failed to download or index "${widget.langCode}".');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final normalized = widget.langCode.trim().toLowerCase();
    final state = ref.watch(downloadControllerProvider);
    final asset = state.manifest?.languages[normalized]?.translationDb;
    final transfer = state.transfers['translation_$normalized'];
    final hasLabel = widget.label != null && widget.label!.trim().isNotEmpty;
    final displayName = hasLabel
        ? widget.label!.trim()
        : normalized.toUpperCase();

    if (_awaitingConfirmation) {
      final theme = Theme.of(context);
      final colorScheme = theme.colorScheme;
      final zipSize = asset?.zipSize ?? 0;
      final dbSize = asset?.dbSize ?? 0;
      final downloadLabel = zipSize > 0 ? formatBytes(zipSize) : null;
      final storageLabel = dbSize > 0 ? formatBytes(dbSize) : null;

      return AlertDialog(
        title: Text(
          widget.isUpdate
              ? 'Update $displayName'
              : widget.enableOnComplete
              ? 'Enable $displayName'
              : 'Download $displayName',
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colorScheme.surfaceContainerHighest.withValues(
                    alpha: 0.55,
                  ),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: colorScheme.outlineVariant.withValues(alpha: 0.6),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.download_for_offline_outlined,
                          size: 18,
                          color: colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            downloadLabel != null
                                ? 'Download size: $downloadLabel'
                                : 'Offline Translation Database',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      storageLabel != null
                          ? 'Database: translation_$normalized.db ($storageLabel uncompressed). Full-text search will also be indexed offline.'
                          : 'Database: translation_$normalized.db. Full-text search will also be indexed offline.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: Colors.amber.withValues(alpha: 0.35),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.warning_amber_rounded,
                          size: 18,
                          color: Colors.amber.shade700,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'AI-Assisted Translation Notice',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: Colors.amber.shade800,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'The translations provided here are part of an AI-Assisted Translation Project adapted from Epitaka (epitaka.org/about).',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Please Read with Discernment & Wisdom:',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '• Generated using artificial intelligence and may contain inaccuracies or mistakes.\n'
                      '• Not authoritative — treat as study aids rather than definitive renderings.\n'
                      '• Check against the original Pāḷi canonical text and consult venerable teacher commentaries when clarifying doctrinal nuance.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: _runDownloadAndIndex,
            child: Text(
              widget.isUpdate
                  ? 'Update Now'
                  : widget.enableOnComplete
                  ? 'Download & Enable'
                  : 'Download',
            ),
          ),
        ],
      );
    }

    final titleText = widget.isUpdate
        ? (hasLabel
              ? 'Updating $displayName'
              : 'Updating ${normalized.toUpperCase()} Translation')
        : (hasLabel
              ? 'Downloading $displayName'
              : 'Downloading ${normalized.toUpperCase()} Translation');

    final statusMessage =
        _error ??
        state.indexingMessage ??
        transfer?.message ??
        'Downloading translation_$normalized.db & indexing FTS5...';

    final progressValue = state.isIndexingFts
        ? null
        : (transfer != null && transfer.totalBytes > 0
              ? transfer.fraction
              : null);

    return AlertDialog(
      title: Text(titleText),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_running) ...[
            LinearProgressIndicator(value: progressValue),
            const SizedBox(height: 12),
          ],
          Text(
            statusMessage,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: _error != null
                  ? Theme.of(context).colorScheme.error
                  : null,
            ),
          ),
        ],
      ),
      actions: [
        if (!_running) ...[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: _runDownloadAndIndex,
            child: const Text('Retry'),
          ),
        ],
      ],
    );
  }
}

/// Modal dialog that asks the user to confirm downloading `pali_sentences.db`
/// (with its download and uncompressed sizes) when switching translation unit
/// to "As Sentence", then tracks download & extraction progress.
@visibleForTesting
class PaliSentencesDownloadDialog extends ConsumerStatefulWidget {
  const PaliSentencesDownloadDialog({super.key});

  @override
  ConsumerState<PaliSentencesDownloadDialog> createState() =>
      _PaliSentencesDownloadDialogState();
}

class _PaliSentencesDownloadDialogState
    extends ConsumerState<PaliSentencesDownloadDialog> {
  bool _awaitingConfirmation = true;
  bool _running = false;
  String? _error;

  Future<void> _runDownload() async {
    if (_running) return;
    setState(() {
      _awaitingConfirmation = false;
      _running = true;
      _error = null;
    });
    final ok = await ref
        .read(downloadControllerProvider.notifier)
        .downloadPaliSentences();
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop(true);
    } else {
      final state = ref.read(downloadControllerProvider);
      final transferErr = state.transfers['pali_sentences']?.error;
      setState(() {
        _running = false;
        _error =
            transferErr ??
            state.releaseWarning ??
            'Failed to download "pali_sentences.db".';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(downloadControllerProvider);
    final asset = state.manifest?.core['pali_sentences'];
    final transfer = state.transfers['pali_sentences'];

    if (_awaitingConfirmation) {
      final theme = Theme.of(context);
      final colorScheme = theme.colorScheme;
      final zipSize = asset?.zipSize ?? 0;
      final dbSize = asset?.dbSize ?? 0;
      final downloadLabel = zipSize > 0 ? formatBytes(zipSize) : null;
      final storageLabel = dbSize > 0 ? formatBytes(dbSize) : null;

      return AlertDialog(
        title: const Text('Enable Sentence-by-Sentence View'),
        content: SingleChildScrollView(
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colorScheme.surfaceContainerHighest.withValues(
                alpha: 0.55,
              ),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: colorScheme.outlineVariant.withValues(alpha: 0.6),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.download_for_offline_outlined,
                      size: 18,
                      color: colorScheme.primary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        downloadLabel != null
                            ? 'Download size: $downloadLabel'
                            : 'Pāḷi Sentences Database',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  storageLabel != null
                      ? 'Database: pali_sentences.db ($storageLabel uncompressed). Required to align each Pāḷi sentence with its corresponding translation sentence.'
                      : 'Database: pali_sentences.db. Required to align each Pāḷi sentence with its corresponding translation sentence.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: _runDownload,
            child: Text(
              downloadLabel != null ? 'Download ($downloadLabel)' : 'Download',
            ),
          ),
        ],
      );
    }

    final statusMessage =
        _error ?? transfer?.message ?? 'Downloading pali_sentences.db...';
    final progressValue = transfer != null && transfer.totalBytes > 0
        ? transfer.fraction
        : null;

    return AlertDialog(
      title: const Text('Downloading Pāḷi Sentences'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_running) ...[
            LinearProgressIndicator(value: progressValue),
            const SizedBox(height: 12),
          ],
          Text(
            statusMessage,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: _error != null
                  ? Theme.of(context).colorScheme.error
                  : null,
            ),
          ),
        ],
      ),
      actions: [
        if (!_running) ...[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(onPressed: _runDownload, child: const Text('Retry')),
        ],
      ],
    );
  }
}

class _LoadingView extends StatelessWidget {
  const _LoadingView();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text('Starting offline Tipitakapali.org...'),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;

  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              size: 48,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 12),
            Text(
              'Failed to start offline server',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              error,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Maps offline translation DB language codes to the web app's
/// `tipitaka_advanced_settings_v7.translations` keys.
const Map<String, String> translationCodeToSettingsKey = <String, String>{
  'en': 'english',
  'vi': 'vietnamese',
  'my': 'myanmar',
  'my_nissaya': 'my_nissaya',
  'si': 'sinhala',
  'zh': 'chinese',
  'km': 'khmer',
  'th': 'thai',
  'lo': 'lao',
  'ta': 'tamil',
  'hi': 'hindi',
  'de': 'german',
  'ja': 'japanese',
  'ko': 'korean',
  'id': 'indonesian',
  'ne': 'nepali',
  'be': 'bengali',
  'es': 'spanish',
  'fr': 'french',
  'pt': 'portuguese',
  'ru': 'russian',
  'cs': 'czech',
  'mr': 'marathi',
};

/// Returns the normalized onboarding translation language code when the user
/// chose a translation language during onboarding and its database is installed.
@visibleForTesting
String? resolveInstalledOnboardingLanguage(DownloadCenterState state) {
  final code = state.selectedLanguageCode.trim().toLowerCase();
  if (code.isEmpty || code == DownloadController.noLanguageCode) {
    return null;
  }
  if (!state.installedDbs.containsKey('translation_$code.db')) {
    return null;
  }
  return translationCodeToSettingsKey.containsKey(code) ? code : null;
}

/// Builds an `AT_DOCUMENT_START` script that applies the onboarding translation
/// language and/or Pāḷi display script once in `tipitaka_advanced_settings_v7`
/// before React mounts, while preserving future manual changes in the web
/// Language Menu.
@visibleForTesting
String buildOnboardingTranslationSeedScript(
  String? langCode, {
  String? paliScript,
}) {
  final code = langCode?.trim().toLowerCase();
  final isExplicitNone = code == DownloadController.noLanguageCode;
  final settingsKey = (code != null && code.isNotEmpty && !isExplicitNone)
      ? translationCodeToSettingsKey[code]
      : null;
  final rawScript = paliScript?.trim().toLowerCase();
  final targetScript = (rawScript != null && rawScript.isNotEmpty)
      ? PaliScript.fromId(rawScript).webId
      : null;

  if (settingsKey == null && !isExplicitNone && targetScript == null) return '';

  return '''
(function() {
  try {
    var SEED_KEY = 'tpo_onboarding_seeded_lang_v2';
    var SEED_SCRIPT_KEY = 'tpo_onboarding_seeded_script_v2';
    var SETTINGS_KEY = 'tipitaka_advanced_settings_v7';
    var targetCode = ${jsonEncode((settingsKey != null || isExplicitNone) ? code : null)};
    var targetKey = ${jsonEncode(settingsKey)};
    var isExplicitNone = ${jsonEncode(isExplicitNone)};
    var targetScript = ${jsonEncode(targetScript)};

    var needLangSeed = !!(targetCode && (targetKey || isExplicitNone) && localStorage.getItem(SEED_KEY) !== targetCode);
    var needScriptSeed = !!(targetScript && localStorage.getItem(SEED_SCRIPT_KEY) !== targetScript);
    if (!needLangSeed && !needScriptSeed) return;

    var raw = localStorage.getItem(SETTINGS_KEY);
    var parsed = {};
    if (raw) {
      try {
        var dec = JSON.parse(raw);
        if (dec && typeof dec === 'object') parsed = dec;
      } catch (_) {}
    }
    var changed = false;

    if (needLangSeed) {
      var translations = (parsed.translations && typeof parsed.translations === 'object')
          ? parsed.translations
          : {};
      if (translations.pali === undefined) {
        translations.pali = true;
      }
      if (isExplicitNone) {
        translations.english = false;
      } else {
        translations[targetKey] = true;
      }
      parsed.translations = translations;
      changed = true;
    }

    if (needScriptSeed) {
      if (!parsed.paliScript || targetScript !== 'roman') {
        parsed.paliScript = targetScript;
        changed = true;
      }
    }

    if (changed) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
    }
    if (needLangSeed) {
      localStorage.setItem(SEED_KEY, targetCode);
    }
    if (needScriptSeed) {
      localStorage.setItem(SEED_SCRIPT_KEY, targetScript);
    }
  } catch (_) {}
})();
''';
}

String _encodeJsJson(Object? value) =>
    jsonEncode(value)
        .replaceAll('\u2028', r'\u2028')
        .replaceAll('\u2029', r'\u2029');

/// Builds an `AT_DOCUMENT_START` script that restores the natively persisted
/// `localStorage` snapshot before React mounts (once per browser session,
/// tracked via `window.name` so in-session reloads keep live changes such as
/// Settings Reset), and hooks `Storage.prototype` mutations so every write,
/// removal, or clear is immediately mirrored to Flutter.
@visibleForTesting
String buildLocalStoragePersistenceScript(
  Map<String, String> entries, {
  required String bootToken,
}) {
  final encodedEntries = _encodeJsJson(entries);
  final encodedBootMarker = _encodeJsJson('__tpoLsBoot=$bootToken');
  return '''
(function() {
  try {
    var BOOT_MARKER = $encodedBootMarker;
    var snapshot = $encodedEntries;
    var proto = window.Storage && window.Storage.prototype;
    if (!proto) return;

    var origSetItem = proto.setItem;
    var origRemoveItem = proto.removeItem;
    var origClear = proto.clear;

    var isSameSessionReload = (window.name === BOOT_MARKER);
    window.__tpoLsIsSameSessionReload = isSameSessionReload;

    if (!isSameSessionReload) {
      window.name = BOOT_MARKER;
      if (snapshot && typeof snapshot === 'object') {
        var keys = Object.keys(snapshot);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          origSetItem.call(window.localStorage, k, String(snapshot[k]));
        }
      }
    }

    if (window.__tpoLsHooked) return;
    window.__tpoLsHooked = true;

    window.__tpoLsPending = window.__tpoLsPending || [];

    var canCallNative = function() {
      return !!(window.flutter_inappwebview &&
        typeof window.flutter_inappwebview.callHandler === 'function');
    };

    var flushPending = function() {
      if (!canCallNative()) return;
      if (window.__tpoLsPending && window.__tpoLsPending.length > 0) {
        var batch = window.__tpoLsPending.splice(0, window.__tpoLsPending.length);
        try {
          window.flutter_inappwebview.callHandler('syncLocalStorage', {
            op: 'batch',
            ops: batch
          });
        } catch (_) {}
      }
    };

    var sendOp = function(opObj) {
      if (canCallNative()) {
        flushPending();
        try {
          window.flutter_inappwebview.callHandler('syncLocalStorage', opObj);
          return;
        } catch (_) {}
      }
      window.__tpoLsPending.push(opObj);
    };

    window.addEventListener('flutterInAppWebViewPlatformReady', flushPending);

    var isLocalStorageInstance = function(target) {
      try {
        return target === window.localStorage;
      } catch (_) {
        return false;
      }
    };

    proto.setItem = function(key, value) {
      origSetItem.call(this, key, value);
      if (isLocalStorageInstance(this)) {
        sendOp({ op: 'set', key: String(key), value: String(value) });
      }
    };

    proto.removeItem = function(key) {
      origRemoveItem.call(this, key);
      if (isLocalStorageInstance(this)) {
        sendOp({ op: 'remove', key: String(key) });
      }
    };

    proto.clear = function() {
      origClear.call(this);
      if (isLocalStorageInstance(this)) {
        sendOp({ op: 'clear' });
      }
    };

    window.__tpoSyncLocalStorageBridge = function() {
      if (!canCallNative()) return;
      flushPending();
      try {
        var all = {};
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k !== null) {
            all[k] = window.localStorage.getItem(k);
          }
        }
        window.flutter_inappwebview.callHandler('syncLocalStorage', {
          op: window.__tpoLsIsSameSessionReload ? 'replaceAll' : 'mergeMissing',
          entries: all
        });
      } catch (_) {}
    };
  } catch (_) {}
})();
''';
}

const String _languageMenuBridgeScript = r'''
(function() {
  try {
    if (typeof window.__tpoSyncLocalStorageBridge === 'function') {
      window.__tpoSyncLocalStorageBridge();
    }
  } catch (_) {}
  if (window.__tpoNativeLangHooked) return;
  window.__tpoNativeLangHooked = true;

  var LABEL_TO_CODE = {
    'English': 'en',
    'Tiếng Việt': 'vi',
    'မြန်မာ': 'my',
    'မြန်မာ နိဿယ': 'my_nissaya',
    'සිංහල': 'si',
    '中文': 'zh',
    'ភាសាខ្មែរ': 'km',
    'ไทย': 'th',
    'ລາວ': 'lo',
    'தமிழ்': 'ta',
    'हिन्दी': 'hi',
    'मराठी': 'mr',
    'Bahasa Indonesia': 'id',
    'Čeština': 'cs',
    'Deutsch': 'de',
    'Español': 'es',
    'Français': 'fr',
    '日本語': 'ja',
    'Português': 'pt',
    'Русский': 'ru',
    '한국어': 'ko',
    'नेपाली': 'ne',
    'বাংলা': 'be'
  };

  var installedCodes = new Set();
  var loadedOnce = false;
  var hasPaliSentences = false;
  var activeDownloadingCode = null;
  var downloadingPaliSentences = false;
  var modalWasOpen = false;
  var indexedFtsIds = null;
  var indexedFtsList = [];
  var ftsLoadedOnce = false;
  var lastBarKey = '';

  function parseCssColor(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s || s === 'transparent') return null;
    var hex = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) {
        return [
          parseInt(h[0] + h[0], 16),
          parseInt(h[1] + h[1], 16),
          parseInt(h[2] + h[2], 16)
        ];
      }
      if (h.length === 8 && parseInt(h.slice(6, 8), 16) === 0) return null;
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16)
      ];
    }
    var direct = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (direct) {
      if (direct[4] !== undefined && parseFloat(direct[4]) === 0) return null;
      return [parseInt(direct[1], 10), parseInt(direct[2], 10), parseInt(direct[3], 10)];
    }
    return null;
  }

  function syncThemeBars() {
    if (!window.flutter_inappwebview || !window.flutter_inappwebview.callHandler) return;
    var root = document.documentElement;
    if (!root) return;
    var rootStyles = getComputedStyle(root);
    var bodyBg = document.body ? parseCssColor(getComputedStyle(document.body).backgroundColor) : null;
    var primaryBg = parseCssColor(rootStyles.getPropertyValue('--bg-primary')) || bodyBg;
    var secondaryBg = parseCssColor(rootStyles.getPropertyValue('--bg-secondary')) || primaryBg;
    if (!primaryBg) return;

    var header = document.querySelector('.app-header');
    var headerHidden = !document.body ||
        document.body.classList.contains('tpo-bars-hidden') ||
        document.body.classList.contains('zen-mode') ||
        !header ||
        header.classList.contains('hidden-header') ||
        header.offsetHeight <= 0;
    var topRgb = !headerHidden
        ? (parseCssColor(getComputedStyle(header).backgroundColor) || secondaryBg)
        : primaryBg;
    var botRgb = primaryBg;

    var key = topRgb.join(',') + '|' + botRgb.join(',');
    if (key === lastBarKey) return;
    lastBarKey = key;
    try {
      window.flutter_inappwebview.callHandler('syncSystemBars', {
        topR: topRgb[0],
        topG: topRgb[1],
        topB: topRgb[2],
        botR: botRgb[0],
        botG: botRgb[1],
        botB: botRgb[2]
      });
    } catch (_) {}
  }

  async function refreshIndexedDbs() {
    try {
      var res = await fetch('/api/search/databases', { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      var list = (data && Array.isArray(data.databases)) ? data.databases : [];
      indexedFtsList = list;
      indexedFtsIds = new Set(list.map(function(d) { return d && d.id ? String(d.id) : ''; }).filter(Boolean));
      ftsLoadedOnce = true;
      syncSearchModal();
    } catch (_) {}
  }

  function syncSearchModal() {
    var selectEl = document.querySelector('select[aria-label="Select FTS database"]');
    if (!selectEl) return;
    if (!selectEl.dataset.tpoFtsRequested) {
      selectEl.dataset.tpoFtsRequested = '1';
      refreshIndexedDbs();
    }
    if (!ftsLoadedOnce) {
      return;
    }

    var opts = Array.prototype.slice.call(selectEl.options || []);
    var currentIds = new Set(opts.map(function(o) { return o.value; }));
    var needsSync = opts.some(function(o) { return o.value && !indexedFtsIds.has(o.value); }) ||
        indexedFtsList.some(function(d) { return d && d.id && !currentIds.has(d.id); });

    if (indexedFtsIds.size === 0) {
      if (opts.length !== 1 || opts[0].value !== '__no_fts_indexed__') {
        while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '__no_fts_indexed__';
        emptyOpt.disabled = true;
        emptyOpt.textContent = 'Indexing search databases...';
        selectEl.appendChild(emptyOpt);
      }
      return;
    }

    if (!needsSync) return;

    var prevValue = selectEl.value;
    for (var i = opts.length - 1; i >= 0; i--) {
      if (!indexedFtsIds.has(opts[i].value)) {
        selectEl.remove(i);
      }
    }

    var remaining = new Set(
      Array.prototype.slice.call(selectEl.options || []).map(function(o) { return o.value; })
    );
    for (var j = 0; j < indexedFtsList.length; j++) {
      var db = indexedFtsList[j];
      if (!db || !db.id || remaining.has(db.id)) continue;
      var opt = document.createElement('option');
      opt.value = db.id;
      var label = db.is_pali ? 'Pāḷi CST' : (db.native_name || db.name || db.id);
      opt.textContent = (db.flag ? db.flag + ' ' : '') + label;
      selectEl.appendChild(opt);
    }

    if (!indexedFtsIds.has(prevValue) && selectEl.options.length > 0) {
      selectEl.value = selectEl.options[0].value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (indexedFtsIds.has(prevValue)) {
      selectEl.value = prevValue;
    }
  }

  window.__tpoOnFtsUpdated = function() {
    refreshIndexedDbs();
  };

  async function refreshInstalled() {
    try {
      var res = await fetch('/api/translations', { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      var next = new Set();
      if (data && Array.isArray(data.available)) {
        for (var i = 0; i < data.available.length; i++) {
          var item = data.available[i];
          if (item && item.code) {
            next.add(String(item.code).toLowerCase());
          }
        }
      }
      installedCodes = next;
      hasPaliSentences = Boolean(data && data.has_pali_sentences);
      loadedOnce = true;
      syncOpenModal();
    } catch (_) {}
  }

  function findLanguageModal() {
    var candidates = document.querySelectorAll('span, h2, h3, h4');
    for (var i = 0; i < candidates.length; i++) {
      var text = (candidates[i].textContent || '').trim().toUpperCase();
      if (text.indexOf('TRANSLATION DISPLAY SETTINGS') !== -1) {
        var parent = candidates[i].closest('[role="dialog"]') ||
            candidates[i].closest('.fixed') ||
            candidates[i].parentElement;
        if (parent) return parent;
      }
    }
    return null;
  }

  function resolveCodeFromLabel(labelEl) {
    if (labelEl.dataset && labelEl.dataset.tpoLangCode) {
      return labelEl.dataset.tpoLangCode;
    }
    var spans = labelEl.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (sp.classList && sp.classList.contains('tpo-dl-badge')) continue;
      var txt = (sp.textContent || '').trim();
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_CODE, txt)) {
        return LABEL_TO_CODE[txt];
      }
    }
    return null;
  }

  function resolveTitleFromLabel(labelEl) {
    var spans = labelEl.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (sp.classList && sp.classList.contains('tpo-dl-badge')) continue;
      var txt = (sp.textContent || '').trim();
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_CODE, txt)) {
        return txt;
      }
    }
    return '';
  }

  var DOWNLOAD_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var SPINNER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="animation:tpo-spin 0.9s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

  function updateDownloadIconBadge(el, isDownloading) {
    var nextState = isDownloading ? 'downloading' : 'pending';
    if (el.dataset.tpoDlState === nextState) return;
    el.dataset.tpoDlState = nextState;
    el.innerHTML = isDownloading ? SPINNER_ICON_SVG : DOWNLOAD_ICON_SVG;
    var label = isDownloading ? 'Downloading offline database...' : 'Not downloaded yet — tap to download';
    el.title = label;
    el.setAttribute('aria-label', label);
  }

  function createDownloadIconBadge(className, isDownloading) {
    var badge = document.createElement('span');
    badge.className = className;
    badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-left:4px;flex-shrink:0;color:#b45309;opacity:0.9;vertical-align:middle;';
    updateDownloadIconBadge(badge, isDownloading);
    return badge;
  }

  function syncModal(modal) {
    if (!modal || !loadedOnce) return;
    if (
      (modal.dataset && modal.dataset.tpoNativeLangMenu === '1') ||
      (modal.querySelector && modal.querySelector('[data-tpo-native-lang-menu="1"]'))
    ) {
      return;
    }

    var countSpans = modal.querySelectorAll('span');
    for (var s = 0; s < countSpans.length; s++) {
      var cs = countSpans[s];
      if (cs.children && cs.children.length > 0) continue;
      var cText = (cs.textContent || '').trim();
      if (/^\d+\s+(available|downloaded\b.*)$/i.test(cText)) {
        var desiredCount = installedCodes.size + ' downloaded / 23';
        if (cText !== desiredCount) {
          cs.textContent = desiredCount;
        }
        break;
      }
    }

    var labels = modal.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) {
      var labelEl = labels[i];
      if (!labelEl.querySelector('input[type="checkbox"]')) continue;
      var code = resolveCodeFromLabel(labelEl);
      if (!code) continue;
      labelEl.dataset.tpoLangCode = code;

      var existingBadge = labelEl.querySelector('.tpo-dl-badge');
      var isInstalled = installedCodes.has(code);

      if (isInstalled) {
        if (existingBadge && existingBadge.parentNode) {
          existingBadge.parentNode.removeChild(existingBadge);
        }
      } else {
        var titleSpan = null;
        var spans = labelEl.querySelectorAll('span');
        for (var j = 0; j < spans.length; j++) {
          var t = (spans[j].textContent || '').trim();
          if (Object.prototype.hasOwnProperty.call(LABEL_TO_CODE, t)) {
            titleSpan = spans[j];
            break;
          }
        }
        if (!existingBadge) {
          var badge = createDownloadIconBadge('tpo-dl-badge', activeDownloadingCode === code);
          if (titleSpan && titleSpan.parentNode) {
            titleSpan.parentNode.appendChild(badge);
          } else {
            labelEl.appendChild(badge);
          }
        } else {
          updateDownloadIconBadge(existingBadge, activeDownloadingCode === code);
        }
      }
    }

    var allButtons = modal.querySelectorAll('button');
    for (var b = 0; b < allButtons.length; b++) {
      var btn = allButtons[b];
      var btnText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (btn.dataset.tpoSentenceBtn === '1' || btnText.indexOf('As Sentence') !== -1) {
        btn.dataset.tpoSentenceBtn = '1';
        var existingSentBadge = btn.querySelector('.tpo-sent-dl-badge');
        if (hasPaliSentences) {
          if (existingSentBadge && existingSentBadge.parentNode) {
            existingSentBadge.parentNode.removeChild(existingSentBadge);
          }
        } else if (!existingSentBadge) {
          btn.appendChild(createDownloadIconBadge('tpo-sent-dl-badge', downloadingPaliSentences));
        } else {
          updateDownloadIconBadge(existingSentBadge, downloadingPaliSentences);
        }
        break;
      }
    }
  }

  function syncOpenModal() {
    var modal = findLanguageModal();
    if (modal) {
      if (!modalWasOpen) {
        modalWasOpen = true;
        refreshInstalled();
      }
      syncModal(modal);
    } else if (modalWasOpen) {
      modalWasOpen = false;
    }
  }

  function findButtonByText(root, label) {
    var scope = root || document;
    var buttons = scope.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if ((buttons[i].textContent || '').trim() === label) {
        return buttons[i];
      }
    }
    return null;
  }

  function enableDownloadedLanguageImmediately(targetLabel, code) {
    var activeModal = findLanguageModal();
    var resolvedLabel = (targetLabel && document.contains(targetLabel))
        ? targetLabel
        : ((activeModal && activeModal.querySelector('label[data-tpo-lang-code="' + code + '"]')) ||
            document.querySelector('label[data-tpo-lang-code="' + code + '"]'));
    var checkbox = resolvedLabel ? resolvedLabel.querySelector('input[type="checkbox"]') : null;
    if (!checkbox) return;

    if (!checkbox.checked) {
      resolvedLabel.dataset.tpoBypassClick = '1';
      checkbox.click();
    }

    var attempts = 0;
    function confirmAndClose() {
      var confirmBtn = findButtonByText(document, 'I Understand & Enable');
      if (confirmBtn) {
        confirmBtn.click();
        setTimeout(function() {
          var modalNow = findLanguageModal();
          var doneBtn = modalNow ? findButtonByText(modalNow, 'Done') : null;
          if (doneBtn) doneBtn.click();
        }, 40);
        return;
      }

      var modalNow = findLanguageModal();
      var lblNow = modalNow
          ? modalNow.querySelector('label[data-tpo-lang-code="' + code + '"]')
          : null;
      var cbNow = lblNow ? lblNow.querySelector('input[type="checkbox"]') : null;
      if (cbNow && cbNow.checked) {
        var doneBtn = modalNow ? findButtonByText(modalNow, 'Done') : null;
        if (doneBtn) doneBtn.click();
        return;
      }

      if (attempts < 40) {
        attempts += 1;
        setTimeout(confirmAndClose, 20);
      }
    }
    setTimeout(confirmAndClose, 20);
  }

  function hadFailedPaliSentencesFetch() {
    try {
      if (!window.performance || !window.performance.getEntriesByType) return false;
      var entries = window.performance.getEntriesByType('resource') || [];
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i] && entries[i].name ? String(entries[i].name) : '';
        if (name.indexOf('/pali_sentences') !== -1) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function applySentenceModeAfterDownload(sentBtn) {
    var activeModal = findLanguageModal();
    var targetBtn = (sentBtn && document.contains(sentBtn))
        ? sentBtn
        : (activeModal ? activeModal.querySelector('button[data-tpo-sentence-btn="1"]') : null);
    var needsReload = hadFailedPaliSentencesFetch();
    if (targetBtn) {
      targetBtn.dataset.tpoBypassSentence = '1';
      targetBtn.click();
    }
    setTimeout(function() {
      if (needsReload) {
        window.location.replace(window.location.href);
        return;
      }
      var modalNow = findLanguageModal();
      var doneBtn = modalNow ? findButtonByText(modalNow, 'Done') : null;
      if (doneBtn) doneBtn.click();
    }, 80);
  }

  document.addEventListener('click', async function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('[data-tpo-native-lang-menu="1"]')) return;

    var sentBtn = target.closest('button');
    if (sentBtn) {
      var isSentBtn = sentBtn.dataset.tpoSentenceBtn === '1';
      if (!isSentBtn) {
        var modalEl = findLanguageModal();
        if (modalEl && modalEl.contains(sentBtn)) {
          var sText = (sentBtn.textContent || '').replace(/\s+/g, ' ').trim();
          if (sText.indexOf('As Sentence') !== -1) {
            isSentBtn = true;
            sentBtn.dataset.tpoSentenceBtn = '1';
          }
        }
      }
      if (isSentBtn) {
        if (sentBtn.dataset.tpoBypassSentence === '1') {
          delete sentBtn.dataset.tpoBypassSentence;
          return;
        }
        if (loadedOnce && hasPaliSentences) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        if (!loadedOnce) {
          await refreshInstalled();
          if (hasPaliSentences) {
            sentBtn.dataset.tpoBypassSentence = '1';
            sentBtn.click();
            return;
          }
        }

        if (downloadingPaliSentences) return;
        if (!window.flutter_inappwebview || !window.flutter_inappwebview.callHandler) return;

        downloadingPaliSentences = true;
        syncOpenModal();
        try {
          var sentRes = await window.flutter_inappwebview.callHandler('downloadPaliSentences');
          if (sentRes && sentRes.success) {
            hasPaliSentences = true;
            downloadingPaliSentences = false;
            syncOpenModal();
            applySentenceModeAfterDownload(sentBtn);
          } else {
            downloadingPaliSentences = false;
            syncOpenModal();
          }
        } catch (_) {
          downloadingPaliSentences = false;
          syncOpenModal();
        }
        return;
      }
    }

    var labelEl = target.closest('label');
    if (!labelEl || !labelEl.querySelector('input[type="checkbox"]')) return;

    if (labelEl.dataset.tpoBypassClick === '1') {
      delete labelEl.dataset.tpoBypassClick;
      return;
    }

    var code = resolveCodeFromLabel(labelEl);
    if (!code) return;
    labelEl.dataset.tpoLangCode = code;

    if (loadedOnce && installedCodes.has(code)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    if (!loadedOnce) {
      await refreshInstalled();
      if (installedCodes.has(code)) {
        var readyCb = labelEl.querySelector('input[type="checkbox"]');
        if (readyCb) {
          labelEl.dataset.tpoBypassClick = '1';
          readyCb.click();
        }
        return;
      }
    }

    if (activeDownloadingCode) return;
    if (!window.flutter_inappwebview || !window.flutter_inappwebview.callHandler) return;

    activeDownloadingCode = code;
    syncOpenModal();
    try {
      var res = await window.flutter_inappwebview.callHandler('downloadLanguage', {
        code: code,
        label: resolveTitleFromLabel(labelEl)
      });
      if (res && res.success) {
        installedCodes.add(code);
        activeDownloadingCode = null;
        refreshIndexedDbs();
        syncOpenModal();
        enableDownloadedLanguageImmediately(labelEl, code);
      } else {
        activeDownloadingCode = null;
        syncOpenModal();
      }
    } catch (_) {
      activeDownloadingCode = null;
      syncOpenModal();
    }
  }, true);

  // Auto-toggle top & bottom reading bars on scroll (mirrors epitaka_app's
  // pixel-accumulator threshold logic).
  var AUTO_HIDE_THRESHOLD = 42;
  var barsHidden = false;
  var lastScrollEl = null;
  var lastScrollTop = 0;
  var scrollAccum = 0;
  var lastUserInputAt = 0;
  var suppressDeltaUntil = 0;

  function injectAutoHideStyles() {
    if (document.getElementById('tpo-auto-hide-style')) return;
    var head = document.head || document.documentElement;
    if (!head) return;
    var style = document.createElement('style');
    style.id = 'tpo-auto-hide-style';
    style.textContent = [
      '@keyframes tpo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      'a[href*="play.google.com"], img[src*="Google_Play_Store_badge"] { display: none !important; }',
      '.app-header, .book-tabs-bar, .content-header, footer.app-footer {',
      '  transition: height 0.24s cubic-bezier(0.4, 0, 0.2, 1),',
      '              min-height 0.24s cubic-bezier(0.4, 0, 0.2, 1),',
      '              max-height 0.24s cubic-bezier(0.4, 0, 0.2, 1),',
      '              padding-top 0.24s cubic-bezier(0.4, 0, 0.2, 1),',
      '              padding-bottom 0.24s cubic-bezier(0.4, 0, 0.2, 1),',
      '              transform 0.24s cubic-bezier(0.4, 0, 0.2, 1),',
      '              opacity 0.18s ease !important;',
      '}',
      'body.tpo-bars-hidden .app-header {',
      '  height: 0 !important;',
      '  min-height: 0 !important;',
      '  margin-top: 0 !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  border-bottom-width: 0 !important;',
      '  overflow: hidden !important;',
      '  transform: translateY(-100%) !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}',
      'body.tpo-bars-hidden .book-tabs-bar {',
      '  height: 0 !important;',
      '  min-height: 0 !important;',
      '  margin-top: 0 !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  border-bottom-width: 0 !important;',
      '  overflow: hidden !important;',
      '  transform: translateY(-100%) !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}',
      'body.tpo-bars-hidden .content-header {',
      '  height: 0 !important;',
      '  min-height: 0 !important;',
      '  max-height: 0 !important;',
      '  margin-top: 0 !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  border-bottom-width: 0 !important;',
      '  overflow: hidden !important;',
      '  transform: translateY(-100%) !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}',
      'body.tpo-bars-hidden footer.app-footer,',
      'body.tpo-bars-hidden .app-footer {',
      '  height: 0 !important;',
      '  min-height: 0 !important;',
      '  margin-bottom: 0 !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  border-top-width: 0 !important;',
      '  overflow: hidden !important;',
      '  transform: translateY(100%) !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}'
    ].join('\n');
    head.appendChild(style);
  }

  function isSidebarVisible() {
    var sb = document.querySelector('aside.app-sidebar');
    if (!sb || sb.classList.contains('collapsed')) return false;
    var rect = sb.getBoundingClientRect();
    return rect.width > 20 && rect.right > 20;
  }

  function isBarsToggleBlocked() {
    var body = document.body;
    if (!body) return true;
    if (body.classList.contains('zen-mode')) return true;
    if (document.querySelector('.modal-overlay, .dict-overlay')) return true;
    if (isSidebarVisible()) return true;
    if (!document.querySelector('.reader-view-panel main.content-area')) return true;
    return false;
  }

  function setBarsHidden(nextHidden) {
    injectAutoHideStyles();
    if (!document.body) return;
    var targetState = !!nextHidden;
    if (barsHidden === targetState &&
        document.body.classList.contains('tpo-bars-hidden') === targetState) {
      return;
    }
    barsHidden = targetState;
    document.body.classList.toggle('tpo-bars-hidden', barsHidden);
    suppressDeltaUntil = Date.now() + 300;
    syncThemeBars();
  }

  function syncAutoHideState() {
    injectAutoHideStyles();
    if (!barsHidden) return;
    var body = document.body;
    if (!body ||
        body.classList.contains('zen-mode') ||
        isSidebarVisible() ||
        !document.querySelector('.reader-view-panel main.content-area')) {
      scrollAccum = 0;
      setBarsHidden(false);
    }
  }

  function markUserScrollInput() {
    lastUserInputAt = Date.now();
  }

  document.addEventListener('touchstart', markUserScrollInput, { passive: true, capture: true });
  document.addEventListener('touchmove', markUserScrollInput, { passive: true, capture: true });
  document.addEventListener('touchend', markUserScrollInput, { passive: true, capture: true });
  document.addEventListener('wheel', markUserScrollInput, { passive: true, capture: true });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' ||
        e.key === 'PageUp' || e.key === ' ' || e.key === 'Home' || e.key === 'End') {
      markUserScrollInput();
    }
  }, { passive: true, capture: true });

  document.addEventListener('scroll', function(e) {
    var target = e.target;
    if (!target || !target.matches) return;
    if (!target.matches('.reader-view-panel main.content-area')) return;

    var maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
    var rawTop = target.scrollTop;
    var top = Math.max(0, Math.min(rawTop, maxScroll));

    if (lastScrollEl !== target) {
      lastScrollEl = target;
      lastScrollTop = top;
      scrollAccum = 0;
      if (top <= 24 && barsHidden) {
        setBarsHidden(false);
      }
      return;
    }

    if (isBarsToggleBlocked() || maxScroll <= 80) {
      lastScrollTop = top;
      scrollAccum = 0;
      if (barsHidden) {
        setBarsHidden(false);
      }
      return;
    }

    if (top <= 24) {
      lastScrollTop = top;
      scrollAccum = 0;
      if (barsHidden) {
        setBarsHidden(false);
      }
      return;
    }

    var now = Date.now();
    if (now < suppressDeltaUntil) {
      lastScrollTop = top;
      scrollAccum = 0;
      return;
    }

    var delta = top - lastScrollTop;
    lastScrollTop = top;

    if (rawTop < 0 || rawTop > maxScroll) {
      return;
    }

    if (now - lastUserInputAt > 2500 || Math.abs(delta) > 350) {
      scrollAccum = 0;
      return;
    }

    if (Math.abs(delta) < 1) return;

    if ((delta > 0 && scrollAccum < 0) || (delta < 0 && scrollAccum > 0)) {
      scrollAccum = 0;
    }

    scrollAccum += delta;

    if (scrollAccum > AUTO_HIDE_THRESHOLD) {
      scrollAccum = 0;
      if (!barsHidden) {
        setBarsHidden(true);
      }
    } else if (scrollAccum < -AUTO_HIDE_THRESHOLD) {
      scrollAccum = 0;
      if (barsHidden) {
        setBarsHidden(false);
      }
    }
  }, { passive: true, capture: true });

  function stripAndroidStoreBadges() {
    var anchors = document.querySelectorAll('a[href*="play.google.com"]');
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].parentNode) {
        anchors[i].parentNode.removeChild(anchors[i]);
      }
    }
  }

  var syncScheduled = false;
  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    var run = function() {
      syncScheduled = false;
      try { stripAndroidStoreBadges(); } catch (_) {}
      try { syncAutoHideState(); } catch (_) {}
      try { syncOpenModal(); } catch (_) {}
      try { syncSearchModal(); } catch (_) {}
      try { syncThemeBars(); } catch (_) {}
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  }

  var observer = new MutationObserver(scheduleSync);
  var rootNode = document.body || document.documentElement;
  if (rootNode) {
    observer.observe(rootNode, { childList: true, subtree: true });
  }
  if (document.documentElement) {
    var htmlObserver = new MutationObserver(scheduleSync);
    htmlObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style']
    });
  }
  window.addEventListener('storage', scheduleSync);

  injectAutoHideStyles();
  refreshInstalled();
  refreshIndexedDbs();
  scheduleSync();
})();
''';

@visibleForTesting
String get tipitakaWebBridgeScript => _languageMenuBridgeScript;
