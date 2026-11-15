import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

/// Encodes DER X.509 certificate bytes as a PEM certificate block.
String encodeDerCertificateAsPem(Uint8List derBytes) {
  final b64 = base64.encode(derBytes);
  final buf = StringBuffer('-----BEGIN CERTIFICATE-----\n');
  for (var i = 0; i < b64.length; i += 64) {
    final end = (i + 64 < b64.length) ? i + 64 : b64.length;
    buf.writeln(b64.substring(i, end));
  }
  buf.writeln('-----END CERTIFICATE-----');
  return buf.toString();
}

/// On Windows, Dart's `dart:io` BoringSSL uses a static compiled-in Mozilla CA
/// bundle rather than the Windows Certificate Store. This initializer:
/// 1. Loads Windows trusted `ROOT` and intermediate `CA` certificates into
///    `SecurityContext.defaultContext`.
/// 2. Installs a global `HttpOverrides` whose `badCertificateCallback` falls
///    back to strict Windows CryptoAPI `CERT_CHAIN_POLICY_SSL` verification
///    (handling Windows enterprise/VM proxy CAs and Windows AIA intermediate
///    retrieval without ever disabling certificate or hostname checks).
void initializeWindowsCertificateTrust({bool Function()? isWindowsOverride}) {
  final isWindows = isWindowsOverride?.call() ?? Platform.isWindows;
  if (!isWindows) return;
  _WindowsTrustStore.ensureInitialized();
}

class _WindowsTrustStore {
  static bool _initialized = false;

  static void ensureInitialized() {
    if (_initialized) return;
    _initialized = true;

    try {
      final api = _Crypt32Api();
      api.loadWindowsSystemStoresInto(SecurityContext.defaultContext);
      HttpOverrides.global = _WindowsHttpOverrides(
        api,
        previous: HttpOverrides.current,
      );
    } catch (_) {
      // Never block app startup if crypt32 initialization fails unexpectedly.
    }
  }
}

class _WindowsHttpOverrides extends HttpOverrides {
  final _Crypt32Api _api;
  final HttpOverrides? previous;

  _WindowsHttpOverrides(this._api, {this.previous});

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final prev = previous;
    final client = prev != null
        ? prev.createHttpClient(context)
        : super.createHttpClient(context);
    client.badCertificateCallback = (X509Certificate cert, String host, int _) {
      return _api.verifySslCertificate(cert.der, host);
    };
    return client;
  }
}

final class _CertContext extends Struct {
  @Uint32()
  external int dwCertEncodingType;

  external Pointer<Uint8> pbCertEncoded;

  @Uint32()
  external int cbCertEncoded;

  external Pointer<Void> pCertInfo;

  external Pointer<Void> hCertStore;
}

final class _CertEnhkeyUsage extends Struct {
  @Uint32()
  external int cUsageIdentifier;

  external Pointer<Pointer<Uint8>> rgpszUsageIdentifier;
}

final class _CertUsageMatch extends Struct {
  @Uint32()
  external int dwType;

  external _CertEnhkeyUsage usage;
}

final class _CertChainPara extends Struct {
  @Uint32()
  external int cbSize;

  external _CertUsageMatch requestedUsage;
}

final class _SslExtraCertChainPolicyPara extends Struct {
  @Uint32()
  external int cbSize;

  @Uint32()
  external int dwAuthType;

  @Uint32()
  external int fdwChecks;

  external Pointer<Utf16> pwszServerName;
}

final class _CertChainPolicyPara extends Struct {
  @Uint32()
  external int cbSize;

  @Uint32()
  external int dwFlags;

  external Pointer<Void> pvExtraPolicyPara;
}

final class _CertChainPolicyStatus extends Struct {
  @Uint32()
  external int cbSize;

  @Uint32()
  external int dwError;

  @Int32()
  external int lChainIndex;

  @Int32()
  external int lElementIndex;

  external Pointer<Void> pvExtraPolicyStatus;
}

typedef _CertOpenStoreNative =
    Pointer<Void> Function(
      Pointer<Void> lpszStoreProvider,
      Uint32 dwEncodingType,
      Pointer<Void> hCryptProv,
      Uint32 dwFlags,
      Pointer<Void> pvPara,
    );
typedef _CertOpenStoreDart =
    Pointer<Void> Function(
      Pointer<Void> lpszStoreProvider,
      int dwEncodingType,
      Pointer<Void> hCryptProv,
      int dwFlags,
      Pointer<Void> pvPara,
    );

typedef _CertEnumCertificatesInStoreNative =
    Pointer<_CertContext> Function(
      Pointer<Void> hCertStore,
      Pointer<_CertContext> pPrevCertContext,
    );
typedef _CertEnumCertificatesInStoreDart =
    Pointer<_CertContext> Function(
      Pointer<Void> hCertStore,
      Pointer<_CertContext> pPrevCertContext,
    );

typedef _CertCloseStoreNative =
    Int32 Function(Pointer<Void> hCertStore, Uint32 dwFlags);
