import 'package:flutter/material.dart';

import 'reader_pane.dart';

class ReaderScreen extends StatelessWidget {
  final String bookCode;
  final int chapterIndex;
  final int? highlightParaIndex;

  const ReaderScreen({
    super.key,
    required this.bookCode,
    this.chapterIndex = 0,
    this.highlightParaIndex,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(bookCode)),
      body: ReaderPane(
        bookCode: bookCode,
        chapterIndex: chapterIndex,
        highlightParaIndex: highlightParaIndex,
      ),
    );
  }
}
