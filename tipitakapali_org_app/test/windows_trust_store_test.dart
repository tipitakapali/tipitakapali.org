import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tipitakapali_app/core/network/windows_trust_store.dart';

void main() {
  test('encodeDerCertificateAsPem wraps 64-char base64 lines cleanly', () {
    final der = Uint8List.fromList(List<int>.generate(100, (i) => i & 0xff));
    final pem = encodeDerCertificateAsPem(der);
    final lines = pem.trim().split('\n');

    expect(lines.first, '-----BEGIN CERTIFICATE-----');
    expect(lines.last, '-----END CERTIFICATE-----');
    final body = lines.sublist(1, lines.length - 1);
    for (var i = 0; i < body.length - 1; i++) {
      expect(body[i].length, 64);
    }
    expect(base64.decode(body.join()), der);
  });

  test('initializeWindowsCertificateTrust safely no-ops on non-Windows', () {
    final before = HttpOverrides.current;
    initializeWindowsCertificateTrust(isWindowsOverride: () => false);
    expect(HttpOverrides.current, same(before));
  });
}
