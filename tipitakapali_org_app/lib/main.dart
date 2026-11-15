import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/network/windows_trust_store.dart';
import 'core/theme/app_theme.dart';
import 'features/onboarding/onboarding_gate.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  initializeWindowsCertificateTrust();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  runApp(const ProviderScope(child: TipitakaPaliApp()));
}

class TipitakaPaliApp extends StatelessWidget {
  const TipitakaPaliApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tipiṭaka Pāḷi',
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: ThemeMode.system,
      home: const OnboardingGate(),
    );
  }
}