typedef _CertCloseStoreDart =
    int Function(Pointer<Void> hCertStore, int dwFlags);

typedef _CertCreateCertificateContextNative =
    Pointer<_CertContext> Function(
      Uint32 dwCertEncodingType,
      Pointer<Uint8> pbCertEncoded,
      Uint32 cbCertEncoded,
    );
typedef _CertCreateCertificateContextDart =
    Pointer<_CertContext> Function(
      int dwCertEncodingType,
      Pointer<Uint8> pbCertEncoded,
      int cbCertEncoded,
    );

typedef _CertFreeCertificateContextNative =
    Int32 Function(Pointer<_CertContext> pCertContext);
typedef _CertFreeCertificateContextDart =
    int Function(Pointer<_CertContext> pCertContext);

typedef _CertGetCertificateChainNative =
    Int32 Function(
      Pointer<Void> hChainEngine,
      Pointer<_CertContext> pCertContext,
      Pointer<Void> pTime,
      Pointer<Void> hAdditionalStore,
      Pointer<_CertChainPara> pChainPara,
      Uint32 dwFlags,
      Pointer<Void> pvReserved,
      Pointer<Pointer<Void>> ppChainContext,
    );
typedef _CertGetCertificateChainDart =
    int Function(
      Pointer<Void> hChainEngine,
      Pointer<_CertContext> pCertContext,
      Pointer<Void> pTime,
      Pointer<Void> hAdditionalStore,
      Pointer<_CertChainPara> pChainPara,
      int dwFlags,
      Pointer<Void> pvReserved,
      Pointer<Pointer<Void>> ppChainContext,
    );

typedef _CertFreeCertificateChainNative =
    Void Function(Pointer<Void> pChainContext);
typedef _CertFreeCertificateChainDart =
    void Function(Pointer<Void> pChainContext);

typedef _CertVerifyCertificateChainPolicyNative =
    Int32 Function(
      Pointer<Void> pszPolicyOID,
      Pointer<Void> pChainContext,
      Pointer<_CertChainPolicyPara> pPolicyPara,
      Pointer<_CertChainPolicyStatus> pPolicyStatus,
    );
typedef _CertVerifyCertificateChainPolicyDart =
    int Function(
      Pointer<Void> pszPolicyOID,
      Pointer<Void> pChainContext,
      Pointer<_CertChainPolicyPara> pPolicyPara,
      Pointer<_CertChainPolicyStatus> pPolicyStatus,
    );

class _Crypt32Api {
  static const int _certStoreProvSystemW = 10;
  static const int _x509AndPkcs7Encoding = 0x00010001;
  static const int _certSystemStoreCurrentUser = 0x00010000;
  static const int _certSystemStoreLocalMachine = 0x00020000;
  static const int _certStoreReadOnlyFlag = 0x00008000;
  static const int _certStoreOpenExistingFlag = 0x00004000;
  static const int _certChainPolicySsl = 4;
  static const int _authtypeServer = 2;

  late final DynamicLibrary _lib;
  late final _CertOpenStoreDart _certOpenStore;
  late final _CertEnumCertificatesInStoreDart _certEnumCertificatesInStore;
  late final _CertCloseStoreDart _certCloseStore;
  late final _CertCreateCertificateContextDart _certCreateCertificateContext;
  late final _CertFreeCertificateContextDart _certFreeCertificateContext;
  late final _CertGetCertificateChainDart _certGetCertificateChain;
  late final _CertFreeCertificateChainDart _certFreeCertificateChain;
  late final _CertVerifyCertificateChainPolicyDart
  _certVerifyCertificateChainPolicy;

  _Crypt32Api() {
    _lib = DynamicLibrary.open('crypt32.dll');
    _certOpenStore = _lib
        .lookup<NativeFunction<_CertOpenStoreNative>>('CertOpenStore')
        .asFunction();
    _certEnumCertificatesInStore = _lib
        .lookup<NativeFunction<_CertEnumCertificatesInStoreNative>>(
          'CertEnumCertificatesInStore',
        )
        .asFunction();
    _certCloseStore = _lib
        .lookup<NativeFunction<_CertCloseStoreNative>>('CertCloseStore')
        .asFunction();
    _certCreateCertificateContext = _lib
        .lookup<NativeFunction<_CertCreateCertificateContextNative>>(
          'CertCreateCertificateContext',
        )
        .asFunction();
    _certFreeCertificateContext = _lib
        .lookup<NativeFunction<_CertFreeCertificateContextNative>>(
          'CertFreeCertificateContext',
        )
        .asFunction();
    _certGetCertificateChain = _lib
        .lookup<NativeFunction<_CertGetCertificateChainNative>>(
          'CertGetCertificateChain',
        )
        .asFunction();
    _certFreeCertificateChain = _lib
        .lookup<NativeFunction<_CertFreeCertificateChainNative>>(
          'CertFreeCertificateChain',
        )
        .asFunction();
    _certVerifyCertificateChainPolicy = _lib
        .lookup<NativeFunction<_CertVerifyCertificateChainPolicyNative>>(
          'CertVerifyCertificateChainPolicy',
        )
        .asFunction();
  }

