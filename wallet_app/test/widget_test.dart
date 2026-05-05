import 'package:flutter_test/flutter_test.dart';
import 'package:wallet_app/app.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const WalletApp());
    expect(find.byType(WalletApp), findsOneWidget);
  });
}
