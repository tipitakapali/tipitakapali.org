import 'dart:io';
import 'package:deva2latn/deva2latn.dart';

void printUsage() {
  print('Transliterates Unicode Devanagari to Unicode Latin script (UTF-8)');
  print('syntax:');
  print('deva2latn input [output]');
}

void main(List<String> args) async {
  if (args.isEmpty || args.length > 2) {
    printUsage();
    exit(0);
  }

  final inputPath = args[0];
  final outputPath = args.length == 2 ? args[1] : null;

  final inputFile = File(inputPath);
  final inputDir = Directory(inputPath);

  final converter = Deva2Latn();

  if (inputDir.existsSync()) {
    final outDir = outputPath ?? '../latn';
    final count = await converter.convertTree(inputPath, outDir, useUtf8: true);
    print("Converted $count file(s) from '$inputPath' to '$outDir' in UTF-8 Unicode.");
  } else if (inputFile.existsSync()) {
    String destination;
    final filename = inputFile.uri.pathSegments.last;

    if (outputPath == null) {
      destination = '../latn/$filename';
    } else if (Directory(outputPath).existsSync() || !outputPath.contains('.')) {
      destination = '$outputPath/$filename';
    } else {
      destination = outputPath;
    }

    if (inputPath.endsWith('.json')) {
      await converter.convertJsonFile(inputPath, destination);
    } else {
      await converter.convertFile(inputPath, destination, useUtf8: true);
    }
    print("Converted '$inputPath' -> '$destination' (UTF-8).");
  } else {
    print('Input file does not exist');
    exit(1);
  }
}
