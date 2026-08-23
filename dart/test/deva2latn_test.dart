import 'dart:io';
import 'package:test/test.dart';
import 'package:deva2latn/deva2latn.dart';

void main() {
  group('Deva2Latn Basic Transliteration', () {
    late Deva2Latn converter;

    setUp(() {
      converter = Deva2Latn();
    });

    test('vowels and niggahita', () {
      expect(converter.convertString('अ आ इ ई उ ऊ ए ओ'), 'a ā i ī u ū e o');
      expect(converter.convertString('धम्मं'), 'dhammaṃ');
      expect(converter.convertString('सं'), 'saṃ');
    });

    test('stops and consonants with inherent a', () {
      expect(converter.convertString('क ख ग घ ङ'), 'ka kha ga gha ṅa');
      expect(converter.convertString('च छ ज झ ञ'), 'ca cha ja jha ña');
      expect(converter.convertString('ट ठ ड ढ ण'), 'ṭa ṭha ḍa ḍha ṇa');
      expect(converter.convertString('त थ द ध न'), 'ta tha da dha na');
      expect(converter.convertString('प फ ब भ म'), 'pa pha ba bha ma');
      expect(converter.convertString('य र ल व स ह ळ'), 'ya ra la va sa ha ḷa');
    });

    test('conjuncts with virama', () {
      expect(converter.convertString('बुद्ध'), 'buddha');
      expect(converter.convertString('धम्म'), 'dhamma');
      expect(converter.convertString('सङ्घ'), 'saṅgha');
      expect(converter.convertString('अभिधम्म'), 'abhidhamma');
    });

    test('numerals', () {
      expect(converter.convertString('० १२३४५६७८९'), '0 123456789');
    });

    test('dandas and punctuation', () {
      final gatha = '<p rend="gatha1">गाथा पदं। अपरं पदं॥</p>';
      expect(converter.convertDandas(gatha), '<p rend="gatha1">गाथा पदं; अपरं पदं.</p>');

      final centre = '<p rend="centre">॥ नमो तस्स ॥</p>';
      expect(converter.convertDandas(centre), '<p rend="centre"> नमो तस्स </p>');
    });

    test('punctuation cleanup', () {
      expect(converter.cleanupPunctuation('dhamma , saṅgha .'), 'dhamma, saṅgha.');
      expect(converter.cleanupPunctuation('evaṃ ? āma !'), 'evaṃ? āma!');
    });
  });

  group('Deva2Latn XML File Conversion', () {
    test('converts abh01m.mul.xml identically to reference in UTF-16LE', () async {
      final converter = Deva2Latn();
      final tempOut = '${Directory.systemTemp.path}/abh01m_dart_test.xml';

      await converter.convertFile('../deva/abh01m.mul.xml', tempOut, useUtf8: false);

      final generatedBytes = await File(tempOut).readAsBytes();
      final referenceBytes = await File('../romn/abh01m.mul.xml').readAsBytes();

      expect(generatedBytes.length, equals(referenceBytes.length));
      expect(generatedBytes, equals(referenceBytes));

      if (File(tempOut).existsSync()) {
        File(tempOut).deleteSync();
      }
    });

    test('converts abh01m.mul.xml to valid UTF-8', () async {
      final converter = Deva2Latn();
      final tempOut = '${Directory.systemTemp.path}/abh01m_dart_utf8_test.xml';

      await converter.convertFile('../deva/abh01m.mul.xml', tempOut, useUtf8: true);

      final generatedText = await File(tempOut).readAsString();
      expect(generatedText.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), isTrue);
      expect(generatedText.contains('Dhammasaṅgaṇīpāḷi'), isTrue);

      if (File(tempOut).existsSync()) {
        File(tempOut).deleteSync();
      }
    });

    test('converts tree.json to Roman Latin in UTF-8', () async {
      final converter = Deva2Latn();
      final tempOut = '${Directory.systemTemp.path}/tree_dart_utf8_test.json';

      await converter.convertJsonFile('../tipitaka.org/deva/tree.json', tempOut);

      final generatedText = await File(tempOut).readAsString();
      expect(generatedText.contains('"Tipiṭaka"'), isTrue);
      expect(generatedText.contains('"Vinayapiṭaka"'), isTrue);

      if (File(tempOut).existsSync()) {
        File(tempOut).deleteSync();
      }
    });
  });
}