  void loadWindowsSystemStoresInto(SecurityContext context) {
    final seen = <String>{};
    const locations = [
      _certSystemStoreCurrentUser,
      _certSystemStoreLocalMachine,
    ];
    const storeNames = ['ROOT', 'CA'];

    for (final location in locations) {
      for (final name in storeNames) {
        final namePtr = name.toNativeUtf16();
        Pointer<Void> store = nullptr;
        try {
          store = _certOpenStore(
            Pointer<Void>.fromAddress(_certStoreProvSystemW),
            0,
            nullptr,
            location | _certStoreReadOnlyFlag | _certStoreOpenExistingFlag,
            namePtr.cast<Void>(),
          );
          if (store == nullptr) continue;

          Pointer<_CertContext> certCtx = nullptr;
          while (true) {
            certCtx = _certEnumCertificatesInStore(store, certCtx);
            if (certCtx == nullptr) break;
            final len = certCtx.ref.cbCertEncoded;
            final ptr = certCtx.ref.pbCertEncoded;
            if (len <= 0 || ptr == nullptr) continue;
            final der = Uint8List.fromList(ptr.asTypedList(len));
            final key = base64.encode(der);
            if (!seen.add(key)) continue;
            try {
              context.setTrustedCertificatesBytes(
                utf8.encode(encodeDerCertificateAsPem(der)),
              );
            } catch (_) {
              // Ignore individual certs already present or unsupported by BoringSSL.
            }
          }
        } finally {
          if (store != nullptr) {
            _certCloseStore(store, 0);
          }
          calloc.free(namePtr);
        }
      }
    }
  }

  bool verifySslCertificate(Uint8List derBytes, String host) {
    if (derBytes.isEmpty || host.trim().isEmpty) return false;

    final derPtr = calloc<Uint8>(derBytes.length);
    derPtr.asTypedList(derBytes.length).setAll(0, derBytes);
    Pointer<_CertContext> certCtx = nullptr;
    Pointer<Pointer<Void>> chainOut = nullptr;
    Pointer<Void> chainCtx = nullptr;
    Pointer<_CertChainPara> chainPara = nullptr;
    Pointer<Utf16> hostPtr = nullptr;
    Pointer<_SslExtraCertChainPolicyPara> sslExtra = nullptr;
    Pointer<_CertChainPolicyPara> policyPara = nullptr;
    Pointer<_CertChainPolicyStatus> policyStatus = nullptr;

    try {
      certCtx = _certCreateCertificateContext(
        _x509AndPkcs7Encoding,
        derPtr,
        derBytes.length,
      );
      if (certCtx == nullptr) return false;

      chainPara = calloc<_CertChainPara>();
      chainPara.ref.cbSize = sizeOf<_CertChainPara>();
      chainOut = calloc<Pointer<Void>>();

      final gotChain = _certGetCertificateChain(
        nullptr,
        certCtx,
        nullptr,
        nullptr,
        chainPara,
        0,
        nullptr,
        chainOut,
      );
      chainCtx = chainOut.value;
      if (gotChain == 0 || chainCtx == nullptr) return false;

      hostPtr = host.trim().toNativeUtf16();
      sslExtra = calloc<_SslExtraCertChainPolicyPara>();
      sslExtra.ref.cbSize = sizeOf<_SslExtraCertChainPolicyPara>();
      sslExtra.ref.dwAuthType = _authtypeServer;
      sslExtra.ref.fdwChecks = 0;
      sslExtra.ref.pwszServerName = hostPtr;

      policyPara = calloc<_CertChainPolicyPara>();
      policyPara.ref.cbSize = sizeOf<_CertChainPolicyPara>();
      policyPara.ref.dwFlags = 0;
      policyPara.ref.pvExtraPolicyPara = sslExtra.cast<Void>();

      policyStatus = calloc<_CertChainPolicyStatus>();
      policyStatus.ref.cbSize = sizeOf<_CertChainPolicyStatus>();

      final verified = _certVerifyCertificateChainPolicy(
        Pointer<Void>.fromAddress(_certChainPolicySsl),
        chainCtx,
        policyPara,
        policyStatus,
      );
      return verified != 0 && policyStatus.ref.dwError == 0;
    } catch (_) {
      return false;
    } finally {
      if (chainCtx != nullptr) _certFreeCertificateChain(chainCtx);
      if (certCtx != nullptr) _certFreeCertificateContext(certCtx);
      if (policyStatus != nullptr) calloc.free(policyStatus);
      if (policyPara != nullptr) calloc.free(policyPara);
      if (sslExtra != nullptr) calloc.free(sslExtra);
      if (hostPtr != nullptr) calloc.free(hostPtr);
      if (chainOut != nullptr) calloc.free(chainOut);
      if (chainPara != nullptr) calloc.free(chainPara);
      calloc.free(derPtr);
    }
  }
}
