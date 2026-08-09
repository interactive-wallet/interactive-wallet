import 'package:flutter/material.dart';

/// Wraps [child] with a border/glow that fades out over [duration] — used to
/// draw the eye to list items that just appeared via a live SSE update, so
/// users don't have to spot new rows on their own.
///
/// Pass a stable [key] (e.g. `ValueKey(item.id)`) on the enclosing widget so
/// Flutter reuses this State across rebuilds instead of restarting the fade
/// every time the parent list redraws.
class NewItemHighlight extends StatefulWidget {
  final bool isNew;
  final Color color;
  final BorderRadius borderRadius;
  final Widget child;
  final Duration duration;

  const NewItemHighlight({
    super.key,
    required this.isNew,
    required this.color,
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(16)),
    this.duration = const Duration(seconds: 5),
  });

  @override
  State<NewItemHighlight> createState() => _NewItemHighlightState();
}

class _NewItemHighlightState extends State<NewItemHighlight>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    if (widget.isNew) {
      _controller.value = 1.0;
      _controller.reverse();
    }
  }

  @override
  void didUpdateWidget(covariant NewItemHighlight oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The card widget stays mounted (stable key) across rebuilds, so a later
    // change to an already-visible item — e.g. a revocation — needs its own
    // trigger here; initState only covers the item's first appearance.
    if (widget.isNew && !oldWidget.isNew) {
      _controller.value = 1.0;
      _controller.reverse();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _fade,
      builder: (context, child) {
        final v = _fade.value;
        if (v == 0) return child!;
        return Container(
          decoration: BoxDecoration(
            borderRadius: widget.borderRadius,
            border: Border.all(
              color: widget.color.withOpacity(0.9 * v),
              width: 2,
            ),
            boxShadow: [
              BoxShadow(
                color: widget.color.withOpacity(0.35 * v),
                blurRadius: 16,
                spreadRadius: 1,
              ),
            ],
          ),
          child: child,
        );
      },
      child: widget.child,
    );
  }
}
