import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../downloads/download_controller.dart';
import '../home/home_shell.dart';
import 'onboarding_screen.dart';

/// Top-level startup gate modeled on epitaka_app's IndexGate: blocks entry
/// into the main reader until compulsory databases are installed and valid.
class OnboardingGate extends ConsumerStatefulWidget {
  const OnboardingGate({super.key});

  @override
  ConsumerState<OnboardingGate> createState() => _OnboardingGateState();
}

class _OnboardingGateState extends ConsumerState<OnboardingGate> {
  bool _dismissedWizard = false;
  bool _sawOnboarding = false;

  Future<void> _handleOnboardingCompleted() async {
    final current = ref.read(downloadControllerProvider);
    if (current.needsOnboarding) {
      await ref.read(downloadControllerProvider.notifier).completeOnboarding();
    }
    if (!mounted) return;
    if (!ref.read(downloadControllerProvider).needsOnboarding) {
      setState(() {
        _dismissedWizard = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(downloadControllerProvider);

    if (state.isInitializing) {
      return const _StartupCheckScreen();
    }

    if (state.needsOnboarding) {
      _sawOnboarding = true;
      _dismissedWizard = false;
      return OnboardingWizardScreen(
        onCompleted: _handleOnboardingCompleted,
      );
    }

    // Keep user in the wizard while onboarding downloads or immediate FTS5
    // indexing are actively running until they finish or the user explicitly
    // enters the library. Once inside HomeShell, background indexing must not
    // bounce back to the onboarding screen.
    if (_sawOnboarding &&
        !_dismissedWizard &&
        (state.isBatchInstalling ||
            state.hasActiveTransfers ||
            state.isIndexingFts)) {
      return OnboardingWizardScreen(
        onCompleted: _handleOnboardingCompleted,
      );
    }

    _sawOnboarding = false;
    return const HomeShell();
  }
}

class _StartupCheckScreen extends StatelessWidget {
  const _StartupCheckScreen();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.menu_book_rounded, size: 56, color: colorScheme.primary),
            const SizedBox(height: 16),
            Text(
              'TipitakaPali',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16),
            const CircularProgressIndicator(),
            const SizedBox(height: 12),
            Text(
              'Checking offline databases...',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
