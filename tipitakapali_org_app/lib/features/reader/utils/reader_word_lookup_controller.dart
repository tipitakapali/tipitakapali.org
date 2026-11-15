import 'package:flutter/widgets.dart';

import '../../../core/providers/reader_settings_provider.dart';
import 'reader_word_hit_test.dart';

class TapLookupResult {
  final String? word;
  final ReaderWordHitResult? hit;

  const TapLookupResult({this.word, this.hit});

  bool get shouldLookup => word != null && word!.isNotEmpty;
}

/// Pure pointer gesture state machine modeled after `epitaka_app`'s
/// `ReaderDictionaryLookupController`, supporting single-tap, double-tap,
/// scroll/drag cancellation, and coexistence with text selection.
class ReaderWordLookupController {
  ReaderWordLookupController({
    ReaderWordHitResult? Function(GlobalKey, Offset)? hitFinder,
  }) : _hitFinder = hitFinder ?? hitTestWordAt;

  final ReaderWordHitResult? Function(GlobalKey, Offset) _hitFinder;

  DictLookupTrigger trigger = DictLookupTrigger.single;

  int? _lastTapDownTimeMs;
  Offset? _lastTapDownPos;
  int _activePointer = -1;
  bool _isPointerDown = false;
  bool _sawAdditionalPointer = false;
  bool _movedSinceDown = false;

  static const int _kDoubleTapTimeMs = 400;
  static const double _kDoubleTapSlopPx = 40.0;
  static const int _kSingleTapMaxDurationMs = 500;
  static const double _kTapMovementSlopPx = 10.0;

  void setTrigger(DictLookupTrigger value) {
    if (value == trigger) return;
    trigger = value;
    clearTapState();
  }

  TapLookupResult handlePointerDown({
    required int pointer,
    required Offset localPosition,
    required Offset globalPosition,
    required int timestampMs,
    required GlobalKey contentHitTestKey,
  }) {
    if (trigger == DictLookupTrigger.off) return const TapLookupResult();

    if (_isPointerDown && pointer != _activePointer) {
      _sawAdditionalPointer = true;
      return const TapLookupResult();
    }

    _activePointer = pointer;
    _isPointerDown = true;
    _movedSinceDown = false;
    _sawAdditionalPointer = false;

    final lastTime = _lastTapDownTimeMs;
    final lastPos = _lastTapDownPos;
    _lastTapDownTimeMs = timestampMs;
    _lastTapDownPos = localPosition;

    if (trigger == DictLookupTrigger.doubleTap &&
        lastTime != null &&
        lastPos != null) {
      final dt = timestampMs - lastTime;
      final dist = (localPosition - lastPos).distance;
      if (dt >= 0 && dt <= _kDoubleTapTimeMs && dist <= _kDoubleTapSlopPx) {
        _lastTapDownTimeMs = null;
        _lastTapDownPos = null;
        final hit = _validateHit(_hitFinder(contentHitTestKey, globalPosition));
        return TapLookupResult(word: hit?.word, hit: hit);
      }
    }

    return const TapLookupResult();
  }

  void handlePointerMove(int pointer, Offset localPosition) {
    if (pointer != _activePointer) return;
    final downPos = _lastTapDownPos;
    if (downPos == null) return;
    if ((localPosition - downPos).distance > _kTapMovementSlopPx) {
      _movedSinceDown = true;
      if (trigger == DictLookupTrigger.doubleTap) {
        _lastTapDownTimeMs = null;
        _lastTapDownPos = null;
      }
    }
  }

  TapLookupResult handlePointerUp({
    required int pointer,
    required Offset globalPosition,
    required int timestampMs,
    required GlobalKey contentHitTestKey,
    required bool hasSelection,
  }) {
    if (pointer != _activePointer) return const TapLookupResult();
    final wasDown = _isPointerDown;
    _isPointerDown = false;
    _activePointer = -1;

    if (trigger != DictLookupTrigger.single || !wasDown) {
      return const TapLookupResult();
    }

    final downMs = _lastTapDownTimeMs;
    final moved = _movedSinceDown;
    _movedSinceDown = false;
    if (moved || _sawAdditionalPointer || hasSelection || downMs == null) {
      return const TapLookupResult();
    }

    final dt = timestampMs - downMs;
    if (dt < 0 || dt > _kSingleTapMaxDurationMs) {
      return const TapLookupResult();
    }

    _lastTapDownTimeMs = null;
    _lastTapDownPos = null;
    final hit = _validateHit(_hitFinder(contentHitTestKey, globalPosition));
    return TapLookupResult(word: hit?.word, hit: hit);
  }

  void handlePointerCancel(int pointer) {
    if (pointer != _activePointer) return;
    _isPointerDown = false;
    _movedSinceDown = false;
    _sawAdditionalPointer = false;
    _activePointer = -1;
  }

  void clearTapState() {
    _lastTapDownTimeMs = null;
    _lastTapDownPos = null;
    _isPointerDown = false;
    _movedSinceDown = false;
    _sawAdditionalPointer = false;
    _activePointer = -1;
  }

  ReaderWordHitResult? _validateHit(ReaderWordHitResult? hit) {
    if (hit == null) return null;
    if (hit.word.length > 80 || hit.word.contains('\n')) return null;
    return hit;
  }
}
