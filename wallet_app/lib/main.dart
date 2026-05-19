import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'data/wallet_repository.dart';

void main() {
  runApp(
    ChangeNotifierProvider<WalletRepository>(
      create: (_) => WalletRepository()..start(),
      child: const WalletApp(),
    ),
  );
}
